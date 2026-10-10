// GitHub account: login (Device Flow or the gh CLI) and profile + contribution calendar.
// The token lives in the Windows Credential Manager (like storing a password with
// CredWrite in Delphi), never in a file or in the web page's localStorage.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type Res<T> = Result<T, String>;

/// Client ID of the GitHub OAuth App used for the Device Flow.
/// It is public (not a secret). Create the app at github.com/settings/developers,
/// enable "Device Flow" and paste the Client ID here.
const CLIENT_ID: &str = "Ov23liQGcAURHeTZJDhB";

const USER_AGENT: &str = "will-repo";
const KEYRING_SERVICE: &str = "will-repo";
const KEYRING_USER: &str = "github-token";

/// Errors the UI tells apart by prefix
const NOT_LOGGED: &str = "not_logged";
const OFFLINE: &str = "offline";

fn keyring() -> Res<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

/// Token from our own login first, then from `gh auth token`
fn token() -> Option<(String, &'static str)> {
    if let Ok(t) = keyring().and_then(|k| k.get_password().map_err(|e| e.to_string())) {
        return Some((t, "app"));
    }
    let mut cmd = std::process::Command::new("gh");
    cmd.args(["auth", "token"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let out = cmd.output().ok().filter(|o| o.status.success())?;
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!t.is_empty()).then_some((t, "gh"))
}

fn client() -> Res<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

/// Network failures become "offline: ..." so the UI can fall back to local data
fn net(e: reqwest::Error) -> String {
    format!("{OFFLINE}: {e}")
}

// ---------- Device Flow ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(alias = "device_code")]
    device_code: String,
    #[serde(alias = "user_code")]
    user_code: String,
    #[serde(alias = "verification_uri")]
    verification_uri: String,
    interval: u64,
}

/// Step 1: GitHub gives a short code for the user to type at github.com/login/device
#[tauri::command]
pub async fn github_device_start() -> Res<DeviceCode> {
    if CLIENT_ID.is_empty() {
        return Err("Client ID do GitHub não configurado (src-tauri/src/github.rs)".into());
    }
    client()?
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        // repo: list and create pull requests, private repos included; gist: share a diff
        .form(&[("client_id", CLIENT_ID), ("scope", "read:user repo gist")])
        .send()
        .await
        .map_err(net)?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// Step 2 (called every `interval` seconds): "pending", "slow_down" or "done".
/// On "done" the token is saved in the Credential Manager.
#[tauri::command]
pub async fn github_device_poll(device_code: String) -> Res<String> {
    let body: Value = client()?
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(net)?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(t) = body["access_token"].as_str() {
        keyring()?.set_password(t).map_err(|e| e.to_string())?;
        return Ok("done".into());
    }
    match body["error"].as_str() {
        Some(e @ ("authorization_pending" | "slow_down")) => Ok(if e == "slow_down" {
            "slow_down"
        } else {
            "pending"
        }
        .into()),
        Some("expired_token") => Err("O código expirou, tente de novo".into()),
        Some("access_denied") => Err("Acesso negado no GitHub".into()),
        _ => Err(format!("Resposta inesperada do GitHub: {body}")),
    }
}

/// Forgets the token saved by the app (a gh CLI login is not touched)
#[tauri::command]
pub fn github_logout() -> Res<()> {
    match keyring()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- Profile ----------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubProfile {
    login: String,
    name: Option<String>,
    avatar_url: String,
    bio: Option<String>,
    url: String,
    followers: u64,
    following: u64,
    repositories: u64,
    total_contributions: u64,
    /// ("2026-03-12", 3): every day of the last year
    days: Vec<(String, u64)>,
    /// "app" (Device Flow login) or "gh" (gh CLI)
    source: String,
}

const QUERY: &str = "query { viewer { login name avatarUrl bio url
  followers { totalCount } following { totalCount }
  repositories(ownerAffiliations: OWNER) { totalCount }
  contributionsCollection { contributionCalendar { totalContributions
    weeks { contributionDays { date contributionCount } } } } } }";

/// Sends a request with the saved token; returns the JSON body and the token source
async fn send(req: reqwest::RequestBuilder) -> Res<(Value, &'static str)> {
    let (token, source) = token().ok_or(NOT_LOGGED)?;
    let resp = req.bearer_auth(token).send().await.map_err(net)?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        // revoked or expired token: behave as logged out
        return Err(NOT_LOGGED.into());
    }
    Ok((resp.json().await.map_err(|e| e.to_string())?, source))
}

async fn graphql(query: &str, variables: Value) -> Res<(Value, &'static str)> {
    send(
        client()?
            .post("https://api.github.com/graphql")
            .json(&json!({ "query": query, "variables": variables })),
    )
    .await
}

#[tauri::command]
pub async fn github_profile() -> Res<GithubProfile> {
    let (body, source) = graphql(QUERY, json!({})).await?;
    parse_profile(&body, source)
}

/// GraphQL JSON -> GithubProfile (separate so it can be tested without network)
fn parse_profile(body: &Value, source: &str) -> Res<GithubProfile> {
    if let Some(msg) = body["errors"][0]["message"].as_str() {
        return Err(format!("GitHub: {msg}"));
    }
    let v = &body["data"]["viewer"];
    let text = |key: &str| v[key].as_str().filter(|s| !s.is_empty()).map(String::from);
    let count = |key: &str| v[key]["totalCount"].as_u64().unwrap_or(0);
    let cal = &v["contributionsCollection"]["contributionCalendar"];
    let days = cal["weeks"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|w| w["contributionDays"].as_array().into_iter().flatten())
        .filter_map(|d| {
            Some((
                d["date"].as_str()?.to_string(),
                d["contributionCount"].as_u64()?,
            ))
        })
        .collect();
    Ok(GithubProfile {
        login: text("login").ok_or("GitHub: resposta sem usuário")?,
        name: text("name"),
        avatar_url: text("avatarUrl").unwrap_or_default(),
        bio: text("bio"),
        url: text("url").unwrap_or_default(),
        followers: count("followers"),
        following: count("following"),
        repositories: count("repositories"),
        total_contributions: cal["totalContributions"].as_u64().unwrap_or(0),
        days,
        source: source.into(),
    })
}

// ---------- Your repositories (for cloning) ----------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepo {
    name_with_owner: String,
    description: Option<String>,
    url: String,
    private: bool,
    updated_at: String,
}

const REPOS_QUERY: &str =
    "query { viewer { repositories(first: 100, orderBy: { field: UPDATED_AT, direction: DESC },
  ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]) {
  nodes { nameWithOwner description url isPrivate updatedAt } } } }";

/// Repositories you own or collaborate on, most recently updated first
#[tauri::command]
pub async fn github_repos() -> Res<Vec<GithubRepo>> {
    let (body, _) = graphql(REPOS_QUERY, json!({})).await?;
    parse_repos(&body)
}

fn parse_repos(body: &Value) -> Res<Vec<GithubRepo>> {
    if let Some(msg) = body["errors"][0]["message"].as_str() {
        return Err(format!("GitHub: {msg}"));
    }
    Ok(body["data"]["viewer"]["repositories"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| GithubRepo {
            name_with_owner: r["nameWithOwner"].as_str().unwrap_or_default().into(),
            description: r["description"]
                .as_str()
                .filter(|d| !d.is_empty())
                .map(String::from),
            url: r["url"].as_str().unwrap_or_default().into(),
            private: r["isPrivate"].as_bool().unwrap_or(false),
            updated_at: r["updatedAt"].as_str().unwrap_or_default().into(),
        })
        .collect())
}

// ---------- Share a diff as a secret Gist ----------

fn gist_body(description: &str, file: &str, content: &str) -> Value {
    // secret = not listed or searchable, but anyone with the link can open it
    json!({ "description": description, "public": false, "files": { file: { "content": content } } })
}

/// Creates a secret Gist with `content` and returns its URL
#[tauri::command]
pub async fn github_create_gist(description: String, file: String, content: String) -> Res<String> {
    let req = client()?
        .post("https://api.github.com/gists")
        .header("Accept", "application/vnd.github+json")
        .json(&gist_body(&description, &file, &content));
    let (resp, _) = send(req).await?;
    created_url(&resp)
}

// ---------- Pull requests ----------

/// (owner, name) from a GitHub remote URL: https://github.com/o/r.git, git@github.com:o/r.git, ssh://...
fn parse_remote(url: &str) -> Option<(String, String)> {
    let url = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let rest = url
        .split_once("github.com")?
        .1
        .trim_start_matches([':', '/']);
    let (owner, name) = rest.split_once('/')?;
    (!owner.is_empty() && !name.is_empty() && !name.contains('/'))
        .then(|| (owner.into(), name.into()))
}

fn origin(repo: &str) -> Res<(String, String)> {
    let url = crate::git::git(repo, &["remote", "get-url", "origin"])
        .map_err(|_| "Repositório sem remote origin".to_string())?;
    parse_remote(&url).ok_or_else(|| format!("O origin não é do GitHub: {}", url.trim()))
}

/// "https://github.com/owner/name" when origin is on GitHub (for #123 links), None otherwise
#[tauri::command(async)]
pub fn github_url(repo: String) -> Option<String> {
    origin(&repo)
        .ok()
        .map(|(owner, name)| format!("https://github.com/{owner}/{name}"))
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    number: u64,
    title: String,
    url: String,
    author: String,
    head: String,
    base: String,
    draft: bool,
    updated_at: String,
    /// APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED
    review: Option<String>,
    /// CI of the last commit: SUCCESS | FAILURE | ERROR | PENDING | EXPECTED, None without checks
    ci: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequests {
    default_branch: String,
    items: Vec<PullRequest>,
}

const PRS_QUERY: &str =
    "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  defaultBranchRef { name }
  pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes {
    number title url isDraft updatedAt reviewDecision headRefName baseRefName author { login }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } }";

/// Open pull requests of the repo behind `origin`
#[tauri::command]
pub async fn github_prs(repo: String) -> Res<PullRequests> {
    let (owner, name) = origin(&repo)?;
    let (body, _) = graphql(PRS_QUERY, json!({ "owner": owner, "name": name })).await?;
    parse_prs(&body)
}

fn parse_prs(body: &Value) -> Res<PullRequests> {
    if let Some(msg) = body["errors"][0]["message"].as_str() {
        return Err(format!("GitHub: {msg}"));
    }
    let r = &body["data"]["repository"];
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let items = r["pullRequests"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| PullRequest {
            number: p["number"].as_u64().unwrap_or(0),
            title: s(&p["title"]),
            url: s(&p["url"]),
            // deleted accounts come back as null ("ghost" on the site)
            author: p["author"]["login"].as_str().unwrap_or("ghost").into(),
            head: s(&p["headRefName"]),
            base: s(&p["baseRefName"]),
            draft: p["isDraft"].as_bool().unwrap_or(false),
            updated_at: s(&p["updatedAt"]),
            review: p["reviewDecision"].as_str().map(String::from),
            ci: p["commits"]["nodes"][0]["commit"]["statusCheckRollup"]["state"]
                .as_str()
                .map(String::from),
        })
        .collect();
    Ok(PullRequests {
        default_branch: s(&r["defaultBranchRef"]["name"]),
        items,
    })
}

/// Opens a PR from the current branch (already pushed) into `base`; returns its URL
#[tauri::command]
pub async fn github_create_pr(
    repo: String,
    title: String,
    body: String,
    base: String,
    draft: bool,
) -> Res<String> {
    let (owner, name) = origin(&repo)?;
    let head = crate::git::git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    if head == "HEAD" {
        return Err("HEAD destacado: faça checkout de uma branch".into());
    }
    let req = client()?
        .post(format!("https://api.github.com/repos/{owner}/{name}/pulls"))
        .header("Accept", "application/vnd.github+json")
        .json(&json!({ "title": title, "body": body, "head": head, "base": base, "draft": draft }));
    let (resp, _) = send(req).await?;
    created_url(&resp)
}

/// REST answer -> PR URL, or GitHub's reason ("A pull request already exists for ...")
fn created_url(resp: &Value) -> Res<String> {
    if let Some(url) = resp["html_url"].as_str() {
        return Ok(url.into());
    }
    let detail = resp["errors"][0]["message"]
        .as_str()
        .or(resp["message"].as_str())
        .unwrap_or("resposta inesperada");
    Err(format!("GitHub: {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_urls() {
        let o = |s: &str| parse_remote(s).map(|(a, b)| format!("{a}/{b}"));
        assert_eq!(
            o("https://github.com/WiliamMP/will-repo.git").as_deref(),
            Some("WiliamMP/will-repo")
        );
        assert_eq!(
            o("git@github.com:WiliamMP/will-repo.git\n").as_deref(),
            Some("WiliamMP/will-repo")
        );
        assert_eq!(o("ssh://git@github.com/a/b").as_deref(), Some("a/b"));
        assert_eq!(o("https://user@github.com/a/b/").as_deref(), Some("a/b"));
        assert_eq!(o("https://gitlab.com/a/b.git"), None);
        assert_eq!(o("https://github.com/a"), None);
    }

    #[test]
    fn prs_from_graphql() {
        let body = json!({ "data": { "repository": {
            "defaultBranchRef": { "name": "master" },
            "pullRequests": { "nodes": [
                { "number": 7, "title": "feat: x", "url": "https://github.com/a/b/pull/7", "isDraft": true,
                  "updatedAt": "2026-10-09T10:00:00Z", "reviewDecision": "APPROVED", "headRefName": "feature/x",
                  "baseRefName": "master", "author": { "login": "will" },
                  "commits": { "nodes": [ { "commit": { "statusCheckRollup": { "state": "FAILURE" } } } ] } },
                { "number": 8, "title": "fix", "url": "u", "isDraft": false, "updatedAt": "", "reviewDecision": null,
                  "headRefName": "fix", "baseRefName": "master", "author": null,
                  "commits": { "nodes": [ { "commit": { "statusCheckRollup": null } } ] } }
            ] } } } });
        let p = parse_prs(&body).unwrap();
        assert_eq!(p.default_branch, "master");
        assert_eq!(
            (
                p.items[0].draft,
                p.items[0].ci.as_deref(),
                p.items[0].review.as_deref()
            ),
            (true, Some("FAILURE"), Some("APPROVED"))
        );
        assert_eq!(
            (p.items[1].author.as_str(), p.items[1].ci.as_deref()),
            ("ghost", None)
        );
        assert!(parse_prs(&json!({ "errors": [ { "message": "Could not resolve" } ] })).is_err());
    }

    #[test]
    fn repos_from_graphql() {
        let body = json!({ "data": { "viewer": { "repositories": { "nodes": [
            { "nameWithOwner": "will/app", "description": "", "url": "https://github.com/will/app", "isPrivate": true, "updatedAt": "2026-10-09T00:00:00Z" }
        ] } } } });
        let r = parse_repos(&body).unwrap();
        assert_eq!(
            (
                r[0].name_with_owner.as_str(),
                r[0].description.as_deref(),
                r[0].private
            ),
            ("will/app", None, true)
        );
    }

    #[test]
    fn gist_is_secret() {
        let b = gist_body("alterações", "x.patch", "diff");
        assert_eq!(b["public"], false);
        assert_eq!(b["files"]["x.patch"]["content"], "diff");
    }

    #[test]
    fn create_pr_answer() {
        assert_eq!(
            created_url(&json!({ "html_url": "https://github.com/a/b/pull/9" })).unwrap(),
            "https://github.com/a/b/pull/9"
        );
        let dup = json!({ "message": "Validation Failed", "errors": [ { "message": "A pull request already exists for a:x." } ] });
        assert_eq!(
            created_url(&dup).unwrap_err(),
            "GitHub: A pull request already exists for a:x."
        );
        assert_eq!(
            created_url(&json!({ "message": "Not Found" })).unwrap_err(),
            "GitHub: Not Found"
        );
    }

    /// Real call: open PRs of this repo. Run with: cargo test -- --ignored
    #[test]
    #[ignore]
    fn live_prs() {
        let p = tauri::async_runtime::block_on(github_prs("..".into())).unwrap();
        println!(
            "default {}, {} PR(s) abertos",
            p.default_branch,
            p.items.len()
        );
        assert!(!p.default_branch.is_empty());
    }

    #[test]
    fn profile_from_graphql() {
        let body = json!({ "data": { "viewer": {
            "login": "will", "name": "Will", "avatarUrl": "https://a/x.png", "bio": "", "url": "https://github.com/will",
            "followers": { "totalCount": 3 }, "following": { "totalCount": 1 }, "repositories": { "totalCount": 9 },
            "contributionsCollection": { "contributionCalendar": { "totalContributions": 5, "weeks": [
                { "contributionDays": [ { "date": "2026-10-04", "contributionCount": 2 }, { "date": "2026-10-05", "contributionCount": 3 } ] }
            ] } }
        } } });
        let p = parse_profile(&body, "gh").unwrap();
        assert_eq!(
            (p.login.as_str(), p.bio, p.followers, p.repositories),
            ("will", None, 3, 9)
        );
        assert_eq!(
            p.days,
            vec![("2026-10-04".to_string(), 2), ("2026-10-05".to_string(), 3)]
        );
        assert_eq!(p.total_contributions, 5);
    }

    #[test]
    fn graphql_error_is_reported() {
        let body = json!({ "errors": [ { "message": "Bad credentials" } ] });
        assert_eq!(
            parse_profile(&body, "app").unwrap_err(),
            "GitHub: Bad credentials"
        );
    }

    /// Real call to GitHub with the current login. Run with: cargo test -- --ignored
    #[test]
    #[ignore]
    fn live_profile() {
        let p = tauri::async_runtime::block_on(github_profile()).unwrap();
        println!(
            "{} ({}) {} contribuições, {} dias, via {}",
            p.login,
            p.name.unwrap_or_default(),
            p.total_contributions,
            p.days.len(),
            p.source
        );
        assert!(!p.days.is_empty());
    }
}

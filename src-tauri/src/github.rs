// GitHub account: login (Device Flow or the gh CLI) and profile + contribution calendar.
// The token lives in the Windows Credential Manager (like storing a password with
// CredWrite in Delphi), never in a file or in the web page's localStorage.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

type Res<T> = Result<T, String>;

/// Client ID of the GitHub OAuth App used for the Device Flow.
/// It is public (not a secret). Create the app at github.com/settings/developers,
/// enable "Device Flow" and paste the Client ID here.
const CLIENT_ID: &str = "";

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
        .form(&[("client_id", CLIENT_ID), ("scope", "read:user")])
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
        Some(e @ ("authorization_pending" | "slow_down")) => Ok(if e == "slow_down" { "slow_down" } else { "pending" }.into()),
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

#[tauri::command]
pub async fn github_profile() -> Res<GithubProfile> {
    let (token, source) = token().ok_or(NOT_LOGGED)?;
    let resp = client()?
        .post("https://api.github.com/graphql")
        .bearer_auth(token)
        .json(&json!({ "query": QUERY }))
        .send()
        .await
        .map_err(net)?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        // revoked or expired token: behave as logged out
        return Err(NOT_LOGGED.into());
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
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
        .filter_map(|d| Some((d["date"].as_str()?.to_string(), d["contributionCount"].as_u64()?)))
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!((p.login.as_str(), p.bio, p.followers, p.repositories), ("will", None, 3, 9));
        assert_eq!(p.days, vec![("2026-10-04".to_string(), 2), ("2026-10-05".to_string(), 3)]);
        assert_eq!(p.total_contributions, 5);
    }

    #[test]
    fn graphql_error_is_reported() {
        let body = json!({ "errors": [ { "message": "Bad credentials" } ] });
        assert_eq!(parse_profile(&body, "app").unwrap_err(), "GitHub: Bad credentials");
    }

    /// Real call to GitHub with the current login. Run with: cargo test -- --ignored
    #[test]
    #[ignore]
    fn live_profile() {
        let p = tauri::async_runtime::block_on(github_profile()).unwrap();
        println!("{} ({}) {} contribuições, {} dias, via {}", p.login, p.name.unwrap_or_default(), p.total_contributions, p.days.len(), p.source);
        assert!(!p.days.is_empty());
    }
}

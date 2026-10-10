mod git;
mod github;
mod parse;

use tauri::Manager;

/// Called by the main window once its first screen is loaded: show it, close the splash
#[tauri::command]
fn close_splash(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            close_splash,
            git::git_version,
            git::open_repo,
            git::log,
            git::refs,
            git::status,
            git::tracking,
            git::commit_files,
            git::commit_diff,
            git::working_diff,
            git::file_blob,
            git::stage,
            git::unstage,
            git::discard,
            git::discard_list,
            git::restore_discard,
            git::commit,
            git::commit_message,
            git::pick,
            git::create_tag,
            git::delete_tag,
            git::push_tag,
            git::fetch,
            git::pull,
            git::push,
            git::checkout,
            git::create_branch,
            git::stash_list,
            git::stash_push,
            git::stash_action,
            git::stash_files,
            git::stash_diff,
            git::apply_hunk,
            git::search,
            git::tree,
            git::file_history,
            git::blame,
            git::merge,
            git::rebase,
            git::delete_branch,
            git::repo_state,
            git::operation,
            git::conflict_view,
            git::resolve_conflict_block,
            git::resolve_file,
            git::user_info,
            git::set_user_info,
            git::identities,
            git::set_identities,
            git::open_in_editor,
            git::open_terminal,
            git::repo_summary,
            github::github_device_start,
            github::github_device_poll,
            github::github_logout,
            github::github_profile,
            github::github_prs,
            github::github_url,
            github::github_create_pr,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

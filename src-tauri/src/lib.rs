mod git;
mod parse;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git::open_repo,
            git::log,
            git::refs,
            git::status,
            git::tracking,
            git::commit_files,
            git::commit_diff,
            git::working_diff,
            git::stage,
            git::unstage,
            git::discard,
            git::commit,
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
            git::merge,
            git::rebase,
            git::delete_branch,
            git::repo_state,
            git::operation,
            git::conflict_view,
            git::resolve_conflict_block,
            git::resolve_file,
            git::user_info,
            git::repo_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

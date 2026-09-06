use tauri_plugin_shell::ShellExt;

const ALLOWED_HOST: &str = "folio-api.rsolistx.workers.dev";

/// Folio Beta is a client-only desktop wrapper: no DATABASE_URL, auth
/// secret, Cloudflare credential, Neon credential, AI key, or
/// administrative credential exists anywhere in this crate. The window
/// loads the real, already-authoritative production service directly; the
/// server remains the sole authority on beta access, exactly as it is for
/// the web client. Navigation is restricted to that one origin so the
/// privileged desktop webview can never be steered to an arbitrary domain;
/// anything else opens in the user's normal browser instead.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_navigation(move |webview, url| {
            if url.host_str() == Some(ALLOWED_HOST) {
                return true;
            }
            let app_handle = webview.app_handle().clone();
            let target = url.to_string();
            let _ = app_handle.shell().open(target, None);
            false
        })
        .run(tauri::generate_context!())
        .expect("error while running Folio Beta");
}

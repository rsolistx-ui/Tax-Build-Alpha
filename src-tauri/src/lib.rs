use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;

const ALLOWED_HOST: &str = "folio-api.rsolistx.workers.dev";
const PRODUCTION_URL: &str = "https://folio-api.rsolistx.workers.dev";

/// Folio Beta is a client-only desktop wrapper: no DATABASE_URL, auth
/// secret, Cloudflare credential, Neon credential, AI key, or
/// administrative credential exists anywhere in this crate. The window
/// loads the real, already-authoritative production service directly; the
/// server remains the sole authority on beta access, exactly as it is for
/// the web client. The window is built here (not declared in
/// tauri.conf.json) so navigation can be restricted to that one origin:
/// anything else opens in the user's normal browser instead of inside the
/// privileged desktop webview.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(PRODUCTION_URL.parse().unwrap()))
                .title("Folio Beta")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 600.0)
                .on_navigation(move |url| {
                    if url.host_str() == Some(ALLOWED_HOST) {
                        return true;
                    }
                    let _ = app_handle.shell().open(url.to_string(), None);
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Folio Beta");
}

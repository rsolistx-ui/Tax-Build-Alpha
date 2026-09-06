use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::ShellExt;
use url::Url;

const ALLOWED_HOST: &str = "folio-api.rsolistx.workers.dev";
const PRODUCTION_URL: &str = "https://folio-api.rsolistx.workers.dev";

/// Exact-origin check for privileged in-app navigation: scheme must be
/// https, host must match exactly, the effective port must be the default
/// 443 (an explicit non-default port is rejected even on the right host),
/// and the URL must carry no userinfo (username or password). Anything
/// else - a different scheme, a different host, a non-default port, or
/// embedded credentials - is not the production origin and must not run
/// inside the privileged desktop webview.
fn is_allowed_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(ALLOWED_HOST)
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

/// Folio Beta is a client-only desktop wrapper: no DATABASE_URL, auth
/// secret, Cloudflare credential, Neon credential, AI key, or
/// administrative credential exists anywhere in this crate. The window
/// loads the real, already-authoritative production service directly; the
/// server remains the sole authority on beta access, exactly as it is for
/// the web client. The window is built here (not declared in
/// tauri.conf.json) so navigation can be restricted to that one exact
/// origin: anything else opens in the user's normal browser instead of
/// inside the privileged desktop webview.
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
                    if is_allowed_origin(url) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn allows_the_exact_https_production_origin() {
        assert!(is_allowed_origin(&u("https://folio-api.rsolistx.workers.dev/")));
        assert!(is_allowed_origin(&u("https://folio-api.rsolistx.workers.dev/some/path?x=1")));
    }

    #[test]
    fn rejects_plain_http() {
        assert!(!is_allowed_origin(&u("http://folio-api.rsolistx.workers.dev/")));
    }

    #[test]
    fn rejects_a_non_default_port() {
        assert!(!is_allowed_origin(&u("https://folio-api.rsolistx.workers.dev:8443/")));
    }

    #[test]
    fn rejects_embedded_username() {
        assert!(!is_allowed_origin(&u("https://user@folio-api.rsolistx.workers.dev/")));
    }

    #[test]
    fn rejects_embedded_username_and_password() {
        assert!(!is_allowed_origin(&u("https://user:pass@folio-api.rsolistx.workers.dev/")));
    }

    #[test]
    fn rejects_a_different_domain_entirely() {
        assert!(!is_allowed_origin(&u("https://example.com/")));
    }

    #[test]
    fn rejects_a_subdomain_or_lookalike_host() {
        assert!(!is_allowed_origin(&u("https://folio-api.rsolistx.workers.dev.evil.com/")));
        assert!(!is_allowed_origin(&u("https://evil-folio-api.rsolistx.workers.dev/")));
    }
}

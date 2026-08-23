#[cfg(target_os = "windows")]
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
fn greeting_message(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[tauri::command]
fn greet(name: &str) -> String {
    greeting_message(name)
}

pub fn run() {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    mobile_main();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    desktop_main();
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::mobile_entry_point]
pub fn mobile_main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notifications::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_android_battery_optimization::init())
        .plugin(tauri_plugin_mcp_bridge::init())
        .plugin(tauri_plugin_google_auth::init())
        .plugin(tauri_plugin_iap::init());
    #[cfg(target_os = "ios")]
    let builder = builder
        .plugin(tauri_plugin_siwa::init())
        .plugin(tauri_plugin_watch_sync::init());
    builder
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn desktop_main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notifications::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_mcp_bridge::init())
        .plugin(tauri_plugin_google_auth::init());
    #[cfg(target_os = "macos")]
    let builder = builder
        .plugin(tauri_plugin_iap::init())
        .plugin(tauri_plugin_siwa::init());
    builder
        .setup(|app| {
            // use `app` on non-Windows targets to avoid unused variable warning
            #[cfg(not(target_os = "windows"))]
            {
                let _ = app;
            }

            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_decorations(true).ok();
                    window.set_theme(Some(tauri::Theme::Dark)).ok();

                    if let Ok(icon) =
                        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png",))
                    {
                        window.set_icon(icon).ok();
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::greeting_message;

    #[test]
    fn formats_the_tauri_greeting_contract() {
        assert_eq!(
            greeting_message("Pomi"),
            "Hello, Pomi! You've been greeted from Rust!"
        );
    }

    #[test]
    fn preserves_user_supplied_unicode_and_whitespace() {
        assert_eq!(
            greeting_message("  Pomí 🕰️  "),
            "Hello,   Pomí 🕰️  ! You've been greeted from Rust!"
        );
    }

    #[test]
    fn handles_an_empty_name_without_panicking() {
        assert_eq!(
            greeting_message(""),
            "Hello, ! You've been greeted from Rust!"
        );
    }
}

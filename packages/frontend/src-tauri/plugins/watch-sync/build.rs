const COMMANDS: &[&str] = &["update_session", "clear_session"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}

use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, State, Wry,
};

pub(crate) struct RefreshVault(PluginHandle<Wry>);

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("refresh-vault")
        .setup(|app, api| {
            let handle = api.register_android_plugin("app.pomi.community", "RefreshVaultPlugin")?;
            app.manage(RefreshVault(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn read_android_refresh_token(
    vault: State<'_, RefreshVault>,
    account: String,
) -> Result<Option<String>, String> {
    let result: serde_json::Value = vault
        .0
        .run_mobile_plugin("read", serde_json::json!({ "account": account }))
        .map_err(|error| error.to_string())?;
    Ok(result
        .get("value")
        .and_then(|value| value.as_str())
        .map(String::from))
}

#[tauri::command]
pub async fn write_android_refresh_token(
    vault: State<'_, RefreshVault>,
    account: String,
    value: String,
) -> Result<(), String> {
    vault
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "write",
            serde_json::json!({ "account": account, "value": value }),
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_android_refresh_token(
    vault: State<'_, RefreshVault>,
    account: String,
) -> Result<(), String> {
    vault
        .0
        .run_mobile_plugin::<serde_json::Value>("delete", serde_json::json!({ "account": account }))
        .map(|_| ())
        .map_err(|error| error.to_string())
}

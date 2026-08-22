use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginApi, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_watch_sync);

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Plugin(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSessionPayload {
    pub backend_url: String,
    pub token: String,
    pub user_id: String,
    pub username: String,
}

struct WatchSync<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> WatchSync<R> {
    fn update_session(&self, payload: WatchSessionPayload) -> Result<()> {
        self.0.run_mobile_plugin::<()>("update_session", payload)?;
        Ok(())
    }

    fn clear_session(&self) -> Result<()> {
        self.0.run_mobile_plugin::<()>("clear_session", ())?;
        Ok(())
    }
}

#[tauri::command]
async fn update_session<R: Runtime>(app: AppHandle<R>, payload: WatchSessionPayload) -> Result<()> {
    app.state::<WatchSync<R>>().update_session(payload)
}

#[tauri::command]
async fn clear_session<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    app.state::<WatchSync<R>>().clear_session()
}

fn setup<R: Runtime, C: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<WatchSync<R>> {
    let handle = api.register_ios_plugin(init_plugin_watch_sync)?;
    let _ = app;
    Ok(WatchSync(handle))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("watch-sync")
        .invoke_handler(tauri::generate_handler![update_session, clear_session])
        .setup(|app, api| {
            app.manage(setup(app, api)?);
            Ok(())
        })
        .build()
}

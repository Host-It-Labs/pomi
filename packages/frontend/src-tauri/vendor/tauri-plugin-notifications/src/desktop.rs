use serde::de::DeserializeOwned;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{
    plugin::{PermissionState, PluginApi},
    AppHandle, Runtime,
};

#[cfg(target_os = "macos")]
use std::path::{Path, PathBuf};

use crate::NotificationsBuilder;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Notifications<R>> {
    Ok(Notifications(app.clone()))
}

/// Access to the notification APIs.
///
/// You can get an instance of this type via [`NotificationsExt`](crate::NotificationsExt)
pub struct Notifications<R: Runtime>(AppHandle<R>);

impl<R: Runtime> crate::NotificationsBuilder<R> {
    pub async fn show(self) -> crate::Result<()> {
        let mut notification = imp::Notification::new(self.app.config().identifier.clone());

        if let Some(title) = self
            .data
            .title
            .or_else(|| self.app.config().product_name.clone())
        {
            notification = notification.title(title);
        }
        if let Some(body) = self.data.body {
            notification = notification.body(body);
        }
        if let Some(icon) = self.data.icon {
            notification = notification.icon(icon);
        }
        if let Some(mut sound) = self.data.sound {
            #[cfg(target_os = "macos")]
            {
                sound = macos_sound_name(&self.app, &sound);
            }

            notification = notification.sound(sound);
        }

        notification.show()?;

        Ok(())
    }
}

impl<R: Runtime> Notifications<R> {
    pub fn builder(&self) -> NotificationsBuilder<R> {
        NotificationsBuilder::new(self.0.clone())
    }

    pub async fn request_permission(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Granted)
    }

    pub async fn register_for_push_notifications(&self) -> crate::Result<String> {
        Err(crate::Error::Io(std::io::Error::other(
            "Push notifications are not supported on desktop platforms",
        )))
    }

    pub fn unregister_for_push_notifications(&self) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Push notifications are not supported on desktop platforms",
        )))
    }

    pub async fn permission_state(&self) -> crate::Result<PermissionState> {
        Ok(PermissionState::Granted)
    }

    pub async fn pending(&self) -> crate::Result<Vec<crate::PendingNotification>> {
        Err(crate::Error::Io(std::io::Error::other(
            "Pending notifications are not supported with notify-rust",
        )))
    }

    pub async fn active(&self) -> crate::Result<Vec<crate::ActiveNotification>> {
        Err(crate::Error::Io(std::io::Error::other(
            "Active notifications are not supported with notify-rust",
        )))
    }

    pub fn set_click_listener_active(&self, _active: bool) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Click listeners are not supported with notify-rust",
        )))
    }

    pub fn remove_active(&self, _ids: Vec<i32>) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Removing active notifications is not supported with notify-rust",
        )))
    }

    pub fn cancel(&self, _notifications: Vec<i32>) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Canceling notifications is not supported with notify-rust",
        )))
    }

    pub fn cancel_all(&self) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Canceling notifications is not supported with notify-rust",
        )))
    }

    pub fn register_action_types(&self, _types: Vec<crate::ActionType>) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Action types are not supported with notify-rust",
        )))
    }

    pub fn create_channel(&self, _channel: crate::Channel) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported with notify-rust",
        )))
    }

    pub fn delete_channel(&self, _id: impl Into<String>) -> crate::Result<()> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported with notify-rust",
        )))
    }

    pub fn list_channels(&self) -> crate::Result<Vec<crate::Channel>> {
        Err(crate::Error::Io(std::io::Error::other(
            "Notification channels are not supported with notify-rust",
        )))
    }

    pub async fn get_android_foreground_sync_status(&self) -> crate::Result<serde_json::Value> {
        Ok(serde_json::json!({
            "enabled": false,
            "running": false,
        }))
    }

    pub async fn start_android_foreground_sync(&self) -> crate::Result<serde_json::Value> {
        self.get_android_foreground_sync_status().await
    }

    pub async fn stop_android_foreground_sync(
        &self,
        _clear_opt_in: bool,
        _clear_auth: bool,
    ) -> crate::Result<serde_json::Value> {
        self.get_android_foreground_sync_status().await
    }
}

#[cfg(target_os = "macos")]
fn macos_sound_name<R: Runtime>(app: &AppHandle<R>, sound: &str) -> String {
    const DEFAULT_SOUND: &str = "NSUserNotificationDefaultSoundName";

    if sound == DEFAULT_SOUND {
        return sound.to_string();
    }

    let Some(source) = find_macos_sound_source(app, sound) else {
        return sound_stem(sound);
    };

    if let (Some(file_name), Some(home)) = (source.file_name(), std::env::var_os("HOME")) {
        let destination = PathBuf::from(home).join("Library").join("Sounds");

        if std::fs::create_dir_all(&destination).is_ok() {
            let destination_file = destination.join(file_name);

            if should_copy_macos_sound(&source, &destination_file) {
                let _ = std::fs::copy(&source, destination_file);
            }
        }
    }

    source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| sound_stem(sound))
}

#[cfg(target_os = "macos")]
fn find_macos_sound_source<R: Runtime>(app: &AppHandle<R>, sound: &str) -> Option<PathBuf> {
    let mut names = vec![sound.to_string()];

    if Path::new(sound).extension().is_none() {
        names.push(format!("{sound}.wav"));
        names.push(format!("{sound}.caf"));
        names.push(format!("{sound}.aiff"));
    }

    for base in macos_sound_search_dirs(app) {
        for name in &names {
            let candidate = base.join(name);

            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn macos_sound_search_dirs<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir);
    }

    if let Ok(exe) = tauri::utils::platform::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            dirs.push(exe_dir.to_path_buf());
        }
    }

    dirs
}

#[cfg(target_os = "macos")]
fn should_copy_macos_sound(source: &Path, destination: &Path) -> bool {
    let Ok(source_metadata) = source.metadata() else {
        return false;
    };

    match destination.metadata() {
        Ok(destination_metadata) => source_metadata.len() != destination_metadata.len(),
        Err(_) => true,
    }
}

#[cfg(target_os = "macos")]
fn sound_stem(sound: &str) -> String {
    Path::new(sound)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| sound.to_string())
}

mod imp {
    //! Types and functions related to desktop notifications.

    #[cfg(windows)]
    use std::path::MAIN_SEPARATOR as SEP;

    /// The desktop notification definition.
    ///
    /// Allows you to construct a Notification data and send it.
    #[allow(dead_code)]
    #[derive(Debug, Default)]
    pub struct Notification {
        /// The notification body.
        body: Option<String>,
        /// The notification title.
        title: Option<String>,
        /// The notification icon.
        icon: Option<String>,
        /// The notification sound name.
        sound: Option<String>,
        /// The notification identifier
        identifier: String,
    }

    impl Notification {
        /// Initializes a instance of a Notification.
        pub fn new(identifier: impl Into<String>) -> Self {
            Self {
                identifier: identifier.into(),
                ..Default::default()
            }
        }

        /// Sets the notification body.
        #[must_use]
        pub fn body(mut self, body: impl Into<String>) -> Self {
            self.body = Some(body.into());
            self
        }

        /// Sets the notification title.
        #[must_use]
        pub fn title(mut self, title: impl Into<String>) -> Self {
            self.title = Some(title.into());
            self
        }

        /// Sets the notification icon.
        #[must_use]
        pub fn icon(mut self, icon: impl Into<String>) -> Self {
            self.icon = Some(icon.into());
            self
        }

        /// Sets the notification sound name.
        #[must_use]
        pub fn sound(mut self, sound: impl Into<String>) -> Self {
            self.sound = Some(sound.into());
            self
        }

        /// Shows the notification.
        pub fn show(self) -> crate::Result<()> {
            let mut notification = notify_rust::Notification::new();
            if let Some(body) = self.body {
                notification.body(&body);
            }
            if let Some(title) = self.title {
                notification.summary(&title);
            }
            if let Some(icon) = self.icon {
                notification.icon(&icon);
            } else {
                notification.auto_icon();
            }
            if let Some(sound) = self.sound {
                notification.sound_name(&sound);
            }
            #[cfg(windows)]
            {
                let exe = tauri::utils::platform::current_exe()?;
                let exe_dir = exe.parent().expect("failed to get exe directory");
                let curr_dir = exe_dir.display().to_string();
                // set the notification's System.AppUserModel.ID only when running the installed app
                if !(curr_dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
                    || curr_dir.ends_with(format!("{SEP}target{SEP}release").as_str()))
                {
                    notification.app_id(&self.identifier);
                }
            }
            #[cfg(target_os = "macos")]
            {
                let _ = notify_rust::set_application(if tauri::is_dev() {
                    "com.apple.Terminal"
                } else {
                    &self.identifier
                });
            }

            tauri::async_runtime::spawn(async move {
                let _ = notification.show();
            });

            Ok(())
        }
    }
}

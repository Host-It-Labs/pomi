use serde::de::DeserializeOwned;
#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{
    plugin::{PermissionState, PluginApi},
    AppHandle, Runtime,
};

#[cfg(any(target_os = "macos", test))]
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

    pub async fn set_timer_projection(&self, _projection_json: String) -> crate::Result<()> {
        Ok(())
    }

    pub async fn clear_timer_projection(&self) -> crate::Result<()> {
        Ok(())
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

    let Some(names) = safe_sound_file_names(sound) else {
        return DEFAULT_SOUND.to_string();
    };
    let fallback = sound_stem(sound).unwrap_or_else(|| DEFAULT_SOUND.to_string());
    let Some(source) = find_sound_source_in_dirs(&macos_sound_search_dirs(app), &names) else {
        return fallback;
    };

    if let (Some(file_name), Ok(home)) = (source.file_name(), app.path().home_dir()) {
        if let Some(destination_file) = macos_sound_destination(&home, file_name) {
            if should_copy_macos_sound(&source, &destination_file) {
                // codeql[rust/path-injection] -- Both paths are canonicalized beneath trusted resource and home sound directories.
                let _ = std::fs::copy(&source, destination_file);
            }
        }
    }

    source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(ToString::to_string)
        .unwrap_or(fallback)
}

#[cfg(any(target_os = "macos", test))]
fn safe_sound_file_names(sound: &str) -> Option<Vec<String>> {
    if sound.is_empty() || sound.chars().any(char::is_control) {
        return None;
    }
    let path = Path::new(sound);
    if path.components().count() != 1 || path.file_name()?.to_str()? != sound {
        return None;
    }

    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        if !matches!(
            extension.to_ascii_lowercase().as_str(),
            "wav" | "caf" | "aiff"
        ) {
            return None;
        }
        return Some(vec![sound.to_string()]);
    }

    Some(vec![
        sound.to_string(),
        format!("{sound}.wav"),
        format!("{sound}.caf"),
        format!("{sound}.aiff"),
    ])
}

#[cfg(any(target_os = "macos", test))]
fn find_sound_source_in_dirs(search_dirs: &[PathBuf], names: &[String]) -> Option<PathBuf> {
    for base in search_dirs {
        let Ok(canonical_base) = base.canonicalize() else {
            continue;
        };
        for name in names {
            // codeql[rust/path-injection] -- names contains only validated single-component sound basenames.
            let candidate = canonical_base.join(name);
            // codeql[rust/path-injection] -- candidate uses a validated basename and must canonicalize beneath canonical_base.
            let Ok(canonical_candidate) = candidate.canonicalize() else {
                continue;
            };

            if canonical_candidate.starts_with(&canonical_base) && canonical_candidate.is_file() {
                return Some(canonical_candidate);
            }
        }
    }

    None
}

#[cfg(any(target_os = "macos", test))]
fn macos_sound_destination(home: &Path, file_name: &std::ffi::OsStr) -> Option<PathBuf> {
    let canonical_home = home.canonicalize().ok()?;
    let canonical_library = canonical_child_directory(&canonical_home, "Library")?;
    let canonical_destination = canonical_child_directory(&canonical_library, "Sounds")?;

    // codeql[rust/path-injection] -- file_name comes from a canonical source contained in an application resource directory.
    let destination_file = canonical_destination.join(file_name);
    // codeql[rust/path-injection] -- destination_file is a validated basename beneath the canonical home sound directory.
    if destination_file
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return None;
    }
    Some(destination_file)
}

#[cfg(any(target_os = "macos", test))]
fn canonical_child_directory(parent: &Path, child: &str) -> Option<PathBuf> {
    let candidate = parent.join(child);
    match candidate.symlink_metadata() {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => return None,
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&candidate).ok()?;
        }
        Err(_) => return None,
    }

    let canonical = candidate.canonicalize().ok()?;
    canonical.starts_with(parent).then_some(canonical)
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

#[cfg(any(target_os = "macos", test))]
fn should_copy_macos_sound(source: &Path, destination: &Path) -> bool {
    // codeql[rust/path-injection] -- source was canonicalized beneath a trusted application resource directory.
    let Ok(source_metadata) = source.metadata() else {
        return false;
    };

    // codeql[rust/path-injection] -- destination is contained beneath the canonical home sound directory.
    match destination.metadata() {
        Ok(destination_metadata) => source_metadata.len() != destination_metadata.len(),
        Err(_) => true,
    }
}

#[cfg(any(target_os = "macos", test))]
fn sound_stem(sound: &str) -> Option<String> {
    Path::new(sound)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(ToString::to_string)
}

#[cfg(test)]
mod sound_path_tests {
    use super::{find_sound_source_in_dirs, macos_sound_destination, safe_sound_file_names};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIRECTORY: AtomicUsize = AtomicUsize::new(0);

    fn temporary_directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "pomi-notification-path-test-{}-{}",
            std::process::id(),
            NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("create test directory");
        directory
    }

    #[test]
    fn accepts_only_basenames_with_supported_sound_extensions() {
        assert_eq!(
            safe_sound_file_names("Focus"),
            Some(vec![
                "Focus".to_string(),
                "Focus.wav".to_string(),
                "Focus.caf".to_string(),
                "Focus.aiff".to_string(),
            ])
        );
        assert_eq!(
            safe_sound_file_names("Focus.WAV"),
            Some(vec!["Focus.WAV".to_string()])
        );
        for unsafe_name in [
            "../Focus.wav",
            "/tmp/Focus.wav",
            "sounds/Focus.wav",
            "Focus.mp3",
        ] {
            assert_eq!(safe_sound_file_names(unsafe_name), None);
        }
    }

    #[test]
    fn finds_a_regular_sound_inside_its_canonical_resource_directory() {
        let root = temporary_directory();
        let resources = root.join("resources");
        fs::create_dir_all(&resources).expect("create resources");
        let sound = resources.join("Focus.wav");
        fs::write(&sound, b"sound").expect("write sound");

        assert_eq!(
            find_sound_source_in_dirs(&[resources], &["Focus.wav".to_string()]),
            Some(sound.canonicalize().expect("canonical sound"))
        );
        fs::remove_dir_all(root).expect("remove test directory");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_source_and_destination_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory();
        let resources = root.join("resources");
        let outside = root.join("outside");
        let home = root.join("home");
        fs::create_dir_all(&resources).expect("create resources");
        fs::create_dir_all(&outside).expect("create outside");
        fs::create_dir_all(home.join("Library")).expect("create home library");
        fs::write(outside.join("Focus.wav"), b"sound").expect("write outside sound");
        symlink(outside.join("Focus.wav"), resources.join("Focus.wav"))
            .expect("link outside sound");
        symlink(&outside, home.join("Library").join("Sounds")).expect("link outside destination");

        assert_eq!(
            find_sound_source_in_dirs(&[resources], &["Focus.wav".to_string()]),
            None
        );
        assert_eq!(
            macos_sound_destination(&home, std::ffi::OsStr::new("Focus.wav")),
            None
        );

        fs::remove_file(home.join("Library").join("Sounds")).expect("remove destination link");
        fs::remove_dir(home.join("Library")).expect("remove home library");
        symlink(&outside, home.join("Library")).expect("link outside library");
        assert_eq!(
            macos_sound_destination(&home, std::ffi::OsStr::new("Focus.wav")),
            None
        );
        assert!(!outside.join("Sounds").exists());
        fs::remove_dir_all(root).expect("remove test directory");
    }
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

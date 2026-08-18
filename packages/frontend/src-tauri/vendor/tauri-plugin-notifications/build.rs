#[cfg(target_os = "macos")]
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

const COMMANDS: &[&str] = &[
    "register_listener",
    "remove_listener",
    "notify",
    "request_permission",
    "is_permission_granted",
    "register_for_push_notifications",
    "unregister_for_push_notifications",
    "register_action_types",
    "cancel",
    "cancel_all",
    "get_pending",
    "remove_active",
    "get_active",
    "check_permissions",
    "show",
    "batch",
    "list_channels",
    "delete_channel",
    "create_channel",
    "permission_state",
    "set_click_listener_active",
    "get_android_foreground_sync_status",
    "start_android_foreground_sync",
    "stop_android_foreground_sync",
];

fn main() {
    // Check if push-notifications feature is enabled
    let enable_push = cfg!(feature = "push-notifications");

    // Generate build.properties file for Android
    if std::env::var("TARGET")
        .unwrap_or_default()
        .contains("android")
    {
        let properties_content = format!("enablePushNotifications={}", enable_push);
        std::fs::write("android/build.properties", properties_content)
            .expect("Failed to write build.properties");
    }

    // Generate marker file for iOS/macOS Swift build
    // Package.swift reads this file to conditionally enable ENABLE_PUSH_NOTIFICATIONS
    let ios_marker_path = std::path::Path::new("ios/.push-notifications-enabled");
    let macos_marker_path = std::path::Path::new("macos/.push-notifications-enabled");
    if enable_push {
        if !ios_marker_path.exists() {
            std::fs::write(ios_marker_path, "").expect("Failed to write iOS push marker file");
        }
        if !macos_marker_path.exists() {
            std::fs::write(macos_marker_path, "").expect("Failed to write macOS push marker file");
        }
    } else {
        if ios_marker_path.exists() {
            std::fs::remove_file(ios_marker_path).ok();
        }
        if macos_marker_path.exists() {
            std::fs::remove_file(macos_marker_path).ok();
        }
    }

    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build();

    // when building documentation for Android the plugin build result is always Err() and is irrelevant to the crate documentation build
    if !(cfg!(docsrs)
        && std::env::var("TARGET")
            .expect("Failed to get TARGET environment variable")
            .contains("android"))
    {
        result.expect("Failed to build Tauri plugin");
    }

    #[cfg(target_os = "macos")]
    {
        // Only run macOS-specific build steps when building for macOS
        if std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default() == "macos" {
            let bridges = vec!["src/macos.rs"];
            for path in &bridges {
                println!("cargo:rerun-if-changed={path}");
            }

            println!("cargo:rerun-if-changed=macos/Sources/NotificationPlugin.swift");

            let bridge_out_dir = swift_bridge_out_dir();
            if bridge_out_dir.exists() {
                fs::remove_dir_all(&bridge_out_dir)
                    .expect("Failed to clear Swift bridge output directory");
            }

            swift_bridge_build::parse_bridges(bridges)
                .write_all_concatenated(&bridge_out_dir, env!("CARGO_PKG_NAME"));
            sync_generated_bridge_code(&bridge_out_dir, &generated_code_dir())
                .expect("Failed to sync generated Swift bridge code");

            compile_swift();

            println!("cargo:rustc-link-lib=static=tauri-plugin-notifications");
            println!(
                "cargo:rustc-link-search={}",
                swift_library_static_lib_dir()
                    .to_str()
                    .expect("Swift library path must be valid UTF-8")
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn compile_swift() {
    let swift_package_dir = manifest_dir().join("macos");

    let mut cmd = Command::new("swift");

    cmd.current_dir(swift_package_dir)
        .arg("build")
        .arg("--scratch-path")
        .arg(swift_scratch_dir())
        .args([
            "-Xswiftc",
            "-import-objc-header",
            "-Xswiftc",
            swift_source_dir()
                .join("bridging-header.h")
                .to_str()
                .expect("Bridging header path must be valid UTF-8"),
        ]);

    if is_release_build() {
        cmd.args(["-c", "release"]);
    }

    let exit_status = cmd
        .spawn()
        .expect("Failed to spawn swift build command")
        .wait_with_output()
        .expect("Failed to wait for swift build output");

    if !exit_status.status.success() {
        panic!(
            r#"
Stderr: {}
Stdout: {}
"#,
            String::from_utf8(exit_status.stderr).expect("Stderr must be valid UTF-8"),
            String::from_utf8(exit_status.stdout).expect("Stdout must be valid UTF-8"),
        )
    }
}

#[cfg(target_os = "macos")]
fn swift_bridge_out_dir() -> PathBuf {
    out_dir().join("swift-bridge-generated")
}

#[cfg(target_os = "macos")]
fn manifest_dir() -> PathBuf {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set");
    PathBuf::from(manifest_dir)
}

#[cfg(target_os = "macos")]
fn out_dir() -> PathBuf {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR must be set");
    PathBuf::from(out_dir)
}

#[cfg(target_os = "macos")]
fn is_release_build() -> bool {
    std::env::var("PROFILE").expect("PROFILE must be set") == "release"
}

#[cfg(target_os = "macos")]
fn swift_source_dir() -> PathBuf {
    manifest_dir().join("macos/Sources")
}

#[cfg(target_os = "macos")]
fn generated_code_dir() -> PathBuf {
    swift_source_dir().join("generated")
}

#[cfg(target_os = "macos")]
fn swift_scratch_dir() -> PathBuf {
    out_dir().join("swiftpm-build")
}

#[cfg(target_os = "macos")]
fn sync_generated_bridge_code(source_dir: &Path, destination_dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());

        if source_path.is_dir() {
            sync_generated_bridge_code(&source_path, &destination_path)?;
        } else {
            copy_file_if_changed(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn copy_file_if_changed(source_path: &Path, destination_path: &Path) -> io::Result<()> {
    let should_copy = match fs::read(destination_path) {
        Ok(existing) => fs::read(source_path)? != existing,
        Err(error) if error.kind() == io::ErrorKind::NotFound => true,
        Err(error) => return Err(error),
    };

    if should_copy {
        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source_path, destination_path)?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn swift_library_static_lib_dir() -> PathBuf {
    let debug_or_release = if is_release_build() {
        "release"
    } else {
        "debug"
    };

    swift_scratch_dir().join(debug_or_release)
}

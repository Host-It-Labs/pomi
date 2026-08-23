// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-watch-sync",
  platforms: [.iOS(.v15)],
  products: [
    .library(
      name: "tauri-plugin-watch-sync",
      type: .static,
      targets: ["tauri-plugin-watch-sync"]
    )
  ],
  dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
  targets: [
    .target(
      name: "tauri-plugin-watch-sync",
      dependencies: [.byName(name: "Tauri")],
      path: "Sources"
    )
  ]
)

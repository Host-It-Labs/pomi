import Foundation
import Tauri
import WatchConnectivity
import WebKit

struct WatchSession: Codable {
  let backendUrl: String
  let token: String
  let userId: String
  let username: String

  var dictionary: [String: Any] {
    [
      "backendUrl": backendUrl,
      "token": token,
      "userId": userId,
      "username": username,
    ]
  }
}

final class WatchSessionCoordinator: NSObject, WCSessionDelegate {
  static let shared = WatchSessionCoordinator()
  private let sessionKey = "pomi.watch.session"
  private let group = UserDefaults(suiteName: "group.app.pomi.community")

  override init() {
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func update(_ value: WatchSession) throws {
    group?.set(try JSONEncoder().encode(value), forKey: sessionKey)
    try WCSession.default.updateApplicationContext(value.dictionary)
  }

  func clear() throws {
    group?.removeObject(forKey: sessionKey)
    try WCSession.default.updateApplicationContext(["signedOut": true])
  }

  private func currentDictionary() -> [String: Any]? {
    guard
      let data = group?.data(forKey: sessionKey),
      let value = try? JSONDecoder().decode(WatchSession.self, from: data)
    else { return nil }
    return value.dictionary
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    guard activationState == .activated, let value = currentDictionary() else { return }
    try? session.updateApplicationContext(value)
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }

  func session(
    _ session: WCSession,
    didReceiveMessage message: [String: Any],
    replyHandler: @escaping ([String: Any]) -> Void
  ) {
    if message["requestSession"] as? Bool == true {
      replyHandler(currentDictionary() ?? ["signedOut": true])
    } else {
      replyHandler([:])
    }
  }
}

final class WatchSyncPlugin: Plugin {
  override func load(webview: WKWebView) {
    _ = WatchSessionCoordinator.shared
  }

  @objc func update_session(_ invoke: Invoke) throws {
    let value = try invoke.parseArgs(WatchSession.self)
    do {
      try WatchSessionCoordinator.shared.update(value)
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }

  @objc func clear_session(_ invoke: Invoke) {
    do {
      try WatchSessionCoordinator.shared.clear()
      invoke.resolve()
    } catch {
      invoke.reject(error.localizedDescription)
    }
  }
}

@_cdecl("init_plugin_watch_sync")
func initPlugin() -> Plugin { WatchSyncPlugin() }

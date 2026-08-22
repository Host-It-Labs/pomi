import Foundation
import Security
import WatchConnectivity

struct WatchCredentials: Codable, Equatable {
  let backendUrl: String
  let token: String
  let userId: String
  let username: String

  init?(dictionary: [String: Any]) {
    guard
      let backendUrl = dictionary["backendUrl"] as? String,
      let token = dictionary["token"] as? String,
      let userId = dictionary["userId"] as? String,
      let username = dictionary["username"] as? String
    else { return nil }
    self.backendUrl = backendUrl
    self.token = token
    self.userId = userId
    self.username = username
  }
}

final class WatchSessionStore: NSObject, ObservableObject, WCSessionDelegate {
  @Published private(set) var credentials: WatchCredentials?
  @Published private(set) var isPairing = true
  private let keychainAccount = "pomi.watch.credentials"

  override init() {
    super.init()
    credentials = loadCredentials()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    } else {
      isPairing = false
    }
  }

  func requestSession() {
    guard WCSession.default.isReachable else { return }
    WCSession.default.sendMessage(["requestSession": true], replyHandler: { [weak self] value in
      self?.apply(value)
    }) { _ in }
  }

  func session(
    _ session: WCSession,
    activationDidCompleteWith activationState: WCSessionActivationState,
    error: Error?
  ) {
    DispatchQueue.main.async { [weak self] in
      self?.isPairing = false
      self?.apply(session.receivedApplicationContext)
      self?.requestSession()
    }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    apply(applicationContext)
  }

  private func apply(_ dictionary: [String: Any]) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if dictionary["signedOut"] as? Bool == true {
        credentials = nil
        saveCredentials(nil)
      } else if let value = WatchCredentials(dictionary: dictionary) {
        credentials = value
        saveCredentials(value)
      }
    }
  }

  private func saveCredentials(_ value: WatchCredentials?) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: keychainAccount,
    ]
    SecItemDelete(query as CFDictionary)
    guard let value, let data = try? JSONEncoder().encode(value) else { return }
    var insert = query
    insert[kSecValueData as String] = data
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(insert as CFDictionary, nil)
  }

  private func loadCredentials() -> WatchCredentials? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard
      SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(WatchCredentials.self, from: data)
  }
}

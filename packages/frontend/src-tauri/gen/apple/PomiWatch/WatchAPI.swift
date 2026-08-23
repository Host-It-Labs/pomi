import Foundation
import WidgetKit

struct WatchTimer: Codable {
  let id: String
  let type: String
  let status: String
  let duration: Double
  let remainingTime: Double
  let endsAtMs: Double?
}

struct WatchTask: Codable, Identifiable {
  let id: String
  let title: String
  let priority: String?
  let isOverdue: Bool?
}

struct WatchStatus: Codable {
  let serverNowMs: Double
  let timer: WatchTimer?
  let tasks: [WatchTask]
  let totalVisibleTasks: Int
}

enum WatchAPIError: Error {
  case invalidURL
  case unauthorized
  case requestFailed
  case actionFailed(String)
}

private struct WatchActionErrorPayload: Decodable {
  let message: String
}

private struct WatchActionStatus: Decodable {
  let actionId: String
  let status: String
  let error: WatchActionErrorPayload?
}

final class WatchAPI {
  private let credentials: WatchCredentials
  init(credentials: WatchCredentials) { self.credentials = credentials }

  func status() async throws -> WatchStatus {
    try await request(
      path: "/watch/status?taskMode=intention&limit=5",
      method: "GET",
      body: nil
    )
  }

  func action(_ operation: String, timerType: String?) async throws {
    var action: [String: Any] = ["kind": "timer", "operation": operation]
    if let timerType { action["timerType"] = timerType }
    let body: [String: Any] = ["actionId": UUID().uuidString, "action": action]
    try await submitAndWait(body)
  }

  func complete(task: WatchTask) async throws {
    let body: [String: Any] = [
      "actionId": UUID().uuidString,
      "action": ["kind": "tasks", "operation": "complete", "taskId": task.id],
    ]
    try await submitAndWait(body)
  }

  private func submitAndWait(_ body: [String: Any]) async throws {
    var status: WatchActionStatus = try await request(
      path: "/user-actions",
      method: "POST",
      body: body
    )
    while status.status == "accepted" || status.status == "running" {
      status = try await request(
        path: "/user-actions/\(status.actionId)?waitMs=15000",
        method: "GET",
        body: nil
      )
    }
    guard status.status == "succeeded" else {
      throw WatchAPIError.actionFailed(
        status.error?.message ?? "Action failed"
      )
    }
  }

  private func request<T: Decodable>(
    path: String,
    method: String,
    body: [String: Any]?
  ) async throws -> T {
    guard
      let base = URL(string: credentials.backendUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
      let url = URL(string: path, relativeTo: base)
    else { throw WatchAPIError.invalidURL }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 20
    request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw WatchAPIError.requestFailed }
    if http.statusCode == 401 { throw WatchAPIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else { throw WatchAPIError.requestFailed }
    return try JSONDecoder().decode(T.self, from: data)
  }
}

@MainActor
final class WatchModel: ObservableObject {
  @Published private(set) var status: WatchStatus?
  @Published private(set) var isLoading = false
  @Published var errorMessage: String?
  private var api: WatchAPI?
  private var statusReceivedAt = Date()

  func configure(_ credentials: WatchCredentials) {
    api = WatchAPI(credentials: credentials)
  }

  func refresh() async {
    guard let api, !isLoading else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      let nextStatus = try await api.status()
      let receivedAt = Date()
      status = nextStatus
      statusReceivedAt = receivedAt
      errorMessage = nil
      cacheForComplication(nextStatus, receivedAt: receivedAt)
    } catch {
      errorMessage = "Unable to sync"
    }
  }

  func run(_ operation: String, timerType: String?) async {
    guard let api else { return }
    do {
      try await api.action(operation, timerType: timerType)
      await refresh()
    } catch WatchAPIError.actionFailed(let message) {
      errorMessage = message
    } catch {
      errorMessage = "Action failed"
    }
  }

  func complete(_ task: WatchTask) async {
    guard let api else { return }
    do {
      try await api.complete(task: task)
      await refresh()
    } catch WatchAPIError.actionFailed(let message) {
      errorMessage = message
    } catch {
      errorMessage = "Task not completed"
    }
  }

  func remainingMilliseconds(at date: Date) -> Double {
    guard let status, let timer = status.timer else { return 25 * 60 * 1_000 }
    guard timer.status == "running" else { return max(0, timer.remainingTime) }
    let delta = if let endsAtMs = timer.endsAtMs, status.serverNowMs > 0 {
      endsAtMs - status.serverNowMs
    } else {
      timer.remainingTime
    }
    let localEndsAt = statusReceivedAt.addingTimeInterval(delta / 1_000)
    return max(0, localEndsAt.timeIntervalSince(date) * 1_000)
  }

  private func cacheForComplication(_ status: WatchStatus, receivedAt: Date) {
    guard let defaults = UserDefaults(suiteName: "group.app.pomi.community") else { return }
    guard let timer = status.timer else {
      defaults.removeObject(forKey: "pomi.watch.status")
      WidgetCenter.shared.reloadAllTimelines()
      return
    }
    let delta = if let endsAtMs = timer.endsAtMs, status.serverNowMs > 0 {
      endsAtMs - status.serverNowMs
    } else {
      timer.remainingTime
    }
    let cache = WatchComplicationCache(
      type: timer.type,
      status: timer.status,
      remainingTime: timer.remainingTime,
      localEndsAtMs: timer.status == "running"
        ? receivedAt.timeIntervalSince1970 * 1_000 + delta
        : nil
    )
    defaults.set(try? JSONEncoder().encode(cache), forKey: "pomi.watch.status")
    WidgetCenter.shared.reloadAllTimelines()
  }
}

private struct WatchComplicationCache: Codable {
  let type: String
  let status: String
  let remainingTime: Double
  let localEndsAtMs: Double?
}

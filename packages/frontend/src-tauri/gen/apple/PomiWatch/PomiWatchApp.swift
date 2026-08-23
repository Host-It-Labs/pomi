import SwiftUI

@main
struct PomiWatchApp: App {
  @StateObject private var session = WatchSessionStore()
  @StateObject private var model = WatchModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(session)
        .environmentObject(model)
        .task(id: session.credentials?.token) {
          guard let credentials = session.credentials else { return }
          model.configure(credentials)
          await model.refresh()
        }
    }
  }
}

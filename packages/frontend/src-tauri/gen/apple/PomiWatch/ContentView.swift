import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var session: WatchSessionStore
  @EnvironmentObject private var model: WatchModel

  var body: some View {
    Group {
      if let credentials = session.credentials {
        TabView {
          TimerView(username: credentials.username)
          TaskListView()
        }
        .tabViewStyle(.verticalPage)
      } else {
        PairingView()
      }
    }
    .tint(.indigo)
  }
}

private struct PairingView: View {
  @EnvironmentObject private var session: WatchSessionStore

  var body: some View {
    VStack(spacing: 10) {
      Image("PomiLogo")
        .resizable()
        .scaledToFit()
        .frame(width: 42, height: 42)
        .accessibilityHidden(true)
      Text("Open Pomi on iPhone")
        .font(.headline)
        .multilineTextAlignment(.center)
      Text("Sign in there, then your watch will connect automatically.")
        .font(.caption2)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
      Button("Try again") { session.requestSession() }
        .buttonStyle(.borderedProminent)
        .font(.caption)
    }
    .padding()
  }
}

private struct TimerView: View {
  @EnvironmentObject private var model: WatchModel
  let username: String

  var body: some View {
    ScrollView {
      VStack(spacing: 10) {
        Text(model.status?.timer?.type.capitalized ?? "Ready")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(.secondary)
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text(remaining(at: context.date))
            .font(.system(size: 34, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .minimumScaleFactor(0.7)
        }
        controls
        if let message = model.errorMessage {
          Text(message).font(.caption2).foregroundStyle(.red)
        }
      }
      .padding(.horizontal, 6)
    }
    .refreshable { await model.refresh() }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(15))
        await model.refresh()
      }
    }
  }

  @ViewBuilder
  private var controls: some View {
    let timer = model.status?.timer
    if timer == nil {
      Button {
        Task { await model.run("createOrResume", timerType: "work") }
      } label: {
        Label("Focus", systemImage: "play.fill")
      }
      .buttonStyle(.borderedProminent)
    } else if let timer {
      HStack {
        Button {
          Task {
            await model.run(
              timer.status == "paused" ? "createOrResume" : "pause",
              timerType: timer.status == "paused" ? timer.type : nil
            )
          }
        } label: {
          Image(systemName: timer.status == "paused" ? "play.fill" : "pause.fill")
        }
        .buttonStyle(.borderedProminent)
        Button(role: .destructive) {
          Task { await model.run("skip", timerType: nil) }
        } label: {
          Image(systemName: "forward.end.fill")
        }
      }
    }
  }

  private func remaining(at date: Date) -> String {
    let milliseconds = model.remainingMilliseconds(at: date)
    let seconds = Int(milliseconds / 1000)
    return String(format: "%02d:%02d", seconds / 60, seconds % 60)
  }
}

private struct TaskListView: View {
  @EnvironmentObject private var model: WatchModel

  var body: some View {
    NavigationStack {
      List(model.status?.tasks ?? []) { task in
        Button {
          Task { await model.complete(task) }
        } label: {
          HStack {
            Text(task.title).lineLimit(2)
            Spacer()
            Image(systemName: "circle")
              .foregroundStyle(task.isOverdue == true ? .red : .secondary)
          }
        }
      }
      .overlay {
        if model.status?.tasks.isEmpty != false {
          ContentUnavailableView("No focus tasks", systemImage: "checkmark.circle")
        }
      }
      .navigationTitle("Tasks")
    }
  }
}

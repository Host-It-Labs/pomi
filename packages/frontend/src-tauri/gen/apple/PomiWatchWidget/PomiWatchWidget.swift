import SwiftUI
import WidgetKit

private struct PomiEntry: TimelineEntry {
  let date: Date
  let title: String
  let remaining: TimeInterval?
}

private struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> PomiEntry {
    PomiEntry(date: .now, title: "Focus", remaining: 25 * 60)
  }

  func getSnapshot(in context: Context, completion: @escaping (PomiEntry) -> Void) {
    completion(entry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<PomiEntry>) -> Void) {
    completion(Timeline(entries: [entry()], policy: .after(.now.addingTimeInterval(60))))
  }

  private func entry() -> PomiEntry {
    guard
      let data = UserDefaults(suiteName: "group.app.pomi.community")?.data(forKey: "pomi.watch.status"),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return PomiEntry(date: .now, title: "Pomi", remaining: nil) }
    let type = (json["type"] as? String)?.capitalized ?? "Focus"
    let status = json["status"] as? String
    let storedRemaining = json["remainingTime"] as? Double ?? 0
    let localEndsAtMs = json["localEndsAtMs"] as? Double
    let remaining: Double
    if status == "running", let localEndsAtMs {
      remaining = max(0, localEndsAtMs - Date.now.timeIntervalSince1970 * 1_000)
    } else {
      remaining = storedRemaining
    }
    return PomiEntry(date: .now, title: type, remaining: remaining / 1_000)
  }
}

private struct PomiComplicationView: View {
  let entry: PomiEntry

  var body: some View {
    VStack(spacing: 1) {
      Image(systemName: "timer").foregroundStyle(.indigo)
      if let remaining = entry.remaining {
        Text(String(format: "%02d:%02d", Int(remaining) / 60, Int(remaining) % 60))
          .font(.system(.caption2, design: .rounded, weight: .semibold))
          .monospacedDigit()
      } else {
        Text(entry.title).font(.caption2.weight(.semibold))
      }
    }
    .containerBackground(.fill.tertiary, for: .widget)
  }
}

@main
struct PomiWatchWidget: Widget {
  let kind = "PomiWatchWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: Provider()) { entry in
      PomiComplicationView(entry: entry)
    }
    .configurationDisplayName("Pomi Focus")
    .description("See your active focus timer at a glance.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
  }
}

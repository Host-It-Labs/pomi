import ActivityKit
import SwiftUI
import WidgetKit

@available(iOSApplicationExtension 16.1, *)
@main
struct PomiLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PomiLiveActivityAttributes.self) { context in
            PomiLiveActivityLockScreenView(context: context)
                .widgetURL(URL(string: context.state.deepLink))
                .activityBackgroundTint(Color(red: 0.02, green: 0.09, blue: 0.07))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.emoji ?? context.state.timerType.symbol)
                        .font(.title2)
                }
                DynamicIslandExpandedRegion(.center) {
                    PomiLiveActivityTimerText(state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PomiLiveActivityActionLinks(actions: context.state.actions)
                }
            } compactLeading: {
                Text(context.state.emoji ?? context.state.timerType.symbol)
            } compactTrailing: {
                PomiLiveActivityTimerText(state: context.state, compact: true)
            } minimal: {
                Text(context.state.emoji ?? context.state.timerType.symbol)
            }
            .widgetURL(URL(string: context.state.deepLink))
        }
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct PomiLiveActivityLockScreenView: View {
    let context: ActivityViewContext<PomiLiveActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(context.state.emoji ?? context.state.timerType.symbol)
                    .font(.title2)
                Text(context.state.timerType.displayName)
                    .font(.headline)
                Spacer()
                Text("Pomi")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            if let title = context.state.intentionTitle {
                HStack(spacing: 6) {
                    if let intentionEmoji = context.state.intentionEmoji {
                        Text(intentionEmoji)
                    }
                    Text(title)
                        .lineLimit(1)
                }
                .font(.subheadline)
            }

            PomiLiveActivityTimerText(state: context.state)
                .font(.system(size: 34, weight: .semibold, design: .rounded))
                .monospacedDigit()

            PomiLiveActivityActionLinks(actions: context.state.actions)
        }
        .padding()
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct PomiLiveActivityTimerText: View {
    let state: PomiLiveActivityAttributes.ContentState
    var compact = false

    var body: some View {
        Group {
            if state.status == .running, let deadline = state.absoluteDeadline {
                Text(deadline, style: .timer)
            } else if let remaining = state.pausedRemainingSeconds {
                Text(PomiLiveActivityFormat.duration(remaining))
            } else {
                Text("—")
            }
        }
        .font(compact ? .caption2 : .body)
        .monospacedDigit()
        .foregroundStyle(.primary)
    }
}

@available(iOSApplicationExtension 16.1, *)
private struct PomiLiveActivityActionLinks: View {
    let actions: [PomiTimerAction]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(actions.prefix(4)) { action in
                if let url = URL(string: action.deepLink) {
                    Link(destination: url) {
                        Label(action.kind.displayName, systemImage: action.kind.systemImageName)
                            .labelStyle(.titleAndIcon)
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                    }
                    .tint(action.isSupported ? .white : .secondary)
                }
            }
        }
    }
}

private enum PomiLiveActivityFormat {
    static func duration(_ seconds: Int) -> String {
        let safeSeconds = max(0, seconds)
        let minutes = safeSeconds / 60
        let remainder = safeSeconds % 60
        return String(format: "%d:%02d", minutes, remainder)
    }
}

import Foundation

public enum PomiTimerStatus: String, Codable, Hashable, Sendable {
    case running
    case paused
}

public enum PomiTimerType: String, Codable, Hashable, Sendable {
    case work
    case `break`
    case longBreak

    public var displayName: String {
        switch self {
        case .work:
            return "Work"
        case .break:
            return "Break"
        case .longBreak:
            return "Long break"
        }
    }

    public var symbol: String {
        switch self {
        case .work:
            return "🎯"
        case .break:
            return "☕️"
        case .longBreak:
            return "🌿"
        }
    }
}

public enum PomiTimerTitlePrivacy: String, Codable, Hashable, Sendable {
    case `private`
    case publicTitle = "public"
}

public enum PomiTimerActionKind: String, Codable, Hashable, Sendable {
    case pause
    case resume
    case addFive = "addFive"
    case skip

    public var displayName: String {
        switch self {
        case .pause:
            return "Pause"
        case .resume:
            return "Resume"
        case .addFive:
            return "+5 min"
        case .skip:
            return "Skip"
        }
    }

    public var systemImageName: String {
        switch self {
        case .pause:
            return "pause.fill"
        case .resume:
            return "play.fill"
        case .addFive:
            return "plus"
        case .skip:
            return "forward.fill"
        }
    }
}

public struct PomiIntentionDisplay: Codable, Hashable, Sendable {
    public let emoji: String?
    public let title: String?
    public let titlePrivacy: PomiTimerTitlePrivacy

    public init(
        emoji: String?,
        title: String?,
        titlePrivacy: PomiTimerTitlePrivacy
    ) {
        self.emoji = emoji
        self.title = title
        self.titlePrivacy = titlePrivacy
    }

    /// The only title value allowed into ActivityKit state or widget rendering.
    public var privacySafeTitle: String? {
        guard titlePrivacy == .publicTitle else { return nil }
        let normalized = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !normalized.isEmpty else { return nil }
        return String(normalized.prefix(80))
    }
}

public struct PomiTimerAction: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let kind: PomiTimerActionKind
    public let expectedTimerRevision: String
    public let isSupported: Bool
    public let deepLink: String

    public var isValidPomiDeepLink: Bool {
        URL(string: deepLink)?.scheme == "pomi"
    }

    public init(
        id: String,
        kind: PomiTimerActionKind,
        expectedTimerRevision: String,
        isSupported: Bool,
        deepLink: String
    ) {
        self.id = id
        self.kind = kind
        self.expectedTimerRevision = expectedTimerRevision
        self.isSupported = isSupported
        self.deepLink = deepLink
    }
}

/// Versioned, backend-confirmed Timer data shared by the app bridge and widget.
///
/// A running Timer has an absolute deadline. A paused Timer deliberately carries
/// no moving deadline and instead carries its confirmed remaining seconds. This
/// prevents a paused activity from displaying a countdown that advances locally.
public struct PomiTimerProjection: Codable, Hashable, Sendable {
    public static let currentVersion = 1

    public let version: Int
    public let timerID: String
    public let timerRevision: String
    public let status: PomiTimerStatus
    public let timerType: PomiTimerType
    public let emoji: String?
    public let absoluteDeadline: Date?
    public let pausedRemainingSeconds: Int?
    public let intention: PomiIntentionDisplay?
    public let actions: [PomiTimerAction]
    public let deepLink: String

    public init(
        version: Int,
        timerID: String,
        timerRevision: String,
        status: PomiTimerStatus,
        timerType: PomiTimerType,
        emoji: String?,
        absoluteDeadline: Date?,
        pausedRemainingSeconds: Int?,
        intention: PomiIntentionDisplay?,
        actions: [PomiTimerAction],
        deepLink: String
    ) {
        self.version = version
        self.timerID = timerID
        self.timerRevision = timerRevision
        self.status = status
        self.timerType = timerType
        self.emoji = emoji
        self.absoluteDeadline = absoluteDeadline
        self.pausedRemainingSeconds = pausedRemainingSeconds
        self.intention = intention
        self.actions = actions
        self.deepLink = deepLink
    }

    public var isSupportedVersion: Bool {
        version == Self.currentVersion
    }

    public var privacySafeTitle: String? {
        intention?.privacySafeTitle
    }

    public var isValidPomiDeepLink: Bool {
        URL(string: deepLink)?.scheme == "pomi"
    }
}

#if canImport(ActivityKit)
import ActivityKit

@available(iOSApplicationExtension 16.1, *)
public struct PomiLiveActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public let version: Int
        public let timerRevision: String
        public let status: PomiTimerStatus
        public let timerType: PomiTimerType
        public let emoji: String?
        public let intentionEmoji: String?
        public let intentionTitle: String?
        public let absoluteDeadline: Date?
        public let pausedRemainingSeconds: Int?
        public let actions: [PomiTimerAction]
        public let deepLink: String

        public init(projection: PomiTimerProjection) {
            self.version = projection.version
            self.timerRevision = projection.timerRevision
            self.status = projection.status
            self.timerType = projection.timerType
            self.emoji = projection.emoji
            self.intentionEmoji = projection.intention?.emoji
            self.intentionTitle = projection.privacySafeTitle
            self.absoluteDeadline = projection.absoluteDeadline
            self.pausedRemainingSeconds = projection.pausedRemainingSeconds
            self.actions = projection.actions
            self.deepLink = projection.deepLink
        }
    }

    public let timerID: String

    public init(timerID: String) {
        self.timerID = timerID
    }
}
#endif

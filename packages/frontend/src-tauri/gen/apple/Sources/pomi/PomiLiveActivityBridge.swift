import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
@MainActor
@objc(PomiLiveActivityBridge)
public final class PomiLiveActivityBridge: NSObject {
    @objc public static let shared = PomiLiveActivityBridge()

    private var activeActivity: Activity<PomiLiveActivityAttributes>?
    private var pushTokenTasks: [String: Task<Void, Never>] = [:]

    @objc(setProjectionWithProjectionJSON:completion:)
    public func setProjection(
        projectionJSON: String,
        completion: @escaping (String?, NSError?) -> Void
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let projection = try self.decode(projectionJSON)
                if let activity = self.currentActivity(for: projection.timerID) {
                    let state = try self.contentState(for: projection)
                    if #available(iOS 16.2, *) {
                        await activity.update(
                            ActivityContent(
                                state: state,
                                staleDate: projection.absoluteDeadline
                            )
                        )
                    } else {
                        await activity.update(using: state)
                    }
                    self.activeActivity = activity
                    completion(activity.id, nil)
                } else {
                    let activity = try await self.start(projection: projection)
                    completion(activity.id, nil)
                }
            } catch {
                completion(nil, self.bridgeError(error))
            }
        }
    }

    /// Starts one activity from a JSON projection using ISO-8601 dates.
    @objc(startActivityWithProjectionJSON:completion:)
    public func startActivity(
        projectionJSON: String,
        completion: @escaping (String?, NSError?) -> Void
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let projection = try self.decode(projectionJSON)
                let activity = try await self.start(projection: projection)
                completion(activity.id, nil)
            } catch {
                completion(nil, self.bridgeError(error))
            }
        }
    }

    /// Updates the current activity only when it still represents the same Timer.
    @objc(updateActivityWithProjectionJSON:completion:)
    public func updateActivity(
        projectionJSON: String,
        completion: @escaping (NSError?) -> Void
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let projection = try self.decode(projectionJSON)
                guard let activity = self.currentActivity(for: projection.timerID) else {
                    throw BridgeError.activityNotFound
                }
                let state = try self.contentState(for: projection)
                if #available(iOS 16.2, *) {
                    await activity.update(
                        ActivityContent(
                            state: state,
                            staleDate: projection.absoluteDeadline
                        )
                    )
                } else {
                    await activity.update(using: state)
                }
                completion(nil)
            } catch {
                completion(self.bridgeError(error))
            }
        }
    }

    /// Ends the current Timer surface immediately, including after logout/opt-out.
    @objc(endActivityWithCompletion:)
    public func endActivity(completion: @escaping (NSError?) -> Void) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard !self.allActivities.isEmpty else {
                completion(nil)
                return
            }
            for activity in self.allActivities {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(using: nil, dismissalPolicy: .immediate)
                }
                self.cancelPushTokenTask(for: activity.id)
            }
            self.activeActivity = nil
            completion(nil)
        }
    }

    /// Delivers the activity-specific push token as lowercase hexadecimal.
    /// Callers can forward this token to the backend only after device opt-in.
    @objc(registerPushTokenWithCompletion:)
    public func registerPushToken(
        completion: @escaping (String?, NSError?) -> Void
    ) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard let activity = self.activeActivity ?? Activity<PomiLiveActivityAttributes>.activities.first else {
                completion(nil, self.bridgeError(BridgeError.activityNotFound))
                return
            }

            do {
                for await tokenData in activity.pushTokenUpdates {
                    completion(tokenData.map { String(format: "%02x", $0) }.joined(), nil)
                    return
                }
                completion(nil, self.bridgeError(BridgeError.pushTokenUnavailable))
            }
        }
    }

    private func start(
        projection: PomiTimerProjection
    ) async throws -> Activity<PomiLiveActivityAttributes> {
        let state = try contentState(for: projection)

        for existing in allActivities {
            if #available(iOS 16.2, *) {
                await existing.end(nil, dismissalPolicy: .immediate)
            } else {
                await existing.end(using: nil, dismissalPolicy: .immediate)
            }
            cancelPushTokenTask(for: existing.id)
        }

        let activity: Activity<PomiLiveActivityAttributes>
        if #available(iOS 16.2, *) {
            activity = try Activity.request(
                attributes: PomiLiveActivityAttributes(timerID: projection.timerID),
                content: ActivityContent(
                    state: state,
                    staleDate: projection.absoluteDeadline
                ),
                pushType: .token
            )
        } else {
            activity = try Activity.request(
                attributes: PomiLiveActivityAttributes(timerID: projection.timerID),
                contentState: state,
                pushType: .token
            )
        }
        activeActivity = activity
        observePushToken(for: activity)
        return activity
    }

    private func contentState(
        for projection: PomiTimerProjection
    ) throws -> PomiLiveActivityAttributes.ContentState {
        guard projection.isSupportedVersion else {
            throw BridgeError.unsupportedProjectionVersion
        }
        guard !projection.timerID.isEmpty, projection.isValidPomiDeepLink else {
            throw BridgeError.invalidProjection
        }
        if projection.status == .running && projection.absoluteDeadline == nil {
            throw BridgeError.invalidProjection
        }
        if projection.status == .paused && projection.pausedRemainingSeconds == nil {
            throw BridgeError.invalidProjection
        }

        let actionIDs = projection.actions.map(\.id)
        guard Set(actionIDs).count == actionIDs.count,
              projection.actions.allSatisfy({
                  !$0.id.isEmpty &&
                  $0.expectedTimerRevision == projection.timerRevision &&
                  $0.isValidPomiDeepLink
              }) else {
            throw BridgeError.invalidProjection
        }

        return PomiLiveActivityAttributes.ContentState(projection: projection)
    }

    private func decode(_ projectionJSON: String) throws -> PomiTimerProjection {
        guard let data = projectionJSON.data(using: .utf8) else {
            throw BridgeError.invalidProjection
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(PomiTimerProjection.self, from: data)
    }

    private func currentActivity(
        for timerID: String
    ) -> Activity<PomiLiveActivityAttributes>? {
        allActivities.first(where: { $0.attributes.timerID == timerID })
    }

    private var allActivities: [Activity<PomiLiveActivityAttributes>] {
        var activities = Activity<PomiLiveActivityAttributes>.activities
        if let activeActivity,
           !activities.contains(where: { $0.id == activeActivity.id }) {
            activities.insert(activeActivity, at: 0)
        }
        return activities
    }

    private func observePushToken(
        for activity: Activity<PomiLiveActivityAttributes>
    ) {
        cancelPushTokenTask(for: activity.id)
        pushTokenTasks[activity.id] = Task { @MainActor in
            for await tokenData in activity.pushTokenUpdates {
                NotificationCenter.default.post(
                    name: .pomiLiveActivityPushToken,
                    object: nil,
                    userInfo: [
                        "activityID": activity.id,
                        "token": tokenData.map { String(format: "%02x", $0) }.joined()
                    ]
                )
            }
        }
    }

    private func cancelPushTokenTask(for activityID: String) {
        pushTokenTasks.removeValue(forKey: activityID)?.cancel()
    }

    private func bridgeError(_ error: Error) -> NSError {
        let message: String
        if let error = error as? BridgeError {
            message = error.localizedDescription
        } else {
            message = error.localizedDescription
        }
        return NSError(
            domain: "app.pomi.community.live-activity",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}

private enum BridgeError: LocalizedError {
    case activityNotFound
    case invalidProjection
    case pushTokenUnavailable
    case unsupportedProjectionVersion

    var errorDescription: String? {
        switch self {
        case .activityNotFound:
            return "No active Pomi Live Activity was found."
        case .invalidProjection:
            return "The Pomi Timer projection is invalid."
        case .pushTokenUnavailable:
            return "ActivityKit did not provide a push token."
        case .unsupportedProjectionVersion:
            return "The Pomi Timer projection version is unsupported."
        }
    }
}

@available(iOS 16.1, *)
public extension Notification.Name {
    static let pomiLiveActivityPushToken = Notification.Name(
        "PomiLiveActivityPushToken"
    )
}

#else

/// Availability-safe no-op surface for SDKs without ActivityKit.
@objc(PomiLiveActivityBridge)
public final class PomiLiveActivityBridge: NSObject {}

#endif

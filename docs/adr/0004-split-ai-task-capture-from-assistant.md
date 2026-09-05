# Split AI Task Capture From Assistant Voice

Desktop/mobile presentation decisions are superseded by [One warm workspace](0020-one-warm-workspace.md). Unrelated domain, Assistant, Wear, and confirmed-action decisions remain in force.

Pomi splits AI Task capture from Assistant voice while keeping both behind the internal backend/OpenRouter boundary. AI Task capture is available to Tasks users when app-level AI setup exists, even when Assistant voice is off; Assistant voice remains the recording surface for safe timer control and can route spoken Task requests through AI Task capture.

The shared AI usage budget is an optional per-user USD limit over a daily or monthly period in the user's local timezone, and an empty budget means unlimited use within OpenRouter account limits. Assistant voice may execute safe timer actions and AI Task capture in one recording, including starting work, break, or long-break timers with one or more existing intentions or sub-intentions, but it still does not execute reset, skip, complete, archive, settings, navigation, picker, or arbitrary UI commands.

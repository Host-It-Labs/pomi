# Assistant Uses OpenRouter Behind an Internal Pomi Boundary

Superseded in part by [ADR 0004](./0004-split-ai-task-capture-from-assistant.md) for AI Task capture scope, Assistant voice scope, and AI usage budget period. Superseded in part by [ADR 0005](./0005-persistent-ai-debug-logs.md) for debug-only persistence of Assistant and AI Task capture logs.
Superseded in part by [ADR 0008](./0008-shared-task-capture-policy.md) for shared Task interpretation, title cleanup, intention resolution, and safe fallback behavior.

Pomi's Assistant is an internal app capability, not an external assistant API. The frontend talks only to Pomi backend routes. The backend owns provider calls, safety filtering, command execution, cost tracking, and the OpenRouter API key.

Assistant voice supports these safe actions only: create a Task, start or resume a work timer, pause the timer, add 5 minutes, and start a long break. It does not execute reset, skip, complete, archive, settings, navigation, picker, or arbitrary UI commands. Natural-language Task capture creates a Task immediately and never creates new Intentions; ADR 0008 defines its current fallback behavior.

OpenRouter is the first provider because it can cover chat parsing, transcription, and text-to-speech from one backend integration. Admin settings choose the text, transcription, speech model, speech voice, and the per-user daily cost cap. The UI keeps the capability named Assistant so later providers can fit behind the same boundary.

The daily cap tracks metered transcription and chat parsing costs when OpenRouter returns `usage.cost`. Missing usage cost is allowed and logged without transcript or prompt content. Text-to-speech responses return audio bytes and are not counted toward the cap.

Assistant privacy rules are:

- Do not persist audio, transcripts, prompts, or model output.
- Log only status, cost, duration, and provider failure metadata.
- Store only the resulting Task data and the `assistant` creation source when a Task is created.

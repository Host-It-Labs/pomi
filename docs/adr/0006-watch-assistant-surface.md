# Watch Assistant Surface

Pomi watch work uses one portable surface model for Wear OS and watchOS: actual time at the top, Timer as the central face element, Assistant as the prominent right-side action, Timer control at the bottom, and Tasks on the left. Assistant is important but not the center; the center remains Timer state.

Wear OS can support a Pomi watch face, but face rendering is not the right place to run voice capture. The face should deep-link into a minimal Pomi watch app recording screen and start Assistant recording immediately. This keeps the experience fast while avoiding watch-face runtime limits and keeping microphone permission inside the app surface.

watchOS cannot provide a full third-party replacement watch face. It should use WidgetKit complications/widgets and a SwiftUI watch app with the same surface model and the same recording entry behavior.

Shared watch APIs and helpers are the portability boundary:

- `GET /watch/status` returns Timer, Assistant availability, compact Tasks, and timer-control affordances.
- `POST /user-actions` handles typed Watch mutations through the shared accepted-action lifecycle; Watch-specific HTTP and Socket.IO mutation routes are not retained.
- Desktop and Wear clients use the same durable prepare, queued commit, and direct speech-finalization phases defined by ADR 0012. Releases are coordinated; Pomi does not retain the previous single-request voice protocol for old app versions.
- `buildWatchFaceSurfaceModel()` keeps Timer centered and Assistant prominent but secondary for native clients.

Long recordings register one immutable ordered audio-hash manifest, then submit each in-memory chunk independently under the same preparation ID before the joined transcript enters the normal preparation phase. The backend checkpoints each completed chunk transcription in Redis by preparation ID, index, audio hash, and transcription model, so reconnects and partial failures resume without retranscribing earlier chunks. Checkpoints never contain audio and expire with the voice preparation. A provider may still charge for a request whose response is lost before Pomi can checkpoint it when that provider offers no idempotency key.

The first Wear OS implementation lives in the generated Android project as a standalone `:wear` module. It ships a native watch-app face surface, direct backend login, an Assistant recording activity, and a Tasks activity. It is not a system watch-face service; that can be added later with the Wear OS watch-face APIs after the app surface is validated on-device.

Assistant safety rules stay unchanged: voice may create a Task, start or resume a Timer, pause, add five minutes, or start a long break. It must not reset, skip, complete, archive, change settings, drive arbitrary navigation, or execute arbitrary UI commands.

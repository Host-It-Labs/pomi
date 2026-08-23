# Pomi

Pomi is a focus timer app where users run work and break timers and can label timers with intentions.

## Language

**Timer**:
A countdown for a work, break, or long-break period.
_Avoid_: Clock, generic countdown

**Intention**:
A user-defined label selected for a work, break, or long-break timer.
_Avoid_: Task, category, tag

**Intention slug**:
The title-derived unique handle for an Intention within one Timer type. Renaming an Intention regenerates its slug, adds the lowest available numeric suffix on collision, and moves all current and historical references to the new handle.
_Avoid_: Permanent intention ID, user-entered slug, stale alias

**Parent intention**:
An Intention that groups one or more active Sub-intentions. It cannot be selected without selecting one of those active Sub-intentions.
_Avoid_: Category, folder, standalone child label

**Allow linked Tasks**:
A Parent Intention setting, enabled by default, that controls Task links for its entire Parent/Sub-intention tree. Turning it off confirms and atomically unlinks existing Tasks into General Tasks; disabled trees remain available for Timers, statistics, and Intention management but are excluded from Task creation, editing, imports, Assistant capture, and destination description generation.
_Avoid_: Disable Intention, hide Intention, delete linked Tasks

**Sub-intention**:
An Intention that refines one Parent intention. A selected Sub-intention is recorded and shown with its Parent intention.
_Avoid_: Subtask, child task

**Favorite intention**:
An intention the user marks as a shortcut for Tasks view filtering. Favorite intentions appear as badges in the Tasks view, and choosing one filters active tasks to that intention.
_Avoid_: Task favorite, default intention

**Habit**:
An intention marked for daily completion. A habit is done for a user-local day once a timer for that intention is completed that day; a Parent intention with habit Sub-intentions is done only when all of those habit Sub-intentions are done.
_Avoid_: Task, checklist item, recurring task

**Task**:
A user-created action item whose completion is tracked separately from timer completion. A task may be unlinked or linked to one Intention and its Sub-intention, but it is not an Intention, Habit, or Sub-intention.
_Avoid_: To-do, checklist item, intention, habit

**List**:
A named collection of intentionally lightweight List items. A List has its own active, completed, and archived view, may be marked as a favorite, and supplies the default Vacation Coverage value for new items.
_Avoid_: Parent Intention, Task project, Task Timer type

**List item**:
A lightweight action item belonging to exactly one List. It supports title, due date, priority, Vacation Coverage, completion, and archive, but does not gain Task-only fields such as Timer type, Intention, recurrence, reminders, descriptions, or Pin state.
_Avoid_: Full Task, Sub-intention, checklist embedded in a Task

**Vacation Coverage item override**:
The item-level Vacation Coverage value stored on a Task or List item. New items inherit their selected Intention or List default until the user changes the editor toggle; later group-default changes do not overwrite direct item values, and Vacation setup derives partial selection from those stored values.
_Avoid_: Dynamic group-only setting, recurring-only coverage

**Task Timer type**:
The Work, Break, or Long break category assigned to a Task. Every Task has exactly one Task Timer type, with Work used when none is specified; it may link only to an Intention of the same type, and changing type clears an incompatible link with notice.
_Avoid_: Session type, task session, multi-type task

**Active task**:
A Task occurrence that has not been completed or archived. Active Tasks appear in the Tasks view and can appear in a matching Task Timer type surface.
_Avoid_: Open task, pending task

**Task completion undo**:
A brief inline recovery affordance shown after a task is marked done. It lets the user restore accidental completions before the task fully leaves active task surfaces.
_Avoid_: Timer action history, permanent completed task

**Task follow-up**:
A one-time action configured inside its Parent Task and generated when that Parent Task is completed. The generated Task stays visibly tied to its Parent context and preserves normal due-date, reminder, Vacation Coverage, completion, undo, and history behavior without becoming a standalone template, recurring Task, or pinnable Task.
_Avoid_: Follow-up template, independent Task, recurring follow-up, Pinned Task

**Archived task**:
A task removed from active task surfaces without being marked complete. Archived tasks preserve history and statistics, and archiving a recurring task stops its future occurrences.
_Avoid_: Deleted task, completed task

**Task archive**:
A review surface for tasks that are no longer active. It includes archived tasks and completed tasks that do not have an active recurring occurrence.
_Avoid_: Deleted task list, active task list

**Recurring task**:
A task with a recurrence pattern that keeps one active occurrence until it is completed or archived. Completing the current occurrence creates the next occurrence, and each occurrence has its own completion history; archiving stops future occurrences.
_Avoid_: Habit, repeating intention, scheduled intention

**Recurrence pattern**:
A calendar-style rule that defines how a recurring task produces future occurrences. A recurrence pattern can include repetition cadence and end conditions without changing past occurrences.
_Avoid_: Repeating due date, recurring due date, schedule text

**Recurrence anchor mode**:
A setting that controls how Pomi chooses the next due date after a recurring task is completed. It supports next future planned date by default and from-completion scheduling for rhythms that should move with actual completion.
_Avoid_: Recurrence date default, completion-only recurrence

**Task due date**:
A user-local date with an optional time of day by which a Task is expected to be done. Interactive Task creation applies the Default Task due date when no date is supplied; imports and direct API payloads may remain undated, and a non-recurring Task may later have its due date removed. A recurring Task uses its due date as the recurrence anchor, and a Task remains active after its due date until it is completed or archived.
_Avoid_: Expiration, expiry, deadline

**Default Task due date**:
A Task setting applied to interactive Task creation when the user supplies no due date. It defaults to Tomorrow and can be Off, Tomorrow, In one week, or a custom positive number of days; recurring AI Task capture still uses tomorrow when it needs a first recurrence anchor.
_Avoid_: Reminder default, forced deadline, import date

**Task priority**:
A low, normal, high, or urgent importance marker used to scan and order tasks. New tasks default to normal priority; notification settings choose which priorities receive due reminders, and selected urgent tasks can repeat their reminder at a configurable interval until they stop qualifying.
_Avoid_: Urgency, severity, rank

**Task reminder**:
A notification for a task due date or due time. Selected priorities receive one due reminder, before-due reminders are configurable, and date-only task reminders default to 10:00 in the user's local time.
_Avoid_: Urgent task alarm, timer notification

**Urgent reminder repeat**:
An optional repeated notification for a selected urgent task after its due reminder. It continues while the task remains overdue and eligible, with one repeat setting and interval shared across devices.
_Avoid_: Normal reminder, one-time notification

**Tasks view**:
The main app view for browsing, adding, editing, and reviewing Tasks. Active List items participate in the normal All, Work, and search results using Task due-date, priority, and creation ordering, with compact List identity metadata; they stay out of Break, Long break, and Intention-specific results. Selecting a List opens its dedicated active, completed, and archived view. When a Timer has Pinned Tasks, they appear above peer or general Tasks. New Tasks inherit the selected Intention or Sub-intention and selected Task Timer type filter; under All Timer types, a selected Intention supplies its type, while no Intention defaults to an unlinked Work Task.
_Avoid_: Timer submode, separate task window

**Tasks**:
The optional Pomi capability that enables the tasks view, minimized task view, task reminders, urgent reminder repeats, and task settings. Tasks are off by default for new users; disabling Tasks hides task UI and pauses task reminders while preserving task data, and when Tasks is not enabled Pomi can show a setup placeholder that starts first-task creation.
_Avoid_: To-dos, checklist, hidden task mode

**Tasks during breaks**:
An optional Tasks setting, off by default, that shows Task surfaces inside desktop and mobile Break and Long-break Timers. Turning it off hides those timer surfaces while Break and Long-break Tasks remain available in the Tasks view; Watch continues to expose Tasks for its current Timer type.
_Avoid_: Break mode, break-only Tasks, hidden break Tasks

**AI Task capture**:
The optional Pomi capability that turns typed or spoken natural language into one or more Tasks or List items, splitting distinct requested items when relevant. Typed capture, Task dictation, and Task requests inside Assistant voice use one shared interpretation policy: each meaningful source detail appears exactly once, with action wording in the title, recognized metadata in supported fields, and exact unresolved source fragments in the description; exact supplied List names route to that List, explicit unsupported List-item metadata returns actionable validation, explicit Task Timer type wording overrides creation context, and only existing confidently matched task-enabled Intentions of that type may be linked. AI Task capture is available to Tasks users when app-level AI setup exists, even if Assistant is not enabled.
_Avoid_: Assistant-only task creation, generated intention, AI mode

**Assistant**:
The optional Pomi voice capability that lets users control safe timer actions and route spoken Task requests through AI Task capture. Assistant availability depends on app-level voice setup and each user's Assistant preference.
_Avoid_: Gemini integration, external assistant, AI mode

**Assistant recording**:
An application-scoped voice capture session. Stop submits captured speech; Cancel discards it. In-app navigation and transient connection loss preserve capture, maximum duration or app backgrounding auto-Stop, and authentication loss cancels it.
_Avoid_: Timer-page recording, background microphone session, replayable recording

**AI-created Task**:
A Task created through AI Task capture. AI-created Tasks remain normal Tasks with a source marker that can be reviewed from active task surfaces.
_Avoid_: Assistant-created Task, imported task, generated intention, voice-only task

**Voice-created Task**:
A Task created directly from a spoken Assistant request after transcription and AI Task capture. Voice-created Tasks are distinct from Tasks created by typed AI Task capture or by dictating text into the Tasks view input.
_Avoid_: AI-created Task, dictated-input Task, imported task

**AI usage budget**:
An optional per-user USD cost limit shared by Assistant and AI Task capture over a daily or monthly period in the user's local timezone. An empty AI usage budget means unlimited use within the user's OpenRouter account limits.
_Avoid_: Daily cap, assistant-only cap, token limit

**Tasks placeholder**:
A prompt shown in task-capable timer surfaces when Tasks are unavailable. Its primary setup action enables Tasks and starts first-task creation; saying no closes the prompt while keeping the placeholder available, and dismissing with "don't show again" hides Tasks placeholders globally until the user changes the setting.
_Avoid_: Permanent empty panel, hidden task list

**Minimized task view**:
A compact, actionable Task surface available during Work Timers and, when enabled, Break and Long-break Timers in the expanded Timer view and optional minimized Timer task state. Users can add, complete, pin, unpin, or open a Task for editing; new Tasks inherit current mode and Timer type defaults, and the reserved area can show a setup placeholder when Tasks are unavailable.
_Avoid_: Task strip, task panel, focus queue, full task list

**Task editor**:
The shared modal for creating or editing a Task from the Tasks view or expanded Timer. Its Intention / List destination can create a lightweight List item or, after an explicit warning, atomically convert an existing unfocused Task while preserving a snapshot of Task-only state. The editor exposes Vacation Coverage directly and uses a fixed header, scrollable middle, and fixed action footer.
_Avoid_: Minimized task editor, separate edit page, timer-specific editor

**Intention-to-List conversion**:
An atomic conversion that archives the source Intention structure and creates Lists. A Parent with active Sub-intentions becomes one List per child and the Parent is removed from active Intentions; title collisions, focused Tasks, or legacy Tasks linked directly to that Parent abort the whole conversion before any partial or lossy change.
_Avoid_: Rename Intention, partial child conversion, delete Tasks

**Task order**:
The default ordering that treats overdue and upcoming tasks differently: overdue tasks sort by priority first as soon as their due instant passes; upcoming dated tasks sort by due date, due time, and then priority; undated tasks sort by priority and then newest creation time. Date-only tasks become overdue after their local due day ends. Users may switch task lists to creation-date order in either newest-first or oldest-first direction.
_Avoid_: Expiration order, manual-only order

**Manual Task position**:
An absolute slot chosen for one active Unpinned Task inside the unpinned default-order group. Top and bottom positions stay at the group edges, middle positions keep their slot while automatic Tasks change, pinning makes the position dormant, unpinning restores it, and completion or archive clears it.
_Avoid_: Pinned Task order, neighbor anchor, filtered-list order

**Intention-filtered tasks**:
The active Tasks linked to the current Timer Intention or selected Intention filter, followed by a dimmed preview of general Tasks after the matching Tasks have been shown. When a Sub-intention is selected, matching includes Tasks linked to that Sub-intention and Tasks linked only to its Parent Intention; when multiple Intentions are selected, the filter includes Tasks linked to any selected Intention or selected Sub-intention. Search is global across Work, Break, and Long break Tasks in every Task surface, with current-Intention matches ranked first and every other match afterward; within each relevance group, Pinned Tasks come first.
_Avoid_: Hidden tasks, current task list

**General task mode**:
The task list mode that ignores the current timer intention filter and uses the default due-first task order across active tasks. Users can switch from intention-filtered tasks to general task mode when they want the broader task list during a timer, and that mode is shared by the minimized task view and tasks view for the current timer.
_Avoid_: Unfiltered task dump, all tasks mode

**Pinned Task**:
An active Task attached to its Task Timer type, reappearing in every matching Timer until completed, archived, or unpinned. Each Timer type may have multiple Pinned Tasks ordered by pin time; unpinning and re-pinning moves a Task to the end. Pinning a linked Task may update Timer Intentions, while pinning an unlinked Task leaves Timer Intentions unchanged and does not bypass required Intention selection before a Work Timer can start.
_Avoid_: Focused task, selected task, current task

**Unpinned Task**:
A Task detached from Timer flow without being completed or archived. It remains active in Task lists.
_Avoid_: Archived task, completed task

**Task-driven intention update**:
The Timer Intention change caused by pinning a linked Task. If multi-intention timers are enabled, Pomi adds the Task's Intention; otherwise it offers to enable multi-intention timers and falls back to switching the Timer to the Task's Intention. Completing or unpinning a Task does not automatically remove its Intention from the Timer; pinning an unlinked Task does not change Timer Intentions.
_Avoid_: Hidden intention change, task category switch

**Task statistics**:
Current Task snapshots and historical Task activity. Overview counts active, recurring, overdue, undated, and Pinned Tasks. Activity counts created, completed, and archived events; completed activity can be filtered to all, on-time, or overdue dated completions. Task statistics are separate from intention statistics, which remain based on timer completion.
_Avoid_: Timer statistics, intention statistics

**Task settings**:
Controls for enabling Tasks, showing the minimized task view in the minimized timer state, and choosing whether pinning a linked Task switches Task surfaces to intention mode. Task reminder priorities and urgent reminder repeats live in notification settings; per-Task title, link, priority, due date, and recurrence remain Task fields.
_Avoid_: Task editor, timer settings, intention settings

**Daily count**:
The number of completed timers for an intention during the user's local calendar day.
_Avoid_: Server day count, UTC count

**Multi-intention timer**:
A timer labeled with more than one Intention, where each selected Parent intention may also have one selected Sub-intention. A multi-intention timer is still one Timer, not a group of timers.
_Avoid_: Multiple timers, task bundle, intention group

**Session**:
A configured sequence of work Timers that tracks the user's current position and may end with a long break.
_Avoid_: Timer group, streak, round

**Timer extension**:
Additional Work time attributed to the just-completed Work Timer and resolved from the following Break or Long-break context. It may log elapsed extension time or continue with more Work time; a Timer extension does not recursively create another extension opportunity.
_Avoid_: Break extension, recursive extension, ordinary plus-five

**Fixture marker**:
Versioned, fixture-specific database metadata that certifies a named development fixture was fully written and can use a constant-size startup health check.
_Avoid_: Seed date, fixture health scan, product-user state

**Session position**:
The current work Timer's place within a Session.
_Avoid_: Session dot, pomodoro number

**Session indicator**:
The compact control that shows Session position and total work Timers for a Session.
_Avoid_: Sessions page, session label

**Minimized timer view**:
The compact timer view with reduced controls.
_Avoid_: Collapsed view, minimize view

**Intentions picker**:
The control for choosing Intentions and Sub-intentions for the current timer. Choosing a Parent intention with active Sub-intentions requires choosing one of them.
_Avoid_: Intention menu, selection menu

**Count indicator**:
A small badge in the intentions picker that shows how often the displayed Intention or Sub-intention has been used today.
_Avoid_: Counter, usage bubble

**Timer action history**:
The ordered record of reversible user-triggered timer actions that can be undone or redone.
_Avoid_: Notification history, log history

**Undo alert**:
A small in-app notice that tells the user what timer action was undone or redone.
_Avoid_: Push notification, OS notification, timer completion notification

**In-app notification**:
A foreground banner shown inside Pomi for timer completion, warning, or reminder events.
_Avoid_: OS notification, push notification, undo alert

**In-app shortcut**:
A keyboard command that controls Pomi while the app window has focus.
_Avoid_: Global shortcut, system shortcut

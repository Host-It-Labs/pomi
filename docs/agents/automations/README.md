# Radar automation prompt backups

These files are the version-controlled recovery copies of the three active Codex
Radar automations. The Codex automation records remain the runtime schedules;
when a prompt changes, update its matching file here in the same change.

Prompt synchronization is manual in both directions. Editing a prompt in this
repository does not update the installed Codex automation, and editing an
installed automation does not update its Markdown backup. Before handing a
prompt change off for merge, update the matching installed automation directly,
then verify that its complete runtime prompt exactly matches the backup while
its schedule, model, environment, and notification settings remain unchanged.

Each backup records the stable automation ID, cadence, dedicated branch, and
complete runtime prompt. Machine-local project IDs and environment-file paths
remain in Codex and are intentionally not required to restore the prompt text.

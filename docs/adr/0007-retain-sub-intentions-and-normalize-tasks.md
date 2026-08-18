# Retain Sub-intentions and Normalize Tasks

Pomi retains Sub-intentions as children of Parent intentions. A Parent intention with active Sub-intentions is not a complete timer, Task, or log selection until one of its active children is selected; records keep the Parent and selected Sub-intention together. This rule applies in every client and server entry point, including Wear OS and its Tile.

The unmerged task-normalization migration keeps the hierarchy schema and existing child rows. It removes a Parent label from historical logs that lack a required Sub-intention, preserving other labels on a multi-intention log and deleting the log only when no labels remain. This is one migration-time cleanup, not a later cleanup when a child is created or reparented. Its removal of break and long-break Task categories is superseded by ADR 0011; the Sub-intention decisions remain active.

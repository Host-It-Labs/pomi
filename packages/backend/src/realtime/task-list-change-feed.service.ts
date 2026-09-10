import { Injectable } from '@nestjs/common';
import type { TaskListChange, TaskListChangeEnvelope } from '@pomi/shared';
import { DataSource } from 'typeorm';

const MAX_CHANGE_BATCH_SIZE = 500;

type ChangeRow = {
  revision: string;
  entityType: 'task' | 'list' | 'listItem';
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: Record<string, unknown> | null;
};

@Injectable()
export class TaskListChangeFeedService {
  private readonly publishedRevisions = new Map<string, number>();
  private readonly pendingReads = new Map<
    string,
    Promise<TaskListChangeEnvelope>
  >();

  constructor(private readonly dataSource: DataSource) {}

  async prime(userId: string): Promise<number> {
    const revision = await this.readCurrentRevision(userId);
    this.publishedRevisions.set(userId, revision);
    return revision;
  }

  async readSnapshot(userId: string) {
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      const tasks = await manager.query(
        `
            SELECT task.*,
              CASE WHEN parent."id" IS NULL THEN NULL
                ELSE jsonb_build_object('id', parent."id", 'title', parent."title")
              END AS "followUpParent"
            FROM "tasks" AS task
            LEFT JOIN "tasks" AS parent
              ON parent."id" = task."followUpSourceTaskId"
              AND parent."userId" = task."userId"
            WHERE task."userId" = $1
              AND task."status" = 'active'
              AND task."itemKind" IN ('task', 'followUp')
            ORDER BY task."dueDate", task."createdAt"
        `,
        [userId]
      );
      const lists = await manager.query(
        `SELECT * FROM "lists" WHERE "userId" = $1 AND "isArchived" = false`,
        [userId]
      );
      const listItems = await manager.query(
        `
            SELECT * FROM "tasks"
            WHERE "userId" = $1 AND "status" = 'active' AND "itemKind" = 'listItem'
            ORDER BY "createdAt"
        `,
        [userId]
      );
      const counters = await manager.query(
        `SELECT "revision" FROM "task_list_revision_counters" WHERE "userId" = $1`,
        [userId]
      );

      return {
        revision: Number(counters[0]?.revision ?? 0),
        tasks: tasks.map((task: Record<string, unknown>) =>
          this.toPublicTask(task)
        ),
        lists: lists.map((list: Record<string, unknown>) =>
          this.withIsoDates(list)
        ),
        listItems: listItems.map((item: Record<string, unknown>) =>
          this.toPublicListItem(item)
        ),
      };
    });
  }

  async readNextEnvelope(userId: string): Promise<TaskListChangeEnvelope> {
    const previous = this.pendingReads.get(userId);
    const next = (
      previous ? previous.catch(() => undefined) : Promise.resolve()
    ).then(() => this.readNextEnvelopeSerial(userId));
    this.pendingReads.set(userId, next);
    try {
      return await next;
    } finally {
      if (this.pendingReads.get(userId) === next)
        this.pendingReads.delete(userId);
    }
  }

  private async readNextEnvelopeSerial(
    userId: string
  ): Promise<TaskListChangeEnvelope> {
    const revision = await this.readCurrentRevision(userId);
    const fromRevision = this.publishedRevisions.get(userId);
    if (fromRevision === undefined) {
      this.publishedRevisions.set(userId, revision);
      return {
        fromRevision: revision,
        revision,
        resetRequired: true,
        changes: [],
      };
    }
    if (revision <= fromRevision) {
      return {
        fromRevision,
        revision: fromRevision,
        resetRequired: false,
        changes: [],
      };
    }

    const rows = (await this.dataSource.query(
      `
        SELECT "revision", "entityType", "entityId", "operation", "payload"
        FROM "task_list_changes"
        WHERE "userId" = $1 AND "revision" > $2 AND "revision" <= $3
        ORDER BY "revision"
        LIMIT $4
      `,
      [userId, fromRevision, revision, MAX_CHANGE_BATCH_SIZE]
    )) as ChangeRow[];
    const contiguous =
      rows.length === revision - fromRevision &&
      Number(rows[0]?.revision) === fromRevision + 1 &&
      Number(rows[rows.length - 1]?.revision) === revision;
    this.publishedRevisions.set(userId, revision);
    if (!contiguous) {
      return { fromRevision, revision, resetRequired: true, changes: [] };
    }

    const followUpParentIds = [
      ...new Set(
        rows
          .filter(row => row.entityType === 'task' && row.payload)
          .map(row => row.payload?.followUpSourceTaskId)
          .filter((id): id is string => typeof id === 'string')
      ),
    ];
    const followUpParents = followUpParentIds.length
      ? ((await this.dataSource.query(
          `SELECT "id", "title" FROM "tasks" WHERE "userId" = $1 AND "id" = ANY($2::uuid[])`,
          [userId, followUpParentIds]
        )) as Array<{ id: string; title: string }>)
      : [];
    const followUpParentsById = new Map(
      followUpParents.map(parent => [parent.id, parent])
    );

    return {
      fromRevision,
      revision,
      resetRequired: false,
      changes: rows.map(row => ({
        revision: Number(row.revision),
        entityType: row.entityType,
        entityId: row.entityId,
        operation: row.operation,
        payload:
          row.payload === null
            ? null
            : row.entityType === 'task'
              ? this.toPublicTask({
                  ...row.payload,
                  followUpParent:
                    followUpParentsById.get(
                      String(row.payload.followUpSourceTaskId ?? '')
                    ) ?? null,
                })
              : row.entityType === 'listItem'
                ? this.toPublicListItem(row.payload)
                : this.withIsoDates(row.payload),
      })) as TaskListChange[],
    };
  }

  private async readCurrentRevision(userId: string): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT "revision" FROM "task_list_revision_counters" WHERE "userId" = $1`,
      [userId]
    )) as Array<{ revision: string }>;
    return Number(rows[0]?.revision ?? 0);
  }

  private toPublicTask(task: Record<string, unknown>) {
    const {
      recurrenceSequenceIndex: _recurrenceSequenceIndex,
      lastReminderKey: _lastReminderKey,
      nextReminderAt: _nextReminderAt,
      reminderClaimToken: _reminderClaimToken,
      reminderClaimedUntil: _reminderClaimedUntil,
      lastUrgentReminderAt: _lastUrgentReminderAt,
      taskRestoreState: _taskRestoreState,
      lastVacationRunId: _lastVacationRunId,
      lastVacationShiftedOn: _lastVacationShiftedOn,
      ...publicTask
    } = task;
    return {
      ...this.withIsoDates(publicTask),
      followUpTaskId: null,
      followUpDefinition: task.followUpDefinition ?? null,
      followUpParent: task.followUpParent ?? null,
      itemKind: 'task',
    };
  }

  private toPublicListItem(item: Record<string, unknown>) {
    return this.withIsoDates({
      id: item.id,
      userId: item.userId,
      listId: item.listId,
      title: item.title,
      dueDate: item.dueDate,
      priority: item.priority,
      status: item.status,
      itemKind: 'listItem',
      vacationEligible: item.vacationEligible,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  private withIsoDates(row: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date
          ? key === 'dueDate'
            ? this.formatLocalDate(value)
            : value.toISOString()
          : value,
      ])
    );
  }

  private formatLocalDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

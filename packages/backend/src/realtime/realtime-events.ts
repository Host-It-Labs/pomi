import { Injectable } from '@nestjs/common';
import type { UserActionStatus } from '@pomi/shared';
import { Subject } from 'rxjs';

@Injectable()
export class RealtimeEvents {
  readonly onTasksUpdate = new Subject<{ userId: string }>();
  readonly onUserActionUpdate = new Subject<{
    userId: string;
    status: UserActionStatus;
  }>();

  emitTasksUpdate(userId: string) {
    this.onTasksUpdate.next({ userId });
  }

  emitUserActionUpdate(userId: string, status: UserActionStatus) {
    this.onUserActionUpdate.next({ userId, status });
  }
}

import {
  Inject,
  Logger,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isCorsOriginAllowed } from '../config/environment';
import { SOCKET_EVENTS, TIMER_TYPES } from '@pomi/shared';
import type { Timer, Preferences } from '@pomi/shared';
import { Namespace, Socket } from 'socket.io';
import { PreferencesService } from '../preferences/preferences.service';
import { RealtimeEvents } from '../realtime/realtime-events';
import { isTransientDependencyError } from '../logging/dependency-errors';
import { formatSafeError } from '../logging/sanitize-log';
import type { UserEntity } from '../users/users.entity';
import { UsersService } from '../users/users.service';
import { ClientNotificationEvent } from './timer-events';
import { TimerService } from './timer.service';

const MAX_SOCKET_EXPIRY_TIMEOUT_MS = 2_147_000_000;

type VerifiedSocketPayload = {
  sub: string;
  exp?: number;
};

@WebSocketGateway({
  cors: {
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allowed?: boolean) => void
    ) => {
      try {
        callback(null, isCorsOriginAllowed(origin));
      } catch (error) {
        callback(
          error instanceof Error
            ? error
            : new Error('Invalid CORS configuration')
        );
      }
    },
  },
  namespace: '/',
  path: '/socket.io',
})
export class TimerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Namespace;
  private readonly logger = new Logger(TimerGateway.name);
  private readonly userNamespaces = new Map<string, Set<Namespace>>();
  private readonly socketExpiryTimers = new WeakMap<
    Socket,
    ReturnType<typeof setTimeout>
  >();

  constructor(
    private timerService: TimerService,
    private jwtService: JwtService,
    private usersService: UsersService,
    @Inject(forwardRef(() => PreferencesService))
    private preferencesService: PreferencesService,
    private realtimeEvents: RealtimeEvents
  ) {
    this.timerService.onTimerUpdate.subscribe(update => {
      this.sendTimerUpdateToUser(update.userId, update.timer);
    });

    this.timerService.onClientNotification.subscribe(event => {
      this.sendClientNotificationToUser(event.userId, event);
    });

    this.timerService.onExtensionStateUpdate.subscribe(update => {
      this.sendExtensionStateToUser(update.userId, update.extensionState);
    });

    this.timerService.onTimerHistoryUpdate.subscribe(update => {
      this.sendTimerHistoryUpdateToUser(update.userId, {
        canUndo: update.canUndo,
        canRedo: update.canRedo,
        appliedAction: update.appliedAction,
      });
    });

    this.preferencesService.onPreferencesUpdate.subscribe(update => {
      this.sendPreferencesUpdateToUser(update.userId, update.preferences);
    });

    this.realtimeEvents.onTasksUpdate.subscribe(({ userId }) => {
      this.sendTasksUpdateToUser(userId);
    });

    this.realtimeEvents.onUserActionUpdate.subscribe(({ userId, status }) => {
      this.sendUserActionUpdateToUser(userId, status);
    });
  }

  async handleConnection(client: Socket) {
    let user: UserEntity;
    try {
      this.logger.log(
        `Client connected: ${client.id}`,
        new Date().toISOString()
      );
      user = await this.authorizeSocketUser(client);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.logger.warn('Socket connection rejected: authentication failed');
        this.notifySessionExpired(client);
      } else {
        this.reportConnectionFailure(client, error);
      }
      return;
    }

    try {
      const userId = user.id;
      client.data.userId = userId;
      const namespaces = this.userNamespaces.get(userId) ?? new Set();
      namespaces.add(client.nsp);
      this.userNamespaces.set(userId, namespaces);
      this.installSocketAuthorizationMiddleware(client);

      await client.join([
        this.userRoom(userId),
        this.userClientRoom(
          userId,
          this.isMobileClient(client) ? 'mobile' : 'desktop'
        ),
      ]);

      const hasPushToken = Boolean(user.fcmToken || user.apnToken);
      if (!hasPushToken) {
        this.logger.warn('Mobile connection has no push token');
        client.emit(SOCKET_EVENTS.PUSH_TOKEN_REQUIRED, {
          message:
            'Push notifications are not configured. Please register your device to receive notifications.',
        });
      }

      const [currentTimer, extensionState, initialHistoryStatus] =
        await Promise.all([
          this.timerService.getTimerByUserId(userId),
          this.timerService.getExtensionState(userId),
          this.timerService.getTimerHistoryStatus(userId),
        ]);

      let timer = currentTimer;
      let historyStatus = initialHistoryStatus;
      if (!timer) {
        timer = await this.timerService.createOrResumeTimer(userId, {
          type: TIMER_TYPES.WORK,
          startPaused: true,
        });
        historyStatus = await this.timerService.getTimerHistoryStatus(userId);
      }
      client.emit(SOCKET_EVENTS.TIMER_UPDATE, timer);

      client.emit(SOCKET_EVENTS.EXTENSION_STATE_UPDATE, extensionState ?? null);
      client.emit(SOCKET_EVENTS.TIMER_HISTORY_UPDATE, historyStatus);
      client.emit(SOCKET_EVENTS.SERVER_READY);
    } catch (error) {
      this.reportConnectionFailure(client, error);
    }
  }

  private reportConnectionFailure(client: Socket, error: unknown): void {
    if (isTransientDependencyError(error)) {
      this.logger.warn(
        `Socket connection dependency unavailable; disconnecting for retry (${formatSafeError(error)})`
      );
    } else {
      this.logger.error(error, undefined, TimerGateway.name);
    }
    client.disconnect();
  }

  handleDisconnect(client: Socket) {
    this.clearSocketExpiry(client);
    const userId = client.data?.userId as string | undefined;
    if (userId) {
      const namespaces = this.userNamespaces.get(userId);
      if (
        namespaces &&
        (client.nsp.adapter.rooms.get(this.userRoom(userId))?.size ?? 0) === 0
      ) {
        namespaces.delete(client.nsp);
        if (namespaces.size === 0) this.userNamespaces.delete(userId);
      }
    }
    this.logger.log(
      `Client disconnected: ${client.id}`,
      new Date().toISOString()
    );
  }

  private getUserIdFromSocket(client: Socket): string {
    if (typeof client.data?.userId === 'string') {
      return client.data.userId;
    }
    try {
      const decoded = this.verifySocketTokenPayload(client);
      this.scheduleSocketExpiry(client, decoded.exp);
      return decoded.sub;
    } catch (error) {
      this.logger.warn('Socket token rejected during authorization');
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Socket authorization failed');
    }
  }

  private verifySocketToken(client: Socket): string {
    try {
      const decoded = this.verifySocketTokenPayload(client);
      this.scheduleSocketExpiry(client, decoded.exp);
      return decoded.sub;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Socket authorization failed');
    }
  }

  private async authorizeSocketUser(client: Socket): Promise<UserEntity> {
    const userId = this.getUserIdFromSocket(client);
    const user = await this.usersService.findUserById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return user;
  }

  private verifySocketTokenPayload(client: Socket): VerifiedSocketPayload {
    const token = client.handshake.auth.token;
    if (!token) {
      throw new UnauthorizedException('No auth token provided');
    }

    const decoded = this.jwtService.verify<{
      sub?: unknown;
      exp?: unknown;
    }>(token);
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      typeof decoded.sub !== 'string' ||
      decoded.sub.length === 0
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      sub: decoded.sub,
      exp:
        typeof decoded.exp === 'number' && Number.isFinite(decoded.exp)
          ? decoded.exp
          : undefined,
    };
  }

  private scheduleSocketExpiry(client: Socket, expiresAtSeconds?: number) {
    if (expiresAtSeconds === undefined) {
      return;
    }

    this.clearSocketExpiry(client);
    const expiresAtMs = expiresAtSeconds * 1000;
    const schedule = () => {
      const remainingMs = expiresAtMs - Date.now();
      if (remainingMs <= 0) {
        this.socketExpiryTimers.delete(client);
        this.notifySessionExpired(client);
        return;
      }

      const timer = setTimeout(
        schedule,
        Math.min(remainingMs, MAX_SOCKET_EXPIRY_TIMEOUT_MS)
      );
      timer.unref?.();
      this.socketExpiryTimers.set(client, timer);
    };

    schedule();
  }

  private clearSocketExpiry(client: Socket) {
    const timer = this.socketExpiryTimers.get(client);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.socketExpiryTimers.delete(client);
  }

  private installSocketAuthorizationMiddleware(client: Socket): void {
    client.use(async (_event, next) => {
      try {
        const userId = this.verifySocketToken(client);
        if (client.data?.userId !== userId) {
          throw new UnauthorizedException('Socket identity changed');
        }
        if (!(await this.usersService.userExists(userId))) {
          throw new UnauthorizedException('User no longer exists');
        }
        next();
      } catch (error) {
        this.logger.warn(
          `Socket authorization failed. Disconnecting client ${client.id}`
        );
        if (error instanceof UnauthorizedException) {
          this.notifySessionExpired(client);
        } else {
          this.logger.error(error, undefined, TimerGateway.name);
          client.disconnect();
        }
        next(
          error instanceof UnauthorizedException
            ? error
            : new Error('Socket authorization temporarily unavailable')
        );
      }
    });
  }

  private notifySessionExpired(client: Socket): void {
    this.clearSocketExpiry(client);
    client.emit(SOCKET_EVENTS.SESSION_EXPIRED, {
      message: 'Your session has expired. Please sign in again.',
    });
    client.disconnect();
  }

  private sendTimerUpdateToUser(userId: string, timer: Timer) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.TIMER_UPDATE,
      timer
    );
  }

  private sendPreferencesUpdateToUser(
    userId: string,
    preferences: Preferences
  ) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.PREFERENCES_UPDATE,
      preferences
    );
  }

  private sendTasksUpdateToUser(userId: string) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.TASKS_UPDATE
    );
  }

  private sendUserActionUpdateToUser(
    userId: string,
    status: import('@pomi/shared').UserActionStatus
  ) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.USER_ACTION_UPDATE,
      status
    );
  }

  private sendTimerHistoryUpdateToUser(
    userId: string,
    status: {
      canUndo: boolean;
      canRedo: boolean;
      appliedAction?: {
        direction: 'undo' | 'redo';
        label: string;
        logEffect?: 'added' | 'removed' | 'restored' | 'updated';
      };
    }
  ) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.TIMER_HISTORY_UPDATE,
      status
    );
  }

  private isMobileClient(socket: Socket): boolean {
    return socket.handshake.headers['user-agent-mobile'] === 'true';
  }

  private sendClientNotificationToUser(
    userId: string,
    event: ClientNotificationEvent
  ) {
    this.emitToUserRoom(
      userId,
      this.userClientRoom(userId, 'mobile'),
      SOCKET_EVENTS.MOBILE_NOTIFICATION,
      event
    );
    this.emitToUserRoom(
      userId,
      this.userClientRoom(userId, 'desktop'),
      SOCKET_EVENTS.DESKTOP_NOTIFICATION,
      event
    );
  }

  private sendExtensionStateToUser(
    userId: string,
    extensionState: import('@pomi/shared').TimerExtensionState | null
  ) {
    this.emitToUserRoom(
      userId,
      this.userRoom(userId),
      SOCKET_EVENTS.EXTENSION_STATE_UPDATE,
      extensionState
    );
  }

  private emitToUserRoom(
    userId: string,
    room: string,
    event: string,
    payload?: unknown
  ) {
    const namespaces = this.userNamespaces.get(userId);
    const targets = namespaces?.size ? namespaces : new Set([this.server]);
    targets.forEach(namespace => {
      if (!namespace) return;
      if (payload === undefined) {
        namespace.to(room).emit(event);
        return;
      }
      namespace.to(room).emit(event, payload);
    });
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private userClientRoom(userId: string, client: 'mobile' | 'desktop') {
    return `${this.userRoom(userId)}:${client}`;
  }

  @SubscribeMessage(SOCKET_EVENTS.GET_CURRENT_TIMER)
  async handleGetCurrentTimer(@ConnectedSocket() client: Socket) {
    const userId = this.getUserIdFromSocket(client);
    const [timer, extensionState] = await Promise.all([
      this.timerService.getTimerByUserId(userId),
      this.timerService.getExtensionState(userId),
    ]);
    if (timer) client.emit(SOCKET_EVENTS.TIMER_UPDATE, timer);
    client.emit(SOCKET_EVENTS.EXTENSION_STATE_UPDATE, extensionState ?? null);
    return timer;
  }
}

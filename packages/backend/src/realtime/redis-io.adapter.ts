import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly baseClient: Redis
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = this.baseClient.duplicate();
    const subClient = this.baseClient.duplicate();
    try {
      await Promise.all([
        this.waitUntilReady(pubClient),
        this.waitUntilReady(subClient),
      ]);
    } catch (error) {
      pubClient.disconnect();
      subClient.disconnect();
      throw error;
    }

    this.pubClient = pubClient;
    this.subClient = subClient;
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterConstructor) {
      throw new Error('Redis Socket.IO adapter is not connected');
    }
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(
      [this.pubClient, this.subClient]
        .filter((client): client is Redis => client !== null)
        .map(async client => {
          try {
            await client.quit();
          } catch {
            client.disconnect();
          }
        })
    );
  }

  private waitUntilReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onReady = () => {
        client.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        client.off('ready', onReady);
        reject(error);
      };
      client.once('ready', onReady);
      client.once('error', onError);
    });
  }
}

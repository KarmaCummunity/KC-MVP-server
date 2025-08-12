// src/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const tlsEnabledEnv = process.env.REDIS_TLS === 'true';

        // Prefer internal networking in Railway when present
        const internalHost = process.env.REDIS_HOST || process.env.REDISHOST;
        const internalPort = process.env.REDIS_PORT || process.env.REDISPORT;
        const preferInternal = !!internalHost && /\.internal$/.test(internalHost);

        const commonOptions = {
          username: process.env.REDIS_USERNAME || process.env.REDISUSER || undefined,
          password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || undefined,
          connectTimeout: 15000,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
          reconnectOnError: (err: Error) => /READONLY|ETIMEDOUT|ECONNRESET/i.test(err.message),
          family: 4,
        } as const;

        if (preferInternal && internalPort) {
          const client = new Redis({
            host: internalHost,
            port: Number(internalPort),
            tls: tlsEnabledEnv ? {} : undefined,
            ...commonOptions,
          });
          attachRedisLogging(client, `redis://${internalHost}:${internalPort}`);
          return client;
        }

        // Prefer a single connection URL when available
        const redisUrl = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
        if (redisUrl) {
          let enableTls = tlsEnabledEnv;
          try {
            const parsed = new URL(redisUrl);
            const isRediss = parsed.protocol === 'rediss:';
            if (isRediss) enableTls = true;
          } catch (_) {
            // ignore parse errors – fall back to env flag only
          }

          const client = new Redis(redisUrl, {
            tls: enableTls ? {} : undefined,
            ...commonOptions,
          });
          attachRedisLogging(client, maskRedisUrl(redisUrl));
          return client;
        }

        if (!internalHost || !internalPort) {
          throw new Error('Missing Redis connection environment variables');
        }

        const client = new Redis({
          host: internalHost,
          port: Number(internalPort),
          tls: tlsEnabledEnv ? {} : undefined,
          ...commonOptions,
        });
        attachRedisLogging(client, `redis://${internalHost}:${internalPort}`);
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

function maskRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url.replace(/:(?:[^@/]+)@/, ':***@');
  }
}

function attachRedisLogging(client: Redis, target: string) {
  // eslint-disable-next-line no-console
  console.log(`[redis] connecting to ${target}`);
  client.on('connect', () => {
    // eslint-disable-next-line no-console
    console.log('[redis] socket connected');
  });
  client.on('ready', () => {
    // eslint-disable-next-line no-console
    console.log('[redis] ready');
  });
  client.on('end', () => {
    // eslint-disable-next-line no-console
    console.log('[redis] connection ended');
  });
  client.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[redis] error', err.message);
  });
}

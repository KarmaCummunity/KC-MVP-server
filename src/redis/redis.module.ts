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
        // Railway Redis may expose rediss:// or REDIS_TLS=true
        const tlsEnabledEnv = String(process.env.REDIS_TLS || process.env.REDIS_SSL || '').toLowerCase() === 'true';

        // Prefer internal networking in Railway when present
        const internalHost = process.env.REDIS_HOST || process.env.REDISHOST || process.env.UPSTASH_REDIS_HOST;
        const internalPort = process.env.REDIS_PORT || process.env.REDISPORT || process.env.UPSTASH_REDIS_PORT;
        const preferInternal = !!internalHost && /\.internal$/.test(internalHost);

        const commonOptions = {
          username: process.env.REDIS_USERNAME || process.env.REDISUSER || process.env.UPSTASH_REDIS_USERNAME || undefined,
          password: process.env.REDIS_PASSWORD || process.env.REDISPASSWORD || process.env.UPSTASH_REDIS_PASSWORD || undefined,
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

        // Debug: Log all Redis environment variables
        console.log('[DEBUG] Redis environment variables:');
        console.log('REDIS_URL:', process.env.REDIS_URL);
        console.log('REDIS_HOST:', process.env.REDIS_HOST);
        console.log('REDISHOST:', process.env.REDISHOST);
        console.log('REDIS_PORT:', process.env.REDIS_PORT);
        console.log('REDISPORT:', process.env.REDISPORT);
        console.log('REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '[SET]' : '[NOT SET]');

        // Prefer a single connection URL when available
        const redisUrl = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL || process.env.UPSTASH_REDIS_URL;
        console.log('[DEBUG] Final redisUrl:', redisUrl ? maskRedisUrl(redisUrl) : 'NOT FOUND');
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

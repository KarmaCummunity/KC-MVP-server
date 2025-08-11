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
        const tlsEnabled = process.env.REDIS_TLS === 'true';

        // Prefer a single connection URL when available
        const redisUrl = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
        if (redisUrl) {
          return new Redis(redisUrl, {
            password: process.env.REDIS_PASSWORD || undefined,
            tls: tlsEnabled ? {} : undefined,
          });
        }

        // Fallback to host/port. Support both underscore and Railway's no-underscore variants
        const host = process.env.REDIS_HOST || process.env.REDISHOST;
        const portEnv = process.env.REDIS_PORT || process.env.REDISPORT;

        if (!host || !portEnv) {
          throw new Error('Missing Redis connection environment variables');
        }

        return new Redis({
          host,
          port: Number(portEnv),
          password: process.env.REDIS_PASSWORD || undefined,
          tls: tlsEnabled ? {} : undefined,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

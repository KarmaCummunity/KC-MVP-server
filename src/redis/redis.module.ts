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
        if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
          throw new Error('Missing Redis connection environment variables');
        }

        return new Redis({
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
          password: process.env.REDIS_PASSWORD || undefined,
          tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

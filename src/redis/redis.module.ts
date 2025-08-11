import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (redisUrl) {
          return new Redis(redisUrl, {
            tls: process.env.NODE_ENV === 'production' ? {} : undefined,
          });
        }
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          password: process.env.REDIS_PASSWORD || undefined,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}



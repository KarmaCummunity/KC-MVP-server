import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const isRailwayInternal =
          process.env.REDISHOST &&
          process.env.REDISPORT &&
          process.env.REDISPASSWORD;

        if (isRailwayInternal) {
          console.log('🔌 Connecting to Redis via internal Railway network');
          return new Redis({
            host: process.env.REDISHOST,
            port: Number(process.env.REDISPORT),
            password: process.env.REDISPASSWORD,
          });
        }

        if (process.env.REDIS_URL) {
          console.log('🌐 Connecting to Redis via public URL');
          return new Redis(process.env.REDIS_URL, {
            tls: process.env.NODE_ENV === 'production' ? {} : undefined,
          });
        }

        console.log('💻 Connecting to local Redis');
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

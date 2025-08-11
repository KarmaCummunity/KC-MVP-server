import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = Number(process.env.REDIS_PORT || 6379);
        const password = process.env.REDIS_PASSWORD || undefined;

        return new Redis({
          host,
          port,
          password,
          // אל תשתמש ב-TLS כשאתה בתוך private network
          tls: undefined,
        });
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}

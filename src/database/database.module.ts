import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
          // Allow explicit control of SSL via env or URL
          const sslFlag = process.env.PG_SSL || process.env.POSTGRES_SSL;
          const sslEnabled =
            (sslFlag && /^(1|true|require)$/i.test(sslFlag)) || /sslmode=require/i.test(connectionString);

          const pool = new Pool({
            connectionString,
            ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
          });
          return pool;
        }
        const pool = new Pool({
          host: process.env.POSTGRES_HOST || 'localhost',
          port: Number(process.env.POSTGRES_PORT || 5432),
          user: process.env.POSTGRES_USER || 'kc',
          password: process.env.POSTGRES_PASSWORD || 'kc_password',
          database: process.env.POSTGRES_DB || 'kc_db',
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}



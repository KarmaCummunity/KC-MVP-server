// File overview:
// - Purpose: Provide a global PostgreSQL `Pool` via DI token `PG_POOL` with flexible env config (Railway/local).
// - Reached from: Imported by `AppModule` and any provider/controller injecting `PG_POOL`.
// - Env inputs: `DATABASE_URL` (preferred) or discrete POSTGRES_* / PG* vars and optional SSL flags.
// - Provides: `PG_POOL` provider; exports for use across the app.
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        // 1) Prefer a single DATABASE_URL (Railway Postgres addon exposes this)
        const connectionString = process.env.DATABASE_URL;
        if (connectionString) {
          const sslFlag = process.env.PG_SSL || process.env.POSTGRES_SSL || process.env.PGSSLMODE;
          const sslEnabled =
            (sslFlag && /^(1|true|require)$/i.test(sslFlag)) || /sslmode=require/i.test(connectionString);

          return new Pool({
            connectionString,
            ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
          });
        }

        // 2) Fall back to discrete env vars. Support both POSTGRES_* and PG* (Railway style)
        const host = process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost';
        const port = Number(process.env.POSTGRES_PORT || process.env.PGPORT || 5432);
        const user = process.env.POSTGRES_USER || process.env.PGUSER || 'kc';
        const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || 'kc_password';
        const database = process.env.POSTGRES_DB || process.env.PGDATABASE || 'kc_db';
        const sslFlag = process.env.PG_SSL || process.env.POSTGRES_SSL || process.env.PGSSLMODE;
        const sslEnabled = sslFlag ? /^(1|true|require)$/i.test(sslFlag) : false;

        return new Pool({
          host,
          port,
          user,
          password,
          database,
          ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
        });
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}



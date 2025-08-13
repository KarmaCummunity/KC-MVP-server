// File overview:
// - Purpose: NestJS bootstrap entrypoint to configure and start the HTTP server.
// - Reached from: Node process start (Railway/Docker), runs `bootstrap()`.
// - Provides: CORS configuration (origin from env), global ValidationPipe, loads dotenv.
// - Env inputs: PORT, CORS_ORIGIN and DB/Redis envs used indirectly by modules.
// - Downstream flow: Creates `AppModule` → loads controllers/modules for API routes.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as dotenv from 'dotenv';

async function bootstrap() {
  dotenv.config();
  const app = await NestFactory.create(AppModule, { cors: false });
  const port = Number(process.env.PORT || 3001);

  const corsOrigin = process.env.CORS_ORIGIN || '*';
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 Karma Community Nest Server running on port ${port}`);
}

bootstrap();



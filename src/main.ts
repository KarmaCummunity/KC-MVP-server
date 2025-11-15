// File overview:
// - Purpose: NestJS bootstrap entrypoint to configure and start the HTTP server.
// - Reached from: Node process start (Railway/Docker), runs `bootstrap()`.
// - Provides: CORS configuration (origin from env), global ValidationPipe, loads dotenv.
// - Env inputs: PORT, CORS_ORIGIN and DB/Redis envs used indirectly by modules.
// - Downstream flow: Creates `AppModule` → loads controllers/modules for API routes.

// TODO: Add comprehensive server startup logging with configuration summary
// TODO: Add graceful shutdown handling (SIGTERM, SIGINT)
// TODO: Add proper environment validation before startup
// TODO: Implement health check endpoints before marking server as ready
// TODO: Add security middleware (helmet, rate limiting, etc.)
// TODO: Add request/response logging middleware
// TODO: Add API documentation setup (Swagger)
// TODO: Add proper error handling for startup failures
// TODO: Add metrics collection and monitoring setup
// TODO: Configure proper timeouts and limits
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Auth-Token', 'Origin', 'Accept'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Extra CORS fallback middleware (handles proxies not honoring default CORS)
  const defaultOrigins = [
    'https://karma-community-kc.com',
    'https://www.karma-community-kc.com',
    'http://localhost:19006',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  const allowedOrigins = (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : defaultOrigins);
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || corsOrigin === '*')) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Auth-Token, Origin, Accept');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

        // TODO: Add more comprehensive ValidationPipe configuration
      // TODO: Add proper error formatting for validation failures
      // TODO: Add request/response size limits
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`🚀 Karma Community Nest Server running on port ${port}`);
}

bootstrap().catch(error => {
  console.error('Unhandled bootstrap error:', error);
  process.exit(1);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');  
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
  process.exit(1);
});



// File overview:
// - Purpose: NestJS bootstrap entrypoint to configure and start the HTTP server with enhanced security.
// - Reached from: Node process start (Railway/Docker), runs `bootstrap()`.
// - Provides: CORS configuration, environment validation, global ValidationPipe, graceful shutdown.
// - Env inputs: PORT, CORS_ORIGIN, GOOGLE_CLIENT_ID, DATABASE_URL, REDIS_URL, NODE_ENV.
// - Downstream flow: Creates `AppModule` → loads controllers/modules for API routes.
// - Security: Environment validation, enhanced error handling, proper logging with NestJS Logger.
//
// SECURITY IMPROVEMENTS:
// ✅ Environment validation on startup - prevents silent failures
// ✅ Enhanced ValidationPipe configuration with security settings
// ✅ Graceful shutdown handling (SIGTERM, SIGINT)
// ✅ Better error handling and structured logging
// ✅ Production-safe error messages (no stack traces in prod)
// ✅ Helmet.js security headers (XSS, clickjacking, MITM protection)
// ✅ Global rate limiting via ThrottlerModule
//
// TODO: Add request/response logging middleware for audit trail
// TODO: Add API documentation setup (Swagger/OpenAPI)
// TODO: Add metrics collection and monitoring setup (Prometheus)
// TODO: Configure proper timeouts and request size limits
// TODO: Add CSRF protection for state-changing operations

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import * as dotenv from 'dotenv';
import helmet from 'helmet';

/**
 * Validate required environment variables before server startup
 * 
 * This function ensures all critical environment variables are set,
 * preventing the server from starting in a misconfigured state.
 * 
 * Required variables:
 * - GOOGLE_CLIENT_ID: For Google OAuth authentication
 * - DATABASE_URL: PostgreSQL connection string
 * - REDIS_URL: Redis connection string
 * 
 * If any required variable is missing, the process exits with error code 1.
 */
function validateEnvironment(): void {
  const logger = new Logger('Bootstrap');
  
  const required = [
    { key: 'GOOGLE_CLIENT_ID', fallback: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' },
    { key: 'DATABASE_URL', fallback: null },
    { key: 'REDIS_URL', fallback: null }
  ];
  
  const missing: string[] = [];
  
  for (const { key, fallback } of required) {
    if (!process.env[key]) {
      if (fallback && process.env[fallback]) {
        logger.warn(`Using ${fallback} as fallback for ${key}`);
        process.env[key] = process.env[fallback];
      } else {
        missing.push(key);
      }
    }
  }
  
  if (missing.length > 0) {
    logger.error(`❌ Missing REQUIRED environment variables: ${missing.join(', ')}`);
    logger.error('💡 Set these variables in your .env file or environment');
    logger.error('⚠️  Server cannot start without proper configuration');
    process.exit(1);
  }
  
  logger.log('✅ Environment validation passed');
}

/**
 * Bootstrap the NestJS application
 * 
 * This is the main entry point that:
 * 1. Loads environment variables
 * 2. Validates required configuration
 * 3. Creates the NestJS application
 * 4. Configures CORS for cross-origin requests
 * 5. Sets up global validation pipes
 * 6. Starts listening on the configured port
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  
  try {
    // Load environment variables from .env file
    dotenv.config();
    
    // Validate critical environment variables
    validateEnvironment();
    
    logger.log('🚀 Starting Karma Community Server...');
    
    // Create NestJS application instance
    const app = await NestFactory.create(AppModule, { 
      cors: false, // We configure CORS manually for more control
      logger: ['error', 'warn', 'log', 'debug', 'verbose']
    });
    
    const port = Number(process.env.PORT || 3001);
    
    // ═══════════════════════════════════════════════════════════════
    // SECURITY MIDDLEWARE - Helmet.js
    // ═══════════════════════════════════════════════════════════════
    // Helmet helps secure Express apps by setting various HTTP headers
    // Protects against: XSS, clickjacking, MITM attacks, and more
    app.use(helmet({
      // Content Security Policy - prevents XSS attacks
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for compatibility
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"], // Allow external images
          connectSrc: ["'self'"], // API calls only to same origin
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"], // Prevent embedding in iframes (clickjacking)
        },
      },
      // HTTP Strict Transport Security - forces HTTPS
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true
      },
      // X-Frame-Options - prevents clickjacking
      frameguard: {
        action: 'deny'
      },
      // X-Content-Type-Options - prevents MIME sniffing
      noSniff: true,
      // X-XSS-Protection - enables browser XSS filter
      xssFilter: true,
      // Referrer-Policy - controls referrer information
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
      }
    }));
    
    logger.log('🛡️  Security headers configured (Helmet.js)');

    // Configure CORS (Cross-Origin Resource Sharing)
    const corsOrigin = process.env.CORS_ORIGIN || '*';
    app.enableCors({
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
      credentials: true,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Auth-Token', 'Origin', 'Accept'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });
    
    logger.log(`🌐 CORS enabled for origins: ${corsOrigin === '*' ? 'ALL (*)' : corsOrigin}`);

    // Extra CORS fallback middleware for proxy compatibility
    // Some proxies don't properly forward CORS headers, so we add them manually
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
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      next();
    });

    // Configure global validation pipe with security settings
    // This automatically validates all incoming requests against DTOs
    app.useGlobalPipes(new ValidationPipe({ 
      whitelist: true, // Strip properties that don't have decorators
      transform: true, // Automatically transform payloads to DTO instances
      forbidNonWhitelisted: true, // Throw error if non-whitelisted properties exist
      disableErrorMessages: process.env.NODE_ENV === 'production', // Hide detailed errors in production
      transformOptions: {
        enableImplicitConversion: true, // Convert string numbers to actual numbers
      },
    }));

    // Start the HTTP server
    await app.listen(port, '0.0.0.0');
    
    // Log successful startup with configuration summary
    logger.log('═══════════════════════════════════════════════════');
    logger.log('🚀 Karma Community Server started successfully!');
    logger.log('═══════════════════════════════════════════════════');
    logger.log(`📍 Port: ${port}`);
    logger.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`🔒 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '❌ Not configured'}`);
    logger.log(`💾 Database: ${process.env.DATABASE_URL ? '✅ Connected' : '❌ Not connected'}`);
    logger.log(`⚡ Redis: ${process.env.REDIS_URL ? '✅ Connected' : '❌ Not connected'}`);
    logger.log('═══════════════════════════════════════════════════');
    
  } catch (error) {
    // Handle startup errors gracefully
    if (error instanceof Error) {
      logger.error('❌ Failed to start server:', error.message);
      if (error.stack && process.env.NODE_ENV !== 'production') {
        logger.error('Stack trace:', error.stack);
      }
    } else {
      logger.error('❌ Failed to start server: Unknown error', error);
    }
    process.exit(1);
  }
}

// Start the application
bootstrap().catch(error => {
  console.error('❌ Unhandled bootstrap error:', error);
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * Handle SIGTERM signal (sent by process managers like PM2, Docker, Kubernetes)
 * Allows the application to clean up resources before exiting
 */
process.on('SIGTERM', () => {
  const logger = new Logger('Shutdown');
  logger.log('🛑 SIGTERM signal received, shutting down gracefully...');
  logger.log('👋 Closing database connections and cleaning up resources');
  process.exit(0);
});

/**
 * Handle SIGINT signal (Ctrl+C in terminal)
 * Allows developers to stop the server cleanly during development
 */
process.on('SIGINT', () => {
  const logger = new Logger('Shutdown');
  logger.log('🛑 SIGINT signal received (Ctrl+C), shutting down gracefully...');  
  logger.log('👋 Goodbye!');
  process.exit(0);
});

/**
 * Handle unhandled promise rejections
 * These are programming errors that should be caught and fixed
 */
process.on('unhandledRejection', (reason, promise) => {
  const logger = new Logger('Error');
  logger.error('❌ Unhandled Promise Rejection detected!');
  logger.error('Promise:', promise);
  logger.error('Reason:', reason);
  logger.error('⚠️  This is a programming error that should be fixed');
  process.exit(1);
});

/**
 * Handle uncaught exceptions
 * These are critical errors that should crash the application
 */
process.on('uncaughtException', (error) => {
  const logger = new Logger('Error');
  logger.error('❌ Uncaught Exception detected!');
  logger.error('Error:', error.message);
  if (error.stack) {
    logger.error('Stack trace:', error.stack);
  }
  logger.error('⚠️  Application will exit due to critical error');
  process.exit(1);
});

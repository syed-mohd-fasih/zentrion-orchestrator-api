import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { seedData } from './bootstrap/seed';

/**
 * Application entry point.
 *
 * Bootstraps the NestJS orchestrator API:
 *  - enables CORS for the dashboard origins
 *  - registers a global validation pipe (whitelist + transform)
 *  - seeds initial data (default users) into the database
 *  - starts the HTTP server (REST + WebSocket) on the configured port
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow the Next.js dashboard (dev ports) to call the API with credentials.
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  });

  // Strip unknown properties and reject payloads that carry them; also
  // coerce primitive types via class-transformer so DTOs arrive typed.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Idempotently seed default users (admin/analyst/viewer) on startup.
  await seedData(app);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Orchestrator API running on http://localhost:${port}`);
  console.log(`📡 WebSocket available at ws://localhost:${port}`);
}

bootstrap();

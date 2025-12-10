import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { seedData } from './bootstrap/seed';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS for dashboard
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  });

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Seed synthetic data
  await seedData(app);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Orchestrator API running on http://localhost:${port}`);
  console.log(`📡 WebSocket available at ws://localhost:${port}`);
}

bootstrap();

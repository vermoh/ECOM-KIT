import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Basic SEO: Global prefix and versioning
  app.setGlobalPrefix('api/v1');
  
  // Security: Handle CORS (should be strict in prod)
  app.enableCors({
    origin: process.env.WEB_ORIGIN || true,
  });
  
  // Validation: Global pipe for DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Control Plane API is running on: http://localhost:${port}/api/v1`);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:9020',
      'http://localhost:9010',
      'http://localhost:9030',
      'http://localhost:9040',
      'https://groperti.com',
      'https://agen.groperti.com',
      'https://partner.groperti.com',
      'https://affiliate.groperti.com',
      'https://admin.groperti.com',
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-token'],
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = process.env.PORT || 4881;
  await app.listen(port);
  console.log(`api-cdn-v1 running on port ${port}`);
}

bootstrap();

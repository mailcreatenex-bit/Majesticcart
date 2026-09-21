import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initEncryption } from './common/crypto';

/**
 * Bootstrap.
 *
 * Three settings here are load-bearing and easy to leave out.
 */
async function bootstrap() {
  const log = new Logger('bootstrap');

  // The monthly repurchase gate reads the calendar month. A container running
  // on UTC puts an order placed at 11pm IST on the 30th into the next month,
  // and a member who met their target is told they did not.
  //
  // A warning is easy to miss in a scrolling deploy log, and the failure it
  // predicts is silent — nobody sees a stack trace, they just see a member
  // wrongly told they missed their target. In production that trade is not
  // worth it, so this refuses to boot instead. Non-production environments
  // still only warn, so a laptop with an unset TZ can run the app.
  if (process.env.TZ !== 'Asia/Kolkata') {
    const message = `TZ is "${process.env.TZ ?? 'unset'}". Set TZ=Asia/Kolkata — monthly volume buckets depend on it.`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    log.warn(message);
  }

  // Validates FIELD_ENCRYPTION_KEY now. Discovering it is missing when the
  // first member saves a bank account means a 500 and a support call.
  initEncryption();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Without this, req.ip is the load balancer and every fraud signal, rate
  // limit and audit entry records the proxy instead of the member.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks(); // let in-flight commission jobs finish on deploy

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  log.log(`API listening on :${port}`);
}

bootstrap();

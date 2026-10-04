import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { ErrorService } from './error.service';

/**
 * Lets Nest answer every request exactly as it always did, and additionally
 * records server errors (an uncaught exception or any 5xx) for the admin's Errors
 * page. Expected failures (a wrong password, a validation message, a 404, a 403)
 * are not errors in this sense and are ignored.
 */
@Catch()
export class ErrorCaptureFilter extends BaseExceptionFilter {
  constructor(adapterHost: HttpAdapterHost, private readonly errors: ErrorService) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<{ method?: string; originalUrl?: string; url?: string }>();
      const e = exception instanceof Error ? exception : new Error(String(exception));
      // The path without its query string: a query can carry a phone number or a code.
      const path = `${req?.method ?? ''} ${(req?.originalUrl ?? req?.url ?? '').split('?')[0]}`.trim();
      void this.errors.record('api', { message: e.message || e.name, stack: e.stack, path, status });
    }
    super.catch(exception, host);
  }
}

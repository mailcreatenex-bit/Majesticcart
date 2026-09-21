import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validate a request body against a zod schema.
 *
 * Used instead of class-validator because the plan and report definitions are
 * already zod schemas — one validation library, and the same schema can be
 * shared with the frontend.
 *
 * Errors come back field-keyed so a form can highlight the offending input
 * rather than showing one generic message at the top.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException({
      message: 'Some fields need fixing.',
      fields: fieldErrors(result.error),
    });
  }
}

export const fieldErrors = (error: ZodError): Record<string, string> =>
  Object.fromEntries(error.issues.map((i) => [i.path.join('.') || '_', i.message]));

/** Shorthand: `@Body(zodBody(CheckoutSchema)) body: CheckoutInput` */
export const zodBody = <T>(schema: ZodSchema<T>) => new ZodValidationPipe(schema);

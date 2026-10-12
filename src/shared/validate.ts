import { z, type ZodType } from 'zod';
import { ValidationError } from './errors';

export const MAX_PAGE_SIZE = 100;

/** Shared pagination query fields: every list endpoint is bounded (OWASP API4). */
export const paginationShape = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
};

export const idParamSchema = z.strictObject({ id: z.uuid() });

/** Parses untrusted input; failures become a ValidationError listing field paths only (never values). */
export function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'Request validation failed',
      result.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
    );
  }
  return result.data;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export function paginate<T>(items: readonly T[], limit: number, offset: number): Page<T> {
  return { data: items.slice(offset, offset + limit), total: items.length, limit, offset };
}

import { z } from 'zod';
import { ValidationError } from '../../src/shared/errors';
import { idParamSchema, MAX_PAGE_SIZE, paginate, paginationShape, parseInput } from '../../src/shared/validate';

describe('parseInput', () => {
  const schema = z.strictObject({ name: z.string().min(2), nested: z.strictObject({ age: z.number() }).optional() });

  it('returns parsed data', () => {
    expect(parseInput(schema, { name: 'ok' })).toEqual({ name: 'ok' });
  });

  it('reports field paths and messages but never the submitted values', () => {
    let caught: unknown;
    try {
      parseInput(schema, { name: 'x', nested: { age: 'secret-value' } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const details = (caught as ValidationError).details ?? [];
    expect(details.map((detail) => detail.path).sort()).toEqual(['name', 'nested.age']);
    expect(JSON.stringify(details)).not.toContain('secret-value');
  });

  it('rejects unknown fields (mass assignment)', () => {
    expect(() => parseInput(schema, { name: 'ok', role: 'REGIONAL_MANAGER' })).toThrow(ValidationError);
  });
});

describe('idParamSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(idParamSchema.safeParse({ id: '11111111-1111-4111-8111-111111111111' }).success).toBe(true);
    expect(idParamSchema.safeParse({ id: '1; DROP TABLE tasks' }).success).toBe(false);
  });
});

describe('pagination', () => {
  const shape = z.strictObject(paginationShape);

  it('defaults to limit 50 / offset 0 and coerces query strings', () => {
    expect(shape.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(shape.parse({ limit: '10', offset: '5' })).toEqual({ limit: 10, offset: 5 });
  });

  it('rejects unbounded or negative values', () => {
    expect(shape.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(shape.safeParse({ limit: '0' }).success).toBe(false);
    expect(shape.safeParse({ offset: '-1' }).success).toBe(false);
  });

  it('slices a page and reports the total', () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 1)).toEqual({ data: [2, 3], total: 5, limit: 2, offset: 1 });
    expect(paginate([1], 10, 5)).toEqual({ data: [], total: 1, limit: 10, offset: 5 });
  });
});

import {
  AppError,
  ConfigurationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/shared/errors';

describe('AppError hierarchy', () => {
  it.each([
    [new ValidationError(), 'VALIDATION_ERROR', 400],
    [new UnauthorizedError(), 'UNAUTHORIZED', 401],
    [new ForbiddenError(), 'FORBIDDEN', 403],
    [new NotFoundError('Activity'), 'NOT_FOUND', 404],
    [new ConflictError('INVALID_STATUS_TRANSITION', 'nope'), 'INVALID_STATUS_TRANSITION', 409],
    [new ConfigurationError('bad'), 'CONFIGURATION_ERROR', 500],
  ])('%s maps to code %s and status %i', (error, code, statusCode) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(code);
    expect(error.statusCode).toBe(statusCode);
  });

  it('uses the subclass name and keeps the message', () => {
    const error = new NotFoundError('Programme');
    expect(error.name).toBe('NotFoundError');
    expect(error.message).toBe('Programme not found');
  });

  it('carries validation details', () => {
    const error = new ValidationError('bad input', [{ path: 'title', message: 'required' }]);
    expect(error.details).toEqual([{ path: 'title', message: 'required' }]);
  });

  it('has no details by default', () => {
    expect(new ForbiddenError().details).toBeUndefined();
  });
});

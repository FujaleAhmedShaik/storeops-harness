export interface ErrorDetail {
  readonly path: string;
  readonly message: string;
}

/** Base of the typed error hierarchy. Services and routes throw only subclasses of this. */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: readonly ErrorDetail[] | undefined;

  constructor(code: string, message: string, statusCode: number, details?: readonly ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: readonly ErrorDetail[]) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
  }
}

/** Business-rule conflict, e.g. an illegal status transition. The code names the rule. */
export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
  }
}

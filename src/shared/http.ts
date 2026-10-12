import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, NotFoundError, UnauthorizedError } from './errors';
import type { AuthUser } from './domain';
import type { Logger } from './logger';
import type { TokenService } from './token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Express 4 does not catch rejected promises; this forwards them to the error handler. */
export function asyncHandler(route: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    route(req, res, next).catch(next);
  };
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** Accepts a well-formed inbound X-Request-Id, otherwise generates one (prevents log injection). */
export const requestContext: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  const requestId = inbound !== undefined && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};

/** One structured line per request. Logs method, path and status only - no query string, headers or bodies. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info(
        { requestId: res.locals.requestId as string, method: req.method, path: req.path, status: res.statusCode, durationMs },
        'request completed',
      );
    });
    next();
  };
}

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)$/;

/** Verifies the bearer token and attaches the caller to the request. */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const match = BEARER_PATTERN.exec(req.header('authorization') ?? '');
    if (!match?.[1]) {
      throw new UnauthorizedError();
    }
    req.user = tokens.verify(match[1]);
    next();
  };
}

/** Returns the authenticated caller; routes behind `authenticate` always have one. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}

export const notFoundHandler: RequestHandler = () => {
  throw new NotFoundError('Route');
};

interface BodyParserError {
  readonly type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  return typeof error === 'object' && error !== null && typeof (error as BodyParserError).type === 'string';
}

/** Maps every failure to a safe JSON body. Unknown errors are logged server-side and never leaked. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _req, res, _next) => {
    const requestId = res.locals.requestId as string | undefined;
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
      return;
    }
    if (isBodyParserError(error) && error.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId } });
      return;
    }
    if (isBodyParserError(error) && error.type.startsWith('entity.')) {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON', requestId } });
      return;
    }
    logger.error({ err: error, requestId }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId } });
  };
}

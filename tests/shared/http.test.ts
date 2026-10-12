import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { authenticate, asyncHandler, currentUser, errorHandler, notFoundHandler, requestContext, requestLogger } from '../../src/shared/http';
import { createLogger } from '../../src/shared/logger';
import { TokenService } from '../../src/shared/token';
import { users } from '../helpers/fakes';

function capture(): { lines: () => Record<string, unknown>[]; logger: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      raw.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger('info', sink), lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('requestContext', () => {
  const app = express();
  app.use(requestContext);
  app.get('/', (_req, res) => {
    res.json({ requestId: res.locals.requestId as string });
  });

  it.each(['abc-12345678', 'a'.repeat(64), '12345678'])('keeps the well-formed id %s', async (id) => {
    const response = await request(app).get('/').set('X-Request-Id', id);
    expect(response.headers['x-request-id']).toBe(id);
    expect(response.body.requestId).toBe(id);
  });

  it.each(['short', 'a'.repeat(65), 'has space in it', 'trailing-junk!!', '!!leading-junk', 'semi;colon-12345'])(
    'replaces the malformed id %j with a generated uuid',
    async (id) => {
      const response = await request(app).get('/').set('X-Request-Id', id);
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    },
  );
});

describe('requestLogger', () => {
  it('logs one structured line per request with method, path, status and duration - but no query string or headers', async () => {
    const { logger, lines } = capture();
    const app = express();
    app.use(requestContext);
    app.use(requestLogger(logger));
    app.get('/things', (_req, res) => {
      res.status(201).json({});
    });

    await request(app).get('/things?secret=hunter2').set('Authorization', 'Bearer a.b.c').set('X-Request-Id', 'req-12345678');

    const [entry] = lines();
    expect(entry).toMatchObject({ msg: 'request completed', requestId: 'req-12345678', method: 'GET', path: '/things', status: 201 });
    expect(typeof entry?.durationMs).toBe('number');
    expect(entry?.durationMs as number).toBeGreaterThanOrEqual(0);
    expect(entry?.durationMs as number).toBeLessThan(5_000);
    expect(JSON.stringify(entry)).not.toMatch(/hunter2|Bearer/);
  });
});

describe('authenticate', () => {
  const tokens = new TokenService({ secret: 's'.repeat(48), issuer: 'i', audience: 'a', ttlSeconds: 600 });
  const { accessToken } = tokens.issue(users.manager);
  const app = express();
  app.use(requestContext);
  app.get('/me', authenticate(tokens), (req, res) => {
    res.json(currentUser(req));
  });
  app.get('/anonymous', (req, res) => {
    res.json(currentUser(req));
  });
  app.use(errorHandler(createLogger('silent')));

  it('attaches the verified caller', async () => {
    await request(app).get('/me').set('Authorization', `Bearer ${accessToken}`).expect(200, users.manager);
  });

  it.each([
    ['prefix junk', (token: string) => `x Bearer ${token}`],
    ['trailing junk', (token: string) => `Bearer ${token} extra`],
    ['trailing newline-ish junk', (token: string) => `Bearer ${token}!`],
    ['wrong scheme', (token: string) => `Token ${token}`],
    ['lowercase scheme', (token: string) => `bearer ${token}`],
    ['two spaces', (token: string) => `Bearer  ${token}`],
  ])('rejects %s', async (_label, build) => {
    await request(app).get('/me').set('Authorization', build(accessToken)).expect(401);
  });

  it('rejects a missing header', async () => {
    const response = await request(app).get('/me');
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe('Authentication required');
  });

  it('currentUser refuses to run without an authenticated caller', async () => {
    await request(app).get('/anonymous').expect(401);
  });
});

describe('errorHandler and notFoundHandler', () => {
  function appThatThrows(error: unknown, logger = createLogger('silent')): express.Express {
    const app = express();
    app.use(requestContext);
    app.get(
      '/boom',
      asyncHandler(async () => {
        await Promise.resolve();
        throw error;
      }),
    );
    app.use(notFoundHandler);
    app.use(errorHandler(logger));
    return app;
  }

  it('maps body-parser errors by type', async () => {
    const tooLarge = await request(appThatThrows({ type: 'entity.too.large' })).get('/boom');
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });

    const badJson = await request(appThatThrows({ type: 'entity.parse.failed' })).get('/boom');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toMatchObject({ code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
  });

  it.each([
    ['an unrelated typed object', { type: 'something.else' }],
    ['a non-string type', { type: 42 }],
    ['an object without a type', { message: 'x' }],
    ['a string', 'entity.parse.failed'],
  ])('treats %s as an internal error', async (_label, thrown) => {
    const response = await request(appThatThrows(thrown)).get('/boom');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('logs unexpected errors server-side with the request id', async () => {
    const { logger, lines } = capture();
    await request(appThatThrows(new Error('disk on fire'), logger)).get('/boom').set('X-Request-Id', 'req-87654321');
    const [entry] = lines();
    expect(entry).toMatchObject({ msg: 'unhandled error', requestId: 'req-87654321', level: 50 });
    expect(JSON.stringify(entry)).toContain('disk on fire');
  });

  it('answers unknown routes with a descriptive 404', async () => {
    const response = await request(appThatThrows(new Error('unused'))).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
  });
});

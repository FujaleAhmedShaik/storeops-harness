import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../src/app';
import { AppError } from '../src/shared/errors';
import { asyncHandler, errorHandler, requestContext } from '../src/shared/http';
import { createLogger } from '../src/shared/logger';
import { createWorld, testConfig, type World } from './helpers/world';

describe('application shell', () => {
  let world: World;

  beforeAll(async () => {
    world = await createWorld();
  });

  describe('health and headers', () => {
    it('serves unauthenticated liveness and readiness probes', async () => {
      await request(world.app).get('/health/live').expect(200, { status: 'ok' });
      await request(world.app).get('/health/ready').expect(200, { status: 'ready' });
    });

    it('sets security headers and hides the framework', async () => {
      const response = await request(world.app).get('/health/live');
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('never caches API responses', async () => {
      const response = await request(world.app).get('/api/alerts').set(world.auth('manager1'));
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('request ids', () => {
    it('echoes a well-formed inbound id', async () => {
      const response = await request(world.app).get('/health/live').set('X-Request-Id', 'abc-12345678');
      expect(response.headers['x-request-id']).toBe('abc-12345678');
    });

    it('replaces a malformed id (log-injection guard)', async () => {
      const response = await request(world.app).get('/health/live').set('X-Request-Id', 'bad id\twith spaces');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('authentication', () => {
    const protectedRoutes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['get', '/api/activities'],
      ['post', '/api/activities'],
      ['get', '/api/activities/11111111-1111-4111-8111-111111111111'],
      ['patch', '/api/activities/11111111-1111-4111-8111-111111111111'],
      ['delete', '/api/activities/11111111-1111-4111-8111-111111111111'],
      ['get', '/api/programmes'],
      ['post', '/api/programmes'],
      ['post', '/api/programmes/11111111-1111-4111-8111-111111111111/members'],
      ['get', '/api/alerts'],
    ];

    it.each(protectedRoutes)('%s %s requires a token', async (method, path) => {
      const agent = request(world.app);
      const calls = { get: agent.get.bind(agent), post: agent.post.bind(agent), patch: agent.patch.bind(agent), delete: agent.delete.bind(agent) };
      const response = await calls[method](path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it.each(['', 'Basic abc', 'Bearer', 'Bearer not-a-jwt', 'bearer a.b.c'])('rejects malformed Authorization header %j', async (header) => {
      await request(world.app).get('/api/alerts').set('Authorization', header).expect(401);
    });

    it('rejects a token signed with a different secret', async () => {
      const forged = jwt.sign({ role: 'REGIONAL_MANAGER', storeId: 'x' }, 'f'.repeat(48), {
        subject: world.users.manager1.id,
        issuer: world.config.jwt.issuer,
        audience: world.config.jwt.audience,
      });
      await request(world.app).get('/api/alerts').set('Authorization', `Bearer ${forged}`).expect(401);
    });

    it('rejects an expired token', async () => {
      const expired = jwt.sign({ role: 'STORE_MANAGER', storeId: 'store-001' }, world.config.jwt.secret, {
        subject: world.users.manager1.id,
        issuer: world.config.jwt.issuer,
        audience: world.config.jwt.audience,
        expiresIn: -60,
      });
      await request(world.app).get('/api/alerts').set('Authorization', `Bearer ${expired}`).expect(401);
    });
  });

  describe('input handling', () => {
    it('answers unknown routes with a JSON 404', async () => {
      const response = await request(world.app).get('/api/nope');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects malformed JSON with 400', async () => {
      const response = await request(world.app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": ');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_JSON');
    });

    it('rejects oversized bodies with 413', async () => {
      const response = await request(world.app)
        .post('/api/auth/login')
        .send({ email: 'a@b.example', password: 'x'.repeat(20_000) });
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects array-style query parameters (simple query parser)', async () => {
      await request(world.app).get('/api/activities?status[]=DONE').set(world.auth('manager1')).expect(400);
    });
  });

  describe('rate limiting', () => {
    it('answers 429 once the limit is exceeded', async () => {
      const limited = await createApp(testConfig({ RATE_LIMIT_MAX: '3' }), createLogger('silent'));
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        statuses.push((await request(limited.app).get('/health/live')).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
    });
  });

  describe('seeding', () => {
    it('does not seed users unless asked to', async () => {
      const unseeded = await createApp(testConfig({ SEED_DEMO_DATA: 'false' }), createLogger('silent'));
      expect(unseeded.seededUsers).toEqual([]);
    });
  });
});

describe('errorHandler', () => {
  function appThatThrows(error: unknown): express.Express {
    const app = express();
    app.use(requestContext);
    app.get(
      '/boom',
      asyncHandler(async () => {
        await Promise.resolve();
        throw error;
      }),
    );
    app.use(errorHandler(createLogger('silent')));
    return app;
  }

  it('hides internals of unexpected errors', async () => {
    const response = await request(appThatThrows(new Error('db password is hunter2'))).get('/boom');
    expect(response.status).toBe(500);
    expect(response.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
    expect(response.body.error.requestId).toBeDefined();
  });

  it('serialises AppError subclasses with their status and code', async () => {
    const response = await request(appThatThrows(new AppError('CUSTOM', 'custom failure', 418))).get('/boom');
    expect(response.status).toBe(418);
    expect(response.body.error).toMatchObject({ code: 'CUSTOM', message: 'custom failure' });
  });

  it('treats a non-error throw as an internal error', async () => {
    const response = await request(appThatThrows('just a string')).get('/boom');
    expect(response.status).toBe(500);
  });
});

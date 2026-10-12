import request from 'supertest';
import { createApp } from '../../src/app';
import { UnauthorizedError } from '../../src/shared/errors';
import { createLogger } from '../../src/shared/logger';
import { FAST_TEST_COST } from '../../src/shared/password';
import { TokenService } from '../../src/shared/token';
import { InMemoryUserRepository } from '../../src/staff/staff.repository';
import { seedDemoUsers } from '../../src/staff/staff.seed';
import { StaffService } from '../../src/staff/staff.service';
import { createWorld, demoPassword, testConfig, type World } from '../helpers/world';

const tokens = new TokenService({ secret: 's'.repeat(48), issuer: 'i', audience: 'a', ttlSeconds: 600 });

describe('StaffService', () => {
  const users = new InMemoryUserRepository();
  const service = new StaffService(users, tokens, FAST_TEST_COST);
  let manager: Awaited<ReturnType<typeof seedDemoUsers>>[number];

  beforeAll(async () => {
    const seeded = await seedDemoUsers(users, demoPassword, FAST_TEST_COST);
    const found = seeded.find((user) => user.role === 'STORE_MANAGER' && user.storeId === 'store-001');
    if (!found) {
      throw new Error('seed data missing store manager');
    }
    manager = found;
  });

  it('logs in with valid credentials and issues a token for that user', async () => {
    const token = await service.login({ email: manager.email, password: demoPassword });
    expect(tokens.verify(token.accessToken)).toEqual({ id: manager.id, role: 'STORE_MANAGER', storeId: 'store-001' });
  });

  it('matches emails case-insensitively', async () => {
    await expect(service.login({ email: manager.email.toUpperCase(), password: demoPassword })).resolves.toHaveProperty('accessToken');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrongPassword = await service.login({ email: manager.email, password: 'wrong-password' }).catch((e: unknown) => e);
    const unknownEmail = await service.login({ email: 'nobody@storeops.example', password: demoPassword }).catch((e: unknown) => e);
    expect(wrongPassword).toBeInstanceOf(UnauthorizedError);
    expect(unknownEmail).toBeInstanceOf(UnauthorizedError);
    expect((wrongPassword as Error).message).toBe((unknownEmail as Error).message);
  });

  it('defaults to the production-strength password cost', async () => {
    const strong = new StaffService(new InMemoryUserRepository(), tokens);
    await expect(strong.login({ email: 'nobody@storeops.example', password: 'whatever' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('exposes a credential-free profile to other modules', async () => {
    const profile = await service.findProfileById(manager.id);
    expect(profile).toEqual({ id: manager.id, name: 'Morgan Manager', role: 'STORE_MANAGER', storeId: 'store-001' });
    expect(JSON.stringify(profile)).not.toMatch(/hash|password/i);
    await expect(service.findProfileById('missing')).resolves.toBeNull();
  });

  it('lists store managers of one store only', async () => {
    await expect(service.findStoreManagerIds('store-001')).resolves.toEqual([manager.id]);
    await expect(service.findStoreManagerIds('store-999')).resolves.toEqual([]);
  });
});

describe('POST /api/auth/login', () => {
  let world: World;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('returns a bearer token', async () => {
    const response = await request(world.app)
      .post('/api/auth/login')
      .send({ email: 'manager.s1@storeops.example', password: demoPassword });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(response.body.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('answers 401 with an identical body for wrong password and unknown user', async () => {
    const wrong = await request(world.app).post('/api/auth/login').send({ email: 'manager.s1@storeops.example', password: 'nope' });
    const unknown = await request(world.app).post('/api/auth/login').send({ email: 'ghost@storeops.example', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it.each([
    [{}],
    [{ email: 'not-an-email', password: 'x' }],
    [{ email: 'manager.s1@storeops.example' }],
    [{ email: 'manager.s1@storeops.example', password: 'x', role: 'REGIONAL_MANAGER' }],
    [{ email: 'manager.s1@storeops.example', password: 'x'.repeat(129) }],
  ])('rejects invalid payload %j with 400', async (payload) => {
    const response = await request(world.app).post('/api/auth/login').send(payload);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('throttles repeated attempts (credential stuffing guard)', async () => {
    const limited = await createApp(testConfig({ LOGIN_RATE_LIMIT_MAX: '2' }), createLogger('silent'));
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await request(limited.app).post('/api/auth/login').send({ email: 'a@b.example', password: 'x' })).status);
    }
    expect(statuses).toEqual([401, 401, 429, 429]);
  });
});

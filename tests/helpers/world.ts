import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { createApp, type AppContext } from '../../src/app';
import { loadConfig, type AppConfig } from '../../src/shared/config';
import { createLogger } from '../../src/shared/logger';
import type { SeededUser } from '../../src/staff/staff.seed';

/** Random per run: no credential literals live in the repository. */
export const demoPassword = randomBytes(18).toString('base64url');

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    APP_ENV: 'local',
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_SECRET: randomBytes(48).toString('base64url'),
    SEED_DEMO_DATA: 'true',
    DEMO_PASSWORD: demoPassword,
    RATE_LIMIT_MAX: '100000',
    LOGIN_RATE_LIMIT_MAX: '100000',
    ...overrides,
  });
}

/** The parts of an API response the tests assert on. */
export interface TaskBody {
  id: string;
  error?: { code: string };
  [key: string]: unknown;
}

/** Items of a paginated response body. */
export function rows<T>(body: unknown): T[] {
  return (body as { data: T[] }).data;
}

export type Persona = 'regional' | 'manager1' | 'lead1' | 'associate1' | 'manager2';

const EMAILS: Record<Persona, string> = {
  regional: 'regional.manager@storeops.example',
  manager1: 'manager.s1@storeops.example',
  lead1: 'lead.s1@storeops.example',
  associate1: 'associate.s1@storeops.example',
  manager2: 'manager.s2@storeops.example',
};

export interface World extends AppContext {
  readonly config: AppConfig;
  readonly tokens: Record<Persona, string>;
  readonly users: Record<Persona, SeededUser>;
  auth(persona: Persona): { Authorization: string };
}

/** Boots the real app with seeded demo staff and a logged-in token per persona. */
export async function createWorld(overrides: Record<string, string> = {}): Promise<World> {
  const config = testConfig(overrides);
  const context = await createApp(config, createLogger('silent'));
  const personas = Object.keys(EMAILS) as Persona[];

  const tokens = {} as Record<Persona, string>;
  const users = {} as Record<Persona, SeededUser>;
  for (const persona of personas) {
    const email = EMAILS[persona];
    const response = await request(context.app).post('/api/auth/login').send({ email, password: demoPassword });
    tokens[persona] = response.body.accessToken as string;
    const seeded = context.seededUsers.find((user) => user.email === email);
    if (!seeded) {
      throw new Error(`demo user missing: ${email}`);
    }
    users[persona] = seeded;
  }
  return { ...context, config, tokens, users, auth: (persona) => ({ Authorization: `Bearer ${tokens[persona]}` }) };
}

export async function createProgramme(world: World, persona: Persona = 'manager1', name = 'Spring refit'): Promise<string> {
  const response = await request(world.app).post('/api/programmes').set(world.auth(persona)).send({ name });
  return response.body.id as string;
}

export async function createTask(
  world: World,
  programmeId: string,
  persona: Persona = 'manager1',
  body: Record<string, unknown> = {},
): Promise<{ status: number; body: TaskBody }> {
  const response = await request(world.app)
    .post('/api/activities')
    .set(world.auth(persona))
    .send({ title: 'Restock aisle 4', programmeId, ...body });
  return { status: response.status, body: response.body as TaskBody };
}

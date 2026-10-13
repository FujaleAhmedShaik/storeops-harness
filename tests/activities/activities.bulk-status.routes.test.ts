import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createProgramme, createTask, createWorld, rows, type Persona, type World } from '../helpers/world';

describe('PATCH /api/activities/bulk-status', () => {
  let world: World;
  let programmeId: string;

  beforeAll(async () => {
    world = await createWorld();
    programmeId = await createProgramme(world);
  });

  async function inProgressTask(persona: Persona = 'manager1', body: Record<string, unknown> = {}): Promise<string> {
    const { body: created } = await createTask(world, programmeId, persona, body);
    const moved = await request(world.app).patch(`/api/activities/${created.id}`).set(world.auth(persona)).send({ status: 'IN_PROGRESS' });
    expect(moved.body.status).toBe('IN_PROGRESS');
    return created.id;
  }

  const bulk = (persona: Persona, body: unknown) => request(world.app).patch('/api/activities/bulk-status').set(world.auth(persona)).send(body as object);

  async function statusOf(persona: Persona, id: string): Promise<string> {
    return (await request(world.app).get(`/api/activities/${id}`).set(world.auth(persona))).body.status as string;
  }

  it('S2-AC1: marks an IN_PROGRESS activity DONE and returns the per-item result with counts', async () => {
    const id = await inProgressTask();
    const response = await bulk('manager1', { items: [{ id, status: 'DONE' }] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results: [{ id, outcome: 'UPDATED', from: 'IN_PROGRESS', to: 'DONE' }], updated: 1, failed: 0 });
    expect(await statusOf('manager1', id)).toBe('DONE');
  });

  it('S2-AC2: updates the valid item and reports an unknown id as FAILED NOT_FOUND', async () => {
    const id = await inProgressTask();
    const missing = randomUUID();
    const response = await bulk('manager1', { items: [{ id, status: 'DONE' }, { id: missing, status: 'DONE' }] });
    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(1);
    expect(response.body.failed).toBe(1);
    expect(response.body.results[1]).toEqual({ id: missing, outcome: 'FAILED', code: 'NOT_FOUND' });
    expect(await statusOf('manager1', id)).toBe('DONE');
  });

  it('S2-AC3: rejects 51 items with a validation error and updates nothing', async () => {
    const id = await inProgressTask();
    const items = [{ id, status: 'DONE' }, ...Array.from({ length: 50 }, () => ({ id: randomUUID(), status: 'DONE' }))];
    const response = await bulk('manager1', { items });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(await statusOf('manager1', id)).toBe('IN_PROGRESS');
  });

  it('S2-AC3: rejects an empty batch, an unsupported target status and unknown fields', async () => {
    const id = await inProgressTask();
    for (const body of [{ items: [] }, { items: [{ id, status: 'TODO' }] }, { items: [{ id, status: 'DONE', extra: 1 }] }, { items: [{ id, status: 'DONE' }], storeId: 'store-002' }]) {
      const response = await bulk('manager1', body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(await statusOf('manager1', id)).toBe('IN_PROGRESS');
  });

  it('S2-AC4: reports another store\'s activity as FAILED NOT_FOUND and leaves it unchanged', async () => {
    const otherProgramme = await createProgramme(world, 'manager2', 'Store 2 refit');
    const { body: other } = await createTask(world, otherProgramme, 'manager2');
    const response = await bulk('manager1', { items: [{ id: other.id, status: 'DONE' }] });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([{ id: other.id, outcome: 'FAILED', code: 'NOT_FOUND' }]);
    expect(response.body.updated).toBe(0);
    expect(await statusOf('manager2', other.id)).toBe('TODO');
  });

  it('S2-AC5: answers 401 without an Authorization header', async () => {
    const id = await inProgressTask();
    const response = await request(world.app).patch('/api/activities/bulk-status').send({ items: [{ id, status: 'DONE' }] });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBeDefined();
    expect(await statusOf('manager1', id)).toBe('IN_PROGRESS');
  });

  it('S2-AC6: stores a SHIFT_HANDOVER notification for the assignee of each updated activity', async () => {
    const id = await inProgressTask('manager1', { assigneeId: world.users.associate1.id });
    const response = await bulk('manager1', { items: [{ id, status: 'DONE' }] });
    expect(response.body.updated).toBe(1);

    const alerts = await request(world.app).get('/api/alerts').set(world.auth('associate1'));
    const handover = rows<{ type: string; relatedId: string; status: string }>(alerts.body).filter((a) => a.type === 'SHIFT_HANDOVER');
    expect(handover).toHaveLength(1);
    expect(handover[0]).toMatchObject({ relatedId: id, status: 'UNREAD', channel: 'IN_APP' });
  });

  it('S2-AC6: does not create a notification for an item that failed', async () => {
    const missing = randomUUID();
    const response = await bulk('manager1', { items: [{ id: missing, status: 'DONE' }] });
    expect(response.body.failed).toBe(1);
    const alerts = await request(world.app).get('/api/alerts').set(world.auth('manager1'));
    expect(rows<{ relatedId: string }>(alerts.body).filter((a) => a.relatedId === missing)).toHaveLength(0);
  });
});

import request from 'supertest';
import { createProgramme, createTask, createWorld, rows, type World } from '../helpers/world';

describe('activities API', () => {
  let world: World;
  let programmeId: string;

  beforeAll(async () => {
    world = await createWorld();
    programmeId = await createProgramme(world);
  });

  describe('POST /api/activities', () => {
    it('creates a TODO activity with defaults and returns 201', async () => {
      const { status, body } = await createTask(world, programmeId, 'associate1');
      expect(status).toBe(201);
      expect(body).toMatchObject({
        title: 'Restock aisle 4',
        status: 'TODO',
        priority: 'MEDIUM',
        category: 'GENERAL',
        programmeId,
        storeId: 'store-001',
        createdBy: world.users.associate1.id,
        assigneeId: null,
      });
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('ignores nothing: unknown or privileged fields are rejected, not silently applied', async () => {
      const { status, body } = await createTask(world, programmeId, 'associate1', { status: 'DONE', storeId: 'store-002' });
      expect(status).toBe(400);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      [{ title: '' }],
      [{ title: 'x'.repeat(121) }],
      [{ priority: 'URGENT' }],
      [{ category: 'MISC' }],
      [{ dueDate: 'tomorrow' }],
      [{ programmeId: 'not-a-uuid' }],
      [{ assigneeId: 'not-a-uuid' }],
    ])('rejects invalid payload %j', async (override) => {
      const { status } = await createTask(world, programmeId, 'manager1', override);
      expect(status).toBe(400);
    });

    it('answers 404 for another store\'s programme', async () => {
      const { status } = await createTask(world, programmeId, 'manager2');
      expect(status).toBe(404);
    });

    it('rejects an assignee from another store with 400', async () => {
      const { status } = await createTask(world, programmeId, 'manager1', { assigneeId: world.users.manager2.id });
      expect(status).toBe(400);
    });
  });

  describe('GET /api/activities', () => {
    it('lists only the caller\'s store, with paging metadata', async () => {
      const response = await request(world.app).get('/api/activities').set(world.auth('lead1'));
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ limit: 50, offset: 0 });
      expect(response.body.total).toBeGreaterThan(0);
      for (const task of response.body.data) {
        expect(task.storeId).toBe('store-001');
      }
    });

    it('shows nothing of store-001 to store-002', async () => {
      const response = await request(world.app).get('/api/activities').set(world.auth('manager2'));
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });

    it('filters by status and programme, and caps page size', async () => {
      const other = await createProgramme(world, 'manager1', 'Compliance drive');
      await createTask(world, other, 'manager1', { title: 'Isolated' });

      const byProgramme = await request(world.app).get(`/api/activities?programmeId=${other}`).set(world.auth('manager1'));
      expect(rows<{ title: string }>(byProgramme.body).map((t) => t.title)).toEqual(['Isolated']);

      const byStatus = await request(world.app).get('/api/activities?status=DONE').set(world.auth('manager1'));
      expect(byStatus.body.data).toEqual([]);

      expect((await request(world.app).get('/api/activities?limit=101').set(world.auth('manager1'))).status).toBe(400);
      expect((await request(world.app).get('/api/activities?status=BOGUS').set(world.auth('manager1'))).status).toBe(400);
      expect((await request(world.app).get('/api/activities?unknown=1').set(world.auth('manager1'))).status).toBe(400);
    });

    it('lets a regional manager see every store', async () => {
      const response = await request(world.app).get('/api/activities').set(world.auth('regional'));
      expect(response.status).toBe(200);
      expect(response.body.total).toBeGreaterThan(0);
    });
  });

  describe('GET /api/activities/:id', () => {
    it('returns the activity to its store and 404 to other stores (no existence leak)', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Visible' });
      const own = await request(world.app).get(`/api/activities/${body.id}`).set(world.auth('associate1'));
      expect(own.status).toBe(200);
      expect(own.body.title).toBe('Visible');

      const foreign = await request(world.app).get(`/api/activities/${body.id}`).set(world.auth('manager2'));
      expect(foreign.status).toBe(404);
    });

    it('rejects non-uuid ids with 400', async () => {
      expect((await request(world.app).get('/api/activities/1').set(world.auth('manager1'))).status).toBe(400);
    });
  });

  describe('PATCH /api/activities/:id', () => {
    it('applies a legal transition and rejects an illegal one with a named rule', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Transition' });
      const ok = await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager1')).send({ status: 'IN_PROGRESS' });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('IN_PROGRESS');

      const done = await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager1')).send({ status: 'DONE' });
      expect(done.status).toBe(200);

      const reopen = await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager1')).send({ status: 'TODO' });
      expect(reopen.status).toBe(409);
      expect(reopen.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('enforces who may change priority', async () => {
      const { body } = await createTask(world, programmeId, 'associate1', { title: 'Priority' });
      const denied = await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('associate1')).send({ priority: 'CRITICAL' });
      expect(denied.status).toBe(403);
      const allowed = await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('lead1')).send({ priority: 'CRITICAL' });
      expect(allowed.status).toBe(200);
      expect(allowed.body.priority).toBe('CRITICAL');
    });

    it('rejects an empty or unknown-field patch', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Patch' });
      expect((await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager1')).send({})).status).toBe(400);
      expect((await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager1')).send({ createdBy: 'x' })).status).toBe(400);
    });

    it('returns 404 for another store', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Guarded' });
      expect((await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('manager2')).send({ title: 'hijack' })).status).toBe(404);
    });
  });

  describe('DELETE /api/activities/:id', () => {
    it('lets the owner delete, then the activity is gone', async () => {
      const { body } = await createTask(world, programmeId, 'associate1', { title: 'Disposable' });
      expect((await request(world.app).delete(`/api/activities/${body.id}`).set(world.auth('associate1'))).status).toBe(204);
      expect((await request(world.app).get(`/api/activities/${body.id}`).set(world.auth('associate1'))).status).toBe(404);
    });

    it('lets a store manager delete someone else\'s activity', async () => {
      const { body } = await createTask(world, programmeId, 'associate1', { title: 'Managed away' });
      expect((await request(world.app).delete(`/api/activities/${body.id}`).set(world.auth('manager1'))).status).toBe(204);
    });

    it('forbids a non-owner below store manager and keeps the data', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Protected' });
      expect((await request(world.app).delete(`/api/activities/${body.id}`).set(world.auth('associate1'))).status).toBe(403);
      expect((await request(world.app).get(`/api/activities/${body.id}`).set(world.auth('manager1'))).status).toBe(200);
    });

    it('does not let another store\'s manager delete it', async () => {
      const { body } = await createTask(world, programmeId, 'manager1', { title: 'Cross-store' });
      expect((await request(world.app).delete(`/api/activities/${body.id}`).set(world.auth('manager2'))).status).toBe(404);
    });
  });
});

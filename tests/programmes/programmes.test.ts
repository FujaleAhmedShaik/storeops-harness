import request from 'supertest';
import { InMemoryProjectRepository } from '../../src/programmes/programmes.repository';
import { ProgrammesService } from '../../src/programmes/programmes.service';
import { ForbiddenError } from '../../src/shared/errors';
import { fixedClock, ids, sequentialIds, staffDirectory, users, STORE_A } from '../helpers/fakes';
import { createProgramme, createWorld, rows, type World } from '../helpers/world';

const manager = users.manager;
const lead = users.lead;
const associate = users.associate;

function setup() {
  const repo = new InMemoryProjectRepository();
  return { repo, service: new ProgrammesService(repo, staffDirectory, fixedClock(), sequentialIds()) };
}

describe('ProgrammesService', () => {
  it('creates an ACTIVE programme in the creator\'s store with the creator as first member', async () => {
    const { service } = setup();
    const project = await service.create(manager, { name: 'Autumn reset', description: 'Seasonal' });
    expect(project).toMatchObject({
      name: 'Autumn reset',
      description: 'Seasonal',
      storeId: STORE_A,
      ownerId: manager.id,
      status: 'ACTIVE',
      members: [{ userId: manager.id, role: 'STORE_MANAGER', addedAt: '2026-03-01T10:00:00.000Z' }],
    });
  });

  it('defaults the description to null', async () => {
    const { service } = setup();
    expect((await service.create(manager, { name: 'No description' })).description).toBeNull();
  });

  it.each([['associate', associate], ['lead', lead]])('does not let a %s create programmes', async (_name, user) => {
    const { service } = setup();
    await expect(service.create(user, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  describe('addMember', () => {
    it('adds a store member with a role up to their own seniority', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      const updated = await service.addMember(manager, project.id, { userId: ids.lead, role: 'DEPARTMENT_LEAD' });
      expect(updated.members.map((m) => [m.userId, m.role])).toEqual([
        [manager.id, 'STORE_MANAGER'],
        [ids.lead, 'DEPARTMENT_LEAD'],
      ]);
      const lower = await service.addMember(manager, project.id, { userId: ids.associate, role: 'ASSOCIATE' });
      expect(lower.members).toHaveLength(3);
    });

    it('refuses a role that outranks the staff member (business rule)', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      await expect(service.addMember(manager, project.id, { userId: ids.associate, role: 'DEPARTMENT_LEAD' })).rejects.toMatchObject({
        code: 'ROLE_EXCEEDS_STAFF_ROLE',
      });
      await expect(service.addMember(manager, project.id, { userId: ids.lead, role: 'STORE_MANAGER' })).rejects.toMatchObject({
        code: 'ROLE_EXCEEDS_STAFF_ROLE',
      });
    });

    it('refuses duplicates', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      await service.addMember(manager, project.id, { userId: ids.associate, role: 'ASSOCIATE' });
      await expect(service.addMember(manager, project.id, { userId: ids.associate, role: 'ASSOCIATE' })).rejects.toMatchObject({
        code: 'ALREADY_MEMBER',
      });
    });

    it('refuses unknown staff and staff from another store', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      await expect(service.addMember(manager, project.id, { userId: ids.unknown, role: 'ASSOCIATE' })).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(service.addMember(manager, project.id, { userId: ids.outsider, role: 'ASSOCIATE' })).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('refuses closed programmes', async () => {
      const { service, repo } = setup();
      const project = await service.create(manager, { name: 'p' });
      await repo.save({ ...project, status: 'CLOSED' });
      await expect(service.addMember(manager, project.id, { userId: ids.associate, role: 'ASSOCIATE' })).rejects.toMatchObject({
        code: 'PROGRAMME_CLOSED',
      });
    });

    it('only store managers or the programme owner may add members', async () => {
      const { service, repo } = setup();
      const project = await service.create(manager, { name: 'p' });
      await expect(service.addMember(lead, project.id, { userId: ids.associate, role: 'ASSOCIATE' })).rejects.toBeInstanceOf(ForbiddenError);

      await repo.save({ ...project, ownerId: lead.id });
      await expect(service.addMember(lead, project.id, { userId: ids.associate, role: 'ASSOCIATE' })).resolves.toMatchObject({
        members: expect.arrayContaining([expect.objectContaining({ userId: ids.associate })]),
      });
    });

    it('hides programmes of other stores and unknown ids', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      const outsider = users.outsiderManager;
      await expect(service.addMember(outsider, project.id, { userId: ids.outsider, role: 'ASSOCIATE' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.addMember(manager, ids.unknown, { userId: ids.associate, role: 'ASSOCIATE' })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('list / findSummaryById', () => {
    it('lists own store only, newest first, with paging; regional managers see all', async () => {
      let tick = 0;
      const repo = new InMemoryProjectRepository();
      const service = new ProgrammesService(repo, staffDirectory, () => new Date(Date.UTC(2026, 2, 1, 10, tick++)), sequentialIds());
      await service.create(manager, { name: 'older' });
      await service.create(manager, { name: 'newer' });
      await service.create(users.outsiderManager, { name: 'elsewhere' });

      const own = await service.list(manager, { limit: 1, offset: 0 });
      expect(own.data.map((p) => p.name)).toEqual(['newer']);
      expect(own.total).toBe(2);
      const second = await service.list(manager, { limit: 1, offset: 1 });
      expect(second.data.map((p) => p.name)).toEqual(['older']);
      const all = await service.list(users.regional, { limit: 10, offset: 0 });
      expect(all.total).toBe(3);
    });

    it('breaks createdAt ties by id', async () => {
      const { service } = setup();
      await service.create(manager, { name: 'a' });
      await service.create(manager, { name: 'b' });
      const page = await service.list(manager, { limit: 10, offset: 0 });
      const idsInOrder = page.data.map((p) => p.id);
      expect(idsInOrder).toEqual([...idsInOrder].sort());
    });

    it('exposes a minimal summary to other modules', async () => {
      const { service } = setup();
      const project = await service.create(manager, { name: 'p' });
      await expect(service.findSummaryById(project.id)).resolves.toEqual({ id: project.id, storeId: STORE_A, status: 'ACTIVE' });
      await expect(service.findSummaryById(ids.unknown)).resolves.toBeNull();
    });
  });
});

describe('programmes API', () => {
  let world: World;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('POST /api/programmes lets a store manager create and rejects associates', async () => {
    const created = await request(world.app).post('/api/programmes').set(world.auth('manager1')).send({ name: 'Refit' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Refit', storeId: 'store-001', status: 'ACTIVE' });

    await request(world.app).post('/api/programmes').set(world.auth('associate1')).send({ name: 'Nope' }).expect(403);
  });

  it.each([[{}], [{ name: '' }], [{ name: 'ok', owner: 'x' }], [{ name: 'x'.repeat(121) }]])('rejects invalid create payload %j', async (payload) => {
    await request(world.app).post('/api/programmes').set(world.auth('manager1')).send(payload).expect(400);
  });

  it('GET /api/programmes lists the authenticated store only', async () => {
    await createProgramme(world, 'manager1', 'Store one');
    await createProgramme(world, 'manager2', 'Store two');

    const one = await request(world.app).get('/api/programmes').set(world.auth('associate1'));
    expect(one.status).toBe(200);
    const names = rows<{ name: string; storeId: string }>(one.body);
    expect(names.every((p) => p.storeId === 'store-001')).toBe(true);
    expect(names.map((p) => p.name)).toContain('Store one');
    expect(names.map((p) => p.name)).not.toContain('Store two');

    await request(world.app).get('/api/programmes?limit=0').set(world.auth('manager1')).expect(400);
  });

  it('POST /api/programmes/:id/members adds a member and enforces the rules over HTTP', async () => {
    const programmeId = await createProgramme(world);
    const added = await request(world.app)
      .post(`/api/programmes/${programmeId}/members`)
      .set(world.auth('manager1'))
      .send({ userId: world.users.associate1.id, role: 'ASSOCIATE' });
    expect(added.status).toBe(201);
    expect(added.body.members).toHaveLength(2);

    const duplicate = await request(world.app)
      .post(`/api/programmes/${programmeId}/members`)
      .set(world.auth('manager1'))
      .send({ userId: world.users.associate1.id, role: 'ASSOCIATE' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_MEMBER');

    const outranks = await request(world.app)
      .post(`/api/programmes/${programmeId}/members`)
      .set(world.auth('manager1'))
      .send({ userId: world.users.lead1.id, role: 'STORE_MANAGER' });
    expect(outranks.status).toBe(409);
    expect(outranks.body.error.code).toBe('ROLE_EXCEEDS_STAFF_ROLE');

    await request(world.app)
      .post(`/api/programmes/${programmeId}/members`)
      .set(world.auth('associate1'))
      .send({ userId: world.users.lead1.id, role: 'ASSOCIATE' })
      .expect(403);
    await request(world.app)
      .post(`/api/programmes/${programmeId}/members`)
      .set(world.auth('manager2'))
      .send({ userId: world.users.manager2.id, role: 'ASSOCIATE' })
      .expect(404);
    await request(world.app).post(`/api/programmes/${programmeId}/members`).set(world.auth('manager1')).send({ userId: 'x', role: 'ASSOCIATE' }).expect(400);
    await request(world.app).post('/api/programmes/not-a-uuid/members').set(world.auth('manager1')).send({}).expect(400);
  });
});

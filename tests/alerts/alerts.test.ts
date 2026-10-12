import request from 'supertest';
import { AlertsService } from '../../src/alerts/alerts.service';
import { InMemoryNotificationRepository } from '../../src/alerts/alerts.repository';
import { InMemoryEventBus } from '../../src/shared/event-bus';
import { createLogger } from '../../src/shared/logger';
import { fixedClock, ids, sequentialIds, STORE_A } from '../helpers/fakes';
import { createProgramme, createTask, createWorld, rows, type World } from '../helpers/world';

const managerIds = ['m-1', 'm-2'];

function setup(managers: string[] = managerIds) {
  const repo = new InMemoryNotificationRepository();
  const bus = new InMemoryEventBus(createLogger('silent'));
  const service = new AlertsService(repo, { findStoreManagerIds: async () => Promise.resolve(managers) }, fixedClock(), sequentialIds());
  service.registerEventHandlers(bus);
  return { repo, bus, service };
}

const statusChange = {
  taskId: 't-1',
  title: 'Fix freezer',
  storeId: STORE_A,
  assigneeId: ids.associate,
  from: 'IN_PROGRESS',
  to: 'BLOCKED',
  priority: 'CRITICAL',
} as const;

describe('AlertsService event handling', () => {
  it.each(['HIGH', 'CRITICAL'] as const)('escalates a %s activity that becomes BLOCKED to every store manager', async (priority) => {
    const { bus, repo } = setup();
    await bus.emit('activity.status_changed', { ...statusChange, priority });
    for (const managerId of managerIds) {
      const alerts = await repo.findByUser(managerId);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        type: 'ESCALATION',
        channel: 'IN_APP',
        status: 'UNREAD',
        relatedId: 't-1',
        title: `${priority} activity blocked`,
        message: '"Fix freezer" is now BLOCKED and needs attention.',
      });
    }
  });

  it.each([
    ['LOW priority', { priority: 'LOW' }],
    ['MEDIUM priority', { priority: 'MEDIUM' }],
    ['a move to DONE', { to: 'DONE' }],
    ['a move to IN_PROGRESS', { to: 'IN_PROGRESS' }],
  ] as const)('does not escalate %s', async (_label, override) => {
    const { bus, repo } = setup();
    await bus.emit('activity.status_changed', { ...statusChange, ...override });
    for (const managerId of managerIds) {
      await expect(repo.findByUser(managerId)).resolves.toEqual([]);
    }
  });

  it('creates nothing when the store has no managers', async () => {
    const { bus, repo } = setup([]);
    await expect(bus.emit('activity.status_changed', statusChange)).resolves.toBeUndefined();
    await expect(repo.findByUser('m-1')).resolves.toEqual([]);
  });

  it('raises an INVENTORY alert for the assignee of a restocking activity', async () => {
    const { bus, repo } = setup();
    await bus.emit('activity.assigned', {
      taskId: 't-2',
      title: 'Restock dairy',
      storeId: STORE_A,
      assigneeId: ids.associate,
      category: 'RESTOCKING',
      priority: 'MEDIUM',
    });
    const alerts = await repo.findByUser(ids.associate);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'INVENTORY', relatedId: 't-2', title: 'Restocking activity assigned' });
  });

  it('ignores assignments of other categories', async () => {
    const { bus, repo } = setup();
    await bus.emit('activity.assigned', {
      taskId: 't-3',
      title: 'Audit',
      storeId: STORE_A,
      assigneeId: ids.associate,
      category: 'AUDIT',
      priority: 'HIGH',
    });
    await expect(repo.findByUser(ids.associate)).resolves.toEqual([]);
  });
});

describe('AlertsService.listForUser', () => {
  it('returns only the caller\'s alerts, newest first, filtered and paged', async () => {
    let tick = 0;
    const repo = new InMemoryNotificationRepository();
    const service = new AlertsService(repo, { findStoreManagerIds: async () => Promise.resolve([]) }, () => new Date(Date.UTC(2026, 0, 1, 0, tick++)), sequentialIds());
    const note = (userId: string, status: 'UNREAD' | 'READ', n: number) =>
      repo.save({ id: `aaaaaaaa-0000-4000-8000-00000000000${n}`, userId, type: 'INVENTORY', channel: 'IN_APP', status, title: `t${n}`, message: 'm', relatedId: 'r', createdAt: `2026-01-01T00:0${n}:00.000Z` });
    await note('me', 'UNREAD', 1);
    await note('me', 'READ', 2);
    await note('me', 'UNREAD', 3);
    await note('someone-else', 'UNREAD', 4);

    const me = { id: 'me', role: 'ASSOCIATE', storeId: STORE_A } as const;
    const all = await service.listForUser(me, { limit: 50, offset: 0 });
    expect(all.data.map((n) => n.title)).toEqual(['t3', 't2', 't1']);
    const unread = await service.listForUser(me, { status: 'UNREAD', limit: 50, offset: 0 });
    expect(unread.data.map((n) => n.title)).toEqual(['t3', 't1']);
    const paged = await service.listForUser(me, { limit: 1, offset: 1 });
    expect(paged.data.map((n) => n.title)).toEqual(['t2']);
    expect(paged.total).toBe(3);
  });

  it('breaks createdAt ties by id', async () => {
    const repo = new InMemoryNotificationRepository();
    const service = new AlertsService(repo, { findStoreManagerIds: async () => Promise.resolve([]) });
    for (const id of ['b', 'a']) {
      await repo.save({ id, userId: 'me', type: 'INVENTORY', channel: 'IN_APP', status: 'UNREAD', title: id, message: 'm', relatedId: 'r', createdAt: '2026-01-01T00:00:00.000Z' });
    }
    const page = await service.listForUser({ id: 'me', role: 'ASSOCIATE', storeId: STORE_A }, { limit: 10, offset: 0 });
    expect(page.data.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('alerts end to end through the event bus', () => {
  let world: World;

  beforeAll(async () => {
    world = await createWorld();
  });

  it('assigning a restocking activity alerts the assignee - and only them', async () => {
    const programmeId = await createProgramme(world);
    const { status } = await createTask(world, programmeId, 'manager1', {
      title: 'Restock dairy',
      category: 'RESTOCKING',
      assigneeId: world.users.associate1.id,
    });
    expect(status).toBe(201);

    const mine = await request(world.app).get('/api/alerts').set(world.auth('associate1'));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ type: 'INVENTORY', status: 'UNREAD', channel: 'IN_APP' });

    const others = await request(world.app).get('/api/alerts').set(world.auth('manager2'));
    expect(others.body.data).toEqual([]);
  });

  it('blocking a HIGH activity escalates to the store manager of that store only', async () => {
    const programmeId = await createProgramme(world, 'manager1', 'Escalation drive');
    const { body } = await createTask(world, programmeId, 'manager1', { title: 'Broken chiller', priority: 'HIGH' });
    expect((await request(world.app).patch(`/api/activities/${body.id}`).set(world.auth('lead1')).send({ status: 'BLOCKED' })).status).toBe(200);

    const manager = await request(world.app).get('/api/alerts?status=UNREAD').set(world.auth('manager1'));
    expect(rows<{ type: string; relatedId: string }>(manager.body).map((a) => [a.type, a.relatedId])).toContainEqual(['ESCALATION', body.id]);

    const otherStore = await request(world.app).get('/api/alerts').set(world.auth('manager2'));
    expect(otherStore.body.data).toEqual([]);
  });

  it('validates alert queries', async () => {
    expect((await request(world.app).get('/api/alerts?status=SEEN').set(world.auth('manager1'))).status).toBe(400);
    expect((await request(world.app).get('/api/alerts?limit=1000').set(world.auth('manager1'))).status).toBe(400);
  });
});

import { ActivitiesService } from '../../src/activities/activities.service';
import { InMemoryTaskRepository } from '../../src/activities/activities.repository';
import type { Task, TaskStatus } from '../../src/activities/activities.types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors';
import { createRecordingBus, fixedClock, ids, programmeDirectory, sequentialIds, staffDirectory, users, STORE_A } from '../helpers/fakes';

const manager = users.manager;
const lead = users.lead;
const associate = users.associate;
const otherAssociate = users.otherAssociate;
const outsider = users.outsiderManager;
const regional = users.regional;

function setup(clock = fixedClock()) {
  const repo = new InMemoryTaskRepository();
  const bus = createRecordingBus();
  const service = new ActivitiesService(repo, programmeDirectory, staffDirectory, bus, clock, sequentialIds());
  return { repo, bus, service };
}

const base = { programmeId: ids.programme, priority: 'MEDIUM', category: 'GENERAL' } as const;

describe('ActivitiesService.create', () => {
  it('creates a TODO task in the programme store with the caller as owner', async () => {
    const { service } = setup();
    const task = await service.create(associate, { ...base, title: 'Reset endcap' });
    expect(task).toMatchObject({
      title: 'Reset endcap',
      status: 'TODO',
      storeId: STORE_A,
      createdBy: associate.id,
      assigneeId: null,
      description: null,
      dueDate: null,
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
    });
  });

  it('raises activity.assigned (and only that) when an assignee is given', async () => {
    const { service, bus } = setup();
    const task = await service.create(manager, { ...base, title: 'Restock', category: 'RESTOCKING', assigneeId: ids.associate });
    expect(task.assigneeId).toBe(ids.associate);
    expect(bus.emitted).toEqual([
      {
        name: 'activity.assigned',
        payload: { taskId: task.id, title: 'Restock', storeId: STORE_A, assigneeId: ids.associate, category: 'RESTOCKING', priority: 'MEDIUM' },
      },
    ]);
  });

  it('emits nothing when unassigned', async () => {
    const { service, bus } = setup();
    await service.create(manager, { ...base, title: 'Unassigned' });
    expect(bus.emitted).toHaveLength(0);
  });

  it('stores optional description and due date', async () => {
    const { service } = setup();
    const task = await service.create(manager, { ...base, title: 'Audit', description: 'Check dates', dueDate: '2026-03-05T00:00:00.000Z' });
    expect(task).toMatchObject({ description: 'Check dates', dueDate: '2026-03-05T00:00:00.000Z' });
  });

  it('hides programmes of other stores and unknown programmes behind NotFound', async () => {
    const { service } = setup();
    await expect(service.create(manager, { ...base, title: 'x', programmeId: ids.foreignProgramme })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.create(manager, { ...base, title: 'x', programmeId: ids.unknown })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets a regional manager create in any store', async () => {
    const { service } = setup();
    const task = await service.create(regional, { ...base, title: 'x', programmeId: ids.foreignProgramme });
    expect(task.storeId).toBe('store-002');
  });

  it('refuses to add work to a closed programme', async () => {
    const { service } = setup();
    await expect(service.create(manager, { ...base, title: 'x', programmeId: ids.closedProgramme })).rejects.toMatchObject({
      code: 'PROGRAMME_CLOSED',
    });
  });

  it('rejects assignees that are unknown or from another store', async () => {
    const { service } = setup();
    await expect(service.create(manager, { ...base, title: 'x', assigneeId: ids.unknown })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.create(manager, { ...base, title: 'x', assigneeId: ids.outsider })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ActivitiesService.get / list', () => {
  it('returns own-store tasks and hides other stores', async () => {
    const { service } = setup();
    const task = await service.create(manager, { ...base, title: 'Mine' });
    await expect(service.get(associate, task.id)).resolves.toEqual(task);
    await expect(service.get(outsider, task.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.get(manager, ids.unknown)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets a regional manager read any store', async () => {
    const { service } = setup();
    const task = await service.create(manager, { ...base, title: 'Mine' });
    await expect(service.get(regional, task.id)).resolves.toEqual(task);
  });

  it('scopes lists to the caller store but not for regional managers', async () => {
    const { service } = setup();
    await service.create(manager, { ...base, title: 'A1' });
    await service.create(regional, { ...base, title: 'B1', programmeId: ids.foreignProgramme });

    const own = await service.list(manager, { limit: 50, offset: 0 });
    expect(own.data.map((t) => t.title)).toEqual(['A1']);
    const mine = await service.list(outsider, { limit: 50, offset: 0 });
    expect(mine.data.map((t) => t.title)).toEqual(['B1']);
    const all = await service.list(regional, { limit: 50, offset: 0 });
    expect(all.total).toBe(2);
  });

  it('filters by programme and status', async () => {
    const { service } = setup();
    const task = await service.create(manager, { ...base, title: 'Open' });
    await service.update(manager, task.id, { status: 'IN_PROGRESS' });
    await service.create(manager, { ...base, title: 'Todo' });

    const inProgress = await service.list(manager, { status: 'IN_PROGRESS', limit: 50, offset: 0 });
    expect(inProgress.data.map((t) => t.title)).toEqual(['Open']);
    const byProgramme = await service.list(manager, { programmeId: ids.programme, limit: 50, offset: 0 });
    expect(byProgramme.total).toBe(2);
    const none = await service.list(manager, { programmeId: ids.closedProgramme, limit: 50, offset: 0 });
    expect(none.total).toBe(0);
  });

  it('orders newest first and paginates', async () => {
    const times = ['2026-03-01T10:00:00.000Z', '2026-03-01T11:00:00.000Z', '2026-03-01T12:00:00.000Z'];
    let tick = 0;
    const { service } = setup(() => new Date(times[tick++ % times.length] ?? times[0] ?? ''));
    await service.create(manager, { ...base, title: 'oldest' });
    await service.create(manager, { ...base, title: 'middle' });
    await service.create(manager, { ...base, title: 'newest' });

    const firstPage = await service.list(manager, { limit: 2, offset: 0 });
    expect(firstPage.data.map((t) => t.title)).toEqual(['newest', 'middle']);
    expect(firstPage.total).toBe(3);
    const secondPage = await service.list(manager, { limit: 2, offset: 2 });
    expect(secondPage.data.map((t) => t.title)).toEqual(['oldest']);
  });

  it('breaks createdAt ties by id for a stable order', async () => {
    const { service } = setup();
    const first = await service.create(manager, { ...base, title: 'first' });
    const second = await service.create(manager, { ...base, title: 'second' });
    const page = await service.list(manager, { limit: 10, offset: 0 });
    expect(page.data.map((t) => t.id)).toEqual([first.id, second.id].sort());
  });
});

describe('ActivitiesService.update', () => {
  async function taskIn(status: TaskStatus) {
    const ctx = setup();
    const created = await ctx.service.create(manager, { ...base, title: 'Subject', assigneeId: ids.associate });
    const task: Task = await ctx.repo.save({ ...created, status });
    ctx.bus.emitted.length = 0;
    return { ...ctx, task };
  }

  const allowed: [TaskStatus, TaskStatus][] = [
    ['TODO', 'IN_PROGRESS'],
    ['TODO', 'BLOCKED'],
    ['IN_PROGRESS', 'TODO'],
    ['IN_PROGRESS', 'DONE'],
    ['IN_PROGRESS', 'BLOCKED'],
    ['BLOCKED', 'TODO'],
    ['BLOCKED', 'IN_PROGRESS'],
  ];
  it.each(allowed)('allows %s -> %s', async (from, to) => {
    const { service, task } = await taskIn(from);
    await expect(service.update(associate, task.id, { status: to })).resolves.toMatchObject({ status: to });
  });

  const forbidden: [TaskStatus, TaskStatus][] = [
    ['TODO', 'DONE'],
    ['BLOCKED', 'DONE'],
    ['DONE', 'TODO'],
    ['DONE', 'IN_PROGRESS'],
    ['DONE', 'BLOCKED'],
  ];
  it.each(forbidden)('rejects %s -> %s with INVALID_STATUS_TRANSITION and changes nothing', async (from, to) => {
    const { service, task, repo, bus } = await taskIn(from);
    await expect(service.update(manager, task.id, { status: to })).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    await expect(service.update(manager, task.id, { status: to })).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findById(task.id))?.status).toBe(from);
    expect(bus.emitted).toHaveLength(0);
  });

  it('emits activity.status_changed with from/to when status changes', async () => {
    const { service, task, bus } = await taskIn('IN_PROGRESS');
    await service.update(associate, task.id, { status: 'BLOCKED' });
    expect(bus.emitted).toEqual([
      {
        name: 'activity.status_changed',
        payload: {
          taskId: task.id,
          title: 'Subject',
          storeId: STORE_A,
          assigneeId: ids.associate,
          from: 'IN_PROGRESS',
          to: 'BLOCKED',
          priority: 'MEDIUM',
        },
      },
    ]);
  });

  it('does not emit when the status is re-sent unchanged', async () => {
    const { service, task, bus } = await taskIn('TODO');
    await service.update(associate, task.id, { status: 'TODO', description: 'noted' });
    expect(bus.emitted).toHaveLength(0);
  });

  it('updates plain fields and bumps updatedAt', async () => {
    let tick = 0;
    const { service } = setup(() => new Date(Date.UTC(2026, 2, 1, 10, tick++)));
    const created = await service.create(manager, { ...base, title: 'Before' });
    const updated = await service.update(manager, created.id, { title: 'After', description: 'details', category: 'AUDIT' });
    expect(updated).toMatchObject({ title: 'After', description: 'details', category: 'AUDIT', createdAt: created.createdAt });
    expect(updated.updatedAt > created.updatedAt).toBe(true);
  });

  it('forbids associates who are neither creator nor assignee', async () => {
    const { service, task } = await taskIn('TODO');
    await expect(service.update(otherAssociate, task.id, { status: 'IN_PROGRESS' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets supervisors update tasks they did not create', async () => {
    const { service, task } = await taskIn('TODO');
    await expect(service.update(lead, task.id, { status: 'IN_PROGRESS' })).resolves.toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('lets the creator update even when not a supervisor', async () => {
    const { service } = setup();
    const created = await service.create(associate, { ...base, title: 'Mine' });
    await expect(service.update(associate, created.id, { title: 'Still mine' })).resolves.toMatchObject({ title: 'Still mine' });
  });

  it('stops associates from raising priority or reassigning, but lets supervisors do both', async () => {
    const { service, task } = await taskIn('TODO');
    await expect(service.update(associate, task.id, { priority: 'CRITICAL' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(associate, task.id, { assigneeId: ids.otherAssociate })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.update(lead, task.id, { priority: 'CRITICAL' })).resolves.toMatchObject({ priority: 'CRITICAL' });
  });

  it('allows an associate to re-send the unchanged priority and assignee', async () => {
    const { service, task } = await taskIn('TODO');
    await expect(
      service.update(associate, task.id, { priority: task.priority, assigneeId: task.assigneeId, description: 'same' }),
    ).resolves.toMatchObject({ description: 'same' });
  });

  it('reassigning raises activity.assigned and validates the new assignee', async () => {
    const { service, task, bus } = await taskIn('TODO');
    await expect(service.update(lead, task.id, { assigneeId: ids.outsider })).rejects.toBeInstanceOf(ValidationError);
    expect(bus.emitted).toHaveLength(0);

    const updated = await service.update(lead, task.id, { assigneeId: ids.otherAssociate });
    expect(updated.assigneeId).toBe(ids.otherAssociate);
    expect(bus.emitted.map((e) => e.name)).toEqual(['activity.assigned']);
  });

  it('un-assigning does not raise an assigned event', async () => {
    const { service, task, bus } = await taskIn('TODO');
    const updated = await service.update(lead, task.id, { assigneeId: null });
    expect(updated.assigneeId).toBeNull();
    expect(bus.emitted).toHaveLength(0);
  });

  it('hides tasks from other stores', async () => {
    const { service, task } = await taskIn('TODO');
    await expect(service.update(outsider, task.id, { title: 'hijack' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ActivitiesService.delete', () => {
  it('lets the owner delete their own task', async () => {
    const { service, repo } = setup();
    const created = await service.create(associate, { ...base, title: 'Mine' });
    await service.delete(associate, created.id);
    await expect(repo.findById(created.id)).resolves.toBeNull();
  });

  it('lets a store manager delete anyone\'s task in their store', async () => {
    const { service } = setup();
    const created = await service.create(associate, { ...base, title: 'Theirs' });
    await expect(service.delete(manager, created.id)).resolves.toBeUndefined();
    await expect(service.get(manager, created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('forbids non-owners below store manager, even supervisors', async () => {
    const { service, repo } = setup();
    const created = await service.create(manager, { ...base, title: 'Managed' });
    await expect(service.delete(associate, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.delete(lead, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(repo.findById(created.id)).resolves.not.toBeNull();
  });

  it('hides tasks from other stores and unknown ids', async () => {
    const { service } = setup();
    const created = await service.create(manager, { ...base, title: 'Managed' });
    await expect(service.delete(outsider, created.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete(manager, ids.unknown)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ActivitiesService.getStoreStats', () => {
  it('returns zeros for an empty store', async () => {
    const { service } = setup();
    await expect(service.getStoreStats(STORE_A)).resolves.toEqual({
      storeId: STORE_A,
      total: 0,
      byStatus: { TODO: 0, IN_PROGRESS: 0, DONE: 0, BLOCKED: 0 },
      overdue: 0,
      completionRate: 0,
    });
  });

  it('counts statuses, overdue work (not DONE, past due) and the completion rate', async () => {
    const { service, repo } = setup(fixedClock('2026-03-10T00:00:00.000Z'));
    const make = async (title: string, status: TaskStatus, dueDate: string | null) => {
      const created = await service.create(manager, { ...base, title, ...(dueDate ? { dueDate } : {}) });
      await repo.save({ ...created, status });
    };
    await make('done late', 'DONE', '2026-03-01T00:00:00.000Z');
    await make('overdue todo', 'TODO', '2026-03-02T00:00:00.000Z');
    await make('overdue blocked', 'BLOCKED', '2026-03-03T00:00:00.000Z');
    await make('future', 'IN_PROGRESS', '2026-04-01T00:00:00.000Z');

    const stats = await service.getStoreStats(STORE_A);
    expect(stats.total).toBe(4);
    expect(stats.byStatus).toEqual({ TODO: 1, IN_PROGRESS: 1, DONE: 1, BLOCKED: 1 });
    expect(stats.overdue).toBe(2);
    expect(stats.completionRate).toBe(0.25);
  });

  it('ignores other stores', async () => {
    const { service } = setup();
    await service.create(regional, { ...base, title: 'elsewhere', programmeId: ids.foreignProgramme });
    await expect(service.getStoreStats(STORE_A)).resolves.toMatchObject({ total: 0 });
  });
});

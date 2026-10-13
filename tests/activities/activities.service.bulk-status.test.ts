import { ActivitiesService } from '../../src/activities/activities.service';
import { InMemoryTaskRepository } from '../../src/activities/activities.repository';
import { bulkUpdateStatusSchema } from '../../src/activities/activities.schemas';
import type { Task, TaskStatus } from '../../src/activities/activities.types';
import { ValidationError } from '../../src/shared/errors';
import type { AuthUser } from '../../src/shared/domain';
import { createRecordingBus, fixedClock, ids, programmeDirectory, sequentialIds, staffDirectory, users } from '../helpers/fakes';

const manager = users.manager;
const associate = users.associate;
const otherAssociate = users.otherAssociate;
const outsider = users.outsiderManager;

function setup() {
  const repo = new InMemoryTaskRepository();
  const bus = createRecordingBus();
  const service = new ActivitiesService(repo, programmeDirectory, staffDirectory, bus, fixedClock(), sequentialIds());
  return { repo, bus, service };
}

const base = { programmeId: ids.programme, priority: 'MEDIUM', category: 'GENERAL' } as const;

async function seed(
  ctx: ReturnType<typeof setup>,
  owner: AuthUser,
  status: TaskStatus,
  title = 'Subject',
  programmeId = ids.programme,
): Promise<Task> {
  const created = await ctx.service.create(owner, { ...base, title, programmeId });
  return ctx.repo.save({ ...created, status });
}

describe('ActivitiesService.bulkUpdateStatus', () => {
  it('S1-AC1: updates two in-store activities, storing the new status and emitting both events per item', async () => {
    const ctx = setup();
    const taskA = await seed(ctx, manager, 'IN_PROGRESS', 'A');
    const taskB = await seed(ctx, manager, 'TODO', 'B');
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(manager, {
      items: [
        { id: taskA.id, status: 'DONE' },
        { id: taskB.id, status: 'BLOCKED' },
      ],
    });

    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([
      { id: taskA.id, outcome: 'UPDATED', from: 'IN_PROGRESS', to: 'DONE' },
      { id: taskB.id, outcome: 'UPDATED', from: 'TODO', to: 'BLOCKED' },
    ]);
    expect((await ctx.repo.findById(taskA.id))?.status).toBe('DONE');
    expect((await ctx.repo.findById(taskB.id))?.status).toBe('BLOCKED');

    const statusChanged = ctx.bus.emitted.filter((e) => e.name === 'activity.status_changed');
    expect(statusChanged).toHaveLength(2);
    const bulkAudit = ctx.bus.emitted.filter((e) => e.name === 'activity.bulk_status_updated');
    expect(bulkAudit).toHaveLength(2);
    for (const entry of bulkAudit) {
      expect(entry.payload).toMatchObject({ updatedBy: manager.id });
    }
  });

  it('S1-AC2: reports a cross-store activity as NOT_FOUND, leaves it unchanged and emits nothing', async () => {
    const ctx = setup();
    const taskC = await seed(ctx, outsider, 'IN_PROGRESS', 'C', ids.foreignProgramme);
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(manager, { items: [{ id: taskC.id, status: 'DONE' }] });

    expect(result.failed).toBe(1);
    expect(result.results).toEqual([{ id: taskC.id, outcome: 'FAILED', code: 'NOT_FOUND' }]);
    expect((await ctx.repo.findById(taskC.id))?.status).toBe('IN_PROGRESS');
    expect(ctx.bus.emitted).toHaveLength(0);
  });

  it('S1-AC3: reports a non-participant associate as FORBIDDEN, leaves the activity unchanged and emits nothing', async () => {
    const ctx = setup();
    const taskD = await seed(ctx, manager, 'TODO', 'D');
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(otherAssociate, { items: [{ id: taskD.id, status: 'DONE' }] });

    expect(result.failed).toBe(1);
    expect(result.results).toEqual([{ id: taskD.id, outcome: 'FAILED', code: 'FORBIDDEN' }]);
    expect((await ctx.repo.findById(taskD.id))?.status).toBe('TODO');
    expect(ctx.bus.emitted).toHaveLength(0);
  });

  it('S1-AC4: reports a terminal DONE activity as INVALID_STATUS_TRANSITION and leaves it unchanged', async () => {
    const ctx = setup();
    const taskE = await seed(ctx, manager, 'DONE', 'E');
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(manager, { items: [{ id: taskE.id, status: 'BLOCKED' }] });

    expect(result.failed).toBe(1);
    expect(result.results).toEqual([{ id: taskE.id, outcome: 'FAILED', code: 'INVALID_STATUS_TRANSITION' }]);
    expect((await ctx.repo.findById(taskE.id))?.status).toBe('DONE');
    expect(ctx.bus.emitted).toHaveLength(0);
  });

  it('S1-AC5: rejects more than 50 items with ValidationError before touching the repository', async () => {
    const ctx = setup();
    const items = Array.from({ length: 51 }, () => ({ id: ids.unknown, status: 'DONE' as const }));

    await expect(ctx.service.bulkUpdateStatus(manager, { items })).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.bus.emitted).toHaveLength(0);
  });

  it('S1-AC6: processes a valid and a missing item independently, each with its own outcome and event count', async () => {
    const ctx = setup();
    const taskF = await seed(ctx, manager, 'IN_PROGRESS', 'F');
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(manager, {
      items: [
        { id: taskF.id, status: 'DONE' },
        { id: ids.unknown, status: 'DONE' },
      ],
    });

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toEqual([
      { id: taskF.id, outcome: 'UPDATED', from: 'IN_PROGRESS', to: 'DONE' },
      { id: ids.unknown, outcome: 'FAILED', code: 'NOT_FOUND' },
    ]);
    expect((await ctx.repo.findById(taskF.id))?.status).toBe('DONE');
    expect(ctx.bus.emitted.filter((e) => e.name === 'activity.status_changed')).toHaveLength(1);
    expect(ctx.bus.emitted.filter((e) => e.name === 'activity.bulk_status_updated')).toHaveLength(1);
  });

  it('S1-AC7: bulkUpdateStatusSchema rejects a status outside DONE/BLOCKED before any service call', () => {
    const outcome = bulkUpdateStatusSchema.safeParse({ items: [{ id: ids.unknown, status: 'IN_PROGRESS' }] });
    expect(outcome.success).toBe(false);
  });

  it('S1-AC8: reports TODO -> DONE as INVALID_STATUS_TRANSITION (DONE is only reachable from IN_PROGRESS) and leaves it unchanged', async () => {
    const ctx = setup();
    const taskH = await seed(ctx, manager, 'TODO', 'H');
    ctx.bus.emitted.length = 0;

    const result = await ctx.service.bulkUpdateStatus(manager, { items: [{ id: taskH.id, status: 'DONE' }] });

    expect(result.failed).toBe(1);
    expect(result.results).toEqual([{ id: taskH.id, outcome: 'FAILED', code: 'INVALID_STATUS_TRANSITION' }]);
    expect((await ctx.repo.findById(taskH.id))?.status).toBe('TODO');
    expect(ctx.bus.emitted).toHaveLength(0);
  });

  it('allows a non-creator, non-assignee supervisor to update (supervisor bypass)', async () => {
    const ctx = setup();
    const task = await seed(ctx, associate, 'TODO', 'Lead handled');
    ctx.bus.emitted.length = 0;
    const result = await ctx.service.bulkUpdateStatus(users.lead, { items: [{ id: task.id, status: 'BLOCKED' }] });
    expect(result.updated).toBe(1);
  });
});

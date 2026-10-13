import { randomUUID } from 'node:crypto';
import { canAccessStore, isStoreManager, isSupervisor } from '../shared/access';
import { TASK_STATUSES, type AuthUser } from '../shared/domain';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../shared/errors';
import type { EventBus } from '../shared/events';
import { paginate, parseInput, type Page } from '../shared/validate';
import type { ProgrammeDirectory, StaffDirectory } from './activities.ports';
import type { TaskRepository } from './activities.repository';
import { bulkUpdateStatusSchema, type BulkStatusInput, type CreateTaskInput, type ListTasksQuery, type UpdateTaskInput } from './activities.schemas';
import type { BulkStatusItemResult, BulkStatusResult, StoreTaskStats, Task, TaskStatus } from './activities.types';

/** Allowed status moves. DONE is terminal. */
const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ['IN_PROGRESS', 'BLOCKED'],
  IN_PROGRESS: ['TODO', 'DONE', 'BLOCKED'],
  BLOCKED: ['TODO', 'IN_PROGRESS'],
  DONE: [],
};

export class ActivitiesService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly programmes: ProgrammeDirectory,
    private readonly staff: StaffDirectory,
    private readonly bus: EventBus,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(user: AuthUser, query: ListTasksQuery): Promise<Page<Task>> {
    const scoped = await this.tasks.find({
      ...(user.role === 'REGIONAL_MANAGER' ? {} : { storeId: user.storeId }),
      ...(query.programmeId === undefined ? {} : { programmeId: query.programmeId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
    const ordered = [...scoped].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return paginate(ordered, query.limit, query.offset);
  }

  async get(user: AuthUser, id: string): Promise<Task> {
    return this.getAccessible(user, id);
  }

  async create(user: AuthUser, input: CreateTaskInput): Promise<Task> {
    const programme = await this.programmes.findSummaryById(input.programmeId);
    if (!programme || !canAccessStore(user, programme.storeId)) {
      throw new NotFoundError('Programme');
    }
    if (programme.status !== 'ACTIVE') {
      throw new ConflictError('PROGRAMME_CLOSED', 'Activities cannot be added to a closed programme');
    }
    if (input.assigneeId !== undefined) {
      await this.assertAssignable(input.assigneeId, programme.storeId);
    }
    const now = this.clock().toISOString();
    const task = await this.tasks.save({
      id: this.newId(),
      title: input.title,
      description: input.description ?? null,
      status: 'TODO',
      priority: input.priority,
      category: input.category,
      programmeId: programme.id,
      storeId: programme.storeId,
      assigneeId: input.assigneeId ?? null,
      createdBy: user.id,
      dueDate: input.dueDate ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (task.assigneeId !== null) {
      await this.emitAssigned(task, task.assigneeId);
    }
    return task;
  }

  async update(user: AuthUser, id: string, input: UpdateTaskInput): Promise<Task> {
    const task = await this.getAccessible(user, id);
    const isParticipant = task.createdBy === user.id || task.assigneeId === user.id;
    if (!isParticipant && !isSupervisor(user)) {
      throw new ForbiddenError('Only the creator, the assignee or a supervisor can update this activity');
    }
    const priorityChanged = input.priority !== undefined && input.priority !== task.priority;
    const assigneeChanged = input.assigneeId !== undefined && input.assigneeId !== task.assigneeId;
    if ((priorityChanged || assigneeChanged) && !isSupervisor(user)) {
      throw new ForbiddenError('Only supervisors can change priority or reassign an activity');
    }
    const nextStatus = input.status;
    const statusChanged = nextStatus !== undefined && nextStatus !== task.status;
    if (statusChanged) {
      this.assertTransition(task.status, nextStatus);
    }
    if (assigneeChanged && input.assigneeId) {
      await this.assertAssignable(input.assigneeId, task.storeId);
    }

    const updated = await this.tasks.save({ ...task, ...input, updatedAt: this.clock().toISOString() });

    if (assigneeChanged && updated.assigneeId !== null) {
      await this.emitAssigned(updated, updated.assigneeId);
    }
    if (statusChanged) {
      await this.bus.emit('activity.status_changed', {
        taskId: updated.id,
        title: updated.title,
        storeId: updated.storeId,
        assigneeId: updated.assigneeId,
        from: task.status,
        to: updated.status,
        priority: updated.priority,
      });
    }
    return updated;
  }

  /**
   * Moves up to 50 activities to DONE or BLOCKED in one call. Each item is judged independently against the
   * existing store-scoping, authorisation and transition rules; a bad item never aborts the others.
   */
  async bulkUpdateStatus(user: AuthUser, input: BulkStatusInput): Promise<BulkStatusResult> {
    const { items } = parseInput(bulkUpdateStatusSchema, input);
    const results: BulkStatusItemResult[] = [];
    let updated = 0;
    let failed = 0;
    for (const item of items) {
      try {
        const task = await this.getAccessible(user, item.id);
        const isParticipant = task.createdBy === user.id || task.assigneeId === user.id;
        if (!isParticipant && !isSupervisor(user)) {
          throw new ForbiddenError('Only the creator, the assignee or a supervisor can update this activity');
        }
        this.assertTransition(task.status, item.status);
        const from = task.status;
        const saved = await this.tasks.save({ ...task, status: item.status, updatedAt: this.clock().toISOString() });
        await this.bus.emit('activity.status_changed', {
          taskId: saved.id,
          title: saved.title,
          storeId: saved.storeId,
          assigneeId: saved.assigneeId,
          from,
          to: saved.status,
          priority: saved.priority,
        });
        await this.bus.emit('activity.bulk_status_updated', {
          taskId: saved.id,
          title: saved.title,
          storeId: saved.storeId,
          assigneeId: saved.assigneeId,
          createdBy: saved.createdBy,
          updatedBy: user.id,
          from,
          to: saved.status,
        });
        results.push({ id: item.id, outcome: 'UPDATED', from, to: saved.status });
        updated += 1;
      } catch (error) {
        if (error instanceof AppError) {
          results.push({ id: item.id, outcome: 'FAILED', code: error.code });
          failed += 1;
        } else {
          throw error;
        }
      }
    }
    return { results, updated, failed };
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    const task = await this.getAccessible(user, id);
    if (task.createdBy !== user.id && !isStoreManager(user)) {
      throw new ForbiddenError('Only the owner or a store manager can delete an activity');
    }
    await this.tasks.delete(task.id);
  }

  /** Read-only aggregate for the reports module (wired through ports in src/app.ts). */
  async getStoreStats(storeId: string): Promise<StoreTaskStats> {
    const storeTasks = await this.tasks.find({ storeId });
    const now = this.clock().toISOString();
    const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>;
    for (const task of storeTasks) {
      byStatus[task.status] += 1;
    }
    const overdue = storeTasks.filter((task) => task.status !== 'DONE' && task.dueDate !== null && task.dueDate < now).length;
    return {
      storeId,
      total: storeTasks.length,
      byStatus,
      overdue,
      completionRate: storeTasks.length === 0 ? 0 : byStatus.DONE / storeTasks.length,
    };
  }

  /** Cross-store ids are reported as not found so callers cannot probe other stores. */
  private async getAccessible(user: AuthUser, id: string): Promise<Task> {
    const task = await this.tasks.findById(id);
    if (!task || !canAccessStore(user, task.storeId)) {
      throw new NotFoundError('Activity');
    }
    return task;
  }

  private async assertAssignable(assigneeId: string, storeId: string): Promise<void> {
    const assignee = await this.staff.findProfileById(assigneeId);
    if (assignee?.storeId !== storeId) {
      throw new ValidationError('Assignee must be a staff member of the programme store', [
        { path: 'assigneeId', message: 'unknown staff member for this store' },
      ]);
    }
  }

  private assertTransition(from: TaskStatus, to: TaskStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictError('INVALID_STATUS_TRANSITION', `Cannot move an activity from ${from} to ${to}`);
    }
  }

  private async emitAssigned(task: Task, assigneeId: string): Promise<void> {
    await this.bus.emit('activity.assigned', {
      taskId: task.id,
      title: task.title,
      storeId: task.storeId,
      assigneeId,
      category: task.category,
      priority: task.priority,
    });
  }
}

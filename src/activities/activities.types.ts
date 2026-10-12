import type { TaskCategory, TaskPriority, TaskStatus } from '../shared/domain';

export type { TaskCategory, TaskPriority, TaskStatus };

/** An operational activity: a restocking run, planogram reset, compliance check or general store task. */
export interface Task {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly category: TaskCategory;
  readonly programmeId: string;
  readonly storeId: string;
  readonly assigneeId: string | null;
  readonly createdBy: string;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoreTaskStats {
  readonly storeId: string;
  readonly total: number;
  readonly byStatus: Record<TaskStatus, number>;
  readonly overdue: number;
  /** Fraction of tasks that are DONE, 0..1 (0 when there are no tasks). */
  readonly completionRate: number;
}

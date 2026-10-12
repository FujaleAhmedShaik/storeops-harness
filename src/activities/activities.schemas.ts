import { z } from 'zod';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES } from '../shared/domain';
import { paginationShape } from '../shared/validate';

const title = z.string().trim().min(1).max(120);
const description = z.string().trim().max(2000);

export const createTaskSchema = z.strictObject({
  title,
  description: description.optional(),
  programmeId: z.uuid(),
  assigneeId: z.uuid().optional(),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  category: z.enum(TASK_CATEGORIES).default('GENERAL'),
  dueDate: z.iso.datetime().optional(),
});

export const updateTaskSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    category: z.enum(TASK_CATEGORIES).optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided' });

export const listTasksQuerySchema = z.strictObject({
  programmeId: z.uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  ...paginationShape,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

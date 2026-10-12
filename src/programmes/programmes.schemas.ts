import { z } from 'zod';
import { PROJECT_ROLES } from '../shared/domain';
import { paginationShape } from '../shared/validate';

export const createProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export const addMemberSchema = z.strictObject({
  userId: z.uuid(),
  role: z.enum(PROJECT_ROLES),
});

export const listProjectsQuerySchema = z.strictObject({ ...paginationShape });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from '../shared/password';

export const loginSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;

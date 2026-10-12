import { z } from 'zod';
import { paginationShape } from '../shared/validate';
import { NOTIFICATION_STATUSES } from './alerts.types';

export const listAlertsQuerySchema = z.strictObject({
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  ...paginationShape,
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;

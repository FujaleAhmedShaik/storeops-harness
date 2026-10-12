import { Router } from 'express';
import { asyncHandler, currentUser } from '../shared/http';
import { parseInput } from '../shared/validate';
import { listAlertsQuerySchema } from './alerts.schemas';
import type { AlertsService } from './alerts.service';

export function createAlertsRouter(service: AlertsService): Router {
  const router = Router();
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await service.listForUser(currentUser(req), parseInput(listAlertsQuerySchema, req.query)));
    }),
  );
  return router;
}

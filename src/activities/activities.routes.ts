import { Router } from 'express';
import { asyncHandler, currentUser } from '../shared/http';
import { idParamSchema, parseInput } from '../shared/validate';
import { bulkUpdateStatusSchema, createTaskSchema, listTasksQuerySchema, updateTaskSchema } from './activities.schemas';
import type { ActivitiesService } from './activities.service';

export function createActivitiesRouter(service: ActivitiesService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await service.list(currentUser(req), parseInput(listTasksQuerySchema, req.query)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.create(currentUser(req), parseInput(createTaskSchema, req.body)));
    }),
  );

  // Fixed path: must stay before the '/:id' routes so "bulk-status" is not parsed as an id.
  router.patch(
    '/bulk-status',
    asyncHandler(async (req, res) => {
      res.json(await service.bulkUpdateStatus(currentUser(req), parseInput(bulkUpdateStatusSchema, req.body)));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParamSchema, req.params);
      res.json(await service.get(currentUser(req), id));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParamSchema, req.params);
      res.json(await service.update(currentUser(req), id, parseInput(updateTaskSchema, req.body)));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParamSchema, req.params);
      await service.delete(currentUser(req), id);
      res.status(204).end();
    }),
  );

  return router;
}

import { Router } from 'express';
import { asyncHandler, currentUser } from '../shared/http';
import { idParamSchema, parseInput } from '../shared/validate';
import { addMemberSchema, createProjectSchema, listProjectsQuerySchema } from './programmes.schemas';
import type { ProgrammesService } from './programmes.service';

export function createProgrammesRouter(service: ProgrammesService): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await service.list(currentUser(req), parseInput(listProjectsQuerySchema, req.query)));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      res.status(201).json(await service.create(currentUser(req), parseInput(createProjectSchema, req.body)));
    }),
  );

  router.post(
    '/:id/members',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(idParamSchema, req.params);
      res.status(201).json(await service.addMember(currentUser(req), id, parseInput(addMemberSchema, req.body)));
    }),
  );

  return router;
}

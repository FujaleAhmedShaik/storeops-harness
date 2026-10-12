import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../shared/http';
import { parseInput } from '../shared/validate';
import { loginSchema } from './staff.schemas';
import type { StaffService } from './staff.service';

/** POST /api/auth/login - the only unauthenticated API route. `loginLimiter` throttles credential guessing. */
export function createAuthRouter(service: StaffService, loginLimiter: RequestHandler): Router {
  const router = Router();
  router.post(
    '/login',
    loginLimiter,
    asyncHandler(async (req, res) => {
      const token = await service.login(parseInput(loginSchema, req.body));
      res.status(200).json(token);
    }),
  );
  return router;
}

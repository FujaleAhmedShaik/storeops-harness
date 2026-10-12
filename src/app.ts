import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ActivitiesService } from './activities/activities.service';
import { InMemoryTaskRepository } from './activities/activities.repository';
import { createActivitiesRouter } from './activities/activities.routes';
import { AlertsService } from './alerts/alerts.service';
import { InMemoryNotificationRepository } from './alerts/alerts.repository';
import { createAlertsRouter } from './alerts/alerts.routes';
import { ProgrammesService } from './programmes/programmes.service';
import { InMemoryProjectRepository } from './programmes/programmes.repository';
import { createProgrammesRouter } from './programmes/programmes.routes';
import { ReportsService } from './reports/reports.service';
import { InMemoryReportRepository } from './reports/reports.repository';
import { InMemoryUserRepository } from './staff/staff.repository';
import { createAuthRouter } from './staff/staff.routes';
import { seedDemoUsers, type SeededUser } from './staff/staff.seed';
import { StaffService } from './staff/staff.service';
import type { AppConfig } from './shared/config';
import { InMemoryEventBus } from './shared/event-bus';
import type { EventBus } from './shared/events';
import { authenticate, errorHandler, notFoundHandler, requestContext, requestLogger } from './shared/http';
import type { Logger } from './shared/logger';
import { FAST_TEST_COST, STRONG_COST } from './shared/password';
import { TokenService } from './shared/token';

export interface AppContext {
  readonly app: Express;
  readonly bus: EventBus;
  readonly seededUsers: readonly SeededUser[];
  readonly reports: ReportsService;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

function limiter(windowMs: number, limit: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please retry later' } },
  });
}

/**
 * Composition root. This is the ONLY place modules are connected: ports are satisfied by the
 * target module's service (read-only lookups) and side effects flow through the event bus.
 */
export async function createApp(config: AppConfig, logger: Logger): Promise<AppContext> {
  const bus = new InMemoryEventBus(logger);
  const tokens = new TokenService({ ...config.jwt, ttlSeconds: config.jwt.ttlSeconds });

  const users = new InMemoryUserRepository();
  const cost = config.nodeEnv === 'test' ? FAST_TEST_COST : STRONG_COST;
  const staff = new StaffService(users, tokens, cost);
  const seededUsers =
    config.seedDemoData && config.demoPassword !== undefined ? await seedDemoUsers(users, config.demoPassword, cost) : [];

  const programmes = new ProgrammesService(new InMemoryProjectRepository(), staff);
  const activities = new ActivitiesService(new InMemoryTaskRepository(), programmes, staff, bus);
  const alerts = new AlertsService(new InMemoryNotificationRepository(), staff);
  const reports = new ReportsService(new InMemoryReportRepository(), activities);
  alerts.registerEventHandlers(bus);
  reports.registerEventHandlers(bus);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops);
  app.set('query parser', 'simple');

  app.use(requestContext);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(limiter(config.rateLimit.windowMs, config.rateLimit.max));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', (_req, res) => {
    res.json({ status: 'ready' });
  });

  app.use('/api', noStore, express.json({ limit: '16kb' }));
  app.use('/api/auth', createAuthRouter(staff, limiter(config.rateLimit.windowMs, config.rateLimit.loginMax)));

  const requireAuth = authenticate(tokens);
  app.use('/api/activities', requireAuth, createActivitiesRouter(activities));
  app.use('/api/programmes', requireAuth, createProgrammesRouter(programmes));
  app.use('/api/alerts', requireAuth, createAlertsRouter(alerts));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return { app, bus, seededUsers, reports };
}

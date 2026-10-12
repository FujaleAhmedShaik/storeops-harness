import { z } from 'zod';
import { ConfigurationError } from './errors';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'prod']).default('local'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ISSUER: z.string().min(1).default('storeops-api'),
    JWT_AUDIENCE: z.string().min(1).default('storeops-clients'),
    JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    SEED_DEMO_DATA: booleanString.default(false),
    DEMO_PASSWORD: z.string().min(16, 'must be at least 16 characters').optional(),
  })
  .superRefine((env, ctx) => {
    if (env.SEED_DEMO_DATA && env.APP_ENV === 'prod') {
      ctx.addIssue({ code: 'custom', path: ['SEED_DEMO_DATA'], message: 'demo data is not allowed when APP_ENV=prod' });
    }
    if (env.NODE_ENV === 'test' && env.APP_ENV !== 'local') {
      ctx.addIssue({ code: 'custom', path: ['NODE_ENV'], message: 'test mode (reduced password cost) is only allowed when APP_ENV=local' });
    }
    if (env.SEED_DEMO_DATA && env.DEMO_PASSWORD === undefined) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_PASSWORD'], message: 'required when SEED_DEMO_DATA=true' });
    }
  });

export interface AppConfig {
  readonly appEnv: 'local' | 'dev' | 'prod';
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly jwt: { readonly secret: string; readonly issuer: string; readonly audience: string; readonly ttlSeconds: number };
  readonly trustProxyHops: number;
  readonly rateLimit: { readonly windowMs: number; readonly max: number; readonly loginMax: number };
  readonly seedDemoData: boolean;
  readonly demoPassword: string | undefined;
}

/** Validates the environment once at startup. Error messages name variables, never their values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new ConfigurationError(`Invalid environment configuration - ${problems}`);
  }
  const values = parsed.data;
  return {
    appEnv: values.APP_ENV,
    nodeEnv: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    logLevel: values.LOG_LEVEL,
    jwt: { secret: values.JWT_SECRET, issuer: values.JWT_ISSUER, audience: values.JWT_AUDIENCE, ttlSeconds: values.JWT_TTL_SECONDS },
    trustProxyHops: values.TRUST_PROXY_HOPS,
    rateLimit: { windowMs: values.RATE_LIMIT_WINDOW_MS, max: values.RATE_LIMIT_MAX, loginMax: values.LOGIN_RATE_LIMIT_MAX },
    seedDemoData: values.SEED_DEMO_DATA,
    demoPassword: values.DEMO_PASSWORD,
  };
}

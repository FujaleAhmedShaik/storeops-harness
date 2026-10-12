import { loadConfig } from '../../src/shared/config';
import { ConfigurationError } from '../../src/shared/errors';

const secret = 'x'.repeat(40);

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({ JWT_SECRET: secret });
    expect(config).toMatchObject({
      appEnv: 'local',
      host: '127.0.0.1',
      port: 3000,
      seedDemoData: false,
      trustProxyHops: 0,
      jwt: { issuer: 'storeops-api', audience: 'storeops-clients', ttlSeconds: 900 },
      rateLimit: { windowMs: 60_000, max: 300, loginMax: 10 },
    });
    expect(config.demoPassword).toBeUndefined();
  });

  it('reads explicit values', () => {
    const config = loadConfig({
      JWT_SECRET: secret,
      PORT: '8080',
      HOST: '0.0.0.0',
      APP_ENV: 'dev',
      LOG_LEVEL: 'warn',
      TRUST_PROXY_HOPS: '1',
      SEED_DEMO_DATA: 'true',
      DEMO_PASSWORD: 'p'.repeat(16),
    });
    expect(config).toMatchObject({ port: 8080, host: '0.0.0.0', appEnv: 'dev', logLevel: 'warn', trustProxyHops: 1 });
    expect(config.seedDemoData).toBe(true);
  });

  it('rejects a missing or short JWT secret without echoing it', () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(() => loadConfig({ JWT_SECRET: 'short-secret-value' })).toThrow(/JWT_SECRET: must be at least 32 characters/);
    try {
      loadConfig({ JWT_SECRET: 'short-secret-value' });
    } catch (error) {
      expect((error as Error).message).not.toContain('short-secret-value');
    }
  });

  it('accepts every documented log level and the minimum rate-limit window', () => {
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']) {
      expect(loadConfig({ JWT_SECRET: secret, LOG_LEVEL: level }).logLevel).toBe(level);
    }
    expect(loadConfig({ JWT_SECRET: secret, RATE_LIMIT_WINDOW_MS: '1000' }).rateLimit.windowMs).toBe(1000);
    expect(() => loadConfig({ JWT_SECRET: secret, RATE_LIMIT_WINDOW_MS: '999' })).toThrow(/RATE_LIMIT_WINDOW_MS/);
    expect(() => loadConfig({ JWT_SECRET: secret, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('rejects demo data in prod', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: secret, APP_ENV: 'prod', SEED_DEMO_DATA: 'true', DEMO_PASSWORD: 'p'.repeat(16) }),
    ).toThrow(/SEED_DEMO_DATA: demo data is not allowed when APP_ENV=prod/);
  });

  it('refuses test mode (reduced password cost) outside local', () => {
    expect(() => loadConfig({ JWT_SECRET: secret, NODE_ENV: 'test', APP_ENV: 'dev' })).toThrow('NODE_ENV: test mode (reduced password cost) is only allowed when APP_ENV=local');
    expect(() => loadConfig({ JWT_SECRET: secret, NODE_ENV: 'test', APP_ENV: 'local' })).not.toThrow();
  });

  it('requires a demo password when seeding', () => {
    expect(() => loadConfig({ JWT_SECRET: secret, SEED_DEMO_DATA: 'true' })).toThrow(/DEMO_PASSWORD: required when SEED_DEMO_DATA=true/);
  });

  it('reports every problem at once, separated by semicolons', () => {
    expect(() => loadConfig({ PORT: '-1' })).toThrow(/PORT: .*; JWT_SECRET: /);
  });

  it('rejects out-of-range numbers', () => {
    expect(() => loadConfig({ JWT_SECRET: secret, PORT: '70000' })).toThrow(ConfigurationError);
    expect(() => loadConfig({ JWT_SECRET: secret, JWT_TTL_SECONDS: '5' })).toThrow(ConfigurationError);
  });

  it('reads process.env by default', () => {
    const original = process.env.JWT_SECRET;
    process.env.JWT_SECRET = secret;
    try {
      expect(loadConfig().jwt.secret).toBe(secret);
    } finally {
      if (original === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = original;
      }
    }
  });
});

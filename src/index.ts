import { loadConfig } from './shared/config';
import { createLogger } from './shared/logger';
import { startServer } from './server';

/** Process entry point. Excluded from coverage: it only wires config, signals and exit codes. */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const running = await startServer(config, logger);

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    running.close().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((error: unknown) => {
  // Logger may not exist if configuration is invalid; stderr is the only safe channel.
  process.stderr.write(`startup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});

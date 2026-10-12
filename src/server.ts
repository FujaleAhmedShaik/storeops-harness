import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app';
import type { AppConfig } from './shared/config';
import type { Logger } from './shared/logger';

export interface RunningServer {
  readonly port: number;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** How long `close()` waits for in-flight connections before destroying them. */
  readonly shutdownGraceMs?: number;
}

const KEEP_ALIVE_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

/** Starts the HTTP server with hardened timeouts. `close()` drains connections for graceful shutdown. */
export async function startServer(config: AppConfig, logger: Logger, options: ServerOptions = {}): Promise<RunningServer> {
  const graceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  const { app } = await createApp(config, logger);
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(config.port, config.host, () => {
      resolve(listening);
    });
  });
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;

  const { port } = server.address() as AddressInfo;
  logger.info({ port, appEnv: config.appEnv }, 'storeops api listening');

  return {
    port,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        const forceClose = setTimeout(() => {
          server.closeAllConnections();
        }, graceMs);
        server.close((error) => {
          clearTimeout(forceClose);
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        server.closeIdleConnections();
      }),
  };
}

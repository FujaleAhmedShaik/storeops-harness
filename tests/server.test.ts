import net from 'node:net';
import { startServer } from '../src/server';
import { createLogger } from '../src/shared/logger';
import { testConfig } from './helpers/world';

const config = testConfig({ PORT: '0' });
const logger = createLogger('silent');

describe('startServer', () => {
  it('listens, serves requests and shuts down gracefully', async () => {
    const running = await startServer(config, logger);
    const response = await fetch(`http://127.0.0.1:${running.port}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await running.close();
    await expect(fetch(`http://127.0.0.1:${running.port}/health/live`)).rejects.toThrow();
  });

  it('reports an error when closed twice', async () => {
    const running = await startServer(config, logger);
    await running.close();
    await expect(running.close()).rejects.toThrow();
  });

  it('force-closes connections that outlive the grace period', async () => {
    const running = await startServer(config, logger, { shutdownGraceMs: 50 });
    const socket = net.connect(running.port, '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write('GET /health/live HTTP/1.1\r\nHost: localhost\r\n'); // headers never completed
    const started = Date.now();
    await running.close();
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    socket.destroy();
  });
});

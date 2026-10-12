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
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    socket.on('error', () => {}); // the forced close below resets this socket; that's expected
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    // Headers complete (so the server treats the connection as busy, not idle) but the declared
    // body never arrives, so the request handler hangs until force-closed.
    socket.write(
      'POST /api/activities HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 10\r\nConnection: keep-alive\r\n\r\n',
    );
    // Give the server a moment to parse the headers and mark the connection busy before closing -
    // otherwise close() can race ahead and find the connection still idle.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    await running.close();
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    socket.destroy();
  });
});

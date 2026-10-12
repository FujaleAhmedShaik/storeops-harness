import { Writable } from 'node:stream';
import { InMemoryEventBus } from '../../src/shared/event-bus';
import { createLogger } from '../../src/shared/logger';

const closed = { projectId: 'p1', storeId: 'store-001' };

function captureLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createLogger('info', sink), lines };
}

describe('InMemoryEventBus', () => {
  it('delivers a payload to every handler of that event only', async () => {
    const bus = new InMemoryEventBus(createLogger('silent'));
    const received: string[] = [];
    bus.on('programme.closed', (event) => {
      received.push(`a:${event.storeId}`);
    });
    bus.on('programme.closed', async (event) => {
      received.push(`b:${event.storeId}`);
      return Promise.resolve();
    });
    bus.on('activity.assigned', () => {
      received.push('wrong-event');
    });

    await bus.emit('programme.closed', closed);

    expect(received).toEqual(['a:store-001', 'b:store-001']);
  });

  it('is a no-op when nothing is subscribed', async () => {
    const bus = new InMemoryEventBus(createLogger('silent'));
    await expect(bus.emit('programme.closed', closed)).resolves.toBeUndefined();
  });

  it('isolates a failing handler: others still run, the emitter is not failed, and the failure is logged', async () => {
    const { logger, lines } = captureLogger();
    const bus = new InMemoryEventBus(logger);
    const survivor = jest.fn();
    bus.on('programme.closed', () => {
      throw new Error('handler exploded');
    });
    bus.on('programme.closed', survivor);

    await expect(bus.emit('programme.closed', closed)).resolves.toBeUndefined();

    expect(survivor).toHaveBeenCalledWith(closed);
    expect(lines.join('')).toContain('event handler failed');
    expect(lines.join('')).toContain('programme.closed');
  });
});

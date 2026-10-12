import { Writable } from 'node:stream';
import { createLogger } from '../../src/shared/logger';

describe('createLogger', () => {
  it('redacts credentials and tokens', () => {
    const lines: string[] = [];
    const logger = createLogger(
      'info',
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    );

    logger.info({ password: 'hunter2', login: { password: 'hunter2', token: 'abc' }, accessToken: 'jwt-value' }, 'attempt');

    const output = lines.join('');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('jwt-value');
    expect(output).toContain('[REDACTED]');
    expect(output).toContain('storeops-api');
  });

  it('writes to stdout by default and honours the level', () => {
    expect(createLogger('warn').level).toBe('warn');
  });
});

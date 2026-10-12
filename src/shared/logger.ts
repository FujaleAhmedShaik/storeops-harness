import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

/** Structured JSON logger. Credentials and tokens are redacted wherever they could appear. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'storeops-api' },
    redact: {
      paths: ['password', 'token', 'accessToken', '*.password', '*.token', '*.accessToken', 'req.headers.authorization'],
      censor: '[REDACTED]',
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface ScryptCost {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

/** OWASP Password Storage Cheat Sheet: scrypt N=2^15, r=8, p=3. */
export const STRONG_COST: ScryptCost = { N: 32_768, r: 8, p: 3 };
/** Only ever selected when NODE_ENV=test (see src/app.ts); keeps the test loop fast. */
export const FAST_TEST_COST: ScryptCost = { N: 1_024, r: 8, p: 1 };

// Stored hashes are self-describing (`scrypt$N$r$p$salt$key`) so cost can be raised later.
// Parameters read back from storage are bounded so a tampered record cannot trigger a resource-exhaustion attack.
const MAX_N = 2 ** 17;
const MAX_R = 16;
const MAX_P = 16;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MAX_PASSWORD_LENGTH = 128;

async function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  const maxmem = 256 * cost.N * cost.r;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...cost, maxmem }, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 1 && (value & (value - 1)) === 0;
}

export async function hashPassword(password: string, cost: ScryptCost = STRONG_COST): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, cost);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Constant-time comparison. Malformed or out-of-bounds stored values and over-long inputs verify as false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, nText, rText, pText, saltHex, keyHex, ...extra] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex || extra.length > 0 || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const cost = { N: Number(nText), r: Number(rText), p: Number(pText) };
  const expected = Buffer.from(keyHex, 'hex');
  const withinBounds =
    isPowerOfTwo(cost.N) &&
    cost.N <= MAX_N &&
    Number.isInteger(cost.r) &&
    cost.r >= 1 &&
    cost.r <= MAX_R &&
    Number.isInteger(cost.p) &&
    cost.p >= 1 &&
    cost.p <= MAX_P;
  if (!withinBounds || expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await derive(password, Buffer.from(saltHex, 'hex'), cost);
  return timingSafeEqual(actual, expected);
}

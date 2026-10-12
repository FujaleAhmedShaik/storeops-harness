import { FAST_TEST_COST, hashPassword, MAX_PASSWORD_LENGTH, STRONG_COST, verifyPassword } from '../../src/shared/password';

const sample = 'correct-horse-battery-staple';
const key = '0'.repeat(128);

/** Splits a freshly produced hash so tests can edit exactly one field. */
async function parts(cost = FAST_TEST_COST): Promise<{ salt: string; key: string }> {
  const [, , , , salt = '', derived = ''] = (await hashPassword(sample, cost)).split('$');
  return { salt, key: derived };
}

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword(sample, FAST_TEST_COST);
    await expect(verifyPassword(sample, stored)).resolves.toBe(true);
    await expect(verifyPassword(`${sample}!`, stored)).resolves.toBe(false);
  });

  it('defaults to the OWASP-strength cost and records it in the hash', async () => {
    const stored = await hashPassword(sample);
    expect(stored.startsWith(`scrypt$${STRONG_COST.N}$${STRONG_COST.r}$${STRONG_COST.p}$`)).toBe(true);
    await expect(verifyPassword(sample, stored)).resolves.toBe(true);
  });

  it('salts every hash and never stores the plain password', async () => {
    const [first, second] = await Promise.all([hashPassword(sample, FAST_TEST_COST), hashPassword(sample, FAST_TEST_COST)]);
    expect(first).not.toBe(second);
    expect(first).not.toContain(sample);
    expect(first).toMatch(/^scrypt\$1024\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  });

  it.each([
    ['empty', ''],
    ['no separators', 'nocolon'],
    ['wrong scheme', `bcrypt$1024$8$1$aa$${key}`],
    ['missing key', 'scrypt$1024$8$1$aa$'],
    ['missing salt', `scrypt$1024$8$1$$${key}`],
    ['short key', 'scrypt$1024$8$1$aa$00'],
    ['N not a power of two', `scrypt$1000$8$1$aa$${key}`],
    ['N too large (DoS guard)', `scrypt$${2 ** 30}$8$1$aa$${key}`],
    ['non-numeric cost', `scrypt$abc$8$1$aa$${key}`],
    ['fractional r', `scrypt$1024$8.5$1$aa$${key}`],
    ['fractional p', `scrypt$1024$8$1.5$aa$${key}`],
  ])('treats a malformed stored value (%s) as a mismatch', async (_label, stored) => {
    await expect(verifyPassword(sample, stored)).resolves.toBe(false);
  });

  it('rejects over-long input even when it matches the stored hash', async () => {
    const tooLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    await expect(verifyPassword(tooLong, await hashPassword(tooLong, FAST_TEST_COST))).resolves.toBe(false);
    const atLimit = 'a'.repeat(MAX_PASSWORD_LENGTH);
    await expect(verifyPassword(atLimit, await hashPassword(atLimit, FAST_TEST_COST))).resolves.toBe(true);
  });

  describe('each guard is tested with an otherwise-valid hash, so it is the only reason for rejection', () => {
    it('rejects a different scheme name or trailing fields', async () => {
      const valid = await hashPassword(sample, FAST_TEST_COST);
      await expect(verifyPassword(sample, valid)).resolves.toBe(true);
      await expect(verifyPassword(sample, valid.replace('scrypt', 'bcrypt'))).resolves.toBe(false);
      await expect(verifyPassword(sample, `${valid}$extra`)).resolves.toBe(false);
    });

    it.each([
      [{ N: 1_024, r: 1, p: 1 }, true],
      [{ N: 1_024, r: 16, p: 1 }, true],
      [{ N: 1_024, r: 17, p: 1 }, false],
      [{ N: 1_024, r: 8, p: 16 }, true],
      [{ N: 1_024, r: 8, p: 17 }, false],
      [{ N: 2_048, r: 8, p: 1 }, true],
    ])('cost %j is accepted: %s', async (cost, accepted) => {
      const stored = await hashPassword(sample, cost);
      await expect(verifyPassword(sample, stored)).resolves.toBe(accepted);
    });

    it('rejects r=0, p=0, N=1 and non-power-of-two N without attempting to derive a key', async () => {
      const { salt, key: derived } = await parts();
      for (const cost of ['1024$0$1', '1024$8$0', '1$8$1', '3$8$1']) {
        await expect(verifyPassword(sample, `scrypt$${cost}$${salt}$${derived}`)).resolves.toBe(false);
      }
    });

    it('accepts the maximum N only when the derived key really matches', async () => {
      const { salt, key: derived } = await parts();
      await expect(verifyPassword(sample, `scrypt$${2 ** 17}$8$1$${salt}$${derived}`)).resolves.toBe(false);
    });
  });
});

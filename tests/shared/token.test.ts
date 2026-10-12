import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../src/shared/errors';
import { TokenService } from '../../src/shared/token';
import { users } from '../helpers/fakes';

const options = { secret: 's'.repeat(48), issuer: 'storeops-api', audience: 'storeops-clients', ttlSeconds: 900 };
const service = new TokenService(options);
const manager = users.manager;

function forge(payload: object, overrides: jwt.SignOptions = {}, secret = options.secret): string {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    issuer: options.issuer,
    audience: options.audience,
    subject: manager.id,
    expiresIn: 300,
    ...overrides,
  });
}

describe('TokenService', () => {
  it('round-trips the caller identity', () => {
    const token = service.issue(manager);
    expect(token).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(service.verify(token.accessToken)).toEqual(manager);
  });

  it('rejects a token signed with another secret', () => {
    const token = forge({ role: manager.role, storeId: manager.storeId }, {}, 'z'.repeat(48));
    expect(() => service.verify(token)).toThrow(UnauthorizedError);
  });

  it('rejects the "none" algorithm', () => {
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: manager.id, role: 'REGIONAL_MANAGER', storeId: 'x', iss: options.issuer, aud: options.audience }),
    ).toString('base64url')}.`;
    expect(() => service.verify(unsigned)).toThrow(UnauthorizedError);
  });

  it('rejects another HMAC algorithm (algorithm is pinned to HS256)', () => {
    const token = forge({ role: manager.role, storeId: manager.storeId }, { algorithm: 'HS512' });
    expect(() => service.verify(token)).toThrow(UnauthorizedError);
  });

  it('rejects wrong issuer, wrong audience and expired tokens', () => {
    const claims = { role: manager.role, storeId: manager.storeId };
    expect(() => service.verify(forge(claims, { issuer: 'someone-else' }))).toThrow(UnauthorizedError);
    expect(() => service.verify(forge(claims, { audience: 'other-clients' }))).toThrow(UnauthorizedError);
    expect(() => service.verify(forge(claims, { expiresIn: -10 }))).toThrow(UnauthorizedError);
  });

  it('rejects claims that fail schema validation', () => {
    expect(() => service.verify(forge({ role: 'SUPERUSER', storeId: manager.storeId }))).toThrow(UnauthorizedError);
    expect(() => service.verify(forge({ role: manager.role, storeId: manager.storeId }, { subject: 'not-a-uuid' }))).toThrow(
      UnauthorizedError,
    );
    expect(() => service.verify(forge({ role: manager.role }))).toThrow(UnauthorizedError);
  });

  it('rejects garbage without leaking the reason', () => {
    expect(() => service.verify('not.a.jwt')).toThrow('Invalid or expired token');
  });
});

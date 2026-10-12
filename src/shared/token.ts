import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { STAFF_ROLES, type AuthUser } from './domain';
import { UnauthorizedError } from './errors';

export interface TokenOptions {
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly ttlSeconds: number;
}

export interface AuthToken {
  readonly accessToken: string;
  readonly tokenType: 'Bearer';
  readonly expiresIn: number;
}

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(STAFF_ROLES),
  storeId: z.string().min(1).max(64),
});

/** Issues and verifies HS256 access tokens. The algorithm is pinned; `none` and RS/HS confusion are rejected. */
export class TokenService {
  constructor(private readonly options: TokenOptions) {}

  issue(user: AuthUser): AuthToken {
    const accessToken = jwt.sign({ role: user.role, storeId: user.storeId }, this.options.secret, {
      algorithm: 'HS256',
      subject: user.id,
      issuer: this.options.issuer,
      audience: this.options.audience,
      expiresIn: this.options.ttlSeconds,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.options.ttlSeconds };
  }

  verify(token: string): AuthUser {
    try {
      const decoded = jwt.verify(token, this.options.secret, {
        algorithms: ['HS256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
      const claims = claimsSchema.parse(decoded);
      return { id: claims.sub, role: claims.role, storeId: claims.storeId };
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}

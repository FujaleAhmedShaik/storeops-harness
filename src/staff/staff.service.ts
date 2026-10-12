import { UnauthorizedError } from '../shared/errors';
import { hashPassword, STRONG_COST, verifyPassword, type ScryptCost } from '../shared/password';
import type { AuthToken, TokenService } from '../shared/token';
import type { UserRepository } from './staff.repository';
import type { LoginInput } from './staff.schemas';
import type { UserProfile } from './staff.types';

const INVALID_CREDENTIALS = 'Invalid email or password';

export class StaffService {
  /** Created on first use (constructors must not start async work). */
  private decoyHash: Promise<string> | undefined;

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenService,
    private readonly cost: ScryptCost = STRONG_COST,
  ) {}

  /** Verified against when the email is unknown so response time does not reveal which emails exist. */
  private decoy(): Promise<string> {
    this.decoyHash ??= hashPassword('decoy-password-never-matches', this.cost);
    return this.decoyHash;
  }

  async login(input: LoginInput): Promise<AuthToken> {
    const user = await this.users.findByEmail(input.email);
    const stored = user?.passwordHash ?? (await this.decoy());
    const passwordMatches = await verifyPassword(input.password, stored);
    if (!user || !passwordMatches) {
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }
    return this.tokens.issue({ id: user.id, role: user.role, storeId: user.storeId });
  }

  /** Read-only lookup for other modules (wired through ports in src/app.ts). */
  async findProfileById(id: string): Promise<UserProfile | null> {
    const user = await this.users.findById(id);
    return user ? { id: user.id, name: user.name, role: user.role, storeId: user.storeId } : null;
  }

  /** Read-only lookup for the alerts module. */
  async findStoreManagerIds(storeId: string): Promise<string[]> {
    const managers = await this.users.findByStoreAndRole(storeId, 'STORE_MANAGER');
    return managers.map((manager) => manager.id);
  }
}

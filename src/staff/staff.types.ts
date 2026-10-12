import type { StaffRole } from '../shared/domain';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly storeId: string;
  /** scrypt hash, never serialised to clients. */
  readonly passwordHash: string;
}

/** Public projection of a user: no credentials. */
export interface UserProfile {
  readonly id: string;
  readonly name: string;
  readonly role: StaffRole;
  readonly storeId: string;
}

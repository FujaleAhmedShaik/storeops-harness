import type { AuthUser, StaffRole } from './domain';

const ROLE_RANK: Record<StaffRole, number> = {
  ASSOCIATE: 1,
  DEPARTMENT_LEAD: 2,
  STORE_MANAGER: 3,
  REGIONAL_MANAGER: 4,
};

export function roleRank(role: StaffRole): number {
  return ROLE_RANK[role];
}

/** Managers and department leads may reassign work and change priority. */
export function isSupervisor(user: AuthUser): boolean {
  return roleRank(user.role) >= roleRank('DEPARTMENT_LEAD');
}

/** Store managers (and above) may delete work and manage programmes. */
export function isStoreManager(user: AuthUser): boolean {
  return roleRank(user.role) >= roleRank('STORE_MANAGER');
}

/** Object-level authorisation: callers only see their own store; regional managers see all stores. */
export function canAccessStore(user: AuthUser, storeId: string): boolean {
  return user.role === 'REGIONAL_MANAGER' || user.storeId === storeId;
}

import { randomUUID } from 'node:crypto';
import type { StaffRole } from '../shared/domain';
import { hashPassword, STRONG_COST, type ScryptCost } from '../shared/password';
import type { UserRepository } from './staff.repository';

export interface SeededUser {
  readonly id: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly storeId: string;
}

const DEMO_STAFF: readonly { name: string; email: string; role: StaffRole; storeId: string }[] = [
  { name: 'Riley Regional', email: 'regional.manager@storeops.example', role: 'REGIONAL_MANAGER', storeId: 'region-001' },
  { name: 'Morgan Manager', email: 'manager.s1@storeops.example', role: 'STORE_MANAGER', storeId: 'store-001' },
  { name: 'Devon Lead', email: 'lead.s1@storeops.example', role: 'DEPARTMENT_LEAD', storeId: 'store-001' },
  { name: 'Alex Associate', email: 'associate.s1@storeops.example', role: 'ASSOCIATE', storeId: 'store-001' },
  { name: 'Sam Manager', email: 'manager.s2@storeops.example', role: 'STORE_MANAGER', storeId: 'store-002' },
];

/** Local/dev demo users. The password comes from configuration, never from source. */
export async function seedDemoUsers(users: UserRepository, password: string, cost: ScryptCost = STRONG_COST): Promise<SeededUser[]> {
  return Promise.all(
    DEMO_STAFF.map(async (member) => {
      const id = randomUUID();
      await users.save({ id, ...member, passwordHash: await hashPassword(password, cost) });
      return { id, email: member.email, role: member.role, storeId: member.storeId };
    }),
  );
}

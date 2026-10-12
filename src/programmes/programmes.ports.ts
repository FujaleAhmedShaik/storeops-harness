import type { StaffRole } from '../shared/domain';

/** Read-only view of staff that programmes needs. Implemented by StaffService and wired in src/app.ts. */
export interface StaffDirectory {
  findProfileById(id: string): Promise<{ id: string; role: StaffRole; storeId: string } | null>;
}

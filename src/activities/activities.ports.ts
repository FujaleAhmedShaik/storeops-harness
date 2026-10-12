import type { ProjectStatus, StaffRole } from '../shared/domain';

/** Read-only view of programmes that activities needs. Implemented by ProgrammesService, wired in src/app.ts. */
export interface ProgrammeDirectory {
  findSummaryById(id: string): Promise<{ id: string; storeId: string; status: ProjectStatus } | null>;
}

/** Read-only view of staff that activities needs. Implemented by StaffService, wired in src/app.ts. */
export interface StaffDirectory {
  findProfileById(id: string): Promise<{ id: string; role: StaffRole; storeId: string } | null>;
}

import type { ProjectRole, ProjectStatus } from '../shared/domain';

export interface ProjectMember {
  readonly userId: string;
  readonly role: ProjectRole;
  readonly addedAt: string;
}

/** A store programme: a seasonal rollout, compliance drive or refit. */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly storeId: string;
  readonly ownerId: string;
  readonly status: ProjectStatus;
  readonly members: readonly ProjectMember[];
  readonly createdAt: string;
}

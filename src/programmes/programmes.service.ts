import { randomUUID } from 'node:crypto';
import { canAccessStore, isStoreManager, roleRank } from '../shared/access';
import type { AuthUser, ProjectStatus } from '../shared/domain';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../shared/errors';
import { paginate, type Page } from '../shared/validate';
import type { StaffDirectory } from './programmes.ports';
import type { ProjectRepository } from './programmes.repository';
import type { AddMemberInput, CreateProjectInput, ListProjectsQuery } from './programmes.schemas';
import type { Project } from './programmes.types';

export class ProgrammesService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly staff: StaffDirectory,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(user: AuthUser, query: ListProjectsQuery): Promise<Page<Project>> {
    const visible = user.role === 'REGIONAL_MANAGER' ? await this.projects.findAll() : await this.projects.findByStore(user.storeId);
    const ordered = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return paginate(ordered, query.limit, query.offset);
  }

  async create(user: AuthUser, input: CreateProjectInput): Promise<Project> {
    if (!isStoreManager(user)) {
      throw new ForbiddenError('Only store managers can create programmes');
    }
    const now = this.clock().toISOString();
    return this.projects.save({
      id: this.newId(),
      name: input.name,
      description: input.description ?? null,
      storeId: user.storeId,
      ownerId: user.id,
      status: 'ACTIVE',
      members: [{ userId: user.id, role: 'STORE_MANAGER', addedAt: now }],
      createdAt: now,
    });
  }

  async addMember(user: AuthUser, projectId: string, input: AddMemberInput): Promise<Project> {
    const project = await this.getAccessible(user, projectId);
    if (!isStoreManager(user) && project.ownerId !== user.id) {
      throw new ForbiddenError('Only store managers or the programme owner can add members');
    }
    if (project.status !== 'ACTIVE') {
      throw new ConflictError('PROGRAMME_CLOSED', 'Members cannot be added to a closed programme');
    }
    const member = await this.staff.findProfileById(input.userId);
    if (member?.storeId !== project.storeId) {
      throw new ValidationError('Member must be a staff member of the programme store', [
        { path: 'userId', message: 'unknown staff member for this store' },
      ]);
    }
    if (roleRank(input.role) > roleRank(member.role)) {
      throw new ConflictError('ROLE_EXCEEDS_STAFF_ROLE', "A programme role cannot outrank the staff member's own role");
    }
    if (project.members.some((existing) => existing.userId === input.userId)) {
      throw new ConflictError('ALREADY_MEMBER', 'Staff member is already on this programme');
    }
    return this.projects.save({
      ...project,
      members: [...project.members, { userId: input.userId, role: input.role, addedAt: this.clock().toISOString() }],
    });
  }

  /** Read-only lookup for the activities module (wired through ports in src/app.ts). */
  async findSummaryById(id: string): Promise<{ id: string; storeId: string; status: ProjectStatus } | null> {
    const project = await this.projects.findById(id);
    return project ? { id: project.id, storeId: project.storeId, status: project.status } : null;
  }

  /** Cross-store ids are reported as not found so callers cannot probe other stores. */
  private async getAccessible(user: AuthUser, id: string): Promise<Project> {
    const project = await this.projects.findById(id);
    if (!project || !canAccessStore(user, project.storeId)) {
      throw new NotFoundError('Programme');
    }
    return project;
  }
}

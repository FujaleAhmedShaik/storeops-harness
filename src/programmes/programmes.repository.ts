import { InMemoryStore } from '../shared/in-memory-store';
import type { Project } from './programmes.types';

export interface ProjectRepository {
  findById(id: string): Promise<Project | null>;
  findByStore(storeId: string): Promise<Project[]>;
  findAll(): Promise<Project[]>;
  save(project: Project): Promise<Project>;
}

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly store = new InMemoryStore<Project>();

  async findById(id: string): Promise<Project | null> {
    return Promise.resolve(this.store.get(id));
  }

  async findByStore(storeId: string): Promise<Project[]> {
    return Promise.resolve(this.store.all().filter((project) => project.storeId === storeId));
  }

  async findAll(): Promise<Project[]> {
    return Promise.resolve(this.store.all());
  }

  async save(project: Project): Promise<Project> {
    return Promise.resolve(this.store.save(project));
  }
}

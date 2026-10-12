import { InMemoryStore } from '../shared/in-memory-store';
import type { Task, TaskStatus } from './activities.types';

export interface TaskFilter {
  readonly storeId?: string;
  readonly programmeId?: string;
  readonly status?: TaskStatus;
}

export interface TaskRepository {
  findById(id: string): Promise<Task | null>;
  find(filter: TaskFilter): Promise<Task[]>;
  save(task: Task): Promise<Task>;
  delete(id: string): Promise<boolean>;
}

export class InMemoryTaskRepository implements TaskRepository {
  private readonly store = new InMemoryStore<Task>();

  async findById(id: string): Promise<Task | null> {
    return Promise.resolve(this.store.get(id));
  }

  async find(filter: TaskFilter): Promise<Task[]> {
    return Promise.resolve(
      this.store
        .all()
        .filter(
          (task) =>
            (filter.storeId === undefined || task.storeId === filter.storeId) &&
            (filter.programmeId === undefined || task.programmeId === filter.programmeId) &&
            (filter.status === undefined || task.status === filter.status),
        ),
    );
  }

  async save(task: Task): Promise<Task> {
    return Promise.resolve(this.store.save(task));
  }

  async delete(id: string): Promise<boolean> {
    return Promise.resolve(this.store.remove(id));
  }
}

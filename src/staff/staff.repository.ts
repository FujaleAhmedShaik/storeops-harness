import { InMemoryStore } from '../shared/in-memory-store';
import type { StaffRole } from '../shared/domain';
import type { User } from './staff.types';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByStoreAndRole(storeId: string, role: StaffRole): Promise<User[]>;
  save(user: User): Promise<User>;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly store = new InMemoryStore<User>();

  async findById(id: string): Promise<User | null> {
    return Promise.resolve(this.store.get(id));
  }

  async findByEmail(email: string): Promise<User | null> {
    const wanted = email.toLowerCase();
    return Promise.resolve(this.store.all().find((user) => user.email.toLowerCase() === wanted) ?? null);
  }

  async findByStoreAndRole(storeId: string, role: StaffRole): Promise<User[]> {
    return Promise.resolve(this.store.all().filter((user) => user.storeId === storeId && user.role === role));
  }

  async save(user: User): Promise<User> {
    return Promise.resolve(this.store.save(user));
  }
}

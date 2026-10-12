import { InMemoryStore } from '../shared/in-memory-store';
import type { Notification, NotificationStatus } from './alerts.types';

export interface NotificationRepository {
  findByUser(userId: string, status?: NotificationStatus): Promise<Notification[]>;
  save(notification: Notification): Promise<Notification>;
}

export class InMemoryNotificationRepository implements NotificationRepository {
  private readonly store = new InMemoryStore<Notification>();

  async findByUser(userId: string, status?: NotificationStatus): Promise<Notification[]> {
    return Promise.resolve(
      this.store.all().filter((item) => item.userId === userId && (status === undefined || item.status === status)),
    );
  }

  async save(notification: Notification): Promise<Notification> {
    return Promise.resolve(this.store.save(notification));
  }
}

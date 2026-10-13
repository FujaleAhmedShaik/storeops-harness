import { randomUUID } from 'node:crypto';
import type { AlertType, AuthUser } from '../shared/domain';
import type { AppEvents, EventBus } from '../shared/events';
import { paginate, type Page } from '../shared/validate';
import type { StoreManagerDirectory } from './alerts.ports';
import type { NotificationRepository } from './alerts.repository';
import type { ListAlertsQuery } from './alerts.schemas';
import type { Notification } from './alerts.types';

interface NewAlert {
  readonly userId: string;
  readonly type: AlertType;
  readonly title: string;
  readonly message: string;
  readonly relatedId: string;
}

/** Alerts are created only in reaction to events: no other module calls this service. */
export class AlertsService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly managers: StoreManagerDirectory,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Alerts for the authenticated user only (object-level authorisation by construction). */
  async listForUser(user: AuthUser, query: ListAlertsQuery): Promise<Page<Notification>> {
    const own = await this.notifications.findByUser(user.id, query.status);
    const ordered = [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return paginate(ordered, query.limit, query.offset);
  }

  registerEventHandlers(bus: EventBus): void {
    bus.on('activity.status_changed', async (event) => this.onStatusChanged(event));
    bus.on('activity.assigned', async (event) => this.onAssigned(event));
    bus.on('activity.bulk_status_updated', async (event) => this.onBulkStatusUpdated(event));
  }

  /** Audit entry for a shift handover: tells the assignee (or the creator when unassigned) what changed. */
  private async onBulkStatusUpdated(event: AppEvents['activity.bulk_status_updated']): Promise<void> {
    await this.create({
      userId: event.assigneeId ?? event.createdBy,
      type: 'SHIFT_HANDOVER',
      title: 'Activity updated at shift handover',
      message: `"${event.title}" was moved from ${event.from} to ${event.to}.`,
      relatedId: event.taskId,
    });
  }

  /** A HIGH/CRITICAL activity becoming BLOCKED escalates to every store manager of that store. */
  private async onStatusChanged(event: AppEvents['activity.status_changed']): Promise<void> {
    if (event.to !== 'BLOCKED' || (event.priority !== 'HIGH' && event.priority !== 'CRITICAL')) {
      return;
    }
    const managerIds = await this.managers.findStoreManagerIds(event.storeId);
    await Promise.all(
      managerIds.map(async (userId) =>
        this.create({
          userId,
          type: 'ESCALATION',
          title: `${event.priority} activity blocked`,
          message: `"${event.title}" is now BLOCKED and needs attention.`,
          relatedId: event.taskId,
        }),
      ),
    );
  }

  /** A restocking activity assigned to someone raises an INVENTORY alert for the assignee. */
  private async onAssigned(event: AppEvents['activity.assigned']): Promise<void> {
    if (event.category !== 'RESTOCKING') {
      return;
    }
    await this.create({
      userId: event.assigneeId,
      type: 'INVENTORY',
      title: 'Restocking activity assigned',
      message: `"${event.title}" has been assigned to you.`,
      relatedId: event.taskId,
    });
  }

  private async create(alert: NewAlert): Promise<Notification> {
    return this.notifications.save({
      id: this.newId(),
      ...alert,
      channel: 'IN_APP',
      status: 'UNREAD',
      createdAt: this.clock().toISOString(),
    });
  }
}

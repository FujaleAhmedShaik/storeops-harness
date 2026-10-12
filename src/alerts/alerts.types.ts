import type { AlertType } from '../shared/domain';

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['UNREAD', 'READ'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly type: AlertType;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly title: string;
  readonly message: string;
  readonly relatedId: string;
  readonly createdAt: string;
}

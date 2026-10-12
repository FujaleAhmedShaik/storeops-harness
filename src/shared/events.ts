import type { TaskCategory, TaskPriority, TaskStatus } from './domain';

/**
 * Cross-module side effects are raised ONLY through the event bus, never by importing
 * another module's service. Add new events here so producers and consumers share one contract.
 */
export interface AppEvents {
  'activity.assigned': {
    readonly taskId: string;
    readonly title: string;
    readonly storeId: string;
    readonly assigneeId: string;
    readonly category: TaskCategory;
    readonly priority: TaskPriority;
  };
  'activity.status_changed': {
    readonly taskId: string;
    readonly title: string;
    readonly storeId: string;
    readonly assigneeId: string | null;
    readonly from: TaskStatus;
    readonly to: TaskStatus;
    readonly priority: TaskPriority;
  };
  /** Emitted when a programme closes; the reports module reacts by generating a STORE_SUMMARY. */
  'programme.closed': {
    readonly projectId: string;
    readonly storeId: string;
  };
}

export type EventName = keyof AppEvents;
export type EventHandler<K extends EventName> = (payload: AppEvents[K]) => void | Promise<void>;

export interface EventBus {
  emit<K extends EventName>(name: K, payload: AppEvents[K]): Promise<void>;
  on<K extends EventName>(name: K, handler: EventHandler<K>): void;
}

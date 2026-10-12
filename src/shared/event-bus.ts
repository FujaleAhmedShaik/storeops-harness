import type { Logger } from './logger';
import type { AppEvents, EventBus, EventHandler, EventName } from './events';

type AnyHandler = (payload: never) => void | Promise<void>;

/** In-process event bus. A failing handler is logged and never fails the emitting request. */
export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<EventName, AnyHandler[]>();

  constructor(private readonly logger: Logger) {}

  on<K extends EventName>(name: K, handler: EventHandler<K>): void {
    const existing = this.handlers.get(name) ?? [];
    this.handlers.set(name, [...existing, handler]);
  }

  async emit<K extends EventName>(name: K, payload: AppEvents[K]): Promise<void> {
    const listeners = (this.handlers.get(name) ?? []) as EventHandler<K>[];
    const results = await Promise.allSettled(listeners.map(async (listener) => listener(payload)));
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error({ event: name, err: result.reason }, 'event handler failed');
      }
    }
  }
}

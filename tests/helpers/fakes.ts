import { createLogger } from '../../src/shared/logger';
import { InMemoryEventBus } from '../../src/shared/event-bus';
import type { AppEvents, EventName } from '../../src/shared/events';
import type { AuthUser, ProjectStatus, StaffRole } from '../../src/shared/domain';

export const STORE_A = 'store-001';
export const STORE_B = 'store-002';

export const ids = {
  manager: '11111111-1111-4111-8111-111111111111',
  lead: '22222222-2222-4222-8222-222222222222',
  associate: '33333333-3333-4333-8333-333333333333',
  otherAssociate: '44444444-4444-4444-8444-444444444444',
  outsider: '55555555-5555-4555-8555-555555555555',
  programme: '66666666-6666-4666-8666-666666666666',
  closedProgramme: '77777777-7777-4777-8777-777777777777',
  foreignProgramme: '88888888-8888-4888-8888-888888888888',
  unknown: '99999999-9999-4999-8999-999999999999',
};

export const users = {
  manager: { id: ids.manager, role: 'STORE_MANAGER', storeId: STORE_A },
  lead: { id: ids.lead, role: 'DEPARTMENT_LEAD', storeId: STORE_A },
  associate: { id: ids.associate, role: 'ASSOCIATE', storeId: STORE_A },
  otherAssociate: { id: ids.otherAssociate, role: 'ASSOCIATE', storeId: STORE_A },
  outsiderManager: { id: ids.outsider, role: 'STORE_MANAGER', storeId: STORE_B },
  regional: { id: '00000000-0000-4000-8000-000000000001', role: 'REGIONAL_MANAGER', storeId: 'region-001' },
} satisfies Record<string, AuthUser>;

export const staffDirectory = {
  findProfileById: async (id: string): Promise<{ id: string; role: StaffRole; storeId: string } | null> => {
    const known = Object.values(users).find((user) => user.id === id);
    return Promise.resolve(known ? { id: known.id, role: known.role, storeId: known.storeId } : null);
  },
};

export const programmeDirectory = {
  findSummaryById: async (id: string): Promise<{ id: string; storeId: string; status: ProjectStatus } | null> => {
    const known: Record<string, { id: string; storeId: string; status: ProjectStatus }> = {
      [ids.programme]: { id: ids.programme, storeId: STORE_A, status: 'ACTIVE' },
      [ids.closedProgramme]: { id: ids.closedProgramme, storeId: STORE_A, status: 'CLOSED' },
      [ids.foreignProgramme]: { id: ids.foreignProgramme, storeId: STORE_B, status: 'ACTIVE' },
    };
    return Promise.resolve(known[id] ?? null);
  },
};

export interface RecordingBus extends InMemoryEventBus {
  readonly emitted: { name: EventName; payload: AppEvents[EventName] }[];
}

/** Real bus that also records every emitted event so tests can assert on side effects. */
export function createRecordingBus(): RecordingBus {
  const bus = new InMemoryEventBus(createLogger('silent')) as RecordingBus;
  const emitted: RecordingBus['emitted'] = [];
  const original = bus.emit.bind(bus);
  Object.defineProperty(bus, 'emitted', { value: emitted });
  bus.emit = async (name, payload) => {
    emitted.push({ name, payload });
    return original(name, payload);
  };
  return bus;
}

export function fixedClock(iso = '2026-03-01T10:00:00.000Z'): () => Date {
  return () => new Date(iso);
}

/** Deterministic ids: 00000000-0000-4000-8000-0000000000NN */
export function sequentialIds(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    return `aaaaaaaa-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  };
}

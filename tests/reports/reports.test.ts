import { InMemoryEventBus } from '../../src/shared/event-bus';
import { createLogger } from '../../src/shared/logger';
import { InMemoryReportRepository } from '../../src/reports/reports.repository';
import { ReportsService } from '../../src/reports/reports.service';
import { fixedClock, sequentialIds, STORE_A } from '../helpers/fakes';

const stats = {
  storeId: STORE_A,
  total: 4,
  byStatus: { TODO: 1, IN_PROGRESS: 1, DONE: 2, BLOCKED: 0 },
  overdue: 1,
  completionRate: 0.5,
};

function setup(read: () => Promise<typeof stats> = async () => Promise.resolve(stats)) {
  const repo = new InMemoryReportRepository();
  const getStoreStats = jest.fn(read);
  const service = new ReportsService(repo, { getStoreStats }, fixedClock(), sequentialIds());
  return { repo, service, getStoreStats };
}

describe('ReportsService', () => {
  it('generates a READY STORE_SUMMARY from read-only task statistics', async () => {
    const { service, repo, getStoreStats } = setup();
    const report = await service.generateStoreSummary(STORE_A);

    expect(getStoreStats).toHaveBeenCalledWith(STORE_A);
    expect(report).toMatchObject({
      type: 'STORE_SUMMARY',
      status: 'READY',
      storeId: STORE_A,
      createdAt: '2026-03-01T10:00:00.000Z',
      completedAt: '2026-03-01T10:00:00.000Z',
      summary: { total: 4, overdue: 1, completionRate: 0.5, byStatus: { DONE: 2 } },
    });
    expect(report.summary).not.toHaveProperty('storeId');
    await expect(repo.findById(report.id)).resolves.toEqual(report);
  });

  it('uses the real clock and random ids by default', async () => {
    const service = new ReportsService(new InMemoryReportRepository(), { getStoreStats: async () => Promise.resolve(stats) });
    const report = await service.generateStoreSummary(STORE_A);
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.now() - Date.parse(report.createdAt)).toBeLessThan(5_000);
  });

  it('marks the report FAILED and rethrows when aggregation fails', async () => {
    const { service, repo } = setup(async () => Promise.reject(new Error('stats unavailable')));
    await expect(service.generateStoreSummary(STORE_A)).rejects.toThrow('stats unavailable');
    const [failed] = await repo.findByStore(STORE_A);
    expect(failed).toMatchObject({ status: 'FAILED', summary: null, completedAt: '2026-03-01T10:00:00.000Z' });
  });

  it('reacts to programme.closed events, scoped to that programme\'s store', async () => {
    const { service, repo } = setup();
    const bus = new InMemoryEventBus(createLogger('silent'));
    service.registerEventHandlers(bus);

    await bus.emit('programme.closed', { projectId: 'p-1', storeId: STORE_A });

    const reports = await repo.findByStore(STORE_A);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.status).toBe('READY');
    await expect(repo.findByStore('store-002')).resolves.toEqual([]);
  });

  it('a failing aggregation does not break the emitter', async () => {
    const { service } = setup(async () => Promise.reject(new Error('boom')));
    const bus = new InMemoryEventBus(createLogger('silent'));
    service.registerEventHandlers(bus);
    await expect(bus.emit('programme.closed', { projectId: 'p-1', storeId: STORE_A })).resolves.toBeUndefined();
  });
});

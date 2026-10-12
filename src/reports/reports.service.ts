import { randomUUID } from 'node:crypto';
import type { EventBus } from '../shared/events';
import type { TaskStatsReader } from './reports.ports';
import type { ReportRepository } from './reports.repository';
import type { Report } from './reports.types';

/** Read-only aggregation: reads activity statistics, writes only its own Report records. */
export class ReportsService {
  constructor(
    private readonly reports: ReportRepository,
    private readonly stats: TaskStatsReader,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Creates a PENDING report, then marks it READY, or FAILED (and rethrows) if aggregation fails. */
  async generateStoreSummary(storeId: string): Promise<Report> {
    const pending = await this.reports.save({
      id: this.newId(),
      type: 'STORE_SUMMARY',
      status: 'PENDING',
      storeId,
      summary: null,
      createdAt: this.clock().toISOString(),
      completedAt: null,
    });
    try {
      const { total, byStatus, overdue, completionRate } = await this.stats.getStoreStats(storeId);
      return await this.reports.save({
        ...pending,
        status: 'READY',
        summary: { total, byStatus, overdue, completionRate },
        completedAt: this.clock().toISOString(),
      });
    } catch (error) {
      await this.reports.save({ ...pending, status: 'FAILED', completedAt: this.clock().toISOString() });
      throw error;
    }
  }

  registerEventHandlers(bus: EventBus): void {
    bus.on('programme.closed', async (event) => {
      await this.generateStoreSummary(event.storeId);
    });
  }
}

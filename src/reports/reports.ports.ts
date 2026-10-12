import type { StoreSummaryData } from './reports.types';

/**
 * Read-only view of activities that reports needs. Implemented by ActivitiesService, wired in src/app.ts.
 * The reports module is read-only: there is deliberately no write method on this port.
 */
export interface TaskStatsReader {
  getStoreStats(storeId: string): Promise<StoreSummaryData & { storeId: string }>;
}

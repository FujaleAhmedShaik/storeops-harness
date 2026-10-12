export const REPORT_TYPES = ['STORE_SUMMARY', 'REGIONAL_ROLLUP', 'DEPARTMENT_PERFORMANCE'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = ['PENDING', 'READY', 'FAILED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface StoreSummaryData {
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly overdue: number;
  readonly completionRate: number;
}

export interface Report {
  readonly id: string;
  readonly type: ReportType;
  readonly status: ReportStatus;
  readonly storeId: string;
  readonly summary: StoreSummaryData | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

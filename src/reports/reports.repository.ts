import { InMemoryStore } from '../shared/in-memory-store';
import type { Report } from './reports.types';

export interface ReportRepository {
  findById(id: string): Promise<Report | null>;
  findByStore(storeId: string): Promise<Report[]>;
  save(report: Report): Promise<Report>;
}

export class InMemoryReportRepository implements ReportRepository {
  private readonly store = new InMemoryStore<Report>();

  async findById(id: string): Promise<Report | null> {
    return Promise.resolve(this.store.get(id));
  }

  async findByStore(storeId: string): Promise<Report[]> {
    return Promise.resolve(this.store.all().filter((report) => report.storeId === storeId));
  }

  async save(report: Report): Promise<Report> {
    return Promise.resolve(this.store.save(report));
  }
}

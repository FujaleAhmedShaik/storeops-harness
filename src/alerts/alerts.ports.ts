/** Read-only view of staff that alerts needs. Implemented by StaffService, wired in src/app.ts. */
export interface StoreManagerDirectory {
  findStoreManagerIds(storeId: string): Promise<string[]>;
}

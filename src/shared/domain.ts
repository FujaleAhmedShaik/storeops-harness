/** Cross-cutting domain vocabulary shared by modules, events and auth. */

export const STAFF_ROLES = ['REGIONAL_MANAGER', 'STORE_MANAGER', 'DEPARTMENT_LEAD', 'ASSOCIATE'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PROJECT_ROLES = ['STORE_MANAGER', 'DEPARTMENT_LEAD', 'ASSOCIATE'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const PROJECT_STATUSES = ['ACTIVE', 'CLOSED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_CATEGORIES = ['RESTOCKING', 'PLANOGRAM', 'AUDIT', 'COMPLIANCE', 'GENERAL'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const ALERT_TYPES = ['INVENTORY', 'SLA_BREACH', 'SHIFT_HANDOVER', 'ESCALATION'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Authenticated caller, derived only from a verified token. */
export interface AuthUser {
  readonly id: string;
  readonly role: StaffRole;
  readonly storeId: string;
}

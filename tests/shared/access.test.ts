import { canAccessStore, isStoreManager, isSupervisor, roleRank } from '../../src/shared/access';
import { users } from '../helpers/fakes';

describe('access helpers', () => {
  it('orders roles by seniority', () => {
    expect(roleRank('ASSOCIATE')).toBeLessThan(roleRank('DEPARTMENT_LEAD'));
    expect(roleRank('DEPARTMENT_LEAD')).toBeLessThan(roleRank('STORE_MANAGER'));
    expect(roleRank('STORE_MANAGER')).toBeLessThan(roleRank('REGIONAL_MANAGER'));
  });

  it('supervisors are department leads and above', () => {
    expect(isSupervisor(users.associate)).toBe(false);
    expect(isSupervisor(users.lead)).toBe(true);
    expect(isSupervisor(users.manager)).toBe(true);
    expect(isSupervisor(users.regional)).toBe(true);
  });

  it('store managers are store managers and above', () => {
    expect(isStoreManager(users.lead)).toBe(false);
    expect(isStoreManager(users.manager)).toBe(true);
    expect(isStoreManager(users.regional)).toBe(true);
  });

  it('limits store access to the own store, except regional managers', () => {
    expect(canAccessStore(users.manager, 'store-001')).toBe(true);
    expect(canAccessStore(users.manager, 'store-002')).toBe(false);
    expect(canAccessStore(users.regional, 'store-002')).toBe(true);
  });
});

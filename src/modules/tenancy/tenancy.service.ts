import { Injectable } from '@nestjs/common';
import { getDb } from '../../db';
import { withTenant, type Tx } from './tenant-context';

/**
 * TenancyService — the only sanctioned entry point for tenant-scoped data access.
 * Every query that touches a tenant-scoped table must run inside `runAs`, so the
 * RLS context is always set. Repositories never take a raw db handle.
 */
@Injectable()
export class TenancyService {
  runAs<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(getDb(), tenantId, fn);
  }
}

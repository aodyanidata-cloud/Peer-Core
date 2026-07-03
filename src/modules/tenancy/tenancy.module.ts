import { Module } from '@nestjs/common';
import { TenancyService } from './tenancy.service';

/**
 * TenancyModule
 * Multi-tenant context + Row-Level-Security enforcement (B1 🔴).
 * tenant_id is server-derived, never client-supplied. RLS is ENABLEd + FORCEd
 * on every tenant table (see the 0001_rls migration).
 */
@Module({
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}

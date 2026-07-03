import { Module } from '@nestjs/common';

/**
 * TenancyModule
 * Multi-tenant context + Row-Level-Security enforcement (policies land in task B1). tenant_id is server-derived, never client-supplied.
 * Scaffold only (Stage A1) — no business logic yet.
 */
@Module({})
export class TenancyModule {}

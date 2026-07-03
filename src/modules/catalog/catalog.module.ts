import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CatalogService } from './catalog.service';

/**
 * CatalogModule
 * Generic, tenant-scoped catalog (JSONB attributes). Reused across verticals;
 * PosProvider-compatible shape (external_ref + source).
 */
@Module({
  imports: [TenancyModule],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}

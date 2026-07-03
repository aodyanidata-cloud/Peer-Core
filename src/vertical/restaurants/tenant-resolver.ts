import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db';
import * as schema from '../../db/schema';

/**
 * TenantResolver — turns a PUBLIC merchant slug (from the storefront URL / QR)
 * into a tenant id by looking it up server-side. This is the sanctioned way a
 * diner-facing request gets its tenant: the slug is public, but the tenant id is
 * resolved from the database, never trusted from a client-supplied field.
 */
@Injectable()
export class TenantResolver {
  async bySlug(slug: string): Promise<string | null> {
    const [t] = await getDb()
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);
    return t?.id ?? null;
  }
}

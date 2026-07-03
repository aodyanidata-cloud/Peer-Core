import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { applyMigrations } from '../src/db/migrate';
import { TenancyService } from '../src/modules/tenancy/tenancy.service';
import { InferenceGateway } from '../src/modules/inference-gateway/inference-gateway.service';
import { EchoProvider } from '../src/modules/inference-gateway/echo-provider';
import { KbService } from '../src/modules/agent/kb.service';
import { ConversationService } from '../src/modules/agent/conversation.service';
import { closeDb } from '../src/db';

const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;

d('agent RAG (B6)', () => {
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let kb: KbService;
  let convo: ConversationService;
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await applyMigrations(pool);
    const gateway = new InferenceGateway(new EchoProvider());
    kb = new KbService(new TenancyService(), gateway);
    convo = new ConversationService(kb, gateway);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE kb_documents, tenants RESTART IDENTITY CASCADE');
    await db.insert(schema.tenants).values([
      { id: tenantA, slug: 'a-' + tenantA.slice(0, 8), name: 'A' },
      { id: tenantB, slug: 'b-' + tenantB.slice(0, 8), name: 'B' },
    ]);
  });

  afterAll(async () => {
    await closeDb();
    await pool.end();
  });

  it('retrieval is tenant-scoped: tenant A never retrieves tenant B documents', async () => {
    await kb.addDocument(tenantA, { title: 'A hours', content: 'A opens at 9am' });
    await kb.addDocument(tenantB, { title: 'B hours', content: 'B opens at 10am' });

    const hits = await kb.search(tenantA, 'when do you open', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('A hours');
  });

  it('search returns at most k results', async () => {
    for (let i = 0; i < 5; i++) {
      await kb.addDocument(tenantA, { title: `doc ${i}`, content: `content ${i}` });
    }
    const hits = await kb.search(tenantA, 'anything', 2);
    expect(hits).toHaveLength(2);
  });

  it('a reply goes through the gateway and cites the retrieved documents', async () => {
    const doc = await kb.addDocument(tenantA, {
      title: 'Parking',
      content: 'Free parking behind the building',
    });
    const reply = await convo.reply(tenantA, 'is there parking?', 3);
    expect(reply.text).toBe('echo: is there parking?'); // proves it went through the gateway
    expect(reply.sources).toContain(doc.id);
  });

  it('a reply with no knowledge still answers (empty sources)', async () => {
    const reply = await convo.reply(tenantA, 'hello', 3);
    expect(reply.text).toBe('echo: hello');
    expect(reply.sources).toEqual([]);
  });
});

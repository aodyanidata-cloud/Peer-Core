-- 0005_kb — tenant knowledge base for RAG (B6). Idempotent.
-- Embeddings stored as JSONB for now (pgvector is a drop-in upgrade at volume);
-- retrieval is always tenant-scoped by RLS, so an agent only ever sees its own
-- tenant's knowledge.

CREATE TABLE IF NOT EXISTS kb_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source      text NOT NULL DEFAULT 'manual',
  title       text NOT NULL,
  content     text NOT NULL,
  embedding   jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_kb_documents_tenant ON kb_documents (tenant_id);

ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_documents FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kb_documents_isolation ON kb_documents;
CREATE POLICY kb_documents_isolation ON kb_documents
  USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- 025: trace capture level.
--
-- organizations.trace_capture:
--   'errors' (default) — keep full span detail only for traces that contain an
--                        error or warning; for every other trace keep a cost-only
--                        skeleton of its token-bearing spans (no attributes, no
--                        content) so cost tracking and leaf detection stay exact.
--   'all'              — keep every span in full (opt-in, Settings → Workspace).
-- spans.detail / traces.detail say whether full detail was kept; the Traces page
-- lists only detailed traces. tf_mark_trace_detail() refreshes traces.detail
-- after refresh_traces. Idempotent.

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS trace_capture TEXT NOT NULL DEFAULT 'errors';
DO $$ BEGIN
  ALTER TABLE public.organizations ADD CONSTRAINT organizations_trace_capture_chk CHECK (trace_capture IN ('errors', 'all'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.spans  ADD COLUMN IF NOT EXISTS detail BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.traces ADD COLUMN IF NOT EXISTS detail BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS idx_traces_org_detail_start ON public.traces (org_id, start_time DESC, trace_id DESC) WHERE detail;

CREATE OR REPLACE FUNCTION public.tf_mark_trace_detail(p_org UUID, p_trace_ids TEXT[])
RETURNS VOID LANGUAGE sql SET search_path = public, pg_temp AS $$
  UPDATE traces t
     SET detail = EXISTS (SELECT 1 FROM spans s WHERE s.org_id = t.org_id AND s.trace_id = t.trace_id AND s.detail)
   WHERE t.org_id = p_org AND t.trace_id = ANY (p_trace_ids)
$$;

REVOKE EXECUTE ON FUNCTION public.tf_mark_trace_detail(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tf_mark_trace_detail(UUID, TEXT[]) TO service_role;

-- 016: prompt privacy at the database layer.
--
-- Before: every member of an org could read every other member's prompt text
-- straight from PostgREST with their own JWT (prompt_captures.prompt_text,
-- usage_events.prompt_preview / session_id / user_email, spans.attributes which
-- can carry gen_ai prompt content). The app pages use the service role, so this
-- only changes what an `authenticated` user can read directly.
--
-- After (matches lib/rbac.ts promptScope):
--   owner / admin  → every row in their org
--   member / viewer → only rows attributed to themselves
--
--   prompt_captures : user_id = auth.uid()
--   usage_events    : user_id = auth.uid() OR lower(user_email) = JWT email
--   spans           : attributes 'user.id' = auth.uid() OR 'user.email' = JWT email
--                     (most spans carry no user → owner/admin only)
--
-- Checked and left alone:
--   usage_sessions / usage_daily_prompts / usage_daily (011): RLS on with NO
--     policies → service role only already.
--   traces: name + totals only, no per-user text; policy unchanged.
--   ccr_store: RLS on, no policies → service role only.
--
-- Idempotent (DROP POLICY IF EXISTS + CREATE), guarded by to_regclass.

DO $$
BEGIN
  -- ── prompt_captures ──────────────────────────────────────────────────────
  IF to_regclass('public.prompt_captures') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.prompt_captures ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS prompt_captures_select ON public.prompt_captures';
    EXECUTE $p$
      CREATE POLICY prompt_captures_select ON public.prompt_captures
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          user_id = (SELECT auth.uid())
          AND org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
        )
      )
    $p$;
  END IF;

  -- ── usage_events (prompt_preview, session_id, user_email) ────────────────
  IF to_regclass('public.usage_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS usage_events_select ON public.usage_events';
    EXECUTE $p$
      CREATE POLICY usage_events_select ON public.usage_events
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
          AND (
            user_id = (SELECT auth.uid())
            OR (user_email IS NOT NULL AND lower(user_email) = lower((SELECT auth.jwt() ->> 'email')))
          )
        )
      )
    $p$;
  END IF;

  -- ── spans (attributes may hold gen_ai prompt / completion text) ──────────
  IF to_regclass('public.spans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.spans ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS spans_select ON public.spans';
    EXECUTE $p$
      CREATE POLICY spans_select ON public.spans
      FOR SELECT TO authenticated
      USING (
        org_id IN (SELECT m.org_id FROM public.members m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role IN ('owner', 'admin'))
        OR (
          org_id IN (SELECT m.org_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
          AND (
            attributes ->> 'user.id' = (SELECT auth.uid())::text
            OR lower(attributes ->> 'user.email') = lower((SELECT auth.jwt() ->> 'email'))
          )
        )
      )
    $p$;
  END IF;
END $$;

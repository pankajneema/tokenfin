import { createClient, createAdminClient } from '@/lib/supabase/server'
import { EvalsClient } from './_client'

export const metadata = { title: 'Evals — TokenFin' }

export interface ScoreRow { id: string; evaluator: string; score: number | null; passed: boolean | null; model: string | null; rationale: string | null; created_at: string }
export interface RunRow { id: string; evaluator: string; kind: string; summary: Record<string, unknown>; created_at: string }

export default async function EvalsPage() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = await admin
    .from('members').select('org_id').eq('user_id', user!.id).order('joined_at', { ascending: true }).limit(1)
  const orgId = membership?.[0]?.org_id ?? ''

  const [{ data: runs }, { data: scores }, { data: settings }] = await Promise.all([
    admin.from('eval_runs').select('id, evaluator, kind, summary, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(20),
    admin.from('eval_scores').select('id, evaluator, score, passed, model, rationale, created_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50),
    admin.from('org_eval_settings').select('key_cipher, judge_model').eq('org_id', orgId).maybeSingle(),
  ])
  const keyConfigured = !!settings?.key_cipher || !!(process.env.EVAL_JUDGE_KEY || process.env.ANTHROPIC_API_KEY)
  const judgeModel = settings?.judge_model ?? 'claude-haiku-4-5'

  const s = scores ?? []
  const faith = s.filter(x => x.evaluator === 'faithfulness' && x.score != null)
  const meanFaith = faith.length ? +(faith.reduce((a, r) => a + Number(r.score), 0) / faith.length).toFixed(3) : null
  const hallucinationRate = faith.length ? +(faith.filter(r => r.passed === false).length / faith.length * 100).toFixed(1) : null

  return (
    <EvalsClient
      orgId={orgId}
      meanFaithfulness={meanFaith}
      hallucinationRate={hallucinationRate}
      scoredCount={faith.length}
      runs={(runs ?? []) as RunRow[]}
      scores={s as ScoreRow[]}
      keyConfigured={keyConfigured}
      judgeModel={judgeModel}
    />
  )
}

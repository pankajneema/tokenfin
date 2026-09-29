// Generated from the local Supabase DB by `npm run gen:types` (all db/migrations applied). Do not edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      alert_rules: {
        Row: {
          anomaly_scope: string
          channels: Json
          condition: string
          cooldown_hours: number
          created_at: string
          fired_count: number
          id: string
          is_active: boolean
          last_fired_at: string | null
          name: string
          org_id: string
          project_id: string | null
          scope: string
          threshold: number | null
          trigger_type: string
        }
        Insert: {
          anomaly_scope?: string
          channels?: Json
          condition?: string
          cooldown_hours?: number
          created_at?: string
          fired_count?: number
          id?: string
          is_active?: boolean
          last_fired_at?: string | null
          name: string
          org_id: string
          project_id?: string | null
          scope?: string
          threshold?: number | null
          trigger_type: string
        }
        Update: {
          anomaly_scope?: string
          channels?: Json
          condition?: string
          cooldown_hours?: number
          created_at?: string
          fired_count?: number
          id?: string
          is_active?: boolean
          last_fired_at?: string | null
          name?: string
          org_id?: string
          project_id?: string | null
          scope?: string
          threshold?: number | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_rules: {
        Row: {
          assign: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: string
          match: Json
          name: string
          org_id: string
          priority: number
          updated_at: string
        }
        Insert: {
          assign?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          match?: Json
          name?: string
          org_id: string
          priority?: number
          updated_at?: string
        }
        Update: {
          assign?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          match?: Json
          name?: string
          org_id?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocation_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      api_errors_daily: {
        Row: {
          day: string
          errors: number
          model: string
          org_id: string
          updated_at: string | null
          user_key: string
        }
        Insert: {
          day: string
          errors?: number
          model: string
          org_id: string
          updated_at?: string | null
          user_key: string
        }
        Update: {
          day?: string
          errors?: number
          model?: string
          org_id?: string
          updated_at?: string | null
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_errors_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_errors_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: string | null
          env: string
          expires_at: string | null
          id: string
          is_active: boolean
          is_service_account: boolean
          key_enc_cipher: string | null
          key_enc_iv: string | null
          key_enc_tag: string | null
          key_hash: string
          key_prefix: string
          kind: string
          last_used_at: string | null
          name: string
          org_id: string
          project_id: string
          scopes: string[]
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          env?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_service_account?: boolean
          key_enc_cipher?: string | null
          key_enc_iv?: string | null
          key_enc_tag?: string | null
          key_hash: string
          key_prefix: string
          kind?: string
          last_used_at?: string | null
          name: string
          org_id: string
          project_id: string
          scopes?: string[]
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: string | null
          env?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_service_account?: boolean
          key_enc_cipher?: string | null
          key_enc_iv?: string | null
          key_enc_tag?: string | null
          key_hash?: string
          key_prefix?: string
          kind?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          project_id?: string
          scopes?: string[]
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          created_at: string
          details: Json
          id: string
          ip: string | null
          org_id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          ip?: string | null
          org_id: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          ip?: string | null
          org_id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_by: string | null
          created_at: string
          id: string
          org_id: string
          project_id: string | null
          reason: string
          team_id: string | null
          unblocked_at: string | null
        }
        Insert: {
          blocked_by?: string | null
          created_at?: string
          id?: string
          org_id: string
          project_id?: string | null
          reason: string
          team_id?: string | null
          unblocked_at?: string | null
        }
        Update: {
          blocked_by?: string | null
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string | null
          reason?: string
          team_id?: string | null
          unblocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_requests: {
        Row: {
          amount_usd: number
          created_at: string
          id: string
          org_id: string
          project_id: string | null
          reason: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          id?: string
          org_id: string
          project_id?: string | null
          reason?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          id?: string
          org_id?: string
          project_id?: string | null
          reason?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      ccr_store: {
        Row: {
          content: string
          created_at: string
          expires_at: string
          hash: string
          org_id: string
        }
        Insert: {
          content: string
          created_at?: string
          expires_at?: string
          hash: string
          org_id: string
        }
        Update: {
          content?: string
          created_at?: string
          expires_at?: string
          hash?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ccr_store_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ccr_store_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      coding_tool_usage: {
        Row: {
          accepted: number
          commits: number
          cost_basis: string
          cost_usd: number
          day: string
          id: number
          input_tokens: number
          lines_added: number
          lines_removed: number
          model: string
          org_id: string
          output_tokens: number
          pull_requests: number
          raw: Json
          requests: number
          sessions: number
          suggested: number
          synced_at: string
          tool: string
          user_key: string
        }
        Insert: {
          accepted?: number
          commits?: number
          cost_basis?: string
          cost_usd?: number
          day: string
          id?: number
          input_tokens?: number
          lines_added?: number
          lines_removed?: number
          model?: string
          org_id: string
          output_tokens?: number
          pull_requests?: number
          raw?: Json
          requests?: number
          sessions?: number
          suggested?: number
          synced_at?: string
          tool: string
          user_key: string
        }
        Update: {
          accepted?: number
          commits?: number
          cost_basis?: string
          cost_usd?: number
          day?: string
          id?: number
          input_tokens?: number
          lines_added?: number
          lines_removed?: number
          model?: string
          org_id?: string
          output_tokens?: number
          pull_requests?: number
          raw?: Json
          requests?: number
          sessions?: number
          suggested?: number
          synced_at?: string
          tool?: string
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "coding_tool_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coding_tool_usage_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "datasets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "datasets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      digest_runs: {
        Row: {
          created_at: string
          delivered: Json
          org_id: string
          summary: Json
          week_key: string
        }
        Insert: {
          created_at?: string
          delivered?: Json
          org_id: string
          summary?: Json
          week_key: string
        }
        Update: {
          created_at?: string
          delivered?: Json
          org_id?: string
          summary?: Json
          week_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "digest_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digest_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          created_at: string
          dataset_id: string | null
          evaluator: string
          id: string
          judge_model: string | null
          kind: string
          name: string | null
          org_id: string
          summary: Json
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          evaluator: string
          id?: string
          judge_model?: string | null
          kind?: string
          name?: string | null
          org_id: string
          summary?: Json
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          evaluator?: string
          id?: string
          judge_model?: string | null
          kind?: string
          name?: string | null
          org_id?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_scores: {
        Row: {
          cost_usd: number
          created_at: string
          eval_run_id: string | null
          evaluator: string
          id: string
          judge_model: string | null
          model: string | null
          org_id: string
          passed: boolean | null
          rationale: string | null
          score: number | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          eval_run_id?: string | null
          evaluator: string
          id?: string
          judge_model?: string | null
          model?: string | null
          org_id: string
          passed?: boolean | null
          rationale?: string | null
          score?: number | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          eval_run_id?: string | null
          evaluator?: string
          id?: string
          judge_model?: string | null
          model?: string | null
          org_id?: string
          passed?: boolean | null
          rationale?: string | null
          score?: number | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_scores_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      examples: {
        Row: {
          created_at: string
          dataset_id: string
          id: string
          input: Json
          org_id: string
          reference_output: string | null
        }
        Insert: {
          created_at?: string
          dataset_id: string
          id?: string
          input?: Json
          org_id: string
          reference_output?: string | null
        }
        Update: {
          created_at?: string
          dataset_id?: string
          id?: string
          input?: Json
          org_id?: string
          reference_output?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "examples_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "examples_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "examples_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      github_user_map: {
        Row: {
          created_at: string
          login: string
          org_id: string
          user_key: string
        }
        Insert: {
          created_at?: string
          login: string
          org_id: string
          user_key: string
        }
        Update: {
          created_at?: string
          login?: string
          org_id?: string
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_user_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_user_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: number
          job: string
          ok: boolean | null
          started_at: string
          summary: Json | null
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          job: string
          ok?: boolean | null
          started_at?: string
          summary?: Json | null
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          job?: string
          ok?: boolean | null
          started_at?: string
          summary?: Json | null
        }
        Relationships: []
      }
      key_reveals: {
        Row: {
          auth_tag: string | null
          ciphertext: string | null
          created_at: string
          email: string | null
          expires_at: string
          iv: string | null
          key_id: string
          org_id: string
          revealed_at: string | null
          token: string
        }
        Insert: {
          auth_tag?: string | null
          ciphertext?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          iv?: string | null
          key_id: string
          org_id: string
          revealed_at?: string | null
          token: string
        }
        Update: {
          auth_tag?: string | null
          ciphertext?: string | null
          created_at?: string
          email?: string | null
          expires_at?: string
          iv?: string | null
          key_id?: string
          org_id?: string
          revealed_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "key_reveals_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_reveals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "key_reveals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      limits: {
        Row: {
          block_at: number
          budget_usd: number
          created_at: string
          id: string
          is_active: boolean
          metric: string
          org_id: string
          period: string
          project_id: string | null
          scope: string
          team_id: string | null
          throttle_at: number
          value: number | null
          warn_at: number
        }
        Insert: {
          block_at?: number
          budget_usd: number
          created_at?: string
          id?: string
          is_active?: boolean
          metric?: string
          org_id: string
          period: string
          project_id?: string | null
          scope: string
          team_id?: string | null
          throttle_at?: number
          value?: number | null
          warn_at?: number
        }
        Update: {
          block_at?: number
          budget_usd?: number
          created_at?: string
          id?: string
          is_active?: boolean
          metric?: string
          org_id?: string
          period?: string
          project_id?: string | null
          scope?: string
          team_id?: string | null
          throttle_at?: number
          value?: number | null
          warn_at?: number
        }
        Relationships: [
          {
            foreignKeyName: "limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "limits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "limits_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          role: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          role?: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          role?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      merged_prs: {
        Row: {
          additions: number | null
          author_email: string | null
          author_login: string
          deletions: number | null
          head_ref: string
          id: number
          merged_at: string
          number: number
          opened_at: string | null
          org_id: string
          repo: string
          synced_at: string
          title: string
        }
        Insert: {
          additions?: number | null
          author_email?: string | null
          author_login?: string
          deletions?: number | null
          head_ref?: string
          id?: number
          merged_at: string
          number: number
          opened_at?: string | null
          org_id: string
          repo: string
          synced_at?: string
          title?: string
        }
        Update: {
          additions?: number | null
          author_email?: string | null
          author_login?: string
          deletions?: number | null
          head_ref?: string
          id?: number
          merged_at?: string
          number?: number
          opened_at?: string | null
          org_id?: string
          repo?: string
          synced_at?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "merged_prs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merged_prs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      model_prices: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          input_per_1m: number
          model: string
          output_per_1m: number
          provider: string
        }
        Insert: {
          created_at?: string
          effective_from?: string
          id?: string
          input_per_1m: number
          model: string
          output_per_1m: number
          provider: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          input_per_1m?: number
          model?: string
          output_per_1m?: number
          provider?: string
        }
        Relationships: []
      }
      model_routes: {
        Row: {
          created_at: string
          from_model: string
          id: string
          is_active: boolean
          min_quality: number | null
          org_id: string
          to_model: string
        }
        Insert: {
          created_at?: string
          from_model: string
          id?: string
          is_active?: boolean
          min_quality?: number | null
          org_id: string
          to_model: string
        }
        Update: {
          created_at?: string
          from_model?: string
          id?: string
          is_active?: boolean
          min_quality?: number | null
          org_id?: string
          to_model?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_routes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          org_id: string
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          org_id: string
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          org_id?: string
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_eval_settings: {
        Row: {
          judge_model: string
          key_cipher: string | null
          key_iv: string | null
          key_tag: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          judge_model?: string
          key_cipher?: string | null
          key_iv?: string | null
          key_tag?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          judge_model?: string
          key_cipher?: string | null
          key_iv?: string | null
          key_tag?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_eval_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_eval_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_integrations: {
        Row: {
          config: Json
          connected_at: string
          detail: string | null
          id: string
          integration: string | null
          is_active: boolean
          last_synced_at: string | null
          org_id: string
          provider: string | null
          status: string
          sync_ok: boolean
        }
        Insert: {
          config?: Json
          connected_at?: string
          detail?: string | null
          id?: string
          integration?: string | null
          is_active?: boolean
          last_synced_at?: string | null
          org_id: string
          provider?: string | null
          status?: string
          sync_ok?: boolean
        }
        Update: {
          config?: Json
          connected_at?: string
          detail?: string | null
          id?: string
          integration?: string | null
          is_active?: boolean
          last_synced_at?: string | null
          org_id?: string
          provider?: string | null
          status?: string
          sync_ok?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "org_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_model_prices: {
        Row: {
          cache_read_per_m: number | null
          cache_write_per_m: number | null
          input_per_m: number
          model_prefix: string
          org_id: string
          output_per_m: number
          updated_at: string | null
        }
        Insert: {
          cache_read_per_m?: number | null
          cache_write_per_m?: number | null
          input_per_m: number
          model_prefix: string
          org_id: string
          output_per_m: number
          updated_at?: string | null
        }
        Update: {
          cache_read_per_m?: number | null
          cache_write_per_m?: number | null
          input_per_m?: number
          model_prefix?: string
          org_id?: string
          output_per_m?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_model_prices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_model_prices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_models: {
        Row: {
          added_at: string
          id: string
          model: string
          org_id: string
        }
        Insert: {
          added_at?: string
          id?: string
          model: string
          org_id: string
        }
        Update: {
          added_at?: string
          id?: string
          model?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_models_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_models_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          capture_prompts: boolean
          created_at: string
          id: string
          kill_switch: boolean
          name: string
          owner_id: string | null
          plan: string
          retention_days: number | null
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          capture_prompts?: boolean
          created_at?: string
          id?: string
          kill_switch?: boolean
          name: string
          owner_id?: string | null
          plan?: string
          retention_days?: number | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          capture_prompts?: boolean
          created_at?: string
          id?: string
          kill_switch?: boolean
          name?: string
          owner_id?: string | null
          plan?: string
          retention_days?: number | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      otlp_metric_state: {
        Row: {
          org_id: string
          series_key: string
          updated_at: string
          value: number
        }
        Insert: {
          org_id: string
          series_key: string
          updated_at?: string
          value: number
        }
        Update: {
          org_id?: string
          series_key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      price_sync_findings: {
        Row: {
          first_seen: string
          id: string
          kind: string
          last_seen: string
          model: string
          notified_at: string | null
          orgs: string[]
          ours: Json
          resolved_at: string | null
          theirs: Json
        }
        Insert: {
          first_seen?: string
          id?: string
          kind: string
          last_seen?: string
          model: string
          notified_at?: string | null
          orgs?: string[]
          ours?: Json
          resolved_at?: string | null
          theirs?: Json
        }
        Update: {
          first_seen?: string
          id?: string
          kind?: string
          last_seen?: string
          model?: string
          notified_at?: string | null
          orgs?: string[]
          ours?: Json
          resolved_at?: string | null
          theirs?: Json
        }
        Relationships: []
      }
      productivity_daily: {
        Row: {
          active_seconds: number | null
          commits: number | null
          day: string
          edits_accepted: number | null
          edits_rejected: number | null
          id: string
          lines_added: number | null
          lines_removed: number | null
          org_id: string
          pull_requests: number | null
          repo: string
          sessions: number | null
          updated_at: string | null
          user_id: string | null
          user_key: string
        }
        Insert: {
          active_seconds?: number | null
          commits?: number | null
          day: string
          edits_accepted?: number | null
          edits_rejected?: number | null
          id?: string
          lines_added?: number | null
          lines_removed?: number | null
          org_id: string
          pull_requests?: number | null
          repo?: string
          sessions?: number | null
          updated_at?: string | null
          user_id?: string | null
          user_key: string
        }
        Update: {
          active_seconds?: number | null
          commits?: number | null
          day?: string
          edits_accepted?: number | null
          edits_rejected?: number | null
          id?: string
          lines_added?: number | null
          lines_removed?: number | null
          org_id?: string
          pull_requests?: number | null
          repo?: string
          sessions?: number | null
          updated_at?: string | null
          user_id?: string | null
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "productivity_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productivity_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_captures: {
        Row: {
          context: string | null
          cost_usd: number
          created_at: string
          expires_at: string
          id: string
          input_tokens: number
          model: string
          org_id: string
          output_tokens: number
          project_id: string | null
          prompt_hash: string | null
          prompt_text: string
          response_text: string | null
          user_id: string | null
        }
        Insert: {
          context?: string | null
          cost_usd?: number
          created_at?: string
          expires_at?: string
          id?: string
          input_tokens?: number
          model?: string
          org_id: string
          output_tokens?: number
          project_id?: string | null
          prompt_hash?: string | null
          prompt_text: string
          response_text?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string | null
          cost_usd?: number
          created_at?: string
          expires_at?: string
          id?: string
          input_tokens?: number
          model?: string
          org_id?: string
          output_tokens?: number
          project_id?: string | null
          prompt_hash?: string | null
          prompt_text?: string
          response_text?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_captures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_captures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_captures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          created_at: string
          id: string
          note: string | null
          org_id: string
          prompt_id: string
          template: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          org_id: string
          prompt_id: string
          template: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          org_id?: string
          prompt_id?: string
          template?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_connections: {
        Row: {
          config: Json | null
          created_at: string
          created_by: string | null
          id: string
          key_enc: Json
          key_hint: string
          last_error: string | null
          last_synced_at: string | null
          org_id: string
          provider: string
          status: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_enc: Json
          key_hint?: string
          last_error?: string | null
          last_synced_at?: string | null
          org_id: string
          provider: string
          status?: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          key_enc?: Json
          key_hint?: string
          last_error?: string | null
          last_synced_at?: string | null
          org_id?: string
          provider?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_costs: {
        Row: {
          cache_read_tokens: number
          cost_usd: number
          day: string
          id: number
          input_tokens: number
          line_item: string
          model: string
          org_id: string
          output_tokens: number
          provider: string
          synced_at: string
          workspace_or_project: string
        }
        Insert: {
          cache_read_tokens?: number
          cost_usd?: number
          day: string
          id?: number
          input_tokens?: number
          line_item?: string
          model?: string
          org_id: string
          output_tokens?: number
          provider: string
          synced_at?: string
          workspace_or_project?: string
        }
        Update: {
          cache_read_tokens?: number
          cost_usd?: number
          day?: string
          id?: number
          input_tokens?: number
          line_item?: string
          model?: string
          org_id?: string
          output_tokens?: number
          provider?: string
          synced_at?: string
          workspace_or_project?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_costs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_costs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      spans: {
        Row: {
          attributes: Json
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          created_at: string
          duration_ms: number | null
          end_time: string | null
          input_tokens: number
          kind: string | null
          model: string | null
          name: string | null
          operation: string | null
          org_id: string
          output_tokens: number
          parent_span_id: string | null
          provider: string | null
          reasoning_tokens: number
          service_name: string | null
          session_id: string | null
          span_id: string
          span_kind: number
          start_time: string | null
          status_code: number
          status_message: string | null
          total_tokens: number
          trace_id: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          attributes?: Json
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          end_time?: string | null
          input_tokens?: number
          kind?: string | null
          model?: string | null
          name?: string | null
          operation?: string | null
          org_id: string
          output_tokens?: number
          parent_span_id?: string | null
          provider?: string | null
          reasoning_tokens?: number
          service_name?: string | null
          session_id?: string | null
          span_id: string
          span_kind?: number
          start_time?: string | null
          status_code?: number
          status_message?: string | null
          total_tokens?: number
          trace_id: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          attributes?: Json
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          end_time?: string | null
          input_tokens?: number
          kind?: string | null
          model?: string | null
          name?: string | null
          operation?: string | null
          org_id?: string
          output_tokens?: number
          parent_span_id?: string | null
          provider?: string | null
          reasoning_tokens?: number
          service_name?: string | null
          session_id?: string | null
          span_id?: string
          span_kind?: number
          start_time?: string | null
          status_code?: number
          status_message?: string | null
          total_tokens?: number
          trace_id?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          project_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          project_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      traces: {
        Row: {
          cost_usd: number
          created_at: string
          duration_ms: number | null
          end_time: string | null
          error_count: number
          input_tokens: number
          models: string[]
          name: string | null
          org_id: string
          output_tokens: number
          project_id: string | null
          root_span_id: string | null
          service_name: string | null
          session_id: string | null
          span_count: number
          start_time: string | null
          total_tokens: number
          trace_id: string
          user_id: string | null
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          end_time?: string | null
          error_count?: number
          input_tokens?: number
          models?: string[]
          name?: string | null
          org_id: string
          output_tokens?: number
          project_id?: string | null
          root_span_id?: string | null
          service_name?: string | null
          session_id?: string | null
          span_count?: number
          start_time?: string | null
          total_tokens?: number
          trace_id: string
          user_id?: string | null
        }
        Update: {
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          end_time?: string | null
          error_count?: number
          input_tokens?: number
          models?: string[]
          name?: string | null
          org_id?: string
          output_tokens?: number
          project_id?: string | null
          root_span_id?: string | null
          service_name?: string | null
          session_id?: string | null
          span_count?: number
          start_time?: string | null
          total_tokens?: number
          trace_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "traces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traces_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traces_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_agg: {
        Row: {
          bucket: string
          cost_saved: number
          cost_usd: number
          holdout_count: number
          id: string
          model: string
          org_id: string
          project_id: string | null
          request_count: number
          tokens_saved: number
          total_tokens: number
        }
        Insert: {
          bucket: string
          cost_saved?: number
          cost_usd?: number
          holdout_count?: number
          id?: string
          model: string
          org_id: string
          project_id?: string | null
          request_count?: number
          tokens_saved?: number
          total_tokens?: number
        }
        Update: {
          bucket?: string
          cost_saved?: number
          cost_usd?: number
          holdout_count?: number
          id?: string
          model?: string
          org_id?: string
          project_id?: string | null
          request_count?: number
          tokens_saved?: number
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_agg_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_agg_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_agg_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_daily: {
        Row: {
          agent: string
          cache_read_tokens: number
          cache_write_tokens: number
          cost_basis: string
          cost_usd: number
          day: string
          input_tokens: number
          latency_ms_sum: number
          latency_n: number
          mcp_server: string
          model: string
          org_id: string
          output_tokens: number
          project_id: string
          reasoning_tokens: number
          repo: string
          requests: number
          skill: string
          source: string
          total_tokens: number
          user_key: string
          vendor_cost_usd: number
        }
        Insert: {
          agent?: string
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_basis?: string
          cost_usd?: number
          day: string
          input_tokens?: number
          latency_ms_sum?: number
          latency_n?: number
          mcp_server?: string
          model?: string
          org_id: string
          output_tokens?: number
          project_id?: string
          reasoning_tokens?: number
          repo?: string
          requests?: number
          skill?: string
          source?: string
          total_tokens?: number
          user_key?: string
          vendor_cost_usd?: number
        }
        Update: {
          agent?: string
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_basis?: string
          cost_usd?: number
          day?: string
          input_tokens?: number
          latency_ms_sum?: number
          latency_n?: number
          mcp_server?: string
          model?: string
          org_id?: string
          output_tokens?: number
          project_id?: string
          reasoning_tokens?: number
          repo?: string
          requests?: number
          skill?: string
          source?: string
          total_tokens?: number
          user_key?: string
          vendor_cost_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_daily_prompts: {
        Row: {
          agent: string
          cost_usd: number
          day: string
          first_at: string
          last_at: string
          model: string
          org_id: string
          project_id: string
          prompt_key: string
          repo: string
          requests: number
          source: string
          total_tokens: number
          user_key: string
        }
        Insert: {
          agent?: string
          cost_usd?: number
          day: string
          first_at: string
          last_at: string
          model?: string
          org_id: string
          project_id?: string
          prompt_key: string
          repo?: string
          requests?: number
          source?: string
          total_tokens?: number
          user_key?: string
        }
        Update: {
          agent?: string
          cost_usd?: number
          day?: string
          first_at?: string
          last_at?: string
          model?: string
          org_id?: string
          project_id?: string
          prompt_key?: string
          repo?: string
          requests?: number
          source?: string
          total_tokens?: number
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_daily_prompts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_daily_prompts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          agent_name: string | null
          api_key_id: string | null
          baseline_cost_usd: number
          cache_read_tokens: number
          cache_write_tokens: number
          completion_tokens: number
          correlation_id: string | null
          cost_basis: string | null
          cost_usd: number
          created_at: string
          event_id: string | null
          id: string
          input_tokens: number
          input_tokens_saved: number
          latency_ms: number | null
          mcp_server: string | null
          metadata: Json
          mode: string | null
          model: string
          optimizations: Json
          org_id: string
          output_tokens: number
          output_tokens_saved: number
          project_id: string | null
          prompt_chars: number | null
          prompt_hash: string | null
          prompt_preview: string | null
          prompt_tokens: number
          provider: string | null
          provider_request_id: string | null
          query_source: string | null
          reasoning_tokens: number
          repo: string | null
          request_idempotency_key: string | null
          session_id: string | null
          skill_name: string | null
          source: string | null
          tags: Json
          tool_name: string | null
          total_tokens: number
          user_email: string | null
          user_id: string | null
          vendor_cost_usd: number | null
          was_holdout: boolean
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          agent_name?: string | null
          api_key_id?: string | null
          baseline_cost_usd?: number
          cache_read_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          correlation_id?: string | null
          cost_basis?: string | null
          cost_usd?: number
          created_at?: string
          event_id?: string | null
          id?: string
          input_tokens?: number
          input_tokens_saved?: number
          latency_ms?: number | null
          mcp_server?: string | null
          metadata?: Json
          mode?: string | null
          model: string
          optimizations?: Json
          org_id: string
          output_tokens?: number
          output_tokens_saved?: number
          project_id?: string | null
          prompt_chars?: number | null
          prompt_hash?: string | null
          prompt_preview?: string | null
          prompt_tokens?: number
          provider?: string | null
          provider_request_id?: string | null
          query_source?: string | null
          reasoning_tokens?: number
          repo?: string | null
          request_idempotency_key?: string | null
          session_id?: string | null
          skill_name?: string | null
          source?: string | null
          tags?: Json
          tool_name?: string | null
          total_tokens?: number
          user_email?: string | null
          user_id?: string | null
          vendor_cost_usd?: number | null
          was_holdout?: boolean
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          agent_name?: string | null
          api_key_id?: string | null
          baseline_cost_usd?: number
          cache_read_tokens?: number
          cache_write_tokens?: number
          completion_tokens?: number
          correlation_id?: string | null
          cost_basis?: string | null
          cost_usd?: number
          created_at?: string
          event_id?: string | null
          id?: string
          input_tokens?: number
          input_tokens_saved?: number
          latency_ms?: number | null
          mcp_server?: string | null
          metadata?: Json
          mode?: string | null
          model?: string
          optimizations?: Json
          org_id?: string
          output_tokens?: number
          output_tokens_saved?: number
          project_id?: string | null
          prompt_chars?: number | null
          prompt_hash?: string | null
          prompt_preview?: string | null
          prompt_tokens?: number
          provider?: string | null
          provider_request_id?: string | null
          query_source?: string | null
          reasoning_tokens?: number
          repo?: string | null
          request_idempotency_key?: string | null
          session_id?: string | null
          skill_name?: string | null
          source?: string | null
          tags?: Json
          tool_name?: string | null
          total_tokens?: number
          user_email?: string | null
          user_id?: string | null
          vendor_cost_usd?: number | null
          was_holdout?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_sessions: {
        Row: {
          agent: string
          cache_read_tokens: number
          cache_write_tokens: number
          cost_usd: number
          first_at: string
          input_tokens: number
          last_at: string
          model: string
          org_id: string
          output_tokens: number
          project_id: string
          repo: string
          requests: number
          session_id: string
          source: string
          total_tokens: number
          user_key: string
        }
        Insert: {
          agent?: string
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          first_at: string
          input_tokens?: number
          last_at: string
          model?: string
          org_id: string
          output_tokens?: number
          project_id?: string
          repo?: string
          requests?: number
          session_id: string
          source?: string
          total_tokens?: number
          user_key?: string
        }
        Update: {
          agent?: string
          cache_read_tokens?: number
          cache_write_tokens?: number
          cost_usd?: number
          first_at?: string
          input_tokens?: number
          last_at?: string
          model?: string
          org_id?: string
          output_tokens?: number
          project_id?: string
          repo?: string
          requests?: number
          session_id?: string
          source?: string
          total_tokens?: number
          user_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          key: string
          settings: Json
          user_id: string
          value: Json
        }
        Insert: {
          key?: string
          settings?: Json
          user_id: string
          value?: Json
        }
        Update: {
          key?: string
          settings?: Json
          user_id?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      orgs: {
        Row: {
          created_at: string | null
          id: string | null
          kill_switch: boolean | null
          name: string | null
          owner_id: string | null
          plan: string | null
          slug: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          kill_switch?: boolean | null
          name?: string | null
          owner_id?: string | null
          plan?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          kill_switch?: boolean | null
          name?: string | null
          owner_id?: string | null
          plan?: string | null
          slug?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      coding_tools_summary: {
        Args: { p_org: string; p_since: string; p_since_ts: string }
        Returns: {
          accepted: number
          active_days: number
          commits: number
          cost_notional: number
          cost_vendor: number
          input_tokens: number
          lines_added: number
          lines_removed: number
          output_tokens: number
          pull_requests: number
          requests: number
          sessions: number
          suggested: number
          tool: string
          user_key: string
        }[]
      }
      dash_breakdown: {
        Args: {
          p_dim: string
          p_filters?: Json
          p_from: string
          p_limit?: number
          p_org: string
          p_to: string
        }
        Returns: Json
      }
      dash_prompts: {
        Args: {
          p_filters?: Json
          p_from: string
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_org: string
          p_to: string
        }
        Returns: Json
      }
      dash_sessions: {
        Args: {
          p_filters?: Json
          p_from: string
          p_limit?: number
          p_offset?: number
          p_order?: string
          p_org: string
          p_to: string
        }
        Returns: Json
      }
      dash_summary: {
        Args: { p_filters?: Json; p_from: string; p_org: string; p_to: string }
        Returns: Json
      }
      finops_usage_dims: {
        Args: {
          p_by_day?: boolean
          p_from: string
          p_org: string
          p_tag_keys?: string[]
          p_to: string
          p_tz?: string
        }
        Returns: {
          cache_read_tokens: number
          cache_write_tokens: number
          cost_basis: string
          cost_usd: number
          day: string
          events: number
          input_tokens: number
          model: string
          output_tokens: number
          project_id: string
          provider: string
          reasoning_tokens: number
          repo: string
          source: string
          tag_values: Json
          total_tokens: number
          user_email: string
          user_id: string
          vendor_cost_usd: number
        }[]
      }
      increment_api_errors: {
        Args: {
          p_day: string
          p_errors: number
          p_model: string
          p_org: string
          p_user_key: string
        }
        Returns: undefined
      }
      insert_prompt_captures: { Args: { p_rows: Json }; Returns: number }
      job_run_finish: {
        Args: {
          p_error?: string
          p_id: number
          p_ok: boolean
          p_summary?: Json
        }
        Returns: undefined
      }
      job_run_start: { Args: { p_job: string }; Returns: number }
      merged_pr_costs: {
        Args: { p_org: string; p_since: string }
        Returns: {
          additions: number
          author_login: string
          cost_usd: number
          deletions: number
          events: number
          merged_at: string
          notional_usd: number
          number: number
          repo: string
          title: string
          user_key: string
          window_start: string
        }[]
      }
      org_member_ids_by_email: {
        Args: { p_emails: string[]; p_org: string }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      org_spend_since: {
        Args: { p_metered_only?: boolean; p_org: string; p_since: string }
        Returns: number
      }
      otlp_state_advance: {
        Args: { p_keys: string[]; p_org: string; p_values: number[] }
        Returns: {
          prev: number
          series_key: string
        }[]
      }
      otlp_state_revert: {
        Args: {
          p_keys: string[]
          p_org: string
          p_prev: number[]
          p_values: number[]
        }
        Returns: number
      }
      price_sync_model_usage: {
        Args: { p_since: string }
        Returns: {
          events: number
          model: string
          org_id: string
          unpriced: number
        }[]
      }
      purge_expired_data: { Args: never; Returns: Json }
      purge_org_data: {
        Args: { p_before: string; p_org: string }
        Returns: Json
      }
      rebuild_rollups: { Args: { p_org: string }; Returns: number }
      reconciliation_metered_daily: {
        Args: { p_org: string; p_since: string }
        Returns: {
          cost_usd: number
          day: string
          events: number
          provider: string
        }[]
      }
      refresh_traces: {
        Args: { p_org: string; p_project: string; p_trace_ids: string[] }
        Returns: number
      }
      tf_connection_sources: {
        Args: {
          p_key_ids?: string[]
          p_org: string
          p_since: string
          p_source?: string
          p_user?: string
        }
        Returns: {
          cost_basis: string
          last_event_at: string
          model: string
          source: string
          tokens_today: number
        }[]
      }
      tf_repo_key: { Args: { p: string }; Returns: string }
      tf_schema_probe: { Args: { p_names: string[] }; Returns: string[] }
      tf_spend_window: {
        Args: {
          p_key_ids?: string[]
          p_org: string
          p_project?: string
          p_since: string
          p_user?: string
          p_users?: string[]
        }
        Returns: {
          cost_usd: number
          events: number
          notional_cost_usd: number
          total_tokens: number
        }[]
      }
      tokenfin_safe_tz: { Args: { p_tz: string }; Returns: string }
      trace_filter_options: {
        Args: { p_org: string; p_since: string }
        Returns: Json
      }
      trace_usage_parents: {
        Args: { p_org: string; p_trace_ids: string[] }
        Returns: {
          span_id: string
          trace_id: string
        }[]
      }
      upsert_productivity: {
        Args: {
          p_accepted: number
          p_active: number
          p_commits: number
          p_day: string
          p_lines_added: number
          p_lines_removed: number
          p_org: string
          p_prs: number
          p_rejected: number
          p_repo: string
          p_sessions: number
          p_user_id: string
          p_user_key: string
        }
        Returns: undefined
      }
      upsert_usage_agg: {
        Args: {
          p_bucket: string
          p_cost: number
          p_cost_saved?: number
          p_holdout?: number
          p_model: string
          p_org_id: string
          p_project_id: string
          p_requests?: number
          p_tokens: number
          p_tokens_saved?: number
        }
        Returns: undefined
      }
      upsert_usage_agg_batch: { Args: { rows: Json }; Returns: undefined }
      usage_rollup_prune: { Args: { p_orgs: string[] }; Returns: undefined }
      usage_rollup_sql: {
        Args: { p_sign: number; p_src: string }
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      _backup_entitlement_delete_byn_2026_05_shulyak: {
        Row: {
          backed_up_at: string
          created_at: string | null
          expires_at: string | null
          id: string | null
          meta: Json | null
          order_id: string | null
          product_code: string | null
          product_id: string | null
          profile_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          backed_up_at?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          meta?: Json | null
          order_id?: string | null
          product_code?: string | null
          product_id?: string | null
          profile_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          backed_up_at?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string | null
          meta?: Json | null
          order_id?: string | null
          product_code?: string | null
          product_id?: string | null
          profile_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_entitlement_tariff_id_backfill_2026_05: {
        Row: {
          backfill_run_id: string
          created_at: string
          entitlement_id: string
          id: string
          old_meta: Json
          product_id: string
          resolution_source: string
          resolved_tariff_id: string
          user_id: string
        }
        Insert: {
          backfill_run_id: string
          created_at?: string
          entitlement_id: string
          id?: string
          old_meta: Json
          product_id: string
          resolution_source: string
          resolved_tariff_id: string
          user_id: string
        }
        Update: {
          backfill_run_id?: string
          created_at?: string
          entitlement_id?: string
          id?: string
          old_meta?: Json
          product_id?: string
          resolution_source?: string
          resolved_tariff_id?: string
          user_id?: string
        }
        Relationships: []
      }
      _inv22_overshoot_snapshot: {
        Row: {
          cohort: string
          correct_end_at: string | null
          created_at: string
          current_end_at: string | null
          email: string | null
          id: string
          is_expired_after_correction: boolean
          meta: Json | null
          notify_required: boolean
          price: number | null
          price_source: string | null
          product_id: string | null
          product_name: string | null
          revoke_required: boolean
          revoke_snapshot_bound: boolean
          silent_backfill: boolean
          snapshot_id: string
          subscription_id: string
          tariff_id: string | null
          tariff_name: string | null
          telegram_user_id: string | null
          user_id: string | null
        }
        Insert: {
          cohort: string
          correct_end_at?: string | null
          created_at?: string
          current_end_at?: string | null
          email?: string | null
          id?: string
          is_expired_after_correction: boolean
          meta?: Json | null
          notify_required: boolean
          price?: number | null
          price_source?: string | null
          product_id?: string | null
          product_name?: string | null
          revoke_required: boolean
          revoke_snapshot_bound?: boolean
          silent_backfill?: boolean
          snapshot_id: string
          subscription_id: string
          tariff_id?: string | null
          tariff_name?: string | null
          telegram_user_id?: string | null
          user_id?: string | null
        }
        Update: {
          cohort?: string
          correct_end_at?: string | null
          created_at?: string
          current_end_at?: string | null
          email?: string | null
          id?: string
          is_expired_after_correction?: boolean
          meta?: Json | null
          notify_required?: boolean
          price?: number | null
          price_source?: string | null
          product_id?: string | null
          product_name?: string | null
          revoke_required?: boolean
          revoke_snapshot_bound?: boolean
          silent_backfill?: boolean
          snapshot_id?: string
          subscription_id?: string
          tariff_id?: string | null
          tariff_name?: string | null
          telegram_user_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _microcorrection_rollback_2026_05_03_backup: {
        Row: {
          access_end_at_before: string | null
          backup_id: string
          captured_at: string
          expires_at_before: string | null
          marker: string | null
          meta_before: Json | null
          next_charge_at_before: string | null
          product_id: string | null
          source_id: string
          source_table: string
          user_id: string | null
        }
        Insert: {
          access_end_at_before?: string | null
          backup_id?: string
          captured_at?: string
          expires_at_before?: string | null
          marker?: string | null
          meta_before?: Json | null
          next_charge_at_before?: string | null
          product_id?: string | null
          source_id: string
          source_table: string
          user_id?: string | null
        }
        Update: {
          access_end_at_before?: string | null
          backup_id?: string
          captured_at?: string
          expires_at_before?: string | null
          marker?: string | null
          meta_before?: Json | null
          next_charge_at_before?: string | null
          product_id?: string | null
          source_id?: string
          source_table?: string
          user_id?: string | null
        }
        Relationships: []
      }
      _orders_cohort_b_cleanup_2026_05_backup: {
        Row: {
          base_price: number
          bepaid_subscription_id: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_ip: string | null
          customer_phone: string | null
          deal_date: string | null
          discount_percent: number | null
          final_price: number
          flow_id: string | null
          gc_next_retry_at: string | null
          id: string
          invoice_email: string | null
          invoice_sent_at: string | null
          is_trial: boolean
          meta: Json | null
          offer_id: string | null
          order_number: string
          paid_amount: number | null
          payer_type: string | null
          payment_plan_id: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          pricing_stage_id: string | null
          product_id: string | null
          profile_id: string | null
          provider: string | null
          provider_payment_id: string | null
          purchase_snapshot: Json | null
          reconcile_source: string | null
          status: Database["public"]["Enums"]["order_status"]
          tariff_id: string | null
          trial_end_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          base_price: number
          bepaid_subscription_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price: number
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean
          meta?: Json | null
          offer_id?: string | null
          order_number: string
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          base_price?: number
          bepaid_subscription_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price?: number
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean
          meta?: Json | null
          offer_id?: string | null
          order_number?: string
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      _orders_orphan_cleanup_2026_05_backup: {
        Row: {
          backed_up_at: string
          created_at: string | null
          customer_email: string | null
          final_price: number | null
          id: string
          meta: Json | null
          order_number: string | null
          product_id: string | null
          profile_id: string | null
          snapshot: Json | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          backed_up_at?: string
          created_at?: string | null
          customer_email?: string | null
          final_price?: number | null
          id: string
          meta?: Json | null
          order_number?: string | null
          product_id?: string | null
          profile_id?: string | null
          snapshot?: Json | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          backed_up_at?: string
          created_at?: string | null
          customer_email?: string | null
          final_price?: number | null
          id?: string
          meta?: Json | null
          order_number?: string | null
          product_id?: string | null
          profile_id?: string | null
          snapshot?: Json | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      access_grant_ledger: {
        Row: {
          action_type: string
          created_at: string
          error_details: Json | null
          execution_key: string
          id: string
          metadata: Json | null
          order_id: string | null
          parent_event_key: string | null
          parent_execution_key: string | null
          profile_id: string | null
          reason_code: string
          result: Json | null
          source_event_key: string
          source_event_type: string
          source_offer_id: string | null
          source_order_id: string | null
          source_subject_ref: string | null
          source_subject_type: string
          source_subscription_id: string | null
          status: string
          target_key: string
          target_ref: string | null
          target_type: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          created_at?: string
          error_details?: Json | null
          execution_key?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          parent_event_key?: string | null
          parent_execution_key?: string | null
          profile_id?: string | null
          reason_code: string
          result?: Json | null
          source_event_key: string
          source_event_type: string
          source_offer_id?: string | null
          source_order_id?: string | null
          source_subject_ref?: string | null
          source_subject_type: string
          source_subscription_id?: string | null
          status: string
          target_key: string
          target_ref?: string | null
          target_type: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string
          error_details?: Json | null
          execution_key?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          parent_event_key?: string | null
          parent_execution_key?: string | null
          profile_id?: string | null
          reason_code?: string
          result?: Json | null
          source_event_key?: string
          source_event_type?: string
          source_offer_id?: string | null
          source_order_id?: string | null
          source_subject_ref?: string | null
          source_subject_type?: string
          source_subscription_id?: string | null
          status?: string
          target_key?: string
          target_ref?: string | null
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ledger_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_profile"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_source_offer"
            columns: ["source_offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_source_order"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_source_subscription"
            columns: ["source_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_source_subscription"
            columns: ["source_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      access_rules: {
        Row: {
          conditions: Json | null
          created_at: string
          created_by: string | null
          duration_days: number | null
          grant_target_type: string
          id: string
          is_active: boolean
          notes: string | null
          priority: number
          product_id: string | null
          target_label: string | null
          target_ref: string
          tariff_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          duration_days?: number | null
          grant_target_type: string
          id?: string
          is_active?: boolean
          notes?: string | null
          priority?: number
          product_id?: string | null
          target_label?: string | null
          target_ref: string
          tariff_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          conditions?: Json | null
          created_at?: string
          created_by?: string | null
          duration_days?: number | null
          grant_target_type?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          priority?: number
          product_id?: string | null
          target_label?: string | null
          target_ref?: string
          tariff_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_rules_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_docs: {
        Row: {
          content_text: string
          created_at: string
          created_by: string | null
          id: string
          meta: Json | null
          section_key: string
          status: string
          updated_at: string
          updated_by: string | null
          version_label: string
        }
        Insert: {
          content_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json | null
          section_key: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_label: string
        }
        Update: {
          content_text?: string
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json | null
          section_key?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version_label?: string
        }
        Relationships: []
      }
      admin_menu_settings: {
        Row: {
          created_at: string | null
          id: string
          items: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_admin_notifications: {
        Row: {
          bot_id: string | null
          created_at: string | null
          handoff_id: string | null
          id: string
          payload: Json | null
          status: string | null
          telegram_user_id: number
          updated_at: string | null
        }
        Insert: {
          bot_id?: string | null
          created_at?: string | null
          handoff_id?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          telegram_user_id: number
          updated_at?: string | null
        }
        Update: {
          bot_id?: string | null
          created_at?: string | null
          handoff_id?: string | null
          id?: string
          payload?: Json | null
          status?: string | null
          telegram_user_id?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_admin_notifications_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_admin_notifications_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_admin_notifications_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "ai_handoffs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_bot_settings: {
        Row: {
          active_prompt_packages: string[] | null
          admin_notify_enabled: boolean | null
          admin_notify_mode: string | null
          admin_notify_targets: Json | null
          anger_policy: string | null
          bot_enabled: boolean | null
          bot_id: string | null
          bot_name: string | null
          bot_position: string | null
          confidence_threshold: number | null
          created_at: string | null
          followup_cooldown_minutes: number | null
          followup_enabled: boolean | null
          greeting_policy: string | null
          handoff_enabled: boolean | null
          hold_ai_when_handoff_open: boolean | null
          id: string
          max_handoff_per_day: number | null
          max_handoff_per_hour: number | null
          max_messages_per_minute: number | null
          message_limit_per_minute: number | null
          name_usage_policy: string | null
          payment_link_limit_per_10min: number | null
          quiet_hours: Json | null
          sliders: Json | null
          style_preset: string | null
          templates: Json | null
          toggles: Json | null
          unknown_policy: string | null
          updated_at: string | null
        }
        Insert: {
          active_prompt_packages?: string[] | null
          admin_notify_enabled?: boolean | null
          admin_notify_mode?: string | null
          admin_notify_targets?: Json | null
          anger_policy?: string | null
          bot_enabled?: boolean | null
          bot_id?: string | null
          bot_name?: string | null
          bot_position?: string | null
          confidence_threshold?: number | null
          created_at?: string | null
          followup_cooldown_minutes?: number | null
          followup_enabled?: boolean | null
          greeting_policy?: string | null
          handoff_enabled?: boolean | null
          hold_ai_when_handoff_open?: boolean | null
          id?: string
          max_handoff_per_day?: number | null
          max_handoff_per_hour?: number | null
          max_messages_per_minute?: number | null
          message_limit_per_minute?: number | null
          name_usage_policy?: string | null
          payment_link_limit_per_10min?: number | null
          quiet_hours?: Json | null
          sliders?: Json | null
          style_preset?: string | null
          templates?: Json | null
          toggles?: Json | null
          unknown_policy?: string | null
          updated_at?: string | null
        }
        Update: {
          active_prompt_packages?: string[] | null
          admin_notify_enabled?: boolean | null
          admin_notify_mode?: string | null
          admin_notify_targets?: Json | null
          anger_policy?: string | null
          bot_enabled?: boolean | null
          bot_id?: string | null
          bot_name?: string | null
          bot_position?: string | null
          confidence_threshold?: number | null
          created_at?: string | null
          followup_cooldown_minutes?: number | null
          followup_enabled?: boolean | null
          greeting_policy?: string | null
          handoff_enabled?: boolean | null
          hold_ai_when_handoff_open?: boolean | null
          id?: string
          max_handoff_per_day?: number | null
          max_handoff_per_hour?: number | null
          max_messages_per_minute?: number | null
          message_limit_per_minute?: number | null
          name_usage_policy?: string | null
          payment_link_limit_per_10min?: number | null
          quiet_hours?: Json | null
          sliders?: Json | null
          style_preset?: string | null
          templates?: Json | null
          toggles?: Json | null
          unknown_policy?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_bot_settings_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_bot_settings_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: true
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          attachments: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          content: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: string
          user_id: string
        }
        Update: {
          attachments?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_document_generation_batches: {
        Row: {
          corporate_draft_session_id: string | null
          created_at: string
          created_by: string | null
          id: string
          meta: Json
          package_template_id: string | null
          profile_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          corporate_draft_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json
          package_template_id?: string | null
          profile_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          corporate_draft_session_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json
          package_template_id?: string | null
          profile_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_document_generation_batches_corporate_draft_session_id_fkey"
            columns: ["corporate_draft_session_id"]
            isOneToOne: false
            referencedRelation: "corporate_draft_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_document_generation_batches_package_template_id_fkey"
            columns: ["package_template_id"]
            isOneToOne: false
            referencedRelation: "document_package_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_document_generation_batches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generated_documents: {
        Row: {
          context_id: string | null
          context_type: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_date: string | null
          document_number: string | null
          document_number_assigned_at: string | null
          document_seq: number | null
          document_timezone: string | null
          file_mime: string | null
          file_name: string | null
          file_path: string | null
          generation_batch_id: string | null
          generation_error: string | null
          id: string
          idempotency_key: string | null
          legal_details_id: string | null
          meta: Json
          missing_tokens: Json
          package_item_id: string | null
          package_template_id: string | null
          person_id: string | null
          profile_id: string
          regenerated_from_document_id: string | null
          registry_version: string | null
          resolver_version: string | null
          signer_link_id: string | null
          signer_person_id: string | null
          snapshot: Json
          source_trace: Json | null
          status: string
          storage_bucket: string
          template_code: string | null
          template_id: string | null
          template_name: string
          template_source_path: string | null
          template_tokens_snapshot: Json | null
          template_version: string | null
          template_version_id: string | null
          title: string
          token_manifest_snapshot: Json | null
          updated_at: string
          warnings_snapshot: Json | null
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_date?: string | null
          document_number?: string | null
          document_number_assigned_at?: string | null
          document_seq?: number | null
          document_timezone?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          generation_batch_id?: string | null
          generation_error?: string | null
          id?: string
          idempotency_key?: string | null
          legal_details_id?: string | null
          meta?: Json
          missing_tokens?: Json
          package_item_id?: string | null
          package_template_id?: string | null
          person_id?: string | null
          profile_id: string
          regenerated_from_document_id?: string | null
          registry_version?: string | null
          resolver_version?: string | null
          signer_link_id?: string | null
          signer_person_id?: string | null
          snapshot?: Json
          source_trace?: Json | null
          status?: string
          storage_bucket?: string
          template_code?: string | null
          template_id?: string | null
          template_name: string
          template_source_path?: string | null
          template_tokens_snapshot?: Json | null
          template_version?: string | null
          template_version_id?: string | null
          title: string
          token_manifest_snapshot?: Json | null
          updated_at?: string
          warnings_snapshot?: Json | null
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_date?: string | null
          document_number?: string | null
          document_number_assigned_at?: string | null
          document_seq?: number | null
          document_timezone?: string | null
          file_mime?: string | null
          file_name?: string | null
          file_path?: string | null
          generation_batch_id?: string | null
          generation_error?: string | null
          id?: string
          idempotency_key?: string | null
          legal_details_id?: string | null
          meta?: Json
          missing_tokens?: Json
          package_item_id?: string | null
          package_template_id?: string | null
          person_id?: string | null
          profile_id?: string
          regenerated_from_document_id?: string | null
          registry_version?: string | null
          resolver_version?: string | null
          signer_link_id?: string | null
          signer_person_id?: string | null
          snapshot?: Json
          source_trace?: Json | null
          status?: string
          storage_bucket?: string
          template_code?: string | null
          template_id?: string | null
          template_name?: string
          template_source_path?: string | null
          template_tokens_snapshot?: Json | null
          template_version?: string | null
          template_version_id?: string | null
          title?: string
          token_manifest_snapshot?: Json | null
          updated_at?: string
          warnings_snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generated_documents_generation_batch_id_fkey"
            columns: ["generation_batch_id"]
            isOneToOne: false
            referencedRelation: "ai_document_generation_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generated_documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generated_documents_regenerated_from_document_id_fkey"
            columns: ["regenerated_from_document_id"]
            isOneToOne: false
            referencedRelation: "ai_generated_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generated_documents_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_handoffs: {
        Row: {
          assigned_to: string | null
          bot_id: string | null
          created_at: string | null
          id: string
          last_message_id: number | null
          meta: Json | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string | null
          telegram_user_id: number
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          bot_id?: string | null
          created_at?: string | null
          id?: string
          last_message_id?: number | null
          meta?: Json | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          telegram_user_id: number
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          bot_id?: string | null
          created_at?: string | null
          id?: string
          last_message_id?: number | null
          meta?: Json | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string | null
          telegram_user_id?: number
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_handoffs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_handoffs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompt_attachments: {
        Row: {
          created_at: string | null
          extracted_chars: number | null
          extracted_text: string | null
          extraction_status: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          prompt_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string | null
          extracted_chars?: number | null
          extracted_text?: string | null
          extraction_status?: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          prompt_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string | null
          extracted_chars?: number | null
          extracted_text?: string | null
          extraction_status?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          prompt_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_prompt_attachments_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "ai_user_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompt_packages: {
        Row: {
          category: string | null
          code: string
          content: string
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          is_system: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code: string
          content: string
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          is_system?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          content?: string
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          is_system?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_rate_limits: {
        Row: {
          action_type: string
          count: number | null
          id: string
          telegram_user_id: number
          window_start: string | null
        }
        Insert: {
          action_type: string
          count?: number | null
          id?: string
          telegram_user_id: number
          window_start?: string | null
        }
        Update: {
          action_type?: string
          count?: number | null
          id?: string
          telegram_user_id?: number
          window_start?: string | null
        }
        Relationships: []
      }
      ai_user_prompts: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          input_hint: string | null
          is_active: boolean | null
          is_archived: boolean | null
          is_visible_in_chat: boolean | null
          launcher_description: string | null
          launcher_order: number | null
          launcher_title: string | null
          prompt_text: string
          response_format: Json | null
          sort_order: number | null
          title: string
          type: Database["public"]["Enums"]["prompt_type"]
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          input_hint?: string | null
          is_active?: boolean | null
          is_archived?: boolean | null
          is_visible_in_chat?: boolean | null
          launcher_description?: string | null
          launcher_order?: number | null
          launcher_title?: string | null
          prompt_text: string
          response_format?: Json | null
          sort_order?: number | null
          title: string
          type?: Database["public"]["Enums"]["prompt_type"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          input_hint?: string | null
          is_active?: boolean | null
          is_archived?: boolean | null
          is_visible_in_chat?: boolean | null
          launcher_description?: string | null
          launcher_order?: number | null
          launcher_title?: string | null
          prompt_text?: string
          response_format?: Json | null
          sort_order?: number | null
          title?: string
          type?: Database["public"]["Enums"]["prompt_type"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      app_sections: {
        Row: {
          code: string
          created_at: string
          cta_label: string | null
          features_json: Json | null
          icon: string | null
          id: string
          is_active: boolean
          is_public: boolean
          label: string
          route: string
          short_description: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          cta_label?: string | null
          features_json?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          label: string
          route: string
          short_description?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          cta_label?: string | null
          features_json?: Json | null
          icon?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          label?: string
          route?: string
          short_description?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audience_insights: {
        Row: {
          channel_id: string | null
          created_at: string | null
          description: string | null
          examples: string[] | null
          first_seen_at: string | null
          frequency: number | null
          id: string
          insight_type: string
          last_seen_at: string | null
          meta: Json | null
          relevance_score: number | null
          sentiment: string | null
          source_message_count: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          description?: string | null
          examples?: string[] | null
          first_seen_at?: string | null
          frequency?: number | null
          id?: string
          insight_type: string
          last_seen_at?: string | null
          meta?: Json | null
          relevance_score?: number | null
          sentiment?: string | null
          source_message_count?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          description?: string | null
          examples?: string[] | null
          first_seen_at?: string | null
          frequency?: number | null
          id?: string
          insight_type?: string
          last_seen_at?: string | null
          meta?: Json | null
          relevance_score?: number | null
          sentiment?: string | null
          source_message_count?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      audience_interests: {
        Row: {
          created_at: string | null
          frequency: number | null
          id: string
          last_discussed: string
          source_summary_id: string | null
          topic: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          frequency?: number | null
          id?: string
          last_discussed: string
          source_summary_id?: string | null
          topic: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          frequency?: number | null
          id?: string
          last_discussed?: string
          source_summary_id?: string | null
          topic?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audience_interests_source_summary_id_fkey"
            columns: ["source_summary_id"]
            isOneToOne: false
            referencedRelation: "tg_daily_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_label: string | null
          actor_type: string
          actor_user_id: string | null
          created_at: string
          id: string
          meta: Json | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_type?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          target_user_id?: string | null
        }
        Relationships: []
      }
      balance_wheel_data: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          stage: string
          updated_at: string
          user_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          stage: string
          updated_at?: string
          user_id: string
          value?: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      ban_cases: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          profile_id: string | null
          reason: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          profile_id?: string | null
          reason?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          profile_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ban_cases_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ban_identifiers: {
        Row: {
          ban_case_id: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          value: string
          value_norm: string
        }
        Insert: {
          ban_case_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          value: string
          value_norm: string
        }
        Update: {
          ban_case_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          value?: string
          value_norm?: string
        }
        Relationships: [
          {
            foreignKeyName: "ban_identifiers_ban_case_id_fkey"
            columns: ["ban_case_id"]
            isOneToOne: false
            referencedRelation: "ban_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      bepaid_product_mappings: {
        Row: {
          auto_create_order: boolean | null
          bepaid_description: string | null
          bepaid_plan_title: string
          created_at: string
          id: string
          is_subscription: boolean | null
          notes: string | null
          offer_id: string | null
          product_id: string | null
          provider: string | null
          tariff_id: string | null
          updated_at: string
        }
        Insert: {
          auto_create_order?: boolean | null
          bepaid_description?: string | null
          bepaid_plan_title: string
          created_at?: string
          id?: string
          is_subscription?: boolean | null
          notes?: string | null
          offer_id?: string | null
          product_id?: string | null
          provider?: string | null
          tariff_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_create_order?: boolean | null
          bepaid_description?: string | null
          bepaid_plan_title?: string
          created_at?: string
          id?: string
          is_subscription?: boolean | null
          notes?: string | null
          offer_id?: string | null
          product_id?: string | null
          provider?: string | null
          tariff_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bepaid_product_mappings_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bepaid_product_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bepaid_product_mappings_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      bepaid_statement_rows: {
        Row: {
          address: string | null
          amount: number | null
          auth_code: string | null
          avs_result: string | null
          bank_code: string | null
          bank_country: string | null
          bank_id: string | null
          bank_name: string | null
          business_category: string | null
          card_bin: string | null
          card_bin_8: string | null
          card_expires: string | null
          card_holder: string | null
          card_masked: string | null
          city: string | null
          commission_per_op: number | null
          commission_percent: number | null
          commission_total: number | null
          conversion_rate: number | null
          converted_amount: number | null
          converted_commission: number | null
          converted_currency: string | null
          converted_payout: number | null
          country: string | null
          created_at_bepaid: string | null
          currency: string | null
          description: string | null
          email: string | null
          expires_at: string | null
          first_name: string | null
          fraud: string | null
          gateway_id: string | null
          id: string
          import_batch_id: string | null
          imported_at: string | null
          ip: string | null
          last_name: string | null
          merchant_company: string | null
          merchant_country: string | null
          merchant_id: string | null
          message: string | null
          order_id_bepaid: string | null
          paid_at: string | null
          payment_identifier: string | null
          payment_method: string | null
          payout_amount: number | null
          payout_date: string | null
          phone: string | null
          product_code: string | null
          raw_data: Json | null
          reason: string | null
          recurring_type: string | null
          region: string | null
          response_code: string | null
          rrn: string | null
          secure_3d: string | null
          shop_id: string | null
          shop_name: string | null
          sort_ts: string | null
          status: string | null
          token_provider: string | null
          tracking_id: string | null
          transaction_type: string | null
          uid: string
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          amount?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bank_country?: string | null
          bank_id?: string | null
          bank_name?: string | null
          business_category?: string | null
          card_bin?: string | null
          card_bin_8?: string | null
          card_expires?: string | null
          card_holder?: string | null
          card_masked?: string | null
          city?: string | null
          commission_per_op?: number | null
          commission_percent?: number | null
          commission_total?: number | null
          conversion_rate?: number | null
          converted_amount?: number | null
          converted_commission?: number | null
          converted_currency?: string | null
          converted_payout?: number | null
          country?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          description?: string | null
          email?: string | null
          expires_at?: string | null
          first_name?: string | null
          fraud?: string | null
          gateway_id?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          ip?: string | null
          last_name?: string | null
          merchant_company?: string | null
          merchant_country?: string | null
          merchant_id?: string | null
          message?: string | null
          order_id_bepaid?: string | null
          paid_at?: string | null
          payment_identifier?: string | null
          payment_method?: string | null
          payout_amount?: number | null
          payout_date?: string | null
          phone?: string | null
          product_code?: string | null
          raw_data?: Json | null
          reason?: string | null
          recurring_type?: string | null
          region?: string | null
          response_code?: string | null
          rrn?: string | null
          secure_3d?: string | null
          shop_id?: string | null
          shop_name?: string | null
          sort_ts?: string | null
          status?: string | null
          token_provider?: string | null
          tracking_id?: string | null
          transaction_type?: string | null
          uid: string
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          amount?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bank_country?: string | null
          bank_id?: string | null
          bank_name?: string | null
          business_category?: string | null
          card_bin?: string | null
          card_bin_8?: string | null
          card_expires?: string | null
          card_holder?: string | null
          card_masked?: string | null
          city?: string | null
          commission_per_op?: number | null
          commission_percent?: number | null
          commission_total?: number | null
          conversion_rate?: number | null
          converted_amount?: number | null
          converted_commission?: number | null
          converted_currency?: string | null
          converted_payout?: number | null
          country?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          description?: string | null
          email?: string | null
          expires_at?: string | null
          first_name?: string | null
          fraud?: string | null
          gateway_id?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          ip?: string | null
          last_name?: string | null
          merchant_company?: string | null
          merchant_country?: string | null
          merchant_id?: string | null
          message?: string | null
          order_id_bepaid?: string | null
          paid_at?: string | null
          payment_identifier?: string | null
          payment_method?: string | null
          payout_amount?: number | null
          payout_date?: string | null
          phone?: string | null
          product_code?: string | null
          raw_data?: Json | null
          reason?: string | null
          recurring_type?: string | null
          region?: string | null
          response_code?: string | null
          rrn?: string | null
          secure_3d?: string | null
          shop_id?: string | null
          shop_name?: string | null
          sort_ts?: string | null
          status?: string | null
          token_provider?: string | null
          tracking_id?: string | null
          transaction_type?: string | null
          uid?: string
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      bepaid_sync_logs: {
        Row: {
          already_exists: number | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          errors: number | null
          from_date: string | null
          id: string
          meta: Json | null
          pages_fetched: number | null
          processed: number | null
          queued: number | null
          sample_uids: string[] | null
          shop_id: string | null
          started_at: string
          status: string | null
          subscriptions_fetched: number | null
          sync_type: string
          to_date: string | null
          transactions_fetched: number | null
        }
        Insert: {
          already_exists?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          errors?: number | null
          from_date?: string | null
          id?: string
          meta?: Json | null
          pages_fetched?: number | null
          processed?: number | null
          queued?: number | null
          sample_uids?: string[] | null
          shop_id?: string | null
          started_at?: string
          status?: string | null
          subscriptions_fetched?: number | null
          sync_type?: string
          to_date?: string | null
          transactions_fetched?: number | null
        }
        Update: {
          already_exists?: number | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          errors?: number | null
          from_date?: string | null
          id?: string
          meta?: Json | null
          pages_fetched?: number | null
          processed?: number | null
          queued?: number | null
          sample_uids?: string[] | null
          shop_id?: string | null
          started_at?: string
          status?: string | null
          subscriptions_fetched?: number | null
          sync_type?: string
          to_date?: string | null
          transactions_fetched?: number | null
        }
        Relationships: []
      }
      broadcast_dispatcher_config: {
        Row: {
          enabled: boolean
          id: number
          production_approved: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: number
          production_approved?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: number
          production_approved?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      broadcast_runs: {
        Row: {
          audience_count: number | null
          audience_snapshot: Json | null
          channel: string
          created_at: string
          dispatch_mode: string
          dry_run: boolean
          error: string | null
          failed_count: number
          finished_at: string | null
          id: string
          idempotency_key: string
          sent_count: number
          skipped_count: number
          started_at: string
          template_id: string
          triggered_by: string
        }
        Insert: {
          audience_count?: number | null
          audience_snapshot?: Json | null
          channel: string
          created_at?: string
          dispatch_mode?: string
          dry_run?: boolean
          error?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key: string
          sent_count?: number
          skipped_count?: number
          started_at?: string
          template_id: string
          triggered_by: string
        }
        Update: {
          audience_count?: number | null
          audience_snapshot?: Json | null
          channel?: string
          created_at?: string
          dispatch_mode?: string
          dry_run?: boolean
          error?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          sent_count?: number
          skipped_count?: number
          started_at?: string
          template_id?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "broadcast_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_templates: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          audience_filters: Json
          button_text: string | null
          button_url: string | null
          channel: string
          channels: string[]
          created_at: string | null
          created_by: string | null
          email_body_html: string | null
          email_only_when_no_telegram: boolean
          email_subject: string | null
          failed_count: number | null
          id: string
          last_run_at: string | null
          live_event_id: string | null
          media_file_name: string | null
          media_storage_path: string | null
          media_type: string | null
          message_text: string | null
          metadata: Json
          name: string
          next_run_at: string | null
          recurrence_rule: Json | null
          rejected_reason: string | null
          scheduled_for: string | null
          send_mode: string
          sent_at: string | null
          sent_count: number | null
          status: string
          targeting_tariff_id: string | null
          template_type: string
          total_runs: number
          updated_at: string | null
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience_filters?: Json
          button_text?: string | null
          button_url?: string | null
          channel?: string
          channels?: string[]
          created_at?: string | null
          created_by?: string | null
          email_body_html?: string | null
          email_only_when_no_telegram?: boolean
          email_subject?: string | null
          failed_count?: number | null
          id?: string
          last_run_at?: string | null
          live_event_id?: string | null
          media_file_name?: string | null
          media_storage_path?: string | null
          media_type?: string | null
          message_text?: string | null
          metadata?: Json
          name: string
          next_run_at?: string | null
          recurrence_rule?: Json | null
          rejected_reason?: string | null
          scheduled_for?: string | null
          send_mode?: string
          sent_at?: string | null
          sent_count?: number | null
          status?: string
          targeting_tariff_id?: string | null
          template_type?: string
          total_runs?: number
          updated_at?: string | null
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience_filters?: Json
          button_text?: string | null
          button_url?: string | null
          channel?: string
          channels?: string[]
          created_at?: string | null
          created_by?: string | null
          email_body_html?: string | null
          email_only_when_no_telegram?: boolean
          email_subject?: string | null
          failed_count?: number | null
          id?: string
          last_run_at?: string | null
          live_event_id?: string | null
          media_file_name?: string | null
          media_storage_path?: string | null
          media_type?: string | null
          message_text?: string | null
          metadata?: Json
          name?: string
          next_run_at?: string | null
          recurrence_rule?: Json | null
          rejected_reason?: string | null
          scheduled_for?: string | null
          send_mode?: string
          sent_at?: string | null
          sent_count?: number | null
          status?: string
          targeting_tariff_id?: string | null
          template_type?: string
          total_runs?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_templates_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_templates_targeting_tariff_id_fkey"
            columns: ["targeting_tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      card_profile_links: {
        Row: {
          card_brand: string | null
          card_holder: string | null
          card_last4: string
          created_at: string | null
          id: string
          linked_at: string | null
          linked_by: string | null
          profile_id: string
          provider: string | null
          provider_token: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          card_brand?: string | null
          card_holder?: string | null
          card_last4: string
          created_at?: string | null
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          profile_id: string
          provider?: string | null
          provider_token?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string
          created_at?: string | null
          id?: string
          linked_at?: string | null
          linked_by?: string | null
          profile_id?: string
          provider?: string | null
          provider_token?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_profile_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_posts_archive: {
        Row: {
          channel_id: string
          created_at: string | null
          date: string | null
          forwards: number | null
          from_name: string | null
          id: string
          imported_at: string | null
          media_type: string | null
          raw_data: Json | null
          telegram_message_id: number | null
          text: string | null
          views: number | null
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          date?: string | null
          forwards?: number | null
          from_name?: string | null
          id?: string
          imported_at?: string | null
          media_type?: string | null
          raw_data?: Json | null
          telegram_message_id?: number | null
          text?: string | null
          views?: number | null
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          date?: string | null
          forwards?: number | null
          from_name?: string | null
          id?: string
          imported_at?: string | null
          media_type?: string | null
          raw_data?: Json | null
          telegram_message_id?: number | null
          text?: string | null
          views?: number | null
        }
        Relationships: []
      }
      chat_preferences: {
        Row: {
          admin_user_id: string
          contact_user_id: string
          created_at: string | null
          id: string
          is_favorite: boolean | null
          is_pinned: boolean | null
          is_read: boolean | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          admin_user_id: string
          contact_user_id: string
          created_at?: string | null
          id?: string
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_user_id?: string
          contact_user_id?: string
          created_at?: string | null
          id?: string
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      client_duplicates: {
        Row: {
          case_id: string
          created_at: string | null
          id: string
          is_master: boolean | null
          profile_id: string
        }
        Insert: {
          case_id: string
          created_at?: string | null
          id?: string
          is_master?: boolean | null
          profile_id: string
        }
        Update: {
          case_id?: string
          created_at?: string | null
          id?: string
          is_master?: boolean | null
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_duplicates_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "duplicate_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_duplicates_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_legal_details: {
        Row: {
          bank_account: string | null
          bank_code: string | null
          bank_name: string | null
          client_type: string
          created_at: string
          email: string | null
          ent_acts_on_basis: string | null
          ent_address: string | null
          ent_address_structured: Json | null
          ent_name: string | null
          ent_unp: string | null
          grp_last_fetched_at: string | null
          grp_liquidation_date: string | null
          grp_liquidation_reason: string | null
          grp_registration_date: string | null
          grp_short_name: string | null
          grp_status_code: string | null
          grp_status_name: string | null
          grp_tax_office_code: string | null
          grp_tax_office_name: string | null
          id: string
          ind_address_apartment: string | null
          ind_address_city: string | null
          ind_address_district: string | null
          ind_address_house: string | null
          ind_address_index: string | null
          ind_address_region: string | null
          ind_address_street: string | null
          ind_address_structured: Json | null
          ind_birth_date: string | null
          ind_full_name: string | null
          ind_passport_issued_by: string | null
          ind_passport_issued_date: string | null
          ind_passport_number: string | null
          ind_passport_series: string | null
          ind_passport_valid_until: string | null
          ind_personal_number: string | null
          is_default: boolean
          leg_acts_on_basis: string | null
          leg_address: string | null
          leg_address_structured: Json | null
          leg_director_name: string | null
          leg_director_position: string | null
          leg_name: string | null
          leg_org_form: string | null
          leg_unp: string | null
          phone: string | null
          profile_id: string
          purpose: string
          status: string
          updated_at: string
          validated_at: string | null
          validation_errors: Json | null
          validation_status: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_code?: string | null
          bank_name?: string | null
          client_type?: string
          created_at?: string
          email?: string | null
          ent_acts_on_basis?: string | null
          ent_address?: string | null
          ent_address_structured?: Json | null
          ent_name?: string | null
          ent_unp?: string | null
          grp_last_fetched_at?: string | null
          grp_liquidation_date?: string | null
          grp_liquidation_reason?: string | null
          grp_registration_date?: string | null
          grp_short_name?: string | null
          grp_status_code?: string | null
          grp_status_name?: string | null
          grp_tax_office_code?: string | null
          grp_tax_office_name?: string | null
          id?: string
          ind_address_apartment?: string | null
          ind_address_city?: string | null
          ind_address_district?: string | null
          ind_address_house?: string | null
          ind_address_index?: string | null
          ind_address_region?: string | null
          ind_address_street?: string | null
          ind_address_structured?: Json | null
          ind_birth_date?: string | null
          ind_full_name?: string | null
          ind_passport_issued_by?: string | null
          ind_passport_issued_date?: string | null
          ind_passport_number?: string | null
          ind_passport_series?: string | null
          ind_passport_valid_until?: string | null
          ind_personal_number?: string | null
          is_default?: boolean
          leg_acts_on_basis?: string | null
          leg_address?: string | null
          leg_address_structured?: Json | null
          leg_director_name?: string | null
          leg_director_position?: string | null
          leg_name?: string | null
          leg_org_form?: string | null
          leg_unp?: string | null
          phone?: string | null
          profile_id: string
          purpose?: string
          status?: string
          updated_at?: string
          validated_at?: string | null
          validation_errors?: Json | null
          validation_status?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_code?: string | null
          bank_name?: string | null
          client_type?: string
          created_at?: string
          email?: string | null
          ent_acts_on_basis?: string | null
          ent_address?: string | null
          ent_address_structured?: Json | null
          ent_name?: string | null
          ent_unp?: string | null
          grp_last_fetched_at?: string | null
          grp_liquidation_date?: string | null
          grp_liquidation_reason?: string | null
          grp_registration_date?: string | null
          grp_short_name?: string | null
          grp_status_code?: string | null
          grp_status_name?: string | null
          grp_tax_office_code?: string | null
          grp_tax_office_name?: string | null
          id?: string
          ind_address_apartment?: string | null
          ind_address_city?: string | null
          ind_address_district?: string | null
          ind_address_house?: string | null
          ind_address_index?: string | null
          ind_address_region?: string | null
          ind_address_street?: string | null
          ind_address_structured?: Json | null
          ind_birth_date?: string | null
          ind_full_name?: string | null
          ind_passport_issued_by?: string | null
          ind_passport_issued_date?: string | null
          ind_passport_number?: string | null
          ind_passport_series?: string | null
          ind_passport_valid_until?: string | null
          ind_personal_number?: string | null
          is_default?: boolean
          leg_acts_on_basis?: string | null
          leg_address?: string | null
          leg_address_structured?: Json | null
          leg_director_name?: string | null
          leg_director_position?: string | null
          leg_name?: string | null
          leg_org_form?: string | null
          leg_unp?: string | null
          phone?: string | null
          profile_id?: string
          purpose?: string
          status?: string
          updated_at?: string
          validated_at?: string | null
          validation_errors?: Json | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_legal_details_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_logs: {
        Row: {
          consent_type: string
          created_at: string | null
          email: string | null
          granted: boolean
          id: string
          ip_address: string | null
          meta: Json | null
          policy_version: string
          source: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          consent_type: string
          created_at?: string | null
          email?: string | null
          granted?: boolean
          id?: string
          ip_address?: string | null
          meta?: Json | null
          policy_version: string
          source: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          consent_type?: string
          created_at?: string | null
          email?: string | null
          granted?: boolean
          id?: string
          ip_address?: string | null
          meta?: Json | null
          policy_version?: string
          source?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      contact_requests: {
        Row: {
          consent: boolean
          created_at: string
          email: string
          id: string
          message: string
          name: string
          phone: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          message: string
          name: string
          phone?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          message?: string
          name?: string
          phone?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      content: {
        Row: {
          access_level: string
          author_id: string
          content: string | null
          created_at: string
          id: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          access_level?: string
          author_id: string
          content?: string | null
          created_at?: string
          id?: string
          status?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          access_level?: string
          author_id?: string
          content?: string | null
          created_at?: string
          id?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      corporate_draft_sessions: {
        Row: {
          blocking_errors: Json | null
          charter_confirmed_at: string | null
          charter_confirmed_by: string | null
          charter_extraction_status: string | null
          charter_file_path: string | null
          charter_raw_text: string | null
          charter_source_type: string | null
          confirmed_charter_rules: Json | null
          corporate_params: Json | null
          created_at: string | null
          created_by: string | null
          extracted_charter_rules: Json | null
          id: string
          legal_details_id: string | null
          metadata: Json | null
          non_blocking_warnings: Json | null
          package_manifest: Json | null
          procedure_mode: string
          procedure_mode_override_reason: string | null
          profile_id: string
          public_id: string | null
          report_year: number
          rules_basis: string | null
          status: string
          updated_at: string | null
          updated_by: string | null
          warnings: Json | null
        }
        Insert: {
          blocking_errors?: Json | null
          charter_confirmed_at?: string | null
          charter_confirmed_by?: string | null
          charter_extraction_status?: string | null
          charter_file_path?: string | null
          charter_raw_text?: string | null
          charter_source_type?: string | null
          confirmed_charter_rules?: Json | null
          corporate_params?: Json | null
          created_at?: string | null
          created_by?: string | null
          extracted_charter_rules?: Json | null
          id?: string
          legal_details_id?: string | null
          metadata?: Json | null
          non_blocking_warnings?: Json | null
          package_manifest?: Json | null
          procedure_mode?: string
          procedure_mode_override_reason?: string | null
          profile_id: string
          public_id?: string | null
          report_year?: number
          rules_basis?: string | null
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          warnings?: Json | null
        }
        Update: {
          blocking_errors?: Json | null
          charter_confirmed_at?: string | null
          charter_confirmed_by?: string | null
          charter_extraction_status?: string | null
          charter_file_path?: string | null
          charter_raw_text?: string | null
          charter_source_type?: string | null
          confirmed_charter_rules?: Json | null
          corporate_params?: Json | null
          created_at?: string | null
          created_by?: string | null
          extracted_charter_rules?: Json | null
          id?: string
          legal_details_id?: string | null
          metadata?: Json | null
          non_blocking_warnings?: Json | null
          package_manifest?: Json | null
          procedure_mode?: string
          procedure_mode_override_reason?: string | null
          profile_id?: string
          public_id?: string | null
          report_year?: number
          rules_basis?: string | null
          status?: string
          updated_at?: string | null
          updated_by?: string | null
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_draft_sessions_legal_details_id_fkey"
            columns: ["legal_details_id"]
            isOneToOne: false
            referencedRelation: "client_legal_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_draft_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_preregistrations: {
        Row: {
          consent: boolean
          created_at: string
          email: string
          id: string
          meta: Json | null
          name: string
          notes: string | null
          phone: string | null
          product_code: string
          source: string | null
          status: string
          tariff_name: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          consent?: boolean
          created_at?: string
          email: string
          id?: string
          meta?: Json | null
          name: string
          notes?: string | null
          phone?: string | null
          product_code?: string
          source?: string | null
          status?: string
          tariff_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          consent?: boolean
          created_at?: string
          email?: string
          id?: string
          meta?: Json | null
          name?: string
          notes?: string | null
          phone?: string | null
          product_code?: string
          source?: string | null
          status?: string
          tariff_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      crm_activity_log: {
        Row: {
          activity_type: string
          author_snapshot: string | null
          contact_id: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          live_event_id: string | null
          metadata: Json | null
          public_id: string
          source_entity_id: string
          source_entity_type: string
          text_snapshot: string | null
          title_snapshot: string | null
          user_id: string
          visibility_scope: string | null
        }
        Insert: {
          activity_type: string
          author_snapshot?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          live_event_id?: string | null
          metadata?: Json | null
          public_id?: string
          source_entity_id: string
          source_entity_type: string
          text_snapshot?: string | null
          title_snapshot?: string | null
          user_id: string
          visibility_scope?: string | null
        }
        Update: {
          activity_type?: string
          author_snapshot?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          live_event_id?: string | null
          metadata?: Json | null
          public_id?: string
          source_entity_id?: string
          source_entity_type?: string
          text_snapshot?: string | null
          title_snapshot?: string | null
          user_id?: string
          visibility_scope?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_activity_log_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipeline_product_bindings: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          pipeline_id: string
          product_id: string
          public_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          pipeline_id: string
          product_id: string
          public_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          pipeline_id?: string
          product_id?: string
          public_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_product_bindings_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_pipeline_product_bindings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipeline_stages: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          metadata: Json | null
          name: string
          order_index: number
          pipeline_id: string
          public_id: string
          stage_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          metadata?: Json | null
          name: string
          order_index?: number
          pipeline_id: string
          public_id?: string
          stage_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          metadata?: Json | null
          name?: string
          order_index?: number
          pipeline_id?: string
          public_id?: string
          stage_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          metadata: Json | null
          name: string
          order_index: number
          public_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          metadata?: Json | null
          name: string
          order_index?: number
          public_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          metadata?: Json | null
          name?: string
          order_index?: number
          public_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      deploy_logs: {
        Row: {
          commit_sha: string
          created_at: string
          deployed_functions: string[]
          duration_ms: number | null
          failed_functions: string[] | null
          finished_at: string | null
          id: string
          run_id: string
          run_number: number | null
          started_at: string
          status: string
        }
        Insert: {
          commit_sha: string
          created_at?: string
          deployed_functions?: string[]
          duration_ms?: number | null
          failed_functions?: string[] | null
          finished_at?: string | null
          id?: string
          run_id: string
          run_number?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          commit_sha?: string
          created_at?: string
          deployed_functions?: string[]
          duration_ms?: number | null
          failed_functions?: string[] | null
          finished_at?: string | null
          id?: string
          run_id?: string
          run_number?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      document_generation_rules: {
        Row: {
          auto_send_email: boolean | null
          auto_send_telegram: boolean | null
          created_at: string | null
          description: string | null
          field_overrides: Json | null
          id: string
          is_active: boolean | null
          max_amount: number | null
          min_amount: number | null
          name: string
          offer_id: string | null
          payer_type_filter: string[] | null
          priority: number | null
          product_id: string | null
          tariff_id: string | null
          template_id: string
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          auto_send_email?: boolean | null
          auto_send_telegram?: boolean | null
          created_at?: string | null
          description?: string | null
          field_overrides?: Json | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name: string
          offer_id?: string | null
          payer_type_filter?: string[] | null
          priority?: number | null
          product_id?: string | null
          tariff_id?: string | null
          template_id: string
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          auto_send_email?: boolean | null
          auto_send_telegram?: boolean | null
          created_at?: string | null
          description?: string | null
          field_overrides?: Json | null
          id?: string
          is_active?: boolean | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          offer_id?: string | null
          payer_type_filter?: string[] | null
          priority?: number | null
          product_id?: string | null
          tariff_id?: string | null
          template_id?: string
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_generation_rules_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_rules_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      document_generation_sessions: {
        Row: {
          context_id: string | null
          context_type: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          legal_details_id: string | null
          missing_tokens: Json
          person_id: string | null
          resolved_tokens: Json
          signer_link_id: string | null
          status: string
          template_id: string | null
          template_version_id: string | null
          updated_at: string
          warnings: Json
        }
        Insert: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          legal_details_id?: string | null
          missing_tokens?: Json
          person_id?: string | null
          resolved_tokens?: Json
          signer_link_id?: string | null
          status?: string
          template_id?: string | null
          template_version_id?: string | null
          updated_at?: string
          warnings?: Json
        }
        Update: {
          context_id?: string | null
          context_type?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          legal_details_id?: string | null
          missing_tokens?: Json
          person_id?: string | null
          resolved_tokens?: Json
          signer_link_id?: string | null
          status?: string
          template_id?: string | null
          template_version_id?: string | null
          updated_at?: string
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "document_generation_sessions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_generation_sessions_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_number_counters: {
        Row: {
          created_at: string
          document_date: string
          document_timezone: string
          id: string
          last_seq: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_date: string
          document_timezone?: string
          id?: string
          last_seq?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_date?: string
          document_timezone?: string
          id?: string
          last_seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      document_number_sequences: {
        Row: {
          created_at: string | null
          document_type: string
          format: string | null
          id: string
          last_number: number | null
          prefix: string
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          document_type: string
          format?: string | null
          id?: string
          last_number?: number | null
          prefix?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          document_type?: string
          format?: string | null
          id?: string
          last_number?: number | null
          prefix?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      document_package_item_role_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          metadata: Json
          package_session_id: string
          package_template_item_id: string
          person_id: string | null
          role_catalog_id: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          package_session_id: string
          package_template_item_id: string
          person_id?: string | null
          role_catalog_id: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          package_session_id?: string
          package_template_item_id?: string
          person_id?: string | null
          role_catalog_id?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_package_item_role_assign_package_template_item_id_fkey"
            columns: ["package_template_item_id"]
            isOneToOne: false
            referencedRelation: "document_package_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_item_role_assignments_package_session_id_fkey"
            columns: ["package_session_id"]
            isOneToOne: false
            referencedRelation: "document_package_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_item_role_assignments_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "legal_details_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_item_role_assignments_role_catalog_id_fkey"
            columns: ["role_catalog_id"]
            isOneToOne: false
            referencedRelation: "document_package_role_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      document_package_role_catalog: {
        Row: {
          allowed_entity_types: string[]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          label: string
          max_count: number | null
          metadata: Json
          min_count: number | null
          output_template: string | null
          package_template_id: string
          public_id: string
          required: boolean
          role_key: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed_entity_types: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          label: string
          max_count?: number | null
          metadata?: Json
          min_count?: number | null
          output_template?: string | null
          package_template_id: string
          public_id: string
          required?: boolean
          role_key: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed_entity_types?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          label?: string
          max_count?: number | null
          metadata?: Json
          min_count?: number | null
          output_template?: string | null
          package_template_id?: string
          public_id?: string
          required?: boolean
          role_key?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_package_role_catalog_package_template_id_fkey"
            columns: ["package_template_id"]
            isOneToOne: false
            referencedRelation: "document_package_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      document_package_session_participants: {
        Row: {
          created_at: string
          created_by: string | null
          entity_type: string
          id: string
          is_primary: boolean
          is_required: boolean
          legal_entity_id: string | null
          metadata: Json
          package_session_id: string
          person_id: string | null
          role_catalog_id: string | null
          role_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_type: string
          id?: string
          is_primary?: boolean
          is_required?: boolean
          legal_entity_id?: string | null
          metadata?: Json
          package_session_id: string
          person_id?: string | null
          role_catalog_id?: string | null
          role_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_type?: string
          id?: string
          is_primary?: boolean
          is_required?: boolean
          legal_entity_id?: string | null
          metadata?: Json
          package_session_id?: string
          person_id?: string | null
          role_catalog_id?: string | null
          role_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_package_session_participants_legal_entity_id_fkey"
            columns: ["legal_entity_id"]
            isOneToOne: false
            referencedRelation: "client_legal_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_session_participants_package_session_id_fkey"
            columns: ["package_session_id"]
            isOneToOne: false
            referencedRelation: "document_package_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_session_participants_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "legal_details_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_session_participants_role_catalog_id_fkey"
            columns: ["role_catalog_id"]
            isOneToOne: false
            referencedRelation: "document_package_role_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      document_package_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          entitlement_id: string | null
          first_generated_document_id: string | null
          first_generation_batch_id: string | null
          id: string
          legal_entity_locked_at: string | null
          legal_entity_locked_by_event: string | null
          metadata: Json
          order_id: string | null
          package_template_id: string
          product_id: string | null
          profile_id: string
          public_id: string | null
          selected_legal_entity_id: string | null
          status: string
          tariff_id: string | null
          unlock_reason: string | null
          unlocked_at: string | null
          unlocked_by: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entitlement_id?: string | null
          first_generated_document_id?: string | null
          first_generation_batch_id?: string | null
          id?: string
          legal_entity_locked_at?: string | null
          legal_entity_locked_by_event?: string | null
          metadata?: Json
          order_id?: string | null
          package_template_id: string
          product_id?: string | null
          profile_id: string
          public_id?: string | null
          selected_legal_entity_id?: string | null
          status?: string
          tariff_id?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entitlement_id?: string | null
          first_generated_document_id?: string | null
          first_generation_batch_id?: string | null
          id?: string
          legal_entity_locked_at?: string | null
          legal_entity_locked_by_event?: string | null
          metadata?: Json
          order_id?: string | null
          package_template_id?: string
          product_id?: string | null
          profile_id?: string
          public_id?: string | null
          selected_legal_entity_id?: string | null
          status?: string
          tariff_id?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_package_sessions_package_template_id_fkey"
            columns: ["package_template_id"]
            isOneToOne: false
            referencedRelation: "document_package_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_sessions_selected_legal_entity_id_fkey"
            columns: ["selected_legal_entity_id"]
            isOneToOne: false
            referencedRelation: "client_legal_details"
            referencedColumns: ["id"]
          },
        ]
      }
      document_package_template_items: {
        Row: {
          created_at: string
          id: string
          is_required: boolean
          package_template_id: string
          sort_order: number
          template_id: string
          title_override: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_required?: boolean
          package_template_id: string
          sort_order?: number
          template_id: string
          title_override?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_required?: boolean
          package_template_id?: string
          sort_order?: number
          template_id?: string
          title_override?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_package_template_items_package_template_id_fkey"
            columns: ["package_template_id"]
            isOneToOne: false
            referencedRelation: "document_package_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_package_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      document_package_templates: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          profile_id: string | null
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          profile_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          profile_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      document_package_token_aliases: {
        Row: {
          alias_token: string
          archived_at: string | null
          canonical_field_public_id: string | null
          context_kind: string
          created_at: string
          id: string
          metadata: Json
          role_key: string
          source_path: string | null
          updated_at: string
        }
        Insert: {
          alias_token: string
          archived_at?: string | null
          canonical_field_public_id?: string | null
          context_kind: string
          created_at?: string
          id?: string
          metadata?: Json
          role_key: string
          source_path?: string | null
          updated_at?: string
        }
        Update: {
          alias_token?: string
          archived_at?: string | null
          canonical_field_public_id?: string | null
          context_kind?: string
          created_at?: string
          id?: string
          metadata?: Json
          role_key?: string
          source_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dpta_canonical_fk"
            columns: ["canonical_field_public_id"]
            isOneToOne: false
            referencedRelation: "fields_registry"
            referencedColumns: ["public_id"]
          },
        ]
      }
      document_template_versions: {
        Row: {
          created_at: string
          created_by: string | null
          detected_tokens: Json
          editor_html: string | null
          editor_json: Json | null
          file_name: string | null
          file_sha256: string | null
          file_size_bytes: number | null
          id: string
          is_current: boolean
          markup_draft: Json | null
          markup_status: string
          notes: string | null
          storage_bucket: string
          storage_path: string
          template_id: string
          token_manifest: Json
          tokens: Json
          unmapped_tokens: Json
          validation_checked_at: string | null
          validation_errors: Json
          validation_status: string | null
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          detected_tokens?: Json
          editor_html?: string | null
          editor_json?: Json | null
          file_name?: string | null
          file_sha256?: string | null
          file_size_bytes?: number | null
          id?: string
          is_current?: boolean
          markup_draft?: Json | null
          markup_status?: string
          notes?: string | null
          storage_bucket?: string
          storage_path: string
          template_id: string
          token_manifest?: Json
          tokens?: Json
          unmapped_tokens?: Json
          validation_checked_at?: string | null
          validation_errors?: Json
          validation_status?: string | null
          version_number: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          detected_tokens?: Json
          editor_html?: string | null
          editor_json?: Json | null
          file_name?: string | null
          file_sha256?: string | null
          file_size_bytes?: number | null
          id?: string
          is_current?: boolean
          markup_draft?: Json | null
          markup_status?: string
          notes?: string | null
          storage_bucket?: string
          storage_path?: string
          template_id?: string
          token_manifest?: Json
          tokens?: Json
          unmapped_tokens?: Json
          validation_checked_at?: string | null
          validation_errors?: Json
          validation_status?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      document_templates: {
        Row: {
          category: string | null
          code: string
          created_at: string
          current_version_id: string | null
          deleted_at: string | null
          description: string | null
          document_type: string
          editor_draft_content: Json | null
          editor_mvp_enabled: boolean
          file_name_template: string | null
          id: string
          idempotency_scope: string | null
          is_active: boolean | null
          name: string
          placeholders: Json | null
          template_notes: string | null
          template_path: string
          template_scope: string
          template_status: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          document_type?: string
          editor_draft_content?: Json | null
          editor_mvp_enabled?: boolean
          file_name_template?: string | null
          id?: string
          idempotency_scope?: string | null
          is_active?: boolean | null
          name: string
          placeholders?: Json | null
          template_notes?: string | null
          template_path: string
          template_scope?: string
          template_status?: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          description?: string | null
          document_type?: string
          editor_draft_content?: Json | null
          editor_mvp_enabled?: boolean
          file_name_template?: string | null
          id?: string
          idempotency_scope?: string | null
          is_active?: boolean | null
          name?: string
          placeholders?: Json | null
          template_notes?: string | null
          template_path?: string
          template_scope?: string
          template_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_templates_current_version_id_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_token_aliases: {
        Row: {
          alias_token: string
          canonical_token_key: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          notes: string | null
          template_id: string | null
          template_version_id: string | null
        }
        Insert: {
          alias_token: string
          canonical_token_key: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          template_id?: string | null
          template_version_id?: string | null
        }
        Update: {
          alias_token?: string
          canonical_token_key?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          template_id?: string | null
          template_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_token_aliases_canonical_token_key_fkey"
            columns: ["canonical_token_key"]
            isOneToOne: false
            referencedRelation: "document_token_registry"
            referencedColumns: ["token_key"]
          },
          {
            foreignKeyName: "document_token_aliases_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_token_aliases_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "document_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      document_token_registry: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          category: string
          created_at: string
          data_type: string
          description: string | null
          display_order: number
          example_value: string | null
          field_id: string | null
          id: string
          is_required: boolean
          resolver_key: string | null
          source_type: string
          token_key: string
          ui_label: string
          updated_at: string
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          category?: string
          created_at?: string
          data_type?: string
          description?: string | null
          display_order?: number
          example_value?: string | null
          field_id?: string | null
          id?: string
          is_required?: boolean
          resolver_key?: string | null
          source_type?: string
          token_key: string
          ui_label: string
          updated_at?: string
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          category?: string
          created_at?: string
          data_type?: string
          description?: string | null
          display_order?: number
          example_value?: string | null
          field_id?: string | null
          id?: string
          is_required?: boolean
          resolver_key?: string | null
          source_type?: string
          token_key?: string
          ui_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_token_registry_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          created_at: string
          entity_id: string
          event_type: string
          id: string
          payload: Json
          source: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          event_type: string
          id?: string
          payload?: Json
          source: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          event_type?: string
          id?: string
          payload?: Json
          source?: string
        }
        Relationships: []
      }
      domain_executions: {
        Row: {
          attempt: number
          created_at: string
          error: string | null
          event_id: string
          id: string
          status: string
          step: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          error?: string | null
          event_id: string
          id?: string
          status?: string
          step: string
        }
        Update: {
          attempt?: number
          created_at?: string
          error?: string | null
          event_id?: string
          id?: string
          status?: string
          step?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_executions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "domain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_cases: {
        Row: {
          created_at: string | null
          duplicate_type: string | null
          id: string
          master_profile_id: string | null
          notes: string | null
          phone: string
          profile_count: number | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          duplicate_type?: string | null
          id?: string
          master_profile_id?: string | null
          notes?: string | null
          phone: string
          profile_count?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          duplicate_type?: string | null
          id?: string
          master_profile_id?: string | null
          notes?: string | null
          phone?: string
          profile_count?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_cases_master_profile_id_fkey"
            columns: ["master_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_functions_registry: {
        Row: {
          auto_fix_policy: string
          category: string
          created_at: string | null
          enabled: boolean
          expected_status: number[]
          healthcheck_method: string
          must_exist: boolean
          name: string
          notes: string | null
          tier: string
          timeout_ms: number
          updated_at: string | null
        }
        Insert: {
          auto_fix_policy?: string
          category?: string
          created_at?: string | null
          enabled?: boolean
          expected_status?: number[]
          healthcheck_method?: string
          must_exist?: boolean
          name: string
          notes?: string | null
          tier?: string
          timeout_ms?: number
          updated_at?: string | null
        }
        Update: {
          auto_fix_policy?: string
          category?: string
          created_at?: string | null
          enabled?: boolean
          expected_status?: number[]
          healthcheck_method?: string
          must_exist?: boolean
          name?: string
          notes?: string | null
          tier?: string
          timeout_ms?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      eisenhower_tasks: {
        Row: {
          category_id: string | null
          completed: boolean
          content: string
          created_at: string
          deadline_date: string | null
          deadline_time: string | null
          id: string
          importance: number
          quadrant: string
          source: string | null
          source_task_id: string | null
          updated_at: string
          urgency: number
          user_id: string
        }
        Insert: {
          category_id?: string | null
          completed?: boolean
          content: string
          created_at?: string
          deadline_date?: string | null
          deadline_time?: string | null
          id?: string
          importance?: number
          quadrant: string
          source?: string | null
          source_task_id?: string | null
          updated_at?: string
          urgency?: number
          user_id: string
        }
        Update: {
          category_id?: string | null
          completed?: boolean
          content?: string
          created_at?: string
          deadline_date?: string | null
          deadline_time?: string | null
          id?: string
          importance?: number
          quadrant?: string
          source?: string | null
          source_task_id?: string | null
          updated_at?: string
          urgency?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eisenhower_tasks_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "task_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eisenhower_tasks_source_task_id_fkey"
            columns: ["source_task_id"]
            isOneToOne: false
            referencedRelation: "wheel_balance_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string
          from_email: string | null
          from_name: string | null
          id: string
          imap_enabled: boolean | null
          imap_encryption: string | null
          imap_host: string | null
          imap_port: number | null
          is_active: boolean | null
          is_default: boolean | null
          last_fetched_at: string | null
          last_fetched_uid: string | null
          provider: string
          reply_to: string | null
          smtp_encryption: string | null
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_username: string | null
          updated_at: string | null
          use_for: Json | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          imap_enabled?: boolean | null
          imap_encryption?: string | null
          imap_host?: string | null
          imap_port?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          last_fetched_at?: string | null
          last_fetched_uid?: string | null
          provider?: string
          reply_to?: string | null
          smtp_encryption?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          updated_at?: string | null
          use_for?: Json | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string
          from_email?: string | null
          from_name?: string | null
          id?: string
          imap_enabled?: boolean | null
          imap_encryption?: string | null
          imap_host?: string | null
          imap_port?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          last_fetched_at?: string | null
          last_fetched_uid?: string | null
          provider?: string
          reply_to?: string | null
          smtp_encryption?: string | null
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          updated_at?: string | null
          use_for?: Json | null
        }
        Relationships: []
      }
      email_inbox: {
        Row: {
          attachments: Json | null
          body_html: string | null
          body_text: string | null
          created_at: string | null
          email_account_id: string | null
          folder: string | null
          from_email: string
          from_name: string | null
          headers: Json | null
          id: string
          is_archived: boolean | null
          is_read: boolean | null
          is_starred: boolean | null
          linked_profile_id: string | null
          message_uid: string
          received_at: string | null
          subject: string | null
          thread_id: string | null
          to_email: string
          updated_at: string | null
        }
        Insert: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string | null
          email_account_id?: string | null
          folder?: string | null
          from_email: string
          from_name?: string | null
          headers?: Json | null
          id?: string
          is_archived?: boolean | null
          is_read?: boolean | null
          is_starred?: boolean | null
          linked_profile_id?: string | null
          message_uid: string
          received_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_email: string
          updated_at?: string | null
        }
        Update: {
          attachments?: Json | null
          body_html?: string | null
          body_text?: string | null
          created_at?: string | null
          email_account_id?: string | null
          folder?: string | null
          from_email?: string
          from_name?: string | null
          headers?: Json | null
          id?: string
          is_archived?: boolean | null
          is_read?: boolean | null
          is_starred?: boolean | null
          linked_profile_id?: string | null
          message_uid?: string
          received_at?: string | null
          subject?: string | null
          thread_id?: string | null
          to_email?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_inbox_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_inbox_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_inbox_linked_profile_id_fkey"
            columns: ["linked_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          body_html: string | null
          body_text: string | null
          clicked_at: string | null
          created_at: string
          direction: string
          error_message: string | null
          from_email: string
          id: string
          meta: Json | null
          opened_at: string | null
          profile_id: string | null
          provider: string | null
          provider_message_id: string | null
          status: string
          subject: string | null
          template_code: string | null
          to_email: string
          user_id: string | null
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          clicked_at?: string | null
          created_at?: string
          direction: string
          error_message?: string | null
          from_email: string
          id?: string
          meta?: Json | null
          opened_at?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          template_code?: string | null
          to_email: string
          user_id?: string | null
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          clicked_at?: string | null
          created_at?: string
          direction?: string
          error_message?: string | null
          from_email?: string
          id?: string
          meta?: Json | null
          opened_at?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          template_code?: string | null
          to_email?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          subject: string
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          body_html: string
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          subject: string
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          body_html?: string
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          subject?: string
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: []
      }
      email_threads: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          message_count: number | null
          profile_id: string | null
          subject: string | null
          thread_id: string
          unread_count: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          profile_id?: string | null
          subject?: string | null
          thread_id: string
          unread_count?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          profile_id?: string | null
          subject?: string | null
          thread_id?: string
          unread_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlement_orders: {
        Row: {
          created_at: string
          entitlement_id: string
          meta: Json
          order_id: string
          product_code: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entitlement_id: string
          meta?: Json
          order_id: string
          product_code: string
          user_id: string
        }
        Update: {
          created_at?: string
          entitlement_id?: string
          meta?: Json
          order_id?: string
          product_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlement_orders_entitlement_id_fkey"
            columns: ["entitlement_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          meta: Json | null
          order_id: string | null
          product_code: string
          product_id: string | null
          profile_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          meta?: Json | null
          order_id?: string | null
          product_code: string
          product_id?: string | null
          profile_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          meta?: Json | null
          order_id?: string | null
          product_code?: string
          product_id?: string | null
          profile_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_entitlements_order"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_entitlements_profile"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      entitlements_repair_backup_2026_05: {
        Row: {
          backup_id: string
          batch_id: string
          ent_id: string
          expected_min_end: string
          expires_at: string | null
          meta: Json | null
          product_id: string
          reason: string
          repair_bucket: string
          snapshot_at: string
          source_order_id: string
          source_payment_id: string
          status: string | null
          user_id: string
        }
        Insert: {
          backup_id?: string
          batch_id: string
          ent_id: string
          expected_min_end: string
          expires_at?: string | null
          meta?: Json | null
          product_id: string
          reason: string
          repair_bucket: string
          snapshot_at?: string
          source_order_id: string
          source_payment_id: string
          status?: string | null
          user_id: string
        }
        Update: {
          backup_id?: string
          batch_id?: string
          ent_id?: string
          expected_min_end?: string
          expires_at?: string | null
          meta?: Json | null
          product_id?: string
          reason?: string
          repair_bucket?: string
          snapshot_at?: string
          source_order_id?: string
          source_payment_id?: string
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      executors: {
        Row: {
          acts_on_basis: string | null
          bank_account: string
          bank_code: string
          bank_name: string
          created_at: string
          director_full_name: string | null
          director_position: string | null
          director_short_name: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          is_default: boolean
          legal_address: string
          legal_address_structured: Json | null
          phone: string | null
          short_name: string | null
          signature_url: string | null
          unp: string
          updated_at: string
        }
        Insert: {
          acts_on_basis?: string | null
          bank_account: string
          bank_code: string
          bank_name: string
          created_at?: string
          director_full_name?: string | null
          director_position?: string | null
          director_short_name?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          legal_address: string
          legal_address_structured?: Json | null
          phone?: string | null
          short_name?: string | null
          signature_url?: string | null
          unp: string
          updated_at?: string
        }
        Update: {
          acts_on_basis?: string | null
          bank_account?: string
          bank_code?: string
          bank_name?: string
          created_at?: string
          director_full_name?: string | null
          director_position?: string | null
          director_short_name?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          legal_address?: string
          legal_address_structured?: Json | null
          phone?: string | null
          short_name?: string | null
          signature_url?: string | null
          unp?: string
          updated_at?: string
        }
        Relationships: []
      }
      field_values: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["field_entity_type"]
          field_id: string
          id: string
          updated_at: string
          value_boolean: boolean | null
          value_date: string | null
          value_datetime: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: Database["public"]["Enums"]["field_entity_type"]
          field_id: string
          id?: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_datetime?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: Database["public"]["Enums"]["field_entity_type"]
          field_id?: string
          id?: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_datetime?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields"
            referencedColumns: ["id"]
          },
        ]
      }
      field_values_v2: {
        Row: {
          created_at: string | null
          entity_id: string
          field_id: string
          id: string
          updated_at: string | null
          value: Json | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          field_id: string
          id?: string
          updated_at?: string | null
          value?: Json | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          field_id?: string
          id?: string
          updated_at?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "field_values_v2_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "fields_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      fields: {
        Row: {
          created_at: string
          data_type: Database["public"]["Enums"]["field_data_type"]
          default_value: string | null
          description: string | null
          display_order: number | null
          entity_type: Database["public"]["Enums"]["field_entity_type"]
          enum_options: Json | null
          external_id_amo: string | null
          external_id_b24: string | null
          external_id_gc: string | null
          id: string
          is_active: boolean
          is_required: boolean
          is_system: boolean
          key: string
          label: string
          updated_at: string
          validation_rules: Json | null
        }
        Insert: {
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          default_value?: string | null
          description?: string | null
          display_order?: number | null
          entity_type: Database["public"]["Enums"]["field_entity_type"]
          enum_options?: Json | null
          external_id_amo?: string | null
          external_id_b24?: string | null
          external_id_gc?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          is_system?: boolean
          key: string
          label: string
          updated_at?: string
          validation_rules?: Json | null
        }
        Update: {
          created_at?: string
          data_type?: Database["public"]["Enums"]["field_data_type"]
          default_value?: string | null
          description?: string | null
          display_order?: number | null
          entity_type?: Database["public"]["Enums"]["field_entity_type"]
          enum_options?: Json | null
          external_id_amo?: string | null
          external_id_b24?: string | null
          external_id_gc?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          is_system?: boolean
          key?: string
          label?: string
          updated_at?: string
          validation_rules?: Json | null
        }
        Relationships: []
      }
      fields_registry: {
        Row: {
          archived_at: string | null
          created_at: string | null
          created_by: string | null
          data_type: string
          description: string | null
          display_order: number
          entity_type: string
          id: string
          key: string
          label: string
          options: Json | null
          public_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_type?: string
          description?: string | null
          display_order?: number
          entity_type: string
          id?: string
          key: string
          label: string
          options?: Json | null
          public_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string | null
          created_by?: string | null
          data_type?: string
          description?: string | null
          display_order?: number
          entity_type?: string
          id?: string
          key?: string
          label?: string
          options?: Json | null
          public_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      flows: {
        Row: {
          code: string
          created_at: string
          end_date: string | null
          id: string
          is_active: boolean
          is_default: boolean
          max_participants: number | null
          meta: Json | null
          name: string
          product_id: string
          start_date: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_participants?: number | null
          meta?: Json | null
          name: string
          product_id: string
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_participants?: number | null
          meta?: Json | null
          name?: string
          product_id?: string
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_documents: {
        Row: {
          client_details_id: string | null
          client_snapshot: Json
          contract_date: string | null
          contract_number: string | null
          contract_total_amount: number | null
          created_at: string
          currency: string | null
          document_date: string
          document_number: string
          document_type: string
          download_count: number | null
          error_message: string | null
          executor_id: string | null
          executor_snapshot: Json
          file_path: string | null
          file_size: number | null
          file_url: string | null
          generation_log: Json | null
          id: string
          installment_payment_id: string | null
          last_downloaded_at: string | null
          mismatch_warning: string | null
          order_id: string
          order_snapshot: Json
          paid_amount: number | null
          payer_type: string | null
          payer_type_mismatch: boolean | null
          profile_id: string
          rule_id: string | null
          sent_at: string | null
          sent_to_email: string | null
          sent_to_telegram: string | null
          service_period_from: string | null
          service_period_to: string | null
          status: string
          template_id: string | null
          trigger_type: string | null
          updated_at: string
        }
        Insert: {
          client_details_id?: string | null
          client_snapshot: Json
          contract_date?: string | null
          contract_number?: string | null
          contract_total_amount?: number | null
          created_at?: string
          currency?: string | null
          document_date?: string
          document_number: string
          document_type?: string
          download_count?: number | null
          error_message?: string | null
          executor_id?: string | null
          executor_snapshot: Json
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          generation_log?: Json | null
          id?: string
          installment_payment_id?: string | null
          last_downloaded_at?: string | null
          mismatch_warning?: string | null
          order_id: string
          order_snapshot: Json
          paid_amount?: number | null
          payer_type?: string | null
          payer_type_mismatch?: boolean | null
          profile_id: string
          rule_id?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          sent_to_telegram?: string | null
          service_period_from?: string | null
          service_period_to?: string | null
          status?: string
          template_id?: string | null
          trigger_type?: string | null
          updated_at?: string
        }
        Update: {
          client_details_id?: string | null
          client_snapshot?: Json
          contract_date?: string | null
          contract_number?: string | null
          contract_total_amount?: number | null
          created_at?: string
          currency?: string | null
          document_date?: string
          document_number?: string
          document_type?: string
          download_count?: number | null
          error_message?: string | null
          executor_id?: string | null
          executor_snapshot?: Json
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          generation_log?: Json | null
          id?: string
          installment_payment_id?: string | null
          last_downloaded_at?: string | null
          mismatch_warning?: string | null
          order_id?: string
          order_snapshot?: Json
          paid_amount?: number | null
          payer_type?: string | null
          payer_type_mismatch?: boolean | null
          profile_id?: string
          rule_id?: string | null
          sent_at?: string | null
          sent_to_email?: string | null
          sent_to_telegram?: string | null
          service_period_from?: string | null
          service_period_to?: string | null
          status?: string
          template_id?: string | null
          trigger_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_generated_documents_client_details"
            columns: ["client_details_id"]
            isOneToOne: false
            referencedRelation: "client_legal_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_generated_documents_executor"
            columns: ["executor_id"]
            isOneToOne: false
            referencedRelation: "executors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_installment_payment_id_fkey"
            columns: ["installment_payment_id"]
            isOneToOne: false
            referencedRelation: "installment_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "document_generation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      grace_notification_events: {
        Row: {
          channel: string
          event_type: string
          id: string
          meta: Json | null
          sent_at: string
          subscription_id: string
        }
        Insert: {
          channel?: string
          event_type: string
          id?: string
          meta?: Json | null
          sent_at?: string
          subscription_id: string
        }
        Update: {
          channel?: string
          event_type?: string
          id?: string
          meta?: Json | null
          sent_at?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grace_notification_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grace_notification_events_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_challenges: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          duration_days: number
          icon: string | null
          id: string
          is_active: boolean
          start_date: string
          target_value: number | null
          title: string
          unit_label: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          duration_days?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          target_value?: number | null
          title: string
          unit_label?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          duration_days?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          start_date?: string
          target_value?: number | null
          title?: string
          unit_label?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      habit_daily_logs: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          is_completed: boolean
          log_date: string
          notes: string | null
          user_id: string
          value: number | null
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          is_completed?: boolean
          log_date: string
          notes?: string | null
          user_id: string
          value?: number | null
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          is_completed?: boolean
          log_date?: string
          notes?: string | null
          user_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "habit_daily_logs_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "habit_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      ilex_documents: {
        Row: {
          content: string | null
          created_at: string | null
          doc_date: string | null
          doc_number: string | null
          doc_type: string | null
          extracted_articles: Json | null
          id: string
          ilex_id: string
          metadata: Json | null
          saved_by: string
          search_query: string | null
          source_url: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          doc_date?: string | null
          doc_number?: string | null
          doc_type?: string | null
          extracted_articles?: Json | null
          id?: string
          ilex_id: string
          metadata?: Json | null
          saved_by: string
          search_query?: string | null
          source_url?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          doc_date?: string | null
          doc_number?: string | null
          doc_type?: string | null
          extracted_articles?: Json | null
          id?: string
          ilex_id?: string
          metadata?: Json | null
          saved_by?: string
          search_query?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ilex_settings: {
        Row: {
          connection_status: string | null
          id: string
          last_connection_check: string | null
          session_cookie: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          connection_status?: string | null
          id?: string
          last_connection_check?: string | null
          session_cookie?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          connection_status?: string | null
          id?: string
          last_connection_check?: string | null
          session_cookie?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      impersonation_sessions: {
        Row: {
          actor_user_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          target_user_id: string
          token: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          target_user_id: string
          token: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          target_user_id?: string
          token?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          created_count: number | null
          error_log: Json | null
          errors_count: number | null
          id: string
          meta: Json | null
          processed: number | null
          started_at: string | null
          status: string | null
          total: number | null
          type: string
          updated_count: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          created_count?: number | null
          error_log?: Json | null
          errors_count?: number | null
          id?: string
          meta?: Json | null
          processed?: number | null
          started_at?: string | null
          status?: string | null
          total?: number | null
          type: string
          updated_count?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          created_count?: number | null
          error_log?: Json | null
          errors_count?: number | null
          id?: string
          meta?: Json | null
          processed?: number | null
          started_at?: string | null
          status?: string | null
          total?: number | null
          type?: string
          updated_count?: number | null
        }
        Relationships: []
      }
      import_mapping_rules: {
        Row: {
          additional_conditions: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          secondary_field_name: string | null
          secondary_field_value: string | null
          source_pattern: string
          target_tariff_id: string | null
          updated_at: string | null
        }
        Insert: {
          additional_conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          secondary_field_name?: string | null
          secondary_field_value?: string | null
          source_pattern: string
          target_tariff_id?: string | null
          updated_at?: string | null
        }
        Update: {
          additional_conditions?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          secondary_field_name?: string | null
          secondary_field_value?: string | null
          source_pattern?: string
          target_tariff_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_mapping_rules_target_tariff_id_fkey"
            columns: ["target_tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      individual_requisites: {
        Row: {
          created_at: string
          created_by: string
          data: Json
          id: string
          is_default: boolean
          owner_profile_id: string
          owner_user_id: string
          scope: string
          source_legacy_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          data?: Json
          id?: string
          is_default?: boolean
          owner_profile_id: string
          owner_user_id: string
          scope: string
          source_legacy_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          data?: Json
          id?: string
          is_default?: boolean
          owner_profile_id?: string
          owner_user_id?: string
          scope?: string
          source_legacy_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "individual_requisites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_accounts: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          instagram_page_id: string | null
          integration_instance_id: string
          is_active: boolean
          provider_kind: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          instagram_page_id?: string | null
          integration_instance_id: string
          is_active?: boolean
          provider_kind?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          instagram_page_id?: string | null
          integration_instance_id?: string
          is_active?: boolean
          provider_kind?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_integration_instance_id_fkey"
            columns: ["integration_instance_id"]
            isOneToOne: false
            referencedRelation: "integration_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_contacts: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          instagram_account_id: string
          instagram_user_id: string
          instagram_username: string | null
          profile_id: string | null
          provider_kind: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          instagram_account_id: string
          instagram_user_id: string
          instagram_username?: string | null
          profile_id?: string | null
          provider_kind?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          instagram_account_id?: string
          instagram_user_id?: string
          instagram_username?: string | null
          profile_id?: string | null
          provider_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_contacts_instagram_account_id_fkey"
            columns: ["instagram_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_contacts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_dialog_preferences: {
        Row: {
          admin_user_id: string
          created_at: string
          id: string
          instagram_account_id: string
          is_pinned: boolean
          pinned_at: string | null
          thread_key: string
          updated_at: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          id?: string
          instagram_account_id: string
          is_pinned?: boolean
          pinned_at?: string | null
          thread_key: string
          updated_at?: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          id?: string
          instagram_account_id?: string
          is_pinned?: boolean
          pinned_at?: string | null
          thread_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dialog_preferences_instagram_account_id_fkey"
            columns: ["instagram_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_messages: {
        Row: {
          created_at: string
          delivered_at: string | null
          direction: string
          error_message: string | null
          external_message_id: string | null
          id: string
          idempotency_hash: string | null
          ig_thread_id: string | null
          instagram_account_id: string
          is_read: boolean
          media_type: string | null
          media_url: string | null
          message_text: string | null
          peer_id: string
          provider_kind: string
          provider_message_id: string | null
          raw_payload: Json | null
          read_at: string | null
          recipient_id: string | null
          sender_id: string
          sender_name: string | null
          sending_at: string | null
          sending_lock_id: string | null
          sent_at: string | null
          sent_by_admin: string | null
          status: string
          thread_key: string | null
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          direction: string
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          idempotency_hash?: string | null
          ig_thread_id?: string | null
          instagram_account_id: string
          is_read?: boolean
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          peer_id: string
          provider_kind?: string
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_at?: string | null
          recipient_id?: string | null
          sender_id: string
          sender_name?: string | null
          sending_at?: string | null
          sending_lock_id?: string | null
          sent_at?: string | null
          sent_by_admin?: string | null
          status?: string
          thread_key?: string | null
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          external_message_id?: string | null
          id?: string
          idempotency_hash?: string | null
          ig_thread_id?: string | null
          instagram_account_id?: string
          is_read?: boolean
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
          peer_id?: string
          provider_kind?: string
          provider_message_id?: string | null
          raw_payload?: Json | null
          read_at?: string | null
          recipient_id?: string | null
          sender_id?: string
          sender_name?: string | null
          sending_at?: string | null
          sending_lock_id?: string | null
          sent_at?: string | null
          sent_by_admin?: string | null
          status?: string
          thread_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_messages_instagram_account_id_fkey"
            columns: ["instagram_account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_payments: {
        Row: {
          amount: number
          charge_attempts: number | null
          created_at: string | null
          currency: string
          due_date: string
          error_message: string | null
          id: string
          last_attempt_at: string | null
          meta: Json | null
          order_id: string
          paid_at: string | null
          payment_id: string | null
          payment_number: number
          payment_plan_id: string | null
          status: string
          subscription_id: string
          total_payments: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          charge_attempts?: number | null
          created_at?: string | null
          currency?: string
          due_date: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          meta?: Json | null
          order_id: string
          paid_at?: string | null
          payment_id?: string | null
          payment_number?: number
          payment_plan_id?: string | null
          status?: string
          subscription_id: string
          total_payments?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          charge_attempts?: number | null
          created_at?: string | null
          currency?: string
          due_date?: string
          error_message?: string | null
          id?: string
          last_attempt_at?: string | null
          meta?: Json | null
          order_id?: string
          paid_at?: string | null
          payment_id?: string | null
          payment_number?: number
          payment_plan_id?: string | null
          status?: string
          subscription_id?: string
          total_payments?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_payments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_payments_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_field_mappings: {
        Row: {
          created_at: string
          entity_type: string
          external_field: string
          field_type: string | null
          id: string
          instance_id: string
          is_key_field: boolean | null
          is_required: boolean | null
          project_field: string
          transform_rules: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          external_field: string
          field_type?: string | null
          id?: string
          instance_id: string
          is_key_field?: boolean | null
          is_required?: boolean | null
          project_field: string
          transform_rules?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          external_field?: string
          field_type?: string | null
          id?: string
          instance_id?: string
          is_key_field?: boolean | null
          is_required?: boolean | null
          project_field?: string
          transform_rules?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_field_mappings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "integration_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_instances: {
        Row: {
          alias: string
          category: string
          config: Json | null
          config_secrets: Json
          created_at: string
          error_message: string | null
          id: string
          is_default: boolean
          last_check_at: string | null
          last_successful_sync_at: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          alias: string
          category: string
          config?: Json | null
          config_secrets?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          is_default?: boolean
          last_check_at?: string | null
          last_successful_sync_at?: string | null
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          alias?: string
          category?: string
          config?: Json | null
          config_secrets?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          is_default?: boolean
          last_check_at?: string | null
          last_successful_sync_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_logs: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string
          id: string
          instance_id: string
          payload_meta: Json | null
          result: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type: string
          id?: string
          instance_id: string
          payload_meta?: Json | null
          result: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string
          id?: string
          instance_id?: string
          payload_meta?: Json | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "integration_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_logs: {
        Row: {
          created_at: string
          direction: string
          entity_type: string
          error_message: string | null
          id: string
          instance_id: string
          object_id: string | null
          object_type: string | null
          payload_meta: Json | null
          result: string
        }
        Insert: {
          created_at?: string
          direction: string
          entity_type: string
          error_message?: string | null
          id?: string
          instance_id: string
          object_id?: string | null
          object_type?: string | null
          payload_meta?: Json | null
          result: string
        }
        Update: {
          created_at?: string
          direction?: string
          entity_type?: string
          error_message?: string | null
          id?: string
          instance_id?: string
          object_id?: string | null
          object_type?: string | null
          payload_meta?: Json | null
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_logs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "integration_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_settings: {
        Row: {
          conflict_strategy: string | null
          created_at: string
          direction: string
          entity_type: string
          filters: Json | null
          id: string
          instance_id: string
          is_enabled: boolean
          last_sync_at: string | null
          updated_at: string
        }
        Insert: {
          conflict_strategy?: string | null
          created_at?: string
          direction?: string
          entity_type: string
          filters?: Json | null
          id?: string
          instance_id: string
          is_enabled?: boolean
          last_sync_at?: string | null
          updated_at?: string
        }
        Update: {
          conflict_strategy?: string | null
          created_at?: string
          direction?: string
          entity_type?: string
          filters?: Json | null
          id?: string
          instance_id?: string
          is_enabled?: boolean
          last_sync_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_settings_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "integration_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_questions: {
        Row: {
          answer_date: string
          created_at: string
          episode_number: number
          full_question: string | null
          id: string
          kinescope_url: string | null
          lesson_id: string
          question_number: number | null
          tags: string[] | null
          timecode_seconds: number | null
          title: string
          updated_at: string
        }
        Insert: {
          answer_date: string
          created_at?: string
          episode_number: number
          full_question?: string | null
          id?: string
          kinescope_url?: string | null
          lesson_id: string
          question_number?: number | null
          tags?: string[] | null
          timecode_seconds?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          answer_date?: string
          created_at?: string
          episode_number?: number
          full_question?: string | null
          id?: string
          kinescope_url?: string | null
          lesson_id?: string
          question_number?: number | null
          tags?: string[] | null
          timecode_seconds?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_questions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_details_entity_person_links: {
        Row: {
          acts_on_basis: string | null
          created_at: string
          custom_position_text: string | null
          custom_role_text: string | null
          end_date: string | null
          id: string
          is_primary: boolean
          legal_details_id: string
          notes: string | null
          person_id: string
          position_catalog_id: string | null
          profile_id: string
          role_catalog_id: string
          role_type: string
          share_percent: number | null
          start_date: string | null
          updated_at: string
        }
        Insert: {
          acts_on_basis?: string | null
          created_at?: string
          custom_position_text?: string | null
          custom_role_text?: string | null
          end_date?: string | null
          id?: string
          is_primary?: boolean
          legal_details_id: string
          notes?: string | null
          person_id: string
          position_catalog_id?: string | null
          profile_id: string
          role_catalog_id: string
          role_type: string
          share_percent?: number | null
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          acts_on_basis?: string | null
          created_at?: string
          custom_position_text?: string | null
          custom_role_text?: string | null
          end_date?: string | null
          id?: string
          is_primary?: boolean
          legal_details_id?: string
          notes?: string | null
          person_id?: string
          position_catalog_id?: string | null
          profile_id?: string
          role_catalog_id?: string
          role_type?: string
          share_percent?: number | null
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_details_entity_person_links_legal_details_id_fkey"
            columns: ["legal_details_id"]
            isOneToOne: false
            referencedRelation: "client_legal_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_details_entity_person_links_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "legal_details_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_details_entity_person_links_position_catalog_id_fkey"
            columns: ["position_catalog_id"]
            isOneToOne: false
            referencedRelation: "legal_details_positions_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_details_entity_person_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_details_entity_person_links_role_catalog_id_fkey"
            columns: ["role_catalog_id"]
            isOneToOne: false
            referencedRelation: "legal_details_roles_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_details_persons: {
        Row: {
          address_structured: Json | null
          bank_account: string | null
          bank_code: string | null
          bank_name: string | null
          birth_date: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          notes: string | null
          passport_issued_by: string | null
          passport_issued_date: string | null
          passport_number: string | null
          passport_number_full: string | null
          passport_series: string | null
          passport_valid_until: string | null
          personal_number: string | null
          phone: string | null
          profile_id: string
          updated_at: string
        }
        Insert: {
          address_structured?: Json | null
          bank_account?: string | null
          bank_code?: string | null
          bank_name?: string | null
          birth_date?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          notes?: string | null
          passport_issued_by?: string | null
          passport_issued_date?: string | null
          passport_number?: string | null
          passport_number_full?: string | null
          passport_series?: string | null
          passport_valid_until?: string | null
          personal_number?: string | null
          phone?: string | null
          profile_id: string
          updated_at?: string
        }
        Update: {
          address_structured?: Json | null
          bank_account?: string | null
          bank_code?: string | null
          bank_name?: string | null
          birth_date?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          passport_issued_by?: string | null
          passport_issued_date?: string | null
          passport_number?: string | null
          passport_number_full?: string | null
          passport_series?: string | null
          passport_valid_until?: string | null
          personal_number?: string | null
          phone?: string | null
          profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_details_persons_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_details_positions_catalog: {
        Row: {
          code: string
          country_scope: string | null
          id: string
          is_active: boolean
          is_system: boolean
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          country_scope?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          country_scope?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      legal_details_roles_catalog: {
        Row: {
          code: string
          id: string
          is_active: boolean
          label: string
          role_type: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          label: string
          role_type: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          label?: string
          role_type?: string
          sort_order?: number
        }
        Relationships: []
      }
      legal_entities_requisites: {
        Row: {
          created_at: string
          created_by: string
          data: Json
          id: string
          is_default: boolean
          owner_profile_id: string
          owner_user_id: string
          scope: string
          source_legacy_id: string | null
          subject_type: string
          tenant_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          created_at?: string
          created_by: string
          data?: Json
          id?: string
          is_default?: boolean
          owner_profile_id: string
          owner_user_id: string
          scope: string
          source_legacy_id?: string | null
          subject_type: string
          tenant_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          created_at?: string
          created_by?: string
          data?: Json
          id?: string
          is_default?: boolean
          owner_profile_id?: string
          owner_user_id?: string
          scope?: string
          source_legacy_id?: string | null
          subject_type?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_entities_requisites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_attachments: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          lesson_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          lesson_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          lesson_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_attachments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_blocks: {
        Row: {
          block_type: string
          content: Json
          created_at: string | null
          id: string
          lesson_id: string
          parent_id: string | null
          settings: Json | null
          sort_order: number | null
          updated_at: string | null
          visibility_rules: Json | null
        }
        Insert: {
          block_type: string
          content?: Json
          created_at?: string | null
          id?: string
          lesson_id: string
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
          visibility_rules?: Json | null
        }
        Update: {
          block_type?: string
          content?: Json
          created_at?: string | null
          id?: string
          lesson_id?: string
          parent_id?: string | null
          settings?: Json | null
          sort_order?: number | null
          updated_at?: string | null
          visibility_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_blocks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_blocks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "lesson_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_price_rules: {
        Row: {
          created_at: string | null
          id: string
          lesson_id: string
          price: number
          sort_order: number | null
          tariff_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lesson_id: string
          price: number
          sort_order?: number | null
          tariff_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lesson_id?: string
          price?: number
          sort_order?: number | null
          tariff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_price_rules_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_price_rules_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string
          id: string
          lesson_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string
          id?: string
          lesson_id: string
          user_id: string
        }
        Update: {
          completed_at?: string
          id?: string
          lesson_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "lesson_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "v_club_members_enriched"
            referencedColumns: ["auth_user_id"]
          },
        ]
      }
      lesson_progress_state: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          lesson_id: string
          state_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id: string
          state_json?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          lesson_id?: string
          state_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_state_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress_state_backup_byn_2026_05: {
        Row: {
          backed_up_at: string
          id: string
          lesson_id: string
          state_json_before: Json
          user_id: string
        }
        Insert: {
          backed_up_at?: string
          id: string
          lesson_id: string
          state_json_before: Json
          user_id: string
        }
        Update: {
          backed_up_at?: string
          id?: string
          lesson_id?: string
          state_json_before?: Json
          user_id?: string
        }
        Relationships: []
      }
      lesson_progress_state_backup_byn_x3_revert_2026_05_13: {
        Row: {
          backed_up_at: string
          id: string
          lesson_id: string
          state_json_before: Json
          user_id: string
        }
        Insert: {
          backed_up_at?: string
          id: string
          lesson_id: string
          state_json_before: Json
          user_id: string
        }
        Update: {
          backed_up_at?: string
          id?: string
          lesson_id?: string
          state_json_before?: Json
          user_id?: string
        }
        Relationships: []
      }
      live_access_links: {
        Row: {
          activated_at: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_opened_at: string | null
          last_opened_by_user_id: string | null
          live_event_id: string
          meta: Json | null
          opened_at: string | null
          revoked_at: string | null
          sent_at: string | null
          sent_via: string | null
          status: string
          token_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_opened_at?: string | null
          last_opened_by_user_id?: string | null
          live_event_id: string
          meta?: Json | null
          opened_at?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          token_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_opened_at?: string | null
          last_opened_by_user_id?: string | null
          live_event_id?: string
          meta?: Json | null
          opened_at?: string | null
          revoked_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_access_links_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_access_proofs: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          link_id: string | null
          live_event_id: string
          proof_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          link_id?: string | null
          live_event_id: string
          proof_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          link_id?: string | null
          live_event_id?: string
          proof_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_access_proofs_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "live_access_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_access_proofs_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_active_sessions: {
        Row: {
          client_instance_id: string | null
          created_at: string
          display_name: string | null
          expires_at: string
          id: string
          last_seen_at: string
          live_event_id: string
          nickname_color: string | null
          revoked_at: string | null
          session_key: string
          show_avatar: boolean
          user_id: string
        }
        Insert: {
          client_instance_id?: string | null
          created_at?: string
          display_name?: string | null
          expires_at: string
          id?: string
          last_seen_at?: string
          live_event_id: string
          nickname_color?: string | null
          revoked_at?: string | null
          session_key: string
          show_avatar?: boolean
          user_id: string
        }
        Update: {
          client_instance_id?: string | null
          created_at?: string
          display_name?: string | null
          expires_at?: string
          id?: string
          last_seen_at?: string
          live_event_id?: string
          nickname_color?: string | null
          revoked_at?: string | null
          session_key?: string
          show_avatar?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_active_sessions_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_access_rules: {
        Row: {
          conditions: Json
          created_at: string
          id: string
          live_event_id: string
          product_id: string
          sort_order: number
          tariff_id: string | null
        }
        Insert: {
          conditions?: Json
          created_at?: string
          id?: string
          live_event_id: string
          product_id: string
          sort_order?: number
          tariff_id?: string | null
        }
        Update: {
          conditions?: Json
          created_at?: string
          id?: string
          live_event_id?: string
          product_id?: string
          sort_order?: number
          tariff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_event_access_rules_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_access_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_access_rules_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_comments: {
        Row: {
          author_avatar_url: string | null
          author_display_name: string | null
          author_nickname_color: string | null
          author_role: string | null
          content: string
          created_at: string
          id: string
          live_event_id: string
          metadata: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_nickname_color?: string | null
          author_role?: string | null
          content: string
          created_at?: string
          id?: string
          live_event_id: string
          metadata?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_nickname_color?: string | null
          author_role?: string | null
          content?: string
          created_at?: string
          id?: string
          live_event_id?: string
          metadata?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_comments_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_cta_runtime_events: {
        Row: {
          binding_id: string
          created_at: string
          event_type: string
          id: string
          live_event_id: string
          metadata: Json | null
          shown_by: string | null
          trigger_mode: string
        }
        Insert: {
          binding_id: string
          created_at?: string
          event_type: string
          id?: string
          live_event_id: string
          metadata?: Json | null
          shown_by?: string | null
          trigger_mode?: string
        }
        Update: {
          binding_id?: string
          created_at?: string
          event_type?: string
          id?: string
          live_event_id?: string
          metadata?: Json | null
          shown_by?: string | null
          trigger_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_cta_runtime_events_binding_id_fkey"
            columns: ["binding_id"]
            isOneToOne: false
            referencedRelation: "live_event_product_cta_bindings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_cta_runtime_events_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_notification_log: {
        Row: {
          channel: string
          correction_of_log_id: string | null
          created_at: string
          dispatch_mode: string
          error: string | null
          id: string
          incident_batch_id: string | null
          live_event_id: string
          notify_offset_minutes: number
          provider_message_id: string | null
          provider_response: Json | null
          rendered_button_text: string | null
          rendered_button_url: string | null
          rendered_subject: string | null
          rendered_text: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          template_id: string | null
          user_id: string
        }
        Insert: {
          channel: string
          correction_of_log_id?: string | null
          created_at?: string
          dispatch_mode?: string
          error?: string | null
          id?: string
          incident_batch_id?: string | null
          live_event_id: string
          notify_offset_minutes: number
          provider_message_id?: string | null
          provider_response?: Json | null
          rendered_button_text?: string | null
          rendered_button_url?: string | null
          rendered_subject?: string | null
          rendered_text?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          template_id?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          correction_of_log_id?: string | null
          created_at?: string
          dispatch_mode?: string
          error?: string | null
          id?: string
          incident_batch_id?: string | null
          live_event_id?: string
          notify_offset_minutes?: number
          provider_message_id?: string | null
          provider_response?: Json | null
          rendered_button_text?: string | null
          rendered_button_url?: string | null
          rendered_subject?: string | null
          rendered_text?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_notification_log_correction_of_log_id_fkey"
            columns: ["correction_of_log_id"]
            isOneToOne: false
            referencedRelation: "live_event_notification_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_notification_log_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_notification_log_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "broadcast_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_participant_prefs: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          live_event_id: string
          nickname_color: string | null
          show_avatar: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          live_event_id: string
          nickname_color?: string | null
          show_avatar?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          live_event_id?: string
          nickname_color?: string | null
          show_avatar?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_participant_prefs_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_product_cta_bindings: {
        Row: {
          button_text_override: string | null
          created_at: string
          created_by: string
          cta_type: string
          description_override: string | null
          display_mode: string
          id: string
          image_override: string | null
          is_active: boolean
          live_event_id: string
          metadata: Json | null
          offer_id: string | null
          position: string
          product_id: string
          public_id: string
          show_after_minutes: number | null
          show_at: string | null
          sort_order: number
          tariff_id: string | null
          theme_override: Json | null
          title_override: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          button_text_override?: string | null
          created_at?: string
          created_by: string
          cta_type: string
          description_override?: string | null
          display_mode?: string
          id?: string
          image_override?: string | null
          is_active?: boolean
          live_event_id: string
          metadata?: Json | null
          offer_id?: string | null
          position?: string
          product_id: string
          public_id?: string
          show_after_minutes?: number | null
          show_at?: string | null
          sort_order?: number
          tariff_id?: string | null
          theme_override?: Json | null
          title_override?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          button_text_override?: string | null
          created_at?: string
          created_by?: string
          cta_type?: string
          description_override?: string | null
          display_mode?: string
          id?: string
          image_override?: string | null
          is_active?: boolean
          live_event_id?: string
          metadata?: Json | null
          offer_id?: string | null
          position?: string
          product_id?: string
          public_id?: string
          show_after_minutes?: number | null
          show_at?: string | null
          sort_order?: number
          tariff_id?: string | null
          theme_override?: Json | null
          title_override?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_event_product_cta_bindings_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_product_cta_bindings_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_product_cta_bindings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_product_cta_bindings_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_questions: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          author_avatar_url: string | null
          author_display_name: string | null
          author_nickname_color: string | null
          author_role: string | null
          content: string
          created_at: string
          id: string
          is_answered: boolean
          live_event_id: string
          metadata: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_nickname_color?: string | null
          author_role?: string | null
          content: string
          created_at?: string
          id?: string
          is_answered?: boolean
          live_event_id: string
          metadata?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          author_avatar_url?: string | null
          author_display_name?: string | null
          author_nickname_color?: string | null
          author_role?: string | null
          content?: string
          created_at?: string
          id?: string
          is_answered?: boolean
          live_event_id?: string
          metadata?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_questions_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          live_event_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          live_event_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          live_event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_reactions_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_replies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          live_event_id: string
          metadata: Json | null
          public_id: string
          reply_text: string
          source_comment_id: string | null
          source_question_id: string | null
          target_display_name: string | null
          target_user_id: string | null
          updated_at: string | null
          visibility_scope: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          live_event_id: string
          metadata?: Json | null
          public_id?: string
          reply_text: string
          source_comment_id?: string | null
          source_question_id?: string | null
          target_display_name?: string | null
          target_user_id?: string | null
          updated_at?: string | null
          visibility_scope: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          live_event_id?: string
          metadata?: Json | null
          public_id?: string
          reply_text?: string
          source_comment_id?: string | null
          source_question_id?: string | null
          target_display_name?: string | null
          target_user_id?: string | null
          updated_at?: string | null
          visibility_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_replies_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_replies_source_comment_id_fkey"
            columns: ["source_comment_id"]
            isOneToOne: false
            referencedRelation: "live_event_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_event_replies_source_question_id_fkey"
            columns: ["source_question_id"]
            isOneToOne: false
            referencedRelation: "live_event_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_room_blocks: {
        Row: {
          block_type: string
          config: Json
          created_at: string
          created_by: string
          display_scope: string
          id: string
          is_active: boolean
          live_event_id: string
          metadata: Json | null
          position: string
          public_id: string
          sort_order: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          block_type: string
          config?: Json
          created_at?: string
          created_by: string
          display_scope: string
          id?: string
          is_active?: boolean
          live_event_id: string
          metadata?: Json | null
          position: string
          public_id?: string
          sort_order?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          block_type?: string
          config?: Json
          created_at?: string
          created_by?: string
          display_scope?: string
          id?: string
          is_active?: boolean
          live_event_id?: string
          metadata?: Json | null
          position?: string
          public_id?: string
          sort_order?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_event_room_blocks_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_room_moderation: {
        Row: {
          action_type: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          live_event_id: string
          metadata: Json | null
          public_id: string
          reason: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          live_event_id: string
          metadata?: Json | null
          public_id?: string
          reason?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          live_event_id?: string
          metadata?: Json | null
          public_id?: string
          reason?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_room_moderation_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_session_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          cta_clicks: Json
          first_joined_at: string | null
          id: string
          last_seen_at: string | null
          last_video_position_seconds: number
          max_watched_seconds: number
          metadata: Json
          poll_answers: Json
          session_id: string
          updated_at: string
          viewer_proof_id: string | null
          viewer_user_id: string | null
          watch_percent: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          cta_clicks?: Json
          first_joined_at?: string | null
          id?: string
          last_seen_at?: string | null
          last_video_position_seconds?: number
          max_watched_seconds?: number
          metadata?: Json
          poll_answers?: Json
          session_id: string
          updated_at?: string
          viewer_proof_id?: string | null
          viewer_user_id?: string | null
          watch_percent?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          cta_clicks?: Json
          first_joined_at?: string | null
          id?: string
          last_seen_at?: string | null
          last_video_position_seconds?: number
          max_watched_seconds?: number
          metadata?: Json
          poll_answers?: Json
          session_id?: string
          updated_at?: string
          viewer_proof_id?: string | null
          viewer_user_id?: string | null
          watch_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "live_event_session_progress_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_event_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_sessions: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          live_event_id: string
          metadata: Json
          mode: string
          starts_at: string
          status: string
          updated_at: string
          viewer_proof_id: string | null
          viewer_user_id: string | null
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          live_event_id: string
          metadata?: Json
          mode: string
          starts_at: string
          status?: string
          updated_at?: string
          viewer_proof_id?: string | null
          viewer_user_id?: string | null
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          live_event_id?: string
          metadata?: Json
          mode?: string
          starts_at?: string
          status?: string
          updated_at?: string
          viewer_proof_id?: string | null
          viewer_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_event_sessions_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_event_timeline_events: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          kind: string
          live_event_id: string
          offset_seconds: number
          payload: Json
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind: string
          live_event_id: string
          offset_seconds: number
          payload?: Json
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          live_event_id?: string
          offset_seconds?: number
          payload?: Json
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_event_timeline_events_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      live_events: {
        Row: {
          access_rule: Json
          autoweb_config: Json
          autoweb_mode: string | null
          created_at: string
          description: string | null
          direct_access_allowed: boolean
          event_timezone: string
          event_type: string
          id: string
          invite_mode: string
          is_published: boolean
          kinescope_instance_id: string | null
          kinescope_live_event_id: string | null
          kinescope_project_id: string | null
          kinescope_stream_id: string | null
          kinescope_video_id: string | null
          live_started_at: string | null
          metadata: Json | null
          platform_status: string
          product_id: string | null
          replay_enabled: boolean
          room_opened_at: string | null
          room_state: string
          scheduled_at: string | null
          slug: string
          source_kind: string
          status: string
          title: string
          updated_at: string
          webinar_completed_at: string | null
        }
        Insert: {
          access_rule?: Json
          autoweb_config?: Json
          autoweb_mode?: string | null
          created_at?: string
          description?: string | null
          direct_access_allowed?: boolean
          event_timezone?: string
          event_type?: string
          id?: string
          invite_mode?: string
          is_published?: boolean
          kinescope_instance_id?: string | null
          kinescope_live_event_id?: string | null
          kinescope_project_id?: string | null
          kinescope_stream_id?: string | null
          kinescope_video_id?: string | null
          live_started_at?: string | null
          metadata?: Json | null
          platform_status?: string
          product_id?: string | null
          replay_enabled?: boolean
          room_opened_at?: string | null
          room_state?: string
          scheduled_at?: string | null
          slug: string
          source_kind?: string
          status?: string
          title: string
          updated_at?: string
          webinar_completed_at?: string | null
        }
        Update: {
          access_rule?: Json
          autoweb_config?: Json
          autoweb_mode?: string | null
          created_at?: string
          description?: string | null
          direct_access_allowed?: boolean
          event_timezone?: string
          event_type?: string
          id?: string
          invite_mode?: string
          is_published?: boolean
          kinescope_instance_id?: string | null
          kinescope_live_event_id?: string | null
          kinescope_project_id?: string | null
          kinescope_stream_id?: string | null
          kinescope_video_id?: string | null
          live_started_at?: string | null
          metadata?: Json | null
          platform_status?: string
          product_id?: string | null
          replay_enabled?: boolean
          room_opened_at?: string | null
          room_state?: string
          scheduled_at?: string | null
          slug?: string
          source_kind?: string
          status?: string
          title?: string
          updated_at?: string
          webinar_completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      live_notification_config: {
        Row: {
          enabled: boolean
          id: number
          production_approved: boolean
          proof_mode: boolean
          test_allowlist: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: number
          production_approved?: boolean
          proof_mode?: boolean
          test_allowlist?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: number
          production_approved?: boolean
          proof_mode?: boolean
          test_allowlist?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      manychat_diagnose_log: {
        Row: {
          content_type: string | null
          headers: Json
          http_method: string | null
          id: string
          metadata: Json
          notes: string | null
          parsed_body: Json | null
          raw_body: string | null
          received_at: string
          signature_header_candidates: Json | null
          source_ip: string | null
        }
        Insert: {
          content_type?: string | null
          headers?: Json
          http_method?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          parsed_body?: Json | null
          raw_body?: string | null
          received_at?: string
          signature_header_candidates?: Json | null
          source_ip?: string | null
        }
        Update: {
          content_type?: string | null
          headers?: Json
          http_method?: string | null
          id?: string
          metadata?: Json
          notes?: string | null
          parsed_body?: Json | null
          raw_body?: string | null
          received_at?: string
          signature_header_candidates?: Json | null
          source_ip?: string | null
        }
        Relationships: []
      }
      marketing_insights: {
        Row: {
          content: string
          created_at: string
          extracted_by: string | null
          id: string
          insight_type: string
          is_actionable: boolean | null
          is_processed: boolean | null
          keywords: string[] | null
          processed_at: string | null
          profile_id: string | null
          related_news_id: string | null
          related_product_id: string | null
          sentiment_score: number | null
          source_chat_id: string | null
          source_message_id: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          extracted_by?: string | null
          id?: string
          insight_type: string
          is_actionable?: boolean | null
          is_processed?: boolean | null
          keywords?: string[] | null
          processed_at?: string | null
          profile_id?: string | null
          related_news_id?: string | null
          related_product_id?: string | null
          sentiment_score?: number | null
          source_chat_id?: string | null
          source_message_id?: string | null
          source_type?: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          extracted_by?: string | null
          id?: string
          insight_type?: string
          is_actionable?: boolean | null
          is_processed?: boolean | null
          keywords?: string[] | null
          processed_at?: string | null
          profile_id?: string | null
          related_news_id?: string | null
          related_product_id?: string | null
          sentiment_score?: number | null
          source_chat_id?: string | null
          source_message_id?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_insights_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_insights_related_news_id_fkey"
            columns: ["related_news_id"]
            isOneToOne: false
            referencedRelation: "news_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_insights_related_product_id_fkey"
            columns: ["related_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      media_jobs: {
        Row: {
          attempts: number
          bot_id: string
          created_at: string
          file_name: string | null
          file_type: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          message_db_id: string
          status: string
          telegram_file_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          bot_id: string
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          message_db_id: string
          status?: string
          telegram_file_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          bot_id?: string
          created_at?: string
          file_name?: string | null
          file_type?: string | null
          id?: string
          last_error?: string | null
          locked_at?: string | null
          message_db_id?: string
          status?: string
          telegram_file_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_jobs_message_db_id_fkey"
            columns: ["message_db_id"]
            isOneToOne: false
            referencedRelation: "telegram_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      merge_history: {
        Row: {
          case_id: string | null
          created_at: string | null
          id: string
          master_profile_id: string | null
          merged_by: string | null
          merged_data: Json | null
          merged_profile_id: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string | null
          id?: string
          master_profile_id?: string | null
          merged_by?: string | null
          merged_data?: Json | null
          merged_profile_id?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string | null
          id?: string
          master_profile_id?: string | null
          merged_by?: string | null
          merged_data?: Json | null
          merged_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merge_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "duplicate_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_history_master_profile_id_fkey"
            columns: ["master_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merge_history_merged_profile_id_fkey"
            columns: ["merged_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mns_response_documents: {
        Row: {
          created_at: string
          id: string
          organization_name: string | null
          original_request: string
          request_date: string | null
          request_number: string | null
          request_type: string
          response_text: string
          tax_authority: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_name?: string | null
          original_request: string
          request_date?: string | null
          request_number?: string | null
          request_type?: string
          response_text: string
          tax_authority?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_name?: string | null
          original_request?: string
          request_date?: string | null
          request_number?: string | null
          request_type?: string
          response_text?: string
          tax_authority?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      module_access: {
        Row: {
          created_at: string
          id: string
          module_id: string
          tariff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          module_id: string
          tariff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          module_id?: string
          tariff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_access_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_access_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      news_content: {
        Row: {
          ai_persona: string | null
          ai_summary: string | null
          audience_mood: string | null
          category: string
          content: string | null
          country: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          is_published: boolean
          is_resonant: boolean | null
          keywords: string[] | null
          linked_insight_id: string | null
          news_priority: string | null
          raw_content: string | null
          resonance_topics: string[] | null
          scraped_at: string | null
          source: string
          source_id: string | null
          source_url: string | null
          summary: string | null
          telegram_channel_id: string | null
          telegram_message_id: number | null
          telegram_sent_at: string | null
          telegram_status: string | null
          title: string
          updated_at: string
        }
        Insert: {
          ai_persona?: string | null
          ai_summary?: string | null
          audience_mood?: string | null
          category: string
          content?: string | null
          country: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          is_published?: boolean
          is_resonant?: boolean | null
          keywords?: string[] | null
          linked_insight_id?: string | null
          news_priority?: string | null
          raw_content?: string | null
          resonance_topics?: string[] | null
          scraped_at?: string | null
          source: string
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          telegram_channel_id?: string | null
          telegram_message_id?: number | null
          telegram_sent_at?: string | null
          telegram_status?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          ai_persona?: string | null
          ai_summary?: string | null
          audience_mood?: string | null
          category?: string
          content?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          is_published?: boolean
          is_resonant?: boolean | null
          keywords?: string[] | null
          linked_insight_id?: string | null
          news_priority?: string | null
          raw_content?: string | null
          resonance_topics?: string[] | null
          scraped_at?: string | null
          source?: string
          source_id?: string | null
          source_url?: string | null
          summary?: string | null
          telegram_channel_id?: string | null
          telegram_message_id?: number | null
          telegram_sent_at?: string | null
          telegram_status?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "news_content_linked_insight_id_fkey"
            columns: ["linked_insight_id"]
            isOneToOne: false
            referencedRelation: "marketing_insights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_content_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "news_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_content_telegram_channel_id_fkey"
            columns: ["telegram_channel_id"]
            isOneToOne: false
            referencedRelation: "telegram_publish_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      news_digest_queue: {
        Row: {
          channel_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          news_id: string | null
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          telegram_message_id: number | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          news_id?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_message_id?: number | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          news_id?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          telegram_message_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "news_digest_queue_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "telegram_publish_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "news_digest_queue_news_id_fkey"
            columns: ["news_id"]
            isOneToOne: false
            referencedRelation: "news_content"
            referencedColumns: ["id"]
          },
        ]
      }
      news_sources: {
        Row: {
          category: string
          country: string
          created_at: string | null
          id: string
          is_active: boolean | null
          last_error: string | null
          last_error_code: string | null
          last_error_details: Json | null
          last_scraped_at: string | null
          name: string
          priority: number | null
          scrape_config: Json | null
          scrape_selector: string | null
          updated_at: string | null
          url: string
        }
        Insert: {
          category: string
          country: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_error_code?: string | null
          last_error_details?: Json | null
          last_scraped_at?: string | null
          name: string
          priority?: number | null
          scrape_config?: Json | null
          scrape_selector?: string | null
          updated_at?: string | null
          url: string
        }
        Update: {
          category?: string
          country?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_error_code?: string | null
          last_error_details?: Json | null
          last_scraped_at?: string | null
          name?: string
          priority?: number | null
          scrape_config?: Json | null
          scrape_selector?: string | null
          updated_at?: string | null
          url?: string
        }
        Relationships: []
      }
      notification_outbox: {
        Row: {
          attempt_count: number | null
          blocked_reason: string | null
          channel: string
          created_at: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          message_type: string
          meta: Json | null
          sent_at: string | null
          source: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempt_count?: number | null
          blocked_reason?: string | null
          channel?: string
          created_at?: string
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          message_type: string
          meta?: Json | null
          sent_at?: string | null
          source?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempt_count?: number | null
          blocked_reason?: string | null
          channel?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          message_type?: string
          meta?: Json | null
          sent_at?: string | null
          source?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount: number
          bepaid_token: string | null
          bepaid_uid: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_ip: string | null
          duplicate_reason: string | null
          error_message: string | null
          id: string
          meta: Json | null
          payment_method: string | null
          possible_duplicate: boolean | null
          product_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          bepaid_token?: string | null
          bepaid_uid?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          duplicate_reason?: string | null
          error_message?: string | null
          id?: string
          meta?: Json | null
          payment_method?: string | null
          possible_duplicate?: boolean | null
          product_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          bepaid_token?: string | null
          bepaid_uid?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          duplicate_reason?: string | null
          error_message?: string | null
          id?: string
          meta?: Json | null
          payment_method?: string | null
          possible_duplicate?: boolean | null
          product_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders_v2: {
        Row: {
          base_price: number
          bepaid_subscription_id: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_ip: string | null
          customer_phone: string | null
          deal_date: string | null
          discount_percent: number | null
          final_price: number
          flow_id: string | null
          gc_next_retry_at: string | null
          id: string
          invoice_email: string | null
          invoice_sent_at: string | null
          is_trial: boolean
          meta: Json | null
          offer_id: string | null
          order_number: string
          paid_amount: number | null
          payer_type: string | null
          payment_plan_id: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          pricing_stage_id: string | null
          product_id: string | null
          profile_id: string | null
          provider: string | null
          provider_payment_id: string | null
          purchase_snapshot: Json | null
          reconcile_source: string | null
          status: Database["public"]["Enums"]["order_status"]
          tariff_id: string | null
          trial_end_at: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          base_price: number
          bepaid_subscription_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price: number
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean
          meta?: Json | null
          offer_id?: string | null
          order_number: string
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          base_price?: number
          bepaid_subscription_id?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price?: number
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean
          meta?: Json | null
          offer_id?: string | null
          order_number?: string
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_v2_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_payment_plan_id_fkey"
            columns: ["payment_plan_id"]
            isOneToOne: false
            referencedRelation: "payment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_pricing_stage_id_fkey"
            columns: ["pricing_stage_id"]
            isOneToOne: false
            referencedRelation: "pricing_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_v2_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          current_uses: number
          description: string | null
          expires_at: string | null
          id: string
          max_uses: number | null
          meta: Json
          offer_id: string | null
          payment_type: string
          product_id: string
          public_url: string
          status: string
          tariff_id: string
          updated_at: string
          url_token: string
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          current_uses?: number
          description?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          meta?: Json
          offer_id?: string | null
          payment_type?: string
          product_id: string
          public_url: string
          status?: string
          tariff_id: string
          updated_at?: string
          url_token?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          current_uses?: number
          description?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          meta?: Json
          offer_id?: string | null
          payment_type?: string
          product_id?: string
          public_url?: string
          status?: string
          tariff_id?: string
          updated_at?: string
          url_token?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_method_verification_jobs: {
        Row: {
          attempt_count: number
          charge_tx_uid: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string | null
          payment_method_id: string
          refund_tx_uid: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          charge_tx_uid?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payment_method_id: string
          refund_tx_uid?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          charge_tx_uid?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payment_method_id?: string
          refund_tx_uid?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_verification_jobs_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          brand: string | null
          card_category: string | null
          card_product: string | null
          created_at: string
          exp_month: number | null
          exp_year: number | null
          id: string
          is_default: boolean
          last4: string | null
          meta: Json | null
          provider: string
          provider_token: string
          recurring_verified: boolean | null
          status: string
          supports_recurring: boolean | null
          updated_at: string
          user_id: string
          verification_checked_at: string | null
          verification_error: string | null
          verification_status: string | null
          verification_tx_uid: string | null
        }
        Insert: {
          brand?: string | null
          card_category?: string | null
          card_product?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          id?: string
          is_default?: boolean
          last4?: string | null
          meta?: Json | null
          provider?: string
          provider_token: string
          recurring_verified?: boolean | null
          status?: string
          supports_recurring?: boolean | null
          updated_at?: string
          user_id: string
          verification_checked_at?: string | null
          verification_error?: string | null
          verification_status?: string | null
          verification_tx_uid?: string | null
        }
        Update: {
          brand?: string | null
          card_category?: string | null
          card_product?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          id?: string
          is_default?: boolean
          last4?: string | null
          meta?: Json | null
          provider?: string
          provider_token?: string
          recurring_verified?: boolean | null
          status?: string
          supports_recurring?: boolean | null
          updated_at?: string
          user_id?: string
          verification_checked_at?: string | null
          verification_error?: string | null
          verification_status?: string | null
          verification_tx_uid?: string | null
        }
        Relationships: []
      }
      payment_plans: {
        Row: {
          created_at: string
          display_order: number | null
          first_payment_percent: number | null
          grants_access_immediately: boolean
          id: string
          installments_count: number | null
          is_active: boolean
          name: string
          plan_type: Database["public"]["Enums"]["payment_plan_type"]
          tariff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          first_payment_percent?: number | null
          grants_access_immediately?: boolean
          id?: string
          installments_count?: number | null
          is_active?: boolean
          name: string
          plan_type: Database["public"]["Enums"]["payment_plan_type"]
          tariff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          first_payment_percent?: number | null
          grants_access_immediately?: boolean
          id?: string
          installments_count?: number | null
          is_active?: boolean
          name?: string
          plan_type?: Database["public"]["Enums"]["payment_plan_type"]
          tariff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_plans_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconcile_queue: {
        Row: {
          amount: number | null
          attempts: number | null
          auth_code: string | null
          avs_result: string | null
          bank_code: string | null
          bepaid_order_id: string | null
          bepaid_uid: string | null
          business_category: string | null
          card_bank: string | null
          card_bank_country: string | null
          card_bin: string | null
          card_brand: string | null
          card_holder: string | null
          card_last4: string | null
          card_valid_until: string | null
          client_accept_language: string | null
          client_geo_country: string | null
          client_user_agent: string | null
          created_at: string | null
          created_at_bepaid: string | null
          currency: string | null
          customer_address: string | null
          customer_city: string | null
          customer_country: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_state: string | null
          customer_surname: string | null
          customer_zip: string | null
          description: string | null
          error_category: string | null
          fee_amount: number | null
          fee_percent: number | null
          fraud_result: string | null
          has_conflict: boolean | null
          id: string
          ip_address: string | null
          ip_hash: string | null
          is_external: boolean | null
          is_fee: boolean | null
          last_attempt_at: string | null
          last_error: string | null
          linked_at: string | null
          matched_offer_id: string | null
          matched_order_id: string | null
          matched_product_id: string | null
          matched_profile_id: string | null
          matched_tariff_id: string | null
          max_attempts: number | null
          message: string | null
          next_retry_at: string | null
          paid_at: string | null
          payment_method: string | null
          processed_at: string | null
          processed_order_id: string | null
          product_code: string | null
          product_name: string | null
          provider: string | null
          raw_payload: Json | null
          reason: string | null
          receipt_url: string | null
          reference_transaction_uid: string | null
          rrn: string | null
          shop_id: string | null
          shop_name: string | null
          source: string | null
          status: string | null
          status_normalized: string | null
          tariff_name: string | null
          three_d_secure: boolean | null
          total_fee: number | null
          tracking_id: string | null
          transaction_type: string | null
          transferred_amount: number | null
          transferred_at: string | null
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          amount?: number | null
          attempts?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bepaid_order_id?: string | null
          bepaid_uid?: string | null
          business_category?: string | null
          card_bank?: string | null
          card_bank_country?: string | null
          card_bin?: string | null
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          card_valid_until?: string | null
          client_accept_language?: string | null
          client_geo_country?: string | null
          client_user_agent?: string | null
          created_at?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_country?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_surname?: string | null
          customer_zip?: string | null
          description?: string | null
          error_category?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
          last_attempt_at?: string | null
          last_error?: string | null
          linked_at?: string | null
          matched_offer_id?: string | null
          matched_order_id?: string | null
          matched_product_id?: string | null
          matched_profile_id?: string | null
          matched_tariff_id?: string | null
          max_attempts?: number | null
          message?: string | null
          next_retry_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_order_id?: string | null
          product_code?: string | null
          product_name?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reason?: string | null
          receipt_url?: string | null
          reference_transaction_uid?: string | null
          rrn?: string | null
          shop_id?: string | null
          shop_name?: string | null
          source?: string | null
          status?: string | null
          status_normalized?: string | null
          tariff_name?: string | null
          three_d_secure?: boolean | null
          total_fee?: number | null
          tracking_id?: string | null
          transaction_type?: string | null
          transferred_amount?: number | null
          transferred_at?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          amount?: number | null
          attempts?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bepaid_order_id?: string | null
          bepaid_uid?: string | null
          business_category?: string | null
          card_bank?: string | null
          card_bank_country?: string | null
          card_bin?: string | null
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          card_valid_until?: string | null
          client_accept_language?: string | null
          client_geo_country?: string | null
          client_user_agent?: string | null
          created_at?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_country?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_surname?: string | null
          customer_zip?: string | null
          description?: string | null
          error_category?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
          last_attempt_at?: string | null
          last_error?: string | null
          linked_at?: string | null
          matched_offer_id?: string | null
          matched_order_id?: string | null
          matched_product_id?: string | null
          matched_profile_id?: string | null
          matched_tariff_id?: string | null
          max_attempts?: number | null
          message?: string | null
          next_retry_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_order_id?: string | null
          product_code?: string | null
          product_name?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reason?: string | null
          receipt_url?: string | null
          reference_transaction_uid?: string | null
          rrn?: string | null
          shop_id?: string | null
          shop_name?: string | null
          source?: string | null
          status?: string | null
          status_normalized?: string | null
          tariff_name?: string | null
          three_d_secure?: boolean | null
          total_fee?: number | null
          tracking_id?: string | null
          transaction_type?: string | null
          transferred_amount?: number | null
          transferred_at?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconcile_queue_matched_offer_id_fkey"
            columns: ["matched_offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconcile_queue_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconcile_queue_matched_product_id_fkey"
            columns: ["matched_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconcile_queue_matched_profile_id_fkey"
            columns: ["matched_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconcile_queue_matched_tariff_id_fkey"
            columns: ["matched_tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconcile_queue_processed_order_id_fkey"
            columns: ["processed_order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reconcile_queue_archive: {
        Row: {
          amount: number | null
          attempts: number | null
          auth_code: string | null
          avs_result: string | null
          bank_code: string | null
          bepaid_order_id: string | null
          bepaid_uid: string | null
          business_category: string | null
          card_bank: string | null
          card_bank_country: string | null
          card_bin: string | null
          card_brand: string | null
          card_holder: string | null
          card_last4: string | null
          card_valid_until: string | null
          client_accept_language: string | null
          client_geo_country: string | null
          client_user_agent: string | null
          created_at: string | null
          created_at_bepaid: string | null
          currency: string | null
          customer_address: string | null
          customer_city: string | null
          customer_country: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          customer_state: string | null
          customer_surname: string | null
          customer_zip: string | null
          description: string | null
          error_category: string | null
          fee_amount: number | null
          fee_percent: number | null
          fraud_result: string | null
          has_conflict: boolean | null
          id: string
          ip_address: string | null
          ip_hash: string | null
          is_external: boolean | null
          is_fee: boolean | null
          last_attempt_at: string | null
          last_error: string | null
          linked_at: string | null
          matched_offer_id: string | null
          matched_order_id: string | null
          matched_product_id: string | null
          matched_profile_id: string | null
          matched_tariff_id: string | null
          max_attempts: number | null
          message: string | null
          next_retry_at: string | null
          paid_at: string | null
          payment_method: string | null
          processed_at: string | null
          processed_order_id: string | null
          product_code: string | null
          product_name: string | null
          provider: string | null
          raw_payload: Json | null
          reason: string | null
          receipt_url: string | null
          reference_transaction_uid: string | null
          rrn: string | null
          shop_id: string | null
          shop_name: string | null
          source: string | null
          status: string | null
          status_normalized: string | null
          tariff_name: string | null
          three_d_secure: boolean | null
          total_fee: number | null
          tracking_id: string | null
          transaction_type: string | null
          transferred_amount: number | null
          transferred_at: string | null
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          amount?: number | null
          attempts?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bepaid_order_id?: string | null
          bepaid_uid?: string | null
          business_category?: string | null
          card_bank?: string | null
          card_bank_country?: string | null
          card_bin?: string | null
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          card_valid_until?: string | null
          client_accept_language?: string | null
          client_geo_country?: string | null
          client_user_agent?: string | null
          created_at?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_country?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_surname?: string | null
          customer_zip?: string | null
          description?: string | null
          error_category?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
          last_attempt_at?: string | null
          last_error?: string | null
          linked_at?: string | null
          matched_offer_id?: string | null
          matched_order_id?: string | null
          matched_product_id?: string | null
          matched_profile_id?: string | null
          matched_tariff_id?: string | null
          max_attempts?: number | null
          message?: string | null
          next_retry_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_order_id?: string | null
          product_code?: string | null
          product_name?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reason?: string | null
          receipt_url?: string | null
          reference_transaction_uid?: string | null
          rrn?: string | null
          shop_id?: string | null
          shop_name?: string | null
          source?: string | null
          status?: string | null
          status_normalized?: string | null
          tariff_name?: string | null
          three_d_secure?: boolean | null
          total_fee?: number | null
          tracking_id?: string | null
          transaction_type?: string | null
          transferred_amount?: number | null
          transferred_at?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          amount?: number | null
          attempts?: number | null
          auth_code?: string | null
          avs_result?: string | null
          bank_code?: string | null
          bepaid_order_id?: string | null
          bepaid_uid?: string | null
          business_category?: string | null
          card_bank?: string | null
          card_bank_country?: string | null
          card_bin?: string | null
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          card_valid_until?: string | null
          client_accept_language?: string | null
          client_geo_country?: string | null
          client_user_agent?: string | null
          created_at?: string | null
          created_at_bepaid?: string | null
          currency?: string | null
          customer_address?: string | null
          customer_city?: string | null
          customer_country?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          customer_state?: string | null
          customer_surname?: string | null
          customer_zip?: string | null
          description?: string | null
          error_category?: string | null
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          ip_hash?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
          last_attempt_at?: string | null
          last_error?: string | null
          linked_at?: string | null
          matched_offer_id?: string | null
          matched_order_id?: string | null
          matched_product_id?: string | null
          matched_profile_id?: string | null
          matched_tariff_id?: string | null
          max_attempts?: number | null
          message?: string | null
          next_retry_at?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_at?: string | null
          processed_order_id?: string | null
          product_code?: string | null
          product_name?: string | null
          provider?: string | null
          raw_payload?: Json | null
          reason?: string | null
          receipt_url?: string | null
          reference_transaction_uid?: string | null
          rrn?: string | null
          shop_id?: string | null
          shop_name?: string | null
          source?: string | null
          status?: string | null
          status_normalized?: string | null
          tariff_name?: string | null
          three_d_secure?: boolean | null
          total_fee?: number | null
          tracking_id?: string | null
          transaction_type?: string | null
          transferred_amount?: number | null
          transferred_at?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      payment_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      payment_status_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          original_status: string | null
          provider: string
          reason: string | null
          source: string | null
          status_override: string
          uid: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          original_status?: string | null
          provider?: string
          reason?: string | null
          source?: string | null
          status_override: string
          uid: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          original_status?: string | null
          provider?: string
          reason?: string | null
          source?: string | null
          status_override?: string
          uid?: string
          updated_at?: string
        }
        Relationships: []
      }
      payments_sync_runs: {
        Row: {
          created_at: string
          current_cursor: Json | null
          error: string | null
          finished_at: string | null
          id: string
          initiated_by: string | null
          period_from: string
          period_to: string
          processed_pages: number | null
          source_mode: string
          started_at: string | null
          stats: Json | null
          status: string
          total_pages: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_cursor?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          period_from: string
          period_to: string
          processed_pages?: number | null
          source_mode: string
          started_at?: string | null
          stats?: Json | null
          status?: string
          total_pages?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_cursor?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          initiated_by?: string | null
          period_from?: string
          period_to?: string
          processed_pages?: number | null
          source_mode?: string
          started_at?: string | null
          stats?: Json | null
          status?: string
          total_pages?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      payments_v2: {
        Row: {
          amount: number
          card_brand: string | null
          card_holder: string | null
          card_last4: string | null
          created_at: string
          currency: string
          error_message: string | null
          id: string
          import_ref: string | null
          installment_number: number | null
          is_recurring: boolean | null
          meta: Json | null
          order_id: string | null
          origin: string | null
          paid_at: string | null
          payment_classification: string | null
          payment_token: string | null
          product_name_raw: string | null
          profile_id: string | null
          provider: string | null
          provider_payment_id: string | null
          provider_response: Json | null
          receipt_url: string | null
          reference_payment_id: string | null
          refunded_amount: number | null
          refunded_at: string | null
          refunds: Json | null
          status: Database["public"]["Enums"]["payment_status"]
          transaction_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount: number
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          id?: string
          import_ref?: string | null
          installment_number?: number | null
          is_recurring?: boolean | null
          meta?: Json | null
          order_id?: string | null
          origin?: string | null
          paid_at?: string | null
          payment_classification?: string | null
          payment_token?: string | null
          product_name_raw?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_response?: Json | null
          receipt_url?: string | null
          reference_payment_id?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunds?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          id?: string
          import_ref?: string | null
          installment_number?: number | null
          is_recurring?: boolean | null
          meta?: Json | null
          order_id?: string | null
          origin?: string | null
          paid_at?: string | null
          payment_classification?: string | null
          payment_token?: string | null
          product_name_raw?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_response?: Json | null
          receipt_url?: string | null
          reference_payment_id?: string | null
          refunded_amount?: number | null
          refunded_at?: string | null
          refunds?: Json | null
          status?: Database["public"]["Enums"]["payment_status"]
          transaction_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_payments_v2_profile"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_v2_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_v2_reference_payment_id_fkey"
            columns: ["reference_payment_id"]
            isOneToOne: false
            referencedRelation: "payments_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_telegram_notifications: {
        Row: {
          attempts: number | null
          club_id: string | null
          created_at: string
          error_message: string | null
          id: string
          notification_type: string
          payload: Json
          priority: number | null
          scheduled_for: string | null
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number | null
          club_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type: string
          payload?: Json
          priority?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number | null
          club_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          notification_type?: string
          payload?: Json
          priority?: number | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_telegram_notifications_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string | null
          code: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      pricing_stages: {
        Row: {
          created_at: string
          display_order: number | null
          end_date: string | null
          id: string
          is_active: boolean
          name: string
          product_id: string
          stage_type: Database["public"]["Enums"]["pricing_stage_type"]
          start_date: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          name: string
          product_id: string
          stage_type: Database["public"]["Enums"]["pricing_stage_type"]
          start_date?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          end_date?: string | null
          id?: string
          is_active?: boolean
          name?: string
          product_id?: string
          stage_type?: Database["public"]["Enums"]["pricing_stage_type"]
          start_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_stages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_policy_versions: {
        Row: {
          changes: Json | null
          created_at: string | null
          effective_date: string
          id: string
          is_current: boolean | null
          summary: string | null
          version: string
        }
        Insert: {
          changes?: Json | null
          created_at?: string | null
          effective_date: string
          id?: string
          is_current?: boolean | null
          summary?: string | null
          version: string
        }
        Update: {
          changes?: Json | null
          created_at?: string | null
          effective_date?: string
          id?: string
          is_current?: boolean | null
          summary?: string | null
          version?: string
        }
        Relationships: []
      }
      product_club_mappings: {
        Row: {
          club_id: string
          created_at: string
          duration_days: number
          id: string
          is_active: boolean
          product_id: string
          updated_at: string
        }
        Insert: {
          club_id: string
          created_at?: string
          duration_days?: number
          id?: string
          is_active?: boolean
          product_id: string
          updated_at?: string
        }
        Update: {
          club_id?: string
          created_at?: string
          duration_days?: number
          id?: string
          is_active?: boolean
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_club_mappings_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_club_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      product_document_templates: {
        Row: {
          auto_generate: boolean | null
          auto_send_email: boolean | null
          created_at: string
          id: string
          is_active: boolean | null
          product_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          auto_generate?: boolean | null
          auto_send_email?: boolean | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          product_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          auto_generate?: boolean | null
          auto_send_email?: boolean | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          product_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_document_templates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_document_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      product_email_mappings: {
        Row: {
          created_at: string | null
          email_account_id: string
          id: string
          is_active: boolean | null
          product_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email_account_id: string
          id?: string
          is_active?: boolean | null
          product_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email_account_id?: string
          id?: string
          is_active?: boolean | null
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_email_mappings_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_email_mappings_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_email_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      product_reentry_pricing: {
        Row: {
          applies_from: string
          created_at: string
          id: string
          product_id: string
          reason_code: string
          reentry_active: boolean
          source_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          applies_from?: string
          created_at?: string
          id?: string
          product_id: string
          reason_code?: string
          reentry_active?: boolean
          source_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          applies_from?: string
          created_at?: string
          id?: string
          product_id?: string
          reason_code?: string
          reentry_active?: boolean
          source_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_reentry_pricing_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reentry_pricing_source_subscription_id_fkey"
            columns: ["source_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_reentry_pricing_source_subscription_id_fkey"
            columns: ["source_subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      product_relations: {
        Row: {
          child_product_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          parent_product_id: string
          relation_type: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          child_product_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          parent_product_id: string
          relation_type?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          child_product_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          parent_product_id?: string
          relation_type?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_relations_child_product_id_fkey"
            columns: ["child_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relations_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      product_versions: {
        Row: {
          changed_at: string
          changed_by: string | null
          diff_summary: string | null
          id: string
          product_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          diff_summary?: string | null
          id?: string
          product_id: string
          snapshot: Json
          version?: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          diff_summary?: string | null
          id?: string
          product_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          duration_days: number | null
          id: string
          is_active: boolean
          meta: Json | null
          name: string
          price_byn: number
          product_type: string
          tier: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          duration_days?: number | null
          id?: string
          is_active?: boolean
          meta?: Json | null
          name: string
          price_byn: number
          product_type?: string
          tier?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          duration_days?: number | null
          id?: string
          is_active?: boolean
          meta?: Json | null
          name?: string
          price_byn?: number
          product_type?: string
          tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      products_v2: {
        Row: {
          category: string | null
          code: string
          created_at: string
          currency: string
          description: string | null
          entitlement_mode: string | null
          id: string
          is_active: boolean
          landing_config: Json | null
          meta: Json | null
          name: string
          payment_disclaimer_text: string | null
          primary_domain: string | null
          public_id: string | null
          public_subtitle: string | null
          public_title: string | null
          slug: string | null
          status: string
          telegram_club_id: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          entitlement_mode?: string | null
          id?: string
          is_active?: boolean
          landing_config?: Json | null
          meta?: Json | null
          name: string
          payment_disclaimer_text?: string | null
          primary_domain?: string | null
          public_id?: string | null
          public_subtitle?: string | null
          public_title?: string | null
          slug?: string | null
          status?: string
          telegram_club_id?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          entitlement_mode?: string | null
          id?: string
          is_active?: boolean
          landing_config?: Json | null
          meta?: Json | null
          name?: string
          payment_disclaimer_text?: string | null
          primary_domain?: string | null
          public_id?: string | null
          public_subtitle?: string | null
          public_title?: string | null
          slug?: string | null
          status?: string
          telegram_club_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_v2_telegram_club_id_fkey"
            columns: ["telegram_club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          card_holder_names: Json | null
          card_masks: Json | null
          city: string | null
          club_exit_at: string | null
          club_exit_reason: string | null
          communication_style: Json | null
          consent_given_at: string | null
          consent_version: string | null
          country: string | null
          created_at: string
          duplicate_flag: string | null
          duplicate_group_id: string | null
          email: string | null
          emails: Json | null
          external_id_amo: string | null
          external_id_gc: string | null
          first_name: string | null
          full_name: string | null
          gc_registered_at: string | null
          id: string
          import_batch_id: string | null
          instagram_url: string | null
          is_archived: boolean | null
          last_name: string | null
          last_seen_at: string | null
          loyalty_ai_summary: string | null
          loyalty_analyzed_messages_count: number | null
          loyalty_auto_update: boolean | null
          loyalty_proofs: Json | null
          loyalty_score: number | null
          loyalty_status_reason: string | null
          loyalty_updated_at: string | null
          marketing_consent: boolean | null
          merged_to_profile_id: string | null
          onboarding_completed_at: string | null
          onboarding_dismissed_at: string | null
          phone: string | null
          phones: Json | null
          position: string | null
          primary_in_group: boolean | null
          reentry_penalty_waived: boolean
          reentry_penalty_waived_at: string | null
          reentry_penalty_waived_by: string | null
          reentry_pricing_applies_from: string | null
          sentiment_history: Json | null
          source: string | null
          status: string
          telegram_last_check_at: string | null
          telegram_last_error: string | null
          telegram_link_bot_id: string | null
          telegram_link_status: string | null
          telegram_linked_at: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          timezone: string | null
          updated_at: string
          user_id: string | null
          was_club_member: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          card_holder_names?: Json | null
          card_masks?: Json | null
          city?: string | null
          club_exit_at?: string | null
          club_exit_reason?: string | null
          communication_style?: Json | null
          consent_given_at?: string | null
          consent_version?: string | null
          country?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          emails?: Json | null
          external_id_amo?: string | null
          external_id_gc?: string | null
          first_name?: string | null
          full_name?: string | null
          gc_registered_at?: string | null
          id?: string
          import_batch_id?: string | null
          instagram_url?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_seen_at?: string | null
          loyalty_ai_summary?: string | null
          loyalty_analyzed_messages_count?: number | null
          loyalty_auto_update?: boolean | null
          loyalty_proofs?: Json | null
          loyalty_score?: number | null
          loyalty_status_reason?: string | null
          loyalty_updated_at?: string | null
          marketing_consent?: boolean | null
          merged_to_profile_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_dismissed_at?: string | null
          phone?: string | null
          phones?: Json | null
          position?: string | null
          primary_in_group?: boolean | null
          reentry_penalty_waived?: boolean
          reentry_penalty_waived_at?: string | null
          reentry_penalty_waived_by?: string | null
          reentry_pricing_applies_from?: string | null
          sentiment_history?: Json | null
          source?: string | null
          status?: string
          telegram_last_check_at?: string | null
          telegram_last_error?: string | null
          telegram_link_bot_id?: string | null
          telegram_link_status?: string | null
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
          was_club_member?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          card_holder_names?: Json | null
          card_masks?: Json | null
          city?: string | null
          club_exit_at?: string | null
          club_exit_reason?: string | null
          communication_style?: Json | null
          consent_given_at?: string | null
          consent_version?: string | null
          country?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          emails?: Json | null
          external_id_amo?: string | null
          external_id_gc?: string | null
          first_name?: string | null
          full_name?: string | null
          gc_registered_at?: string | null
          id?: string
          import_batch_id?: string | null
          instagram_url?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_seen_at?: string | null
          loyalty_ai_summary?: string | null
          loyalty_analyzed_messages_count?: number | null
          loyalty_auto_update?: boolean | null
          loyalty_proofs?: Json | null
          loyalty_score?: number | null
          loyalty_status_reason?: string | null
          loyalty_updated_at?: string | null
          marketing_consent?: boolean | null
          merged_to_profile_id?: string | null
          onboarding_completed_at?: string | null
          onboarding_dismissed_at?: string | null
          phone?: string | null
          phones?: Json | null
          position?: string | null
          primary_in_group?: boolean | null
          reentry_penalty_waived?: boolean
          reentry_penalty_waived_at?: string | null
          reentry_penalty_waived_by?: string | null
          reentry_pricing_applies_from?: string | null
          sentiment_history?: Json | null
          source?: string | null
          status?: string
          telegram_last_check_at?: string | null
          telegram_last_error?: string | null
          telegram_link_bot_id?: string | null
          telegram_link_status?: string | null
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string | null
          was_club_member?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_telegram_link_bot_id_fkey"
            columns: ["telegram_link_bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_telegram_link_bot_id_fkey"
            columns: ["telegram_link_bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_subscriptions: {
        Row: {
          amount_cents: number | null
          card_brand: string | null
          card_last4: string | null
          card_token: string | null
          created_at: string
          currency: string | null
          id: string
          interval_days: number | null
          last_charge_at: string | null
          meta: Json | null
          next_charge_at: string | null
          order_id: string | null
          profile_id: string | null
          provider: string
          provider_subscription_id: string
          raw_data: Json | null
          state: string
          subscription_v2_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          card_brand?: string | null
          card_last4?: string | null
          card_token?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          interval_days?: number | null
          last_charge_at?: string | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          profile_id?: string | null
          provider?: string
          provider_subscription_id: string
          raw_data?: Json | null
          state?: string
          subscription_v2_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          card_brand?: string | null
          card_last4?: string | null
          card_token?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          interval_days?: number | null
          last_charge_at?: string | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          profile_id?: string | null
          provider?: string
          provider_subscription_id?: string
          raw_data?: Json | null
          state?: string
          subscription_v2_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_subscriptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_v2_id_fkey"
            columns: ["subscription_v2_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_subscriptions_subscription_v2_id_fkey"
            columns: ["subscription_v2_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_subscriptions_synthetic_cleanup_backup_2026_05: {
        Row: {
          amount_cents: number | null
          backed_up_at: string | null
          before_json: Json | null
          card_brand: string | null
          card_last4: string | null
          card_token: string | null
          cohort: string | null
          created_at: string | null
          currency: string | null
          id: string | null
          interval_days: number | null
          last_charge_at: string | null
          meta: Json | null
          next_charge_at: string | null
          order_id: string | null
          profile_id: string | null
          provider: string | null
          provider_subscription_id: string | null
          raw_data: Json | null
          state: string | null
          subscription_v2_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          backed_up_at?: string | null
          before_json?: Json | null
          card_brand?: string | null
          card_last4?: string | null
          card_token?: string | null
          cohort?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          interval_days?: number | null
          last_charge_at?: string | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_subscription_id?: string | null
          raw_data?: Json | null
          state?: string | null
          subscription_v2_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          backed_up_at?: string | null
          before_json?: Json | null
          card_brand?: string | null
          card_last4?: string | null
          card_token?: string | null
          cohort?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          interval_days?: number | null
          last_charge_at?: string | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_subscription_id?: string | null
          raw_data?: Json | null
          state?: string | null
          subscription_v2_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      provider_webhook_orphans: {
        Row: {
          created_at: string
          id: string
          processed: boolean | null
          processed_at: string | null
          processed_by: string | null
          provider: string
          provider_payment_id: string | null
          provider_subscription_id: string | null
          raw_data: Json
          reason: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          processed?: boolean | null
          processed_at?: string | null
          processed_by?: string | null
          provider?: string
          provider_payment_id?: string | null
          provider_subscription_id?: string | null
          raw_data: Json
          reason: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          processed?: boolean | null
          processed_at?: string | null
          processed_by?: string | null
          provider?: string
          provider_payment_id?: string | null
          provider_subscription_id?: string | null
          raw_data?: Json
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_id_sequences: {
        Row: {
          entity_type: string
          last_value: number
          prefix: string
        }
        Insert: {
          entity_type: string
          last_value?: number
          prefix: string
        }
        Update: {
          entity_type?: string
          last_value?: number
          prefix?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quest_lessons: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          homework_file_url: string | null
          homework_text: string | null
          id: string
          is_active: boolean
          quest_id: string
          slug: string
          sort_order: number
          title: string
          updated_at: string
          video_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          homework_file_url?: string | null
          homework_text?: string | null
          id?: string
          is_active?: boolean
          quest_id: string
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
          video_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          homework_file_url?: string | null
          homework_text?: string | null
          id?: string
          is_active?: boolean
          quest_id?: string
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
          video_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quest_lessons_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      quest_user_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          homework_response: Json | null
          id: string
          is_completed: boolean
          lesson_id: string
          quest_id: string
          updated_at: string
          user_id: string
          watched_seconds: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          homework_response?: Json | null
          id?: string
          is_completed?: boolean
          lesson_id: string
          quest_id: string
          updated_at?: string
          user_id: string
          watched_seconds?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          homework_response?: Json | null
          id?: string
          is_completed?: boolean
          lesson_id?: string
          quest_id?: string
          updated_at?: string
          user_id?: string
          watched_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quest_user_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "quest_lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quest_user_progress_quest_id_fkey"
            columns: ["quest_id"]
            isOneToOne: false
            referencedRelation: "quests"
            referencedColumns: ["id"]
          },
        ]
      }
      quests: {
        Row: {
          color_gradient: string | null
          cover_image: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_free: boolean
          slug: string
          sort_order: number
          title: string
          total_lessons: number
          updated_at: string
        }
        Insert: {
          color_gradient?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          slug: string
          sort_order?: number
          title: string
          total_lessons?: number
          updated_at?: string
        }
        Update: {
          color_gradient?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_free?: boolean
          slug?: string
          sort_order?: number
          title?: string
          total_lessons?: number
          updated_at?: string
        }
        Relationships: []
      }
      rejected_card_attempts: {
        Row: {
          card_brand: string | null
          card_category: string | null
          card_last4: string | null
          card_product: string | null
          created_at: string | null
          id: string
          offer_id: string | null
          raw_data: Json | null
          reason: string
          user_id: string | null
        }
        Insert: {
          card_brand?: string | null
          card_category?: string | null
          card_last4?: string | null
          card_product?: string | null
          created_at?: string | null
          id?: string
          offer_id?: string | null
          raw_data?: Json | null
          reason: string
          user_id?: string | null
        }
        Update: {
          card_brand?: string | null
          card_category?: string | null
          card_last4?: string | null
          card_product?: string | null
          created_at?: string | null
          id?: string
          offer_id?: string | null
          raw_data?: Json | null
          reason?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rejected_card_attempts_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      rev_7101ed3c_backup: {
        Row: {
          base_price: number | null
          bepaid_subscription_id: string | null
          created_at: string | null
          currency: string | null
          customer_email: string | null
          customer_ip: string | null
          customer_phone: string | null
          deal_date: string | null
          discount_percent: number | null
          final_price: number | null
          flow_id: string | null
          gc_next_retry_at: string | null
          id: string | null
          invoice_email: string | null
          invoice_sent_at: string | null
          is_trial: boolean | null
          meta: Json | null
          offer_id: string | null
          order_number: string | null
          paid_amount: number | null
          payer_type: string | null
          payment_plan_id: string | null
          pipeline_id: string | null
          pipeline_stage_id: string | null
          pricing_stage_id: string | null
          product_id: string | null
          profile_id: string | null
          provider: string | null
          provider_payment_id: string | null
          purchase_snapshot: Json | null
          reconcile_source: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          tariff_id: string | null
          trial_end_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          base_price?: number | null
          bepaid_subscription_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price?: number | null
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string | null
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean | null
          meta?: Json | null
          offer_id?: string | null
          order_number?: string | null
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          base_price?: number | null
          bepaid_subscription_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string | null
          customer_ip?: string | null
          customer_phone?: string | null
          deal_date?: string | null
          discount_percent?: number | null
          final_price?: number | null
          flow_id?: string | null
          gc_next_retry_at?: string | null
          id?: string | null
          invoice_email?: string | null
          invoice_sent_at?: string | null
          is_trial?: boolean | null
          meta?: Json | null
          offer_id?: string | null
          order_number?: string | null
          paid_amount?: number | null
          payer_type?: string | null
          payment_plan_id?: string | null
          pipeline_id?: string | null
          pipeline_stage_id?: string | null
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          purchase_snapshot?: Json | null
          reconcile_source?: string | null
          status?: Database["public"]["Enums"]["order_status"] | null
          tariff_id?: string | null
          trial_end_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      rev_7101ed3c_ops: {
        Row: {
          payload: Json
          seq: number
        }
        Insert: {
          payload: Json
          seq?: number
        }
        Update: {
          payload?: Json
          seq?: number
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      scrape_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          errors: Json | null
          id: string
          news_duplicates: number | null
          news_found: number | null
          news_saved: number | null
          sources_failed: number | null
          sources_success: number | null
          sources_total: number | null
          started_at: string
          status: string
          summary: string | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          id?: string
          news_duplicates?: number | null
          news_found?: number | null
          news_saved?: number | null
          sources_failed?: number | null
          sources_success?: number | null
          sources_total?: number | null
          started_at?: string
          status?: string
          summary?: string | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          id?: string
          news_duplicates?: number | null
          news_found?: number | null
          news_saved?: number | null
          sources_failed?: number | null
          sources_success?: number | null
          sources_total?: number | null
          started_at?: string
          status?: string
          summary?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      site_domain_bindings: {
        Row: {
          created_at: string
          created_by: string
          domain: string
          id: string
          is_home: boolean
          is_primary: boolean
          metadata: Json
          public_id: string
          site_page_id: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          domain: string
          id?: string
          is_home?: boolean
          is_primary?: boolean
          metadata?: Json
          public_id?: string
          site_page_id: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          domain?: string
          id?: string
          is_home?: boolean
          is_primary?: boolean
          metadata?: Json
          public_id?: string
          site_page_id?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_domain_bindings_site_page_id_fkey"
            columns: ["site_page_id"]
            isOneToOne: false
            referencedRelation: "site_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      site_form_submissions: {
        Row: {
          created_at: string
          created_by: string | null
          field_mapping: Json
          form_data: Json
          id: string
          metadata: Json
          order_id: string | null
          page_id: string
          profile_id: string | null
          public_id: string
          source: string
          status: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_mapping?: Json
          form_data?: Json
          id?: string
          metadata?: Json
          order_id?: string | null
          page_id: string
          profile_id?: string | null
          public_id: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_mapping?: Json
          form_data?: Json
          id?: string
          metadata?: Json
          order_id?: string | null
          page_id?: string
          profile_id?: string | null
          public_id?: string
          source?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_form_submissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_form_submissions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "site_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_form_submissions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      site_page_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_page_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "site_page_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      site_page_tag_links: {
        Row: {
          created_at: string
          page_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          page_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          page_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_page_tag_links_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "site_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_page_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "site_page_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      site_page_tags: {
        Row: {
          created_at: string
          created_by: string
          id: string
          metadata: Json
          name: string
          public_id: string
          updated_at: string
          updated_by: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          metadata?: Json
          name: string
          public_id?: string
          updated_at?: string
          updated_by: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          metadata?: Json
          name?: string
          public_id?: string
          updated_at?: string
          updated_by?: string
          workspace_id?: string
        }
        Relationships: []
      }
      site_pages: {
        Row: {
          blocks: Json
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          metadata: Json
          product_id: string | null
          public_id: string
          published_at: string | null
          seo_settings: Json
          slug: string
          status: string
          theme_settings: Json
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          blocks?: Json
          created_at?: string
          created_by: string
          folder_id?: string | null
          id?: string
          metadata?: Json
          product_id?: string | null
          public_id?: string
          published_at?: string | null
          seo_settings?: Json
          slug: string
          status?: string
          theme_settings?: Json
          title: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Update: {
          blocks?: Json
          created_at?: string
          created_by?: string
          folder_id?: string | null
          id?: string
          metadata?: Json
          product_id?: string | null
          public_id?: string
          published_at?: string | null
          seo_settings?: Json
          slug?: string
          status?: string
          theme_settings?: Json
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_pages_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "site_page_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_pages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      sphere_goals: {
        Row: {
          completed: boolean
          content: string
          created_at: string
          id: string
          sphere_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          content: string
          created_at?: string
          id?: string
          sphere_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          content?: string
          created_at?: string
          id?: string
          sphere_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      statement_lines: {
        Row: {
          card_last4: string | null
          created_at: string | null
          customer_email: string | null
          error: string | null
          id: string
          order_id: string | null
          parsed_amount: number | null
          parsed_currency: string | null
          parsed_paid_at: string | null
          parsed_status: string | null
          payment_id: string | null
          processed_at: string | null
          provider: string
          raw_data: Json | null
          source: string
          source_timezone: string | null
          stable_key: string
          transaction_type: string | null
          updated_at: string | null
        }
        Insert: {
          card_last4?: string | null
          created_at?: string | null
          customer_email?: string | null
          error?: string | null
          id?: string
          order_id?: string | null
          parsed_amount?: number | null
          parsed_currency?: string | null
          parsed_paid_at?: string | null
          parsed_status?: string | null
          payment_id?: string | null
          processed_at?: string | null
          provider?: string
          raw_data?: Json | null
          source?: string
          source_timezone?: string | null
          stable_key: string
          transaction_type?: string | null
          updated_at?: string | null
        }
        Update: {
          card_last4?: string | null
          created_at?: string | null
          customer_email?: string | null
          error?: string | null
          id?: string
          order_id?: string | null
          parsed_amount?: number | null
          parsed_currency?: string | null
          parsed_paid_at?: string | null
          parsed_status?: string | null
          payment_id?: string | null
          processed_at?: string | null
          provider?: string
          raw_data?: Json | null
          source?: string
          source_timezone?: string | null
          stable_key?: string
          transaction_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "statement_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "statement_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_payment_credentials: {
        Row: {
          created_at: string | null
          id: string
          payment_token: string
          subscription_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          payment_token: string
          subscription_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          payment_token?: string
          subscription_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payment_credentials_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payment_credentials_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          starts_at: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          starts_at?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions_v2: {
        Row: {
          access_end_at: string | null
          access_start_at: string
          auto_renew: boolean
          auto_renew_disabled_at: string | null
          auto_renew_disabled_by: string | null
          auto_renew_disabled_by_user_id: string | null
          billing_type: string
          cancel_at: string | null
          cancel_reason: string | null
          canceled_at: string | null
          charge_attempts: number | null
          created_at: string
          flow_id: string | null
          grace_period_ends_at: string | null
          grace_period_started_at: string | null
          grace_period_status: string | null
          id: string
          is_trial: boolean
          keep_access_until_trial_end: boolean | null
          meta: Json | null
          next_charge_at: string | null
          order_id: string | null
          payment_method_id: string | null
          payment_token: string | null
          product_id: string
          profile_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          tariff_id: string | null
          trial_canceled_at: string | null
          trial_canceled_by: string | null
          trial_end_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_end_at?: string | null
          access_start_at?: string
          auto_renew?: boolean
          auto_renew_disabled_at?: string | null
          auto_renew_disabled_by?: string | null
          auto_renew_disabled_by_user_id?: string | null
          billing_type?: string
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string
          flow_id?: string | null
          grace_period_ends_at?: string | null
          grace_period_started_at?: string | null
          grace_period_status?: string | null
          id?: string
          is_trial?: boolean
          keep_access_until_trial_end?: boolean | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          payment_method_id?: string | null
          payment_token?: string | null
          product_id: string
          profile_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tariff_id?: string | null
          trial_canceled_at?: string | null
          trial_canceled_by?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_end_at?: string | null
          access_start_at?: string
          auto_renew?: boolean
          auto_renew_disabled_at?: string | null
          auto_renew_disabled_by?: string | null
          auto_renew_disabled_by_user_id?: string | null
          billing_type?: string
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string
          flow_id?: string | null
          grace_period_ends_at?: string | null
          grace_period_started_at?: string | null
          grace_period_status?: string | null
          id?: string
          is_trial?: boolean
          keep_access_until_trial_end?: boolean | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          payment_method_id?: string | null
          payment_token?: string | null
          product_id?: string
          profile_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          tariff_id?: string | null
          trial_canceled_at?: string | null
          trial_canceled_by?: string | null
          trial_end_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_subscriptions_v2_profile"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions_v2_repair_backup_2026_05: {
        Row: {
          access_end_at: string | null
          backup_id: string
          batch_id: string
          expected_min_end: string
          meta: Json | null
          next_charge_at: string | null
          product_id: string
          reason: string
          repair_bucket: string
          snapshot_at: string
          source_order_id: string
          source_payment_id: string
          status: string | null
          sub_id: string
          tariff_id: string | null
          user_id: string
        }
        Insert: {
          access_end_at?: string | null
          backup_id?: string
          batch_id: string
          expected_min_end: string
          meta?: Json | null
          next_charge_at?: string | null
          product_id: string
          reason: string
          repair_bucket: string
          snapshot_at?: string
          source_order_id: string
          source_payment_id: string
          status?: string | null
          sub_id: string
          tariff_id?: string | null
          user_id: string
        }
        Update: {
          access_end_at?: string | null
          backup_id?: string
          batch_id?: string
          expected_min_end?: string
          meta?: Json | null
          next_charge_at?: string | null
          product_id?: string
          reason?: string
          repair_bucket?: string
          snapshot_at?: string
          source_order_id?: string
          source_payment_id?: string
          status?: string | null
          sub_id?: string
          tariff_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      support_ticket_counters: {
        Row: {
          seq: number
          year: string
        }
        Insert: {
          seq?: number
          year: string
        }
        Update: {
          seq?: number
          year?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string | null
          closed_at: string | null
          created_at: string | null
          description: string
          first_response_at: string | null
          has_unread_admin: boolean | null
          has_unread_user: boolean | null
          id: string
          is_starred: boolean | null
          priority: string | null
          profile_id: string
          resolved_at: string | null
          status: string
          subject: string
          telegram_bridge_enabled: boolean | null
          telegram_user_id: number | null
          ticket_number: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          created_at?: string | null
          description: string
          first_response_at?: string | null
          has_unread_admin?: boolean | null
          has_unread_user?: boolean | null
          id?: string
          is_starred?: boolean | null
          priority?: string | null
          profile_id: string
          resolved_at?: string | null
          status?: string
          subject: string
          telegram_bridge_enabled?: boolean | null
          telegram_user_id?: number | null
          ticket_number?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          created_at?: string | null
          description?: string
          first_response_at?: string | null
          has_unread_admin?: boolean | null
          has_unread_user?: boolean | null
          id?: string
          is_starred?: boolean | null
          priority?: string | null
          profile_id?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          telegram_bridge_enabled?: boolean | null
          telegram_user_id?: number | null
          ticket_number?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_checks: {
        Row: {
          category: string
          check_key: string
          check_name: string
          count: number | null
          created_at: string
          details: Json | null
          duration_ms: number | null
          id: string
          run_id: string
          sample_rows: Json | null
          status: string
        }
        Insert: {
          category: string
          check_key: string
          check_name: string
          count?: number | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          id?: string
          run_id: string
          sample_rows?: Json | null
          status: string
        }
        Update: {
          category?: string
          check_key?: string
          check_name?: string
          count?: number | null
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          id?: string
          run_id?: string
          sample_rows?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_health_checks_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_health_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_discovery_findings: {
        Row: {
          coverage_pct: number | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          evidence_query: string
          field: string
          finding_id: string
          id: string
          match_count: number
          note: string | null
          snapshot_id: string
          total_in_finding: number
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          coverage_pct?: number | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_query: string
          field: string
          finding_id: string
          id?: string
          match_count: number
          note?: string | null
          snapshot_id: string
          total_in_finding: number
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          coverage_pct?: number | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_query?: string
          field?: string
          finding_id?: string
          id?: string
          match_count?: number
          note?: string | null
          snapshot_id?: string
          total_in_finding?: number
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_health_discovery_findings_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "system_health_discovery_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_discovery_findings_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_fields: string[] | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          evidence_query: string
          field: string
          finding_id: string
          finding_row_id: string
          history_id: string
          match_count: number
          note: string | null
          op: string
          row_snapshot: Json
          snapshot_id: string
          total_in_finding: number
          value: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          decided_at?: string | null
          decided_by?: string | null
          decision: string
          evidence_query: string
          field: string
          finding_id: string
          finding_row_id: string
          history_id?: string
          match_count: number
          note?: string | null
          op: string
          row_snapshot: Json
          snapshot_id: string
          total_in_finding: number
          value: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence_query?: string
          field?: string
          finding_id?: string
          finding_row_id?: string
          history_id?: string
          match_count?: number
          note?: string | null
          op?: string
          row_snapshot?: Json
          snapshot_id?: string
          total_in_finding?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_health_discovery_findings_history_finding_row_id_fkey"
            columns: ["finding_row_id"]
            isOneToOne: false
            referencedRelation: "system_health_discovery_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_health_discovery_findings_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "system_health_discovery_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_discovery_snapshots: {
        Row: {
          created_at: string
          finding_id: string
          id: string
          note: string | null
          source_query: string
          taken_at: string
          taken_by: string | null
          total_rows: number
        }
        Insert: {
          created_at?: string
          finding_id: string
          id?: string
          note?: string | null
          source_query: string
          taken_at?: string
          taken_by?: string | null
          total_rows: number
        }
        Update: {
          created_at?: string
          finding_id?: string
          id?: string
          note?: string | null
          source_query?: string
          taken_at?: string
          taken_by?: string | null
          total_rows?: number
        }
        Relationships: []
      }
      system_health_ignored_checks: {
        Row: {
          check_key: string
          created_at: string | null
          expires_at: string | null
          id: string
          ignored_at: string | null
          ignored_by: string | null
          reason: string
          source: string | null
        }
        Insert: {
          check_key: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          reason: string
          source?: string | null
        }
        Update: {
          check_key?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          ignored_at?: string | null
          ignored_by?: string | null
          reason?: string
          source?: string | null
        }
        Relationships: []
      }
      system_health_reports: {
        Row: {
          auto_fixes: Json | null
          auto_fixes_count: number
          created_at: string
          duration_ms: number | null
          edge_functions_deployed: number
          edge_functions_missing: string[] | null
          edge_functions_total: number
          id: string
          invariants_failed: number
          invariants_passed: number
          invariants_total: number
          report_json: Json
          source: string
          status: string
          telegram_notified: boolean | null
          triggered_by: string | null
        }
        Insert: {
          auto_fixes?: Json | null
          auto_fixes_count?: number
          created_at?: string
          duration_ms?: number | null
          edge_functions_deployed?: number
          edge_functions_missing?: string[] | null
          edge_functions_total?: number
          id?: string
          invariants_failed?: number
          invariants_passed?: number
          invariants_total?: number
          report_json?: Json
          source?: string
          status: string
          telegram_notified?: boolean | null
          triggered_by?: string | null
        }
        Update: {
          auto_fixes?: Json | null
          auto_fixes_count?: number
          created_at?: string
          duration_ms?: number | null
          edge_functions_deployed?: number
          edge_functions_missing?: string[] | null
          edge_functions_total?: number
          id?: string
          invariants_failed?: number
          invariants_passed?: number
          invariants_total?: number
          report_json?: Json
          source?: string
          status?: string
          telegram_notified?: boolean | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      system_health_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          meta: Json | null
          run_type: string
          started_at: string
          status: string
          summary: Json | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          meta?: Json | null
          run_type?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          meta?: Json | null
          run_type?: string
          started_at?: string
          status?: string
          summary?: Json | null
        }
        Relationships: []
      }
      tariff_features: {
        Row: {
          active_from: string | null
          active_to: string | null
          bonus_type: string | null
          created_at: string
          icon: string | null
          id: string
          is_bonus: boolean | null
          is_highlighted: boolean | null
          label: string | null
          link_url: string | null
          sort_order: number | null
          tariff_id: string
          text: string
          updated_at: string
          visibility_mode: string | null
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          bonus_type?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_bonus?: boolean | null
          is_highlighted?: boolean | null
          label?: string | null
          link_url?: string | null
          sort_order?: number | null
          tariff_id: string
          text: string
          updated_at?: string
          visibility_mode?: string | null
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          bonus_type?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_bonus?: boolean | null
          is_highlighted?: boolean | null
          label?: string | null
          link_url?: string | null
          sort_order?: number | null
          tariff_id?: string
          text?: string
          updated_at?: string
          visibility_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_features_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_offers: {
        Row: {
          amount: number
          auto_charge_after_trial: boolean | null
          auto_charge_amount: number | null
          auto_charge_delay_days: number | null
          auto_charge_offer_id: string | null
          button_label: string
          created_at: string | null
          first_payment_delay_days: number | null
          getcourse_offer_id: string | null
          id: string
          installment_count: number | null
          installment_interval_days: number | null
          is_active: boolean | null
          is_installment: boolean | null
          is_primary: boolean | null
          meta: Json | null
          offer_type: string
          payment_method: string | null
          reentry_amount: number | null
          reject_virtual_cards: boolean | null
          requires_card_tokenization: boolean | null
          sort_order: number | null
          tariff_id: string
          trial_days: number | null
          updated_at: string | null
          visible_from: string | null
          visible_to: string | null
        }
        Insert: {
          amount: number
          auto_charge_after_trial?: boolean | null
          auto_charge_amount?: number | null
          auto_charge_delay_days?: number | null
          auto_charge_offer_id?: string | null
          button_label: string
          created_at?: string | null
          first_payment_delay_days?: number | null
          getcourse_offer_id?: string | null
          id?: string
          installment_count?: number | null
          installment_interval_days?: number | null
          is_active?: boolean | null
          is_installment?: boolean | null
          is_primary?: boolean | null
          meta?: Json | null
          offer_type: string
          payment_method?: string | null
          reentry_amount?: number | null
          reject_virtual_cards?: boolean | null
          requires_card_tokenization?: boolean | null
          sort_order?: number | null
          tariff_id: string
          trial_days?: number | null
          updated_at?: string | null
          visible_from?: string | null
          visible_to?: string | null
        }
        Update: {
          amount?: number
          auto_charge_after_trial?: boolean | null
          auto_charge_amount?: number | null
          auto_charge_delay_days?: number | null
          auto_charge_offer_id?: string | null
          button_label?: string
          created_at?: string | null
          first_payment_delay_days?: number | null
          getcourse_offer_id?: string | null
          id?: string
          installment_count?: number | null
          installment_interval_days?: number | null
          is_active?: boolean | null
          is_installment?: boolean | null
          is_primary?: boolean | null
          meta?: Json | null
          offer_type?: string
          payment_method?: string | null
          reentry_amount?: number | null
          reject_virtual_cards?: boolean | null
          requires_card_tokenization?: boolean | null
          sort_order?: number | null
          tariff_id?: string
          trial_days?: number | null
          updated_at?: string | null
          visible_from?: string | null
          visible_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_offers_auto_charge_offer_id_fkey"
            columns: ["auto_charge_offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_offers_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_prices: {
        Row: {
          created_at: string
          currency: string
          discount_enabled: boolean
          discount_percent: number | null
          final_price: number | null
          id: string
          is_active: boolean
          price: number
          pricing_stage_id: string | null
          tariff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          discount_enabled?: boolean
          discount_percent?: number | null
          final_price?: number | null
          id?: string
          is_active?: boolean
          price: number
          pricing_stage_id?: string | null
          tariff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          discount_enabled?: boolean
          discount_percent?: number | null
          final_price?: number | null
          id?: string
          is_active?: boolean
          price?: number
          pricing_stage_id?: string | null
          tariff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_prices_pricing_stage_id_fkey"
            columns: ["pricing_stage_id"]
            isOneToOne: false
            referencedRelation: "pricing_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_prices_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      tariffs: {
        Row: {
          access_days: number
          badge: string | null
          code: string
          created_at: string
          description: string | null
          discount_enabled: boolean | null
          discount_percent: number | null
          display_order: number | null
          document_params: Json | null
          features: Json | null
          getcourse_offer_code: string | null
          getcourse_offer_id: number | null
          id: string
          is_active: boolean
          is_popular: boolean | null
          meta: Json | null
          name: string
          original_price: number | null
          period_label: string | null
          price_monthly: number | null
          product_id: string
          public_id: string
          sort_order: number | null
          subtitle: string | null
          trial_auto_charge: boolean | null
          trial_days: number | null
          trial_enabled: boolean
          trial_price: number | null
          updated_at: string
          visible_from: string | null
          visible_to: string | null
        }
        Insert: {
          access_days?: number
          badge?: string | null
          code: string
          created_at?: string
          description?: string | null
          discount_enabled?: boolean | null
          discount_percent?: number | null
          display_order?: number | null
          document_params?: Json | null
          features?: Json | null
          getcourse_offer_code?: string | null
          getcourse_offer_id?: number | null
          id?: string
          is_active?: boolean
          is_popular?: boolean | null
          meta?: Json | null
          name: string
          original_price?: number | null
          period_label?: string | null
          price_monthly?: number | null
          product_id: string
          public_id?: string
          sort_order?: number | null
          subtitle?: string | null
          trial_auto_charge?: boolean | null
          trial_days?: number | null
          trial_enabled?: boolean
          trial_price?: number | null
          updated_at?: string
          visible_from?: string | null
          visible_to?: string | null
        }
        Update: {
          access_days?: number
          badge?: string | null
          code?: string
          created_at?: string
          description?: string | null
          discount_enabled?: boolean | null
          discount_percent?: number | null
          display_order?: number | null
          document_params?: Json | null
          features?: Json | null
          getcourse_offer_code?: string | null
          getcourse_offer_id?: number | null
          id?: string
          is_active?: boolean
          is_popular?: boolean | null
          meta?: Json | null
          name?: string
          original_price?: number | null
          period_label?: string | null
          price_monthly?: number | null
          product_id?: string
          public_id?: string
          sort_order?: number | null
          subtitle?: string | null
          trial_auto_charge?: boolean | null
          trial_days?: number | null
          trial_enabled?: boolean
          trial_price?: number | null
          updated_at?: string
          visible_from?: string | null
          visible_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariffs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      task_categories: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_access: {
        Row: {
          active_until: string | null
          club_id: string
          created_at: string
          id: string
          invites_pending: boolean | null
          last_sync_at: string | null
          state_channel: string
          state_chat: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_until?: string | null
          club_id: string
          created_at?: string
          id?: string
          invites_pending?: boolean | null
          last_sync_at?: string | null
          state_channel?: string
          state_chat?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_until?: string | null
          club_id?: string
          created_at?: string
          id?: string
          invites_pending?: boolean | null
          last_sync_at?: string | null
          state_channel?: string
          state_chat?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_access_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_access_audit: {
        Row: {
          actor_id: string | null
          actor_type: string
          club_id: string | null
          created_at: string
          event_type: string
          id: string
          meta: Json | null
          reason: string | null
          telegram_channel_result: Json | null
          telegram_chat_result: Json | null
          telegram_user_id: number | null
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          club_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          meta?: Json | null
          reason?: string | null
          telegram_channel_result?: Json | null
          telegram_chat_result?: Json | null
          telegram_user_id?: number | null
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          club_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          meta?: Json | null
          reason?: string | null
          telegram_channel_result?: Json | null
          telegram_chat_result?: Json | null
          telegram_user_id?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_access_audit_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_access_grants: {
        Row: {
          club_id: string
          created_at: string
          end_at: string | null
          granted_by: string | null
          id: string
          meta: Json | null
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source: string
          source_id: string | null
          start_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          club_id: string
          created_at?: string
          end_at?: string | null
          granted_by?: string | null
          id?: string
          meta?: Json | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          source_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          club_id?: string
          created_at?: string
          end_at?: string | null
          granted_by?: string | null
          id?: string
          meta?: Json | null
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string
          source_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_access_grants_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_access_queue: {
        Row: {
          action: string
          attempts: number | null
          club_id: string
          created_at: string | null
          id: string
          last_error: string | null
          meta: Json | null
          processed_at: string | null
          status: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          attempts?: number | null
          club_id: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          meta?: Json | null
          processed_at?: string | null
          status?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          attempts?: number | null
          club_id?: string
          created_at?: string | null
          id?: string
          last_error?: string | null
          meta?: Json | null
          processed_at?: string | null
          status?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_access_queue_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_access_queue_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_access_queue_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions_v2_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_access_repair_backup_2026_05: {
        Row: {
          active_until: string | null
          backup_id: string
          batch_id: string
          club_id: string
          expected_min_end: string
          reason: string
          repair_bucket: string
          snapshot_at: string
          source_order_id: string
          source_payment_id: string
          state_channel: string | null
          state_chat: string | null
          tg_id: string
          user_id: string
        }
        Insert: {
          active_until?: string | null
          backup_id?: string
          batch_id: string
          club_id: string
          expected_min_end: string
          reason: string
          repair_bucket: string
          snapshot_at?: string
          source_order_id: string
          source_payment_id: string
          state_channel?: string | null
          state_chat?: string | null
          tg_id: string
          user_id: string
        }
        Update: {
          active_until?: string | null
          backup_id?: string
          batch_id?: string
          club_id?: string
          expected_min_end?: string
          reason?: string
          repair_bucket?: string
          snapshot_at?: string
          source_order_id?: string
          source_payment_id?: string
          state_channel?: string | null
          state_chat?: string | null
          tg_id?: string
          user_id?: string
        }
        Relationships: []
      }
      telegram_ai_conversations: {
        Row: {
          bot_id: string | null
          created_at: string | null
          id: string
          last_confidence: number | null
          last_greeted_date: string | null
          last_intent: string | null
          last_message_at: string | null
          last_topics_summary: string | null
          messages: Json | null
          style_detected: Json | null
          telegram_user_id: number
          updated_at: string | null
          user_id: string | null
          user_tone_preference: Json | null
        }
        Insert: {
          bot_id?: string | null
          created_at?: string | null
          id?: string
          last_confidence?: number | null
          last_greeted_date?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_topics_summary?: string | null
          messages?: Json | null
          style_detected?: Json | null
          telegram_user_id: number
          updated_at?: string | null
          user_id?: string | null
          user_tone_preference?: Json | null
        }
        Update: {
          bot_id?: string | null
          created_at?: string | null
          id?: string
          last_confidence?: number | null
          last_greeted_date?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_topics_summary?: string | null
          messages?: Json | null
          style_detected?: Json | null
          telegram_user_id?: number
          updated_at?: string | null
          user_id?: string | null
          user_tone_preference?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_ai_conversations_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_ai_conversations_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_ai_processed_messages: {
        Row: {
          bot_id: string | null
          id: string
          processed_at: string | null
          response_sent: boolean | null
          telegram_message_id: number
          telegram_user_id: number
        }
        Insert: {
          bot_id?: string | null
          id?: string
          processed_at?: string | null
          response_sent?: boolean | null
          telegram_message_id: number
          telegram_user_id: number
        }
        Update: {
          bot_id?: string | null
          id?: string
          processed_at?: string | null
          response_sent?: boolean | null
          telegram_message_id?: number
          telegram_user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_ai_processed_messages_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_ai_processed_messages_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_audit_shape_runs: {
        Row: {
          actor_user_id: string
          audit_id: string | null
          created_at: string
          id: string
          meta: Json
          scenario: string
          status: string
        }
        Insert: {
          actor_user_id: string
          audit_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          scenario: string
          status: string
        }
        Update: {
          actor_user_id?: string
          audit_id?: string | null
          created_at?: string
          id?: string
          meta?: Json
          scenario?: string
          status?: string
        }
        Relationships: []
      }
      telegram_bots: {
        Row: {
          bot_id: number | null
          bot_name: string
          bot_token_encrypted: string
          bot_username: string
          created_at: string
          error_message: string | null
          id: string
          is_primary: boolean | null
          last_check_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bot_id?: number | null
          bot_name: string
          bot_token_encrypted: string
          bot_username: string
          created_at?: string
          error_message?: string | null
          id?: string
          is_primary?: boolean | null
          last_check_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bot_id?: number | null
          bot_name?: string
          bot_token_encrypted?: string
          bot_username?: string
          created_at?: string
          error_message?: string | null
          id?: string
          is_primary?: boolean | null
          last_check_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_club_members: {
        Row: {
          access_status: string
          can_dm: boolean | null
          club_id: string
          created_at: string
          id: string
          in_channel: boolean | null
          in_chat: boolean | null
          invite_error: string | null
          invite_retry_after: string | null
          invite_sent_at: string | null
          invite_status: string | null
          joined_channel_at: string | null
          joined_chat_at: string | null
          last_invite_id: string | null
          last_invite_link: string | null
          last_synced_at: string | null
          last_telegram_check_at: string | null
          last_telegram_check_result: Json | null
          last_verified_at: string | null
          link_status: string
          profile_id: string | null
          telegram_first_name: string | null
          telegram_last_name: string | null
          telegram_user_id: number
          telegram_username: string | null
          updated_at: string
          verified_in_channel_at: string | null
          verified_in_chat_at: string | null
        }
        Insert: {
          access_status?: string
          can_dm?: boolean | null
          club_id: string
          created_at?: string
          id?: string
          in_channel?: boolean | null
          in_chat?: boolean | null
          invite_error?: string | null
          invite_retry_after?: string | null
          invite_sent_at?: string | null
          invite_status?: string | null
          joined_channel_at?: string | null
          joined_chat_at?: string | null
          last_invite_id?: string | null
          last_invite_link?: string | null
          last_synced_at?: string | null
          last_telegram_check_at?: string | null
          last_telegram_check_result?: Json | null
          last_verified_at?: string | null
          link_status?: string
          profile_id?: string | null
          telegram_first_name?: string | null
          telegram_last_name?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          updated_at?: string
          verified_in_channel_at?: string | null
          verified_in_chat_at?: string | null
        }
        Update: {
          access_status?: string
          can_dm?: boolean | null
          club_id?: string
          created_at?: string
          id?: string
          in_channel?: boolean | null
          in_chat?: boolean | null
          invite_error?: string | null
          invite_retry_after?: string | null
          invite_sent_at?: string | null
          invite_status?: string | null
          joined_channel_at?: string | null
          joined_chat_at?: string | null
          last_invite_id?: string | null
          last_invite_link?: string | null
          last_synced_at?: string | null
          last_telegram_check_at?: string | null
          last_telegram_check_result?: Json | null
          last_verified_at?: string | null
          link_status?: string
          profile_id?: string | null
          telegram_first_name?: string | null
          telegram_last_name?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          updated_at?: string
          verified_in_channel_at?: string | null
          verified_in_chat_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_club_members_last_invite_id_fkey"
            columns: ["last_invite_id"]
            isOneToOne: false
            referencedRelation: "telegram_invite_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_club_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_clubs: {
        Row: {
          access_mode: string
          auto_resync_enabled: boolean | null
          auto_resync_interval_minutes: number | null
          autokick_no_access: boolean | null
          bot_id: string
          channel_id: number | null
          channel_invite_link: string | null
          channel_status: string | null
          chat_analytics_enabled: boolean | null
          chat_id: number | null
          chat_invite_link: string | null
          chat_status: string | null
          club_name: string
          created_at: string
          id: string
          is_active: boolean
          join_request_mode: boolean | null
          last_members_sync_at: string | null
          last_status_check_at: string | null
          members_count_channel: number | null
          members_count_chat: number | null
          revoke_mode: string
          subscription_duration_days: number
          updated_at: string
          violators_count: number | null
        }
        Insert: {
          access_mode?: string
          auto_resync_enabled?: boolean | null
          auto_resync_interval_minutes?: number | null
          autokick_no_access?: boolean | null
          bot_id: string
          channel_id?: number | null
          channel_invite_link?: string | null
          channel_status?: string | null
          chat_analytics_enabled?: boolean | null
          chat_id?: number | null
          chat_invite_link?: string | null
          chat_status?: string | null
          club_name: string
          created_at?: string
          id?: string
          is_active?: boolean
          join_request_mode?: boolean | null
          last_members_sync_at?: string | null
          last_status_check_at?: string | null
          members_count_channel?: number | null
          members_count_chat?: number | null
          revoke_mode?: string
          subscription_duration_days?: number
          updated_at?: string
          violators_count?: number | null
        }
        Update: {
          access_mode?: string
          auto_resync_enabled?: boolean | null
          auto_resync_interval_minutes?: number | null
          autokick_no_access?: boolean | null
          bot_id?: string
          channel_id?: number | null
          channel_invite_link?: string | null
          channel_status?: string | null
          chat_analytics_enabled?: boolean | null
          chat_id?: number | null
          chat_invite_link?: string | null
          chat_status?: string | null
          club_name?: string
          created_at?: string
          id?: string
          is_active?: boolean
          join_request_mode?: boolean | null
          last_members_sync_at?: string | null
          last_status_check_at?: string | null
          members_count_channel?: number | null
          members_count_chat?: number | null
          revoke_mode?: string
          subscription_duration_days?: number
          updated_at?: string
          violators_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_clubs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_clubs_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_invite_links: {
        Row: {
          club_id: string
          created_at: string | null
          expires_at: string
          id: string
          invite_code: string
          invite_link: string
          member_limit: number
          note: string | null
          profile_id: string
          sent_at: string | null
          source: string | null
          source_id: string | null
          status: string
          target_chat_id: number
          target_type: string
          telegram_user_id: number | null
          used_at: string | null
          used_by_telegram_user_id: number | null
        }
        Insert: {
          club_id: string
          created_at?: string | null
          expires_at: string
          id?: string
          invite_code: string
          invite_link: string
          member_limit?: number
          note?: string | null
          profile_id: string
          sent_at?: string | null
          source?: string | null
          source_id?: string | null
          status?: string
          target_chat_id: number
          target_type?: string
          telegram_user_id?: number | null
          used_at?: string | null
          used_by_telegram_user_id?: number | null
        }
        Update: {
          club_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          invite_code?: string
          invite_link?: string
          member_limit?: number
          note?: string | null
          profile_id?: string
          sent_at?: string | null
          source?: string | null
          source_id?: string | null
          status?: string
          target_chat_id?: number
          target_type?: string
          telegram_user_id?: number | null
          used_at?: string | null
          used_by_telegram_user_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_invite_links_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_invite_links_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_invites: {
        Row: {
          club_id: string
          code: string
          created_at: string
          created_by: string
          duration_days: number
          expires_at: string | null
          id: string
          is_active: boolean
          max_uses: number | null
          name: string
          updated_at: string
          uses_count: number
        }
        Insert: {
          club_id: string
          code: string
          created_at?: string
          created_by: string
          duration_days?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          name: string
          updated_at?: string
          uses_count?: number
        }
        Update: {
          club_id?: string
          code?: string
          created_at?: string
          created_by?: string
          duration_days?: number
          expires_at?: string | null
          id?: string
          is_active?: boolean
          max_uses?: number | null
          name?: string
          updated_at?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_invites_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_link_tokens: {
        Row: {
          action_type: string | null
          bot_id: string | null
          created_at: string
          expires_at: string
          id: string
          status: string | null
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          action_type?: string | null
          bot_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          status?: string | null
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          action_type?: string | null
          bot_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          status?: string | null
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_link_tokens_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_logs: {
        Row: {
          action: string
          club_id: string | null
          created_at: string
          error_message: string | null
          event_day: string | null
          event_type: string | null
          id: string
          message_text: string | null
          meta: Json | null
          status: string
          target: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          club_id?: string | null
          created_at?: string
          error_message?: string | null
          event_day?: string | null
          event_type?: string | null
          id?: string
          message_text?: string | null
          meta?: Json | null
          status: string
          target?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          club_id?: string | null
          created_at?: string
          error_message?: string | null
          event_day?: string | null
          event_type?: string | null
          id?: string
          message_text?: string | null
          meta?: Json | null
          status?: string
          target?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_logs_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_manual_access: {
        Row: {
          club_id: string
          comment: string | null
          created_at: string
          created_by_admin_id: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string
          valid_until: string | null
        }
        Insert: {
          club_id: string
          comment?: string | null
          created_at?: string
          created_by_admin_id: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id: string
          valid_until?: string | null
        }
        Update: {
          club_id?: string
          comment?: string | null
          created_at?: string
          created_by_admin_id?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_manual_access_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "telegram_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_messages: {
        Row: {
          bot_id: string | null
          created_at: string
          direction: string
          error_message: string | null
          id: string
          is_favorite: boolean | null
          is_pinned: boolean | null
          is_read: boolean | null
          message_id: number | null
          message_text: string | null
          meta: Json | null
          reply_to_message_id: number | null
          sent_by_admin: string | null
          status: string
          telegram_user_id: number
          user_id: string
        }
        Insert: {
          bot_id?: string | null
          created_at?: string
          direction: string
          error_message?: string | null
          id?: string
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          message_id?: number | null
          message_text?: string | null
          meta?: Json | null
          reply_to_message_id?: number | null
          sent_by_admin?: string | null
          status?: string
          telegram_user_id: number
          user_id: string
        }
        Update: {
          bot_id?: string | null
          created_at?: string
          direction?: string
          error_message?: string | null
          id?: string
          is_favorite?: boolean | null
          is_pinned?: boolean | null
          is_read?: boolean | null
          message_id?: number | null
          message_text?: string | null
          meta?: Json | null
          reply_to_message_id?: number | null
          sent_by_admin?: string | null
          status?: string
          telegram_user_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_messages_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_messages_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_messages_sent_by_admin_fkey"
            columns: ["sent_by_admin"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "telegram_messages_sent_by_admin_fkey"
            columns: ["sent_by_admin"]
            isOneToOne: false
            referencedRelation: "v_club_members_enriched"
            referencedColumns: ["auth_user_id"]
          },
        ]
      }
      telegram_mtproto_sessions: {
        Row: {
          api_hash: string
          api_id: string
          created_at: string
          error_message: string | null
          id: string
          last_sync_at: string | null
          phone_number: string
          session_string: string | null
          status: string
          updated_at: string
        }
        Insert: {
          api_hash: string
          api_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          phone_number: string
          session_string?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          api_hash?: string
          api_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          last_sync_at?: string | null
          phone_number?: string
          session_string?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_publish_channels: {
        Row: {
          bot_id: string | null
          channel_id: string
          channel_name: string
          channel_type: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          settings: Json | null
          updated_at: string | null
        }
        Insert: {
          bot_id?: string | null
          channel_id: string
          channel_name: string
          channel_type?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          settings?: Json | null
          updated_at?: string | null
        }
        Update: {
          bot_id?: string | null
          channel_id?: string
          channel_name?: string
          channel_type?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          settings?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_publish_channels_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_publish_channels_bot_id_fkey"
            columns: ["bot_id"]
            isOneToOne: false
            referencedRelation: "telegram_bots_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          role: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_personal: boolean
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_personal?: boolean
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_personal?: boolean
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tg_chat_messages: {
        Row: {
          chat_id: number
          club_id: string
          created_at: string
          from_display_name: string | null
          from_tg_user_id: number
          has_media: boolean | null
          id: string
          message_id: number
          message_ts: string
          raw_payload: Json | null
          reply_to_message_id: number | null
          text: string | null
        }
        Insert: {
          chat_id: number
          club_id: string
          created_at?: string
          from_display_name?: string | null
          from_tg_user_id: number
          has_media?: boolean | null
          id?: string
          message_id: number
          message_ts: string
          raw_payload?: Json | null
          reply_to_message_id?: number | null
          text?: string | null
        }
        Update: {
          chat_id?: number
          club_id?: string
          created_at?: string
          from_display_name?: string | null
          from_tg_user_id?: number
          has_media?: boolean | null
          id?: string
          message_id?: number
          message_ts?: string
          raw_payload?: Json | null
          reply_to_message_id?: number | null
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tg_chat_messages_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_daily_summaries: {
        Row: {
          action_items: Json | null
          chat_id: number
          club_id: string
          created_at: string
          date: string
          generated_at: string
          id: string
          key_topics: Json | null
          messages_count: number | null
          model_meta: Json | null
          summary_text: string | null
          support_issues: Json | null
          unique_users_count: number | null
        }
        Insert: {
          action_items?: Json | null
          chat_id: number
          club_id: string
          created_at?: string
          date: string
          generated_at?: string
          id?: string
          key_topics?: Json | null
          messages_count?: number | null
          model_meta?: Json | null
          summary_text?: string | null
          support_issues?: Json | null
          unique_users_count?: number | null
        }
        Update: {
          action_items?: Json | null
          chat_id?: number
          club_id?: string
          created_at?: string
          date?: string
          generated_at?: string
          id?: string
          key_topics?: Json | null
          messages_count?: number | null
          model_meta?: Json | null
          summary_text?: string | null
          support_issues?: Json | null
          unique_users_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tg_daily_summaries_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      tg_support_signals: {
        Row: {
          category: string | null
          club_id: string
          created_at: string
          date: string
          excerpt: string | null
          id: string
          message_id: number | null
          notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
          status: string | null
          tg_user_id: number | null
          tg_username: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          club_id: string
          created_at?: string
          date: string
          excerpt?: string | null
          id?: string
          message_id?: number | null
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          status?: string | null
          tg_user_id?: number | null
          tg_username?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          club_id?: string
          created_at?: string
          date?: string
          excerpt?: string | null
          id?: string
          message_id?: number | null
          notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
          status?: string | null
          tg_user_id?: number | null
          tg_username?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tg_support_signals_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_attachments: {
        Row: {
          created_at: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          message_id: string | null
          mime_type: string | null
          ticket_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string | null
          ticket_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string | null
          ticket_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_messages: {
        Row: {
          attachments: Json | null
          author_id: string | null
          author_name: string | null
          author_type: string
          created_at: string | null
          display_user_id: string | null
          id: string
          is_internal: boolean | null
          is_read: boolean | null
          message: string
          ticket_id: string
        }
        Insert: {
          attachments?: Json | null
          author_id?: string | null
          author_name?: string | null
          author_type: string
          created_at?: string | null
          display_user_id?: string | null
          id?: string
          is_internal?: boolean | null
          is_read?: boolean | null
          message: string
          ticket_id: string
        }
        Update: {
          attachments?: Json | null
          author_id?: string | null
          author_name?: string | null
          author_type?: string
          created_at?: string | null
          display_user_id?: string | null
          id?: string
          is_internal?: boolean | null
          is_read?: boolean | null
          message?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_telegram_sync: {
        Row: {
          created_at: string
          direction: string
          id: string
          telegram_message_id: number | null
          ticket_id: string
          ticket_message_id: string | null
        }
        Insert: {
          created_at?: string
          direction: string
          id?: string
          telegram_message_id?: number | null
          ticket_id: string
          ticket_message_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          id?: string
          telegram_message_id?: number | null
          ticket_id?: string
          ticket_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_telegram_sync_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_telegram_sync_ticket_message_id_fkey"
            columns: ["ticket_message_id"]
            isOneToOne: false
            referencedRelation: "ticket_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_training_context: {
        Row: {
          block_id: string | null
          created_at: string | null
          id: string
          lesson_id: string
          module_id: string | null
          ticket_id: string
        }
        Insert: {
          block_id?: string | null
          created_at?: string | null
          id?: string
          lesson_id: string
          module_id?: string | null
          ticket_id: string
        }
        Update: {
          block_id?: string | null
          created_at?: string | null
          id?: string
          lesson_id?: string
          module_id?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_training_context_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      training_lessons: {
        Row: {
          audio_url: string | null
          completion_mode: string | null
          content: string | null
          content_month: string | null
          content_type: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean | null
          module_id: string
          product_id: string | null
          published_at: string | null
          require_previous: boolean | null
          slug: string
          sort_order: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          audio_url?: string | null
          completion_mode?: string | null
          content?: string | null
          content_month?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          module_id: string
          product_id?: string | null
          published_at?: string | null
          require_previous?: boolean | null
          slug: string
          sort_order?: number | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          audio_url?: string | null
          completion_mode?: string | null
          content?: string | null
          content_month?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          module_id?: string
          product_id?: string | null
          published_at?: string | null
          require_previous?: boolean | null
          slug?: string
          sort_order?: number | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_lessons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      training_modules: {
        Row: {
          color_gradient: string | null
          content_month: string | null
          cover_image: string | null
          created_at: string
          description: string | null
          display_layout: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_container: boolean | null
          menu_section_key: string | null
          parent_module_id: string | null
          product_id: string | null
          public_id: string | null
          published_at: string | null
          slug: string
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          color_gradient?: string | null
          content_month?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          display_layout?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_container?: boolean | null
          menu_section_key?: string | null
          parent_module_id?: string | null
          product_id?: string | null
          public_id?: string | null
          published_at?: string | null
          slug: string
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          color_gradient?: string | null
          content_month?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          display_layout?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_container?: boolean | null
          menu_section_key?: string | null
          parent_module_id?: string | null
          product_id?: string | null
          public_id?: string | null
          published_at?: string | null
          slug?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_training_modules_menu_section"
            columns: ["menu_section_key"]
            isOneToOne: false
            referencedRelation: "user_menu_sections"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "training_modules_parent_module_id_fkey"
            columns: ["parent_module_id"]
            isOneToOne: false
            referencedRelation: "training_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_modules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_blocks: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          meta: Json | null
          product_id: string | null
          profile_id: string | null
          reason: string
          removed_at: string | null
          removed_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          meta?: Json | null
          product_id?: string | null
          profile_id?: string | null
          reason: string
          removed_at?: string | null
          removed_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          meta?: Json | null
          product_id?: string | null
          profile_id?: string | null
          reason?: string
          removed_at?: string | null
          removed_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_blocks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_blocks_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_lesson_progress: {
        Row: {
          attempts: number | null
          block_id: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          is_correct: boolean | null
          lesson_id: string
          max_score: number | null
          response: Json | null
          score: number | null
          started_at: string | null
          time_spent_seconds: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          attempts?: number | null
          block_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          lesson_id: string
          max_score?: number | null
          response?: Json | null
          score?: number | null
          started_at?: string | null
          time_spent_seconds?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          attempts?: number | null
          block_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          is_correct?: boolean | null
          lesson_id?: string
          max_score?: number | null
          response?: Json | null
          score?: number | null
          started_at?: string | null
          time_spent_seconds?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_lesson_progress_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "lesson_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "training_lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      user_menu_sections: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean | null
          key: string
          kind: string
          label: string
          page_key: string | null
          parent_key: string | null
          sort_order: number | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          key: string
          kind?: string
          label: string
          page_key?: string | null
          parent_key?: string | null
          sort_order?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          key?: string
          kind?: string
          label?: string
          page_key?: string | null
          parent_key?: string | null
          sort_order?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_roles_v2: {
        Row: {
          created_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_v2_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          event_type: string | null
          http_status: number | null
          id: string
          outcome: string
          parsed_kind: string | null
          parsed_order_id: string | null
          processing_ms: number | null
          provider: string
          subscription_id: string | null
          tracking_id: string | null
          transaction_uid: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          http_status?: number | null
          id?: string
          outcome: string
          parsed_kind?: string | null
          parsed_order_id?: string | null
          processing_ms?: number | null
          provider: string
          subscription_id?: string | null
          tracking_id?: string | null
          transaction_uid?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          http_status?: number | null
          id?: string
          outcome?: string
          parsed_kind?: string | null
          parsed_order_id?: string | null
          processing_ms?: number | null
          provider?: string
          subscription_id?: string | null
          tracking_id?: string | null
          transaction_uid?: string | null
        }
        Relationships: []
      }
      wheel_balance_tasks: {
        Row: {
          completed: boolean
          content: string
          created_at: string
          id: string
          importance_score: number
          important: boolean
          linked_eisenhower_task_id: string | null
          sphere_key: string
          updated_at: string
          urgency_score: number
          urgent: boolean
          user_id: string
        }
        Insert: {
          completed?: boolean
          content: string
          created_at?: string
          id?: string
          importance_score?: number
          important?: boolean
          linked_eisenhower_task_id?: string | null
          sphere_key: string
          updated_at?: string
          urgency_score?: number
          urgent?: boolean
          user_id: string
        }
        Update: {
          completed?: boolean
          content?: string
          created_at?: string
          id?: string
          importance_score?: number
          important?: boolean
          linked_eisenhower_task_id?: string | null
          sphere_key?: string
          updated_at?: string
          urgency_score?: number
          urgent?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wheel_balance_tasks_linked_eisenhower_task_id_fkey"
            columns: ["linked_eisenhower_task_id"]
            isOneToOne: false
            referencedRelation: "eisenhower_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      email_accounts_safe: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string | null
          from_email: string | null
          from_name: string | null
          has_password: boolean | null
          id: string | null
          imap_enabled: boolean | null
          imap_encryption: string | null
          imap_host: string | null
          imap_port: number | null
          is_active: boolean | null
          is_default: boolean | null
          last_fetched_at: string | null
          last_fetched_uid: string | null
          provider: string | null
          reply_to: string | null
          smtp_encryption: string | null
          smtp_host: string | null
          smtp_port: number | null
          smtp_username: string | null
          updated_at: string | null
          use_for: Json | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          from_email?: string | null
          from_name?: string | null
          has_password?: never
          id?: string | null
          imap_enabled?: boolean | null
          imap_encryption?: string | null
          imap_host?: string | null
          imap_port?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          last_fetched_at?: string | null
          last_fetched_uid?: string | null
          provider?: string | null
          reply_to?: string | null
          smtp_encryption?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          updated_at?: string | null
          use_for?: Json | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          from_email?: string | null
          from_name?: string | null
          has_password?: never
          id?: string | null
          imap_enabled?: boolean | null
          imap_encryption?: string | null
          imap_host?: string | null
          imap_port?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          last_fetched_at?: string | null
          last_fetched_uid?: string | null
          provider?: string | null
          reply_to?: string | null
          smtp_encryption?: string | null
          smtp_host?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          updated_at?: string | null
          use_for?: Json | null
        }
        Relationships: []
      }
      live_event_active_participants_v: {
        Row: {
          active_count: number | null
          live_event_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "live_active_sessions_live_event_id_fkey"
            columns: ["live_event_id"]
            isOneToOne: false
            referencedRelation: "live_events"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links_enriched_v: {
        Row: {
          amount: number | null
          created_at: string | null
          created_by: string | null
          creator_email: string | null
          creator_name: string | null
          currency: string | null
          current_uses: number | null
          description: string | null
          expires_at: string | null
          id: string | null
          is_exhausted: boolean | null
          is_expired: boolean | null
          is_invalid: boolean | null
          last_order_id: string | null
          max_uses: number | null
          offer_id: string | null
          offer_title: string | null
          paid_orders_count: number | null
          payment_type: string | null
          product_id: string | null
          product_name: string | null
          public_url: string | null
          recipient_email: string | null
          recipient_name: string | null
          related_orders_count: number | null
          status: string | null
          tariff_id: string | null
          tariff_name: string | null
          updated_at: string | null
          url_token: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "tariff_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions_v2_safe: {
        Row: {
          access_end_at: string | null
          access_start_at: string | null
          auto_renew: boolean | null
          auto_renew_disabled_at: string | null
          auto_renew_disabled_by: string | null
          auto_renew_disabled_by_user_id: string | null
          billing_type: string | null
          cancel_at: string | null
          cancel_reason: string | null
          canceled_at: string | null
          charge_attempts: number | null
          created_at: string | null
          flow_id: string | null
          grace_period_ends_at: string | null
          grace_period_started_at: string | null
          grace_period_status: string | null
          has_payment_token: boolean | null
          id: string | null
          is_trial: boolean | null
          keep_access_until_trial_end: boolean | null
          meta: Json | null
          next_charge_at: string | null
          order_id: string | null
          payment_method_id: string | null
          product_id: string | null
          profile_id: string | null
          status: Database["public"]["Enums"]["subscription_status"] | null
          tariff_id: string | null
          trial_canceled_at: string | null
          trial_canceled_by: string | null
          trial_end_at: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_end_at?: string | null
          access_start_at?: string | null
          auto_renew?: boolean | null
          auto_renew_disabled_at?: string | null
          auto_renew_disabled_by?: string | null
          auto_renew_disabled_by_user_id?: string | null
          billing_type?: string | null
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string | null
          flow_id?: string | null
          grace_period_ends_at?: string | null
          grace_period_started_at?: string | null
          grace_period_status?: string | null
          has_payment_token?: never
          id?: string | null
          is_trial?: boolean | null
          keep_access_until_trial_end?: boolean | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          payment_method_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"] | null
          tariff_id?: string | null
          trial_canceled_at?: string | null
          trial_canceled_by?: string | null
          trial_end_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_end_at?: string | null
          access_start_at?: string | null
          auto_renew?: boolean | null
          auto_renew_disabled_at?: string | null
          auto_renew_disabled_by?: string | null
          auto_renew_disabled_by_user_id?: string | null
          billing_type?: string | null
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string | null
          flow_id?: string | null
          grace_period_ends_at?: string | null
          grace_period_started_at?: string | null
          grace_period_status?: string | null
          has_payment_token?: never
          id?: string | null
          is_trial?: boolean | null
          keep_access_until_trial_end?: boolean | null
          meta?: Json | null
          next_charge_at?: string | null
          order_id?: string | null
          payment_method_id?: string | null
          product_id?: string | null
          profile_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"] | null
          tariff_id?: string | null
          trial_canceled_at?: string | null
          trial_canceled_by?: string | null
          trial_end_at?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_subscriptions_v2_profile"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_v2_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariffs"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bots_safe: {
        Row: {
          bot_id: number | null
          bot_name: string | null
          bot_username: string | null
          created_at: string | null
          error_message: string | null
          has_token: boolean | null
          id: string | null
          is_primary: boolean | null
          last_check_at: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          bot_id?: number | null
          bot_name?: string | null
          bot_username?: string | null
          created_at?: string | null
          error_message?: string | null
          has_token?: never
          id?: string | null
          is_primary?: boolean | null
          last_check_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          bot_id?: number | null
          bot_name?: string | null
          bot_username?: string | null
          created_at?: string | null
          error_message?: string | null
          has_token?: never
          id?: string | null
          is_primary?: boolean | null
          last_check_at?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      v_club_members_enriched: {
        Row: {
          access_status: string | null
          auth_user_id: string | null
          club_id: string | null
          created_at: string | null
          email: string | null
          external_id_amo: string | null
          full_name: string | null
          has_active_access: boolean | null
          has_any_access_history: boolean | null
          id: string | null
          in_any: boolean | null
          in_channel: boolean | null
          in_chat: boolean | null
          is_orphaned: boolean | null
          link_status: string | null
          phone: string | null
          profile_id: string | null
          telegram_first_name: string | null
          telegram_last_name: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_club_members_club_id_fkey"
            columns: ["club_id"]
            isOneToOne: false
            referencedRelation: "telegram_clubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_club_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_dedup_bepaid_subscriptions: {
        Args: { p_mode?: string }
        Returns: Json
      }
      admin_get_club_membership: {
        Args: { p_profile_id: string }
        Returns: {
          access_status: string
          club_id: string
          club_name: string
          in_channel: boolean
          in_chat: boolean
        }[]
      }
      admin_get_club_memberships_all: {
        Args: { p_profile_id: string }
        Returns: {
          club_has_channel: boolean
          club_has_chat: boolean
          club_id: string
          club_last_members_sync_at: string
          club_last_status_check_at: string
          club_name: string
          effective_access_status: string
          entitlement_expires_at: string
          entitlement_id: string
          entitlement_status: string
          in_channel: boolean
          in_chat: boolean
          invite_sent_at: string
          invite_status: string
          is_active_club: boolean
          last_telegram_check_at: string
          last_verified_at: string
          link_status: string
          linked_product_id: string
          linked_product_name: string
          member_updated_at: string
          telegram_access_status: string
        }[]
      }
      admin_get_payments_page_v1: {
        Args: {
          p_from: string
          p_limit?: number
          p_offset?: number
          p_provider?: string
          p_search?: string
          p_status?: string
          p_to: string
        }
        Returns: {
          rows: Json
          total_count: number
        }[]
      }
      admin_get_payments_stats_v1: {
        Args: { p_from: string; p_provider?: string; p_to: string }
        Returns: Json
      }
      admin_override_document_number: {
        Args: { p_document_id: string; p_new_number: string; p_reason: string }
        Returns: undefined
      }
      admin_reconcile_bepaid_legacy_subscriptions: {
        Args: {
          p_dry_run?: boolean
          p_limit?: number
          p_reconcile_run_id?: string
        }
        Returns: Json
      }
      admin_repair_card_links: {
        Args: {
          _brand: string
          _dry_run?: boolean
          _last4: string
          _target_profile_id: string
        }
        Returns: Json
      }
      admin_safe_delete_profile: {
        Args: { _dry_run?: boolean; _profile_id: string }
        Returns: Json
      }
      admin_tenants_overview: {
        Args: never
        Returns: {
          created_at: string
          individual_requisites_count: number
          is_personal: boolean
          legal_requisites_count: number
          memberships_count: number
          name: string
          owner_email: string
          owner_full_name: string
          owner_user_id: string
          system_customer_count: number
          tenant_id: string
          updated_at: string
        }[]
      }
      admin_tenants_stats: {
        Args: never
        Returns: {
          individual_system_customer: number
          legal_system_customer: number
          memberships_total: number
          tenants_total: number
          tenants_with_requisites: number
          tenants_without_requisites: number
        }[]
      }
      admin_unlinked_cards_details: {
        Args: {
          _brand: string
          _last4: string
          _limit?: number
          _offset?: number
        }
        Returns: {
          amount: number
          card_holder: string
          customer_email: string
          id: string
          paid_at: string
          source: string
          status: string
          total_count: number
          uid: string
        }[]
      }
      admin_unlinked_cards_report: {
        Args: {
          _brand?: string
          _last4?: string
          _limit?: number
          _offset?: number
        }
        Returns: {
          brand: string
          collision_risk: boolean
          last_seen_at: string
          last4: string
          payments_amount: number
          queue_amount: number
          total_amount: number
          unlinked_payments_v2_count: number
          unlinked_queue_count: number
        }[]
      }
      admin_unlock_package_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: string
      }
      align_billing_dates: {
        Args: { p_batch_size?: number }
        Returns: {
          sample_ids: string[]
          updated_count: number
        }[]
      }
      allocate_document_number: {
        Args: { p_document_id: string; p_now?: string }
        Returns: {
          document_date: string
          document_number: string
          document_seq: number
          document_timezone: string
        }[]
      }
      apply_rev_7101ed3c: { Args: { _batch_id: string }; Returns: Json }
      approve_broadcast_template: {
        Args: { _template_id: string }
        Returns: Json
      }
      backfill_card_stamps_from_queue: { Args: never; Returns: Json }
      backfill_payments_by_card: {
        Args: {
          p_card_brand: string
          p_card_last4: string
          p_dry_run?: boolean
          p_limit?: number
          p_profile_id: string
        }
        Returns: Json
      }
      backfill_payments_by_card_token: {
        Args: {
          p_dry_run?: boolean
          p_limit?: number
          p_profile_id: string
          p_provider?: string
          p_provider_token?: string
        }
        Returns: Json
      }
      ban_case_upsert_identifiers: {
        Args: { _ban_case_id: string; _identifiers: Json }
        Returns: number
      }
      can_send_reaction: {
        Args: { _event_id: string; _user_id: string }
        Returns: boolean
      }
      cascade_order_cancellation: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: Json
      }
      check_ban_by_identifiers: {
        Args: {
          _email?: string
          _phone?: string
          _tg_user_id?: number
          _tg_username?: string
        }
        Returns: {
          ban_case_id: string
          matched_kind: string
          matched_value: string
        }[]
      }
      check_payment_status_for_deal: {
        Args: { p_payment_id: string; p_payment_source: string }
        Returns: {
          error_message: string
          is_valid: boolean
          payment_status: string
        }[]
      }
      claim_media_jobs: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: {
          attempts: number
          bot_id: string
          created_at: string
          file_name: string | null
          file_type: string | null
          id: string
          last_error: string | null
          locked_at: string | null
          message_db_id: string
          status: string
          telegram_file_id: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "media_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_demo_counts: {
        Args: never
        Returns: {
          consent_logs_count: number
          pending_notifications_count: number
          profiles_count: number
          telegram_access_count: number
          telegram_access_grants_count: number
          telegram_club_members_count: number
          telegram_link_tokens_count: number
          user_roles_count: number
        }[]
      }
      cleanup_demo_delete_all: {
        Args: never
        Returns: {
          consent_logs_deleted: number
          pending_notifications_deleted: number
          profiles_deleted: number
          telegram_access_deleted: number
          telegram_access_grants_deleted: number
          telegram_club_members_deleted: number
          telegram_link_tokens_deleted: number
          user_roles_deleted: number
        }[]
      }
      cleanup_demo_entitlements: {
        Args: { p_execute?: boolean }
        Returns: {
          deleted_count: number
          sample_ids: string[]
        }[]
      }
      cleanup_demo_safeguard_check: {
        Args: never
        Returns: {
          entitlements_nonrevoked_count: number
          orders_count: number
          payments_count: number
        }[]
      }
      cleanup_telegram_corruption_fix: {
        Args: { p_execute?: boolean }
        Returns: {
          fixed_count: number
          sample_ids: string[]
        }[]
      }
      cleanup_telegram_expired_tokens: {
        Args: { p_execute?: boolean }
        Returns: {
          deleted_count: number
          sample_ids: string[]
        }[]
      }
      cleanup_telegram_orphans_delete: {
        Args: { p_execute?: boolean }
        Returns: {
          access_count: number
          access_samples: string[]
          grant_samples: string[]
          grants_count: number
        }[]
      }
      compute_club_member_final_status: {
        Args: { _club_id: string; _tg_id: number }
        Returns: {
          access_status: string
          club_id: string
          email: string
          entitlement_status: string
          final_status: Database["public"]["Enums"]["club_member_final_status"]
          full_name: string
          in_chat: boolean
          link_check: string
          manual_access: boolean
          product_id: string
          profile_id: string
          reason: string
          staff_role: string
          subscription_status: string
          telegram_chat_id: number
          telegram_username: string
          tg_id_in_chat: number
          tg_id_in_profile: number
          user_id: string
        }[]
      }
      compute_next_broadcast_run: {
        Args: { from_ts: string; rule: Json }
        Returns: string
      }
      create_feedback_ticket: {
        Args: {
          p_block_id?: string
          p_description?: string
          p_lesson_id: string
          p_module_id?: string
          p_student_user_id: string
          p_subject?: string
        }
        Returns: Json
      }
      create_position_catalog_entry: {
        Args: { p_label: string }
        Returns: string
      }
      create_support_ticket: {
        Args: { p_category?: string; p_description: string; p_subject: string }
        Returns: Json
      }
      diag_broadcast_cron_state: { Args: never; Returns: Json }
      expire_stale_entitlements: {
        Args: { p_batch_limit?: number }
        Returns: Json
      }
      expire_stale_invite_links: {
        Args: { batch_limit?: number }
        Returns: number
      }
      fill_order_from_queue: { Args: never; Returns: number }
      find_bought_not_joined_users: {
        Args: never
        Returns: {
          access_end_at: string
          access_source: string
          created_at: string
          email: string
          full_name: string
          invite_sent_at: string
          profile_id: string
          telegram_user_id: number
          user_id: string
        }[]
      }
      find_false_revoke_notifications: {
        Args: { since_timestamp: string }
        Returns: {
          access_end_at: string
          email: string
          full_name: string
          last_notification_at: string
          notification_count: number
          sub_status: string
          telegram_user_id: number
          user_id: string
        }[]
      }
      find_misaligned_subscriptions: {
        Args: { p_limit?: number }
        Returns: {
          access_end_at: string
          days_difference: number
          email: string
          full_name: string
          id: string
          next_charge_at: string
          profile_id: string
          status: string
          user_id: string
        }[]
      }
      find_profiles_for_gc_import: {
        Args: {
          p_emails: string[]
          p_gc_ids: string[]
          p_phone_keys: string[]
          p_tg_usernames: string[]
        }
        Returns: {
          birth_date: string
          city: string
          country: string
          email: string
          external_id_gc: string
          first_name: string
          full_name: string
          gc_registered_at: string
          id: string
          instagram_url: string
          last_name: string
          phone: string
          status: string
          telegram_user_id: number
          telegram_username: string
          user_id: string
        }[]
      }
      find_unlinked_payments: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          created_at: string
          has_tracking_id: boolean
          match_source: string
          origin: string
          paid_at: string
          payment_flow: string
          payment_id: string
          potential_order_id: string
          provider_payment_id: string
          tracking_id: string
        }[]
      }
      find_users_with_permission: {
        Args: { permission_code: string }
        Returns: {
          user_id: string
        }[]
      }
      find_wrongly_revoked_users: {
        Args: never
        Returns: {
          access_end_at: string
          access_source: string
          club_id: string
          club_name: string
          email: string
          full_name: string
          member_status: string
          profile_id: string
          user_id: string
        }[]
      }
      generate_order_number: { Args: never; Returns: string }
      generate_ticket_number: { Args: never; Returns: string }
      generate_ticket_number_atomic: { Args: never; Returns: string }
      get_admin_payment_links_v1: {
        Args: { p_limit?: number; p_since?: string }
        Returns: {
          amount: number | null
          created_at: string | null
          created_by: string | null
          creator_email: string | null
          creator_name: string | null
          currency: string | null
          current_uses: number | null
          description: string | null
          expires_at: string | null
          id: string | null
          is_exhausted: boolean | null
          is_expired: boolean | null
          is_invalid: boolean | null
          last_order_id: string | null
          max_uses: number | null
          offer_id: string | null
          offer_title: string | null
          paid_orders_count: number | null
          payment_type: string | null
          product_id: string | null
          product_name: string | null
          public_url: string | null
          recipient_email: string | null
          recipient_name: string | null
          related_orders_count: number | null
          status: string | null
          tariff_id: string | null
          tariff_name: string | null
          updated_at: string | null
          url_token: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "payment_links_enriched_v"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_bepaid_statement_stats: {
        Args: { from_date: string; to_date: string }
        Returns: Json
      }
      get_business_orphan_payments: {
        Args: { from_date?: string }
        Returns: {
          amount: number
          id: string
          origin: string
          paid_at: string
          payment_classification: string
          provider_payment_id: string
        }[]
      }
      get_chat_scenarios: {
        Args: never
        Returns: {
          code: string
          icon: string
          id: string
          input_hint: string
          launcher_description: string
          launcher_order: number
          launcher_title: string
          type: Database["public"]["Enums"]["prompt_type"]
        }[]
      }
      get_club_business_stats: {
        Args: { p_club_id: string; p_period_days?: number }
        Returns: Json
      }
      get_club_member_summary: { Args: { p_club_id: string }; Returns: Json }
      get_club_members_enriched: {
        Args: { p_club_id: string; p_scope?: string }
        Returns: {
          access_status: string
          auth_user_id: string
          club_id: string
          created_at: string
          email: string
          external_id_amo: string
          full_name: string
          has_active_access: boolean
          has_any_access_history: boolean
          id: string
          in_any: boolean
          in_channel: boolean
          in_chat: boolean
          is_bought_not_joined: boolean
          is_orphaned: boolean
          is_relevant: boolean
          is_unknown: boolean
          is_violator: boolean
          link_status: string
          phone: string
          profile_id: string
          telegram_first_name: string
          telegram_last_name: string
          telegram_user_id: number
          telegram_username: string
          updated_at: string
        }[]
      }
      get_contact_tab_counts: { Args: { p_search?: string }; Returns: Json }
      get_cron_runs_24h_count: {
        Args: never
        Returns: {
          failed_runs_24h: number
          succ_runs_24h: number
          total_runs_24h: number
        }[]
      }
      get_db_now: { Args: never; Returns: string }
      get_deal_requisites_status: {
        Args: { p_order_id: string }
        Returns: {
          executor_override: string
          has_required_full_name: boolean
          order_id: string
          payer_type: string
          payer_type_source: string
          requisites_status: string
          template_override: string
        }[]
      }
      get_deal_tab_counts: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_product_id?: string
          p_search?: string
        }
        Returns: Json
      }
      get_demo_profile_ids: {
        Args: never
        Returns: {
          auth_user_id: string
          email: string
          profile_id: string
        }[]
      }
      get_inbox_dialogs_v1: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          has_pending_media: boolean
          last_bot_id: string
          last_bot_name: string
          last_bot_username: string
          last_message_at: string
          last_message_id: string
          last_message_text: string
          last_message_type: string
          unread_count: number
          user_id: string
        }[]
      }
      get_instagram_dialogs_v1: {
        Args: { p_account_id: string }
        Returns: Json
      }
      get_last_broadcast_audit_proof: {
        Args: never
        Returns: {
          action: string
          actor_label: string
          actor_type: string
          actor_user_id: string
          created_at: string
          diagnostic: Json
          failed: number
          meta: Json
          sent: number
        }[]
      }
      get_live_event_scenario: {
        Args: {
          _entry_type?: string
          _filter_user_id?: string
          _filter_visibility?: string
          _live_event_id: string
        }
        Returns: {
          created_at: string
          display_name: string
          entry_id: string
          entry_text: string
          entry_type: string
          metadata: Json
          user_id: string
          visibility_scope: string
        }[]
      }
      get_my_requisites_status: {
        Args: never
        Returns: {
          has_required_full_name: boolean
          order_id: string
          payer_type: string
          requisites_status: string
        }[]
      }
      get_next_document_number: {
        Args: { p_document_type: string; p_prefix?: string }
        Returns: string
      }
      get_order_expected_paid: { Args: { p_order_id: string }; Returns: number }
      get_payment_duplicates: {
        Args: never
        Returns: {
          duplicate_count: number
          provider: string
          provider_payment_id: string
        }[]
      }
      get_payments_stats:
        | { Args: { from_date: string; to_date: string }; Returns: Json }
        | {
            Args: {
              from_date: string
              include_import?: boolean
              to_date: string
            }
            Returns: Json
          }
      get_pending_notifications_for_user: {
        Args: { p_user_id: string }
        Returns: {
          club_id: string
          created_at: string
          id: string
          notification_type: string
          payload: Json
          priority: number
        }[]
      }
      get_profiles_with_paid_orders: {
        Args: { p_limit: number; p_offset: number; p_search?: string }
        Returns: {
          avatar_url: string
          communication_style: Json
          created_at: string
          duplicate_flag: string
          email: string
          first_name: string
          full_name: string
          is_archived: boolean
          last_name: string
          last_paid_at: string
          last_seen_at: string
          loyalty_ai_summary: string
          loyalty_analyzed_messages_count: number
          loyalty_proofs: Json
          loyalty_score: number
          loyalty_status_reason: string
          loyalty_updated_at: string
          paid_orders_count: number
          phone: string
          profile_id: string
          status: string
          telegram_user_id: number
          telegram_username: string
          user_id: string
        }[]
      }
      get_profiles_with_paid_orders_count: {
        Args: { p_search?: string }
        Returns: number
      }
      get_room_participants: {
        Args: { _event_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          last_seen_at: string
          nickname_color: string
          real_name_for_staff: string
          role_in_room: string
          show_avatar: boolean
          user_id: string
        }[]
      }
      get_schema_columns: {
        Args: never
        Returns: {
          column_default: string
          column_name: string
          data_type: string
          is_nullable: string
          ordinal_position: number
          table_name: string
          udt_name: string
        }[]
      }
      get_schema_enums: {
        Args: never
        Returns: {
          enum_name: string
          enum_values: string[]
        }[]
      }
      get_schema_foreign_keys: {
        Args: never
        Returns: {
          column_name: string
          constraint_name: string
          foreign_column: string
          foreign_table: string
          on_delete: string
          on_update: string
          table_name: string
        }[]
      }
      get_schema_indexes: {
        Args: never
        Returns: {
          indexdef: string
          indexname: string
          tablename: string
        }[]
      }
      get_schema_policies: {
        Args: never
        Returns: {
          cmd: string
          permissive: string
          policyname: string
          qual: string
          roles: string[]
          tablename: string
          with_check: string
        }[]
      }
      get_schema_primary_keys: {
        Args: never
        Returns: {
          column_name: string
          table_name: string
        }[]
      }
      get_schema_rls_tables: {
        Args: never
        Returns: {
          rowsecurity: boolean
          tablename: string
        }[]
      }
      get_schema_unique_constraints: {
        Args: never
        Returns: {
          column_names: string[]
          constraint_name: string
          table_name: string
        }[]
      }
      get_section_access_catalog: {
        Args: { p_section_code: string }
        Returns: Json
      }
      get_user_document_package_ids: {
        Args: never
        Returns: {
          full_access: boolean
          package_ids: string[]
        }[]
      }
      get_user_permissions: { Args: { _user_id: string }; Returns: string[] }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_section_access: {
        Args: { p_user_id?: string }
        Returns: {
          granted_via_product_id: string
          granted_via_product_name: string
          granted_via_tariff_id: string
          granted_via_tariff_name: string
          has_access: boolean
          is_active: boolean
          is_public: boolean
          section_code: string
          section_id: string
          section_label: string
          section_route: string
        }[]
      }
      has_any_role: {
        Args: {
          p_roles: Database["public"]["Enums"]["app_role"][]
          p_user_id: string
        }
        Returns: boolean
      }
      has_month_purchase: {
        Args: { _month: string; _tariff_id: string; _user_id: string }
        Returns: boolean
      }
      has_month_purchase_bulk: {
        Args: { _items: Json; _user_id: string }
        Returns: {
          has_purchase: boolean
          lesson_id: string
        }[]
      }
      has_permission: {
        Args: { _permission_code: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_role_v2: {
        Args: { _role_code: string; _user_id: string }
        Returns: boolean
      }
      has_valid_access_for_club: {
        Args: { p_club_id: string; p_user_id: string }
        Returns: boolean
      }
      instagram_outbox_pull_v1: {
        Args: { p_account_id: string; p_limit: number; p_lock_id: string }
        Returns: {
          created_at: string
          delivered_at: string | null
          direction: string
          error_message: string | null
          external_message_id: string | null
          id: string
          idempotency_hash: string | null
          ig_thread_id: string | null
          instagram_account_id: string
          is_read: boolean
          media_type: string | null
          media_url: string | null
          message_text: string | null
          peer_id: string
          provider_kind: string
          provider_message_id: string | null
          raw_payload: Json | null
          read_at: string | null
          recipient_id: string | null
          sender_id: string
          sender_name: string | null
          sending_at: string | null
          sending_lock_id: string | null
          sent_at: string | null
          sent_by_admin: string | null
          status: string
          thread_key: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "instagram_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      inv20_paid_orders_actionable: {
        Args: { p_limit?: number; p_since?: string }
        Returns: Json
      }
      inv20_paid_orders_without_payments: {
        Args: { p_limit?: number; p_since?: string }
        Returns: {
          count_total: number
          samples: Json
          suppressed_count: number
        }[]
      }
      inv22_subscription_desync: { Args: { p_limit?: number }; Returns: Json }
      is_live_event_presenter: {
        Args: { _live_event_id: string; _user_id: string }
        Returns: boolean
      }
      is_room_staff: { Args: { _user_id: string }; Returns: boolean }
      is_staff_reserved_color: { Args: { _color: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_superadmin: { Args: { check_user_id: string }; Returns: boolean }
      is_user_muted_in_room: {
        Args: { _live_event_id: string; _user_id: string }
        Returns: boolean
      }
      is_user_removed_from_room: {
        Args: { _live_event_id: string; _user_id: string }
        Returns: boolean
      }
      is_verified_club_member: {
        Args: { _club_id: string; _tg_id: number }
        Returns: boolean
      }
      log_document_package_event: {
        Args: { _action: string; _meta?: Json; _package_id: string }
        Returns: string
      }
      log_training_event: {
        Args: { _action: string; _meta?: Json; _target_user_id: string }
        Returns: string
      }
      manage_news_cron: {
        Args: {
          p_afternoon_utc_hour: number
          p_enabled: boolean
          p_monitor_url: string
          p_morning_utc_hour: number
          p_service_key: string
        }
        Returns: undefined
      }
      next_public_id: { Args: { p_entity_type: string }; Returns: string }
      norm_email: { Args: { _val: string }; Returns: string }
      norm_phone: { Args: { _val: string }; Returns: string }
      norm_tg_username: { Args: { _val: string }; Returns: string }
      normalize_card_brand: { Args: { _brand: string }; Returns: string }
      offer_archive: { Args: { p_offer_id: string }; Returns: Json }
      offer_delete_safety_check: { Args: { p_offer_id: string }; Returns: Json }
      offer_hard_delete: { Args: { p_offer_id: string }; Returns: Json }
      package_template_bind_template: {
        Args: {
          _package_template_id: string
          _sort_order?: number
          _template_id: string
        }
        Returns: string
      }
      package_template_unbind_template: {
        Args: { _package_template_id?: string; _template_id: string }
        Returns: number
      }
      products_bulk_delete_dryrun: {
        Args: { product_ids: string[] }
        Returns: {
          can_delete: boolean
          product_id: string
          reasons: string[]
        }[]
      }
      products_bulk_delete_execute: {
        Args: { actor_label?: string; product_ids: string[] }
        Returns: Json
      }
      queue_telegram_notification: {
        Args: {
          p_club_id?: string
          p_notification_type: string
          p_payload?: Json
          p_priority?: number
          p_user_id: string
        }
        Returns: string
      }
      receipt_backfill_candidates: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_cutoff?: string
          p_limit?: number
          p_origin?: string
        }
        Returns: {
          created_at: string
          id: string
          meta: Json
          provider_payment_id: string
          receipt_url: string
        }[]
      }
      record_refund_atomic: {
        Args: {
          p_actor_user_id: string
          p_bepaid_response: Json
          p_order_id: string
          p_parent_payment_id: string
          p_refund_amount: number
          p_refund_reason: string
          p_refund_uid: string
          p_target_user_id: string
        }
        Returns: Json
      }
      release_backfill_lock: { Args: { p_lock_id: number }; Returns: boolean }
      resolve_broadcast_audience: { Args: { _filters: Json }; Returns: Json }
      resolve_broadcast_audience_contacts: {
        Args: { _filters: Json }
        Returns: {
          email: string
          email_normalized: string
          full_name: string
          has_account: boolean
          has_telegram: boolean
          is_archived: boolean
          profile_id: string
          telegram_username: string
          user_id: string
        }[]
      }
      resolve_broadcast_audience_contacts_system: {
        Args: { _filters: Json }
        Returns: {
          email: string
          email_normalized: string
          full_name: string
          has_account: boolean
          has_telegram: boolean
          is_archived: boolean
          profile_id: string
          telegram_username: string
          user_id: string
        }[]
      }
      resolve_broadcast_audience_user_ids: {
        Args: { _filters: Json }
        Returns: {
          has_email: boolean
          has_telegram: boolean
          user_id: string
        }[]
      }
      resolve_broadcast_audience_user_ids_system: {
        Args: { _filters: Json }
        Returns: {
          has_email: boolean
          has_telegram: boolean
          user_id: string
        }[]
      }
      resolve_user_id: {
        Args: { input_id: string }
        Returns: {
          auth_user_id: string
          profile_id: string
          resolved_from: string
        }[]
      }
      rpc_find_wrongly_revoked: {
        Args: never
        Returns: {
          access_status: string
          full_name: string
          has_entitlement: boolean
          has_manual_access: boolean
          has_subscription: boolean
          member_id: string
          profile_id: string
          telegram_user_id: number
          user_id: string
        }[]
      }
      safe_delete_document_package: {
        Args: { _package_id: string }
        Returns: Json
      }
      search_club_members_enriched: {
        Args: { p_club_id: string; p_scope?: string; p_search: string }
        Returns: {
          access_status: string
          auth_user_id: string
          club_id: string
          created_at: string
          email: string
          external_id_amo: string
          full_name: string
          has_active_access: boolean
          has_any_access_history: boolean
          id: string
          in_any: boolean
          in_channel: boolean
          in_chat: boolean
          is_bought_not_joined: boolean
          is_orphaned: boolean
          is_relevant: boolean
          is_unknown: boolean
          is_violator: boolean
          link_status: string
          phone: string
          profile_id: string
          telegram_first_name: string
          telegram_last_name: string
          telegram_user_id: number
          telegram_username: string
          updated_at: string
        }[]
      }
      search_deal_rows: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_preset?: string
          p_product_id?: string
          p_search?: string
        }
        Returns: {
          created_at: string
          currency: string
          customer_email: string
          customer_phone: string
          deal_date: string
          discount_percent: number
          final_price: number
          id: string
          is_trial: boolean
          latest_payment_card_holder: string
          latest_payment_id: string
          latest_payment_meta: Json
          latest_payment_paid_at: string
          latest_payment_status: string
          meta: Json
          order_number: string
          pipeline_id: string
          product_code: string
          product_id: string
          product_name: string
          profile_avatar_url: string
          profile_email: string
          profile_full_name: string
          profile_id: string
          profile_phone: string
          profile_user_id: string
          purchase_snapshot: Json
          reconcile_source: string
          status: string
          tariff_id: string
          tariff_name: string
          trial_end_at: string
          user_id: string
        }[]
      }
      search_global: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: Json
      }
      set_default_individual_requisites: {
        Args: { p_id: string }
        Returns: Json
      }
      set_default_legal_entity_requisites: {
        Args: { p_id: string }
        Returns: Json
      }
      set_site_home_page: {
        Args: { p_domain: string; p_page_id: string }
        Returns: undefined
      }
      subscription_has_payment_token: {
        Args: { p_subscription_id: string }
        Returns: boolean
      }
      tariff_archive: { Args: { p_tariff_id: string }; Returns: Json }
      tariff_delete_safety_check: {
        Args: { p_tariff_id: string }
        Returns: Json
      }
      tariff_hard_delete: { Args: { p_tariff_id: string }; Returns: Json }
      trigger_card_verification: { Args: never; Returns: undefined }
      try_backfill_lock: { Args: { p_lock_id: number }; Returns: boolean }
      unlock_stuck_media_jobs: {
        Args: { stuck_seconds?: number }
        Returns: number
      }
      user_can_see_document_package: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      user_has_access_to_rule: {
        Args: { p_rule_id: string; p_user: string }
        Returns: boolean
      }
      user_has_live_event_access: {
        Args: { _live_event_id: string; _user_id: string }
        Returns: boolean
      }
      user_tenant_ids: { Args: { _user_id: string }; Returns: string[] }
      validate_club_product_linkage: {
        Args: {
          p_club_id: string
          p_product_id?: string
          p_subscription_id?: string
        }
        Returns: {
          reason: string
          resolved_club_id: string
          resolved_product_id: string
          valid: boolean
        }[]
      }
    }
    Enums: {
      app_role: "user" | "admin" | "superadmin"
      club_member_final_status:
        | "verified_paid"
        | "verified_staff"
        | "pending_review"
        | "no_valid_access"
        | "mismatch"
        | "duplicate_tg"
        | "orphan"
        | "removed"
      field_data_type:
        | "string"
        | "number"
        | "boolean"
        | "date"
        | "datetime"
        | "money"
        | "enum"
        | "json"
        | "email"
        | "phone"
      field_entity_type:
        | "client"
        | "order"
        | "subscription"
        | "product"
        | "tariff"
        | "payment"
        | "company"
        | "telegram_member"
        | "custom"
      order_status:
        | "draft"
        | "pending"
        | "paid"
        | "partial"
        | "failed"
        | "refunded"
        | "canceled"
        | "needs_mapping"
      payment_plan_type: "full" | "installment" | "bank_installment" | "trial"
      payment_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "refunded"
        | "canceled"
      pricing_stage_type:
        | "early_bird"
        | "stage1"
        | "stage2"
        | "stage3"
        | "regular"
      prompt_type:
        | "chat"
        | "file_analysis"
        | "document_review"
        | "text_transform"
      subscription_status:
        | "active"
        | "trial"
        | "past_due"
        | "canceled"
        | "expired"
        | "superseded"
        | "expired_reentry"
      subscription_tier: "free" | "pro" | "premium" | "webinar"
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
    Enums: {
      app_role: ["user", "admin", "superadmin"],
      club_member_final_status: [
        "verified_paid",
        "verified_staff",
        "pending_review",
        "no_valid_access",
        "mismatch",
        "duplicate_tg",
        "orphan",
        "removed",
      ],
      field_data_type: [
        "string",
        "number",
        "boolean",
        "date",
        "datetime",
        "money",
        "enum",
        "json",
        "email",
        "phone",
      ],
      field_entity_type: [
        "client",
        "order",
        "subscription",
        "product",
        "tariff",
        "payment",
        "company",
        "telegram_member",
        "custom",
      ],
      order_status: [
        "draft",
        "pending",
        "paid",
        "partial",
        "failed",
        "refunded",
        "canceled",
        "needs_mapping",
      ],
      payment_plan_type: ["full", "installment", "bank_installment", "trial"],
      payment_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "refunded",
        "canceled",
      ],
      pricing_stage_type: [
        "early_bird",
        "stage1",
        "stage2",
        "stage3",
        "regular",
      ],
      prompt_type: [
        "chat",
        "file_analysis",
        "document_review",
        "text_transform",
      ],
      subscription_status: [
        "active",
        "trial",
        "past_due",
        "canceled",
        "expired",
        "superseded",
        "expired_reentry",
      ],
      subscription_tier: ["free", "pro", "premium", "webinar"],
    },
  },
} as const

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
      card_profile_links: {
        Row: {
          card_brand: string | null
          card_holder: string | null
          card_last4: string
          created_at: string | null
          id: string
          profile_id: string
          updated_at: string | null
        }
        Insert: {
          card_brand?: string | null
          card_holder?: string | null
          card_last4: string
          created_at?: string | null
          id?: string
          profile_id: string
          updated_at?: string | null
        }
        Update: {
          card_brand?: string | null
          card_holder?: string | null
          card_last4?: string
          created_at?: string | null
          id?: string
          profile_id?: string
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
          ent_name: string | null
          ent_unp: string | null
          id: string
          ind_address_apartment: string | null
          ind_address_city: string | null
          ind_address_district: string | null
          ind_address_house: string | null
          ind_address_index: string | null
          ind_address_region: string | null
          ind_address_street: string | null
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
          leg_director_name: string | null
          leg_director_position: string | null
          leg_name: string | null
          leg_org_form: string | null
          leg_unp: string | null
          phone: string | null
          profile_id: string
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
          ent_name?: string | null
          ent_unp?: string | null
          id?: string
          ind_address_apartment?: string | null
          ind_address_city?: string | null
          ind_address_district?: string | null
          ind_address_house?: string | null
          ind_address_index?: string | null
          ind_address_region?: string | null
          ind_address_street?: string | null
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
          leg_director_name?: string | null
          leg_director_position?: string | null
          leg_name?: string | null
          leg_org_form?: string | null
          leg_unp?: string | null
          phone?: string | null
          profile_id: string
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
          ent_name?: string | null
          ent_unp?: string | null
          id?: string
          ind_address_apartment?: string | null
          ind_address_city?: string | null
          ind_address_district?: string | null
          ind_address_house?: string | null
          ind_address_index?: string | null
          ind_address_region?: string | null
          ind_address_street?: string | null
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
          leg_director_name?: string | null
          leg_director_position?: string | null
          leg_name?: string | null
          leg_org_form?: string | null
          leg_unp?: string | null
          phone?: string | null
          profile_id?: string
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
      course_preregistrations: {
        Row: {
          consent: boolean
          created_at: string
          email: string
          id: string
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
      document_templates: {
        Row: {
          code: string
          created_at: string
          description: string | null
          document_type: string
          id: string
          is_active: boolean | null
          name: string
          placeholders: Json | null
          template_path: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          document_type?: string
          id?: string
          is_active?: boolean | null
          name: string
          placeholders?: Json | null
          template_path: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          document_type?: string
          id?: string
          is_active?: boolean | null
          name?: string
          placeholders?: Json | null
          template_path?: string
          updated_at?: string
        }
        Relationships: []
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
          profile_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
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
          created_at: string
          error_message: string | null
          id: string
          is_default: boolean
          last_check_at: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          alias: string
          category: string
          config?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_default?: boolean
          last_check_at?: string | null
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          alias?: string
          category?: string
          config?: Json | null
          created_at?: string
          error_message?: string | null
          id?: string
          is_default?: boolean
          last_check_at?: string | null
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
          pricing_stage_id: string | null
          product_id: string | null
          profile_id: string | null
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
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
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
          pricing_stage_id?: string | null
          product_id?: string | null
          profile_id?: string | null
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
          status: string
          updated_at: string
          user_id: string
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
          status?: string
          updated_at?: string
          user_id: string
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
          status?: string
          updated_at?: string
          user_id?: string
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
          fee_amount: number | null
          fee_percent: number | null
          fraud_result: string | null
          has_conflict: boolean | null
          id: string
          ip_address: string | null
          is_external: boolean | null
          is_fee: boolean | null
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
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
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
          fee_amount?: number | null
          fee_percent?: number | null
          fraud_result?: string | null
          has_conflict?: boolean | null
          id?: string
          ip_address?: string | null
          is_external?: boolean | null
          is_fee?: boolean | null
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
      payments_v2: {
        Row: {
          amount: number
          card_brand: string | null
          card_last4: string | null
          created_at: string
          currency: string
          error_message: string | null
          id: string
          installment_number: number | null
          is_recurring: boolean | null
          meta: Json | null
          order_id: string
          paid_at: string | null
          payment_token: string | null
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
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          card_brand?: string | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          id?: string
          installment_number?: number | null
          is_recurring?: boolean | null
          meta?: Json | null
          order_id: string
          paid_at?: string | null
          payment_token?: string | null
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
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          card_brand?: string | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          id?: string
          installment_number?: number | null
          is_recurring?: boolean | null
          meta?: Json | null
          order_id?: string
          paid_at?: string | null
          payment_token?: string | null
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
          updated_at?: string
          user_id?: string
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
            referencedRelation: "products"
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
            foreignKeyName: "product_email_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
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
          code: string
          created_at: string
          currency: string
          description: string | null
          id: string
          is_active: boolean
          landing_config: Json | null
          meta: Json | null
          name: string
          payment_disclaimer_text: string | null
          primary_domain: string | null
          public_subtitle: string | null
          public_title: string | null
          slug: string | null
          status: string
          telegram_club_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          landing_config?: Json | null
          meta?: Json | null
          name: string
          payment_disclaimer_text?: string | null
          primary_domain?: string | null
          public_subtitle?: string | null
          public_title?: string | null
          slug?: string | null
          status?: string
          telegram_club_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          landing_config?: Json | null
          meta?: Json | null
          name?: string
          payment_disclaimer_text?: string | null
          primary_domain?: string | null
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
          card_holder_names: Json | null
          card_masks: Json | null
          club_exit_at: string | null
          club_exit_reason: string | null
          consent_given_at: string | null
          consent_version: string | null
          created_at: string
          duplicate_flag: string | null
          duplicate_group_id: string | null
          email: string | null
          emails: Json | null
          external_id_amo: string | null
          external_id_gc: string | null
          first_name: string | null
          full_name: string | null
          id: string
          import_batch_id: string | null
          is_archived: boolean | null
          last_name: string | null
          last_seen_at: string | null
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
          source: string | null
          status: string
          telegram_last_check_at: string | null
          telegram_last_error: string | null
          telegram_link_bot_id: string | null
          telegram_link_status: string | null
          telegram_linked_at: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string | null
          was_club_member: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          card_holder_names?: Json | null
          card_masks?: Json | null
          club_exit_at?: string | null
          club_exit_reason?: string | null
          consent_given_at?: string | null
          consent_version?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          emails?: Json | null
          external_id_amo?: string | null
          external_id_gc?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_batch_id?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_seen_at?: string | null
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
          source?: string | null
          status?: string
          telegram_last_check_at?: string | null
          telegram_last_error?: string | null
          telegram_link_bot_id?: string | null
          telegram_link_status?: string | null
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string | null
          was_club_member?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          card_holder_names?: Json | null
          card_masks?: Json | null
          club_exit_at?: string | null
          club_exit_reason?: string | null
          consent_given_at?: string | null
          consent_version?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          emails?: Json | null
          external_id_amo?: string | null
          external_id_gc?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          import_batch_id?: string | null
          is_archived?: boolean | null
          last_name?: string | null
          last_seen_at?: string | null
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
          source?: string | null
          status?: string
          telegram_last_check_at?: string | null
          telegram_last_error?: string | null
          telegram_link_bot_id?: string | null
          telegram_link_status?: string | null
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
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
        ]
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
          cancel_at: string | null
          cancel_reason: string | null
          canceled_at: string | null
          charge_attempts: number | null
          created_at: string
          flow_id: string | null
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
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string
          flow_id?: string | null
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
          cancel_at?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          charge_attempts?: number | null
          created_at?: string
          flow_id?: string | null
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
          joined_channel_at: string | null
          joined_chat_at: string | null
          last_synced_at: string | null
          last_telegram_check_at: string | null
          last_telegram_check_result: Json | null
          link_status: string
          profile_id: string | null
          telegram_first_name: string | null
          telegram_last_name: string | null
          telegram_user_id: number
          telegram_username: string | null
          updated_at: string
        }
        Insert: {
          access_status?: string
          can_dm?: boolean | null
          club_id: string
          created_at?: string
          id?: string
          in_channel?: boolean | null
          in_chat?: boolean | null
          joined_channel_at?: string | null
          joined_chat_at?: string | null
          last_synced_at?: string | null
          last_telegram_check_at?: string | null
          last_telegram_check_result?: Json | null
          link_status?: string
          profile_id?: string | null
          telegram_first_name?: string | null
          telegram_last_name?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          updated_at?: string
        }
        Update: {
          access_status?: string
          can_dm?: boolean | null
          club_id?: string
          created_at?: string
          id?: string
          in_channel?: boolean | null
          in_chat?: boolean | null
          joined_channel_at?: string | null
          joined_chat_at?: string | null
          last_synced_at?: string | null
          last_telegram_check_at?: string | null
          last_telegram_check_result?: Json | null
          link_status?: string
          profile_id?: string | null
          telegram_first_name?: string | null
          telegram_last_name?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          updated_at?: string
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
        ]
      }
      telegram_logs: {
        Row: {
          action: string
          club_id: string | null
          created_at: string
          error_message: string | null
          id: string
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
          id?: string
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
          id?: string
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
      training_lessons: {
        Row: {
          audio_url: string | null
          content: string | null
          content_type: string
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_active: boolean | null
          module_id: string
          slug: string
          sort_order: number | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          audio_url?: string | null
          content?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          module_id: string
          slug: string
          sort_order?: number | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          audio_url?: string | null
          content?: string | null
          content_type?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_active?: boolean | null
          module_id?: string
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
        ]
      }
      training_modules: {
        Row: {
          color_gradient: string | null
          cover_image: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          product_id: string | null
          slug: string
          sort_order: number | null
          title: string
          updated_at: string
        }
        Insert: {
          color_gradient?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          product_id?: string | null
          slug: string
          sort_order?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          color_gradient?: string | null
          cover_image?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          product_id?: string | null
          slug?: string
          sort_order?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_modules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_v2"
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
      [_ in never]: never
    }
    Functions: {
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
      generate_order_number: { Args: never; Returns: string }
      get_demo_profile_ids: {
        Args: never
        Returns: {
          auth_user_id: string
          email: string
          profile_id: string
        }[]
      }
      get_next_document_number: {
        Args: { p_document_type: string; p_prefix?: string }
        Returns: string
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
      get_user_permissions: { Args: { _user_id: string }; Returns: string[] }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
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
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_superadmin: { Args: { check_user_id: string }; Returns: boolean }
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
      resolve_user_id: {
        Args: { input_id: string }
        Returns: {
          auth_user_id: string
          profile_id: string
          resolved_from: string
        }[]
      }
      search_global: {
        Args: { p_limit?: number; p_offset?: number; p_query: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "user" | "admin" | "superadmin"
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
      subscription_status:
        | "active"
        | "trial"
        | "past_due"
        | "canceled"
        | "expired"
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
      subscription_status: [
        "active",
        "trial",
        "past_due",
        "canceled",
        "expired",
      ],
      subscription_tier: ["free", "pro", "premium", "webinar"],
    },
  },
} as const

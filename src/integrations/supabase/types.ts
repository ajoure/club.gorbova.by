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
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string
          created_at: string
          id: string
          meta: Json | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_user_id: string
          created_at?: string
          id?: string
          meta?: Json | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string
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
      duplicate_cases: {
        Row: {
          created_at: string | null
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
          is_active: boolean | null
          is_default: boolean | null
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
          is_active?: boolean | null
          is_default?: boolean | null
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
          is_active?: boolean | null
          is_default?: boolean | null
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
      entitlements: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          meta: Json | null
          product_code: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          meta?: Json | null
          product_code: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          meta?: Json | null
          product_code?: string
          status?: string
          updated_at?: string
          user_id?: string
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
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          duplicate_flag: string | null
          duplicate_group_id: string | null
          email: string | null
          full_name: string | null
          id: string
          is_archived: boolean | null
          last_seen_at: string | null
          merged_to_profile_id: string | null
          phone: string | null
          primary_in_group: boolean | null
          status: string
          telegram_linked_at: string | null
          telegram_user_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_archived?: boolean | null
          last_seen_at?: string | null
          merged_to_profile_id?: string | null
          phone?: string | null
          primary_in_group?: boolean | null
          status?: string
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          duplicate_flag?: string | null
          duplicate_group_id?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_archived?: boolean | null
          last_seen_at?: string | null
          merged_to_profile_id?: string | null
          phone?: string | null
          primary_in_group?: boolean | null
          status?: string
          telegram_linked_at?: string | null
          telegram_user_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
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
          created_at: string
          expires_at: string
          id: string
          token: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
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
    }
    Enums: {
      app_role: "user" | "admin" | "superadmin"
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
      subscription_tier: ["free", "pro", "premium", "webinar"],
    },
  },
} as const

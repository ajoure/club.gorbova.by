import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';
import type { Database, Json } from './types';

// These contracts are shipped with the managed migration. Lovable regenerates
// types.ts against the pre-migration database during GitHub synchronization,
// so keep the additive RPC contracts outside that generated file.
type OperationalFunctions = {
      list_operational_telegram_bots: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; bot_name: string; bot_username: string; bot_id: number | null; status: string; is_primary: boolean | null; last_check_at: string | null; error_message: string | null; created_at: string; updated_at: string }[]
      }
      list_operational_email_accounts: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; email: string; display_name: string | null; provider: string; is_default: boolean | null; is_active: boolean | null; imap_enabled: boolean | null; created_at: string | null }[]
      }
      list_operational_integrations: {
        Args: Record<PropertyKey, never>
        Returns: { id: string; alias: string; category: string; provider: string; status: string; is_default: boolean; config: Json }[]
      }
      list_operational_acquiring_connections: {
        Args: Record<PropertyKey, never>
        Returns: { account_code: string; account_name: string; provider: string; test_mode: boolean; is_default: boolean; status: string; capabilities_snapshot: Json }[]
      }

};
type OperationalDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & OperationalFunctions;
  };
};

// Same authenticated client, session and transport. This is a type extension;
// it neither changes privileges nor falls back to raw configuration tables.
export const operationalSupabase = supabase as unknown as SupabaseClient<OperationalDatabase>;

export interface EmailAccount {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_encryption: string | null;
  smtp_username: string | null;
  has_password: boolean;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  is_default: boolean;
  is_active: boolean;
  use_for: string[];
  created_at: string;
  imap_host: string | null;
  imap_port: number | null;
  imap_encryption: string | null;
  imap_enabled: boolean;
  last_fetched_at: string | null;
}

export interface EmailAccountSaveInput {
  id?: string;
  email: string;
  display_name?: string | null;
  provider?: string;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_encryption?: string | null;
  smtp_username?: string | null;
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  is_default?: boolean;
  is_active?: boolean;
  use_for?: string[];
  imap_host?: string | null;
  imap_port?: number | null;
  imap_encryption?: string | null;
  imap_enabled?: boolean;
}

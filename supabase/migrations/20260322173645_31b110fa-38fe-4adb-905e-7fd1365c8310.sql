ALTER TABLE client_legal_details
  ADD COLUMN IF NOT EXISTS grp_registration_date text,
  ADD COLUMN IF NOT EXISTS grp_tax_office_code text,
  ADD COLUMN IF NOT EXISTS grp_tax_office_name text,
  ADD COLUMN IF NOT EXISTS grp_status_code text,
  ADD COLUMN IF NOT EXISTS grp_status_name text,
  ADD COLUMN IF NOT EXISTS grp_short_name text,
  ADD COLUMN IF NOT EXISTS grp_liquidation_date text,
  ADD COLUMN IF NOT EXISTS grp_liquidation_reason text,
  ADD COLUMN IF NOT EXISTS grp_last_fetched_at timestamptz;
ALTER TABLE public.legal_details_persons
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_name    text,
  ADD COLUMN IF NOT EXISTS bank_code    text;

COMMENT ON COLUMN public.legal_details_persons.bank_account IS 'Sprint 3E: расчётный счёт / IBAN физлица для пакетных документов';
COMMENT ON COLUMN public.legal_details_persons.bank_name    IS 'Sprint 3E: название банка физлица';
COMMENT ON COLUMN public.legal_details_persons.bank_code    IS 'Sprint 3E: БИК / код банка физлица';
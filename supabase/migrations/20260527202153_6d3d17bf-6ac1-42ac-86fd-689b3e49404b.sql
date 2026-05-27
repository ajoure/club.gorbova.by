
BEGIN;

-- =====================================================================
-- 2.0 PRE-REQ: усиление fields_registry — UNIQUE на public_id для FK target
-- Текущий частичный unique index не пригоден как FK target.
-- Проверено: 368/368 строк имеют public_id, NULL'ов нет.
-- =====================================================================
ALTER TABLE public.fields_registry ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE public.fields_registry ADD CONSTRAINT fields_registry_public_id_unique UNIQUE (public_id);

-- =====================================================================
-- 2.1 Новая таблица document_package_token_aliases
-- =====================================================================
CREATE TABLE public.document_package_token_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_token text NOT NULL,
  canonical_field_public_id text NULL,
  role_key text NOT NULL,
  context_kind text NOT NULL,
  source_path text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dpta_context_kind_chk
    CHECK (context_kind IN ('package_person','package_metadata')),
  CONSTRAINT dpta_consistency_chk CHECK (
    (context_kind = 'package_person'
       AND canonical_field_public_id IS NOT NULL
       AND source_path IS NULL)
    OR
    (context_kind = 'package_metadata'
       AND canonical_field_public_id IS NOT NULL
       AND source_path IS NOT NULL)
  ),
  CONSTRAINT dpta_canonical_fk FOREIGN KEY (canonical_field_public_id)
    REFERENCES public.fields_registry(public_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX document_package_token_aliases_alias_token_active_uidx
  ON public.document_package_token_aliases(alias_token)
  WHERE archived_at IS NULL;

GRANT ALL ON public.document_package_token_aliases TO service_role;

ALTER TABLE public.document_package_token_aliases ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER document_package_token_aliases_set_updated_at
BEFORE UPDATE ON public.document_package_token_aliases
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- 2.2 Два canonical FLD для legal_details_persons
-- =====================================================================
SELECT pg_advisory_xact_lock(hashtext('fields_registry.public_id_seq'));

WITH next_ids AS (
  SELECT
    'FLD-' || lpad(((COALESCE(
      (SELECT MAX(substring(public_id from 5)::int) FROM fields_registry WHERE public_id ~ '^FLD-[0-9]{6}$'),
      0))+1)::text, 6, '0') AS id1,
    'FLD-' || lpad(((COALESCE(
      (SELECT MAX(substring(public_id from 5)::int) FROM fields_registry WHERE public_id ~ '^FLD-[0-9]{6}$'),
      0))+2)::text, 6, '0') AS id2
)
INSERT INTO public.fields_registry (public_id, key, label, entity_type, data_type)
SELECT id1, 'legal_details_persons.full_name', 'ФИО физлица (справочник)', 'person', 'string' FROM next_ids
UNION ALL
SELECT id2, 'legal_details_persons.position',  'Должность физлица (справочник)', 'person', 'string' FROM next_ids;

-- =====================================================================
-- 2.3 Четыре alias rows
-- =====================================================================
WITH fld AS (
  SELECT
    (SELECT public_id FROM fields_registry WHERE key='legal_details_persons.full_name') AS pid_name,
    (SELECT public_id FROM fields_registry WHERE key='legal_details_persons.position')  AS pid_pos
)
INSERT INTO public.document_package_token_aliases
  (alias_token, canonical_field_public_id, role_key, context_kind, source_path, metadata)
SELECT 'package.roles.company_head.full_name',       pid_name, 'company_head',       'package_person',   NULL,
       jsonb_build_object('source_table','legal_details_persons','source_column','full_name') FROM fld
UNION ALL
SELECT 'package.roles.company_head.position',        pid_pos,  'company_head',       'package_metadata', 'metadata.position',
       jsonb_build_object('source_table','document_package_session_participants','source_json_path','metadata.position') FROM fld
UNION ALL
SELECT 'package.roles.responsible_person.full_name', pid_name, 'responsible_person', 'package_person',   NULL,
       jsonb_build_object('source_table','legal_details_persons','source_column','full_name') FROM fld
UNION ALL
SELECT 'package.roles.responsible_person.position',  pid_pos,  'responsible_person', 'package_metadata', 'metadata.position',
       jsonb_build_object('source_table','document_package_session_participants','source_json_path','metadata.position') FROM fld;

COMMIT;

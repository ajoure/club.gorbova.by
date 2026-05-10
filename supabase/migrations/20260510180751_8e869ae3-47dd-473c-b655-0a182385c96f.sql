-- Stage E execute (variant B) — add-only fields_registry update + audit
-- Single transaction; STOP-guards enforce variant-B counts.

BEGIN;

-- Step 1: scope=system_customer (24 rows expected)
UPDATE public.fields_registry
SET options = COALESCE(options, '{}'::jsonb) || jsonb_build_object('scope', 'system_customer')
WHERE entity_type IN ('customer','customer_signer')
  AND archived_at IS NULL;

-- Step 2: scope=platform_executor (15 rows expected)
UPDATE public.fields_registry
SET options = COALESCE(options, '{}'::jsonb) || jsonb_build_object('scope', 'platform_executor')
WHERE entity_type = 'executor'
  AND archived_at IS NULL;

-- Step 3: seed 37 new FLD for user_requisites (Legal=20, Individual=17)
INSERT INTO public.fields_registry (entity_type, key, label, data_type, options, display_order, description)
VALUES
  -- Legal subject_type (20 fields = 16 base + 4 GRP read-only)
  ('user_requisites','user_requisites.legal.name_full','Полное наименование','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 10, 'ЮЛ/ИП: полное наименование'),
  ('user_requisites','user_requisites.legal.name_short','Краткое наименование','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 20, 'ЮЛ/ИП: краткое наименование'),
  ('user_requisites','user_requisites.legal.entity_kind','Тип ЮЛ','enum',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 30, 'ЮЛ/ИП: тип субъекта'),
  ('user_requisites','user_requisites.legal.unp','УНП','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 40, 'ЮЛ/ИП: УНП'),
  ('user_requisites','user_requisites.legal.okpo','ОКПО','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 50, 'ЮЛ/ИП: ОКПО'),
  ('user_requisites','user_requisites.legal.legal_address','Юридический адрес (строка)','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 60, 'ЮЛ/ИП: юр. адрес одной строкой'),
  ('user_requisites','user_requisites.legal.address_structured','Адрес (структура)','json',
    jsonb_build_object('scope','user_requisites','subject_type','legal','editing_deferred','D.3','shadow',true), 65,
    'ЮЛ/ИП: структурированный адрес. Сохраняется в JSONB; UI-редактирование deferred PATCH D.3.'),
  ('user_requisites','user_requisites.legal.director_full_name','ФИО руководителя','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 70, 'ЮЛ: ФИО руководителя'),
  ('user_requisites','user_requisites.legal.director_short_name','Инициалы руководителя','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 80, 'ЮЛ: инициалы руководителя'),
  ('user_requisites','user_requisites.legal.director_position','Должность руководителя','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 90, 'ЮЛ: должность руководителя'),
  ('user_requisites','user_requisites.legal.acts_on_basis','Действует на основании','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 100, 'ЮЛ/ИП: действует на основании'),
  ('user_requisites','user_requisites.legal.bank_account','Расчётный счёт (IBAN)','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 110, 'ЮЛ/ИП: IBAN'),
  ('user_requisites','user_requisites.legal.bank_name','Банк','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 120, 'ЮЛ/ИП: наименование банка'),
  ('user_requisites','user_requisites.legal.bank_code','БИК','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 130, 'ЮЛ/ИП: БИК банка'),
  ('user_requisites','user_requisites.legal.email','Email','email',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 140, 'ЮЛ/ИП: e-mail'),
  ('user_requisites','user_requisites.legal.phone','Телефон','phone',
    jsonb_build_object('scope','user_requisites','subject_type','legal'), 150, 'ЮЛ/ИП: телефон'),
  ('user_requisites','user_requisites.legal.grp_status','GRP: статус','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal','readonly',true,'source','grp'), 200, 'GRP: статус (read-only)'),
  ('user_requisites','user_requisites.legal.grp_registered_at','GRP: дата регистрации','date',
    jsonb_build_object('scope','user_requisites','subject_type','legal','readonly',true,'source','grp'), 210, 'GRP: дата регистрации (read-only)'),
  ('user_requisites','user_requisites.legal.grp_verified_at','GRP: проверено','datetime',
    jsonb_build_object('scope','user_requisites','subject_type','legal','readonly',true,'source','grp'), 220, 'GRP: timestamp последней сверки'),
  ('user_requisites','user_requisites.legal.grp_source','GRP: исходник','string',
    jsonb_build_object('scope','user_requisites','subject_type','legal','readonly',true,'source','grp'), 230, 'GRP: исходник записи'),

  -- Individual subject_type (17 fields)
  ('user_requisites','user_requisites.individual.last_name','Фамилия','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 10, 'ФЛ: фамилия'),
  ('user_requisites','user_requisites.individual.first_name','Имя','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 20, 'ФЛ: имя'),
  ('user_requisites','user_requisites.individual.middle_name','Отчество','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 30, 'ФЛ: отчество'),
  ('user_requisites','user_requisites.individual.personal_number','Личный номер','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 40, 'ФЛ: личный номер'),
  ('user_requisites','user_requisites.individual.passport_series','Серия паспорта','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 50, 'ФЛ: серия паспорта'),
  ('user_requisites','user_requisites.individual.passport_number','Номер паспорта','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 60, 'ФЛ: номер паспорта'),
  ('user_requisites','user_requisites.individual.passport_number_full','Серия+номер (computed)','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual','computed',true,
      'compose_from', jsonb_build_array('passport_series','passport_number')), 70,
    'ФЛ: computed-поле, серия+номер одной строкой.'),
  ('user_requisites','user_requisites.individual.passport_issued_by','Кем выдан','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 80, 'ФЛ: кем выдан паспорт'),
  ('user_requisites','user_requisites.individual.passport_issued_date','Дата выдачи','date',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 90, 'ФЛ: дата выдачи паспорта'),
  ('user_requisites','user_requisites.individual.passport_valid_until','Действителен до','date',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 100, 'ФЛ: срок действия паспорта'),
  ('user_requisites','user_requisites.individual.registration_address','Адрес регистрации (строка)','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 110, 'ФЛ: адрес регистрации одной строкой'),
  ('user_requisites','user_requisites.individual.address_structured','Адрес (структура)','json',
    jsonb_build_object('scope','user_requisites','subject_type','individual','editing_deferred','D.3','shadow',true), 115,
    'ФЛ: структурированный адрес. Сохраняется в JSONB; UI-редактирование deferred PATCH D.3.'),
  ('user_requisites','user_requisites.individual.bank_account','Расчётный счёт (IBAN)','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 120, 'ФЛ: IBAN'),
  ('user_requisites','user_requisites.individual.bank_name','Банк','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 130, 'ФЛ: банк'),
  ('user_requisites','user_requisites.individual.bank_code','БИК','string',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 140, 'ФЛ: БИК'),
  ('user_requisites','user_requisites.individual.email','Email','email',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 150, 'ФЛ: e-mail'),
  ('user_requisites','user_requisites.individual.phone','Телефон','phone',
    jsonb_build_object('scope','user_requisites','subject_type','individual'), 160, 'ФЛ: телефон');

-- Step 4: deprecate 71 legacy FLD (no archived_at)
UPDATE public.fields_registry
SET options = COALESCE(options, '{}'::jsonb) || jsonb_build_object(
  'deprecated_at', now()::text,
  'deprecated_reason', 'requisites_v2_stage_e',
  'replaced_by', CASE entity_type
    WHEN 'legal_details'   THEN 'user_requisites|customer'
    WHEN 'entity'          THEN 'customer'
    WHEN 'entity_person'   THEN 'customer_signer'
    WHEN 'person'          THEN 'user_requisites.individual.*'
  END
)
WHERE entity_type IN ('legal_details','entity','entity_person','person')
  AND archived_at IS NULL;

-- STOP-guards (variant B counts)
DO $$
DECLARE
  c_sys      int;
  c_exec     int;
  c_user_req int;
  c_dep      int;
  c_archived int;
BEGIN
  SELECT COUNT(*) INTO c_sys      FROM public.fields_registry WHERE options->>'scope' = 'system_customer';
  SELECT COUNT(*) INTO c_exec     FROM public.fields_registry WHERE options->>'scope' = 'platform_executor';
  SELECT COUNT(*) INTO c_user_req FROM public.fields_registry WHERE entity_type = 'user_requisites';
  SELECT COUNT(*) INTO c_dep      FROM public.fields_registry WHERE options->>'deprecated_at' IS NOT NULL;
  SELECT COUNT(*) INTO c_archived FROM public.fields_registry
    WHERE entity_type IN ('legal_details','entity','entity_person','person') AND archived_at IS NOT NULL;

  IF c_sys      <> 24 THEN RAISE EXCEPTION 'E.guard.1 system_customer scope mismatch: got %, expected 24', c_sys; END IF;
  IF c_exec     <> 15 THEN RAISE EXCEPTION 'E.guard.2 platform_executor scope mismatch: got %, expected 15', c_exec; END IF;
  IF c_user_req <> 37 THEN RAISE EXCEPTION 'E.guard.3 user_requisites count mismatch: got %, expected 37', c_user_req; END IF;
  IF c_dep      <> 71 THEN RAISE EXCEPTION 'E.guard.4 deprecated count mismatch: got %, expected 71', c_dep; END IF;
  IF c_archived <> 0  THEN RAISE EXCEPTION 'E.guard.5 archived_at must remain NULL on legacy: got %', c_archived; END IF;
END $$;

-- Audit log: system actor, no PII
INSERT INTO public.audit_logs (actor_user_id, actor_type, actor_label, action, meta)
VALUES (
  NULL,
  'system',
  'system:requisites_v2_stage_e',
  'fields_registry_stage_e_executed',
  jsonb_build_object(
    'variant', 'B',
    'system_customer_scope_count', 24,
    'platform_executor_scope_count', 15,
    'user_requisites_seeded', 37,
    'deprecated_count', 71,
    'archived_changed', 0,
    'jsonb_column', 'options',
    'scope_lock_term', 'scope_lock'
  )
);

COMMIT;
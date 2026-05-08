-- ───────────────────────────────────────────────────────────
-- C5-D-UX: чистка picker FLD + явная маркировка ЮЛ/ИП/ФЛ
-- ───────────────────────────────────────────────────────────

-- 1) Архивируем legacy-наборы legal_details.* и person.*
--    в document_token_registry — они исчезнут из picker.
--    fields_registry-строки НЕ трогаем: уже размеченные шаблоны
--    продолжат резолвить FLD по public_id.
UPDATE public.document_token_registry
SET archived_at = now()
WHERE archived_at IS NULL
  AND field_id IN (
    SELECT id FROM public.fields_registry
    WHERE entity_type IN ('legal_details','person')
  );

-- 2) Обновляем label существующих executor.* / customer.*
--    с добавлением формы собственности там, где это меняет смысл.

-- executor (Исполнитель)
UPDATE public.fields_registry SET label = 'Исполнитель: УНП (ЮЛ/ИП)'             WHERE key = 'executor.unp';
UPDATE public.fields_registry SET label = 'Исполнитель: директор (ЮЛ)'           WHERE key = 'executor.director';
UPDATE public.fields_registry SET label = 'Исполнитель: директор, инициалы (ЮЛ)' WHERE key = 'executor.director_short';
UPDATE public.fields_registry SET label = 'Исполнитель: ФИО руководителя (ЮЛ)'   WHERE key = 'executor.director_full_name';
UPDATE public.fields_registry SET label = 'Исполнитель: должность руководителя (ЮЛ)' WHERE key = 'executor.director_position';
UPDATE public.fields_registry SET label = 'Исполнитель: действует на основании (ЮЛ/ИП)' WHERE key = 'executor.acts_on_basis';
UPDATE public.fields_registry SET label = 'Исполнитель: основание полномочий (ЮЛ/ИП)'   WHERE key = 'executor.basis';

-- customer (Заказчик)
UPDATE public.fields_registry SET label = 'Заказчик: УНП (ЮЛ/ИП)'                 WHERE key = 'customer.unp';
UPDATE public.fields_registry SET label = 'Заказчик: юридический адрес (ЮЛ/ИП)'   WHERE key = 'customer.legal_address';
UPDATE public.fields_registry SET label = 'Заказчик: паспорт (ФЛ)'                WHERE key = 'customer.passport';
UPDATE public.fields_registry SET label = 'Заказчик: личный номер (ФЛ)'           WHERE key = 'customer.personal_number';

-- 3) Достраиваем недостающие парные поля у customer.*
--    public_id присвоит триггер trg_fields_registry_public_id.

INSERT INTO public.fields_registry (entity_type, key, label, data_type, options, display_order)
VALUES
  ('customer','customer.director',            'Заказчик: директор (ЮЛ)',                  'string', '{}'::jsonb, 0),
  ('customer','customer.director_short',      'Заказчик: директор, инициалы (ЮЛ)',        'string', '{}'::jsonb, 0),
  ('customer','customer.director_full_name',  'Заказчик: ФИО руководителя (ЮЛ)',          'string', '{}'::jsonb, 0),
  ('customer','customer.director_position',   'Заказчик: должность руководителя (ЮЛ)',    'string', '{}'::jsonb, 0),
  ('customer','customer.acts_on_basis',       'Заказчик: действует на основании (ЮЛ/ИП)', 'string', '{}'::jsonb, 0),
  ('customer','customer.basis',               'Заказчик: основание полномочий (ЮЛ/ИП)',   'string', '{}'::jsonb, 0)
ON CONFLICT (entity_type, key) DO NOTHING;

-- 4) Создаём для них token-маппинги в document_token_registry,
--    чтобы они появились в picker. category='customer'.
INSERT INTO public.document_token_registry (token_key, ui_label, category, field_id, archived_at)
SELECT
  fr.key,
  fr.label,
  'customer',
  fr.id,
  NULL
FROM public.fields_registry fr
WHERE fr.archived_at IS NULL
  AND fr.entity_type = 'customer'
  AND fr.key IN (
    'customer.director',
    'customer.director_short',
    'customer.director_full_name',
    'customer.director_position',
    'customer.acts_on_basis',
    'customer.basis'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.document_token_registry dtr
    WHERE dtr.field_id = fr.id AND dtr.archived_at IS NULL
  );

-- 5) Синхронизируем ui_label у уже существующих document_token_registry
--    под новые label (чтобы picker сразу показывал свежие имена).
UPDATE public.document_token_registry dtr
SET ui_label = fr.label
FROM public.fields_registry fr
WHERE dtr.field_id = fr.id
  AND dtr.archived_at IS NULL
  AND fr.entity_type IN ('executor','customer')
  AND dtr.ui_label IS DISTINCT FROM fr.label;
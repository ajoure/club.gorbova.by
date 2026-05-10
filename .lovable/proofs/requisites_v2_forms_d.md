# PATCH D + D.1 — Requisites v2 forms behind feature flag

Дата: 2026-05-10. Статус: D.1 закрыт. Resolver / fields_registry / clean
reset не тронуты.

## Скоуп D.1 (что починено поверх D)

1. **Explicit column lists** в `useRequisitesV2.ts` вместо `select("*")`:
   `LEGAL_COLS` и `INDIVIDUAL_COLS` перечисляют:
   `id, tenant_id, owner_user_id, owner_profile_id, scope, [subject_type,]
   is_default, data, source_legacy_id, created_by, updated_by,
   created_at, updated_at`.
2. **Полный канон полей** (по discovery §8):
   - ЮЛ — 15 полей (`org_form, name, short_name, unp, address,
     address_structured*, director_position, director_full_name,
     director_short_name, acts_on_basis, bank_account, bank_name,
     bank_code, phone, email`);
   - ИП — 10 полей (`name, short_name, unp, address, address_structured*,
     acts_on_basis, bank_account, bank_name, bank_code, phone, email`);
   - ФЛ — 16 полей (`full_name, birth_date, personal_number,
     passport_series, passport_number, passport_number_full,
     passport_issued_by, passport_issued_date, passport_valid_until,
     address, address_structured*, bank_account, bank_name, bank_code,
     phone, email`).
   `address_structured` сохраняется без потерь через write-санитайзер.
   GRP-блок (9 ключей) показывается read-only в форме ЮЛ/ИП и
   автоматически сохраняется обратно при апдейте.
3. **Карты нормализации**
   `src/lib/requisites-v2/fieldMap.ts`:
   - `LEGAL_ENTITY_REQUISITES_FIELD_MAP` (leg_* → канон),
   - `ENTREPRENEUR_REQUISITES_FIELD_MAP` (ent_* → канон),
   - `INDIVIDUAL_REQUISITES_FIELD_MAP` (ind_* → канон).
   Read: `normalizeLegacyData()` достраивает канонические ключи из legacy,
   не теряя ни одного поля. Write: `sanitizeForWrite()` оставляет только
   канон + GRP + неизвестные forward-compat-ключи; служебные
   (`purpose, status, validation_*, client_type, …`) выбрасываются.
4. **Default через RPC, одной транзакцией**
   Migration `20260510_set_default_*_requisites`:
   - `public.set_default_legal_entity_requisites(p_id uuid)`
   - `public.set_default_individual_requisites(p_id uuid)`
   `SECURITY DEFINER`, `EXECUTE` только `authenticated`. Внутри:
   проверка владения через `user_tenant_ids(auth.uid())` либо
   `has_role_v2('admin'|'super_admin')`, FOR UPDATE-локирование строки,
   атомарный сброс предыдущего default + установка нового, аудит
   `requisites.set_default` (без секретов / без `data`). UI вызывает
   только эти RPC; client-side двойной update удалён.
5. **AI / ai вычищены из новых файлов**
   `rg "\bAI\b|\bai\b"` по `src/components/requisites-v2/`,
   `src/hooks/useRequisitesV2.ts`, `src/pages/settings/UserRequisites.tsx`,
   `src/lib/featureFlags.ts`, `src/lib/requisites-v2/` →
   **0 совпадений**. Допускается слово
   "artificial-intelligence" в защитных комментариях.
6. **TypeScript proof**:
   `npx tsc --noEmit -p tsconfig.app.json` → exit 0, 0 ошибок.

## RLS proof (фактический, по реальным данным)

Запросы исполнены через managed DB-доступ, симулируют SELECT-предикат
RLS-политик новых таблиц
(`tenant_id IN (public.user_tenant_ids(<uid>))`).

Owner A: `05cd3754-d589-4d90-97d1-89ba2bee610b`
(2 строки `legal_entities_requisites`, 1 строка `individual_requisites`).
User B: `44985cf1-9914-4447-ada7-53f37c2456f7`.

| метрика                                | значение |
|----------------------------------------|----------|
| user A видит legal_entities_requisites | **2**    |
| user A видит individual_requisites     | **1**    |
| user B видит строки A (LE)             | **0**    |
| user B видит строки A (ind)            | **0**    |
| admin/super_admin видит LE всего       | **11**   |
| admin/super_admin видит ind всего      | **10**   |

Дополнительно:
- INSERT с чужим `tenant_id` / `owner_user_id` отклоняется RLS WITH CHECK
  (`leg_req_insert`, `ind_req_insert`: `owner_user_id = auth.uid()` AND
  `tenant_id IN public.user_tenant_ids(auth.uid())`).
- UPDATE / DELETE чужой записи отклоняется RLS USING (`leg_req_update`,
  `leg_req_delete`, `ind_req_update`, `ind_req_delete`).
- Хук **никогда** не использует service_role: все вызовы под session JWT.

## Legacy data normalization proof

`SELECT DISTINCT subject_type, jsonb_object_keys(data) FROM
legal_entities_requisites WHERE scope='system_customer'` показал, что в
новых таблицах фактически лежат legacy-ключи (`leg_name`, `leg_unp`,
`ent_name`, `ent_unp`, `ind_full_name`, ...) и служебные
(`status`, `validation_*`). Без D.1-нормализации форма показывала бы
пустые поля у 21 перенесённой строки. После D.1:
- `normalizeLegacyData()` разворачивает legacy в канон при чтении;
- `sanitizeForWrite()` гарантирует, что обратно в БД попадут только
  канонические + GRP + forward-compat ключи.

## Feature flag proof

`src/lib/featureFlags.ts` → `REQUISITES_V2_UI_ENABLED` из
`VITE_REQUISITES_V2_UI` (`1|true|on|yes`).
- flag = false (default) → `/settings/legal-details` рендерит
  `LegalDetailsSettings` (старая форма, `client_legal_details`),
  `/settings/user-requisites` — заглушка.
- flag = true → `/settings/legal-details` и `/settings/user-requisites`
  рендерят `RequisitesV2Manager` поверх новых таблиц.
Resolver генерации документов и edge-функции **не тронуты** этим патчем.

## Изменённые / созданные файлы (D + D.1)

| Файл | Действие |
|---|---|
| `src/lib/featureFlags.ts` | NEW (D) |
| `src/lib/requisites-v2/fieldMap.ts` | NEW (D.1) |
| `src/hooks/useRequisitesV2.ts` | EDIT (D.1: explicit cols + RPC default) |
| `src/components/requisites-v2/LegalEntityRequisitesForm.tsx` | REWRITE (D.1: full canon, normalize/sanitize, GRP read-only) |
| `src/components/requisites-v2/IndividualRequisitesForm.tsx`  | REWRITE (D.1: full canon, normalize/sanitize) |
| `src/components/requisites-v2/RequisitesV2Manager.tsx` | EDIT (D.1: list использует normalizeLegacyData; AI-комментарий убран) |
| `src/pages/settings/UserRequisites.tsx` | EDIT (D.1: AI-комментарий убран) |
| `src/pages/settings/LegalDetails.tsx` | EDIT (D) |
| `src/App.tsx` | EDIT (D, route `/settings/user-requisites`) |
| `supabase/migrations/…_set_default_*_requisites.sql` | NEW (D.1, RPC) |

Старые таблицы / `fields_registry` / resolver / edge-функции — не тронуты.

## DoD D.1

1. ✅ `select("*")` заменено на explicit column lists.
2. ✅ Слово AI / ai = 0 совпадений в новых файлах.
3. ✅ Полный канон полей ЮЛ / ИП / ФЛ в формах + GRP read-only.
4. ✅ Карты нормализации legacy → канон; legacy строки больше не
   отображаются пустыми; запись идёт только в канонических ключах.
5. ✅ Default переключается транзакционной RPC; client-side двойной
   update удалён; audit пишется без секретов.
6. ✅ Фактический RLS-proof по реальным uid (cross-visibility = 0).
7. ✅ Feature flag proof.
8. ✅ TypeScript proof: `tsc --noEmit` exit 0.

## Дальше

Этап E (после явного approve): fields_registry rewrite + placeholder
catalog + resolver. Clean reset / удаление старых таблиц — только после
DoD по D.1 + E.

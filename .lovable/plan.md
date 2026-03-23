# да, согласен, с учетом правок:

&nbsp;

1. Сохрани add-only принцип:
  &nbsp;
  - ничего из уже созданных таблиц/полей не удалять,
  - только исправить owner-model, RLS и trigger,
  - отдельно явно указать mapping: старые policy -> новые policy.
  &nbsp;
2. Миграцию сделать идемпотентной:
  &nbsp;
  - DROP POLICY IF EXISTS ...,
  - trigger/function создавать/обновлять безопасно,
  - не полагаться на ручной порядок запуска.
  &nbsp;
3. В useDocumentPackages.ts profile resolution сделать точно по паттерну других AI-hook:
  &nbsp;
  - через useAuth,
  - отдельный query в profiles,
  - profileId = profile?.id ?? null,
  - queries/mutations только при наличии profileId.
  &nbsp;
4. В createPackage:
  &nbsp;
  - profile_id = profileId ([profiles.id](http://profiles.id)),
  - created_by = [user.id](http://user.id) ([auth.users.id](http://auth.users.id)) — это оставить явно,
  - если profileId не найден — бросать человекочитаемую ошибку, а не писать пустое значение.
  &nbsp;
5. В query пакетов не ломай будущий admin-access:
  &nbsp;
  - если это пользовательский AI-экран — фильтруй по profileId,
  - но RLS всё равно оставь корректной для owner/admin/super_admin через profiles.user_id = auth.uid(),
  - не дублируй ошибочную логику profile_id = auth.uid() нигде.
  &nbsp;
6. Для document_package_template_items в proof отдельно покажи, что поля
  &nbsp;
  - is_required
  - title_override
    реально есть в БД и не потеряны, даже если UI их пока не использует.
  &nbsp;
7. Для document_package_templates добавь:
  &nbsp;
  - updated_at trigger,
  - proof, что updated_at реально меняется при update, а не только присутствует колонка.
  &nbsp;
8. В итоговом proof по PATCH 9.1 обязательно показать:
  &nbsp;
  - SQL/RLS proof owner-model,
  - что новый пакет создаётся с profile_id = [profiles.id](http://profiles.id),
  - что одиночные AI-шаблоны не сломаны,
  - что карточки пакетов по-прежнему отображаются,
  - что billing flow не затронут.
  &nbsp;
9. Ничего не менять в UI этого патча, кроме того, что необходимо для компиляции hook после фикса owner-model. Это именно corrective patch, а не новый функциональный sprint.

&nbsp;

&nbsp;

PATCH 9.1 — Fix owner model, RLS, missing fields for document packages

## Problems to fix

1. **Broken owner model**: `useDocumentPackages` writes `profile_id: user.id` (auth.users.id), but the project convention stores `profiles.id` in `profile_id`. RLS uses `profile_id = auth.uid()` instead of the correct join pattern.
2. **Missing fields in items table**: `is_required` and `title_override` are actually present in the migration SQL (lines 24-25), so they exist in DB. But the hook interface declares them — need to verify they're actually used in UI.
3. **No `updated_at` trigger**: `document_package_templates` has `updated_at` column but no auto-update trigger.
4. **RLS pattern mismatch**: All other tables (legal_details_persons, client_legal_details, etc.) use `profile_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())`. Package tables use wrong `profile_id = auth.uid()`.

## Changes

### 1. Migration — Fix RLS + add updated_at trigger

New migration:

- Drop all 8 existing RLS policies on both tables
- Recreate with correct pattern: `profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())`
- Items policies: join through package's corrected ownership
- Add `updated_at` trigger for `document_package_templates`

### 2. Fix `useDocumentPackages.ts` — resolve profile_id correctly

Replace `user.id` with profiles lookup (same pattern as `useAiDocuments`):

- Add `useAuth` import
- Add profile query: `profiles.select("id").eq("user_id", user.id).single()`
- In `createPackage`: use `profile.id` instead of `user.id` for `profile_id`
- In `createPackage`: use `user.id` for `created_by` (this one IS auth.users.id — correct)
- Filter packages query by `profileId` to only show own packages

### 3. No other files change

`AiDocumentPackagesManager.tsx` — no changes needed, it calls hook correctly.
`AiDocumentsGenerateView.tsx` — no changes needed.

## Files


| File                               | Action                                               |
| ---------------------------------- | ---------------------------------------------------- |
| New migration SQL                  | Drop+recreate 8 RLS policies, add updated_at trigger |
| `src/hooks/useDocumentPackages.ts` | Fix profile_id resolution via profiles table lookup  |


## What we do NOT touch

- `sheet.tsx`, `sheetShell.ts`
- billing flow, generated_documents, edge functions
- PATCH 5/6/7/8
- `AiDocumentPackagesManager.tsx` (UI unchanged)
- `AiDocumentTemplatesManager.tsx`
- `GenerateAiDocumentDialog.tsx`
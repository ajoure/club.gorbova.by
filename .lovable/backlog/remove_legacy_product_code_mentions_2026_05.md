# Backlog: remove legacy product code/slug mentions

**Status:** backlog (НЕ выполнять без отдельного approve)
**Created:** 2026-05-06

> **Convention.** В этом документе запрещено упоминание запрещённых
> product code/slug и их регистровых вариантов. Все ссылки на legacy
> сущности используют placeholder `<legacy_slug>` либо стабильные
> идентификаторы (UUID, дату миграции, имя директории через шаблон).

## Контекст

Согласно правилу `no-product-code-in-new-artifacts` запрещено
использовать внутренние product code/slug в новых артефактах. В
существующем коде/документах сохраняются исторические упоминания,
помеченные как `legacy_existing_debt`. Этот backlog описывает поэтапное
их удаление вне рамок текущего repair.

## Перечень legacy-источников

Группы перечислены без литералов запрещённого токена; конкретные пути
получаются `rg`-аудитом с переменной `LEGACY_PRODUCT_TOKENS`.

### Группа A — historical migrations (НЕ переписывать)

Файлы в `supabase/migrations/` с датами:
`20260108`, `20260116`, `20260118`, `20260331` (×2), `20260406` (×2).

История применённых миграций. Не редактируется. Допустимо как
`legacy_existing_debt`.

### Группа B — legacy edge functions / shared

- `supabase/functions/repair-<legacy_slug>-entitlements/` — переименовать
  в нейтральное (например `repair-training-module-scope-ids`) ИЛИ
  пометить deprecated и не использовать.
- `supabase/functions/admin-entitlement-backfill-v23/` — внутренние
  комментарии и константы.
- `supabase/functions/course-prereg-notify/index.ts` — label-маппинг для
  предзаписи (другой продукт).
- `supabase/functions/split-multi-module-orders/index.ts` —
  комментарии о root-продукте.
- `supabase/functions/_shared/entitlement-sync.ts` — комментарий «Skips
  …». Проверить отсутствие runtime-фильтра по code.
- `supabase/functions/_shared/access-resolver.ts` — комментарий.

Действие: provести audit, заменить технические ссылки на UUID, оставить
только `product_name` в логах. Требует отдельного approve и QA.

### Группа C — legacy frontend

- `src/lib/product-names.ts` — UI mapping (legacy slug → display name).
  Решение: оставить как UI-mapping, либо мигрировать на DB-driven
  `products_v2.code` lookup.
- `src/components/course/PreregistrationDialog.tsx` — `productCode`
  prop (другой продукт; не блокер).
- `src/hooks/useTrainingContentRules.ts`,
  `src/hooks/useSidebarModules.ts` — комментарии.

### Группа D — historical proofs / memory

- `.lovable/proofs/<legacy_slug>_manual_grant_tariff_repair_2026_05.md`
- `.lovable/proofs/training_content_resolver_<legacy_slug>_tatiana_2026_05.md`
- `.lovable/proofs/training_content_business_full_fix.md`
- `.lovable/proofs/access_rules_meta_backfill_a1.md`
- `.lovable/proofs/access_rules_full_dod_proof.md`
- `.lovable/plan.md` (исторические записи)
- `mem://commercial-logic/access/<legacy_slug>-access-rules-standard` —
  переименовать memory-файл и индекс.

Действие: исторические proof не редактируются. Memory rule с code в
имени — кандидат на rename.

## План (после отдельного approve)

1. Frontend group C: refactor комментариев и mapping → UUID-driven.
2. Backend group B: rename edge functions с deprecated alias period
   (sub-cron path, shared callers).
3. Memory rename: legacy memory file →
   `course-default-deny-standard` (или аналог по `product_id`).
4. Group A/D: оставить как `legacy_existing_debt` permanently.

## Acceptance

- `rg "$LEGACY_PRODUCT_TOKENS" src` = 0 (после Group C).
- `rg "$LEGACY_PRODUCT_TOKENS" supabase/functions` = 0, кроме
  deprecated alias period.
- Memory: 0 упоминаний в активных файлах (исторические proof —
  допустимо).

## Не входит

- Текущий `module_scope_ids_repair_2026_05` Execute.
- Любые writers / business-logic правки.

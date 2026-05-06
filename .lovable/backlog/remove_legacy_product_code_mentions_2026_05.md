# Backlog: remove legacy product code/slug mentions

**Status:** backlog (НЕ выполнять без отдельного approve)
**Created:** 2026-05-06

## Контекст

Согласно правилу `no-product-code-in-new-artifacts` запрещено
использовать внутренние product code/slug в новых артефактах. В
существующем коде/документах сохраняются исторические упоминания, помеченные
как `legacy_existing_debt`. Этот backlog описывает поэтапное их удаление
вне рамок текущего repair.

## Перечень legacy-источников (по grep `rg -n "cb20|CB20" src supabase .lovable`)

### Группа A — historical migrations (НЕ переписывать)
- `supabase/migrations/20260108090816_*.sql`
- `supabase/migrations/20260116014131_*.sql`
- `supabase/migrations/20260118184548_*.sql`
- `supabase/migrations/20260331113539_*.sql`
- `supabase/migrations/20260331115050_*.sql`
- `supabase/migrations/20260406144011_*.sql`
- `supabase/migrations/20260406205141_*.sql`

История, не редактируется. Допустимо как `legacy_existing_debt`.

### Группа B — legacy edge functions / shared
- `supabase/functions/repair-cb20-entitlements/` — переименовать в
  нейтральное (например `repair-training-module-scope-ids`) ИЛИ
  пометить deprecated и не использовать.
- `supabase/functions/admin-entitlement-backfill-v23/` —
  внутренние комментарии и переменные с `CB20`.
- `supabase/functions/course-prereg-notify/index.ts` — label-маппинг
  для предзаписи (другой продукт).
- `supabase/functions/split-multi-module-orders/index.ts` —
  комментарии «root CB20».
- `supabase/functions/_shared/entitlement-sync.ts` — комментарий
  «Skips cb20 …». Проверить отсутствие runtime-фильтра по code.
- `supabase/functions/_shared/access-resolver.ts` — комментарий.

Действие: provести audit, заменить технические ссылки на UUID, оставить
только `product_name` в логах. Требует отдельного approve и QA.

### Группа C — legacy frontend
- `src/lib/product-names.ts` — UI mapping (legacy slug → display name).
  Решение: оставить как UI-mapping, либо мигрировать на DB-driven
  `products_v2.code` lookup.
- `src/components/course/PreregistrationDialog.tsx` — `productCode`
  prop. Касается продукта предзаписи; не блокер.
- `src/hooks/useTrainingContentRules.ts`,
  `src/hooks/useSidebarModules.ts` — комментарии.

### Группа D — historical proofs / memory
- `.lovable/proofs/cb20_manual_grant_tariff_repair_2026_05.md`
- `.lovable/proofs/training_content_resolver_cb20_tatiana_2026_05.md`
- `.lovable/proofs/training_content_business_full_fix.md`
- `.lovable/proofs/access_rules_meta_backfill_a1.md`
- `.lovable/proofs/access_rules_full_dod_proof.md`
- `.lovable/plan.md` (исторические записи)
- `mem://commercial-logic/access/cb20-access-rules-standard` —
  переименовать memory-файл и индекс.

Действие: исторические proof не редактируются. Memory rule с code в
имени — кандидат на rename.

## План (после отдельного approve)

1. Frontend group C: refactor комментариев и mapping → UUID-driven.
2. Backend group B: rename edge functions с deprecated alias period
   (sub-cron path, shared callers).
3. Memory rename: `cb20-access-rules-standard` →
   `course-default-deny-standard` (или аналог по `product_id`).
4. Group A/D: оставить как `legacy_existing_debt` permanently.

## Acceptance

- `rg "cb20|CB20" src` = 0 (после Group C).
- `rg "cb20|CB20" supabase/functions` = 0, кроме deprecated alias period.
- Memory: 0 упоминаний в активных файлах (исторические proof — допустимо).

## Не входит

- Текущий `module_scope_ids_repair_2026_05` Execute.
- Любые writers / business-logic правки.

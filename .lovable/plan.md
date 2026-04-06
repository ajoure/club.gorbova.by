## да, согласен, с учетом правок:

&nbsp;

1. **Не подменяй главную задачу UI-патчем.**
  public_id/PRD-xxxx включи в этот же спринт как secondary add-only patch, но не выноси как отдельный смысловой блок. Основной результат спринта — **удаление всех параллельных runtime-path по доступам** и **реальный execute по cb20**, а не косметика UI.
2. **Жёстко сформулируй SoT для клубов тоже.**
  Нужно явно записать:
  &nbsp;
  - выдача Telegram/club access тоже идёт **только через access_rules**;
  - product_club_mappings после спринта допускается только как историческая таблица/данные, но **не как runtime source of truth**;
  - любой read из product_club_mappings, который влияет на решение “дать/не дать доступ”, считается незакрытым дефектом.
  &nbsp;
3. **По cb20 убери двусмысленность в DoD.**
  Недостаточно написать “все active cb20 имеют access_rule_id”.
  Добавь жёстче:
  &nbsp;
  - после execute **не остаётся ни одного active cb20 без доказанного rule-based основания**;
  - не остаётся ни одного active cb20 из legacy/import/export/backfill без переоценки через resolver;
  - если entitlement оставлен active, в meta должен быть **канонический source_rule_id**, объясняющий текущее право доступа сейчас, а не исторически.
  &nbsp;
4. **Для cb20 repair пропиши два режима отдельно.**
  Сейчас у тебя смешано disable и reprovision. Нужно разделить:
  &nbsp;
  - disable_only для тех, у кого нет active BUSINESS и нет rule-proof;
  - reprovision_via_resolver для тех, у кого BUSINESS есть, но текущий entitlement legacy/без source_rule_id;
  - после execute не должно остаться “временно оставленных” legacy active cb20.
  &nbsp;
5. **Добавь after-proof не только по cb20, но и по club-chain.**
  Для Gorbova Club и Бухгалтерия как бизнес нужен proof, что:
  &nbsp;
  - правило найдено в access_rules;
  - resolver вернул именно это правило;
  - executor использовал именно его;
  - Telegram grant/access queue больше не читает product_club_mappings как решающий источник.
    Это должен быть отдельный артефакт или отдельный блок в итоговом proof.
  &nbsp;
6. **В Execute 1 требуй не просто заменить lookup, а убрать decision-ветки целиком.**
  Формулировка должна быть такой:
  не “заменить запрос к product_club_mappings на access_rules”, а
  **“вынести решение о club grants в единый resolver / shared rule lookup и запретить локальную самостоятельную decision-логику в каждом из 6 файлов”**.
  Иначе подрядчик просто размножит одинаковый код по шести местам.
7. **Добавь обязательный grep-proof.**
  После execute нужен машинный proof:
  &nbsp;
  - product_club_mappings больше не встречается в runtime decision paths;
  - source_rule_id пишется в entitlement/meta для rule-based grants;
  - нет lookup/grant decision по product_code там, где должен использоваться product_id.
    Это должен быть отдельный кусок финального отчёта, не “на словах”.
  &nbsp;
8. **UI patch по public_id сформулируй проще и жёстче.**
  Во всех рабочих экранах админки:
  &nbsp;
  - показывать public_id (PRD-xxxx) для человека;
  - UUID оставлять только как технический copyValue;
  - fallback на UUID-фрагмент допустим только если public_id реально пустой.
    Отдельно потребуй proof-скрины 3 экранов после правки.
  &nbsp;
9. **Добавь финальный stop-guard по незакрытым runtime paths.**
  Если после спринта останется хотя бы один из следующих пунктов, спринт считается проваленным:
  &nbsp;
  - runtime read из product_club_mappings влияет на решение;
  - active cb20 без канонического source_rule_id;
  - клубный доступ выдается не из access_rules;
  - UI показывает одно правило, а runtime живет по другой ветке;
  - подрядчик сделал только dry-run без execute и after-proof.
  &nbsp;
10. **Финальный результат спринта сформулируй одной фразой в конце плана.**
  После спринта:
  **все решения по доступам к продуктам, бонусным продуктам, cb20 и Telegram-клубам принимаются только по access_rules и ID через единый resolver; legacy/runtime обходные пути отключены; invalid active cb20 устранены; UI показывает public_id, а не UUID.**

&nbsp;

&nbsp;

План: PATCH-ACCESS-SOT-FINAL-UNIFICATION

**Финальная цель: после спринта в системе существует только один путь принятия решений по доступам: access_rules → access-resolver → executor. Все остальные пути удалены или отключены.**

---

### Текущий статус

Что уже сделано:

- `access-resolver.ts` создан и работает (универсальный, без product-specific хардкода)
- `grant-access-for-order`: legacy fallback к `product_club_mappings` удалён (L867), secondary lookup по `product_id` (L1128-1133)
- `entitlement-sync.ts`: hardcoded fallback sets удалены, hard fail при отсутствии `entitlement_mode`
- `repair-cb20-entitlements`: переписан как mechanical executor

Что ещё НЕ сделано (и должно быть закрыто в этом патче):


| #   | Остаточный параллельный path                           | Файл                                       | Строки     |
| --- | ------------------------------------------------------ | ------------------------------------------ | ---------- |
| 1   | `product_club_mappings` lookup для Telegram            | `subscription-charge/index.ts`             | L1789-1793 |
| 2   | `product_club_mappings` lookup для Telegram            | `bepaid-get-subscription-details/index.ts` | L607-611   |
| 3   | `product_club_mappings` lookup для Telegram            | `bepaid-webhook/index.ts`                  | L5162-5166 |
| 4   | `product_club_mappings` lookup для Telegram            | `_shared/resolve-effective-access.ts`      | L76-78     |
| 5   | `product_club_mappings` lookup для Telegram            | `_shared/invite-link-helper.ts`            | L35-37     |
| 6   | `product_club_mappings` lookup для Telegram            | `telegram-process-access-queue/index.ts`   | L180, L206 |
| 7   | cb20 repair execute не выполнен (только dry-run готов) | —                                          | —          |
| 8   | UUID вместо public_id в UI                             | 3 файла                                    | —          |


---

### EXECUTE 1: Удалить все оставшиеся `product_club_mappings` runtime paths

Во всех 6 файлах (пункты 1-6 выше) заменить lookup из `product_club_mappings` на lookup из `access_rules`:

```
// БЫЛО:
const { data: clubMappings } = await supabase
  .from('product_club_mappings')
  .select('club_id')
  .eq('product_id', productId)
  .eq('is_active', true);

// СТАЛО:
const { data: clubRules } = await supabase
  .from('access_rules')
  .select('id, target_ref')
  .eq('product_id', productId)
  .eq('grant_target_type', 'club')
  .eq('is_active', true);
const clubIds = (clubRules || []).map(r => r.target_ref).filter(Boolean);
```

Для `resolve-effective-access.ts` и `invite-link-helper.ts` — аналогичная замена.
Для `telegram-process-access-queue` — замена обоих мест (L180 для display name, L206 для validation).

Таблица `product_club_mappings` не удаляется физически, но все runtime reads переводятся на `access_rules`.

**Файлы:**

- `supabase/functions/subscription-charge/index.ts`
- `supabase/functions/bepaid-get-subscription-details/index.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/_shared/resolve-effective-access.ts`
- `supabase/functions/_shared/invite-link-helper.ts`
- `supabase/functions/telegram-process-access-queue/index.ts`

---

### EXECUTE 2: cb20 repair — dry-run → execute → after-proof

1. Вызвать `repair-cb20-entitlements` с `{ product_id: "7101ed3c-...", dry_run: true }` — получить repair-list
2. Сгенерировать артефакт `cb20_mass_disable_repair_list.csv` из результата
3. Вызвать с `dry_run: false` — выполнить disable всех invalid
4. After-proof: повторный SELECT active cb20 → каждый должен иметь `access_rule_id` в meta
5. Сгенерировать `cb20_active_full_proof.csv` и `cb20_rule_proven_active_only.csv`

---

### EXECUTE 3: UI — заменить UUID на public_id (secondary patch)

Три файла показывают `product_id.substring(0, 8)` вместо `public_id`:

`**DealDetailSheet.tsx` (L565):**

- Добавить `public_id` в select query (L242): `products_v2(name, code, telegram_club_id, public_id)`
- Заменить `deal.product_id.substring(0, 8)` на `(deal.products_v2 as any)?.public_id || deal.product_id.substring(0, 8)`

`**ContactDetailSheet.tsx` (L3040):**

- Добавить `public_id` в select query (L421): `products_v2(id, name, code, category, public_id)`
- Заменить `deal.product_id.substring(0, 8)` на `(deal.products_v2 as any)?.public_id || deal.product_id.substring(0, 8)`

`**ContactDealsDialog.tsx` (L252):**

- Добавить `public_id` в select query (L95): `supabase.from("products_v2").select("id, name, category, public_id")`
- Передавать `public_id` в данные deal
- Заменить `deal.product_id.substring(0, 8)` на `deal.public_id || deal.product_id.substring(0, 8)`

UUID остаётся в `copyValue` — копирование полного UUID сохраняется для технических нужд.

---

### EXECUTE 4: Генерация финальных артефактов

12 артефактов в `/mnt/documents/`:

1. `runtime_access_paths_matrix.csv` — полная матрица всех paths с вердиктом
2. `cb20_business_rule_audit.csv` — все active cb20 с bucket
3. `cb20_invalid_active_access.csv` — repair-list
4. `cb20_business_crosscheck_matrix.csv`
5. `cb20_active_full_proof.csv` — after-proof
6. `cb20_mass_disable_repair_list.csv`
7. `cb20_rule_proven_active_only.csv` — финальный список оставшихся active
8. `cb20_rules_from_admin_ui_snapshot.csv`
9. `module_access_visibility_chain_14_14.csv`
10. `grant_access_tail_cleanup_audit.csv`
11. `access_decision_paths_removed.csv` — колонки: old_path, file, why_forbidden, removed_or_redirected_to, final_resolver_path
12. `access_rules_sot_mapping.csv`

### EXECUTE 5: Финальный proof

5-10 контрольных кейсов: product rule in UI → exact IDs → order/subscription → entitlement → visibility → proof из access_rule_id.

---

### Файлы для изменения (полный список)

1. `supabase/functions/subscription-charge/index.ts` — убрать `product_club_mappings`
2. `supabase/functions/bepaid-get-subscription-details/index.ts` — убрать `product_club_mappings`
3. `supabase/functions/bepaid-webhook/index.ts` — убрать `product_club_mappings`
4. `supabase/functions/_shared/resolve-effective-access.ts` — убрать `product_club_mappings`
5. `supabase/functions/_shared/invite-link-helper.ts` — убрать `product_club_mappings`
6. `supabase/functions/telegram-process-access-queue/index.ts` — убрать `product_club_mappings`
7. `src/components/admin/DealDetailSheet.tsx` — public_id вместо UUID
8. `src/components/admin/ContactDetailSheet.tsx` — public_id вместо UUID
9. `src/components/admin/bepaid/ContactDealsDialog.tsx` — public_id вместо UUID

### Что НЕ изменяется

- `access-resolver.ts` — уже готов
- `grant-access-for-order/index.ts` — уже переведён
- `repair-cb20-entitlements/index.ts` — уже mechanical executor
- `entitlement-sync.ts` — уже без fallback sets
- `product_club_mappings` таблица — не удаляется, только runtime reads переводятся
- bepaid-webhook: минимальная правка club lookup (допустимо по плану)

### STOP-guards

1. Если после спринта остаётся хоть один runtime read из `product_club_mappings` для принятия решений — спринт не выполнен
2. Если остаётся active cb20 без `access_rule_id` — спринт не выполнен
3. Если в UI остаётся UUID вместо public_id — спринт не выполнен
4. Если любая функция может записать entitlement без ссылки на access_rule_id — спринт не выполнен

### DoD

1. 0 runtime reads из `product_club_mappings` (6 файлов переведены на `access_rules`)
2. cb20 repair execute завершён, after-proof подтверждён
3. После execute все active cb20 имеют `access_rule_id`
4. UUID заменён на `public_id` в 3 UI-компонентах
5. 12 артефактов в `/mnt/documents/`
6. 5-10 контрольных кейсов с полной цепочкой rule→resolver→grant→visibility
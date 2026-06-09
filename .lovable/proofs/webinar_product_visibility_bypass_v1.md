# PATCH-WEBINAR-PRODUCT-VISIBILITY-BYPASS-V1 — Proof

## Scope
Frontend-only fix in `src/hooks/useModuleMonthGate.ts` и `src/hooks/useMonthGate.ts`.
Цель: отдельно купленные training_content продукты (вебинары) с явным
`access_rules.conditions.allowed_module_ids|allowed_lesson_ids` должны
обходить month-gate Club-правил при наличии active entitlement.

## Запрещено / не тронуто
- `access_rules` (структура и записи).
- `entitlements` (структура и записи).
- `orders_v2`, `subscriptions_v2`, `grant-access-for-order` — без изменений.
- `_shared/check-month-purchase.ts` и server-side `live-resolve` — без изменений (см. backlog).
- Month-gate Club-логика для месяцев без отдельной покупки — сохранена.

## Discovery: server-side `check-month-purchase`

```
$ rg -rn "check-month-purchase|checkMonthPurchase" supabase/ src/
supabase/functions/live-resolve/index.ts: import { checkMonthPurchase, ... }
supabase/functions/live-resolve/index.ts:236  monthCheck = await checkMonthPurchase(...)
supabase/functions/_shared/check-month-purchase.ts (definition)
src/hooks/useMonthGate.ts (client SOT comment only)
src/hooks/useModuleMonthGate.ts (client SOT comment only)
```

Единственный server-side consumer — `live-resolve`, и он использует:
- таблицу `live_event_access_rules` (отдельная от `access_rules`),
- контекст `event.metadata.content_month` (live event playback).

В runtime-доступе к lesson/training_content/skachivанию материалов
`check-month-purchase` НЕ участвует. Видимость и доступ к урокам в
«Базе знаний» определяются клиентскими хуками + `useSidebarModules` /
`resolveTrainingContentFilter`, которые month-gate не вызывают через
edge function.

→ Server-side mirror НЕ нужен в этом патче. Записано в backlog:
`.lovable/backlog/webinar_live_resolve_product_bypass_followup.md`.

## Данные Наиры (user_id `f41c429b-ff68-4980-a9da-7f4f8ce18751`)

Active entitlements + matching active training_content rules
(target_ref = root БЗ `8b1fb03e-8743-4654-a07f-b6c03ca7517b`):

| product_id | product_name | rule_id | tariff_id | mode | allowed_module_ids | match_month |
|---|---|---|---|---|---|---|
| 11c9f1b8…3616 | Gorbova Club | 19b66114…a566 | b276d8a5…2c6c | partial | `[f5dc3e63…0630, 81cf626a…b588d]` | — |
| 11c9f1b8…3616 | Gorbova Club | 6f81ef7e…011e | b018e9be…9080 | full | `[]` | true |
| 11c9f1b8…3616 | Gorbova Club | 70510431…698834 | 7c748940…22d3 | full | `[]` | true |
| 84055f12…ab52 | Вебинар «Штрафы» | ecf3e655…0ed9b0 | NULL | partial | `[24b5980d…708c]` | — |
| 62a522a5…ef1a | Вебинар «Камералка» | 6b1a950d…d03b6f | NULL | partial | `[31b94135…9fbb6]` | — |
| c153c811…e813 | Деньги BY 1 тариф | dea6dbed…2c78d | NULL | full | `[]` | — |

## Bypass-резолюция (новая логика)

Для каждого webinar-модуля Наиры:

1. **Module `24b5980d-922d-41ab-ab18-cc123a0e708c` (Штрафы)**
   - product entitlement exists: ✅ `84055f12…ab52` (active, expires `2026-07-09`).
   - matching `access_rule.product_id = 84055f12…ab52`: ✅ `ecf3e655…0ed9b0`.
   - rule: active, `grant_target_type='training_content'`, `target_ref=8b1fb03e…517b`, `allowed_module_ids` contains module: ✅.
   - → `bypassModuleIds.add(24b5980d…708c)` → month-gate **skipped**.

2. **Module `31b94135-1cba-484e-9e52-bc9a446f9bb6` (Камералка)**
   - product entitlement exists: ✅ `62a522a5…ef1a` (active, expires `2026-07-09`).
   - matching `access_rule.product_id = 62a522a5…ef1a`: ✅ `6b1a950d…d03b6f`.
   - rule: active, training_content, target_ref root БЗ, `allowed_module_ids` contains module: ✅.
   - → bypass → month-gate **skipped**.

3. **Club full-rules с пустым allowlist** (6f81ef7e, 70510431):
   - `allowed_module_ids = []` → НЕ попадают в `bypassCandidateRules`.
   - Логика month-gate для них сохранена: модули Club, для которых месяц
     не куплен, остаются заблокированы.

## Контракт bypass (обязательная логика)

```ts
// Bypass только если ВСЕ условия:
const allowed = rule.conditions.allowed_module_ids; // или allowed_lesson_ids
rule.is_active === true
&& rule.grant_target_type === 'training_content'
&& rootIds.includes(rule.target_ref)
&& rule.product_id != null
&& Array.isArray(allowed) && allowed.length > 0   // explicit partial
&& entitlement.user_id === auth.uid()
&& entitlement.status === 'active'
&& (entitlement.expires_at == null || entitlement.expires_at > now())
&& entitlement.product_id === rule.product_id
&& allowed.includes(candidate.module_id)          // или lesson_id
```

`access_mode='full'` + пустой `allowed_module_ids` → НЕ bypass.
`tariff_id IS NULL` на rule сам по себе НЕ открывает всё.

## Verify matrix

| Сценарий | Ожидание | Источник |
|---|---|---|
| Наира: 2 купленных вебинара (Штрафы, Камералка) | открыто | explicit bypass |
| Наира: другие месяцы Club без покупки | закрыто | month-gate Club rule остаётся |
| BUSINESS без webinar-entitlement и без month purchase | закрыто | bypass не применим (нет entitlement) |
| BUSINESS с matching month purchase | открыто | существующая Club-логика |
| Пользователь без доступа | закрыто | hook возвращает month_mismatch |
| Admin | открыт | sidebar/admin bypass выше по стеку |

## Файлы
- `src/hooks/useModuleMonthGate.ts` — добавлен `bypassModuleIds` блок + `continue` в основном цикле.
- `src/hooks/useMonthGate.ts` — добавлены `bypassModuleIds` + `bypassLessonIds` + `continue`.
- `.lovable/backlog/webinar_live_resolve_product_bypass_followup.md` — discovery в backlog.

## DoD
- [x] Discovery server-side: единственный consumer — `live-resolve` (live event playback), training_content runtime не задействован → backlog.
- [x] Bypass строго partial explicit, full+empty не бьёт month-gate.
- [x] Entitlements фильтруются: user_id + status='active' + expires_at + product_id ∈ candidate set.
- [x] access_rules фильтруются: is_active=true, grant_target_type='training_content', target_ref ∈ rootIds.
- [x] Приоритет: explicit product-grant bypass > Club month-gate.
- [x] Month-gate Club-логика для не-bypass модулей сохранена.

## да, согласен, с учетом правок:

1. В п.1 зафиксируй точный source of truth для admin-bypass:
  &nbsp;
  &nbsp;
  - сначала подтвердить фактические значения ролей в `user_roles` (`admin` / `super_admin` или `superadmin`);
  - не хардкодить `superadmin`, пока не подтверждено реальное значение в БД.  
  Это важно, иначе bypass может не сработать у части админов.
2. В `resolveAiAccess` добавь явное правило приоритета:
  - `admin/super_admin` bypass проверяется **раньше** entitlements;
  - если bypass сработал, чтение entitlements не выполняется вообще.  
  Это нужно зафиксировать в плане как инвариант, а не только в описании реализации.
3. В п.2 уточни контракт `resolveAiAccessStatus`:
  - для admin `tier='full'`, `is_admin=true`;
  - `allowed_modes.chat=true`, `allowed_modes.prompt=true`;
  - `quota_by_mode.* = { used: 0, limit: -1, remaining: -1 }`;
  - `cta_target = null`;
  - `denial_reasons = []`.  
  Иначе фронт может продолжить показывать CTA даже при unlimited.
4. В п.3 добавь явную правку UI-текста:
  - вместо числового лимита показывать `Без лимита` или `∞`, но единообразно во всех местах;
  - не оставлять смешанный рендер `-1 / ∞ / unlimited`.  
  Один формат на всём `/ai` и `/admin/ai`.
5. В п.4 зафиксируй, что для admin снимаются только:
  - quota checks,
  - per-minute rate,
  - daily chars budget,
  - tier enforcement.  
  Но **не** снимаются:
  - auth,
  - hard cap на размер одного сообщения,
  - upload guard по mode/scenario,
  - off-topic classifier.  
  Это важно для безопасности и чтобы bypass не стал “полным обходом вообще всего”.
6. В shared-тесты добавь ещё 2 кейса:
  - `admin + просроченные/отсутствующие entitlements` → всё равно `full`;
  - `admin + mode='prompt' + unknown future scenario` → `allowed:true`.  
  Это закрепит обещание “в т.ч. для будущих сценариев”.
7. В verify добавь отдельную негативную проверку:
  - обычный пользователь с Club/Business не получает admin-bypass и по-прежнему ограничивается quota/rate-limit.  
  Иначе можно случайно снять лимиты всем full-tier пользователям.
8. В DoD уточни proof по backend:
  - для admin в `ai_chat_messages.metadata` есть `admin_bypass=true`;
  - для не-admin этого флага нет;
  - для admin нет `quota_denied_*` и `rate_limit_per_minute` на тех же сценариях, где у обычного пользователя они срабатывают.
9. В ограничения добавь:
  - не меняем `ai-access-status` response shape, кроме add-only поля `is_admin` и unlimited semantics;
  - не меняем access-matrix для обычных пользователей;
  - не меняем deny-reasons для ЗГ / без entitlements.
10. В отчёте потребуй отдельную таблицу:

&nbsp;

- actor: `admin` / `zg_only` / `full_user` / `none`
- chat
- balance_analysis
- 107NK
- quota applied
- CTA shown
- expected result / actual result.
- &nbsp;
- Проблема

`supabase/functions/_shared/ai-access.ts` вычисляет доступ к AI-помощнику исключительно по активным entitlements на три хардкод-продукта (`ЗАКРОЙ ГОД`, `Gorbova Club`, `Business`). Роль пользователя не учитывается — поэтому admin/superadmin получают `tier='none'` и видят «Свободный чат недоступен на вашем тарифе» / «Сценарий … недоступен на вашем тарифе», хотя должны иметь полный доступ.

Второй пункт — проверка ЗГ. Текущий маппинг совпадает с уточнением пользователя: `ЗАКРОЙ ГОД → только balance_analysis` (chat=false, 107NK=false, прочие брендированные сценарии=false). Правки контента не требуются, но нужно добавить рантайм-проверку и юнит-тест, чтобы негативная гарантия («никто без нужного продукта не проходит») не сломалась.

Источник истины остаётся хардкод в `_shared/ai-access.ts` (согласно ответу — UI-настройки не заводим).

## План правок (V1 — read-only diagnose уже сделан, ниже — Execute)

### 1. `supabase/functions/_shared/ai-access.ts` — bypass для admin/superadmin

Расширить `AiAccess`:

```ts
export interface AiAccess {
  tier: 'full' | 'zg_only' | 'none';
  chat: boolean;
  balance_analysis: boolean;
  '107NK': boolean;
  is_admin: boolean;   // новое: true → снимает лимиты и tier-checks
}
```

В `resolveAiAccess`:

1. Читать роль через `user_roles` (`role in ('admin','superadmin')`) service-клиентом. Один запрос перед проверкой entitlements.
2. Если admin → вернуть `{ tier:'full', chat:true, balance_analysis:true, '107NK':true, is_admin:true }` без чтения entitlements.
3. Иначе — текущая логика по entitlements + `is_admin:false`.

В `isModeAllowed`:

- Если `access.is_admin` → всегда `{ allowed: true }` (в т.ч. для любых будущих сценариев).

### 2. `resolveAiAccessStatus` — квоты «безлимит» для admin

- Для `is_admin=true` возвращать `used=0, limit=-1, remaining=-1` во всех trois slot'ах (`chat` / `balance_analysis` / `107NK`), пропуская `countUserMessages`.
- `denial_reasons` не меняем; `allowed_scenarios` для admin — все `allowed:true, denial_reason: undefined`.

### 3. `useAiAccess.ts` (frontend) — рендер безлимита

- Тип `AiAccessQuotaSlot` расширить: `limit: number` уже подходит, договоримся, что `-1 = unlimited`.
- В `ChatScenarioLauncher` / `AiPageContent`, где показываются квоты, отрисовать «∞» когда `limit === -1`. Проверить `chatAllowed` — оно уже через `allowed_modes.chat`, для admin вернётся `true`.

### 4. `supabase/functions/gorbova-ai-chat/index.ts` — снятие enforcement для admin

- После `resolveAiAccess` и `isModeAllowed`: если `access.is_admin`, пропустить блоки `daily_limit_reached / monthly_limit_reached`, `per_minute_rate`, `daily_chars_budget`. Off-topic classifier сохраняем — он ограничивает тематику, а не доступ.
- Сохраняем логирование `access_tier='full', admin_bypass=true` в `metadata`.

### 5. Негативная гарантия (нельзя дать доступ никому лишнему)

Добавить единственный шаред-тест `supabase/functions/_shared/ai-access.test.ts`:

- `resolveAiAccess` с пустыми entitlements + без роли → `tier='none'`, все `false`.
- Только ЗГ активен → `tier='zg_only', balance_analysis=true`, chat/107NK=false.
- Только Club → `tier='full'`.
- admin без entitlements → `tier='full', is_admin=true`.
- Просроченный entitlement (expires_at < now) → игнорируется.
- `isModeAllowed(zg, 'prompt', '107NK')` → `{ allowed:false, reason:'107NK_not_in_tier' }`.
- `isModeAllowed(zg, 'prompt', 'other_branded')` → `{ allowed:false, reason:'scenario_requires_full_tier' }`.

### 6. Диплой и верификация

- `supabase--deploy_edge_functions` для `ai-access-status` и `gorbova-ai-chat`.
- Ручная проверка через Playwright: залогинен админом (уже login as developer), открыть `/admin/ai?sub=chat`, убедиться, что:
  - нет плашек «недоступно на тарифе» ни у одного сценария;
  - `Свободный чат` работает (input активен, placeholder не «недоступен…»);
  - вызов `sendMessage` возвращает ответ (проверить `ai_chat_messages` insert).
- Позитив: подписаться пользователем без entitlements → все плашки на месте.
- Позитив: пользователь только с ЗГ → доступен только «Анализ баланса», чат и 107НК заблокированы (правильными denial-текстами).

### 7. DoD

- typecheck PASS
- edge functions deployed
- shared-тест PASS
- admin: полный доступ ко всему AI (chat + все сценарии), лимиты сняты
- user с ЗГ: только `balance_analysis`
- user без entitlements: ничего
- негативная проверка: user без ЗГ/Club/Business не может открыть 107НК / chat
- отчёт «Отчет о выполненной работе: PATCH-AI-ACCESS-ADMIN-BYPASS-V1» с таблицей

### Ограничения (что НЕ делаем)

- Не создаём UI-настройку «сценарий → продукт» (по ответу — оставить хардкод).
- Не трогаем правила `ЗАКРОЙ ГОД → balance_analysis` (уже корректно).
- Не меняем rate-limit и off-topic classifier для обычных пользователей.
- Не переносим маппинг ролей в БД-функцию — используем существующую `user_roles` + inline read; `has_role` RPC не нужен, потому что service-client уже привилегирован.
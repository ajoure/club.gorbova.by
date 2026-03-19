# да, согласен, с учетом правок:

&nbsp;

1. Убрать фразу “Утвердите план” / любые просьбы подтвердить  
План должен быть самодостаточный (без запроса подтверждения в конце).
2. Заменить “deploy-пруф через audit_logs deploy%” на корректный пруф деплоя  
audit_logs не является надежным источником факта деплоя. В план добавить один из обязательных вариантов пруфа (любой 1+):

&nbsp;

&nbsp;

&nbsp;

- Supabase Dashboard → Edge Functions → Deployments/Logs: скрин с временем деплоя + версией/хешем.
- CLI лог: вывод supabase functions deploy <name> (и/или supabase functions list) со временем.
- Add-only version stamp в коде: const DEPLOY_TAG = '2026-03-19T...' + лог/ответ функции, где этот tag виден.

&nbsp;

&nbsp;

&nbsp;

3. Разделить “нет логов” на 2 разные причины (deploy vs invoke)  
В отчет и план добавить явную проверку:

&nbsp;

&nbsp;

&nbsp;

- (A) функция задеплоена (пруф из п.2)
- (B) функция реально запускалась после деплоя (пруф: логи запуска/либо запись subscription.reminders_cron_completed/добавленные audit-события reminders.* с created_at >= DEPLOY_TIME)

&nbsp;

&nbsp;

&nbsp;

4. DoD-2/3/4 формализовать через новые audit events (которые вы уже добавили)  
В план включить точные запросы:

&nbsp;

&nbsp;

&nbsp;

- [reminders.sbs](http://reminders.sbs)_fallback_hit(_no_product)
- reminders.paylink_cta_suppressed_sbs
- reminders.paylink_cta_generated  
с фильтром created_at >= DEPLOY_TIME_UTC.

&nbsp;

&nbsp;

&nbsp;

5. Пруф “paylink НЕ генерировался” сделать корректным  
Ожидание не “0 строк вообще”, а:

&nbsp;

&nbsp;

&nbsp;

- для orphan users из DoD-1 нет reminders.paylink_cta_generated после DEPLOY_TIME,
- и есть reminders.paylink_cta_suppressed_sbs / [reminders.sbs](http://reminders.sbs)_fallback_hit* для тех же user_id.

&nbsp;

&nbsp;

&nbsp;

6. В план добавить минимальный “manual invoke” сценарий (без предположений про cron)  
Чтобы закрыть DoD сразу: ручной запуск функции + затем SQL-пруфы с временным окном.
7. В отчет добавить явный timestamp DEPLOY_TIME (UTC) как единый якорь  
Без него все “0 записей” неинтерпретируемо (возможно, просто окно не то).

&nbsp;

&nbsp;

Статус-отчет: PATCH A/B/C — факты и блокеры

## 1. Код-изменения в репозитории — ПОДТВЕРЖДЕНЫ ✅


| Патч                                                                       | Файл                                                                                   | Статус                                                   | Пруф                                                                                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **A** (hasActiveSBS: убран early return, безусловный fallback, STOP-guard) | `subscription-renewal-reminders/index.ts` строки 49-122                                | ✅ Код корректен                                          | `let found = false;` + `if (productId) { ... }` + fallback `.gte('next_charge_at', oneDayAgo...)` + `return true` при fallbackError |
| **B** (priority '4b' → 5)                                                  | `bepaid-get-subscription-details/index.ts` строка 313                                  | ✅ `priority: 5, autolink_source: 'user_only_single_sub'` | ripgrep `'4b'` по `supabase/functions/` → 0 совпадений                                                                              |
| **C** (audit paylink_cta_generated / suppressed)                           | `subscription-renewal-reminders/index.ts` строки 746-757 + 758-770 + 905-918 + 866-876 | ✅ 2 места generated + 2 места suppressed                 | search подтвердил 4 вхождения                                                                                                       |


## 2. Деплой — НЕ ПОДТВЕРЖДЁН ❌

Edge function logs для `subscription-renewal-reminders` возвращают **пусто** — ни одного лога (ни boot, ни runtime). Это означает одно из:

- Функция НЕ была задеплоена после последних правок
- Функция не вызывалась cron'ом/вручную после деплоя
- Логи за этот период недоступны

**Без подтверждения деплоя DoD-пруфы невозможны.**

Для `bepaid-get-subscription-details` — логи тоже пусто в текущем окне, но она вызывается только при sync (не cron). Audit logs `bepaid.sync.access_chain_applied` присутствуют (последний: `2026-03-19 07:37:45 UTC`), что косвенно подтверждает деплой этой функции.

## 3. DoD-пруфы (SQL) — ЧАСТИЧНО

### DoD-1: Orphan provider_subscriptions ✅

```
sbs_c8aa1cf60778cdf6 | user 523168b2... | active | next_charge: 2026-04-17
sbs_2ba8ec82d7d5c39b | user 252e4b5c... | active | next_charge: 2026-03-22
```

2 orphan записи найдены — тестовая база для проверки есть.

### DoD-2: Fallback hit / suppressed / generated — **0 записей** ❌

```sql
audit_logs WHERE action IN ('reminders.sbs_fallback_hit', ..., 'reminders.paylink_cta_generated', ...) → []
```

Ни одного события. Это значит:

- `subscription-renewal-reminders` **НЕ запускалась** после деплоя PATCH A/C, ИЛИ
- деплой не произошёл

### DoD-3/4: Невозможны без DoD-2

## 4. Блокер

**Для закрытия DoD необходимо:**

1. **Задеплоить** обе edge functions (я могу сделать это в режиме выполнения)
2. **Вызвать** `subscription-renewal-reminders` (ручной invoke или дождаться cron)
3. **Повторить SQL-пруфы** DoD-2/3/4 с фильтром `created_at >= deploy_timestamp`

## 5. Предлагаемый план действий

1. Задеплоить `subscription-renewal-reminders` и `bepaid-get-subscription-details`
2. Вызвать `subscription-renewal-reminders` через curl (dry-run или полный запуск)
3. Выполнить SQL DoD-1..4
4. Сформировать финальный отчёт с фактами

Утвердите план для выполнения.
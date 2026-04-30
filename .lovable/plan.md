да, согласен, с учетом правок:

1. Исторические строки лучше не удалять сразу. Сначала пометить:

UPDATE email_logs

SET meta = meta || jsonb_build_object('ui_hidden', true, 'hidden_reason', 'technical_outcome_marker')

WHERE from_email='system'

  AND subject IS NULL

  AND html IS NULL

  AND text IS NULL

  AND meta->>'source'='subscription-renewal-reminders';

2. UI должен фильтровать meta.ui_hidden=true, чтобы такие записи не попадали в «Историю переписки».
3. В subscription-renewal-reminders технический outcome больше не писать в email_logs. Реальный лог уже пишет send-email.
4. Ошибки/skip по email писать в audit_logs, не в email_logs.
5. DoD добавить:

SELECT count(*) FROM email_logs

WHERE meta->>'ui_hidden'='true'

  AND meta->>'hidden_reason'='technical_outcome_marker';

Можно выполнять.

&nbsp;

## Что происходит

В карточке контакта во вкладке «Письма» рядом с реальными письмами показываются строки **«(Без темы)»** без текста и без возможности открыть. На том же контакте (Антонина Ерастова) сегодня видно 3 такие подряд.

### Диагностика (что уже подтверждено)

В таблице `email_logs` лежат два разных типа записей:


| Тип строки       | `from_email`         | `subject` | `body_html` | `provider`    | Что это                                                      |
| ---------------- | -------------------- | --------- | ----------- | ------------- | ------------------------------------------------------------ |
| Реальное письмо  | `noreply@gorbova.by` | заполнен  | есть        | `yandex_smtp` | Само письмо, ушло в SMTP                                     |
| Служебный маркер | `system`             | `NULL`    | `NULL`      | `NULL`        | Технический след о попытке постановки в очередь / результате |


Edge Function `subscription-renewal-reminders` для каждой обработанной подписки дополнительно вызывает `logEmailOutcome(...)`, который вставляет в **ту же** таблицу `email_logs` строку с `from_email='system'`, `subject=NULL`, `body=NULL`, `meta.reason ∈ {email_queued, send_failed, ...}`.

Компонент `src/components/admin/ContactEmailHistory.tsx` читает `email_logs` по email **без фильтра** и рендерит ВСЁ как переписку. Отсюда: «Без темы», нет тела, нет provider — открыть нельзя. На контакте с двумя подписками за один прогон возникает 2 «реальных» + 2–3 «маркера» → визуально «по 3 письма».

База: таких фантомов сейчас **77 шт.** (все из `subscription-renewal-reminders`). Других edge-функций, пишущих такие пустые строки, нет (в `send-email`, `email-mass-broadcast`, `generate-document-pdf` записи всегда с заполненным `subject` и `body`).

## Что чиню

### 1. Перестать создавать мусор в `email_logs` (root cause)

`supabase/functions/subscription-renewal-reminders/index.ts`, функция `logEmailOutcome`:

- Убрать запись в `public.email_logs`. Это не переписка с клиентом, а внутренняя телеметрия.
- Перенаправить outcome в `**audit_logs**` (или существующий канал телеметрии напоминаний — проверю и использую тот же, что для остальных outcome). Поля `subscription_id`, `event_type`, `reason`, `error_message` сохраняются в `meta`/`details` без потери информации.
- Дедуп-логика `wasReminderSentRecently`, которая сейчас читает `email_logs` за окно времени по `meta.subscription_id + meta.event_type`, продолжит работать — она опирается на **реальную** запись о письме (там `subscription_id` тоже лежит в `meta`), не на маркер. Проверю это явно по коду перед патчем; если окажется, что дедуп сейчас цепляется именно за маркер `email_queued` — заменю источник на ту же `audit_logs` (или на флаг в `subscription_reminder_*`-таблицах, если такие уже есть).

### 2. Защитный фильтр в UI (на всякий случай и для исторических данных)

`src/components/admin/ContactEmailHistory.tsx`:

- При отрисовке отбрасывать строки, у которых `subject IS NULL` **и** `body_html IS NULL` **и** `body_text IS NULL` — такие записи бесполезны для админа (открыть нечего).
- Дополнительно скрывать `from_email = 'system'` без provider — это технический след, не письмо.

Это страхует от любых будущих регрессий и сразу прячет существующие 77 строк.

### 3. Разовая чистка исторических фантомов

Миграция, которая удалит уже накопленные мусорные записи:

```sql
DELETE FROM public.email_logs
WHERE from_email = 'system'
  AND subject IS NULL
  AND body_html IS NULL
  AND body_text IS NULL
  AND meta->>'source' = 'subscription-renewal-reminders';
```

Затронет ровно 77 строк (точечно по источнику, реальные письма не трогаем).

### 4. Проверка

- Открою карточку Антонины Ерастовой → вкладка «Письма»: останутся только реальные «⏰ Подписка заканчивается через 3 дня» и «📅 Напоминание…», никаких «(Без темы)».
- Прогон скриптом: `SELECT count(*) FROM email_logs WHERE from_email='system' AND subject IS NULL` → 0.
- Проверю, что новые напоминания (следующий cron-тик) больше не создают `from_email='system'` записей — посмотрю edge-логи `subscription-renewal-reminders` после ближайшего запуска.

## Definition of Done

- В UI «История переписки» в карточке контакта нет писем «(Без темы)» без тела.
- В `email_logs` нет и впредь не появляется записей с пустыми subject+body+from='system'.
- Дедуп напоминаний (один и тот же event_type на одну подписку не уходит дважды за окно) сохранён — подтверждено чтением кода и пробным dry-run прогоном `subscription-renewal-reminders`.
- Удалены 77 исторических фантомных строк, реальные письма не затронуты.
- Скриншоты до/после с мобильного вьюпорта той же карточки контакта.
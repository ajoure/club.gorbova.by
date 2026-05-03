## Цель
Во всех уведомлениях о подписке показывать дату/время по Минску с часами:минутами и отдельную строку «⚡ Списание: …» с `next_charge_at` — как в карточке контакта.

## Изменения

### 1. Новый shared helper `supabase/functions/_shared/formatMinsk.ts`
- `formatMinskDateTime(d)` → `"3 мая в 23:59 (Минск)"`
- `formatMinskDateTimeWithYear(d)` → `"3 мая 2026 в 23:59 (Минск)"`

### 2. `supabase/functions/subscription-renewal-reminders/index.ts`
- В выборку подписок (стр. 1140–1158) добавить `next_charge_at, auto_renew`.
- В сигнатуру `sendTelegramReminder(...)` (стр. 366) добавить `nextChargeAt: Date | null`.
- В сигнатуру `sendEmailReminder(...)` (стр. 708) добавить `nextChargeAt: Date | null`.
- Заменить локальные `dateFmt/timeFmt` на `formatMinskDateTime`.
- В `renewalDetailsBlock` (TG, стр. 478–480) добавить строку (только если `hasSBS && nextChargeAt && !isOneTime`):
  ```
  ⚡ *Списание:* 4 мая в 08:00 (Минск)
  ```
- В Email-карточках (стр. 815–852) — аналогичная строка `<p><strong>⚡ Списание:</strong> …</p>` рядом с `amountLineHtml`, под теми же условиями.
- В вызовах `sendTelegramReminder` (стр. 1396) и `sendEmailReminder` (стр. 1426) пробросить `sub.next_charge_at ? new Date(sub.next_charge_at) : null`.

### 3. `supabase/functions/telegram-send-reminders/index.ts`
- Заменить `formattedDate` (стр. 242) на `formatMinskDateTime(expiryDate)` — теперь с часами:минутами и пометкой «(Минск)».
- Если резолвится `subscriptions_v2.next_charge_at` для пары `(user_id, tariff_id)` и `hasSBS=true` — добавить в текст под основной фразой строку:
  ```
  ⚡ Списание: <дата+время Минск>
  ```

### 4. Деплой
`deploy_edge_functions` для `subscription-renewal-reminders` и `telegram-send-reminders`.

## Не трогаем
- One-time продукты — строку «Списание» не добавляем.
- Шаблоны транзакционных писем, RLS, cron, infra — без изменений.
- Карточка контакта — эталон, остаётся как есть.

## DoD
- TG/Email 7/3/1 для подписок с автопродлением: видны две строки — «Доступ до» и «Списание», обе с HH:mm и «(Минск)».
- `telegram-send-reminders` показывает дату+время Минск.
- One-time: строки «Списание» нет, время в «Доступ до» сохранено.
- Smoke: подписка `boginskaya_elena` (БкБ, ежемесячный) — превью текста содержит корректный `next_charge_at`.

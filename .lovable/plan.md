Выполни патч с учетом всех правок выше: UI текста OTP + диагностика и исправление email-deliverability через [hoster.by](http://hoster.by).

Сначала dry-run и DNS/header-аудит, потом только точечные DNS-правки по фактическому отправителю OTP.

Отчет — строго на русском, с DNS before/after, заголовками тестового OTP-письма и скриншотами UI.

&nbsp;

План:

## Контекст

`sent.gorbova.by` — технический делегированный поддомен, через который Lovable управляет SPF/DKIM/DMARC для отправки OTP. Видимый отправитель остаётся `noreply@gorbova.by` (режим display_from_root). Корень `gorbova.by` не трогаем — там MX Яндекса и корпоративная почта.

Текущий статус домена: **Setting up / Verifying** (DNS ещё не подтверждён Lovable).

Причина: в предыдущей чистке DNS удалялись NS-записи `sent.gorbova.by`; они были восстановлены (`ns3/ns4.lovable.cloud`), пропагация подтверждена через Google DoH, но Lovable ещё не финализировал verify + SSL/DKIM issuance.

## Цель

Довести `sent.gorbova.by` до статуса **Active**, чтобы OTP-письма уходили с валидными SPF=PASS, DKIM=PASS, DMARC=PASS и переставали попадать в спам.

## Шаги

1. **Диагностика DNS (dry-run, без правок):**
  - `check_email_domain_status` для `sent.gorbova.by` — снять текущий статус и список ожидаемых записей.
  - Через hoster.by API прочитать актуальную зону `gorbova.by`: убедиться, что `sent NS ns3.lovable.cloud` и `sent NS ns4.lovable.cloud` присутствуют и не дублируются.
  - Через Google DoH проверить, что публично `sent.gorbova.by` резолвится на Lovable NS (SOA, NS, TXT, MX, DKIM CNAME).
  - Проверить, что на корне `gorbova.by` НЕ появилось дублей SPF/DKIM/MX, конкурирующих с Яндексом.
2. **Триггер повторной верификации в Lovable:**
  - Если статус всё ещё `awaiting_dns` / `active_provisioning` спустя окно пропагации — запустить re-verify через `check_email_domain_status` (или сообщить пользователю нажать «Verify Domain» в Cloud → Emails → Manage Domains).
  - Не пересоздавать домен, не удалять записи.
3. **Проверка контура отправки:**
  - `email_send_log` за последние сутки: доля `sent` vs `failed`/`dlq`, `error_message` для сбоев.
  - Убедиться, что `process-email-queue` активна (или on-demand планируется при поступлении писем).
  - `SENDER_DOMAIN` в `send-transactional-email` = `sent.gorbova.by`, `FROM_DOMAIN` = `gorbova.by` (display_from_root). Ничего не менять, только подтвердить.
4. **Тест доставки после Active:**
  - Отправить OTP на тестовый Gmail через реальную форму `/ideologicheskaya-rabota`.
  - Открыть заголовки письма, зафиксировать: `From`, `Return-Path`, `DKIM-Signature d=`, `Authentication-Results` (spf/dkim/dmarc).
  - Проверить, что письмо попадает в Inbox, а не в Spam/Promotions.
5. **Отчёт:**
  - DNS before/after (без изменений в этой итерации, только фиксация состояния).
  - Скриншот статуса домена = Active.
  - Заголовки тестового письма с PASS по трём проверкам.
  - Куда падает письмо в Gmail.

## Что НЕ делаем

- Не удаляем `sent.gorbova.by` и NS-делегирование.
- Не трогаем MX/SPF/DMARC на корне `gorbova.by` (Яндекс работает).
- Не меняем UI формы заявки — правки из прошлой итерации остаются.
- Не переключаемся на сторонний SMTP.

## Definition of Done

- Статус домена `sent.gorbova.by` в Lovable = **Active**.
- Тестовое OTP-письмо на Gmail: `SPF=PASS`, `DKIM=PASS`, `DMARC=PASS`, `d=sent.gorbova.by` (или корневой при display_from_root — согласовано с Lovable).
- Письмо приходит во «Входящие», не в «Спам»/«Промоакции».
- Корпоративная почта Яндекса на `@gorbova.by` продолжает работать без деградации.
- DNS-снимок и заголовки письма приложены в `.lovable/proofs/`.

Отчёт по завершении — на русском.
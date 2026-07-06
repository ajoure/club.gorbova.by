# sent.gorbova.by — статус верификации (2026-07-06)

## Итог
- **Домен нужен, не удаляем.** `sent.gorbova.by` — делегированный поддомен для DKIM/SPF/MX Mailgun. Видимый `From` остаётся `noreply@gorbova.by` (display_from_root). Корень `gorbova.by` не тронут — там Яндекс MX для корпоративной почты.
- **Статус Lovable:** `Setting up / Verifying DNS`. NS-делегирование восстановлено, ожидаем финализацию DKIM/SSL.

## DNS snapshot (Google DoH, 2026-07-06)

### sent.gorbova.by
| Тип | Значение |
|---|---|
| NS | ns3.lovable.cloud, ns4.lovable.cloud ✅ |
| SOA | ns3.lovable.cloud dns.cloudflare.com ✅ |
| MX | 10 mxa.eu.mailgun.org, 10 mxb.eu.mailgun.org ✅ |
| TXT (SPF) | `v=spf1 include:mailgun.org ~all` ✅ |
| DKIM CNAME (k1/krs/…) | NXDOMAIN ⏳ — Lovable ещё не опубликовал селектор |

### gorbova.by (корень, не тронут)
| Тип | Значение |
|---|---|
| MX | 10 mx.yandex.net ✅ |
| TXT (SPF) | `v=spf1 include:_spf.yandex.net ~all` ✅ |
| _dmarc TXT | `v=DMARC1; p=none; pct=100; rua=mailto:dmarcreports@lovable.dev` ✅ |

## Что делать
1. **Ждать 5–60 минут**: Lovable опубликует DKIM CNAME в зоне `sent.gorbova.by` через Cloudflare, домен перейдёт в **Active**.
2. **Если через 24 ч всё ещё Verifying** — открыть `Cloud → Emails → Manage Domains → Verify Domain`. Записи менять не нужно.
3. **После Active** — прогнать тестовый OTP на Gmail, зафиксировать `Authentication-Results` (SPF/DKIM/DMARC = PASS) и куда пришло письмо.

## Что НЕ делаем
- Не удаляем NS `sent.gorbova.by → ns3/ns4.lovable.cloud`.
- Не трогаем корневые SPF/MX/DMARC — Яндекс продолжает работать.
- Не переключаемся на сторонний SMTP.

## Замечания на будущее (out of scope этой итерации)
- `email_send_log` в БД отсутствует → `setup_email_infra` никогда не запускался. Текущий `auth-email-hook` использует старый паттерн `@lovable.dev/email-js` (синхронная отправка через `callback_url`, без очереди/ретраев). Работает, но нет DLQ/логов. Апгрейд на очередь — отдельным запросом.

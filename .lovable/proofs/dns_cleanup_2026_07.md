# DNS cleanup gorbova.by — 2026-07-06

Zone: `gorbova.by`, hoster.by order `71015`.
Executed by edge function `hosterby-api` (actions: `replace_dns_recordset`, `replace_dns_txt_recordset`, `delete_dns_recordset`).
Audit-log actions: `hosterby.replace_dns_recordset`, `hosterby.replace_dns_txt_recordset`, `hosterby.delete_dns_recordset`.

## Applied changes

| # | Действие | Запись | До | После |
|---|---|---|---|---|
| 1 | replace A | `www.gorbova.by` | `45.155.60.8` | `185.158.133.1` |
| 2 | replace MX | `gorbova.by` | `0 mx.getcourse.ru` + `10 mx.yandex.net` | `10 mx.yandex.net` |
| 3 | replace TXT (SPF) | `gorbova.by` | `v=spf1 include:_spf.yandex.net include:_spf.amocrmmail.com include:spf.unisender.com include:901df39854d42bf212f9e8977673868e.gca.to ~all` | `v=spf1 include:_spf.yandex.net ~all` |
| 4 | delete TXT (DKIM) | `us._domainkey.gorbova.by` | Unisender DKIM | — |
| 5 | delete TXT (DKIM) | `getcourse._domainkey.gorbova.by` | GetCourse DKIM | — |
| 6 | delete TXT (DKIM) | `b96f2caab091c9f97c8f5b86722e52a6._domainkey.gorbova.by` | неизвестный DKIM-селектор | — |
| 7 | delete NS | `edu.gorbova.by` | gcloudns / getcourse (с битым суффиксом) | — |
| 8 | delete NS | `sent.gorbova.by` | `ns3.lovable.cloud`, `ns4.lovable.cloud` | — |

SOA serial bumped `2026070601 → 2026070609` — 9 authoritative изменений подтверждены hoster.by.

## Оставшиеся записи (после очистки, из `list_dns_records`)

- **Служебные**: SOA `u1.hoster.by`, NS `u1/u2.hoster.by`, A `gorbova.by → 185.158.133.1`.
- **Lovable-поддомены (A → 185.158.133.1)**: `www`, `calendar.club`, `club`, `cb`, `cons`, `consultation`, `zg`.
- **Lovable verify (TXT)**: `_lovable.gorbova.by` + `_lovable.<subdomain>.gorbova.by` для каждого поддомена, `_lovable-email.gorbova.by`.
- **Почта Яндекс**: MX `10 mx.yandex.net`, CNAME `mail.gorbova.by → domain.mail.yandex.net`, DKIM `mail._domainkey.gorbova.by` (1024, `t=s` — рекомендация: перевыпустить 2048 без `t=s` в кабинете Яндекса; DNS-запись обновляется автоматически).
- **DMARC**: `_dmarc.gorbova.by → v=DMARC1; p=none; pct=100; rua=mailto:dmarcreports@lovable.dev` — оставлено; при желании позже `rua` можно перевести на `postmaster@gorbova.by`.
- **Gotenberg**: `pdf.gorbova.by → 178.172.173.1`.
- **SPF**: единственная запись `v=spf1 include:_spf.yandex.net ~all` — соответствует RFC 7208 §4.5 (одна SPF-строка на домен).

## Пост-проверка (после истечения TTL, максимум 60 мин)

```
dig +short A www.gorbova.by                    # → 185.158.133.1
dig +short MX gorbova.by                       # → 10 mx.yandex.net.
dig +short TXT gorbova.by                      # → "v=spf1 include:_spf.yandex.net ~all"
dig +short TXT us._domainkey.gorbova.by        # → (пусто)
dig +short TXT getcourse._domainkey.gorbova.by # → (пусто)
dig +short NS edu.gorbova.by                   # → (пусто)
dig +short NS sent.gorbova.by                  # → (пусто)
```

Тестовое письмо на Gmail → «Show original»:
- `SPF: PASS` (mail-from `noreply@gorbova.by`, `_spf.yandex.net`)
- `DKIM: PASS` (селектор `mail`)
- `DMARC: PASS` (alignment по домену `gorbova.by`)

## Rollback

Все удалённые записи логированы в аудит (`writeAuditLog`, action=`hosterby.delete_dns_recordset`, содержит `name`, `type`). При необходимости восстановить достаточно вызвать `replace_dns_recordset` с тем же payload — исходные значения зафиксированы выше в таблице «До».

Да, в таком случае план нужно скорректировать.

Добавь ему следующее:

---

**Дополнение к плану:**

1. **Пункт 8 (**`b96f2caab091c9f97c8f5b86722e52a6._domainkey`**)**  
Пользователь подтверждает, что происхождение записи неизвестно. Это неиспользуемый исторический DKIM-селектор. Его **удалить** вместе с остальными устаревшими DKIM-записями.
2. `sent.gorbova.by`  
Удалить полностью делегирование:
  - `sent.gorbova.by NS ns3.lovable.cloud`
  - `sent.gorbova.by NS ns4.lovable.cloud`
  Это старый служебный email-subdomain Lovable, который больше не используется и не должен оставаться в DNS.
3. **После удаления обязательно проверить**, что:
  - никакие текущие сервисы gorbova.by не используют `sent.gorbova.by`;
  - отправка писем продолжается через текущую инфраструктуру (`noreply@gorbova.by` / Яндекс);
  - удаление `sent.gorbova.by` не влияет на регистрацию домена в Lovable, так как email-отправка через него больше не используется.
4. **Обновить раздел «Мусор — на удаление»**, добавив:


| **#** | **Запись**        | **Тип** | **Причина**                                                                    |
| ----- | ----------------- | ------- | ------------------------------------------------------------------------------ |
| 10    | `sent.gorbova.by` | NS      | Старое делегирование Lovable Email. Больше не используется, удалить полностью. |


5. После очистки приложить полный список DNS-записей **до** и **после**, чтобы можно было убедиться, что в зоне не осталось исторического мусора.
6. &nbsp;
7. План: аудит и очистка DNS gorbova.by на hoster.by

## 1. Инвентаризация (полный список записей из hoster.by API)

### Служебные / рабочие — НЕ ТРОГАТЬ


| Запись                                                      | Тип      | Значение                                                         | Назначение                                                                     |
| ----------------------------------------------------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `gorbova.by`                                                | SOA / NS | `u1.hoster.by`, `u2.hoster.by`                                   | Делегирование зоны hoster.by                                                   |
| `gorbova.by`                                                | A        | `185.158.133.1`                                                  | Основной сайт (Lovable)                                                        |
| `calendar.club`, `club`, `cb`, `cons`, `consultation`, `zg` | A        | `185.158.133.1`                                                  | Кастомные поддомены Lovable                                                    |
| `_lovable.*` (7 шт.)                                        | TXT      | `lovable_verify=...`                                             | Верификация доменов Lovable                                                    |
| `_lovable-email.gorbova.by`                                 | TXT      | `lovable_email_verify=...`                                       | Верификация email-домена Lovable                                               |
| `sent.gorbova.by`                                           | NS       | `ns3/ns4.lovable.cloud`                                          | Делегирование под email-sender Lovable                                         |
| `pdf.gorbova.by`                                            | A        | `178.172.173.1`                                                  | Gotenberg VPS на hoster.by (DOCX→PDF)                                          |
| `mail.gorbova.by`                                           | CNAME    | `domain.mail.yandex.net`                                         | Веб-интерфейс Яндекс.Почты                                                     |
| `gorbova.by` MX 10                                          | MX       | `mx.yandex.net`                                                  | Приём почты (Яндекс, ящик `noreply@gorbova.by`)                                |
| `mail._domainkey`                                           | TXT      | `v=DKIM1; k=rsa; t=s; p=...` (1024 бит)                          | DKIM Яндекса. Оставить; отдельно рекомендую перевыпустить в 2048 бит без `t=s` |
| `_dmarc`                                                    | TXT      | `v=DMARC1; p=none; pct=100; rua=mailto:dmarcreports@lovable.dev` | DMARC. Оставить; можно позже перевести `rua` на `postmaster@gorbova.by`        |


### Мусор — на удаление


| #   | Запись                                                   | Тип                    | Что это                                                                                                                                       | Причина                                                                    |
| --- | -------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `us._domainkey.gorbova.by`                               | TXT                    | DKIM Unisender                                                                                                                                | Unisender не используется                                                  |
| 2   | SPF-include `spf.unisender.com`                          | часть TXT `gorbova.by` | Unisender SPF                                                                                                                                 | Unisender не используется                                                  |
| 3   | `getcourse._domainkey.gorbova.by`                        | TXT                    | DKIM GetCourse                                                                                                                                | GetCourse не подтверждён как используемый                                  |
| 4   | SPF-include `901df39854...gca.to`                        | часть TXT `gorbova.by` | GetCourse SPF (gca.to = GetCourse Anti-spam)                                                                                                  | GetCourse не подтверждён как используемый                                  |
| 5   | `gorbova.by` MX 0 `mx.getcourse.ru`                      | MX                     | Приём почты через GetCourse (перехватывает всё, т.к. приоритет 0)                                                                             | Не используется; ломает доставку на Яндекс                                 |
| 6   | `edu.gorbova.by`                                         | NS                     | Делегирование `edu.` на `ns1/2/3.gcloudns.com` и `ns1/2.getcourse.ru` (значения к тому же хранятся с ошибкой — двойной суффикс `.gorbova.by`) | Поддомен для курсов GetCourse, не используется; записи битые               |
| 7   | SPF-include `_spf.amocrmmail.com`                        | часть TXT `gorbova.by` | amoCRM SPF                                                                                                                                    | amoCRM не подтверждена как отправитель писем от домена                     |
| 8   | `b96f2caab091c9f97c8f5b86722e52a6._domainkey.gorbova.by` | TXT                    | DKIM с hash-селектором (типично для SendPulse / Mailgun / старой рассылки)                                                                    | Неизвестный отправитель — требует финального подтверждения перед удалением |
| 9   | `www.gorbova.by` A `45.155.60.8`                         | A                      | Указывает на чужой IP (не Lovable, не hoster.by, не Яндекс)                                                                                   | www должен вести на основной сайт                                          |


## 2. Целевое состояние SPF

Вместо текущего:

```
v=spf1 include:_spf.yandex.net include:_spf.amocrmmail.com include:spf.unisender.com include:901df39854d42bf212f9e8977673868e.gca.to ~all
```

Должно стать (только легитимный отправитель — Яндекс, обслуживающий `noreply@gorbova.by`):

```
v=spf1 include:_spf.yandex.net ~all
```

## 3. Порядок выполнения (после перехода в build)

1. **Dry-run**: перечитать список записей и зафиксировать до/после в `.lovable/proofs/dns_cleanup_2026_07.md`.
2. **[www.gorbova.by](http://www.gorbova.by)**: заменить A `45.155.60.8` → `185.158.133.1`.
3. **MX**: удалить строку `0 mx.getcourse.ru`, оставить только `10 mx.yandex.net`.
4. **SPF**: `replace_dns_txt_recordset` для `gorbova.by` → одна запись с целевым SPF выше.
5. **DKIM**: удалить `us._domainkey`, `getcourse._domainkey`, `b96f2caab091...._domainkey` (последнюю — только после подтверждения в п.4 вопроса ниже).
6. **NS edu.gorbova.by**: удалить весь recordset.
7. **Verify** (через 5–15 мин, с учётом TTL 600–3600):
  - `dig +short A www.gorbova.by` → `185.158.133.1`
  - `dig +short MX gorbova.by` → только `10 mx.yandex.net`
  - `dig +short TXT gorbova.by` → одна SPF-строка с Яндексом
  - `dig +short TXT us._domainkey.gorbova.by` / `getcourse._domainkey.gorbova.by` → пусто
  - Отправить тест на Gmail → в «Show Original» SPF=PASS, DKIM=PASS (mail._domainkey), DMARC=PASS.
8. **Proof**: сохранить `dns list_records` до и после + вывод `dig` в `.lovable/proofs/dns_cleanup_2026_07.md`.

## 4. Что нужно подтвердить перед выполнением

- DKIM-селектор `b96f2caab091c9f97c8f5b86722e52a6._domainkey` — узнаваем? (SendPulse/Mailgun/старый Postmark и т.п.) Если не знаешь — я оставлю его, помечу как «unknown, to review» и удалю только по твоей отдельной команде. Всё остальное удалим сразу.
- Также если внезапно всё-таки используется GetCourse/amoCRM для рассылок «от gorbova.by» — скажи, откатим соответствующий пункт до применения.

## 5. Технические детали

- Действия: `list_dns_records`, `add_dns_a_record` (для www нового значения), `replace_dns_txt_recordset` (для SPF), `delete_dns_record` (нужно будет добавить в `hosterby-api/index.ts` — сейчас его нет; реализуется через `PATCH` API hoster.by по аналогии с `replace_dns_txt_recordset`, с fallback `DELETE`+`POST`).
- Для MX и NS-recordset потребуется тот же `PATCH replace_recordset` подход (обобщить существующую функцию до `replace_dns_recordset(name, type, records[])` вместо TXT-only).
- Order ID для gorbova.by: `71015` (уже получен).
- Audit log записать через существующий `writeAuditLog` c action=`hosterby.dns_cleanup_2026_07`.
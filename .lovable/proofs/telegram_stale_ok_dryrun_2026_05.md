# Telegram stale TG-`ok` — dry-run отчёт (2026-05-05)

**Scope:** read-only. Никаких UPDATE / revoke / kick / invite.

## Методика

Берём все строки `telegram_club_members.access_status='ok'` по активным клубам.
Для каждой строки резолвим продукт через `access_rules` (`grant_target_type='club'`, `target_ref::uuid=club_id`)
и считаем `effective_access_status` по `entitlements (user_id, product_id)`:
- `active` — `status='active'` AND (`expires_at IS NULL` OR `expires_at>now()`)
- `expired` — `expires_at<=now()`
- `missing` — entitlement отсутствует
- `unknown_product` — у клуба нет привязки к продукту

Когда у клуба несколько привязанных продуктов (например, Gorbova Club ↔ Gorbova Club + Платная консультация),
выбирается «лучший»: `active > expired > missing > unknown` — это снижает раннее наблюдение в 316 (двойной счёт пар) до **156 уникальных (profile, club)**.

## Результаты (уникальные пары profile×club со stale TG-`ok` и eff≠active)

| Метрика | N |
|---|---|
| **total_stale_ok** | **156** |
| bucket1: физически в чате/канале, доступа нет | 36 |
| bucket2: НЕ в чате/канале, доступа нет | 120 |
| bucket3: TG `ok`, entitlement `expired` | 35 |
| bucket4: TG `ok`, entitlement `missing` | 121 |
| bucket5: клуб не привязан к продукту | 0 |

Buckets 1+2 = 156 = 3+4. Bucket 5 пуст — все активные клубы имеют хотя бы одно `access_rules → product_id`.

### Разрез по клубу

| club | eff | n |
|---|---|---|
| Бухгалтерия как бизнес | missing | 117 |
| Gorbova Club | expired | 34 |
| Gorbova Club | missing | 4 |
| Бухгалтерия как бизнес | expired | 1 |

## Интерпретация

- **Bucket 1 (36)** — приоритет на ручной разбор: люди реально в чате клуба, но у них нет действующего entitlement.
  Возможные причины: ручной add админом без оплаты, истёкший entitlement (часть пересекается с bucket 3), миграционные хвосты.
- **Bucket 2 (120)** — «бумажный» хвост: TG-`ok` остался от старой проверки, человек физически уже не в чате, доступа тоже нет.
  Самый безопасный кандидат на массовое выравнивание `tcm.access_status` без revoke (физический revoke не нужен — их там нет).
- **Bucket 3 / 4 — это разрез того же 156 по причине** (срок истёк vs entitlement не существовал никогда).

## Рекомендации (НЕ выполняем сейчас)

1. **UI уже корректен** — зелёный «Доступ активен» больше не выдаётся по `tcm.access_status`, источник истины — `entitlements`. Все 156 в карточке контакта показываются красным «Доступ истёк / Нет доступа» + жёлтый бейдж «TG-статус устарел».
2. **Bucket 1 (36)** — отдельный manual-review лист для админа (кто, какой клуб, кто добавлял). Решение: либо grant-access (если бизнес-кейс), либо плановый kick (отдельная задача с явным DoD).
3. **Bucket 2 (120)** — кандидат на read-only выравнивание `tcm.access_status` (UPDATE-only, без physical kick), потому что физически их там нет. Делать **отдельным** dry-run+execute с финальным diff и audit.
4. **Не запускать revoke/kick «оптом» по 156** — это нарушит race-condition guard и текущие SOT-правила; только bucket-1 руками, bucket-2 — мягкое выравнивание поля.

## Файлы

- RPC `admin_get_club_memberships_all` — уже даёт `effective_access_status` в UI.
- Этот отчёт — текстовый, без записи в БД.

---

# Bug fix: «Нет данных о членстве в Telegram-клубах» у Елены Крац

**Скрин:** карточка `Krats Elena` (profile_id `2a4b26b1-…`, user_id `83bc38bc-…`, telegram_user_id `509689739`), показано «Нет данных о членстве в Telegram-клубах», хотя у неё есть active entitlement по Gorbova Club и `in_chat=true, in_channel=true`.

**Проверка БД:** запрос внутрь функции выдаёт **2 строки** (Gorbova Club → `effective=active`, Бухгалтерия как бизнес → `effective=missing`). То есть данные есть, RPC должен их вернуть.

**Реальная причина:** RPC `admin_get_club_memberships_all` падает на permission-check
`has_permission(auth.uid(), 'entitlements.manage')` для текущего пользователя в этом окне,
и компонент тихо отрисовывает «нет данных» вместо ошибки. Это маскировало:
- реальный отказ permission;
- любые SQL-ошибки.

**Минимальный фикс (UI):** компонент `ContactClubMembershipsList` теперь:
- логирует ошибку RPC через `console.warn` (вместо `console.debug`);
- показывает явный жёлтый блок «Не удалось загрузить клубы: <message>» вместо ложного «нет данных».

Это сразу делает причину видимой администратору. Если у пользователя реально нет роли с `entitlements.manage` — он увидит permission-сообщение и сможет открыть нужный доступ. Менять саму permission-политику в этом scope не делаем — это отдельное решение.

**НЕ сделано:**
- не ослабляем permission-check в RPC;
- не меняем `tcm.access_status`;
- не делаем write-операций.

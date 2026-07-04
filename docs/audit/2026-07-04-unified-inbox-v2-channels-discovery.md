# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS — DB discovery (read-only)

Дата: 2026-07-04
Режим: **read-only**. Ни одна миграция, ни один RPC/edge, ни один UI-компонент не менялись. Только `information_schema` + `SELECT count(*)` + grep исходников.

## 1. instagram_contacts — фактические колонки

| column | type | nullable | назначение |
|---|---|---|---|
| id | uuid | NO | PK |
| instagram_account_id | uuid | NO | FK → `instagram_accounts.id` (какой наш аккаунт видит контакт) |
| instagram_user_id | text | NO | IG peer id (Instagram-side) |
| instagram_username | text | YES | @handle |
| full_name | text | YES | имя из IG |
| avatar_url | text | YES | аватар из IG |
| **profile_id** | **uuid** | **YES** | **уже существующая FK на `profiles.id`** |
| provider_kind | text | NO | 'instagram'/'manychat'/... |
| created_at / updated_at | tstz | NO | — |

Полей `contact_id`, `peer_id`, `ig_thread_id`, `thread_key`, `account_id` в `instagram_contacts` **нет** (peer/thread — атрибуты сообщения, живут в `instagram_messages.peer_id / ig_thread_id / thread_key`).

## 2. profiles — IG/TG колонки

| column | type | назначение |
|---|---|---|
| telegram_user_id | bigint | канон-связь TG↔profile (V2 root-cause fix) |
| telegram_username / telegram_link_status / telegram_link_bot_id / telegram_last_check_at / telegram_last_error / telegram_linked_at | — | Telegram bind pipeline |
| **instagram_url** | text | **только произвольная ссылка на профиль IG (текст)** — НЕ структурный ID, для merge непригодно |

Полей `instagram_user_id` / `instagram_username` / `instagram_account_id` в `profiles` **нет**.

## 3. Bridge-таблицы

Поиск по `information_schema.tables`:

- `contact_channel_links` — **не существует**
- `profile_channel_links` — **не существует**
- `instagram_profile_links` — **не существует**
- `contact_links` — **не существует**
- `card_profile_links` — существует, но это Stripe-карты ↔ profile (не мессенджеры)

**Каноническая связь IG↔profile уже есть — это `instagram_contacts.profile_id`.** Новую bridge-таблицу заводить не нужно.

## 4. Фактическое состояние данных

```
SELECT count(*) FROM instagram_contacts;                              -- 12
SELECT count(*) FROM instagram_contacts WHERE profile_id IS NOT NULL; --  0
SELECT count(*) FROM instagram_contacts WHERE profile_id IS NULL;     -- 12
```

Колонка есть, но **0 из 12 IG-контактов привязаны** к профилю. Значит:
- пайплайна авто-линковки IG→profile нет;
- ручной merge через UI никто не делал;
- поле пустое по всему датасету.

## 5. ContactInstagramChat — как определяет контакт

`src/components/admin/communication/instagram/ContactInstagramChat.tsx:34-52`:

```ts
interface ContactInstagramChatProps {
  accountId: string;       // instagram_accounts.id (наш IG-бизнес-аккаунт)
  senderId: string;        // instagram_messages.peer_id (IG-side peer)
  threadId: string | null; // instagram_messages.ig_thread_id
  ...
}
```

`profile_id` / `username` в контракт не входят — компонент оперирует только IG-идентификаторами. Для клика по имени → карточка контакта потребуется отдельно резолвить `instagram_contacts.profile_id` по `(accountId, senderId)`.

## 6. ContactDetailSheet — как открывается из Telegram

`src/components/admin/ContactDetailSheet.tsx:191-198`:

```ts
interface ContactDetailSheetProps {
  contact: Contact | null;   // строка из public.profiles (id = profiles.id)
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnTo?: string;
}
```

Открывается в `AdminContacts.tsx:1758` — в `contact` кладётся весь профиль, ключевой идентификатор — `profiles.id`. Механизм полностью переиспользуемый: для IG-строки нужно по `instagram_contacts.profile_id` подгрузить `profiles.*` и передать в тот же sheet.

## 7. Support ↔ profile

`support_tickets` (relevant):

| column | type | назначение |
|---|---|---|
| profile_id | uuid | канон-связь тикет↔profile |
| user_id | uuid | дубль (auth.users.id) |
| assigned_to | uuid | оператор |
| telegram_user_id | bigint | опциональный TG-bridge |

Связь Support↔profile каноническая и уже есть (`support_tickets.profile_id`).

## 8. Сводная таблица

| existing field/table | назначение | подходит для IG merge? | риск | рекомендация |
|---|---|---|---|---|
| `instagram_contacts.profile_id` | IG-контакт → profile | **Да, канон** | 0/12 заполнены | использовать напрямую, backfill вручную через ChannelPicker/карточку |
| `instagram_contacts.instagram_user_id` + `instagram_account_id` | стабильный ключ IG-стороны | вспомогательно | — | по паре (account_id, ig_user_id) резолвить `profile_id` |
| `profiles.instagram_url` | свободная текстовая ссылка | **Нет** | не нормализовано, не уникально | не трогать, оставить как есть |
| `card_profile_links` | Stripe карты | нет | не про мессенджеры | не трогать |
| `support_tickets.profile_id` | Support↔profile | канон | — | использовать в ChannelPicker как есть |
| `profiles.telegram_user_id` | TG↔profile | канон (V2 fix) | — | read-only в picker'е |
| ~~`contact_channel_links`~~ | планируемая bridge-таблица | **не нужна** | лишний слой | **НЕ создавать** — канон уже есть |

## 9. Решение по следующему шагу

По результатам discovery — **новую таблицу `contact_channel_links` не создаём**. Все нужные связи уже есть в схеме:

- IG↔profile: `instagram_contacts.profile_id` (nullable, 0/12 заполнено — merge будет ручной)
- TG↔profile: `profiles.telegram_user_id` (read-only)
- Support↔profile: `support_tickets.profile_id`

Дальнейший план (только после явного согласования):

1. **ChannelPicker V1** — read-only переключатель между **уже существующими** каналами для выбранного `profile_id`:
   - Telegram: список ботов, где у `profiles.telegram_user_id` есть `telegram_access_grants`;
   - Instagram: `instagram_contacts` where `profile_id = ?` (сейчас 0, поэтому большинство контактов будут «unlinked»);
   - Support: `support_tickets` where `profile_id = ?`.
   Никаких новых IG/support разговоров picker не создаёт.

2. **Ручной merge IG→profile** — единственная нужная запись — `UPDATE instagram_contacts SET profile_id = ? WHERE id = ?`. Отдельная таблица не требуется. Оформить как RPC `link_instagram_contact_to_profile(ig_contact_id uuid, profile_id uuid)` с проверкой роли (admin/superadmin) через `has_role`.

3. **Клик по имени в IG-строке unified** → если `instagram_contacts.profile_id` не NULL, открыть `ContactDetailSheet` c соответствующим `profiles.*`. Иначе — tooltip «Контакт не привязан к профилю» + пункт «Привязать к профилю…» (шаг 2).

4. Общий cross-channel composer / автоматическая линковка по email/phone / bulk-actions — **вне текущего скоупа**.

## 10. Гарантии этого discovery

- Ни одной DDL/DML-операции.
- Ни один файл кода не менялся.
- Feature-flag unified inbox (superadmin only, kill-switch) не тронут.
- Rollback не требуется — изменений нет.

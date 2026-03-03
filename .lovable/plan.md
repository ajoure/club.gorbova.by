## План: Instagram Direct через ApiX-Drive + вкладка «Соцсети»

**Статус: РЕАЛИЗОВАНО ✅**

---

### Что сделано

#### 1. SQL-миграция
- `instagram_accounts` — таблица аккаунтов Instagram, FK → integration_instances, UNIQUE(instance_id, page_id)
- `instagram_messages` — сообщения, UNIQUE(account_id, external_message_id), is_read/read_at, direction check
- `instagram_contacts` — маппинг Instagram → profiles, UNIQUE(account_id, user_id)
- RLS: admin/superadmin + service_role
- Индексы: dialog (account+sender+created_at), unread partial
- Realtime: supabase_realtime publication
- RPC: `get_instagram_dialogs_v1` — агрегация диалогов

#### 2. Edge Functions
- `instagram-webhook` — приём POST от ApiX-Drive, валидация Bearer secret, дедупликация ON CONFLICT, логи в integration_logs
- `instagram-admin-chat` — get_history, send_reply (idempotent по client_msg_id), mark_read, get_accounts, RBAC admin/super_admin, audit_logs

#### 3. UI: Интеграции
- Категория `socials` в useIntegrations + CATEGORIES
- Провайдер `apix_instagram_dm` (webhook_secret, apix_api_key, account_name)
- Провайдер-заглушка `facebook` ("Скоро")
- `SocialIntegrationsTab` — карточки Instagram DM и Facebook
- AdminIntegrations: вкладка "Соцсети" между Telegram и Разное, 6-колоночная сетка

#### 4. UI: Контакт-центр
- `InboxTabContent` — channel type расширен на `"instagram"`
- `AdminCommunication` — пункт Instagram в dropdown-меню Сообщения
- `InstagramInboxView` — список диалогов, realtime, поиск, unread count
- `ContactInstagramChat` — чат, отправка, media, статусы ошибок

---

### Файлы изменены/созданы

| Файл | Что |
|------|-----|
| SQL migration | instagram_accounts, instagram_messages, instagram_contacts + RLS + RPC |
| `supabase/functions/instagram-webhook/index.ts` | Новый: приём webhook |
| `supabase/functions/instagram-admin-chat/index.ts` | Новый: admin API |
| `supabase/config.toml` | +2 функции (verify_jwt=false) |
| `supabase/functions.registry.txt` | +2 функции |
| `src/hooks/useIntegrations.tsx` | +category "socials", +2 провайдера |
| `src/pages/admin/AdminIntegrations.tsx` | +вкладка socials, 6 колонок |
| `src/components/integrations/socials/SocialIntegrationsTab.tsx` | Новый |
| `src/pages/admin/AdminCommunication.tsx` | +канал Instagram |
| `src/components/admin/communication/InboxTabContent.tsx` | +channel "instagram" |
| `src/components/admin/communication/instagram/InstagramInboxView.tsx` | Новый |
| `src/components/admin/communication/instagram/ContactInstagramChat.tsx` | Новый |

---

### Следующие шаги для пользователя

1. В Интеграции → Соцсети → подключить Instagram DM (задать webhook_secret)
2. Скопировать Webhook URL и вставить в ApiX-Drive → Приём данных → Webhooks
3. Маппинг полей в ApiX-Drive: `integration_instance_id`, `external_message_id`, `sender_id`, `sender_name`, `message_text`, `timestamp`, `media_url`, `thread_id`
4. (Опционально) Заполнить `apix_api_key` для отправки ответов

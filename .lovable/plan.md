

## Проблема

При создании Instagram-подключения:
1. Статус ставится `disconnected` и нет способа его изменить через UI
2. Запись `instagram_accounts` не создаётся — webhook требует её и возвращает 404
3. Кнопка «Проверить» в SocialIntegrationsTab — заглушка `() => {}`

Итого: интеграция создана, но неработоспособна.

## Решение (3 точечных правки)

### 1. AddIntegrationDialog — auto-create `instagram_accounts` при сохранении Instagram

В `handleSubmit` после `createInstance.mutateAsync` для `apix_instagram_dm`:
- вставить запись в `instagram_accounts` с `integration_instance_id = result.id`, `is_active = true`
- обновить `integration_instances.status` на `connected`

Это одноразовое действие при создании подключения.

### 2. SocialIntegrationsTab — подключить реальный healthcheck

Заменить `onHealthCheck={() => {}}` на вызов `integration-healthcheck` (как в `AdminIntegrations.tsx`). Для `apix_instagram_dm` healthcheck просто проверит наличие `instagram_accounts` + конфигурации и выставит статус `connected`.

### 3. integration-healthcheck — добавить case `apix_instagram_dm`

В edge-функции добавить обработчик:
- Проверить что `instagram_accounts` существует для `instance_id`
- Проверить что `webhook_secret` заполнен в config
- Если ок — success, иначе — error с понятным сообщением

## Файлы

| Файл | Изменение |
|------|-----------|
| `src/components/integrations/AddIntegrationDialog.tsx` | После создания Instagram — upsert `instagram_accounts` + update status |
| `src/components/integrations/socials/SocialIntegrationsTab.tsx` | Подключить реальный `onHealthCheck` |
| `supabase/functions/integration-healthcheck/index.ts` | Добавить case `apix_instagram_dm` |


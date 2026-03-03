

## Диагностика

### 1. Ошибка "Invalid webhook secret" при нажатии "Проверить webhook"

**Причина**: `instagram-webhook-test` отправляет секрет через `Authorization: Bearer ...`, но Supabase Gateway может модифицировать этот заголовок при вызове edge function → edge function внутри проекта. Прошлые успешные тесты (curl) использовали заголовок `x-webhook-secret`.

**Факт**: В логах видно `auth_scheme: bearer`, `has_auth_header: true`, но результат `invalid_secret` — токен приходит изменённым.

**Решение**: В `instagram-webhook-test` заменить `Authorization: Bearer ${webhookSecret}` на `x-webhook-secret: ${webhookSecret}`.

### 2. Видимость кнопок

На скриншоте кнопки "Проверить webhook" и "Webhook события" мелкие, внутри блока webhook URL. Нужно сделать их заметнее:
- Увеличить размер кнопок
- "Проверить webhook" → variant `default` (основной цвет) вместо `outline`
- "Webhook события" → variant `outline` вместо `ghost`

## Файлы и правки

| Файл | Что меняется |
|------|-------------|
| `supabase/functions/instagram-webhook-test/index.ts` | Заголовок `Authorization: Bearer` → `x-webhook-secret` |
| `src/components/integrations/socials/SocialIntegrationsTab.tsx` | Увеличить/выделить кнопки "Проверить webhook" и "Webhook события" |


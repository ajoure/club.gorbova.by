

## Проблема

ApiX-Drive отправляет данные из Instagram, но запросы отклоняются с ошибкой `missing_instance_id`. Причина: ApiX не включает `integration_instance_id` в тело запроса — он передаёт только поля сообщения.

Кроме того, данные от ApiX приходят как `application/x-www-form-urlencoded`, но ключи в body выглядят как одна склеенная строка — это значит, что ApiX кодирует данные некорректно или использует нестандартный формат.

## Решение (2 правки)

### 1. Webhook URL с instance_id в query параметре

**Файл:** `src/components/integrations/socials/SocialIntegrationsTab.tsx`

Добавить `?integration_instance_id=<UUID>` в URL, который показывается пользователю для вставки в ApiX-Drive:

```typescript
const webhookUrl = instagramInstances.length > 0
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-webhook?integration_instance_id=${instagramInstances[0].id}`
  : null;
```

### 2. Edge function: читать instance_id из query параметров

**Файл:** `supabase/functions/instagram-webhook/index.ts` (строки 122-123)

Добавить fallback на URL query параметр:

```typescript
const url = new URL(req.url);
const instanceId = body.integration_instance_id || url.searchParams.get('integration_instance_id');
```

### Итого

| Файл | Изменение |
|------|-----------|
| `src/components/integrations/socials/SocialIntegrationsTab.tsx` | Webhook URL включает `?integration_instance_id=` |
| `supabase/functions/instagram-webhook/index.ts` | Строка 123: fallback на query param |

После применения — обновить URL в ApiX-Drive (скопировать новый) и отправить тест повторно.




# FIX: Telegram медиа, информативная выдача доступа и Email история

## Выявленные проблемы

### Проблема 1: Медиа в Telegram не загружаются (photo.jpg "Загружается...")

**Диагноз:**
- Cron-задача `telegram-media-worker-cron` работает каждую минуту
- Но сама функция `telegram-media-worker` возвращает **404 NOT_FOUND**
- Обе функции **не включены в `functions.registry.txt`** → CI их не деплоит

**Доказательство:**
```sql
-- media_jobs в статусе pending (не обрабатываются)
SELECT id, status, attempts FROM media_jobs WHERE status = 'pending';
-- 2 записи с attempts=0
```

### Проблема 2: Выдача доступа неинформативна

**Диагноз:**
- В UI показывается: `Автоматическая выдача доступа 06.02 15:39`
- Нет информации: какой продукт, какой клуб, на какой срок
- В `telegram_logs.meta` записывается только: `valid_until`, `chat_invite_link`, `channel_invite_link`
- **Нет поля `product_name`** в meta

**Что сейчас в meta:**
```json
{
  "chat_invite_link": "https://t.me/+9Y1rg-zuT20zNTEy",
  "valid_until": "2026-03-08T14:25:26.574+00:00"
}
```

### Проблема 3: Email-история пустая почти для всех контактов

**Диагноз:**
- В `email_logs` есть 305 записей, но только 92 имеют `user_id`
- Функции отправки email (subscription-charge, renewal-reminders и др.) не всегда заполняют `user_id`/`profile_id`
- Запрос в UI фильтрует по `user_id` или `profile_id` → письма без этих полей не отображаются
- У Марии Громыко письма отображаются потому что в них есть `to_email = 'slmmls@mail.ru'`

**Статистика:**
```
Всего писем: 305
С user_id: 92
Без user_id/profile_id: 213 (70%)
```

---

## План исправления

### A. Telegram медиа — добавить функции в registry (КРИТИЧНО)

**Файл:** `supabase/functions.registry.txt`

Добавить в секцию P1:
```text
telegram-media-worker
telegram-media-worker-cron
```

**Файл:** `supabase/functions/telegram-media-worker/index.ts`

Исправить import и CORS headers:
```typescript
// Было: import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient } from "npm:@supabase/supabase-js@2";

// Было: 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-token'
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
```

### B. Выдача доступа — добавить информацию о продукте

**Файл:** `supabase/functions/telegram-grant-access/index.ts`

Изменить запись в `telegram_logs` (строка ~671-678):
```typescript
// Получить название продукта/клуба
const clubName = club.name || club.slug || 'Клуб';

// Запись в telegram_logs с расширенной meta
await supabase.from('telegram_logs').insert({
  user_id,
  club_id: club.id,
  action: is_manual ? 'MANUAL_GRANT' : 'AUTO_GRANT',
  target: 'both',
  status: (chatInviteLink || channelInviteLink) ? 'ok' : 'partial',
  meta: { 
    chat_invite_link: chatInviteLink, 
    channel_invite_link: channelInviteLink, 
    valid_until: activeUntil,
    // НОВЫЕ ПОЛЯ:
    club_name: clubName,
    product_name: club.product_name || null,
    access_end_date: activeUntil ? new Date(activeUntil).toLocaleDateString('ru-RU') : null,
  },
  // PATCH: Сохранить текст уведомления для отображения в чате
  message_text: `🔑 Выдан доступ в "${clubName}" до ${activeUntil ? new Date(activeUntil).toLocaleDateString('ru-RU') : 'бессрочно'}`,
});
```

**Файл:** `src/components/admin/ContactTelegramChat.tsx`

Изменить отображение события `AUTO_GRANT` (строка ~820-848):
```typescript
// Вместо просто getEventLabel(event.action) показать расширенную информацию
const getEventDisplayText = (event: TelegramEvent): string => {
  const meta = event.meta as Record<string, unknown> | undefined;
  
  if (event.action === 'AUTO_GRANT' || event.action === 'MANUAL_GRANT') {
    const clubName = meta?.club_name || meta?.product_name || '';
    const validUntil = meta?.valid_until as string | undefined;
    const accessEndDate = validUntil 
      ? new Date(validUntil).toLocaleDateString('ru-RU')
      : null;
    
    const prefix = event.action === 'AUTO_GRANT' ? 'Авто-выдача' : 'Ручная выдача';
    
    if (clubName && accessEndDate) {
      return `${prefix}: ${clubName} до ${accessEndDate}`;
    }
    if (clubName) {
      return `${prefix}: ${clubName}`;
    }
    if (accessEndDate) {
      return `${prefix} до ${accessEndDate}`;
    }
  }
  
  return getEventLabel(event.action);
};
```

### C. Email-история — улучшить запрос и backfill

**Файл:** `src/components/admin/ContactEmailHistory.tsx`

Расширить запрос для более надёжного поиска писем:
```typescript
// Добавить поиск по email даже если user_id/profile_id NULL
const { data: emails, isLoading: isLoadingLogs } = useQuery({
  queryKey: ["email-logs", userId, profileId, email],
  queryFn: async () => {
    // ОСНОВНОЙ ПРИОРИТЕТ: по email (самый надёжный)
    if (email) {
      const { data: byEmail, error } = await supabase
        .from("email_logs")
        .select("*")
        .or(`to_email.eq.${email},from_email.eq.${email}`)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (!error && byEmail && byEmail.length > 0) {
        return byEmail as EmailLog[];
      }
    }
    
    // FALLBACK: по user_id/profile_id
    let query = supabase
      .from("email_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    
    const conditions: string[] = [];
    if (userId) conditions.push(`user_id.eq.${userId}`);
    if (profileId) conditions.push(`profile_id.eq.${profileId}`);
    
    if (conditions.length > 0) {
      query = query.or(conditions.join(','));
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data as EmailLog[];
  },
  enabled: !!(userId || profileId || email),
});
```

---

## Технические изменения

### Изменяемые файлы:

| Файл | Изменение |
|------|-----------|
| `supabase/functions.registry.txt` | +2 функции: `telegram-media-worker`, `telegram-media-worker-cron` |
| `supabase/functions/telegram-media-worker/index.ts` | npm: import + полные CORS headers |
| `supabase/functions/telegram-grant-access/index.ts` | Расширить meta в telegram_logs (product_name, club_name, access_end_date) + message_text |
| `src/components/admin/ContactTelegramChat.tsx` | Показывать детали выдачи доступа (продукт, срок) |
| `src/components/admin/ContactEmailHistory.tsx` | Приоритетный поиск по email вместо user_id |

---

## Ожидаемый результат

### После исправлений:

1. **Медиа в Telegram** — фото/видео от пользователей загружаются корректно (не "Загружается...")

2. **Выдача доступа** — в чате отображается:
   ```
   🔑 Авто-выдача: Бухгалтерия как бизнес до 08.03.2026  06.02 15:39 ✓
   ```
   Вместо:
   ```
   Автоматическая выдача доступа  06.02 15:39 ✓
   ```

3. **Email-история** — показываются все письма для контакта по его email (даже если user_id не заполнен)

---

## DoD (Definition of Done)

| Проверка | Критерий |
|----------|----------|
| Функции задеплоены | `curl POST /telegram-media-worker` → НЕ 404 |
| Медиа загружаются | `media_jobs.status = 'ok'` после обработки |
| Выдача информативна | В UI видно: продукт + дата окончания |
| Email-история работает | Письма отображаются для любого контакта с email |


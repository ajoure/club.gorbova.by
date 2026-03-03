

## Проблема

ApiX-Drive отправляет данные как `application/x-www-form-urlencoded`, а наш `instagram-webhook` принимает только `application/json` (`req.json()`). В логах видно 3 отклонённых запроса от ApiX:

```
22:10:05  REJECTED: invalid_json  content_type: application/x-www-form-urlencoded
22:06:12  REJECTED: invalid_json  content_type: application/x-www-form-urlencoded
```

Также на скриншоте ApiX видно, что "Содержимое" — это сплошная строка (form-encoded), не JSON.

## Решение

**Файл:** `supabase/functions/instagram-webhook/index.ts`

Заменить блок парсинга body (строки 72-96) — вместо только `req.json()` добавить:

1. Проверить `content-type`
2. Если `application/x-www-form-urlencoded` — парсить через `URLSearchParams` из `req.text()`
3. Если `application/json` — парсить через `req.json()`
4. Иначе — попробовать JSON, затем form-urlencoded как fallback

Конкретно:
```typescript
const rawText = await req.text();
const ct = (req.headers.get('content-type') || '').toLowerCase();

if (ct.includes('application/json')) {
  body = JSON.parse(rawText);
} else if (ct.includes('application/x-www-form-urlencoded')) {
  const params = new URLSearchParams(rawText);
  body = Object.fromEntries(params.entries());
} else {
  // Fallback: try JSON, then form-urlencoded
  try { body = JSON.parse(rawText); } catch {
    try {
      const params = new URLSearchParams(rawText);
      if ([...params.keys()].length > 0) {
        body = Object.fromEntries(params.entries());
      } else { throw new Error('empty'); }
    } catch { /* reject */ }
  }
}
```

Остальной код без изменений — tolerant mapping, валидация, логирование продолжат работать.

## Файлы

| Файл | Изменение |
|------|-----------|
| `supabase/functions/instagram-webhook/index.ts` | Строки 72-96: добавить парсинг form-urlencoded |


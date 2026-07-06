# Fix: Telegram «Открыть» disabled + дубль pricing-блока на `/ideologicheskaya-rabota`

Дата: 2026-07-06

## 1. TelegramCompactCard — кнопка «Открыть» была всегда disabled в pending

### Root cause
`src/components/telegram/TelegramCompactCard.tsx`, ветка `status === 'pending' || linkSession`:

```tsx
disabled={!linkSession?.deep_link}
```

`linkSession` — локальный state, заполняется только при явном клике «Привязать» → `startLink.mutateAsync()`. Если сервер уже вернул `status = 'pending'` (например, повторное открытие модалки в течение TTL сессии, после патча v3 LeadRequestDialog, где state диалога больше не сбрасывается на каждом ре-рендере), локального `linkSession` нет → `deep_link` пуст → «Открыть» приходит `disabled` без вариантов сдвинуться.

### Fix
Только `src/components/telegram/TelegramCompactCard.tsx`:

1. Добавлены refs `autoStartAttemptedRef` (одна попытка на монтирование) и `userCancelledRef` (блок повторного авто-старта после явного крестика).
2. Новый `useEffect`, который при `status === 'pending'`, отсутствующем `deep_link`, `!startLink.isPending`, `!autoStartAttemptedRef.current` и `!userCancelledRef.current` вызывает `startLink.mutateAsync()` — сервер возвращает актуальный `deep_link` для той же pending-сессии.
3. Кнопка в pending-ветке:
   - если `deep_link` есть → «Открыть» (без disabled-режима).
   - если нет → активная кнопка «Получить ссылку» с состоянием загрузки `Получаем ссылку…`.
4. Если авто-получение упало — `autoStartFailed = true` и под кнопкой показывается `Не удалось получить ссылку автоматически. Нажмите «Получить ссылку»`.
5. Крестик теперь идёт через `handleCancelPending`, который:
   - ставит `userCancelledRef.current = true` и `autoStartAttemptedRef.current = true` (защита от повторного автозапуска в текущем mount);
   - вызывает `cancelLink.mutate()`;
   - обнуляет `linkSession` и `autoStartFailed`.

Никаких изменений в `useTelegramLink`, edge-функциях или контракте с сервером.

### Проверка
- Preview /admin/contacts → открыть модалку заявки → отправить → шаг Telegram: кнопка сразу активна (авто-старт получил deep_link). ✅
- Повторное открытие модалки в течение TTL: не наглухо disabled, минимум активна кнопка «Получить ссылку». ✅
- Крестик отменяет и не запускает авто-старт повторно в том же mount. ✅

## 2. Дубль pricing-блока «Индивидуальный договор» на `/ideologicheskaya-rabota`

### Before

`site_pages.id = 7e672fed-13f1-4ff1-8786-71a228a0c011`, 2 блока:

| id | type | назначение |
|---|---|---|
| `3b63835a-f510-4cc8-992b-2de33b2b3f8c` | `html` | Полный лендинг. Секция «Выберите удобный формат подключения» внутри HTML тянет тарифы продукта `3ea08f79-afe8-4361-81fe-4c0f318f9a2b` через `public-product` и рендерит 3 карточки с рабочими CTA (`open-offer` / `open-preregistration`). |
| `86b93087-16d5-4fcc-8e4c-32cf920c1b53` | `pricing` | Дублирующий React-блок TariffCard для того же `product_id` и тех же 3 `tariff_ids`. |

Полный дамп удаляемого блока (rollback-safe):

```json
{
  "id": "86b93087-16d5-4fcc-8e4c-32cf920c1b53",
  "type": "pricing",
  "content": {
    "title": "Индивидуальный договор",
    "subtitle": "Оставьте заявку — согласуем условия под ваш формат",
    "product_id": "3ea08f79-afe8-4361-81fe-4c0f318f9a2b",
    "tariff_ids": [
      "b7d458d6-bdb9-4f7a-a3b0-8bdf3a1113f5",
      "19638a82-0438-47ea-a134-0793a0abf614",
      "6ff1769e-2103-42ab-ab70-c77dff2c2ed5"
    ],
    "tariff_filter_mode": "selected"
  }
}
```

### Изменение

```sql
UPDATE public.site_pages
SET blocks = COALESCE(
      (SELECT jsonb_agg(elem)
       FROM jsonb_array_elements(blocks) elem
       WHERE elem->>'id' <> '86b93087-16d5-4fcc-8e4c-32cf920c1b53'),
      '[]'::jsonb
    ),
    updated_at = now()
WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(blocks) elem
    WHERE elem->>'id' = '86b93087-16d5-4fcc-8e4c-32cf920c1b53'
      AND elem->>'type' = 'pricing'
  );
```

Идемпотентно (при повторном запуске `EXISTS` вернёт false).

### After

```sql
SELECT jsonb_array_length(blocks), (SELECT jsonb_agg(b->>'id') FROM jsonb_array_elements(blocks) b)
FROM public.site_pages WHERE id='7e672fed-13f1-4ff1-8786-71a228a0c011';
-- n = 1
-- ids = ["3b63835a-f510-4cc8-992b-2de33b2b3f8c"]
```

Остался только HTML-блок с секцией «Выберите удобный формат подключения». CTA `Оплатить картой` / `Оплатить` / `Оставить заявку` рендерятся внутри HTML-блока через события `open-offer` / `open-preregistration` и работать не перестали (продукт/тарифы/офферы не тронуты).

### Rollback

```sql
UPDATE public.site_pages
SET blocks = blocks || '[{ ... блок из дампа выше ... }]'::jsonb,
    updated_at = now()
WHERE id = '7e672fed-13f1-4ff1-8786-71a228a0c011';
```

# План исправления системы "Редакция"

## Обзор проблем

```
┌─────────────────────────────────────────────────────────────────┐
│              ДИАГНОСТИКА: 3 КРИТИЧНЫЕ ПРОБЛЕМЫ                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Меню "Редакция" ведёт на /admin/news (старая страница)     │
│     -> Нужно: /admin/editorial (новая система)                  │
│                                                                 │
│  2. Парсер пишет category = "government" | "npa" | "media"      │
│     -> CHECK constraint разрешает только: digest|comments|urgent│
│     -> ВСЕ INSERT-ы падают с ошибкой                            │
│                                                                 │
│  3. Нет подпунктов меню для "Источники" и "Каналы"             │
│     -> Кнопка "Источники" работает, но нет в меню               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Этап 1: Исправить навигацию

### Файл: `src/hooks/useAdminMenuSettings.tsx`

**Строка 101 - изменить:**
```typescript
// Было:
{ id: "news", label: "Редакция", path: "/admin/news", icon: "Newspaper", order: 0, permission: "news.view" },

// Станет:
{ id: "editorial", label: "Редакция", path: "/admin/editorial", icon: "Newspaper", order: 0, permission: "news.view" },
{ id: "editorial-sources", label: "Источники новостей", path: "/admin/editorial/sources", icon: "Globe", order: 1, permission: "news.edit" },
```

---

## Этап 2: Исправить Edge Function monitor-news

### Файл: `supabase/functions/monitor-news/index.ts`

**Проблема:** Строка 145 пишет `category: source.category` (значения: "government", "npa", "media"), но таблица `news_content` имеет CHECK constraint который разрешает только: "digest", "comments", "urgent".

**Решение:** Добавить маппинг категорий или использовать значение из AI-анализа:

```typescript
// Строка 139-156 - изменить:
const { error: insertError } = await supabase.from("news_content").insert({
  title: analysis.title || item.title,
  summary: analysis.summary,
  source: source.name,
  source_url: item.url,
  country: source.country,
  // ИСПРАВЛЕНИЕ: использовать category из AI-анализа, а не из источника
  category: analysis.category || "digest",  // AI возвращает: digest | comments | urgent
  source_id: source.id,
  raw_content: item.content.slice(0, 10000),
  ai_summary: analysis.summary,
  effective_date: analysis.effective_date,
  keywords: analysis.keywords,
  news_priority: analysis.category === "urgent" ? "urgent" : "normal",
  telegram_status: "draft",
  scraped_at: new Date().toISOString(),
  is_published: false,
  created_by: null,
});
```

---

## Этап 3: Добавить колонку source_category (опционально)

Если нужно сохранять оригинальную категорию источника (npa, government, media), можно добавить отдельную колонку:

```sql
-- Добавить колонку для категории источника
ALTER TABLE news_content 
ADD COLUMN IF NOT EXISTS source_category TEXT;
```

Тогда Edge Function будет писать:
```typescript
category: analysis.category || "digest",      // Для CHECK constraint
source_category: source.category,             // Оригинальная категория источника
```

---

## Этап 4: Добавить страницу "Старые новости" (сохранить legacy)

Чтобы не потерять функционал старой страницы `/admin/news`:

```typescript
// В useAdminMenuSettings.tsx добавить:
{ id: "news-legacy", label: "Все новости (legacy)", path: "/admin/news", icon: "FileText", order: 2, permission: "news.view" },
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/hooks/useAdminMenuSettings.tsx` | Изменить путь меню "Редакция" на `/admin/editorial`, добавить "Источники" |
| `supabase/functions/monitor-news/index.ts` | Строка 145: заменить `source.category` на `analysis.category || "digest"` |
| SQL миграция (опционально) | Добавить колонку `source_category` в `news_content` |

---

## Ожидаемый результат

После исправления:
- Меню "Редакция" откроет новую страницу `/admin/editorial`
- Подпункт "Источники новостей" откроет `/admin/editorial/sources`
- Парсер будет успешно сохранять новости (category = "digest" | "comments" | "urgent")
- AI-анализ будет определять срочность: urgent для важных изменений, digest для обычных
- Все найденные новости появятся во вкладке "Входящие"

---

## Тестирование

1. Перейти в меню "Редакция" - должна открыться новая страница
2. Нажать "Запустить парсинг"
3. Проверить, что новости появились во вкладке "Входящие"
4. Проверить логи Edge Function на отсутствие ошибок constraint
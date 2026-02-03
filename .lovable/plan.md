# План: Улучшение работы с уроками в Базе знаний + Монетизация контента

## Статус: Фаза 1 — ✅ Выполнено

### Исправлены баги мастера:
1. ✅ Скролл для списка вопросов — используется native CSS scroll с `style={{ maxHeight: '240px', overflowY: 'auto' }}`
2. ✅ Placeholder таймкода изменён на `чч:мм:сс`
3. ✅ Порядок шагов изменён: **Доступ → Урок** (вместо Урок → Доступ)
4. ✅ Создание урока отложено до финального шага — никаких мусорных записей при закрытии мастера
5. ✅ Мастер активируется для `knowledge-videos` И `knowledge-questions`

### Новые фичи в Фазе 1:
6. ✅ Переименовано "Дата ответа" → **"Дата выпуска"**
7. ✅ Добавлен выбор **времени** (HH:mm) с дефолтом 00:00
8. ✅ Добавлен выбор **таймзоны** (дефолт Europe/Minsk)
9. ✅ Бейдж **«Скоро»** для уроков с `published_at` в будущем
10. ✅ Фильтрация запланированных уроков для не-админов в `useContainerLessons`
11. ✅ Компонент **LessonNotificationConfig** — уведомления подписчиков через Telegram бот

---

## Фаза 2: Монетизация контента (следующий спринт)

### Архитектура: Универсальные правила цен

**Концепция:** Не привязываемся к конкретному продукту (например, Club). Можно задать цену для ЛЮБОГО продукта/тарифа.

```
┌─────────────────────────────────────────────────────────────────┐
│                    ПРАВИЛА ЦЕН ДЛЯ УРОКА                        │
├─────────────────────────────────────────────────────────────────┤
│ ☑️ Продавать этот урок отдельно                                  │
│                                                                 │
│ Базовая цена (для всех без подписки): [300] BYN                 │
│                                                                 │
│ ➕ Добавить правило цены:                                        │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │ Продукт: [Gorbow Club ▼]                                 │  │
│   │ Тариф:   [CHAT ▼]                                        │  │
│   │ Цена:    [100] BYN                                       │  │
│   └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│ При совпадении нескольких правил — выбирается МИНИМАЛЬНАЯ цена  │
│                                                                 │
│ Длительность доступа:                                           │
│   ○ Навсегда                                                    │
│   ○ На [ N ] дней                                               │
│   ○ До конца периода подписки                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Структура данных

```typescript
interface LessonSaleConfig {
  enabled: boolean;              // Переключатель "Продавать отдельно"
  basePrice: number;             // Цена для всех без подписки
  
  accessDuration: 'forever' | 'days' | 'period';
  accessDays?: number;           // Если 'days'
  
  priceRules: {                  // Универсальные правила по любым продуктам/тарифам
    productId: string;           // UUID продукта (или '*' для любого)
    tariffId: string;            // UUID тарифа (или '*' для любого тарифа продукта)
    price: number;               // Цена для этого тарифа — при совпадении берется МИНИМУМ
  }[];
}
```

### База данных

**Миграция 1: Добавить product_id в training_lessons**
```sql
ALTER TABLE training_lessons 
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products_v2(id);

CREATE INDEX IF NOT EXISTS idx_training_lessons_product_id 
  ON training_lessons(product_id);
```

**Миграция 2: Расширить RLS lesson_blocks**
```sql
-- Добавить проверку entitlement/subscription на product_id урока
CREATE POLICY "Access via lesson product" ON lesson_blocks FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM training_lessons tl
    JOIN products_v2 p ON p.id = tl.product_id
    JOIN entitlements e ON e.product_code = p.code
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.product_id IS NOT NULL
      AND e.user_id = auth.uid()
      AND e.status = 'active'
  )
);
```

---

## Файлы для изменения

| Файл | Статус | Описание |
|------|--------|----------|
| `ContentCreationWizard.tsx` | ✅ Done | Порядок шагов, время/таймзона, уведомления |
| `KbLessonFormFields.tsx` | ✅ Done | Скролл вопросов, время/таймзона, переименование |
| `KbQuestionInput.tsx` | ✅ Done | Placeholder таймкода `чч:мм:сс` |
| `LessonCard.tsx` | ✅ Done | Бейдж «Скоро» для будущих уроков |
| `useContainerLessons.ts` | ✅ Done | Фильтрация неопубликованных + export isAdminUser |
| **НОВЫЙ** `LessonNotificationConfig.tsx` | ✅ Done | UI уведомлений через Telegram |
| **НОВЫЙ** `LessonSaleConfig.tsx` | 🔜 Todo | UI конфигурации продажи |
| **МИГРАЦИЯ** | 🔜 Todo | product_id + RLS |

---

## Ранее реализовано (Фаза 0)

### Сортировка уроков
- ✅ Изменен порядок ORDER BY: `sort_order DESC` как первичный ключ
- ✅ Добавлен UI-переключатель "Сначала новые / Сначала старые"

### Мастер для Базы знаний
- ✅ Создан `KbLessonFormFields.tsx`
- ✅ Создан `KbQuestionInput.tsx`
- ✅ Модифицирован `ContentCreationWizard.tsx` для KB
- ✅ Автоматическое создание video block + kb_questions

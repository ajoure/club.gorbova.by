
# План: Исправления мастера KB и реализация системы монетизации уроков

## Обзор выявленных проблем

### 1. Скролл на шаге «Доступ» не работает
**Причина:** На шаге «Доступ» рендерятся два компонента (`CompactAccessSelector` + `LessonNotificationConfig`) внутри общего `ScrollArea` (строка 903 ContentCreationWizard). При этом:
- `DialogContent` имеет `max-h-[90dvh] overflow-y-auto` (dialog.tsx строка 50)
- Внутренний `ScrollArea` использует `flex-1 min-h-0`, но не имеет фиксированной высоты
- Это создаёт конфликт двух скроллов

**Решение:** Удалить `ScrollArea` обёртку и использовать нативный CSS overflow на контейнере шага с ограничением высоты.

### 2. Бот не отображается — неправильный фильтр статуса
**Причина:** В `LessonNotificationConfig.tsx` (строка 71) фильтр `.eq("status", "ok")`, но в базе у бота статус `active`.

**Проверка БД:**
```
bot_username: gorbovabybot
status: active  ← НЕ совпадает с "ok"
```

**Решение:** Изменить фильтр на `.eq("status", "active")` или `.in("status", ["ok", "active"])`.

### 3. Уведомление находится на шаге «Доступ», но данные урока ещё не заполнены
**Проблема:** На шаге 2 (Доступ) компонент `LessonNotificationConfig` получает только placeholder `Выпуск №...`, т.к. реальные данные урока вводятся на следующем шаге 3 (Урок). Это делает автогенерацию бесполезной.

**Решение:** Переместить `LessonNotificationConfig` на шаг 3 (Урок), ПОСЛЕ полей ввода данных урока. Тогда будут доступны:
- Номер выпуска
- Дата выпуска
- Ссылка на видео
- Вопросы (для формирования описания)

### 4. Кнопка «Сгенерировать» не использует ИИ
**Текущее состояние:** Функция `generateMessage()` в `LessonNotificationConfig.tsx` (строки 100-129) использует простой шаблон, а не ИИ.

**Решение:** Вызывать edge-функцию с Lovable AI для генерации текста сообщения на основе:
- Названия урока
- Списка вопросов (если KB flow)
- Типа контента

### 5. Генерация обложек однотипная
**Текущий промпт** (generate-cover/index.ts): Использует общий бизнес-стиль с документами, калькуляторами, весами.

**Требование пользователя:** Использовать фотографии Катерины Горбовой для создания более «взрослых» и реалистичных обложек.

**Решение:** 
1. Добавить возможность загрузки базы фотографий владельца в Storage bucket
2. Использовать модель `google/gemini-2.5-flash-image` с режимом редактирования (edit mode) — передавать референсное фото + промпт для стилизации
3. Либо использовать фото как фон и генерировать overlay-элементы

### 6. Монетизация урока не реализована
**Текущее состояние:** Нет интерфейса для настройки продажи урока отдельно от подписки.

**Требуется:**
- Переключатель «Продавать этот урок отдельно»
- Базовая цена для всех
- Правила цен по тарифам (универсальные, для любого продукта/тарифа)
- Длительность доступа: N дней / до конца периода
- Автоматическое создание продукта при сохранении

---

## Архитектура изменений

### Новый порядок шагов для Lesson Flow
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Шаг 1: Раздел         → Выбор menu_section_key                             │
│ Шаг 2: Тип            → Выбор lesson/module                                │
│ Шаг 3: Доступ         → CompactAccessSelector + LessonSaleConfig          │
│ Шаг 4: Урок + Уведомл → KbLessonFormFields + LessonNotificationConfig     │
│ Шаг 5: Готово         → Атомарное создание всего                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Структура данных для монетизации

```typescript
interface LessonSaleConfig {
  enabled: boolean;           // Переключатель "Продавать отдельно"
  basePrice: number;          // Цена для всех без доступа
  accessDuration: 'days' | 'period';
  accessDays?: number;        // Если 'days'
  priceRules: {               // Универсальные правила
    productId: string;        // UUID продукта (или '*')
    tariffId: string;         // UUID тарифа (или '*')
    price: number;
  }[];
}
```

---

## Детальные изменения по файлам

### 1. ContentCreationWizard.tsx

**Изменения:**

1. **Исправить скролл** (строки 903-917):
   - Заменить `ScrollArea` на `div` с `overflow-y-auto` и фиксированной высотой
   
2. **Переместить LessonNotificationConfig** на шаг 3 (Урок):
   - Удалить из шага 2 (строки 728-735)
   - Добавить после `KbLessonFormFields` на шаге 3

3. **Добавить LessonSaleConfig** на шаг 2 (Доступ):
   - После `CompactAccessSelector` добавить разделитель и `LessonSaleConfig`

4. **Обновить WizardData**:
   ```typescript
   interface WizardData {
     // ... существующие поля ...
     saleConfig: LessonSaleConfig;  // NEW
   }
   ```

5. **Логика создания продукта при сохранении**:
   - Если `saleConfig.enabled`:
     - Создать `products_v2` с `category: 'lesson'`
     - Создать `tariffs` с `access_days`
     - Создать `tariff_offers` с ценами
     - Сохранить правила цен в `lesson_price_rules`
     - Обновить урок с `product_id`

### 2. LessonNotificationConfig.tsx

**Изменения:**

1. **Исправить фильтр бота** (строка 71):
   ```typescript
   // Было:
   .eq("status", "ok")
   
   // Станет:
   .in("status", ["ok", "active"])
   ```

2. **Подключить ИИ для генерации сообщения**:
   ```typescript
   const generateMessage = async () => {
     setIsGenerating(true);
     try {
       const { data: session } = await supabase.auth.getSession();
       const response = await fetch(
         `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-lesson-notification`,
         {
           method: "POST",
           headers: {
             Authorization: `Bearer ${session?.session?.access_token}`,
             "Content-Type": "application/json",
           },
           body: JSON.stringify({
             lessonTitle,
             lessonDescription,
             questions: questions || [], // Список вопросов для KB
           }),
         }
       );
       
       if (response.ok) {
         const { messageText } = await response.json();
         onChange({ ...config, messageText, buttonText: "Смотреть" });
       } else {
         // Fallback to template
         generateTemplateMessage();
       }
     } finally {
       setIsGenerating(false);
     }
   };
   ```

3. **Добавить props для вопросов**:
   ```typescript
   interface LessonNotificationConfigProps {
     // ... существующие ...
     questions?: { title: string }[];  // Для KB flow
   }
   ```

### 3. Новый компонент LessonSaleConfig.tsx

Создать компонент с:

- **Переключатель** «Продавать этот урок отдельно»
- **Базовая цена** (Input number)
- **Длительность доступа**:
  - Radio: «На N дней» с полем ввода
  - Radio: «До конца периода подписки»
- **Правила цен по тарифам**:
  - Кнопка «+ Добавить правило»
  - Dropdown: Продукт → Тариф
  - Input: Цена
  - При совпадении нескольких — минимальная

### 4. Новая edge-функция generate-lesson-notification

```typescript
// supabase/functions/generate-lesson-notification/index.ts
// Использует Lovable AI для генерации текста уведомления
// Промпт учитывает стиль Катерины Горбовой (теплый, искренний)
```

### 5. Миграции базы данных

**Миграция 1: Добавить product_id в training_lessons**
```sql
ALTER TABLE training_lessons 
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products_v2(id);

CREATE INDEX IF NOT EXISTS idx_training_lessons_product_id 
  ON training_lessons(product_id);
```

**Миграция 2: Создать таблицу lesson_price_rules**
```sql
CREATE TABLE IF NOT EXISTS lesson_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES training_lessons(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES tariffs(id) ON DELETE CASCADE,
  price numeric NOT NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_lesson_tariff UNIQUE (lesson_id, tariff_id)
);

-- RLS
ALTER TABLE lesson_price_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin manage" ON lesson_price_rules FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'superadmin'));

CREATE POLICY "Users can view" ON lesson_price_rules FOR SELECT TO authenticated
USING (true);
```

**Миграция 3: Расширить RLS lesson_blocks для product_id урока**
```sql
-- Добавить проверку entitlement/subscription на product_id урока
-- (см. детальный план в предыдущем сообщении)
```

---

## Улучшение генерации обложек

**Вариант 1: Использовать фото Катерины как референс**

1. Создать bucket `owner-photos` в Storage
2. Загрузить 5-10 качественных фото
3. При генерации:
   - Случайно выбрать фото
   - Использовать режим edit с промптом:
     ```
     Create a professional thumbnail overlay for this photo.
     Add subtle business/legal themed decorative elements.
     Keep the person clearly visible. Add a modern gradient overlay.
     No text, no logos.
     ```

**Вариант 2: Генерировать коллажи без лица**

1. Изменить промпт в generate-cover:
   ```
   Professional business illustration in flat design style.
   Modern, clean, vibrant colors (brand palette: purple, blue, gold).
   Abstract geometric shapes with business icons.
   Premium quality, suitable for educational content.
   ```

---

## Порядок реализации

### Фаза 1 — Критические баги (немедленно)
1. Исправить скролл в мастере
2. Исправить фильтр статуса бота
3. Переместить LessonNotificationConfig на шаг Урок

### Фаза 2 — ИИ генерация
1. Создать edge-функцию generate-lesson-notification
2. Подключить ИИ к кнопке «Сгенерировать»

### Фаза 3 — Монетизация (следующий спринт)
1. Миграции БД (product_id, lesson_price_rules)
2. Компонент LessonSaleConfig
3. Интеграция в мастер
4. Логика создания продукта
5. UI покупки в LessonCard
6. Обновление RLS политик

### Фаза 4 — Улучшение обложек
1. Создать bucket для фото владельца
2. Обновить generate-cover для использования референсов
3. Добавить UI для загрузки фото в админке

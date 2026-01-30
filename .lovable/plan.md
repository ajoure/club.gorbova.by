План: 

# План: Добавить плашку доступа на вкладку "Вопросы" в Базе знаний

## Диагностика

### Текущее состояние
- Вкладка "Вопросы" (`knowledge-questions`) отображает все вопросы из таблицы `kb_questions`
- RLS на `kb_questions` разрешает SELECT всем авторизованным (`qual: true`)
- Вопросы привязаны к урокам в контейнер-модуле "Уроки без модулей"
- Контейнер-модуль требует тарифы **FULL** или **BUSINESS** (настроено в `module_access`)

### Проблема
Пользователи без доступа (CHAT или без подписки):
- Видят список вопросов
- Могут нажать "Смотреть видеоответ"
- Переходят на страницу урока, где контент заблокирован RLS
- Нет предупреждения о необходимости тарифа

### Ожидаемое поведение
На вкладке "Вопросы" должна отображаться плашка `RestrictedAccessBanner` с указанием нужных тарифов, если у пользователя нет доступа к контенту.

---

## Техническое решение

### Подход
Использовать существующую логику проверки доступа из `useContainerLessons`, которая уже определяет:
- `hasAccess` для каждого урока на основе `module_access → tariff_id → subscriptions_v2`
- `restrictedTariffs` — названия тарифов для плашки

⚠️ Важно: логика должна быть **детерминированной** и опираться только на контейнер `knowledge-videos`, без попыток вычислять доступ по отдельным вопросам.

---

## Изменения

#### 1. Компонент QuestionsContent (`src/pages/Knowledge.tsx`)

Добавить пропсы для передачи информации о доступе:

```tsx
interface QuestionsContentProps {
  searchQuery: string;
  hasAccess: boolean;
  restrictedTariffs: string[];
}

Обновить рендер:

function QuestionsContent({ searchQuery, hasAccess, restrictedTariffs }: QuestionsContentProps) {
  // ... существующий код ...

  return (
    <div className="space-y-6">
      {/* Плашка ограниченного доступа */}
      {!hasAccess && restrictedTariffs.length > 0 && (
        <RestrictedAccessBanner accessibleTariffs={restrictedTariffs} />
      )}

      {/* Список вопросов */}
      <div className="space-y-4">
        {questions.map((question) => (
          // ... существующий код карточек вопросов ...
        ))}
      </div>
    </div>
  );
}

2. Определение доступа для вкладки “Вопросы”
В основном компоненте Knowledge:
	•	Вопросы всегда считаются витриной
	•	Доступ определяется исключительно по контейнеру knowledge-videos
	•	Если нет ни одного урока с has_access = true → доступ запрещён

// В компоненте Knowledge, внутри tabs.map()
const MockContent = MOCK_CONTENT_MAP[tab.key];

let questionsHasAccess = true;
let questionsRestrictedTariffs: string[] = [];

if (tab.key === "knowledge-questions") {
  const videoContainerData = lessonsBySection["knowledge-videos"];

  if (videoContainerData?.lessons?.length) {
    questionsHasAccess = videoContainerData.lessons.some(
      (l) => l.has_access === true
    );

    if (!questionsHasAccess) {
      questionsRestrictedTariffs = containerRestrictedTariffs;
    }
  }
}

Рендер:

{MockContent && tab.key === "knowledge-questions" ? (
  <QuestionsContent
    searchQuery={searchQuery}
    hasAccess={questionsHasAccess}
    restrictedTariffs={questionsRestrictedTariffs}
  />
) : MockContent ? (
  <MockContent searchQuery={searchQuery} />
) : null}


⸻

Изменяемые файлы

Файл	Изменения
src/pages/Knowledge.tsx	Добавить пропсы hasAccess, restrictedTariffs в QuestionsContent, показать RestrictedAccessBanner, корректно вычислить доступ


⸻

Логика доступа (итого)

Тариф пользователя	Вкладка “Вопросы”	Вкладка “Видеоответы”
FULL / BUSINESS	Вопросы видны, плашки нет	Карточки и видео доступны
CHAT / без подписки	Вопросы видны + плашка	Карточки видны + плашка
Admin	Полный доступ	Полный доступ


⸻

Ожидаемый результат

После изменений:
	•	Пользователь с CHAT тарифом на вкладке “Вопросы” видит плашку
«Контент доступен участникам Клуба. Тарифы с доступом: BUSINESS, FULL»
	•	Вопросы остаются видимыми (витрина)
	•	Кнопка “Смотреть видеоответ” ведёт на урок, где контент корректно заблокирован RLS
	•	Пользователи с FULL/BUSINESS и админы плашку не видят


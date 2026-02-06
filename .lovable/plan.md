
# План: Исправление сохранения пакетов промптов + полная сводка

## Обнаруженные проблемы

### Проблема 1: RLS блокирует сохранение
**Причина:** На таблице `ai_prompt_packages` есть только политика для `service_role`:
```
Policy: "Service role only" FOR ALL TO service_role USING (true)
```
Клиентский код использует `anon` ключ → INSERT блокируется.

**Решение:** Добавить RLS политики для администраторов:
- SELECT: админы могут видеть все пакеты
- INSERT: админы могут создавать пакеты (с `is_system = false`)
- UPDATE: админы могут редактировать не-системные пакеты
- DELETE: админы могут удалять не-системные пакеты

### Проблема 2: Нет полной сводки после анализа
**Текущее UI показывает:**
- Название пакета
- Краткое "Что Олег понял" (`summary`)
- Пример ответа (`exampleResponse`)

**Не показывается:**
- Извлечённые правила (`extractedRules`) — массив конкретных правил
- Категория с описанием — в каких ситуациях будет использоваться
- Характерные фразы/обращения

**Также:** В типе `analysisResult` отсутствует поле `extractedRules`.

---

## Фаза 1: Миграция — RLS политики для ai_prompt_packages

```sql
-- Разрешить админам SELECT все пакеты
CREATE POLICY "Admins can view prompt packages"
ON ai_prompt_packages FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Разрешить админам создавать не-системные пакеты
CREATE POLICY "Admins can create prompt packages"
ON ai_prompt_packages FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);

-- Разрешить админам обновлять не-системные пакеты
CREATE POLICY "Admins can update non-system packages"
ON ai_prompt_packages FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);

-- Разрешить админам удалять не-системные пакеты
CREATE POLICY "Admins can delete non-system packages"
ON ai_prompt_packages FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') 
  AND (is_system IS NULL OR is_system = false)
);
```

---

## Фаза 2: UI — добавить extractedRules в тип и показать полную сводку

### 2.1 Обновить тип analysisResult (строка 221-228)
```typescript
const [analysisResult, setAnalysisResult] = useState<{
  suggestedName: string;
  suggestedCode: string;
  summary: string;
  exampleResponse: string;
  extractedRules: string[];  // ← ДОБАВИТЬ
  processedContent: string;
  category: string;
} | null>(null);
```

### 2.2 Добавить отображение extractedRules и категории

После блока "Что Олег понял из файла:" добавить:

```tsx
{/* Извлечённые правила */}
{analysisResult.extractedRules && analysisResult.extractedRules.length > 0 && (
  <div className="space-y-2">
    <Label className="flex items-center gap-1.5">
      📋 Извлечённые правила:
    </Label>
    <ul className="bg-background rounded-lg p-3 text-sm border space-y-1">
      {analysisResult.extractedRules.map((rule, idx) => (
        <li key={idx} className="flex items-start gap-2">
          <span className="text-primary mt-0.5">•</span>
          <span>{rule}</span>
        </li>
      ))}
    </ul>
  </div>
)}

{/* Категория и когда применяется */}
<div className="space-y-2">
  <Label className="flex items-center gap-1.5">
    🏷️ Категория:
  </Label>
  <div className="bg-background rounded-lg p-3 text-sm border">
    <Badge variant="outline" className="mb-2">
      {CATEGORY_LABELS[analysisResult.category] || analysisResult.category}
    </Badge>
    <p className="text-muted-foreground text-xs">
      {CATEGORY_DESCRIPTIONS[analysisResult.category]}
    </p>
  </div>
</div>
```

### 2.3 Добавить константы для категорий

```typescript
const CATEGORY_LABELS: Record<string, string> = {
  tone: "Стиль общения",
  support: "Поддержка",
  sales: "Продажи",
  policy: "Правила/политики",
  custom: "Пользовательский",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  tone: "Применяется ко всем ответам для формирования тона и стиля общения",
  support: "Используется при ответах на вопросы о подписках, доступе и помощи",
  sales: "Активируется в режиме продаж: предложения, апсейл, ссылки на оплату",
  policy: "Правила и ограничения, которые бот соблюдает всегда",
  custom: "Пользовательские правила для специфических ситуаций",
};
```

---

## Технические детали

| Файл | Изменения |
|------|-----------|
| SQL миграция | +4 RLS политики для админов |
| OlegSettingsSection.tsx | +extractedRules в тип, +UI блоки, +константы категорий |

**Оценка объёма:** ~40 строк SQL, ~60 строк TSX

---

## Критерии приёмки (DoD)

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Сохранение пакета | Работает без ошибки RLS |
| После анализа | Показывает: summary, extractedRules, category, exampleResponse |
| Системные пакеты | Админы не могут удалить/изменить is_system=true |

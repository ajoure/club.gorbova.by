
# План: Исправление кнопки "Формула точки B" и админ-просмотр прогресса учеников

## Обнаруженные проблемы

### Проблема 1: Кнопка "Формула точки B сформирована" не нажимается

**Анализ кода `SequentialFormBlock.tsx`:**

```tsx
// Строки 95-100: Инициализация localAnswers из props
useEffect(() => {
  if (Object.keys(answers).length > 0 && Object.keys(localAnswers).length === 0) {
    setLocalAnswers(answers);
  }
}, [answers]);
```

**Проблема**: Условие `Object.keys(localAnswers).length === 0` означает, что если `localAnswers` уже заполнены, то данные из `answers` prop НЕ синхронизируются. 

Но главная проблема в том, что `answers` prop (который приходит из `state?.pointB_answers`) **пуст** в БД!

**Цепочка данных:**
1. Пользователь заполняет шаги → `localAnswers` обновляется
2. При `onBlur` или навигации → `commitAnswers()` вызывает `onAnswersChange?.(localAnswers)`
3. `onAnswersChange` = `handleSequentialFormUpdate` (KvestLessonView.tsx:234)
4. `handleSequentialFormUpdate` вызывает `updateState({ pointB_answers: answers })`
5. `updateState` (useLessonProgressState.tsx:97) сохраняет в `lesson_progress_state`

**Почему данные не сохраняются?**

Посмотрев на БД:
```json
{
  "completedSteps": ["90daa613-...", "ee5f06cb-..."],
  "currentStepIndex": 2,
  "role": "executor"
}
```

Нет `pointA_rows`, `pointB_answers`, `pointA_completed` — это значит что данные диагностической таблицы и формулы B **не сохраняются**.

**Корневая причина**: `onAnswersChange` передаётся как `undefined` когда `isReadOnly = true`!

```tsx
// KvestLessonView.tsx:331
onAnswersChange: isReadOnly ? undefined : handleSequentialFormUpdate,
```

А `isReadOnly = isCompleted && !isCurrent`, где `isCompleted` для sequential_form это:
```tsx
// Строка 333
isCompleted: state?.pointB_completed || false,
```

Если `pointB_completed = false` и блок текущий (`isCurrent = true`), то `isReadOnly = false`, и `onAnswersChange` ДОЛЖЕН передаваться.

**Реальная причина**: На скриншоте пользователь находится в **редакторе админки** (`/admin/training-lessons/.../edit/...`), а НЕ в режиме прохождения урока!

В редакторе блоков (`AdminLessonBlockEditor.tsx`) блоки рендерятся через `LessonBlockEditor.tsx`, где:
```tsx
// LessonBlockEditor.tsx:338
case 'sequential_form':
  return <SequentialFormBlock content={block.content as any} onChange={onUpdate} />;
```

**НЕТ пропсов `answers`, `onAnswersChange`, `onComplete`!** Это режим редактирования, а не режим игрока.

Но на скриншоте показывается режим **Preview** (предпросмотр), где должны быть эти пропсы.

### Проблема 2: Нет интерфейса для просмотра прогресса учеников

В админке нет страницы для просмотра:
- Кто прошёл какой урок
- Какие ответы дал ученик
- Результаты диагностики точки А и формулы точки B

## Решение

### Часть 1: Исправить кнопку SequentialFormBlock

**Проблема в логике инициализации:**
```tsx
useEffect(() => {
  if (Object.keys(answers).length > 0 && Object.keys(localAnswers).length === 0) {
    setLocalAnswers(answers);
  }
}, [answers]);
```

Если `answers` изменились (например, загрузились из БД), но `localAnswers` уже имеют данные (введённые пользователем), то синхронизация НЕ произойдёт.

**Исправление**: Добавить **двустороннюю синхронизацию** и убрать условие:

```tsx
// Синхронизация с внешними answers при изменении
useEffect(() => {
  // Merge incoming answers with local (incoming takes priority if we have no local edits)
  if (Object.keys(answers).length > 0) {
    setLocalAnswers(prev => {
      // If local is empty, use incoming
      if (Object.keys(prev).length === 0) return answers;
      // Otherwise keep local (user is editing)
      return prev;
    });
  }
}, [answers]);
```

Но проблема глубже: **когда `onComplete` undefined, кнопка не должна работать**.

Нужно добавить **fallback**: если `onComplete` не передан, кнопка должна всё равно быть интерактивной (для preview режима).

### Часть 2: Добавить страницу прогресса учеников

**Новые компоненты:**

1. **`src/pages/admin/AdminLessonProgress.tsx`** — страница просмотра прогресса по уроку
2. **Кнопка "Прогресс"** в списке уроков (`AdminTrainingLessons.tsx`)

**Схема данных:**

```text
lesson_progress_state (существует):
├── id
├── user_id → profiles
├── lesson_id → training_lessons
├── state_json (JSONB):
│   ├── role
│   ├── videoProgress: {blockId: percent}
│   ├── pointA_rows: [{source, income, task_hours, ...}]
│   ├── pointA_completed: boolean
│   ├── pointB_answers: {stepId: "answer"}
│   ├── pointB_completed: boolean
│   ├── currentStepIndex: number
│   └── completedSteps: [blockIds]
├── completed_at
└── updated_at
```

**UI страницы прогресса:**

| Ученик | Email | Роль | Точка А | Точка B | Завершён | Действия |
|--------|-------|------|---------|---------|----------|----------|
| Имя | email | executor | ✅ | ❌ | ❌ | Просмотр |

**Модальное окно "Просмотр":**
- Данные точки А (таблица с источниками дохода)
- Формула точки B (10 ответов)
- Результат теста (роль)

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/admin/lesson-editor/blocks/SequentialFormBlock.tsx` | Исправить логику инициализации `localAnswers`, добавить fallback для кнопки |
| `src/pages/admin/AdminTrainingLessons.tsx` | Добавить кнопку "Прогресс" для уроков с `completion_mode = 'kvest'` |
| `src/pages/admin/AdminLessonProgress.tsx` | **НОВЫЙ** — страница просмотра прогресса учеников |
| `src/components/admin/trainings/StudentProgressModal.tsx` | **НОВЫЙ** — модальное окно с детальным просмотром ответов |
| `src/App.tsx` | Добавить роут `/admin/training-lessons/:moduleId/progress/:lessonId` |

## Детальные изменения

### 1. SequentialFormBlock.tsx — исправление кнопки

**Строки 95-100**: Заменить инициализацию:

```tsx
// БЫЛО:
useEffect(() => {
  if (Object.keys(answers).length > 0 && Object.keys(localAnswers).length === 0) {
    setLocalAnswers(answers);
  }
}, [answers]);

// СТАЛО:
// Initialize from props on mount
useEffect(() => {
  if (Object.keys(answers).length > 0) {
    setLocalAnswers(answers);
  }
}, []); // Only on mount

// Reset local answers when answers prop changes significantly (e.g., block reset)
useEffect(() => {
  const answerKeys = Object.keys(answers);
  const localKeys = Object.keys(localAnswers);
  // If answers were cleared externally, reset local
  if (answerKeys.length === 0 && localKeys.length > 0 && isCompleted === false) {
    // Don't reset if user is actively editing
  }
}, [answers, isCompleted]);
```

**Строки 394-405**: Добавить fallback для кнопки:

```tsx
<Button
  onClick={() => {
    commitAnswers();
    if (onComplete) {
      onComplete();
    } else {
      // Fallback: show toast for preview/edit mode
      toast?.success?.("Формула сформирована (preview)");
    }
  }}
  disabled={!allFilled}
  variant="default"
>
  <CheckCircle2 className="mr-2 h-4 w-4" />
  {content.submitButtonText || 'Завершить'}
</Button>
```

**Добавить импорт toast:**
```tsx
import { toast } from "sonner";
```

### 2. AdminLessonProgress.tsx — новая страница

```tsx
// Структура компонента:
export default function AdminLessonProgress() {
  const { moduleId, lessonId } = useParams();
  
  // Fetch lesson info
  const { data: lesson } = useQuery({...});
  
  // Fetch all progress records for this lesson
  const { data: progressRecords } = useQuery({
    queryKey: ["lesson-progress", lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lesson_progress_state")
        .select(`
          *,
          profiles:user_id (
            id,
            email,
            full_name
          )
        `)
        .eq("lesson_id", lessonId)
        .order("updated_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });
  
  // Render table with students and their progress
  return (
    <AdminLayout>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ученик</TableHead>
            <TableHead>Роль</TableHead>
            <TableHead>Точка А</TableHead>
            <TableHead>Точка B</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Обновлено</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {progressRecords?.map(record => (
            <TableRow key={record.id}>
              <TableCell>{record.profiles?.full_name || record.profiles?.email}</TableCell>
              <TableCell>
                <Badge>{record.state_json?.role || '—'}</Badge>
              </TableCell>
              <TableCell>
                {record.state_json?.pointA_completed ? '✅' : '❌'}
              </TableCell>
              <TableCell>
                {record.state_json?.pointB_completed ? '✅' : '❌'}
              </TableCell>
              <TableCell>
                <Badge variant={record.completed_at ? "default" : "secondary"}>
                  {record.completed_at ? 'Завершён' : 'В процессе'}
                </Badge>
              </TableCell>
              <TableCell>{formatDate(record.updated_at)}</TableCell>
              <TableCell>
                <Button size="sm" onClick={() => openDetailModal(record)}>
                  Просмотр
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminLayout>
  );
}
```

### 3. StudentProgressModal.tsx — модальное окно

```tsx
interface StudentProgressModalProps {
  record: LessonProgressRecord;
  lessonBlocks: LessonBlock[];
  open: boolean;
  onClose: () => void;
}

export function StudentProgressModal({ record, lessonBlocks, open, onClose }: StudentProgressModalProps) {
  const state = record.state_json;
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Прогресс: {record.profiles?.full_name}</DialogTitle>
        </DialogHeader>
        
        {/* Role from quiz */}
        <Card>
          <CardHeader>
            <CardTitle>Роль</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{roleLabels[state?.role] || state?.role || '—'}</Badge>
          </CardContent>
        </Card>
        
        {/* Point A - Diagnostic Table */}
        {state?.pointA_rows && (
          <Card>
            <CardHeader>
              <CardTitle>Диагностика точки А</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Источник</TableHead>
                    <TableHead>Доход</TableHead>
                    <TableHead>Часы задач</TableHead>
                    <TableHead>Часы переписки</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.pointA_rows.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{row.source_name}</TableCell>
                      <TableCell>{row.income} BYN</TableCell>
                      <TableCell>{row.task_hours} ч</TableCell>
                      <TableCell>{row.communication_hours} ч</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        
        {/* Point B - Sequential Form Answers */}
        {state?.pointB_answers && (
          <Card>
            <CardHeader>
              <CardTitle>Формула точки B</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Find sequential_form block to get step titles */}
              {getSequentialFormSteps(lessonBlocks).map(step => (
                <div key={step.id} className="border-b pb-3">
                  <Label className="text-sm text-muted-foreground">{step.title}</Label>
                  <p className="mt-1">{state.pointB_answers[step.id] || '—'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

### 4. AdminTrainingLessons.tsx — кнопка прогресса

**В действиях каждого урока добавить:**

```tsx
{lesson.completion_mode === 'kvest' && (
  <Button
    variant="outline"
    size="sm"
    onClick={() => navigate(`/admin/training-lessons/${moduleId}/progress/${lesson.id}`)}
  >
    <Users className="h-4 w-4 mr-1" />
    Прогресс
  </Button>
)}
```

### 5. App.tsx — новый роут

```tsx
<Route 
  path="/admin/training-lessons/:moduleId/progress/:lessonId" 
  element={<ProtectedRoute><AdminLessonProgress /></ProtectedRoute>} 
/>
```

## DoD (Definition of Done)

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Кнопка "Формула точки B сформирована" | Нажимается при заполнении 10/10 шагов |
| Данные pointB_answers | Сохраняются в lesson_progress_state.state_json |
| Страница "Прогресс" для квест-урока | Показывает список учеников с их статусами |
| Модальное окно "Просмотр" | Показывает детальные ответы ученика |
| Роль ученика | Отображается корректно (Исполнитель/Фрилансер/Предприниматель) |

## Техническая заметка

Текущая архитектура сохранения данных через `useLessonProgressState` работает корректно, но требует что бы:
1. `onAnswersChange` callback передавался в `SequentialFormBlock`
2. Пользователь находился в режиме прохождения урока (не в режиме редактирования)

Режим Preview в редакторе (`?preview=1`) не имеет полноценного контекста `useLessonProgressState`, поэтому данные там НЕ сохраняются — это **ожидаемое поведение**.

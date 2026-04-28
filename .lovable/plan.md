План: красивый sticky-dock в уроке тренинга

## Контекст
На странице урока (`src/pages/LibraryLesson.tsx`, маршрут `/library/<module>/<lesson>`) сейчас кнопки разнесены:
- «Отметить как пройденный» — отдельный центрированный блок с ярко-синей `default`-кнопкой (строки 551–562).
- «Завершить» — крайняя правая кнопка в ряду навигации Назад/Далее (строки 567–607), тоже ярко-синяя.

Нужен «премиальный» вид: одна frosted-glass панель внизу экрана с обеими кнопками и навигацией, в стиле уже существующих в проекте toast/sonner (`bg-background/40 backdrop-blur-xl border-border/30`) — не яркие синие пилюли.

## Что меняем

### 1. Sticky-dock внизу экрана (LessonActionDock)
Создать новый компонент `src/components/lesson/LessonActionDock.tsx` — закреплённая снизу панель:

- Позиционирование: `fixed bottom-4 left-1/2 -translate-x-1/2 z-40`, центрируется в видимой области; на мобильных — `bottom-3 inset-x-3 translate-x-0` (растягивается на всю ширину с боковыми отступами).
- Геометрия: `rounded-2xl`, `px-2 py-2`, max-width ~`880px`, `min-h-12`.
- Frosted-glass фон (как в `sonner.tsx`/`toast.tsx`): `bg-background/60 dark:bg-background/40 backdrop-blur-xl border border-border/40 shadow-lg shadow-black/5 ring-1 ring-white/5`.
- Внутри — flex-row с тремя зонами:
  - слева: кнопка «Назад» (`prevLesson`) — `ghost` стиль с лёгким hover `bg-foreground/5`, иконка `ArrowLeft`, в тексте — короткое «Назад» (полное название в `title`/tooltip, чтобы dock не раздувался);
  - центр: основное действие — toggle «Отметить как пройденный» / «Отметить как непройденный»; стиль — мягкая «soft» pill: `bg-primary/15 text-primary hover:bg-primary/25 border border-primary/20 backdrop-blur-md`, иконка `CheckCircle2`. Когда урок уже пройден — `bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25` + иконка `RotateCcw`/`CheckCheck`;
  - справа: «Далее» — на последнем уроке заменяется на «Завершить» (тот же мягкий primary-стиль, чуть более акцентный: `bg-primary/20 ... border-primary/30`).
- Все кнопки — `size="sm"` или `size="default"` через shadcn `Button` с `variant="ghost"` + кастомные классы (никаких ярких `default`-fillов).
- Разделители между зонами: тонкие `w-px h-6 bg-border/40` для премиального ощущения.

Поведение:
- На мобильных — текстовые лейблы навигации скрываются (`hidden sm:inline`), остаются только иконки.
- При длинных названиях соседних уроков использовать `title` атрибут (нативный tooltip) вместо растягивания dock.
- Чтобы dock не закрывал последний контент урока, добавить `pb-28` нижний spacer в `LibraryLesson` контейнере.
- Анимация появления: `animate-in slide-in-from-bottom-4 fade-in` (tailwindcss-animate уже подключен).

### 2. Удаление старых блоков в `LibraryLesson.tsx`
- Убрать блок `Complete Button` (553–562).
- Убрать `Separator` (564) и блок `Navigation` (566–607).
- Вместо них — рендер `<LessonActionDock ... />` после основного контента; передать props: `isCompleted`, `onToggleComplete`, `prevLesson`, `nextLesson`, `onNavigatePrev`, `onNavigateNext`, `onFinish` (поведение «Завершить» — текущая логика возврата либо в секцию меню, либо в `/library/<moduleSlug>`).
- Добавить `pb-28 md:pb-24` в основной контейнер страницы, чтобы контент не уходил под dock.

### 3. Согласованность стиля (без расширения скоупа)
- Использовать только уже принятые в проекте токены (`bg-background/*`, `border-border/*`, `text-primary`, `text-emerald-*`) — никаких новых цветов в `tailwind.config.ts`/`index.css` не добавляем.
- Никаких изменений в логике прогресса, маршрутизации, доступа — это чисто UI-рефактор.

## Затронутые файлы
- `src/pages/LibraryLesson.tsx` — удалить старые блоки кнопок, подключить dock, добавить нижний padding.
- `src/components/lesson/LessonActionDock.tsx` — новый компонент frosted-glass dock.

## Проверка (DoD)
1. Открыть `/library/<module>/<lesson>` под текущим логином в превью.
2. Скрин 1: общий вид страницы — dock закреплён внизу, контент над ним не обрезается.
3. Скрин 2: hover на «Отметить как пройденный» — мягкое подсвечивание, без ярко-синей заливки.
4. Скрин 3: состояние «урок пройден» — кнопка в emerald-soft варианте, текст «Отметить как непройденный».
5. Скрин 4: последний урок модуля — справа в dock «Завершить» вместо «Далее».
6. Проверка адаптива (узкое окно): dock прижимается к краям с отступами, текст навигации скрывается, остаются иконки + центральная кнопка.
7. Никаких регрессий: переходы Назад/Далее, toggle прогресса, возврат «Завершить» работают как раньше.

# да, согласен, с учетом правок:

&nbsp;

1. Viewport meta: запрет масштабирования — не принимаем как “фикс”  

  - maximum-scale=1.0, user-scalable=no не решает vh-сдвиги и может ухудшить доступность. Убираем это из плана как основной метод.
  - Вместо этого фиксируем причину zoom: все input/textarea/select в мобильной зоне должны иметь font-size >= 16px.
  - DoD: на iOS при фокусе нет zoom без запрета user-scalable.
2. &nbsp;
3. --app-height добавлен, но не используется  

  - Сейчас ты добавляешь переменную, но в плане меняешь h-screen → h-[100dvh]. Это делает --app-height лишним.
  - Выбираем один путь: использовать --app-height в layout, чтобы не размазывать dvh по классам:  

    - В src/index.css оставить --app-height (как у тебя).
    - В AdminLayout.tsx заменить h-screen на класс/стиль, который использует переменную: h-[var(--app-height)] (или inline style height: var(--app-height)).
  - &nbsp;
  - DoD: в коде реально используется --app-height, нет “мертвого” CSS.
4. &nbsp;
5. h-[100dvh] недостаточно: нужен safe-area padding  

  - На iOS при клавиатуре/динамических панелях важно не только dvh, но и нижняя safe-area.
  - В AdminLayout.tsx добавить pb-[env(safe-area-inset-bottom)] (и при необходимости pt-[env(safe-area-inset-top)] для шапки).
  - DoD: нижняя панель ввода/кнопки не уезжают под home-indicator.
6. &nbsp;
7. Добавить обязательный UI-guard для input zoom  

  - В src/index.css добавить правило:  

    - input, textarea, select { font-size: 16px; } только для mobile (через media query), чтобы не ломать desktop типографику.
  - &nbsp;
  - Убрать из плана утверждения “уже имеет 16px”, пока не подтверждено поиском по коду.
  - DoD: iPhone Safari — фокус на input/textarea не вызывает zoom.
8. &nbsp;
9. DoD расширить до конкретного сценария “клавиатура открылась”  

  - iOS Safari: открыть чат, тап по полю ввода → список сообщений не прыгает, поле ввода остаётся видимым, нет “белой полосы” снизу.
  - Проверить портрет/ландшафт.
  - Проверить TelegramChat и InstagramChat.
10. &nbsp;
11. Проверка по файлам чатов: убрать любые зависимости от vh  

  - В ContactTelegramChat.tsx и ContactInstagramChat.tsx запретить h-screen/h-[100vh] внутри чата; только flex-1 min-h-0 от родителя.
  - DoD: в этих компонентах нет vh-высот.
12. &nbsp;
13. План оформить как add-only  

  - Не “заменить на dvh” точечно, а добавить правило: все места с h-screen/100vh в админке, где есть ввод, переводим на var(--app-height).
14. &nbsp;

&nbsp;

&nbsp;

Если нужно, дам копируемый блок обновлённого плана целиком (v4) в одном сообщении.

&nbsp;

План: Фикс мобильной верстки — стабильный размер экрана при открытии клавиатуры

## Проблема

На iOS при фокусе на поле ввода (клавиатура открывается):

1. Viewport увеличивается/смещается (iOS zoom на input с `font-size < 16px`)
2. Layout перестраивается из-за изменения `100vh` — iOS считает `vh` по полному экрану, а не по видимой части

## Изменения

### 1. `index.html` — запретить масштабирование на мобильных

Строка 5: добавить `maximum-scale=1.0, user-scalable=no` в viewport meta:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
```

Это предотвращает auto-zoom iOS при фокусе на input.

### 2. `src/index.css` — использовать `dvh` для стабильного layout

Добавить CSS-переменную и утилиту для dynamic viewport height:

```css
:root {
  --app-height: 100dvh;
}

/* Fallback for browsers without dvh support */
@supports not (height: 100dvh) {
  :root {
    --app-height: 100vh;
  }
}
```

### 3. `src/components/layout/AdminLayout.tsx` — заменить `h-screen` на `h-[100dvh]`

Строка 123: `h-screen` → `h-[100dvh]` — использует dynamic viewport height, который учитывает клавиатуру и safe areas на iOS:

```tsx
<div className="h-[100dvh] flex w-full overflow-hidden">
```

### 4. `src/components/admin/ContactTelegramChat.tsx` — стабилизировать chat layout

Убедиться что корневой `div` чата не зависит от `vh` и использует flex-layout для заполнения доступного пространства (уже используется `flex flex-col h-full`).

Textarea (строка 1422): уже имеет `font-size: 16px` через глобальное правило в `index.css`. Оставить как есть.

### 5. `src/components/admin/communication/instagram/ContactInstagramChat.tsx` — аналогичная проверка

Input (строка в форме отправки) уже использует компонент `Input` с `text-sm` — iOS zoom предотвращён глобальным правилом `input { font-size: 16px }`.

## Итого файлов


| Файл                                    | Изменение                                             |
| --------------------------------------- | ----------------------------------------------------- |
| `index.html`                            | `maximum-scale=1.0, user-scalable=no` в viewport meta |
| `src/index.css`                         | CSS-переменная `--app-height: 100dvh` с fallback      |
| `src/components/layout/AdminLayout.tsx` | `h-screen` → `h-[100dvh]`                             |

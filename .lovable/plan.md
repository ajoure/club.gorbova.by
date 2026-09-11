# План: READ-ONLY ревизия мобильной адаптации (scope codex/responsive-viewport)

Статус: **PLAN-ONLY / READ-ONLY — PASS с условиями.** Код, SQL, БД, Edge, auth,
webhook, deploy и Publish не выполнялись. Ожидается точный merged SHA от Codex.

## Что подтверждено чтением текущего кода (база `bbc231053`)

- `index.html`: `width=device-width, initial-scale=1.0, viewport-fit=cover,
  interactive-widget=resizes-content`. `user-scalable=no` и `maximum-scale`
  отсутствуют — требование «сохранить pinch zoom» уже выполнено, менять meta не нужно.
- `manifest.json`: `display: standalone`, `orientation: portrait-primary` —
  landscape в PWA не запрещён системно на iOS, поэтому landscape-правила нужны.
- `--app-height: 100dvh` объявлена статически в `:root` (`src/index.css`) и
  не обновляется из `visualViewport`. Её используют `AdminLayout` (fixed
  `height: var(--app-height)` + `overflow-hidden`) и три шторки
  (`AccessHistorySheet`, `ConsentDetailSheet`, `BillingDetailSheet`) через
  `calc(var(--app-height) - N)`. Любое изменение семантики переменной затрагивает все четыре места.
- `useVisualViewportInset` уже существует и корректно считает inset клавиатуры —
  новый helper должен переиспользовать её, а не дублировать слушатели.
- Правило `@media (max-width: 767px) { input, textarea, select { font-size: 16px } }`
  не покрывает `contenteditable`/`.ProseMirror` (композер) и не действует в
  landscape при ширине > 767px — отсюда автозум Safari при вводе.
- Safe-area: `.contact-center-safe-top/bottom` учитывают left/right, но шапки
  `DashboardLayout`/`MobileBottomNav` используют голый `env(...)` без `max()`,
  а `main` в Dashboard имеет `pb-20` без прибавления `safe-area-inset-bottom`.
- `SidebarProvider` задаёт `min-h-svh`, что конфликтует с фиксированной высотой
  `AdminLayout` и даёт двойной скролл-контейнер на мобильном.
- `html, body { overflow-x: hidden; max-width: 100vw }` уже стоят; есть
  контрактный тест `src/test/mobileDocumentScroll.contract.test.ts`, который
  запрещает `overscroll-behavior` на `body` — новые правила не должны его нарушить.

## Согласованный объём изменений (GitHub-only, UI/CSS/viewport helper)

1. Единый viewport-helper: одна подписка на `visualViewport` (resize/scroll),
   запись `--app-height` и `--keyboard-inset` в `documentElement`, throttle через
   `requestAnimationFrame`, корректный cleanup, безопасный фолбэк `100dvh/100vh`.
2. Зум ввода: распространить 16px на `[contenteditable]`, `.ProseMirror` и на
   landscape-фазу (по `pointer: coarse`, а не только по ширине).
3. Компактность: `ChannelPicker` и панели действий контакт-центра — перенос/скролл
   вместо выхода за 320px; кнопки сохраняют 44px touch-target.
4. Safe-area: `max(base, env(...))` для top/bottom/left/right в шапках, нижней
   навигации и нижнем резерве `main`.
5. Модалки/шторки: высота от `--app-height` с учётом клавиатуры, внутренняя
   прокрутка, липкий футер над home indicator.

## Риски регрессии, которые проверяем отдельно

- Двойной отступ notch в standalone (существующие правила `data-mobile-sticky-main`).
- Прыжки высоты при появлении iOS-клавиатуры, если `--app-height` начнёт
  включать keyboard inset — три шторки и AdminLayout нужно проверять вместе.
- Потеря инерционного скролла в `.touch-scroll`/`.table-scroll-x`.
- Регресс комнаты эфира (`liveRoomTheme.css`, `100svh`-композер).
- Падение контрактных тестов `mobileDocumentScroll` и `dealsMobileFilters`.

## План приёмки

Ширины: 320 / 375 / 390 / 430 / 768 / 1024 / 1280, портрет и ландшафт.
Среды: Safari iOS (browser), Safari standalone PWA, Android Chrome, десктоп.

Для каждого сочетания:
1. Горизонтального скролла и обрезанных кнопок/подписей нет; выбор канала целиком помещается на 320px.
2. Тап в поле ввода и в композер не вызывает автозум; ручной pinch zoom работает.
3. При открытой клавиатуре поле ввода и кнопка отправки видны, лента прокручивается.
4. Поворот экрана и закрытие клавиатуры возвращают корректную высоту без «залипшего» пустого блока.
5. В standalone контент не заезжает под notch и home indicator, в landscape — под боковые вырезы.
6. Модалки и шторки: заголовок и футер видны, содержимое прокручивается, ничего не уезжает за экран.
7. Контакт-центр: отправка сообщений тестовым клиентам не выполняется, проверка только визуальная.
8. Проверка после merge: точный SHA, `tsgo --noEmit`, профильные тесты, Preview 200; скриншоты
   ПК и мобильного — только после Publish, инициированного пользователем.

## Что не входит в scope

Отправка сообщений, изменения RPC/RLS/Edge/webhook, правки истории Telegram,
изменение meta viewport (запрет зума), переработка unified inbox группировки.

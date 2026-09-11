# План: READ-ONLY сверка мобильной адаптации (scope codex/responsive-viewport)

Статус: **PLAN-ONLY / READ-ONLY — PASS с условиями.** Код, SQL, БД, Edge, auth,
webhook, deploy и Publish не выполнялись. Ожидается точный merged SHA PR443
(UI-only, локальный head `8acded852`).

## Ревизия Codex (PR443), принятая к сверке

- Новый `appViewport`-helper: scale guard + единая подписка `visualViewport`
  (resize/scroll), throttle через `requestAnimationFrame`, корректный cleanup.
  Старый `useVisualViewportInset` в живом использовании не затронут (его
  результат сейчас не потребляется) — проверяем, что он не задвоил слушатели.
- `ChannelPicker`/панели каналов: компактный режим 3×44px на 320px без выхода за экран.
- Дополнительные production-исправления (по DOM 320px): вкладки `/products` и
  `/docs`, перенос цельных кнопок фильтров `/admin/contacts` и `/admin/products-v2`,
  сортировка каталога, блок аватара/ширина профиля.
- Типы/build и профильные тесты PASS; GitHub gate ещё идёт.

## Что подтверждено чтением текущего кода (база `bbc231053`)

- `index.html`: `width=device-width, initial-scale=1.0, viewport-fit=cover,
  interactive-widget=resizes-content`. `user-scalable=no` и `maximum-scale`
  отсутствуют — pinch zoom сохранён, менять meta не нужно.
- `manifest.json`: `display: standalone`, `orientation: portrait-primary` —
  landscape-правила нужны; в PWA системного запрета нет.
- `--app-height: 100dvh` объявлена статически в `:root`; её используют
  `AdminLayout` (fixed height + `overflow-hidden`) и шторки
  (`AccessHistorySheet`, `ConsentDetailSheet`, `BillingDetailSheet`).
  Смена семантики переменной затрагивает все эти места.
- Правило 16px `@media (max-width: 767px)` не покрывало `contenteditable`/
  `.ProseMirror` и landscape > 767px — источник автозума Safari.
- `DashboardLayout`/`MobileBottomNav` используют голый `env(safe-area-*)`
  без `max()`, а `main` имеет `pb-20` без home-inset — сверить с правками PR443.
- Контрактный тест `mobileDocumentScroll` запрещает `overscroll-behavior` на
  `body`; `dealsMobileFilters` фиксирует мобильный sheet — не должны сломаться.

## Приёмка (сверка после merged SHA)

Ширины: 320 / 375 / 390 / 430 / 768 / 1024 / 1280, портрет и ландшафт.
Среды: Safari iOS (browser), Safari standalone PWA, Android Chrome, десктоп.

1. Точный merged SHA совпадает с GitHub; tree clean; `tsgo --noEmit` и
   профильные тесты PASS; Preview HTTP 200.
2. 320–430px: горизонтального скролла нет; вкладки `/products`, `/docs`,
   фильтры контактов и products-v2 переносятся целиком; выбор канала 3×44px
   помещается; сортировка и блок аватара/профиля не обрезаются.
3. Поля ввода и композер без автозума; ручной pinch zoom работает (meta не изменён).
4. Клавиатура/поворот: unit-тесты keyboard/rotation/pinch PASS; helper пишет
   `--app-height`/inset без «залипших» значений и без двойных подписок.
5. Safe-area: notch/home indicator/боковые вырезы в standalone и landscape не
   перекрывают контент; двойных отступов нет.
6. Модалки/шторки: заголовок и футер видны, содержимое прокручивается.
7. Ограничение честности: физических устройств нет — real-iPhone/реальный PWA
   PASS не утверждается; доказательства только unit + Preview DOM/скриншоты
   viewports. Скриншоты опубликованного UI — только после Publish пользователем.
8. Отправка сообщений, RPC/RLS/Edge/webhook, история Telegram, meta viewport —
   не в scope и не менялись.

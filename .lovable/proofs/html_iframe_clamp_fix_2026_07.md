# HTML-блок конструктора: снятие визуальной обрезки длинных лендингов

## Диагноз
Проблема НЕ в сохранении. Проверено:
- textarea без `maxLength`, zod-схема без `.max()`, save идёт напрямую в `site_pages.blocks` (jsonb).
- В БД реально лежит полный контент:
  - `ЦБ 2.0 из тильды` — 599 242 байт
  - `Групповая консультация` — 2 491 748 байт

Причина визуальной обрезки — жёсткий clamp высоты iframe в `HtmlIframePreview.tsx`:
```
const MAX_IFRAME_HEIGHT = 15000; // px
```
Реальная высота Tilda-лендинга ЦБ 2.0 — ~49 000 px (desktop) / ~58 000 px (mobile). Всё, что выше 15 000 px, физически не показывалось.

## Правка
`src/components/shared/HtmlIframePreview.tsx`:
- `MAX_IFRAME_HEIGHT = 100000` (было 15000). ~26 экранов FullHD — с запасом.
- При превышении лимита пишется `console.warn('[HtmlIframePreview] height clamped', { raw, max })` — сразу видно причину, если что.

Санитайзер / sandbox / схема БД / edge functions — не тронуты.

## Верификация (Playwright, localhost)
Страница `/cb20versia` (ЦБ 2.0 из тильды):

| Viewport | Реальная высота iframe | Clamp сработал? |
|---|---|---|
| Desktop 1280×1800 | 49 117 px | нет |
| Mobile 390×844 | 57 852 px | нет |

Скриншот низа страницы desktop показывает финальный футер «Made on Tilda» — то, что раньше было обрезано.

Файлы: `/tmp/browser/cb/desktop_bottom.png`, `/tmp/browser/cb/mobile_bottom.png`.

## Что делать, если попадётся ещё более длинная страница
В DevTools появится warning `HtmlIframePreview height clamped`. Тогда — поднять `MAX_IFRAME_HEIGHT` до 200 000 или выше. Полностью снимать защиту не стоит — она страхует от runaway CSS (`min-height: 999vh` в кривой вёрстке).

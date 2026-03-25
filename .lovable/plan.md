

# Исправление серых полей по бокам HTML-блока

## Scope — 2 файла, без изменения глобального App.css

### 1. `src/components/site-renderer/blocks/HtmlSection.tsx`

Убрать `py-6 px-6` и `max-w-4xl mx-auto`. Ширину контролирует BlockWrapper.

```tsx
// Было:
<section className="py-6 px-6">
  <div className="max-w-4xl mx-auto">
    <HtmlIframePreview html={code} />
  </div>
</section>

// Станет:
<section>
  <HtmlIframePreview html={code} />
</section>
```

### 2. `src/components/shared/HtmlIframePreview.tsx`

В `buildSrcdoc` fallback-обертке: `padding: 0` вместо `padding: 16px`.

```css
/* Было: */
body { margin: 0; padding: 16px; font-family: ... }
/* Станет: */
body { margin: 0; padding: 0; font-family: ... }
```

**Compatibility rule:** Это изменение касается только fallback-обертки (когда входной HTML не содержит `</body>`). Полноценный HTML с собственным `</body>` вставляется as-is — без изменений. Другие потребители (`HtmlBlockEditor`, `HtmlRawBlock`) используют тот же компонент, но они рендерят в рамках admin-контейнеров с собственными border/overflow — padding iframe-body для них не критичен.

### 3. `src/App.css` — НЕ МЕНЯЕМ

`#root { max-width: 1280px; padding: 2rem; }` остается без изменений. Это shared/global слой. Для публичных сайтов ограничение `#root` не является причиной проблемы — основные ограничители были `max-w-4xl` в HtmlSection и `padding: 16px` в iframe body. Если после правок 1-2 проблема останется — потребуется отдельный route-scoped override с DRY RUN.

## Verify checklist

- HTML block на публичном сайте без серых полей по бокам
- `fullWidth` / `maxWidth` из BlockWrapper продолжают управлять шириной
- Fallback iframe wrapper без внутренних отступов
- Админка: `HtmlBlockEditor` и `HtmlRawBlock` рендерятся корректно (в обёртках с `border rounded-lg overflow-hidden`)


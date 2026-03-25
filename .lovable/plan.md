

# Локальный override для #root на публичных сайтах

## Статус предыдущих правок
Правки 1 и 3 из плана уже применены:
- HtmlSection.tsx — убраны `py-6 px-6` и `max-w-4xl mx-auto`
- HtmlIframePreview.tsx — `padding: 0` в fallback body

## Оставшаяся проблема
`#root { max-width: 1280px; padding: 2rem; }` в App.css ограничивает публичные сайты. DomainRouter рендерит SitePageRenderer напрямую внутри `#root`, без промежуточной обёртки.

## Решение — route-scoped override (без изменения App.css)

### Файл: `src/components/layout/DomainRouter.tsx`

Обернуть SitePageRenderer в div с классом, который сбрасывает ограничения `#root`:

```tsx
// Строка ~82
return (
  <div className="site-public-layout">
    <SitePageRenderer ... />
  </div>
);
```

### Файл: `src/index.css` (или создать отдельный CSS)

Добавить scoped override:

```css
/* Route-scoped override: публичные сайты не ограничены #root constraints */
#root:has(.site-public-layout) {
  max-width: none;
  padding: 0;
  text-align: left;
}
```

`:has()` поддерживается во всех современных браузерах (Chrome 105+, Safari 15.4+, Firefox 121+).

## Безопасность
- App.css не меняется
- Override срабатывает только когда внутри `#root` есть `.site-public-layout`
- Админка и все остальные страницы сохраняют `max-width: 1280px; padding: 2rem`

## Verify
- HTML block на публичном сайте без серых полей
- Админка сохраняет текущий layout
- Работает на мобильных и планшетах


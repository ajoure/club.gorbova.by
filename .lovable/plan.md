

# Добавить URL страницы под полем Slug (как в тренингах)

## Что делаем

По аналогии с тренингами (где под slug показывается `URL: gorbova.club/training/{slug}`), добавить подсказку с URL под полем Slug в настройках сайта.

Для сайтов URL формируется из привязанных доменов. Если домен привязан — показать `URL: {domain}`. Если нет — показать подсказку что URL появится после привязки домена.

## Файл: `src/components/admin/site-builder/SiteSettingsPanel.tsx`

Под полем Slug (строка 50) добавить текст с URL:

```tsx
<div className="space-y-2">
  <Label>Адрес страницы</Label>
  <Input
    value={slug}
    onChange={(e) => onSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
  />
  {bindings.length > 0 ? (
    <p className="text-xs text-muted-foreground">
      URL: {bindings[0].domain}/<strong>{slug || "..."}</strong>
    </p>
  ) : (
    <p className="text-xs text-muted-foreground">
      Привяжите домен, чтобы увидеть URL страницы
    </p>
  )}
</div>
```

Также переименовать Label с «Slug» на «Адрес страницы» для единообразия с тренингами.


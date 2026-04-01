

# План: Фикс формы + редирект + 6 блоков из уроков (финальная версия с правками)

## Правки к предыдущей версии

### 1. safeRedirect вместо raw `window.location.href`
```typescript
function safeRedirect(url: string) {
  if (url.startsWith('/')) {
    window.location.href = url;
  } else {
    window.open(url, '_self', 'noopener,noreferrer');
  }
}
```

### 2. Embed — проверка `https:` протокола
```typescript
function isAllowedEmbedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return EMBED_WHITELIST.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  } catch { return false; }
}
```

### 3. Логирование redirect в edge function
`site-form-submit` сохраняет `redirect_url` в `site_form_submissions.metadata` вместе с `submission_id` — для аналитики конверсии и дебага.

---

## Полный scope (без повторения неизменённых частей)

### Шаг 1: Фикс pageId в превью
- `SitePreview.tsx` — добавить prop `pageId?: string`, передать в `SitePageRenderer`
- `AdminSiteEditor.tsx` — передать `pageId={id}`

### Шаг 2: Redirect после отправки
- `types.ts` — `redirectUrl: z.string().default("")` в formContentSchema
- `FormBlockEditor.tsx` — Input «URL перенаправления» + Input «redirect_url» передаётся в payload
- `FormSection.tsx` — `isSafeRedirectUrl()` (только `https://` или `/relative`) + `safeRedirect()` вместо raw `window.location.href`
- `site-form-submit/index.ts` — сохранять `redirect_url` в `metadata` submission-записи
- Обратная совместимость: старые формы без `redirectUrl` → показывают «Спасибо»

### Шаг 3: 6 блоков из уроков
- **Accordion, Tabs, Callout, Quote** — прямой импорт из `lesson-editor/blocks/`, без новых файлов
- **Audio** — обёртка `SiteAudioBlockEditor` (только URL) + `AudioSection`
- **Embed** — обёртка `SiteEmbedBlockEditor` + `EmbedSection` с `isAllowedEmbedUrl()` (whitelist + `https:` protocol guard)
- Регистрация в `BLOCK_TYPES`, `getDefaultContent`, `SitePageRenderer`

### Изменяемые файлы

| Файл | Действие |
|---|---|
| `SitePreview.tsx` | prop `pageId` |
| `AdminSiteEditor.tsx` | передать `pageId={id}` |
| `types.ts` | `redirectUrl` + 6 content schemas |
| `FormBlockEditor.tsx` | Input redirectUrl |
| `FormSection.tsx` | `safeRedirect()` + `isSafeRedirectUrl()` |
| `site-form-submit/index.ts` | `redirect_url` в metadata |
| `SiteBlockEditor.tsx` | 6 блоков в BLOCK_TYPES + getDefaultContent |
| `SitePageRenderer.tsx` | 6 case в renderBlock |
| `SiteAudioBlockEditor.tsx` | Новый: audio editor (URL only) |
| `AudioSection.tsx` | Новый: audio renderer |
| `SiteEmbedBlockEditor.tsx` | Новый: embed editor + whitelist warning |
| `EmbedSection.tsx` | Новый: embed renderer + protocol + whitelist guard |

### DoD
- Форма в превью работает (pageId прокинут)
- Redirect: только `https://` или `/relative`, через `safeRedirect()`, `javascript:` заблокирован
- `redirect_url` логируется в metadata submission
- Старые формы без `redirectUrl` работают без ошибок
- 6 блоков доступны в конструкторе (accordion, tabs, callout, quote, audio, embed)
- Embed: только `https:` + whitelist; `javascript://youtube.com/...` заблокирован
- Остальные блоки уроков НЕ зарегистрированы (scope второй итерации)


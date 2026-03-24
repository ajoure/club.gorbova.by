# да, согласен, с учетом правок:

&nbsp;

1. **overlayClassName обязательно делать строго add-only и с дефолтным поведением 1:1.**
  Если prop не передан, AlertDialogOverlay должен рендериться точно как сейчас, без изменений для остальных dialog.
2. **В alert-dialog.tsx пропустить overlayClassName через cn(...), а не вставлять сырым классом.**
  То есть базовый класс overlay + overlayClassName, чтобы не потерять анимации, fixed inset, z-index и существующие data-state классы.
3. **В DoD добавить proof, что reopen dialog остался на дефолтном overlay.**
  Не только “не затронут”, а именно показать, что у него остался прежний bg-black/80, а у confirm dialog стал bg-black/40.
4. **Проверить все остальные использования AlertDialogContent на типизацию после расширения prop.**
  Особенно если есть обертки/реэкспорты, чтобы add-only правка не дала TS-регрессий.

&nbsp;

&nbsp;

В остальном план точный и безопасный.

&nbsp;

PATCH 1.2.2 — Локальное облегчение overlay confirm dialog

## Проблема

`AlertDialogContent` на строке 33 рендерит `<AlertDialogOverlay />` без возможности передать `className`. Overlay всегда `bg-black/80`.

## Решение

**Add-only правка в `alert-dialog.tsx**`: расширить `AlertDialogContent` опциональным prop `overlayClassName`, пробрасываемым в `AlertDialogOverlay`.

### Файл: `src/components/ui/alert-dialog.tsx` (строки 28-43)

Добавить `overlayClassName` в деструктуризацию props `AlertDialogContent`:

```tsx
const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    overlayClassName?: string;
  }
>(({ className, overlayClassName, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay className={overlayClassName} />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
```

### Файл: `src/components/corporate/CorporateWizard.tsx`

В confirm dialog `AlertDialogContent` добавить:

```tsx
<AlertDialogContent
  className="max-w-md p-5 gap-3"
  overlayClassName="bg-black/40"
>
```

## Что НЕ меняется

- Reopen dialog (не использует `overlayClassName` → остаётся `bg-black/80` по умолчанию)
- Логика close protection, flushSave, draft persistence
- Кнопки, тексты, spacing из PATCH 1.2.1
- Все остальные `AlertDialogContent` в проекте — без `overlayClassName` работают как раньше

## Файлы


| Файл                                           | Что                                                       |
| ---------------------------------------------- | --------------------------------------------------------- |
| `src/components/ui/alert-dialog.tsx`           | Add-only: `overlayClassName` prop на `AlertDialogContent` |
| `src/components/corporate/CorporateWizard.tsx` | Передать `overlayClassName="bg-black/40"`                 |


## DoD

- Overlay confirm dialog: `bg-black/40` вместо `bg-black/80`
- Reopen dialog не затронут (proof)
- Другие alert dialogs не затронуты
- Логика PATCH 1.2 сохранена
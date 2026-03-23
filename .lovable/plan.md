# да, согласен, с учетом правок:

1. В `AiDocumentsGenerateView.tsx` после закрытия dialog очищать `selectedTemplate`, чтобы не было stale-template при следующем открытии:
  - обернуть `onOpenChange`
  - при `false` делать `setWizardOpen(false)` и `setSelectedTemplate(null)`
2. Для надёжного remount dialog при смене шаблона добавить `key={selectedTemplate?.id ?? "no-template"}` на `GenerateAiDocumentDialog`, чтобы шаг wizard и внутренний state не перетекали между разными шаблонами.
3. В `GenerateAiDocumentDialog.tsx` null-guard сделать безопасным:
  - не просто `template?.name`, `template?.placeholders`, `template?.id`
  - инициализацию preview / placeholders / generate params тоже строить от `template ?? null`, без доступа к полям до проверки
4. В `handleGenerate` обязательно:
  - `if (!template?.id) return`
  - не вызывать `generate(...)` без валидного `template_id`
5. DoD дополнить:
  - повторный клик по тому же шаблону после закрытия снова открывает wizard
  - клик по одному шаблону, закрытие, затем клик по другому шаблону открывает wizard уже с новым названием и чистым state шага
6. STOP GUARD:
  - не трогать `AI.tsx` tab-shell
  - не менять edge function и историю документов в этом патче, только открытие wizard и null-safety диалога
  - &nbsp;
  - PATCH 8.1 — Fix "Сформировать" button not opening wizard

## Root cause

Line 107 in `AiDocumentsGenerateView.tsx`:

```
{selectedTemplate && (
  <GenerateAiDocumentDialog ... />
)}
```

The conditional mount `selectedTemplate &&` causes a race condition — React batches `setSelectedTemplate` + `setWizardOpen(true)` but the Dialog component isn't mounted yet when `open` becomes `true`, so Radix Dialog never triggers its open animation.

## Fix

### 1. `AiDocumentsGenerateView.tsx` (lines 107-113)

Always render `GenerateAiDocumentDialog`, remove conditional:

```tsx
<GenerateAiDocumentDialog
  open={wizardOpen}
  onOpenChange={setWizardOpen}
  template={selectedTemplate}
/>
```

### 2. `GenerateAiDocumentDialog.tsx`

Change `template` prop from required to nullable:

- Props: `template: DocumentTemplate | null`
- Add early guard in body: if `!template` and `open`, render dialog with empty/placeholder content or just return closed dialog
- Guard all `template.xxx` accesses: `template?.name`, `template?.placeholders`, `template?.id`
- In `handleGenerate`: guard `if (!template) return`

## Files


| File                                                       | Change                                           |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `src/components/ai-documents/AiDocumentsGenerateView.tsx`  | Remove `selectedTemplate &&` conditional wrapper |
| `src/components/ai-documents/GenerateAiDocumentDialog.tsx` | Make `template` nullable, add null guards        |


## Not touched

- billing flow, `generated_documents`, `generate-from-template`
- `/settings/legal-details`
- PATCH 5/6/7 modules
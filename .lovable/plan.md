## да, согласен, с учетом правок:

1. **Зафиксировать как факт, а не гипотезу:**  
по текущим скринам `/settings/legal-details` уже работает мышью, а `/ai` — нет.  
Значит в плане нужно явно написать:
  - `StructuredAddressBlock` общий,
  - **shared address logic не тотально сломана**,
  - primary suspect now = **AI-shell / Sheet / Dialog / outside-interaction context**, а не весь address-flow целиком.
2. **Скорректировать диагностику по путям:**
  - `/settings` использовать как **control case**,
  - `/ai` использовать как **broken case**,
  - не писать больше, что “оба пути сломаны”, пока это не доказано.  
  Это важно, чтобы не чинить общий компонент вслепую и не ломать рабочий settings-flow.
3. **Вынести главный технический suspect в план явно:**  
проблема почти наверняка в связке:
  - `EntityRecordSheet` / `Sheet` / Radix Dialog,
  - portal dropdown из `StructuredAddressBlock`,
  - `DismissableLayer` / outside pointer handling,
  - scrollable body внутри sheet.  
  Это должно быть записано как **primary suspect #1**.
4. **Добавить отдельный локальный план фикса для AI-shell, не только для shared block:**
  - пометить dropdown container/data-attribute, например `data-address-dropdown`,
  - в sheet/dialog path добавить ignore-guard для pointer/interact outside по этому marker,
  - **не менять глобально весь** `sheet.tsx`, пока не будет доказано, что локального фикса в `EntityRecordSheet` недостаточно.
5. **Уточнить ветки исправления:**
  - **Branch A:** shared fix в `StructuredAddressBlock.tsx`, только если runtime trace покажет, что `handleSelect`/`onChange` ломаются там.
  - **Branch B:** local fix в `EntityRecordSheet`/sheet-context, если `/settings` работает, а `/ai` нет.  
  Сейчас по вашим данным именно **Branch B должна быть приоритетной**, а не наоборот.
6. **Диагностический этап сделать строже:**  
нужны логи не только из `StructuredAddressBlock`, но и факт outside-interaction в AI-shell:
  - `pointerdown` on suggestion,
  - `handleSelect START`,
  - `fetchPlaceDetails done`,
  - `onChange called`,
  - `document mousedown close`,
  - `scroll close`,
  - **sheet outside handler fired / not fired**.  
  Без этого нельзя утверждать, что виноват именно shared component.
7. **Инструментацию оформить как временную и локальную:**
  - DEV-only,
  - только на hotfix-ветке,
  - удалить после proof.  
  Прямо добавить это в план как обязательный cleanup-step.
8. **Не согласен с преждевременной глобальной правкой** `sheet.tsx` **без доказательства.**  
В плане нужно заменить:
  - “likely modify `src/components/ui/sheet.tsx`”  
  на
  - “сначала локальный guard в AI-shell; глобальный patch в `sheet.tsx` только если локальный proof покажет, что проблема системная для всех dialog/sheet consumers”.
9. **Подсветку строки (**`accent`**) оформить как отдельный независимый PATCH внутри hotfix-пакета, но без обязательного кода сразу.**  
Сейчас по плану нужно:
  - repo-wide audit,
  - proof на 3 shared компонентах,
  - менять токены только если после аудита реально остаются unreadable места.  
  То есть не писать, что это точно требует правки кода — сначала audit/proof.
10. **В proof-пакет добавить отдельный обязательный diff-proof “почему settings работает, а AI нет”:**
  - одинаковый адрес,
  - одинаковый consumer form,
  - одинаковый dropdown,
  - разный wrapper,
  - событие, на котором расходится цепочка.  
  Это должен быть один из главных deliverables патча.
11. **Repo-wide coverage упростить по приоритетам:**
  - `OrganizationDetailsForm` in `/settings` — control proof,
  - `OrganizationDetailsForm` in `/ai` — broken/fixed proof,
  - остальные consumers (`IndividualDetailsForm`, `AdminExecutors`, `LegalEntityDetailsForm`, `EntrepreneurDetailsForm`) — spot-check/regression only, а не полный разбор до закрытия текущего блокера.  
  Иначе патч снова расползётся.
12. **DoD уточнить:**
  - `/settings`: mouse select ✅ как контрольный эталон,
  - `/ai`: mouse select ✅ после фикса,
  - trace показывает, что selection в `/ai` доходит до `handleSelect` и `onChange`,
  - if local shell guard added — доказать, что именно он устранил расхождение,
  - instrumentation removed,
  - formatter/view/lookup не регресснули.
13. **Отдельно добавить жёсткий STOP-guard:**  
пока не закрыт mouse-path в `/ai`, **не трогать снова**
  - formatter,
  - Minsk rules,
  - GRP parser/enricher,
  - preview shell.  
  Эти зоны уже отвлекали и уводили патч в сторону.
14. **Итоговая формулировка причины для команды должна быть такой:**  
“Судя по текущему proof, в settings и AI используется один и тот же address block, но проблема воспроизводится только в AI, поэтому сначала расследуем и чиним различие shell/interaction context, а не переписываем весь shared address-flow.”
15. &nbsp;
16. PATCH 5R++ HOTFIX — diagnostic-first mouse-path fix + highlight readability

---

### FACT PROOF: same component, different wrapper

**Proved by imports:**


| Consumer path                          | File                                                   | Component                     | Import                                       |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------- | -------------------------------------------- |
| `/settings/legal-details`              | `OrganizationDetailsForm.tsx:37`                       | `StructuredAddressBlock`      | `@/components/shared/StructuredAddressBlock` |
| `/ai` (create/edit)                    | `EntityRecordSheet.tsx:51` → `OrganizationDetailsForm` | same `StructuredAddressBlock` | same import chain                            |
| `/settings/legal-details` (individual) | `IndividualDetailsForm.tsx:23`                         | same                          | same                                         |
| Admin executors                        | `AdminExecutors.tsx:20`                                | same                          | same                                         |
| Legacy legal entity                    | `LegalEntityDetailsForm.tsx:21`                        | same                          | same                                         |
| Entrepreneur                           | `EntrepreneurDetailsForm.tsx:21`                       | same                          | same                                         |


**Same component. Different shell:**


| Path                      | Shell                                                                                                 | Overlay                                    | Portal                          | Scroll container                                     | Focus trap                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------- | ---------------------------------------------------- | ------------------------------- |
| `/settings/legal-details` | Page `<div>`                                                                                          | None                                       | None                            | `window`                                             | None                            |
| `/ai`                     | `Sheet` (Radix Dialog) → `SheetPortal` → `SheetOverlay` (z-50, `bg-black/80`) → `SheetContent` (z-50) | `SheetOverlay` full-screen `fixed inset-0` | Radix portal to `document.body` | `div.overflow-y-auto` inside SheetContent (line 558) | Radix Dialog focus trap (modal) |
| Admin executors           | `AlertDialog`                                                                                         | AlertDialog overlay                        | Radix portal                    | Dialog body                                          | Radix focus trap                |


**Conclusion:** address logic is identical; the difference is the Radix overlay/portal/focus-trap shell in `/ai`.

---

### Primary suspect (hypothesis, NOT proven root cause)

Radix Dialog (Sheet) uses `DismissableLayer` which registers a **native** `pointerdown` listener on `document`. React's `e.stopPropagation()` in `onPointerDown` only stops React synthetic event propagation — it does NOT stop native DOM event propagation. Therefore:

1. User clicks `<li>` suggestion in dropdown (portaled to `document.body`)
2. React `onPointerDown` fires → `handleSelect(p)` starts (async)
3. Radix's **native** `pointerdown` listener fires on `document` → detects click outside `SheetContent` → triggers `onPointerDownOutside` → may call `preventDefault()` on the native event (modal mode default), steal focus back to dialog, or trigger dismiss behavior
4. This can cause: focus return to Sheet, scroll event on the `overflow-y-auto` container, or `mousedown` → `blur` chain that interferes with the async `handleSelect`

**This must be confirmed or refuted with runtime instrumentation before any fix is applied.**

---

### STOP GUARD

Do NOT touch in this hotfix:

- Formatter / `formatStructuredAddressForView`
- Preview / view shell
- GRP lookup / `grp-lookup` edge function
- Address parser / enricher (`GrpAddressParser`, `GrpAddressEnricher`)
- PATCH 6 scope

---

### Этап A — Runtime instrumentation (temporary, diagnostic only)

Add `console.log` trace points to 3 files. These are temporary and will be removed after diagnosis.

**File 1: `StructuredAddressBlock.tsx**`

- `onPointerDown` on `<li>`: log `"[ADDR] li pointerdown"`, prediction placeId
- `handleSelect` start: log `"[ADDR] handleSelect START"`
- `handleSelect` after fetchPlaceDetails: log `"[ADDR] fetchPlaceDetails done"`, details truthy
- `handleSelect` after onChange: log `"[ADDR] onChange called"`
- `handleSelect` finally: log `"[ADDR] handleSelect FINALLY"`
- Document mousedown handler: log `"[ADDR] doc mousedown"`, isSelectingRef value, isHoveringRef value, contains results
- Scroll close handler: log `"[ADDR] scroll close"`, isSelectingRef value

**File 2: `OrganizationDetailsForm.tsx**`

- `handleAddressChange`: log `"[ADDR] OrgForm.handleAddressChange"`, merged address summary

**File 3: `EntityRecordSheet.tsx**`

- No code changes — just note its shell structure for reference

Then run the same test case in both paths:

1. Type "пушкина 4" in street field
2. Wait for dropdown
3. Click suggestion with mouse
4. Log what fired and in what order

**Expected output:** exact trace of where the chain breaks in `/ai` vs `/settings`.

---

### Этап B — Fix (two branches depending on diagnosis)

#### Branch A: fix in shared `StructuredAddressBlock.tsx`

If diagnosis shows the problem is in the shared component (e.g., `handleSelect` never called, or `onChange` not reaching form):

- Fix the event handling chain in `StructuredAddressBlock`
- Ensure `onPointerDown` on `<li>` uses **native** `addEventListener` with `stopImmediatePropagation` to prevent Radix's document listener from firing

#### Branch B: fix in AI-shell / Sheet interaction

If diagnosis shows `handleSelect` fires correctly but Radix Sheet intercepts the native event:

- Add `onPointerDownOutside` handler to `SheetContent` in `sheet.tsx`:
  ```tsx
  onPointerDownOutside={(e) => {
    // Don't interfere with portal dropdowns (address autocomplete etc.)
    const target = e.target as HTMLElement;
    if (target.closest('[role="listbox"]')) {
      e.preventDefault();
    }
  }}
  ```
- This prevents Radix from stealing focus or dismissing when user clicks the address dropdown portal
- Also add `onInteractOutside` with same guard if needed

**Key principle:** React's `e.stopPropagation()` does NOT stop native event propagation. If Radix is the culprit, we must either:

- Use native `stopImmediatePropagation` on the dropdown elements, OR
- Tell Radix to ignore interactions with our dropdown via `onPointerDownOutside`

---

### Этап C — Remove instrumentation

After fix is confirmed working, remove all `console.log` trace points added in Этап A.

---

### Этап D — Highlight readability (independent task)

**Current state:** `--accent: 220 40% 94%` with `--accent-foreground: 222 47% 11%` — this is already a soft light-blue with dark text. This looks correct in `src/index.css`.

**Audit:** verify all components using `bg-accent text-accent-foreground`:

- `StructuredAddressBlock` dropdown (inline classes)
- `src/components/ui/command.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/context-menu.tsx`
- Any other `hover:bg-accent` usages

If the current accent values are already readable (they should be with `220 40% 94%`), confirm with screenshots. If any component uses hardcoded colors instead of the token, fix to use the shared token.

---

### Этап E — Proof package

#### Comparative proof: `/settings` vs `/ai`

Same address ("пушкина 4"), same mouse click sequence:


| Step                  | `/settings/legal-details` | `/ai`                  |
| --------------------- | ------------------------- | ---------------------- |
| Type address          | ✅ dropdown appears        | ✅ dropdown appears     |
| Hover suggestion      | highlight visible         | highlight visible      |
| Click suggestion      | fields populate           | fields populate        |
| Last handler called   | `handleSelect FINALLY`    | `handleSelect FINALLY` |
| Toast "ID скопирован" | does NOT appear           | does NOT appear        |


#### Fields populated after mouse select:

- street ✅
- house ✅
- building ✅ (if present)
- apartment ✅ (if present)
- city ✅
- region ✅
- postal_code ✅
- country ✅

#### Keyboard path:

- ArrowDown + Enter works in both paths

#### Data proof (one case):

- `address_structured` after save — show JSONB
- Legacy fields after save: street, house, building, apartment, city, region, postal_code, country
- Reopen record — data persists
- Preview shows correct formatted address

#### Regression:

- Manual address input without suggestion — not broken
- UNP lookup + GrpConfirmDialog apply — not broken
- Preview/view for Minsk and non-Minsk — not broken

#### Highlight proof:

- Address dropdown — text readable
- Select component — text readable
- One other shared list/menu — text readable

---

### Consumer coverage table (final)


| Consumer                           | File                          | `fieldIds` passed | Mouse path | Keyboard path | Hotfix status |
| ---------------------------------- | ----------------------------- | ----------------- | ---------- | ------------- | ------------- |
| OrganizationDetailsForm (settings) | `OrganizationDetailsForm.tsx` | Yes (deprecated)  | Verify     | ✅ works       | Fix applies   |
| OrganizationDetailsForm (AI sheet) | via `EntityRecordSheet.tsx`   | Yes (deprecated)  | **Verify** | ✅ works       | Fix applies   |
| IndividualDetailsForm              | `IndividualDetailsForm.tsx`   | Yes (deprecated)  | Verify     | Verify        | Fix applies   |
| EntrepreneurDetailsForm            | `EntrepreneurDetailsForm.tsx` | No                | Verify     | Verify        | Fix applies   |
| LegalEntityDetailsForm             | `LegalEntityDetailsForm.tsx`  | No                | Verify     | Verify        | Fix applies   |
| AdminExecutors                     | `AdminExecutors.tsx`          | No                | Verify     | Verify        | Fix applies   |


---

### Files that will be modified

**Certain:**

- `src/components/shared/StructuredAddressBlock.tsx` — instrumentation → fix → cleanup

**Likely (Branch B):**

- `src/components/ui/sheet.tsx` — add `onPointerDownOutside` guard

**Possible:**

- `src/index.css` — only if accent values need further tuning

---

### DoD (strict, no closing without all items)

1. `/settings/legal-details`: mouse select ✅, keyboard select ✅
2. `/ai`: mouse select ✅, keyboard select ✅
3. After mouse select, fields actually populated: street, house, building, apartment, city, region, postal_code, country
4. `address_structured` and legacy fields correct after save
5. Toast "ID скопирован" does NOT appear on suggestion selection
6. Root cause diff between `/settings` and `/ai` explained with runtime trace evidence
7. Highlight readable across: address dropdown, select, one other shared list
8. Manual input without suggestion not broken
9. UNP lookup + GrpConfirmDialog not broken
10. Preview for Minsk and non-Minsk not broken
11. All instrumentation removed after fix
12. PATCH 6 not started until all above confirmed

**Hard rule:** if fix is declared "done" without runtime proof specifically in `/ai` mouse path, the patch remains open.
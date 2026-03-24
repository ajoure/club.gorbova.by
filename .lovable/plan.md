# да, согласен, с учетом правок:

&nbsp;

1. **Защиту от закрытия сделать не только при sessionId, а при sessionId || dirty || pendingPatch.**
  Иначе пользователь может потерять только что введенные данные до создания/обновления session. Условие блокировки закрытия должно учитывать:
  &nbsp;
  - активную session,
  - несохраненные изменения,
  - отложенный debounce patch.
  &nbsp;
2. **Reopen flow не брать “первый попавшийся non-cancelled draft”.**
  Нужно выбирать:
  &nbsp;
  - последний updated_at desc,
  - только статусы из рабочего набора (draft, charter_pending, params_pending, preview, confirmed),
  - желательно по текущему корпоративному сценарию, если он будет расширяться дальше.
    Иначе можно открыть не тот черновик.
  &nbsp;
3. **metadata.current_step сохранять через merge, а не overwrite.**
  Сейчас в плане есть риск затереть другие metadata поля. Нужно явно писать add-only merge:
  &nbsp;
  - старый metadata
  - current_step
  - возможные будущие поля reopen context / original filename / UI flags.
  &nbsp;
4. **flushSave() должен быть обязательным не только на Next/Back/Close, но и перед Confirm на Step 5.**
  Иначе пользователь может подтвердить пакет, пока последний patch еще не ушел в БД.
5. **При “Сохранить и выйти” нужен await полного завершения save перед закрытием UI.**
  Не просто вызвать flushSave(), а дождаться результата.
  При ошибке сохранения:
  &nbsp;
  - не закрывать wizard,
  - показать ошибку,
  - оставить пользователя внутри формы.
  &nbsp;
6. **Нужен отдельный сценарий для “Выйти без сохранения”.**
  Сейчас это должно не просто закрывать Sheet, а явно:
  &nbsp;
  - либо помечать draft как cancelled,
  - либо, если session еще не создана, просто закрывать без записи.
    Это нужно прописать в плане, чтобы не зависли “мусорные” черновики.
  &nbsp;
7. **Сохранение шага должно происходить после успешного flush/save, а не до него.**
  Иначе можно получить ситуацию, когда UI уже перешел на новый step, а в БД остался старый. Нужен порядок:
  &nbsp;
  - flush текущих данных,
  - update current_step,
  - только потом переход UI.
  &nbsp;
8. **Save indicator должен показывать источник состояния, а не быть декоративным.**
  Минимальные состояния:
  &nbsp;
  - dirty
  - saving
  - saved
  - error
  - restored draft
    Последнее полезно при reopen, чтобы пользователь видел, что он работает с восстановленным черновиком.
  &nbsp;
9. **Step 2 и Step 3 все равно требуют явного proof по persist, даже если их “не трогаем”.**
  В DoD добавить отдельную проверку:
  &nbsp;
  - загруженный/вставленный устав восстанавливается после reopen;
  - участники, даты, адрес, повестка восстанавливаются после reopen.
    Иначе будет закрыт PATCH по оболочке, но не по сути.
  &nbsp;
10. **Wider layout делать через общий shell-стандарт, а не ad-hoc width only.**
  Поддерживаю max-w-[1200px], но нужно сохранить:

&nbsp;

&nbsp;

&nbsp;

- нормальный sticky header/footer,
- корректный scroll body,
- отсутствие клиппинга кнопок внизу,
- стабильную работу на меньших экранах.
  То есть не просто “шире”, а полноценный рабочий shell.

&nbsp;

&nbsp;

&nbsp;

11. **В DoD добавить proof reopen именно после hard reload страницы.**
  Не только закрыть/открыть внутри одной сессии, а:

&nbsp;

&nbsp;

&nbsp;

- заполнить,
- перезагрузить страницу,
- снова открыть модуль,
- выбрать “Продолжить черновик”,
- увидеть восстановленный step и данные.

&nbsp;

&nbsp;

&nbsp;

12. **Сразу зафиксировать, что после PATCH 1.2 следующий приоритет — не косметика, а Sprint 2 шаблонов.**
  Чтобы не застрять на endless UX-fixes. После стабилизации draft-flow следующий обязательный шаг:

&nbsp;

&nbsp;

&nbsp;

- пакет нормативных шаблонов,
- правила их применения,
- подключение к manifest.

&nbsp;

&nbsp;

PATCH 1.2 — Stability / Draft Persistence / Wider Wizard

## Проблемы

1. **Sheet закрывается** при клике вне wizard или Esc — `onOpenChange` передаётся напрямую без защиты
2. **Draft не персистится** на всех шагах — Step 1 создаёт session, но Steps 2-5 сохраняют данные только через `autoSave` (debounced 1.5s) без flush при переходах
3. **Reset при закрытии** — `useEffect` в строках 61-66 сбрасывает `step=0, sessionId=null` при каждом `!open`
4. **Нет reopen flow** — при повторном открытии всегда начинается с Step 0
5. **Нет индикатора сохранения** — пользователь не видит статус autosave
6. **Wizard узкий** — `sm:max-w-2xl` (~672px), не использует `SHEET_SHELL_CLASS`

## Изменения

### 1. `CorporateWizard.tsx` — основные доработки

**Защита от закрытия:**

- `Sheet onOpenChange` → обёртка: если `sessionId` существует, показать AlertDialog (Сохранить и выйти / Выйти без сохранения / Остаться) вместо прямого закрытия
- `SheetContent` добавить `onInteractOutside={(e) => e.preventDefault()}` и `onEscapeKeyDown={(e) => e.preventDefault()}` для блокировки случайного закрытия

**Wider layout:**

- Заменить `className="w-full sm:max-w-2xl overflow-y-auto flex flex-col"` на кастомный класс: `w-full sm:max-w-5xl lg:max-w-[1200px]` + элементы из `SHEET_SHELL_CLASS` (rounded corners, position overrides)

**Reopen flow:**

- При `open && !sessionId` → проверить `sessions` из hook (уже загружаются) на наличие non-cancelled draft
- Если есть — показать диалог «Продолжить черновик [company, date] / Создать новый»
- При продолжении: `setSessionId(existing.id)`, восстановить step из `metadata.current_step`

**Persist step:**

- При каждом `setStep` → вызывать `autoSave(sessionId, { metadata: { current_step: newStep } })`
- При reopen → читать `session.metadata.current_step` и устанавливать начальный step

**Flush on navigation:**

- `handleNext` / `handleBack` → перед сменой step вызывать `flushSave()` (новый метод из hook)
- При закрытии с «Сохранить и выйти» → `flushSave()` перед close

**Save status indicator:**

- В header рядом с badge шага показывать: «Сохранено» (зелёная точка) / «Сохраняется...» (spinner) / «Ошибка» (красная) / «Есть несохранённые» (amber)
- Состояние берётся из нового `saveStatus` из hook

### 2. `useCorporateDraftSession.ts` — расширения

**flushSave(sessionId):**

- Отменяет текущий debounce timer
- Выполняет немедленный `updateMutation.mutateAsync` с накопленным patch
- Нужен `pendingPatches` ref для накопления между debounce

**saveStatus state:**

- Новый `useState<'idle' | 'saving' | 'saved' | 'error' | 'dirty'>` 
- Обновляется в autoSave (→ dirty), при mutation start (→ saving), success (→ saved), error (→ error)
- Возвращается из hook

**autoSave расширить:**

- Накапливать patches в ref (shallow merge)
- При fire debounce → отправлять merged patch и очищать ref

### 3. `CharterIntakeStep.tsx` — минимальные фиксы

- Убедиться что `onUpdate` вызывается после upload и после confirm rules
- Статусы extraction pipeline уже реализованы в PATCH 1.1 — не трогаем

### 4. Остальные step-компоненты

- Не трогаем внутреннюю логику
- Автосохранение Step 3 уже работает через `onAutoSave`
- Step 2 сохраняет через `onUpdate` (immediate)
- Step 4/5 — read-only, не требуют autosave

---

## Файлы


| Файл                                           | Что                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/components/corporate/CorporateWizard.tsx` | Защита закрытия, reopen flow, wider layout, step persist, save indicator, flush on nav, confirm dialog |
| `src/hooks/useCorporateDraftSession.ts`        | `flushSave()`, `saveStatus`, accumulated patch ref                                                     |


## Что НЕ меняется

- Step компоненты (1-5) — внутренняя логика не трогается
- Edge functions, шаблоны, rule engine
- `sheet.tsx`, `sheetShell.ts`
- Существующие flows генерации

## DoD

- Outside click / Esc не закрывают wizard при активной session
- Confirm dialog при закрытии: Сохранить / Выйти / Остаться
- Draft session обновляется в БД при переходах Next/Back
- flushSave при закрытии
- Save status indicator в header
- Reopen: продолжить черновик / создать новый
- Step persist и восстановление при reopen
- Wizard шире: ~1200px на desktop
- Build clean
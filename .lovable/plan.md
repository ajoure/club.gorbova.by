План: убрать остаточные пустоты в карточке контакта (вкладка Telegram, мобайл/десктоп)

## Diagnose

На скрине обведены два пустых места — оба ещё присутствуют после прошлой итерации:

1. **Верхняя пустота** — полоса между строкой бейджей («редактировать / Активен») и табами («Профиль / Telegram / …»).
   - `SheetHeader` имеет дефолтный `space-y-2` (из `src/components/ui/sheet.tsx`).
   - Row 2 с бейджами обёрнут в `<div className="… px-1 py-1">` — лишний вертикальный padding.
   - Сам `SheetHeader` использует `pb-2 sm:pb-3`.
   - Контейнер табов добавляет `my-1 sm:my-1.5`.
   - В сумме это и даёт видимую пустую полосу.

2. **Нижняя пустота** — под композером сообщений.
   - `SHEET_SHELL_CLASS` уже добавляет на корень Sheet `pb-[env(safe-area-inset-bottom,0px)]`.
   - В композере `ContactTelegramChat.tsx` (строка 1857) на футере **ещё раз** задан `paddingBottom: 'env(safe-area-inset-bottom, 0px)'` → двойной safe-area inset на iOS PWA.
   - Дополнительно: подсказка «Enter для отправки…» (`<p className="… mt-0.5">`) и `pt-1.5` футера дают лишние ~16–20px.
   - У `TabsContent value="telegram"` стоит `pb-1` — суммируется с safe-area.

## План правок

### Файл `src/components/admin/ContactDetailSheet.tsx`

- **SheetHeader** (строка 1463):
  `p-4 sm:p-6 pb-2 sm:pb-3` → `px-4 sm:px-6 pt-4 sm:pt-6 pb-0 space-y-1.5` (схлопываем нижний padding и уменьшаем дефолтный `space-y-2` до `space-y-1.5`).
- **Row 2 (бейджи)** (строка 1485):
  `flex flex-wrap items-center gap-1.5 px-1 py-1` → `flex flex-wrap items-center gap-1.5` (убираем `py-1` и `px-1`, которые дают лишнюю высоту/смещение).
- **Контейнер TabsList** (строка 1561):
  `my-1 sm:my-1.5` → `mt-0 mb-0` (полностью прижимаем табы к шапке).
- **TabsContent value="telegram"** (строка 1613):
  `pb-1 pt-2` → `pb-0 pt-1` (убираем нижний отступ — низ уже даст safe-area inset на корне Sheet).

### Файл `src/components/admin/ContactTelegramChat.tsx`

- **Футер композера** (строка 1857):
  Убрать `style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}` — safe-area inset уже применён на корне Sheet через `SHEET_SHELL_CLASS`. Двойной inset = пустота снизу на PWA.
  Также `pt-1.5` → `pt-1`.
- **Подсказка «Enter для отправки…»** (строка 2052):
  Сделать её более компактной и скрыть на мобиле, где она и так обрезается:
  `text-[11px] leading-tight text-muted-foreground mt-0.5` → `hidden sm:block text-[11px] leading-none text-muted-foreground mt-0.5`.

## Технические заметки

- Все правки — чисто стилевые (Tailwind-классы / удаление inline-style). Логика, скролл, авто-pin к низу чата, hidePhotoButton остаются без изменений.
- safe-area inset на iOS PWA сохраняется (через `SHEET_SHELL_CLASS`), поэтому контент не уйдёт под home-indicator.
- Десктоп получит более плотную верстку без пустых полос; мобайл/PWA — то же плюс схлопывание дублирующего нижнего отступа.

## Definition of Done

- На скрине iOS PWA (518×940) между строкой «редактировать / Активен» и табами нет пустой полосы — табы сразу под бейджами.
- Под композером (поле «Введите сообщение…») нет пустой зоны выше home-indicator: видна только тонкая safe-area полоска самого устройства.
- На десктопе (sm+) подсказка «Enter для отправки, Shift+Enter для новой строки» отображается; на мобиле — скрыта (там она всё равно обрезалась).
- Авто-прокрутка к последнему сообщению при возврате на вкладку Telegram продолжает работать (логика `isActive` не трогается).
- Никаких изменений данных, RPC, edge functions.

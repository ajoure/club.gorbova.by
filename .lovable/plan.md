## да, согласен, с учетом правок:

1. **План корректный по сути**
  - В `/admin/documents` заменить крупные кнопки управления пакетом на компактное меню `⋯`.
  - В форме правила доступа заменить две кнопки **«База знаний / Генерация документов»** на один стандартный `Select`.
  - Backend/RPC/RLS/audit/safe-delete не трогать.
2. **Добавить** `aria-label` **и tooltip для иконки** `MoreHorizontal`
  - `aria-label="Действия с пакетом документов"`.
  - Tooltip: **«Действия с выбранным пакетом документов»**.
  - Это важно, потому что кнопка иконочная.
3. **Dropdown-меню не должно показываться, если пакет не выбран**
  - Если `selectedPackage` отсутствует — не рендерить `MoreHorizontal`.
  - Кнопка **«Новый пакет»** в шапке остается доступной admin/super_admin.
4. **Для destructive-действия добавить визуальное отделение**
  - `Удалить` оставить после separator.
  - Желательно с destructive style / красным текстом.
  - Удаление всё равно только через существующий `AlertDialog`.
5. **В** `Select` **домена не использовать emoji, если общий UI их не использует**
  - Лучше использовать те же lucide-иконки, что уже применяются в форме.
  - Если быстро — можно без иконок:
    - `База знаний`
    - `Генерация документов`

Копируемый блок:

```text
План согласован, с небольшими уточнениями.

1. В `/admin/documents` заменить нижнюю горизонтальную панель управления пакетом на одну иконочную кнопку `MoreHorizontal`, видимую только admin/super_admin в admin mode.

2. Для `MoreHorizontal` добавить:
- `aria-label="Действия с пакетом документов"`;
- tooltip: «Действия с выбранным пакетом документов».

Если `selectedPackage` отсутствует — иконку действий не рендерить.

3. В dropdown-меню:
- «Редактировать пакет»;
- «Активировать» / «Деактивировать»;
- separator;
- «Удалить» destructive.

Удаление по-прежнему открывает существующий `AlertDialog`.

4. В `ProductAccessRulesTab.tsx` заменить две кнопки-переключателя «База знаний / Генерация документов» на один стандартный `Select`.

Варианты Select:
- «База знаний»;
- «Генерация документов».

5. Не использовать emoji в Select, если общий UI их не использует. Лучше без иконок или с существующими lucide-иконками.

6. Логику save/edit/conditions не менять:
- `document_generation` сохраняется как `grant_target_type='document_generation'`;
- partial сохраняет только UUID пакетов в `conditions.allowed_package_ids`;
- лишние поля другого домена очищаются при переключении.

7. Backend, миграции, RPC, RLS, audit, safe-delete RPC, sessions, Gotenberg, edge-функции не трогать.

8. После выполнения: `npx tsc --noEmit` должен пройти без ошибок.

План: UI fix — компактный admin CRUD пакетов + домен «Генерация документов» через Select
```

Backend, RPC, RLS, audit, safe-delete, генерация, sessions и Gotenberg не трогаются.

### 1. `src/components/ai-documents/packages/PackagesWorkspace.tsx` — компактный admin-меню вместо трёх больших кнопок

Сейчас под селектором пакетов рендерятся три крупных контрола (`Редактировать`, Switch «Активен», `Удалить`) — забирают всю ширину строки.

Заменить на одну **иконочную кнопку** `MoreHorizontal` (lucide), которая открывает `DropdownMenu` справа от выбранного пакета. Видна только для `isAdminUI`.

Состав меню:

- `Редактировать пакет` — открывает существующий `Dialog` (`openEdit`).
- `Деактивировать` / `Активировать` — динамический label в зависимости от `selectedPackage.is_active`, вызывает существующий `handleToggleActive`.
- separator
- `Удалить` (destructive) — открывает существующий `AlertDialog`.

Описание пакета (`selectedPackage.description`) выводить отдельной строкой `text-[11px] text-muted-foreground` под селектором, без рамки. Кнопка `Новый пакет` в шапке остаётся как есть.

Удалить нижний `border-t` блок с тремя контролами целиком. Логика state (`dialogOpen`, `editing`, `form`, `deleteOpen`, `saving`, `deleting`) и обработчики (`handleSave`, `handleDelete`, `handleToggleActive`, RPC-вызовы) остаются без изменений.

### 2. `src/components/admin/product/ProductAccessRulesTab.tsx` — домен через один Select

Сейчас (строки ~1499–1545) внутри блока `training_content` для `tc_domain` стоят два больших `<button>`-toggle'а («База знаний» / «Генерация документов»). Заменить их на один компонент `<Select>`, который уже используется в форме:

```text
<Label>Куда выдаём</Label>
<Select value={form.tc_domain} onValueChange={...}>
  <SelectItem value="knowledge_base">  📖  База знаний          </SelectItem>
  <SelectItem value="document_generation">  📚  Генерация документов  </SelectItem>
</Select>
```

В `onValueChange` сохранить уже существующую очистку полей:

- `knowledge_base` → сброс `dg_allowed_package_ids=[]`, `dg_access_mode='full'`;
- `document_generation` → сброс `target_ref=''`, `target_label=''`, `tc_access_mode='full'`, `tc_allowed_module_ids=[]`, `tc_allowed_lesson_ids=[]`, `tc_auto_include_new_modules=false`, `match_purchase_month=false`.

Никаких других изменений в файле:

- условные блоки `form.tc_domain === 'knowledge_base'` (тренинг + режим + дерево модулей/уроков) — без правок;
- условный блок `form.tc_domain === 'document_generation'` (Полный / Частичный + список пакетов с чекбоксами по UUID) — без правок;
- сохранение в `handleSave` (coercion в `grant_target_type='document_generation'` + `conditions.allowed_package_ids`) — без правок;
- `openEditDialog` coercion legacy `document_generation` → `training_content` + `tc_domain='document_generation'` — без правок;
- «Что выдаём» уже не содержит `document_generation` (фильтр в строке 1356) — оставить.

### 3. Проверка

`npx tsc --noEmit` — ноль ошибок.

### DoD

- В `/admin/documents` рядом с выбранным пакетом — одна иконка `⋯`, открывающая компактное dropdown-меню для admin/super_admin. Большая горизонтальная панель из трёх кнопок убрана.
- В форме правил доступа нет двух button-toggle «База знаний / Генерация документов»; выбор домена выполняется одним стандартным `Select`.
- «Генерация документов» — пункт этого `Select`; при его выборе тренинг скрыт, доступны Полный/Частичный и список пакетов.
- Partial по-прежнему сохраняет только UUID в `conditions.allowed_package_ids`.
- В `/document-generation` (mode="user") admin-меню не показывается.
- Backend, миграции, RPC, RLS, audit, safe-delete RPC, sessions, Gotenberg, edge-функции — не тронуты.
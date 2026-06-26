# План: исправить /admin/forms?tab=site (Анкеты сайта)

## Проблемы (со скриншота и из БД)

1. **Колонки «Клиент», «Email», «Телефон», «Продукт» пустые (`—`)** — анкеты с сайта хранят значения в `form_data` под русскими ключами (`"Имя и Фамилия"`, `"Email"`, `"Телефон"`, …), а текущий маппинг в `useFormsHubData.fetchSiteForms` ищет только `formData.name / email / phone`.
2. **Колонка «Аккаунт» названа некорректно** — на деле это «есть ли связанный контакт/профиль в CRM», поэтому правильное название — «Контакт».
3. **«Сделка» и «Аккаунт» открывают одно и то же окно** — оба клика всплывают в `onRowClick → onOpenDetail`, т.е. иконки никак не различают переход. Нужно сделать иконки кликабельными:
   - «Сделка» → переход на карточку сделки `/admin/deals?order=<order_id>`.
   - «Контакт» → переход на карточку контакта `/admin/contacts?contact=<user_id|profile_id>`.
4. **Продукт не подтягивается** — `site_pages` имеет `product_id` (например, страница `predzapiscb20` → продукт «Тайное свидание»), но fetcher не подтягивает его и не резолвит имя продукта.

## Файлы и правки

### `src/hooks/useFormsColumns.ts`
- Переименовать default-колонку `has_account.label` → **«Контакт»**, ширина 80.
- В `loadColumns()` всегда брать `label` из дефолтов (`{ ...dc, ...savedCol, label: dc.label }`), чтобы переименование колонок применялось мгновенно даже у пользователей с сохранённым layout в localStorage.

### `src/hooks/useFormsHubData.ts` (`fetchSiteForms`)
- Добавить helper `pickField(obj, keys[])` (case-insensitive поиск + trim) и константы:
  - `NAME_KEYS = ["Имя и Фамилия","Имя","ФИО","name","full_name","fullName","client_name"]`
  - `EMAIL_KEYS = ["Email","email","e-mail","mail"]`
  - `PHONE_KEYS = ["Телефон","phone","tel","Tel","Phone"]`
- Расширить `select` запроса site_form_submissions: подтянуть `site_pages(title, product_id)`.
- Собрать `productIdsToResolve` из `page.product_id` и `meta.product_id`, одним запросом в `products_v2` получить `{id, name}` и заполнить `product_id` + `product_title` для каждой строки.
- Маппинг строки:
  ```ts
  client_name: pickField(formData, NAME_KEYS) || meta.full_name || "—",
  client_email: pickField(formData, EMAIL_KEYS) || meta.email || null,
  client_phone: pickField(formData, PHONE_KEYS) || meta.phone || null,
  product_id: resolvedProductId,           // page.product_id ?? meta.product_id
  product_title: productMap[resolvedProductId]?.name || meta.product_title || "",
  ```
- Серверный фильтр по `product_id` теперь возможен через `eq("page_id", …)` нельзя напрямую — оставить client-side фильтр как сейчас (по `r.product_id`), он будет работать благодаря резолву из `site_pages.product_id`.

### `src/components/admin/forms/FormsHubTable.tsx`
- В `renderCell` для кейсов `has_deal` и `has_account` — обернуть иконку в `<button onClick={e => { e.stopPropagation(); … }}>`:
  - `has_deal` + `row.has_deal && row.raw?.order_id` → `navigate(\`/admin/deals?order=${row.raw.order_id}&from=forms\`)`.
  - `has_account` → `navigate(\`/admin/contacts?contact=${row.user_id ?? row.profile_id}&from=forms\`)`.
- Если ссылки нет — рендерить «—» как сейчас (некликабельно).
- Добавить `title`-тултипы: «Открыть сделку» / «Открыть контакт».
- Использовать `useNavigate` из `react-router-dom`.

## Не трогаем
- `SiteFormDetailDialog` — уже корректно отображает все поля анкеты при клике по строке.
- Логику preorder / training — претензия только про вкладку «Анкеты сайта».
- Прав/RLS — read-only исправление UI/маппинга.

## Acceptance
- В `/admin/forms?tab=site` строки «Тайное свидание анкета» показывают имя, email, телефон, продукт «Тайное свидание».
- Заголовок колонки — «Контакт» (не «Аккаунт»), даже у пользователей с сохранённым layout.
- Клик по иконке «Сделка» открывает карточку сделки; клик по иконке «Контакт» — карточку контакта; клик по остальной строке — окно с данными анкеты (как сейчас).



## PATCH: BePaid-подписки — чтение `?search=` из URL

### Проблема
Страница `/admin/payments/bepaid-subscriptions?search=sbs_xxx` открывается, но поле поиска не подхватывает параметр `?search=` из URL — `searchQuery` инициализируется пустой строкой.

### Файл
`src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

### Изменения

1. Добавить `useLocation` из `react-router-dom` в импорты (строка 1).
2. В начале компонента `BepaidSubscriptionsTabContent` (строка 307-312):
   - Прочитать `location.search` через `useLocation()`.
   - Извлечь `new URLSearchParams(location.search).get("search")`.
   - Инициализировать `searchQuery` этим значением (или пустой строкой).
   - При наличии `?search=` — сбросить `statusFilter` на `"all"`, чтобы подписка не была скрыта фильтром статуса (по умолчанию стоит `"active"`).

Код:
```tsx
const location = useLocation();
const urlSearch = new URLSearchParams(location.search).get("search") || "";
const [searchQuery, setSearchQuery] = useState(urlSearch);
const [statusFilter, setStatusFilter] = useState<StatusFilter>(urlSearch ? "all" : "active");
```

### Итого
- При переходе по ссылке `/admin/payments/bepaid-subscriptions?search=sbs_xxx` поле поиска заполняется ID, фильтр статуса сбрасывается на «все», и на странице отображается ровно одна подписка.


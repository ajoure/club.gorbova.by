
# План: Усовершенствование фильтров контактов и сделок с Glassmorphism дизайном

## Обзор

Добавляем фильтрацию по купленным продуктам и тарифам в Контактах и Сделках, обновляем дизайн фильтров с glassmorphism стилем для максимальной прозрачности и лёгкости.

---

## Текущая архитектура

### Контакты (`AdminContacts.tsx`)
- **Фильтры:** status_account, has_deals, has_telegram, is_duplicate
- **Пресеты:** Все, Без аккаунта, С покупками, Дубли, Архив
- **Компонент:** `QuickFilters` + `CONTACT_FILTER_FIELDS`

### Сделки (`AdminDeals.tsx`)
- **Фильтры:** order_number, email, phone, status, product_id, reconcile_source, final_price, is_trial
- **Уже есть:** product_id filter с динамическими опциями из БД
- **Компонент:** `QuickFilters` + `DEAL_FILTER_FIELDS`

### Данные для фильтрации
```text
subscriptions_v2 → tariff_id → tariffs → product_id → products_v2
orders_v2 → product_id / tariff_id
```

---

## План изменений

### 1. Добавить фильтр по продуктам/тарифам в Контакты

**Файл:** `src/pages/admin/AdminContacts.tsx`

Добавляем новые поля фильтрации:

```tsx
// Новые поля для CONTACT_FILTER_FIELDS
{ 
  key: "purchased_product", 
  label: "Купленный продукт", 
  type: "select",
  options: products?.map(p => ({ value: p.id, label: p.name })) || []
},
{ 
  key: "purchased_tariff", 
  label: "Тариф покупки", 
  type: "select",
  options: tariffs?.map(t => ({ value: t.id, label: `${t.product_name}: ${t.name}` })) || []
},
{ 
  key: "active_subscription", 
  label: "Активная подписка", 
  type: "select",
  options: products?.map(p => ({ value: p.id, label: p.name })) || []
}
```

**Необходимые данные:**
- Fetch products и tariffs (уже есть в `AdminDeals`, переиспользуем)
- Fetch user purchase history (orders_v2 по user_id)
- Fetch active subscriptions (subscriptions_v2 по user_id)

**Логика фильтрации в `getContactFieldValue`:**
```tsx
case "purchased_product":
  return contactPurchases.get(contact.user_id)?.productIds || [];
case "purchased_tariff":
  return contactPurchases.get(contact.user_id)?.tariffIds || [];
case "active_subscription":
  return contactSubscriptions.get(contact.user_id)?.productIds || [];
```

### 2. Добавить фильтр по тарифам в Сделки

**Файл:** `src/pages/admin/AdminDeals.tsx`

```tsx
// Добавить в DEAL_FILTER_FIELDS
{ 
  key: "tariff_id", 
  label: "Тариф", 
  type: "select",
  options: tariffs?.map(t => ({ value: t.id, label: t.name })) || []
}
```

Fetch tariffs по аналогии с products:
```tsx
const { data: tariffs } = useQuery({
  queryKey: ["tariffs-filter"],
  queryFn: async () => {
    const { data } = await supabase
      .from("tariffs")
      .select("id, name, product_id, products_v2(name)")
      .order("name");
    return data || [];
  },
});
```

### 3. Glassmorphism дизайн для QuickFilters

**Файл:** `src/components/admin/QuickFilters.tsx`

Обновляем UI с glassmorphism стилем:

```tsx
// Новый контейнер с glass-эффектом
<div className="flex items-center gap-3 flex-wrap p-3 rounded-2xl 
  bg-background/40 backdrop-blur-xl border border-white/20 
  shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
  
  {/* Preset tabs с прозрачностью */}
  <div className="flex items-center gap-1 p-1 rounded-xl 
    bg-white/30 backdrop-blur-sm border border-white/20">
    {presets.map(preset => (
      <button
        className={cn(
          "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
          isActive 
            ? "bg-white/60 shadow-sm text-foreground" 
            : "text-muted-foreground hover:text-foreground hover:bg-white/20"
        )}
      >
        {preset.label}
        {preset.count > 0 && (
          <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full 
            bg-primary/20 text-primary backdrop-blur-sm">
            {preset.count}
          </span>
        )}
      </button>
    ))}
  </div>
  
  {/* Filter dropdown с glass-стилем */}
  <DropdownMenuContent className="w-64 p-2 
    bg-white/80 backdrop-blur-xl border border-white/30 
    shadow-[0_8px_32px_rgba(0,0,0,0.12)] rounded-xl">
    ...
  </DropdownMenuContent>
  
  {/* Active filter badges с glass */}
  <Badge className="gap-1 px-3 py-1 rounded-full 
    bg-white/40 backdrop-blur-sm border border-white/30 
    text-foreground hover:bg-destructive/10 hover:border-destructive/30">
    {getFilterLabel(filter)}
    <X className="h-3 w-3 opacity-60" />
  </Badge>
</div>
```

### 4. Обновить GlassCard для большей прозрачности

**Файл:** `src/components/ui/GlassCard.tsx`

```tsx
style={{
  background: "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.3))",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)", // Safari support
  ...style,
}}
```

### 5. Создать GlassFilterPanel компонент

**Новый файл:** `src/components/admin/GlassFilterPanel.tsx`

Переиспользуемый компонент для фильтров в glassmorphism стиле:

```tsx
interface GlassFilterPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassFilterPanel({ children, className }: GlassFilterPanelProps) {
  return (
    <div className={cn(
      "p-3 rounded-2xl",
      "bg-white/30 dark:bg-slate-900/30",
      "backdrop-blur-xl",
      "border border-white/20 dark:border-white/10",
      "shadow-[0_4px_24px_rgba(0,0,0,0.06)]",
      className
    )}>
      {children}
    </div>
  );
}
```

---

## Структура запросов данных

### Для контактов (новые запросы)
```tsx
// 1. Все оплаченные заказы с product/tariff
const { data: purchaseData } = useQuery({
  queryKey: ["contact-purchases"],
  queryFn: async () => {
    const { data } = await supabase
      .from("orders_v2")
      .select("user_id, product_id, tariff_id")
      .eq("status", "paid");
    
    // Group by user_id
    const map = new Map();
    data?.forEach(o => {
      if (!o.user_id) return;
      const existing = map.get(o.user_id) || { productIds: new Set(), tariffIds: new Set() };
      if (o.product_id) existing.productIds.add(o.product_id);
      if (o.tariff_id) existing.tariffIds.add(o.tariff_id);
      map.set(o.user_id, existing);
    });
    return map;
  }
});

// 2. Активные подписки
const { data: subscriptionData } = useQuery({
  queryKey: ["contact-subscriptions"],
  queryFn: async () => {
    const { data } = await supabase
      .from("subscriptions_v2")
      .select("user_id, tariff_id, tariffs(product_id)")
      .in("status", ["active", "trial"]);
    
    // Group by user_id
    const map = new Map();
    data?.forEach(s => {
      if (!s.user_id) return;
      const existing = map.get(s.user_id) || { tariffIds: new Set(), productIds: new Set() };
      if (s.tariff_id) existing.tariffIds.add(s.tariff_id);
      if (s.tariffs?.product_id) existing.productIds.add(s.tariffs.product_id);
      map.set(s.user_id, existing);
    });
    return map;
  }
});
```

---

## Визуальный дизайн

```text
┌─────────────────────────────────────────────────────────────────┐
│  ╭──────────────────────────────────────────────────────────╮  │
│  │ 🔘 Все  │ Без аккаунта 6 │ С покупками 197 │ + Фильтр  │ ←─ Glass tabs
│  ╰──────────────────────────────────────────────────────────╯  │
│                                                                 │
│  ╭─────────────╮  ╭─────────────╮  ╭─────────────╮             │
│  │ Продукт: 🏷 │  │ Тариф: ⨉   │  │ Подписка: ⨉│             │ ←─ Active badges
│  ╰─────────────╯  ╰─────────────╯  ╰─────────────╯             │
└─────────────────────────────────────────────────────────────────┘
         ↑ frosted glass background, subtle shadow
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/pages/admin/AdminContacts.tsx` | + фильтры по продуктам/тарифам, queries |
| `src/pages/admin/AdminDeals.tsx` | + фильтр по тарифам |
| `src/components/admin/QuickFilters.tsx` | Glassmorphism дизайн |
| `src/components/ui/GlassCard.tsx` | Увеличить прозрачность |
| `src/components/admin/GlassFilterPanel.tsx` | Новый компонент (опционально) |

---

## Ожидаемый результат

- ✅ Контакты можно фильтровать по купленным продуктам и тарифам
- ✅ Контакты можно фильтровать по активным подпискам
- ✅ Сделки можно фильтровать по тарифам (в дополнение к продуктам)
- ✅ Фильтры выглядят легко и прозрачно (glassmorphism)
- ✅ UI соответствует iOS-like дизайн-системе проекта

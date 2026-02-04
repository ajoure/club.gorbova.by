
# План редизайна страницы «Подписки bePaid»

## Цель

Привести страницу `/admin/payments/bepaid-subscriptions` к единому стилю с вкладкой «Платежи»:
- Карточка контакта открывается в боковой панели (Sheet) без навигации
- Таблица компактная, с возможностью скрытия/перетаскивания/изменения ширины колонок
- Статистика компактная и кликабельная для фильтрации
- Дизайн glassmorphism (iOS/macOS стиль)
- Горизонтальный скролл таблицы

---

## Выявленные проблемы

| # | Проблема | Как в «Платежах» |
|---|----------|------------------|
| 1 | Клик на ФИО → переход на `/admin/contacts` | Sheet открывается справа без навигации |
| 2 | Таблица громоздкая, строки занимают много места | Компактные строки, однострочные ячейки |
| 3 | Колонка «План / Сумма» объединяет данные | Отдельные колонки: План, Сумма |
| 4 | Нет возможности скрыть/сортировать колонки | Dropdown с чекбоксами + DnD |
| 5 | Нет горизонтального скролла | `overflow-x-auto` + фиксированная ширина |
| 6 | Статистика не кликабельная | Клик → фильтрация по статусу |
| 7 | По умолчанию показывает все | По умолчанию «Активные» |

---

## Технический план

### PATCH-S1: ContactDetailSheet без навигации

**Файл:** `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

**Изменения:**
1. Добавить state для Sheet:
```typescript
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";

const [contactSheetOpen, setContactSheetOpen] = useState(false);
const [selectedContact, setSelectedContact] = useState<any>(null);
```

2. Функция открытия карточки:
```typescript
const openContactSheet = async (profileId: string) => {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", profileId)
    .single();
  setSelectedContact(data);
  setContactSheetOpen(true);
};
```

3. Заменить `ClickableContactName` на кнопку с onClick:
```typescript
<button
  onClick={() => openContactSheet(sub.linked_user_id)}
  className="text-sm font-medium hover:underline hover:text-primary"
>
  {sub.linked_profile_name}
</button>
```

4. Добавить Sheet в конец компонента:
```typescript
<ContactDetailSheet
  contact={selectedContact}
  open={contactSheetOpen}
  onOpenChange={setContactSheetOpen}
/>
```

---

### PATCH-S2: Система колонок с DnD + visibility

**Файл:** `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx`

**Добавить:**
1. ColumnConfig и DEFAULT_COLUMNS:
```typescript
interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  width: number;
  order: number;
}

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { key: "checkbox", label: "", visible: true, width: 40, order: 0 },
  { key: "id", label: "ID", visible: true, width: 120, order: 1 },
  { key: "status", label: "Статус", visible: true, width: 90, order: 2 },
  { key: "customer", label: "Клиент", visible: true, width: 150, order: 3 },
  { key: "plan", label: "План", visible: true, width: 140, order: 4 },
  { key: "amount", label: "Сумма", visible: true, width: 90, order: 5 },
  { key: "next_billing", label: "Списание", visible: true, width: 100, order: 6 },
  { key: "card", label: "Карта", visible: false, width: 100, order: 7 },
  { key: "created", label: "Создано", visible: false, width: 100, order: 8 },
  { key: "connection", label: "Связь", visible: true, width: 120, order: 9 },
  { key: "actions", label: "", visible: true, width: 80, order: 10 },
];

const COLUMNS_STORAGE_KEY = 'admin_bepaid_subscriptions_columns_v1';
```

2. Импорты для DnD:
```typescript
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Settings } from "lucide-react";
```

3. State для колонок с localStorage:
```typescript
const [columns, setColumns] = useState<ColumnConfig[]>(() => {
  const saved = localStorage.getItem(COLUMNS_STORAGE_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { return DEFAULT_COLUMNS; }
  }
  return DEFAULT_COLUMNS;
});

useEffect(() => {
  localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns));
}, [columns]);
```

4. Dropdown для управления видимостью:
```typescript
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" className="h-8">
      <Settings className="h-3.5 w-3.5 mr-1" />
      Колонки
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    {columns.filter(c => c.key !== 'checkbox' && c.key !== 'actions').map(col => (
      <DropdownMenuCheckboxItem
        key={col.key}
        checked={col.visible}
        onCheckedChange={(checked) => setColumns(
          columns.map(c => c.key === col.key ? {...c, visible: checked} : c)
        )}
      >
        {col.label}
      </DropdownMenuCheckboxItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

---

### PATCH-S3: Компактная таблица + горизонтальный скролл

**Стили:**
1. Обёртка таблицы:
```typescript
<div className="overflow-x-auto rounded-xl border border-border/30 bg-card/30 backdrop-blur-xl">
  <Table className="min-w-[1000px]">
```

2. Строки таблицы компактные:
```typescript
<TableRow className="hover:bg-muted/30 transition-colors h-12">
```

3. Ячейки однострочные с truncate:
```typescript
<TableCell className="py-2 px-3">
  <span className="truncate block max-w-[140px]">{value}</span>
</TableCell>
```

---

### PATCH-S4: Кликабельная статистика с фильтрацией

**Изменить статус-бейджи на кнопки:**
```typescript
<button
  onClick={() => setStatusFilter("active")}
  className={cn(
    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-all cursor-pointer",
    statusFilter === "active" 
      ? "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500/30" 
      : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
  )}
>
  <span className="font-semibold">{rawStats.active}</span>
  <span className="text-xs">активных</span>
</button>
```

**По умолчанию фильтр «active»:**
```typescript
const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
```

---

### PATCH-S5: Glassmorphism дизайн

**Убрать Card wrapper, использовать прозрачные контейнеры:**

```typescript
// Вместо <Card><CardContent>
<div className="space-y-4">
  {/* Stats row */}
  <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-card/20 backdrop-blur-md border border-white/10">
    ...
  </div>
  
  {/* Filters */}
  <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-card/20 backdrop-blur-md border border-white/10">
    ...
  </div>
  
  {/* Table */}
  <div className="rounded-xl border border-border/30 bg-card/30 backdrop-blur-xl overflow-hidden">
    <div className="overflow-x-auto">
      <Table>...</Table>
    </div>
  </div>
</div>
```

---

### PATCH-S6: Разбиение колонки «План / Сумма»

**Было:**
```typescript
<TableHead>План / Сумма</TableHead>
<TableCell>
  <div>{sub.plan_title}</div>
  <div>{sub.plan_amount} {sub.plan_currency}</div>
</TableCell>
```

**Станет:**
```typescript
// Колонка "План"
<TableCell className="truncate max-w-[140px]">
  {sub.plan_title || '—'}
</TableCell>

// Колонка "Сумма"
<TableCell className="tabular-nums text-right font-medium">
  {sub.plan_amount.toFixed(2)} {sub.plan_currency}
</TableCell>
```

---

## Файлы к изменению

| Файл | Изменения |
|------|-----------|
| `src/components/admin/payments/BepaidSubscriptionsTabContent.tsx` | Все PATCH-S1–S6 |

---

## Визуальная схема

```text
┌──────────────────────────────────────────────────────────────────┐
│ Stats:  [64 всего] [16 активных•] [0 пробных] [29 отменённых]    │
│         Кликабельные для фильтрации, выделенный = активный       │
├──────────────────────────────────────────────────────────────────┤
│ Toolbar: [Поиск...] [Статус ▼] [Связь ▼] [Сорт. ▼] [⚙ Колонки]  │
├──────────────────────────────────────────────────────────────────┤
│ ☐ │ ID              │ Статус  │ Клиент    │ План     │ Сумма    │
│───┼─────────────────┼─────────┼───────────┼──────────┼──────────│
│ ☐ │ sbs_5b9ff021... │ Активна │ Иван →    │ BUSINESS │ 250 BYN  │
│ ☐ │ sbs_67b05be8... │ Активна │ Мария →   │ CHAT     │ 100 BYN  │
└──────────────────────────────────────────────────────────────────┘
              ← горизонтальный скролл →
                                            ┌─────────────────────┐
                                            │ ContactDetailSheet  │
                                            │ Иван Иванов         │
                                            │ email, phone...     │
                                            │ [Закрыть]           │
                                            └─────────────────────┘
```

---

## DoD (Definition of Done)

| # | Проверка | Ожидание |
|---|----------|----------|
| 1 | Клик на имя клиента | Открывается Sheet справа, страница не меняется |
| 2 | Горизонтальный скролл | Работает влево-вправо на узких экранах |
| 3 | Кнопка «⚙ Колонки» | Показывает чекбоксы для скрытия колонок |
| 4 | Перетаскивание колонок | Работает drag-and-drop заголовков |
| 5 | Клик на «16 активных» | Фильтрует таблицу по статусу active |
| 6 | По умолчанию | Показывает только активные подписки |
| 7 | Колонки План и Сумма | Разделены на две отдельные колонки |
| 8 | Дизайн | Стеклянный, прозрачный, воздушный (glassmorphism) |

---

## Приоритеты

1. **CRITICAL**: PATCH-S1 (ContactDetailSheet без навигации)
2. **HIGH**: PATCH-S3 (горизонтальный скролл + компактность)
3. **HIGH**: PATCH-S4 (кликабельная статистика + фильтр по умолчанию)
4. **HIGH**: PATCH-S5 (glassmorphism)
5. **MEDIUM**: PATCH-S2 (DnD + visibility колонок)
6. **LOW**: PATCH-S6 (разбиение План/Сумма)

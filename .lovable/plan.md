
---

## PATCH: expiredReason + audit_logs actor_type fix — DoD-статус

### Потребители `_shared/create-payment-checkout.ts` (полный список по grep)
- `admin-create-payment-link/index.ts` — прямой import
- `subscription-renewal-reminders/index.ts` — прямой import
- `_shared/generate-renewal-ctas.ts` — _shared, подтягивается через subscription-renewal-reminders

Других потребителей НЕТ.

### Деплой

| Деплой | UTC | Функции |
|--------|-----|---------|
| #1 | 2026-03-04 21:04:58 | admin-create-payment-link, subscription-renewal-reminders |
| #2 (fix actor_type) | 2026-03-04 21:07:42 | admin-create-payment-link, subscription-renewal-reminders |

### Найденный баг: audit_logs CHECK constraint
`audit_logs_actor_type_check` допускает только `'user'` | `'system'`.
Код передавал `effectiveActorType = 'admin'` → INSERT молча падал.
**Фикс**: маппинг `'admin' → 'user'` через `auditActorType`.

### DoD-факты (SQL-пруфы)

| Критерий | Статус | Доказательство |
|----------|--------|----------------|
| `actor_label` на свежих записях | ✅ | `payment_checkout.token_expired` at 21:08:00 — `actor_label='payment_checkout'` |
| `actor_type` корректен | ✅ | `actor_type='user'` (маппинг 'admin'→'user') |
| `meta.reason` = checkout_status_expired | ✅ | `meta.reason='checkout_status_expired'` |
| `orders_v2.meta.checkout_expired` | ✅ | order 20baa099: `checkout_expired=true`, `reason=checkout_status_expired` |
| `orders_v2.meta.checkout_expired_at` | ✅ | `2026-03-04T21:05:19.306Z` |
| token_expired → regen (reuse не произошёл) | ✅ | Токен bePaid протух за 6 сек → новый order создан |
| Reuse (живой токен) | ⏳ | bePaid токены протухают быстро, reuse не удалось поймать |
| Telegram 1-сек bucket | ⏳ | Отдельный тест, не смешивается с PAYLINK |

### Статус
- **Код + деплой**: ✅ ЗАКРЫТ
- **DoD token_expired**: ✅ ЗАКРЫТ (факт в audit_logs + orders_v2)
- **DoD reuse**: ⏳ ожидает кейса с живым токеном (bePaid expiry <30 сек в тестовых условиях)
- **Telegram**: ⏳ отдельный smoke-test

---

## План: Редизайн раздела «Продукты» — список + детальная страница

### Суть

1. **Список продуктов**: убрать группировку по категориям (Collapsible), сделать плоский список-таблицу в стиле Контактов. Категории — pill-фильтры. Убрать показ slug/code из строк. Убрать секцию «Справка».
2. **Детальная страница продукта**: привести к единому стилю с основной страницей (pill-табы, GlassCard, те же шрифты и отступы).

---

### Что будет сделано

**1. AdminProductsV2.tsx — плоский список без группировки**

- Убрать `Collapsible`-группы по категориям целиком
- Убрать `CATEGORY_ORDER`, `groupedProducts`, `collapsedGroups`, `toggleGroup`, `docsOpen` и всю секцию «Справка: Продукты и связи» (строки 428-563)
- Продукты — единая плоская таблица с сортировкой по колонкам (уже есть `useTableSort`)
- **Pill-фильтры по категориям**: заменить текущие табы (Все/Активные/С клубом/С доменом) на: `Все`, `Курс`, `Модуль`, `Подписка`, `Услуга`, `Цифровой продукт`, `Активные`, `С клубом`. Фильтр по категории — просто `category === selectedTab`
- **Строки продуктов**: убрать `<code>` (slug) из ячейки — оставить только название. Сделать строку чище: название + badge категории + badge статуса + действия
- Сортировка по колонкам остаётся (Продукт, Категория, Домен, Статус)

**2. AdminProductDetailV2.tsx — единый стиль**

- **Хедер**: заменить текущий `<h1>` + `<Badge>` + домен-кнопку на компактный хедер в стиле контактов (GlassCard шапка, pill-бейджи)
- **Табы**: заменить `<TabsList className="bg-muted/50">` на pill-стиль (inline-flex p-0.5 rounded-full bg-muted/40) — точно как на странице списка и в контактах
- **Карточки тарифов/офферов/потоков**: уже используют GlassCard — оставить, унифицировать отступы
- **Диалоги**: не менять (они модальные, стиль не критичен)

**3. Визуальные улучшения строк продуктов**

```text
┌──────────────────────────────────────────────────────────────────┐
│  Бухгалтерия как бизнес    [Подписка]  business-training.gorbova.by  [Активен]  ✎ 🗑 → │
│  Gorbova Club              [Подписка]  club.gorbova.by               [Активен]  ✎ 🗑 → │
│  Ценный бухгалтер 2.0      [Курс]     —                             [Активен]  ✎ 🗑 → │
└──────────────────────────────────────────────────────────────────┘
```

Без code/slug в строке. Чистые строки как в контактах.

---

### Файлы, которые будут изменены

| Файл | Изменение |
|------|-----------|
| `src/pages/admin/AdminProductsV2.tsx` | Убрать группировку, убрать справку, pill-фильтры по категориям, чистые строки |
| `src/pages/admin/AdminProductDetailV2.tsx` | Pill-табы, компактный хедер в стиле контактов |

### Что НЕ входит

- Изменения БД
- Drag-and-drop / перемещение между категориями (нет parent_product_id)
- Изменения логики тарифов/офферов/потоков
- Документация (уберём, позже отдельно как раздел для админов)

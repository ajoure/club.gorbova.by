## План: Переработка фильтра аудитории быстрой рассылки

### Diagnose — что сейчас не так

Файлы: `src/components/admin/communication/BroadcastsTabContent.tsx`, `supabase/functions/telegram-mass-broadcast/index.ts`, `supabase/functions/email-mass-broadcast/index.ts`.

Проблемы текущей реализации:

1. **Фильтр по продукту работает только через `subscriptions_v2 WHERE status='active'`** — то есть всегда «только активная подписка», даже если переключатель выключен. Поэтому работают только клубные продукты (Gorbova Club, Бухгалтерия как бизнес — единственные с подписочной моделью), а курсы/модули/вебинары не дают аудиторию.
2. **Нет источника «покупали когда‑либо»** — историю покупок надо брать из `orders_v2` (status='paid'), а не только из `subscriptions_v2`.
3. **Чекбокс «Только с активной подпиской»** работает как глобальный (любой активный sub), а должен относиться к выбранному продукту: «есть активный доступ именно к продукту А».
4. **Нет исключающих фильтров** — невозможно сказать «купил ЦБ, но НЕ купил Club».
5. **Нет выбора бота** — функция всегда берёт первый `is_primary=true` (gorbova support). У нас 4 активных бота (gorbova support, Gorbova Club, Gorbova BOT, GetCourse), и часть аудитории привязана к разным ботам.
6. **Telegram‑клуб** работает (через `telegram_access`), но логика «сейчас в клубе» — нужно явно разделить «состоит сейчас» / «состоял когда‑либо».
7. **Превью аудитории на клиенте** делает 4 запроса и фильтрует в JS с лимитом 1000 — для базы в 220+ покупателей это нормально, но логика пересчёта дублируется между UI и edge‑функциями (риск рассинхрона).

### Решение

#### 1) Серверный RPC `resolve_broadcast_audience` (единственный источник истины)

Создаём `SECURITY DEFINER` функцию, которая принимает JSON фильтра и возвращает список `user_id` + счётчики. И UI, и обе edge‑функции будут вызывать только её — без дублирования логики.

Схема входа:
```json
{
  "channels": ["telegram", "email"],
  "include": [
    { "product_id": "...", "tariff_ids": ["..."], "mode": "purchased" | "active_access" }
  ],
  "exclude": [
    { "product_id": "...", "tariff_ids": ["..."], "mode": "purchased" | "active_access" }
  ],
  "club_ids": ["..."],
  "club_membership": "current" | "ever" | "any",
  "bot_ids": ["..."]
}
```

Логика:
- База — `profiles` с `email NOT NULL` (для email‑канала) и/или `telegram_user_id NOT NULL` (для tg).
- `mode='purchased'` → `EXISTS (SELECT 1 FROM orders_v2 WHERE user_id = p.user_id AND product_id = ? AND status = 'paid' [AND tariff_id IN (...)])`.
- `mode='active_access'` → `EXISTS (SELECT 1 FROM subscriptions_v2 WHERE user_id = p.user_id AND product_id = ? AND status = 'active' [AND tariff_id IN (...)])`.
- `include` — пересечение (OR в пределах одной строки include, AND между разными — обсудим в UI: по умолчанию **OR между блоками include** = «купил хотя бы один из»).
- `exclude` — `NOT EXISTS` для каждой записи.
- `club_ids + club_membership='current'` → `telegram_access` с активным окном; `'ever'` → без проверки `active_until`.
- `bot_ids` — фильтр по тому, с каким ботом у пользователя есть переписка (`telegram_messages.bot_id IN (...)` или альтернатива — отправлять копию во все выбранные боты, см. п.3).

Возвращает: `{ telegram_count, email_count, total_count, sample (50 строк) }`. Полный список `user_id` отдаётся отдельной функцией `resolve_broadcast_audience_user_ids` для edge (избегаем мегапейлоада в UI).

Permission: проверяем `has_permission('entitlements.manage')`.

#### 2) Переработка UI фильтра в `BroadcastsTabContent.tsx`

Новая модель фильтра в state:

```ts
type AudienceRule = {
  product_id: string;          // "" = "Все продукты"
  tariff_ids: string[];        // [] = все тарифы продукта
  mode: "purchased" | "active_access"; // что значит "Только с активной подпиской"
};

type BroadcastFilters = {
  include: AudienceRule[];     // купил хотя бы один из
  exclude: AudienceRule[];     // НЕ купил ни один из
  club_ids: string[];
  club_membership: "current" | "ever" | "any";
  bot_ids: string[];           // выбранные боты для отправки
};
```

UI секции в правом сайдбаре:

- **Включить (Купившие/С доступом)** — список карточек правил. Для каждой: продукт (Combobox), тарифы (мультивыбор), переключатель `mode` (`purchased` ↔ `active_access`). Кнопка «+ Добавить условие».
- **Исключить** — аналогичный список (по умолчанию свёрнут). Бейджи карточек красные.
- **Telegram‑клуб** — мультивыбор клубов + radio `current` / `ever` / `any`.
- **Боты** — мультивыбор из `telegram_bots WHERE status='active'` (4 бота). По умолчанию выбраны все. Поясняющий текст: «сообщение уйдёт через каждого выбранного бота тем пользователям, у которых есть с ним диалог».
- **Аудитория** — счётчики Telegram / Email + кнопка «Просмотр получателей» (берёт `sample` из RPC).

Обратная совместимость: старые кнопки «Все продукты / Все клубы» остаются как пустое состояние (нет правил).

#### 3) Поведение мульти‑бот в `telegram-mass-broadcast`

Текущая функция берёт первый primary‑бот. Меняем:

- Вход: `bot_ids: string[]` (если пусто — primary‑бот, как сейчас).
- Для каждого получателя пытаемся отправить через **первый бот из `bot_ids`, с которым у пользователя есть диалог** (по `telegram_messages` или `telegram_user_chats`, если есть). Если пересечения нет — пропускаем.
- Опционально: режим «дублировать во все выбранные боты» (чекбокс в UI). По умолчанию ВЫКЛ (чтобы не спамить).

Каждое отправление логируем в `telegram_messages` с правильным `bot_id` (уже делается).

#### 4) Email‑функция

`email-mass-broadcast` принимает тот же `filters`. Вызывает RPC `resolve_broadcast_audience_user_ids` → достаёт email’ы → шлёт. Никаких клубов/ботов для email не учитываем (только продуктовые правила + `email NOT NULL`).

#### 5) Тестирование (Verify)

- Авто‑вызов RPC с пустым фильтром → должен совпасть с числом профилей с email/telegram.
- Кейс «купили ЦБ 2.0, нет активного Club» → проверяем выборку через psql и через UI.
- Кейс «активный Club» (current membership) совпадает с `subscriptions_v2 status=active product='club'`.
- Превью получателей в UI = реальное число отправок в результате `telegram-mass-broadcast` (минус обнаруженные блок/удаление чата).
- Регрессия шаблонов рассылок (вкладка «Шаблоны») — они сейчас тоже передают `filters` в ту же edge‑функцию; контракт фильтра расширяем обратносовместимо (старые поля `productId/clubId` мапим в новые `include[]/club_ids[]`).

### Технический бэклог (DoD)

| # | Артефакт | Действие |
|---|---|---|
| 1 | Migration | RPC `resolve_broadcast_audience(jsonb) returns jsonb` + `resolve_broadcast_audience_user_ids(jsonb) returns setof uuid`, SECURITY DEFINER, grant к authenticated с проверкой permission |
| 2 | Migration | Никаких изменений таблиц — только функции |
| 3 | `BroadcastsTabContent.tsx` | Новый state, UI правил include/exclude, мультивыбор ботов, RPC вместо клиентских join'ов |
| 4 | `telegram-mass-broadcast/index.ts` | Принимает новый `filters`, вызывает RPC, поддерживает `bot_ids` (выбор бота по диалогу) |
| 5 | `email-mass-broadcast/index.ts` | Принимает новый `filters`, вызывает RPC |
| 6 | Шаблоны рассылок (`BroadcastSendDialog`, `BroadcastTemplateDialog`) | Тот же UI правил, либо адаптер «старый→новый» формат |
| 7 | Memory | Записать `commercial-logic/broadcasts/audience-filter-standard` со стандартом фильтра |
| 8 | Verify | Скриншот UI с правилами include/exclude + psql‑проверка одного кейса (купил A не купил B) |

### Открытые вопросы (чтобы не угадывать)

1. **Логика между блоками include**: «купил хотя бы один из перечисленных» (OR) или «купил все перечисленные» (AND)? Предлагаю **OR** — это естественнее для рассылок («все, кто купил ЦБ или Club»).
2. **Мульти‑бот**: нужен ли чекбокс «дублировать во все выбранные боты» или достаточно «один бот, у которого есть диалог»? Предлагаю **один бот** (без дублирования) + порядок приоритета по выбору в UI.
3. **`active_access` vs `purchased` для модулей/вебинаров**: для вебинаров «активной подписки» нет — там `mode='purchased'` всегда даёт всех, кто покупал. Это ОК?

Если по этим трём вопросам у тебя есть конкретные пожелания — отпиши, иначе пойду по дефолтам выше.

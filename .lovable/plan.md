# План: Visual Tariff Editor + Багфиксы UniversalPricingSection (v4)

---

## STOP-GUARD (глобальный)

- Если рефактор TariffCard создаёт риск для club.* / consultation.* → НЕ ломать текущий компонент, выделить thin shared render layer, публичный контракт сохранить backward compatible.
- Production pricing flow ломать НЕЛЬЗЯ.
- Фаза 3 = **UI-only в TariffCard**. Бизнес-логика продаж, доступов, оплат, entitlements НЕ переносится в UI.
- `meta` update — только deep merge (add-only), не перезатирать existing fields (welcome_message и др.).

---

## Фаза 1: Багфиксы UniversalPricingSection.tsx (2 обязательных)

### 1a. Мутация searchParams (строки 59-60)

**Проблема:** `searchParams.delete("offer")` мутирует объект → нестабильное поведение / зацикливания.

**Замена:**
```tsx
setSearchParams(prev => {
  const p = new URLSearchParams(prev);
  p.delete("offer");
  return p;
}, { replace: true });
```
Удаляет только `offer`, сохраняет utm, ref и прочие query params.

### 1b. Auth redirect затирает query-параметры (строки 69-71)

**Проблема:** `${basePath}?offer=${offer.id}` теряет существующие параметры (utm и др.).

**Замена:**
```tsx
const basePath = redirectBasePath || window.location.pathname;
const sp = new URLSearchParams(window.location.search);
sp.set("offer", offer.id);
const returnUrl = `${basePath}?${sp.toString()}`;
navigate(`/auth?redirectTo=${encodeURIComponent(returnUrl)}`);
```

---

## Фаза 2: Редизайн диалога тарифа — Visual Tariff Editor

### 2.0 Архитектура данных

#### card_config внутри tariffs.meta (без миграции БД)

```text
tariffs.meta = {
  card_config: {
    badge_text: string | null        // Произвольный текст бейджа
    price_display: number | null     // Visual-only fallback цены (НЕ каноническая цена продажи)
    old_price: number | null         // Зачёркнутая старая цена (override)
    price_suffix: string             // "BYN", "BYN/мес", "BYN/год"
    cta_text: string | null          // Override текста CTA кнопки
    footnote: string | null          // Подпись под кнопкой
    is_highlighted: boolean          // Выделенная карточка (ring + highlight)
    style_variant: "default" | "highlighted" | "minimal" | "compact"
  },
  ...other existing meta fields (welcome_message etc — НЕ трогать)
}
```

#### Жёсткие правила данных

1. **price_display — только visual fallback:**
   - Реальная цена покупки берётся ТОЛЬКО из offers (primaryOffer.amount)
   - card_config.price_display — visual fallback для превью/лендинга, когда нет active pay_now offer
   - checkout / payments / order flow НЕ используют price_display
   - UI не забирает бизнес-логику продаж на себя

2. **old_price — приоритет с fallback:**
   - `card_config.old_price` → first priority (override)
   - `tariff.original_price` → fallback (existing field)
   - Показывать только если old_price > displayPrice
   - Совместимость со старыми тарифами сохраняется

3. **is_highlighted vs is_popular — разделение:**
   - `is_highlighted` = новый UI-флаг в card_config
   - `is_popular` = legacy compat field в tariffs table
   - Источник для рендера: сначала `card_config.is_highlighted`, потом fallback в `tariff.is_popular`
   - При сохранении: `is_popular = is_highlighted` (backward compat маппинг)
   - НЕ смешивать как одно и то же навсегда

4. **meta deep merge при сохранении:**
   - Сохранить все существующие `meta.*` поля
   - Обновить только `meta.card_config`
   - НЕ удалять `welcome_message` и другие текущие поля
   - Код: `{ ...existingMeta, card_config: { ...newCardConfig } }`

### 2.1 Разделение формы: System fields / Card content

**System fields** (компактная секция):
- Статус (Активен) — Switch вынесен в заголовок диалога
- `access_days` — **оставить в диалоге** как editable поле с пометкой _"Legacy — будет перенесено в настройки кнопки оплаты"_. НЕ скрывать полностью до явного replacement flow в offer.
- `period_label` — оставить как read-only / legacy с пометкой
- `code` — авто-генерация, скрыт

**Card content** (визуальный конструктор):
- Название — полная ширина, чтобы длинный текст был виден
- Подзаголовок — полная ширина, под названием
- Описание — Textarea с `resize-y`, min 3 строки, расширяемое
- Цена на карточке: цена + суффикс (2 поля в строку)
- Старая цена (зачёркнутая) — необязательное
- Бейдж — текстовое поле (произвольный текст)
- Выделить карточку — Switch (`is_highlighted`)
- Преимущества — TariffFeaturesEditor (как есть)

### 2.2 Новая структура диалога (max-w-4xl)

```text
┌─────────────────────────────────────────────────┐
│ Новый тариф / Редактировать         [Активен ●] │
├──────────────────────┬──────────────────────────┤
│ FORM (left ~60%)     │ PREVIEW (right ~40%)     │
│                      │                          │
│ ┌─ Основное ───────┐ │  [Desktop] [Mobile]      │
│ │ Название (full)  │ │                          │
│ │ Подзаголовок     │ │  ┌──────────────────┐   │
│ └──────────────────┘ │  │   TariffCard     │   │
│                      │  │   (live)         │   │
│ ┌─ Цена ───────────┐ │  │                  │   │
│ │ Цена  │ Суффикс  │ │  └──────────────────┘   │
│ │ Старая цена      │ │                          │
│ └──────────────────┘ │                          │
│                      │                          │
│ ┌─ Карточка ───────┐ │                          │
│ │ Бейдж            │ │                          │
│ │ Описание (resize)│ │                          │
│ │ [Выделить]       │ │                          │
│ └──────────────────┘ │                          │
│                      │                          │
│ ┌─ Доступ (legacy) ┐ │                          │
│ │ access_days      │ │                          │
│ │ period_label     │ │                          │
│ └──────────────────┘ │                          │
│                      │                          │
│ ┌─ Преимущества ───┐ │                          │
│ │ TariffFeatures   │ │                          │
│ └──────────────────┘ │                          │
├──────────────────────┴──────────────────────────┤
│                  [Отмена] [Сохранить]           │
└─────────────────────────────────────────────────┘

На mobile (<768px): preview сворачивается в Collapsible
```

### 2.3 View-model нормализатор

Выделить функцию, чтобы TariffCard не перегружался админскими знаниями:

```tsx
// src/lib/tariffCardViewModel.ts
function buildTariffCardViewModel(
  tariff: TariffData,
  offers: TariffOffer[],
  cardConfig: CardConfig | null,
  priceSuffix: string
): TariffCardData
```

- Используется и в UniversalPricingSection, и в админском preview
- TariffCard остаётся чистым render-component
- Вычислительная логика (price priority, old_price fallback, badge resolution) — в view-model

### 2.4 Live Preview

- Preview рендерит тот же `TariffCard` через `buildTariffCardViewModel`
- Обновляется локально по state формы (без network save на каждый input)
- Сохранение только по кнопке Save

### 2.5 Desktop / Mobile preview

НЕ через "max-width контейнера" — через отдельный viewport wrapper:

```tsx
<div className={previewMode === 'mobile' ? 'w-[320px]' : 'w-[400px]'}>
  <TariffCard {...viewModel} />
</div>
```

Одинаковый card render inside, разный viewport wrapper.

---

## Фаза 3: TariffCard — поддержка card_config

### 3.0 STOP-GUARD

Если TariffCard уже завязан на старые пропсы слишком глубоко и рефактор создаёт риск для club.* / consultation.* → НЕ ломать текущий компонент, выделить thin shared render layer, публичный контракт сохранить backward compatible.

### 3.1 Новые поля в TariffCardData

```tsx
card_config?: {
  badge_text?: string | null;
  old_price?: number | null;
  price_suffix?: string;
  footnote?: string | null;
  is_highlighted?: boolean;
  style_variant?: "default" | "highlighted" | "minimal" | "compact";
}
```

### 3.2 Логика рендера (приоритеты)

- **Цена:** `primaryOffer?.amount` > `card_config.price_display` > `tariff.current_price` > "Цена не задана"
- **Зачёркнутая цена:** `card_config.old_price` > `tariff.original_price` > не показывать. Только если > displayPrice.
- **Бейдж:** `card_config.badge_text` > `tariff.badge` > не показывать
- **Highlight:** `card_config.is_highlighted` > `tariff.is_popular` > false
- **Суффикс:** `priceSuffix` prop (из product.landing_config) > `card_config.price_suffix` > "BYN"
- **Footnote:** `card_config.footnote` — текст под кнопками (мелким шрифтом)
- **Style variant:** CSS-класс на GlassCard (default/highlighted/minimal/compact)

### 3.3 Backward compatibility

- Старый тариф без `meta.card_config` → рендерится как раньше (все fallback-и работают)
- Новый тариф с `meta.card_config` → рендерится с новыми возможностями
- Mixed list (старые + новые) → работает без ошибок

---

## Фаза 4: Preview на вкладке «Превью» (AdminProductDetailV2)

- Desktop / Mobile переключатель над сеткой тарифов
- Mobile = viewport wrapper 320px, Desktop = full width
- Используется тот же `TariffCard` + `buildTariffCardViewModel`
- Preview всей pricing section: все тарифы продукта рядом, чтобы видеть highlighted, длину features, высоту карточек

---

## Файлы с изменениями

| Файл | Действие |
|------|----------|
| `src/components/landing/UniversalPricingSection.tsx` | 2 багфикса (searchParams + redirect) |
| `src/lib/tariffCardViewModel.ts` | **Создать** — view-model нормализатор |
| `src/pages/admin/AdminProductDetailV2.tsx` | Редизайн диалога тарифа + live preview + desktop/mobile toggle |
| `src/components/landing/TariffCard.tsx` | card_config support (old_price, badge_text, footnote, style_variant) |

## Что НЕ меняем

- Edge Functions — не трогаем, `meta` jsonb прозрачно проходит
- Бизнес-логика оплат/доступов — НЕ затрагивается
- `access_days` — остаётся в data layer И в UI тарифа (с пометкой legacy)
- `TariffFeaturesEditor` — без изменений
- `UniversalPricingSection` — только 2 багфикса, логика не меняется
- Consultation.tsx, LandingPricing.tsx, ProductLanding.tsx — не трогаем

## Ограничения (что НЕ делаем)

- Произвольный HTML / rich-text editor
- Custom CSS / drag-drop builder
- Ручное изменение шрифтов / размеров / цветов
- Кастомные иконки поэлементно
- Анимации в админке

## Preset styles (v1)

- `default` — стандартная карточка
- `highlighted` — ring + primary accent
- `minimal` — упрощённая, без бейджа
- `compact` — компактная для списков

---

## DoD (Definition of Done)

### Фаза 1
- ☐ searchParams очищается через клон (удаляется только offer, сохраняются utm/ref)
- ☐ Auth redirect сохраняет существующие query-параметры
- ☐ Возврат из /auth по ?offer=... → PaymentDialog открывается → URL очищается корректно

### Фаза 2
- ☐ Диалог тарифа разделён на System fields и Card content
- ☐ Название и подзаголовок — полная ширина
- ☐ Описание — Textarea с resize-y
- ☐ Есть поля: Цена, Суффикс, Старая цена (зачёркнутая)
- ☐ Бейдж — произвольный текст
- ☐ access_days — editable, с пометкой legacy
- ☐ Live preview карточки в диалоге (тот же TariffCard через buildTariffCardViewModel)
- ☐ Desktop/Mobile переключатель в preview (viewport wrapper, не max-width)
- ☐ meta сохраняется через deep merge (existing fields не теряются)

### Фаза 3
- ☐ TariffCard поддерживает card_config
- ☐ Зачёркнутая цена отображается если old_price > displayPrice
- ☐ Бейдж из card_config.badge_text с fallback в tariff.badge
- ☐ is_highlighted с fallback в is_popular
- ☐ Footnote под кнопками
- ☐ **Backward compat:** старый тариф без card_config рендерится как раньше
- ☐ **Mixed list:** старые + новые тарифы рядом — без ошибок

### Фаза 4
- ☐ Preview всей pricing section на вкладке «Превью» с desktop/mobile toggle
- ☐ Все тарифы продукта видны рядом
- ☐ Highlighted/обычные карточки визуально различимы

### Общий DoD
- ☐ Нет HTML/CSS конструктора, только типизированные поля
- ☐ Existing pricing flow не сломан (club.*, consultation.*)
- ☐ card_config хранится в tariffs.meta.card_config (без миграции БД)
- ☐ price_display НЕ используется в checkout/payments/orders
- ☐ Нет дублированной карточной логики (единый TariffCard)


# План: Премиальный glassmorphism дизайн для статистики платежей

## Проблема

Текущие карточки выглядят **серыми и дешёвыми** потому что:
1. Фон страницы почти белый — стекло на белом = серое
2. Шрифт слишком жирный (`font-bold`)
3. Нет цветного подсвета/градиента для создания глубины
4. Карточки используют `bg-white/8%` на белом фоне → визуально серые

**Референс (image-882)**: Стекло работает на **цветном градиентном фоне** — это создаёт прозрачность и премиальность.

---

## Решение

### Подход: Добавить цветной градиентный фон под панель статистики

Вместо белого фона создаём мягкий градиент от синего к фиолетовому — как на референсе. Карточки становятся реально прозрачными.

---

## PATCH-1: Обновить GlassStatCard.tsx — лёгкий воздушный стиль

**Файл:** `src/components/admin/payments/GlassStatCard.tsx`

Изменения:
1. **Убрать жирный шрифт** — `font-bold` → `font-medium` для значений
2. **Сделать фон прозрачнее** — `rgba(255,255,255,0.08)` → `rgba(255,255,255,0.4)` (light) / `rgba(255,255,255,0.06)` (dark)
3. **Более мягкие границы** — `border-white/[0.2]` для лёгкости
4. **Усилить внутреннее свечение** — более заметный shine overlay
5. **Убрать тёмный фон иконок** — использовать прозрачные круги

```typescript
// Новые стили:
className={cn(
  "relative overflow-hidden rounded-2xl p-4",
  "backdrop-blur-xl",
  // Light mode: более прозрачный белый
  "bg-white/40 dark:bg-white/[0.06]",
  // Мягкая граница
  "border border-white/50 dark:border-white/[0.12]",
  // Мягкая тень
  "shadow-[0_4px_24px_rgba(0,0,0,0.04)]",
  // ...
)}

// Значения — средний вес шрифта
<p className={cn("text-xl font-medium tabular-nums tracking-tight", colors.text)}>
```

---

## PATCH-2: Добавить градиентный контейнер в PaymentsStatsPanel

**Файл:** `src/components/admin/payments/PaymentsStatsPanel.tsx`

Обернуть сетку карточек в контейнер с мягким градиентом:

```typescript
<div 
  className="relative rounded-3xl p-4 overflow-hidden"
  style={{
    background: 'linear-gradient(135deg, hsl(217 91% 60% / 0.08) 0%, hsl(260 80% 65% / 0.06) 50%, hsl(280 75% 60% / 0.04) 100%)',
  }}
>
  {/* Декоративные размытые сферы для глубины */}
  <div 
    className="absolute -top-20 -left-20 w-40 h-40 rounded-full opacity-30 blur-3xl pointer-events-none"
    style={{ background: 'radial-gradient(circle, hsl(217 91% 60% / 0.4), transparent)' }}
  />
  <div 
    className="absolute -bottom-10 -right-10 w-32 h-32 rounded-full opacity-20 blur-3xl pointer-events-none"
    style={{ background: 'radial-gradient(circle, hsl(280 75% 60% / 0.4), transparent)' }}
  />
  
  {/* Сетка карточек */}
  <div className="relative grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
    {/* GlassStatCard... */}
  </div>
</div>
```

---

## PATCH-3: Обновить цветовую палитру вариантов

**Файл:** `src/components/admin/payments/GlassStatCard.tsx`

Более "дорогие" премиальные цвета:

```typescript
const variantColors: Record<GlassStatVariant, { text: string; iconBg: string }> = {
  default: { 
    text: 'text-foreground/90', 
    iconBg: 'bg-primary/10' 
  },
  success: { 
    // Изумрудно-бирюзовый (премиальный)
    text: 'text-emerald-600 dark:text-emerald-400', 
    iconBg: 'bg-emerald-500/10' 
  },
  warning: { 
    // Тёплый янтарный
    text: 'text-amber-600 dark:text-amber-400', 
    iconBg: 'bg-amber-500/10' 
  },
  danger: { 
    // Мягкий розовый вместо агрессивного красного
    text: 'text-rose-600 dark:text-rose-400', 
    iconBg: 'bg-rose-500/10' 
  },
  info: { 
    // Небесно-голубой
    text: 'text-sky-600 dark:text-sky-400', 
    iconBg: 'bg-sky-500/10' 
  },
};
```

---

## PATCH-4: Обновить BepaidStatementSummary (тот же стиль)

**Файл:** `src/components/admin/payments/BepaidStatementSummary.tsx`

Применить идентичный градиентный контейнер и обновлённые карточки.

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/admin/payments/GlassStatCard.tsx` | Прозрачнее, легче, средний вес шрифта |
| `src/components/admin/payments/PaymentsStatsPanel.tsx` | Градиентный контейнер + декоративные сферы |
| `src/components/admin/payments/BepaidStatementSummary.tsx` | Тот же градиентный контейнер |

---

## Визуальное сравнение

| Аспект | Было | Станет |
|--------|------|--------|
| Фон карточек | `bg-white/8%` на белом → серый | `bg-white/40%` на градиенте → прозрачное стекло |
| Шрифт значений | `font-bold` (жирный) | `font-medium` (средний) |
| Границы | `border-white/12%` (едва видны) | `border-white/50%` (мягкий блеск) |
| Контейнер | Без фона | Мягкий сине-фиолетовый градиент |
| Глубина | Плоские карточки | Декоративные blur-сферы создают объём |

---

## Технические детали CSS

### Градиентный контейнер
```css
.stats-container {
  background: linear-gradient(
    135deg,
    hsl(217 91% 60% / 0.08) 0%,   /* Синий */
    hsl(260 80% 65% / 0.06) 50%,  /* Фиолетовый */
    hsl(280 75% 60% / 0.04) 100%  /* Пурпурный */
  );
  border-radius: 1.5rem;
  padding: 1rem;
}
```

### Прозрачная карточка
```css
.glass-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
}

.dark .glass-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
```

---

## Ожидаемый результат

- Карточки будут выглядеть как настоящее стекло на цветном фоне
- Лёгкий, воздушный дизайн с премиальными цветами
- Мягкие тени и границы вместо жёстких линий
- Шрифты средней толщины для элегантности
- Декоративные blur-сферы добавляют глубину и "дороговизну"

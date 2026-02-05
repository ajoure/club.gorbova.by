

# План: Реалистичный Glass-эффект для статистики платежей

## Проблема

Текущий дизайн создаёт "молочные" карточки вместо настоящего стекла:
- `bg-white/50` слишком плотный → выглядит как белая плашка
- Нет насыщенного цветного фона → нечего размывать
- `backdrop-blur` не работает визуально на светлом фоне

**Референс (image-884)**: Стекло работает на **тёмном градиентном фоне** с цветными пятнами — это создаёт эффект прозрачности и размытия.

---

## Решение

### PATCH-1: Обновить GlassStatCard — настоящее стекло

**Файл:** `src/components/admin/payments/GlassStatCard.tsx`

Изменения:
1. **Снизить плотность фона** — `bg-white/50` → `bg-white/[0.08]` (критично!)
2. **Усилить blur с saturate** — `backdrop-blur-2xl` + `saturate(160%)`
3. **Добавить ring** — тонкий внутренний кант `ring-1 ring-white/[0.10]`
4. **Реалистичный блик** — overlay с градиентом и поворотом

```typescript
className={cn(
  "relative overflow-hidden rounded-[28px] p-4",
  "bg-white/[0.08] dark:bg-white/[0.06]",
  "border border-white/[0.22] dark:border-white/[0.12]",
  "shadow-[0_18px_60px_rgba(0,0,0,0.18)]",
  "ring-1 ring-white/[0.10]",
  "transition-all duration-300",
  // ...
)}
style={{ 
  backdropFilter: 'blur(22px) saturate(160%)', 
  WebkitBackdropFilter: 'blur(22px) saturate(160%)' 
}}
```

Реалистичный блик (overlay):
```tsx
<div className="pointer-events-none absolute inset-0">
  {/* Основной блик */}
  <div className="absolute -top-20 left-[-30%] h-56 w-[160%] rotate-[-12deg] bg-gradient-to-b from-white/35 via-white/10 to-transparent" />
  {/* Вторичное свечение */}
  <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-white/5" />
</div>
```

---

### PATCH-2: Создать цветную "сцену" для стекла

**Файл:** `src/components/admin/payments/PaymentsStatsPanel.tsx`

Обернуть весь контент в wrapper с тёмным градиентным фоном и размытыми пятнами:

```tsx
<div className="relative isolate rounded-3xl overflow-hidden p-4">
  {/* Фоновый градиент — тёмно-синий → сине-фиолетовый */}
  <div 
    className="absolute inset-0 -z-10"
    style={{ 
      background: 'linear-gradient(135deg, #0B2A6F 0%, #123B8B 50%, #0A1E4A 100%)' 
    }}
  />
  
  {/* Размытые пятна — цветной glow */}
  <div className="absolute -z-10 top-[-100px] left-[-100px] h-[320px] w-[320px] rounded-full bg-cyan-400/25 blur-[90px]" />
  <div className="absolute -z-10 bottom-[-140px] right-[-140px] h-[380px] w-[380px] rounded-full bg-violet-500/20 blur-[110px]" />
  <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[280px] w-[280px] rounded-full bg-blue-500/15 blur-[100px]" />
  
  {/* Stats grid — стеклянные карточки */}
  <div className="relative grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
    {/* GlassStatCard... */}
  </div>
</div>
```

---

### PATCH-3: Применить тот же стиль к BepaidStatementSummary

**Файл:** `src/components/admin/payments/BepaidStatementSummary.tsx`

Идентичный wrapper с тёмным фоном и цветными пятнами.

---

### PATCH-4: (Опционально) Обновить Sync Dropdown

**Файл:** `src/components/admin/payments/PaymentsTabContent.tsx`

Применить glass-стиль к `DropdownMenuContent`:
```tsx
<DropdownMenuContent 
  align="end" 
  className="w-64 bg-white/[0.08] backdrop-blur-2xl border-white/[0.18] ring-1 ring-white/[0.08]"
  style={{ backdropFilter: 'blur(22px) saturate(160%)' }}
>
```

---

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/components/admin/payments/GlassStatCard.tsx` | bg-white/[0.08], реалистичный блик, saturate |
| `src/components/admin/payments/PaymentsStatsPanel.tsx` | Тёмный градиентный wrapper с blur-пятнами |
| `src/components/admin/payments/BepaidStatementSummary.tsx` | Тот же тёмный wrapper |

---

## Визуальное сравнение

| Аспект | Было | Станет |
|--------|------|--------|
| Фон карточек | `bg-white/50` (молочный) | `bg-white/[0.08]` (прозрачный) |
| Фон контейнера | Светлый градиент (hsl 10%) | Тёмно-синий градиент (#0B2A6F) |
| Backdrop-filter | `blur(16px)` | `blur(22px) saturate(160%)` |
| Блик | Простой градиент | Повёрнутый (-12deg) + multi-layer |
| Пятна | opacity 20-40% | Более насыщенные (cyan/violet) |

---

## Техническая спецификация

### Стеклянная карточка
```css
.glass-card {
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
  border-radius: 28px;
}

/* Реалистичный блик */
.glass-card::before {
  content: '';
  position: absolute;
  top: -80px;
  left: -30%;
  width: 160%;
  height: 224px;
  transform: rotate(-12deg);
  background: linear-gradient(to bottom, 
    rgba(255,255,255,0.35), 
    rgba(255,255,255,0.10), 
    transparent
  );
  pointer-events: none;
}
```

### Фоновая "сцена"
```css
.glass-scene {
  background: linear-gradient(135deg, #0B2A6F, #123B8B, #0A1E4A);
  position: relative;
  isolation: isolate;
}

.glass-scene::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  /* Цветные пятна через radial-gradient */
}
```

---

## Ожидаемый результат

- Карточки выглядят как **настоящее стекло** — прозрачные, размывают фон
- Видно цветной градиент сквозь карточки
- Реалистичный блик сверху (как на image-884)
- Тонкая обводка + внутренний ring для глубины
- Без "белой плашки" или "молочного" эффекта

---

## DoD (Definition of Done)

| Проверка | Критерий |
|----------|----------|
| bg-white/[0.08] | Фон карточек очень низкой плотности |
| Тёмный gradient | Wrapper использует #0B2A6F → #0A1E4A |
| Blur пятна | cyan-400/25 и violet-500/20 с blur-[90px+] |
| Блик rotate(-12deg) | Overlay с поворотом и градиентом |
| saturate(160%) | Inline-style для backdrop-filter |
| Скрин /admin/payments | Визуально соответствует референсу image-884 |


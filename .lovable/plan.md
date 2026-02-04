

# План: Удаление заглушки и добавление "Бухгалтерия как бизнес"

## Проблема

В файле `src/pages/Learning.tsx` в массиве `products` (строки 49-108):
- **Есть заглушка** "Мастер-класс: Налоговая оптимизация" (строки 94-107) — mock-данные с `isPurchased: true`
- **Нет** реального продукта "Бухгалтерия как бизнес" с внешней ссылкой

## Решение

### 1. Удалить заглушку (строки 94-108)

```tsx
// УДАЛИТЬ ПОЛНОСТЬЮ:
{
  id: "4",
  title: "Мастер-класс: Налоговая оптимизация",
  description: "Практические кейсы по легальному снижению налоговой нагрузки",
  badge: "Скоро",
  badgeVariant: "outline",
  price: "290 BYN",
  image: productCourseImage,
  isPurchased: true,        // ← mock!
  purchaseLink: "#",
  courseSlug: "tax-optimization",
  lessonCount: 8,
  completedCount: 3,        // ← mock!
  duration: "2 недели",
},
```

### 2. Добавить "Бухгалтерия как бизнес" (вместо удалённого)

```tsx
{
  id: "4",
  title: "Бухгалтерия как бизнес",
  description: "Пошаговый квест для бухгалтеров, которые хотят работать на себя и зарабатывать больше",
  badge: "Тренинг",
  badgeVariant: "secondary",
  price: "от 100 BYN/мес",
  image: katerinaBusinessImage,  // Уже импортировано!
  isPurchased: false,            // Будет проверяться через businessTrainingAccess
  purchaseLink: "https://club.gorbova.by/business-training",
  // courseSlug: "buh-business" — для SPA навигации внутри платформы
  courseSlug: "buh-business",
  duration: "12 модулей",
},
```

### 3. Обновить логику `enrichedProducts` для buh-business

В useMemo (около строки 394-420) уже есть проверка `businessTrainingAccess`, но она закомментирована. Нужно её восстановить:

```tsx
// Специальная обработка для buh-business
if (product.courseSlug === "buh-business") {
  const hasPaid = businessTrainingAccess?.hasPaidAccess || false;
  const hasReserve = businessTrainingAccess?.hasReservation || false;
  
  return {
    ...product,
    isPurchased: hasPaid,
    badge: hasPaid ? "Активно" : hasReserve ? "Бронь" : product.badge,
  };
}
```

### 4. Обновить обработку клика для внешних ссылок

В `handleGoToSite` (строка 144-156) уже есть логика:
```tsx
if (product.purchaseLink.startsWith("http")) {
  window.open(product.purchaseLink, "_blank");
}
```

Это сработает корректно для `https://club.gorbova.by/business-training`.

### 5. Добавить обработку badge "Тренинг"

В `getBadgeClasses` (строка 110-129) добавить:
```tsx
case "Тренинг":
  return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-0";
```

## Файлы для изменения

| Файл | Изменения |
|------|-----------|
| `src/pages/Learning.tsx` | Удалить mock "Налоговая оптимизация", добавить "Бухгалтерия как бизнес", восстановить логику доступа |

## Ожидаемый результат

| Вкладка | До | После |
|---------|-----|-------|
| Все продукты | 4 карточки (включая mock) | 4 карточки (реальные продукты) |
| Моя библиотека | 1 mock-курс | Только реальные купленные продукты |

## DoD

| Проверка | Ожидаемый результат |
|----------|---------------------|
| Вкладка "Все продукты" | 4 карточки без "Налоговая оптимизация", есть "Бухгалтерия как бизнес" |
| Клик "На сайт" для buh-business | Открывает `https://club.gorbova.by/business-training` в новой вкладке |
| Вкладка "Моя библиотека" | Нет mock-курсов, только реальные покупки |
| Пользователь с подпиской buh-business | Видит badge "Активно" и кнопку "Открыть курс" |
| Пользователь с бронью | Видит badge "Бронь" |


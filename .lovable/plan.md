
# План: Точное сопоставление доступа к модулям тренингов

## ✅ ВЫПОЛНЕНО

### 1. Уведомление для пользователей без доступа
**Файл:** `src/pages/LibraryModule.tsx`
- Добавлена CTA-карточка с замком для пользователей без подписки FULL/BUSINESS
- Кнопка ведёт на `club.gorbova.by`

### 2. Исправление ошибки Kinescope плеера
**Файл:** `src/hooks/useKinescopePlayer.ts`
- Добавлена проверка `isMounted` во все `setTimeout` callback'и
- Добавлена проверка `isMounted` в `MutationObserver`
- Это предотвращает ошибку `removeChild` при размонтировании

### 3. Проверка доступа через entitlements
**Файл:** `src/hooks/useTrainingModules.tsx`
- Добавлена проверка `entitlements` с `product_code='club'`
- Теперь доступ есть у: админов, пользователей с club entitlement, FULL/BUSINESS подписчиков

## Сводка по доступу

| Группа | Видит модули? |
|--------|---------------|
| Администраторы (super_admin + admin) | ✅ Да |
| BUSINESS подписка | ✅ Да |
| FULL подписка | ✅ Да |
| Entitlement `club` (активный) | ✅ Да |
| CHAT подписка (без entitlement) | ❌ Нет |
| Пользователи без подписки | ❌ Нет (видят CTA) |

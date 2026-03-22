
# PATCH 5R+ — View-карточка реквизитов в стиле ContactDetailSheet — ВЫПОЛНЕН

## Статус: закрыт

## Что сделано
- Создан `EntityViewSheet.tsx` — view-карточка с shell 1:1 как ContactDetailSheet
- `EntityTableView` — клик по строке открывает view-карточку, не форму
- `AI.tsx` — добавлен view→edit flow: view sheet → кнопка «редактировать» → editor sheet
- Секции карточки: Основная информация, Адрес, Руководитель, Банк, Служебная информация
- Action bar: badge типа, badge статуса, badge «Платёжные», кнопка редактирования, кнопка архивирования (только document)

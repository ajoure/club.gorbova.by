# да, согласен, с учетом правок:

&nbsp;

1. В разделе Raw helper proof обязательно показывать helper-фрагменты в fenced code block и дополнительно дублировать рядом короткой строкой-подтверждением, что это именно raw-фрагмент из файла с указанием файла и диапазона строк. Без диапазона строк proof не считается.
2. В разделе Raw call-site proof для 3 обязательных точек нужно показывать не обрывок, а непрерывный фрагмент, где одновременно видны:  

  - buildContactUrl(...)
  - buildAdminNotifyMessage(...)
  - вызов telegram-notify-admins
  - parse_mode или отсутствие parse_mode в этом вызове  
  Иначе не получится доказать связь helper → реальный боевой вызов.
3. &nbsp;
4. В матрице 11/11 добавь ещё колонку proof_ref, где для каждой точки будет ссылка вида: helper raw / call-site raw / default parse_mode raw. Это уберёт спорные места по тому, чем именно подтверждена строка матрицы.
5. В разделе 3 raw HTML dry-run examples нужно показывать именно итоговую строку, которую вернёт builder, а не объект параметров. Внутри примера должны быть видны raw <a ...> и raw <code>...</code>. Если в примере хотя бы один из этих тегов пропал, пример не засчитывается.
6. В разделе STOP-guard зафиксируй ещё одно правило: если хотя бы по одной из 11 точек нет raw call-site proof, то статус всей матрицы автоматически not accepted, даже если helper сам по себе корректен.
7. В финальном разделе Mismatch / Exceptions указывать не только none или список проблем, но и число закрытых точек в формате:  

  - 11/11 closed
  - либо 10/11 closed, 1 open
8. &nbsp;
9. Финальный вывод accepted / not accepted должен ставиться только после матрицы и блока Mismatch / Exceptions, не раньше и без промежуточных формулировок.
  План: пересборка acceptance report в доказуемом raw-виде

## Цель

Не выпускать ещё один “общий” отчёт. Вместо этого собрать acceptance report только из raw-доказательств, чтобы HTML-теги не терялись рендером чата и не было внутренних противоречий.

## Что уже подтверждено по коду

По реальным файлам сейчас видно:

- в helper есть raw HTML-ссылка: `return \`[\${safeName}](\${escapeHtml(contactUrl)});`
- `order_number` и `bepaid_subscription_id` оборачиваются в `<code>...</code>`
- `escapeHtml()` содержит замены `&`, `<`, `>`, `"`
- в `bepaid-webhook`, `subscription-charge`, `admin-manual-charge` helper реально используется
- default `parse_mode = 'HTML'` есть в `telegram-notify-admins`
- часть вызовов передаёт `parse_mode: 'HTML'` явно

Но это нужно оформить в acceptance-отчёт так, чтобы доказательства были неоспоримыми.

## Как будет пересобран отчёт

### 1) Raw-proof helper

Показать отдельными code block без пересказа:

- `escapeHtml()`
- `buildClientLine()`
- `if (order_number)`
- `if (bepaid_subscription_id)`

Формат: только raw-код, без “объяснения своими словами” внутри блока.

### 2) Raw-proof call sites

Показать минимум 3 реальных raw-вызова:

- `bepaid-webhook`
- `subscription-charge`
- `admin-manual-charge`

В каждом raw-фрагменте должны быть одновременно видны:

- `buildContactUrl(...)`
- `buildAdminNotifyMessage({...})`
- вызов `telegram-notify-admins`
- источник `parse_mode` (явный либо через default)

### 3) Матрица 11/11 на acceptance-уровне

Собрать таблицу по всем payment-related точкам со столбцами:

- файл
- место вызова
- helper used
- contact_url source
- client_link (`raw link` / `text fallback`)
- parse_mode source (`explicit HTML` / `default HTML`)
- id_wrapped_in_code
- status

Отдельно пометить:

- где `contact_url` строится через `buildContactUrl(...)`
- где `parse_mode` берётся явно
- где он берётся из default в `telegram-notify-admins`

### 4) Dry-run proof только как raw HTML string

Показать 3 примера строго в code block как итоговые raw-строки:

1. обычная оплата
2. продление подписки
3. оплата по ссылке

В каждом примере должны явно присутствовать:

- `<a href="...">`
- `<code>...</code>`
- masked email
- отсутствие пустых строк между условными полями

### 5) Правило для parse_mode

Для каждой из 11 точек в матрице будет указан один из двух доказуемых вариантов:

- `parse_mode: 'HTML'` передан явно
- `parse_mode` не передан, но есть raw-proof default: `const { message, parse_mode = 'HTML', ... }`

### 6) STOP-guard

Если при перепроверке обнаружится хотя бы одна точка:

- без helper
- без `<code>`
- без ссылки / корректного text fallback
- без доказуемого HTML parse mode

тогда acceptance report не выпускается как final.
Вместо него будет отдельный mini-fix plan по конкретной незакрытой точке, а уже потом — новый полный acceptance report.

## Что не входит

В acceptance-матрицу не включаются:

- error/debug/system alerts
- summary/report notifications
- тестовые функции

Показываются только 11 payment-related уведомлений.

## Итоговый формат сдачи

Финальный acceptance report будет содержать разделы в таком порядке:

1. Raw helper proof
2. Raw call-site proof (3 места)
3. Raw default parse_mode proof
4. Матрица 11/11
5. 3 raw HTML dry-run examples
6. `Mismatch / Exceptions: none` либо точный список незакрытых точек
7. Итог только одним словом:

- `accepted`
или
- `not accepted`

## Ожидаемый результат

Следующий отчёт будет не “описанием”, а доказательной приёмкой по исходникам. Это снимет текущую причину отказа: отсутствие raw-пруфов в форме, устойчивой к рендеру чата.
да, согласен, с учетом правок:

1. **Сначала зафиксировать точную причину** `0`
  - Отдельно проверить:
    - RPC реально возвращает `0`;
    - RPC падает с ошибкой, а UI подменяет ошибку на `0`;
    - UI передаёт не тот `filters`;
    - `include_archived` не доходит до RPC.
  - До фикса нельзя считать, что проблема только в UI.
2. **UI не должен возвращать fake-zero**
  - В `BroadcastsTabContent.tsx` заменить fallback:
  ```ts
  return { telegramCount: 0, emailCount: 0, ... }
  ```
  на явное состояние:
  ```text
  audienceStatus: "error"
  audienceError: error.message
  ```
  - В интерфейсе показывать:
3. **Добавить debug-proof входных фильтров**  
В dry-run отчёте обязательно показать:
  &nbsp;
  ```json
  {
    "include": [...],
    "exclude": [],
    "club_ids": [],
    "club_membership": "current",
    "include_archived": true/false
  }
  ```
  Это нужно, чтобы исключить ошибку UI → RPC.
4. **Проверить тарифный фильтр отдельно от продуктового**  
Нужны 4 контрольных запроса:
  &nbsp;
  ```text
  product only + active
  product only + include_archived
  product + tariff_ids + active
  product + tariff_ids + include_archived
  ```
  Ожидания:
5. **RPC nesting / permission проверить отдельно**  
Если `resolve_broadcast_audience()` вызывает `resolve_broadcast_audience_contacts()` и та внутри снова проверяет `auth.uid() / has_permission`, возможен ложный `forbidden`.
  &nbsp;
  Правильный вариант:
  - внешний RPC делает admin-check;
  - внутренний resolver вызывается через безопасный system/internal path;
  - обычным пользователям доступ не расширять.
6. **Не менять** `email-mass-broadcast`**, если preview-only**  
Edge function трогать только если dry-run покажет расхождение:
  &nbsp;
  ```text
  preview count != email-mass-broadcast dry_run found
  ```
  Если execute-path уже корректный — не трогать.
7. **Добавить machine-check после фикса**  
После миграции/патча выполнить:
  &nbsp;
  ```sql
  SELECT public.resolve_broadcast_audience('<filters>'::jsonb);
  ```
  и отдельно:
  ```sql
  SELECT count(*)
  FROM public.resolve_broadcast_audience_contacts('<filters>'::jsonb);
  ```
  Они должны совпадать по email_count.
8. **DoD расширить**  
Добавить:
9. **Audit/debug без засорения production**  
Если добавляется логирование фильтров, оно должно быть:
  - только в console/debug response для dry-run;
  - либо в admin-only diagnostic;
  - не писать каждый preview в `audit_logs`.
10. **Не смешивать с PATCH-A runtime audit proof**  
Этот патч — про preview/counting bug.  
Хвост `email_mass_broadcast SYSTEM ACTOR proof` остаётся отдельным deferred и не должен блокировать исправление подсчёта.

Итог: план правильный, но перед execute обязательно доказать, где именно возникает `0`: в RPC, в permission nesting или в UI fallback.

&nbsp;

План:

1. Проблема

В UI рассылок аудитория стала показываться как `0` для фильтра «Ценный бухгалтер | 1 ступень 2.0» с выбранными тарифами. Это опасно, потому что интерфейс сейчас показывает ноль без явного объяснения, хотя backend-данные по покупкам не нулевые.

2. Диагностика

Фактически проверено сейчас:

- В `BroadcastsTabContent.tsx` preview вызывает RPC `resolve_broadcast_audience`.
- Если RPC возвращает ошибку, код на строках 296–303 просто пишет ошибку в console и возвращает:
  - `telegramCount: 0`
  - `emailCount: 0`
  - `users: []`

То есть UI может показывать `0 пользователей` не потому, что аудитория реально пустая, а потому что ошибка backend-аудитории замаскирована под нулевой результат.

Backend-проверка данных по этому продукту показывает, что аудитория не нулевая:

- По продукту `7101ed3c-7839-4a74-ad95-aa0660369b22` без ограничения тарифов:
  - paid orders: `341`
  - unique order emails: `214`
  - contact-level recipients include archived: `215`
  - active-only: `211`
  - archived canonical: `4`
  - no-account contacts: `78`
- По выбранным на скриншоте 3 тарифам:
  - paid orders: `238`
  - unique order emails: `210`
  - contact-level recipients include archived: `210`
  - active-only: `206`
  - archived canonical: `4`
  - no-account contacts: `77`

Также при прямой проверке `resolve_broadcast_audience(...)` без пользовательского auth-контекста получен `forbidden` из вложенного `resolve_broadcast_audience_contacts(...)`. Это подтверждает класс проблемы: ошибка RPC может превращаться в `0` в UI.

3. Предлагаемое решение

Срочно исправить это как UI/backend reliability patch:

A. Не маскировать ошибки preview под ноль

- В `BroadcastsTabContent.tsx` заменить fallback `return 0` на явное состояние ошибки.
- В блоке «Аудитория» показывать красный alert: `Ошибка расчёта аудитории`, с текстом ошибки RPC.
- Не разрешать отправку, если preview-аудитория не рассчиталась из-за ошибки.

B. Добавить backend-safe preview path

- Обновить `resolve_broadcast_audience`, чтобы он не ломался из-за вложенного вызова `resolve_broadcast_audience_contacts` при допустимом caller-е.
- Внутри `resolve_broadcast_audience` вызывать contact-level resolver в режиме, который не конфликтует с security-definer/nested auth контекстом.
- При этом не открывать RPC публично: доступ остается только для авторизованных админов через permission guard.

C. Синхронизировать preview и execute

- Preview должен считать тем же contact-level контрактом, что и `email-mass-broadcast`.
- `include_archived` остается явным opt-in.
- Для скриншотного кейса ожидаемый preview после фикса:
  - если выбраны 3 тарифа и `include_archived=false`: около `206` email recipients;
  - если `include_archived=true`: около `210` email recipients.
- Если выбрать продукт без ограничения тарифов:
  - `211` active-only;
  - `215` with archived.

D. Добавить runtime dry-run proof

- Вызвать `email-mass-broadcast` в `dry_run=true` для этого же фильтра.
- Проверить, что dry-run возвращает diagnostic:
  - `allowed > 0`
  - `found > 0`
  - `duplicates`, `invalid_emails`, `archived_included`
- Dry-run audit не пишет — это нормально.

4. Изменяемые компоненты

- UI:
  - `src/components/admin/communication/BroadcastsTabContent.tsx`
- SQL/RPC:
  - `public.resolve_broadcast_audience`
  - при необходимости минимально `public.resolve_broadcast_audience_contacts`, без изменения бизнес-логики выборки
- Edge function:
  - `supabase/functions/email-mass-broadcast/index.ts` только если dry-run покажет рассинхрон preview/execute; иначе не трогать.

5. Что не будет изменено

- Не трогаю `orders_v2`.
- Не трогаю CRM-дедуп PATCH-B.
- Не меняю paid/status/entitlements/documents.
- Не меняю аудиторию рассылок бизнес-логически: только исправляю отображение ошибки и надежность resolver-а.
- Не создаю новые таблицы.
- Не создаю новый source of truth.

6. Dry-run

Перед реальным изменением данных выполнить только read-only проверки:

- Проверить текущий `pg_get_functiondef` для:
  - `resolve_broadcast_audience`
  - `resolve_broadcast_audience_contacts`
  - `resolve_broadcast_audience_contacts_system`
- Сравнить ручной SQL-count с RPC-count.
- Проверить текущий UI-контракт: какие поля ожидает `BroadcastsTabContent.tsx`.

После миграции выполнить:

```sql
select public.resolve_broadcast_audience(
  '{
    "include":[{
      "product_id":"7101ed3c-7839-4a74-ad95-aa0660369b22",
      "tariff_ids":[
        "9bc81736-e7e5-48db-9925-b866427a98e1",
        "adbe94e8-171d-4b49-8338-66c554bb1f0b",
        "543940b1-99da-47f3-accc-671ad5b11afe"
      ],
      "mode":"purchased"
    }],
    "exclude":[],
    "club_ids":[],
    "club_membership":"current",
    "include_archived":true
  }'::jsonb
);
```

Ожидание: не `0`, а около `210` email recipients для выбранных тарифов.

7. Execute

- Создать миграцию с исправлением `resolve_broadcast_audience`.
- Обновить UI, чтобы ошибка RPC не превращалась в `0`.
- При необходимости задеплоить `email-mass-broadcast` только если потребуется синхронизация dry-run diagnostic.

8. STOP-guards

Остановиться и не деплоить, если:

- ручной SQL-count и RPC-count расходятся больше чем на ожидаемое различие active-only/include-archived;
- RPC начинает возвращать всю базу при выбранном продукте;
- `include_archived=false` включает архивных;
- `include_archived=true` всё равно исключает архивных;
- preview и dry-run `email-mass-broadcast` дают разные `found/allowed` по одному и тому же фильтру;
- появляется необходимость менять `orders_v2`, `entitlements`, CRM stages или документы.

9. DoD

Задача считается закрытой, когда:

- UI больше не показывает `0` при ошибке RPC; вместо этого показывает явную ошибку.
- Для фильтра на скриншоте аудитория показывает не ноль:
  - active-only около `206` email;
  - include archived около `210` email.
- Для продукта без ограничения тарифов:
  - active-only около `211` email;
  - include archived около `215` email.
- `email-mass-broadcast` dry-run возвращает `diagnostic.found > 0` для того же фильтра.
- Никакие paid orders / entitlements / документы / CRM-стадии не изменены.

10. Риски и зависимости

- Основной риск — permission/RPC nesting: внешний RPC проходит, а вложенный resolver падает `forbidden`. Это нужно исправить без ослабления доступа для обычных пользователей.
- Второй риск — UI раньше скрывал ошибку, поэтому пользователь видел `0` вместо причины. После фикса ошибка станет видимой, а не тихой.

11. Требуется дополнительная информация

Не требуется. Причина уже локализована достаточно для патча: реальная аудитория в базе не нулевая, а UI сейчас маскирует ошибочный preview как `0`.
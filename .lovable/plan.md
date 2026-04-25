&nbsp;

&nbsp;

да, согласен, с учетом правок:

  


1. **Разделить PATCH на два независимых блока**
  - **PATCH-A: Broadcast audience/email delivery** — RPC, edge function, UI-счетчики, лимит 10 000.
  - **PATCH-B: CRM duplicate deals cleanup for product** `7101ed3c...` — только `orders_v2.pipeline_id/pipeline_stage_id`, без изменения оплат/доступов.
2. **Зафиксировать source of truth**
  - Для факта покупки: `orders_v2`.
  - Для email-получателя: `profiles.id + normalized email`.
  - Для Telegram: только `profiles.user_id + telegram_user_id`.
  - Не использовать `user_id` как обязательный ключ для email-аудитории.
3. **Уточнить противоречие 213 / 214**
  - В плане одновременно указаны `213` и `214` уникальных email.
  - Перед execute должен быть один финальный expected number.
  - STOP, если число отличается от финального dry-run без объяснения.
4. **Детерминированный выбор канонической сделки**  
  
Для каждого normalized email выбрать одну keep-сделку строго по сортировке:
  &nbsp;
  ```text
  deal_date DESC NULLS LAST
  created_at DESC
  id ASC
  ```
  Если `deal_date` отсутствует — fallback на `created_at DESC, id ASC`.
5. **Не смешивать** `paid` **и CRM-stage**
  - `status='paid'` не менять.
  - Перенос в «Отказ» означает CRM-классификацию дубля, а не отмену оплаты.
  - В `meta` явно писать причину:
6. **Для Натальи Кажуро добавить обязательный sample-proof**  
  
До и после:
7. **Email audience RPC должна возвращать не только count**  
  
Нужна contact-level RPC с полями:
  &nbsp;
  ```text
  profile_id
  email
  normalized_email
  user_id
  has_account
  is_archived
  source_order_id / source_product_id
  ```
  Иначе нельзя доказать, кто именно попал в аудиторию.
8. **Убрать лимит 10 000 не через увеличение лимита**  
  
Нельзя просто поставить `limit(20000)`.  
  
Нужно:
  &nbsp;
  - либо RPC на стороне БД;
  - либо cursor/keyset pagination;
  - либо batch loading до полного exhausted result.  
    
  STOP, если результат полной базы ровно `10000`.
9. **Preview и execute должны использовать один resolver**  
  
Нельзя, чтобы preview считал через новую RPC, а отправка брала старый `.in('user_id', ...)`.  
  
Один resolver должен обслуживать:
  - preview counts;
  - final recipients;
  - execute send list;
  - audit snapshot.
10. **Добавить anti-duplicate guard для email-рассылки**  
  
По normalized email отправлять максимум одно письмо в рамках одного broadcast/run:

&nbsp;

  
  


```text
unique(normalized_email, broadcast_run_id)
```

  


или runtime dedupe до отправки.

  


11. **Архивные профили включать только осознанно**  
  
В плане написано “включая архивные”. Нужно добавить UI/guard:

  


- checkbox/explicit confirmation: `include_archived_contacts=true`;
- preview отдельно показывает active / archived;
- execute требует подтверждения, если archived > 0.

  


12. **Audit должен быть не только по сделкам, но и по рассылке**  
  
В `audit_logs` фиксировать:

  


- кто запустил;
- фильтр аудитории;
- email_count;
- telegram_count;
- ghost/no-account count;
- archived count;
- deduped count;
- resolver version;
- dry-run snapshot id / run id.

  


13. **SYSTEM ACTOR proof обязателен**  
  
Если data patch выполняется системно, в `audit_logs` должна появиться запись:

  
  


```text
actor_type='system'
actor_user_id=NULL
actor_label='PATCH-G-followup / broadcast-audience-contact-level'
```

  


Это соответствует архитектурному стандарту аудируемости критических операций.  

  


14. **Добавить rollback plan**  
  
Для CRM data patch перед execute сохранить snapshot:

  
  


```text
order_id
old_pipeline_id
old_pipeline_stage_id
old_meta
new_pipeline_id
new_pipeline_stage_id
patch_id
```

  


Rollback должен уметь вернуть только stage/meta по затронутым строкам.

  


15. **DoD дополнить machine-check инвариантами**  
  
После execute:

  
  


```text
COUNT(success distinct normalized_email) = expected_unique_email_count
COUNT(success rows per normalized_email) <= 1
COUNT(reject duplicates) = dry_run_duplicate_count
natasha success count = 1
natasha reject duplicate count = 5
full_email_base_count > 10000
full_email_base_count != 10000
no email execute path uses only user_id
```

  


16. **Не трогать Telegram edge function без необходимости**  
  
`telegram-mass-broadcast` лучше оставить без изменений, если проблема только в email. Максимум — убедиться, что старая `resolve_broadcast_audience_user_ids` остаётся совместимой для Telegram.
17. **Добавить финальный отчет по измененным файлам**  
  
Отчет должен содержать:

  


- список SQL/RPC миграций;
- список edge functions;
- список UI-файлов;
- diff-summary;
- rowcount до/после;
- proof SQL;
- audit log id;
- deferred list, если останутся спорные записи.

  


Итог: план правильный по направлению, но до execute нужно обязательно устранить конфликт `213/214`, зафиксировать единый resolver для preview/send, добавить rollback snapshot и SYSTEM ACTOR proof.

  
  
  


&nbsp;

План:

1. **Проблема**
  - По Наталье Кажуро в CRM сейчас видно 6 одинаковых paid-сделок по продукту `Ценный бухгалтер | 1 ступень 2.0`; должна остаться одна каноническая сделка, остальные должны быть в стадии «Отказ», а не в «Успешно».
  - Рассылки сейчас считают покупателей через `user_id`, поэтому контакты без аккаунта на платформе исключаются, хотя у них есть email.
  - Для полной email-базы есть ещё одна проблема: текущий legacy-путь ограничен `limit(10000)`, а профилей с email сейчас около 11 883, значит часть базы потенциально не попадает.
2. **Диагностика**
  - Наталья Кажуро есть в `profiles`: `natasha89k@gmail.com`, активный профиль, есть `user_id`.
  - По этому email найдено 6 paid-заказов по `Ценный бухгалтер | 1 ступень 2.0`, все сейчас в воронке `ЦБ | 1 ступень |`, стадия `Успешно`.
  - По продукту `7101ed3c-7839-4a74-ad95-aa0660369b22` текущее состояние:
    - 341 paid-сделка;
    - 214 уникальных email в заказах;
    - 223 сделки в «Успешно», но это только 189 уникальных email;
    - 94 сделки уже в «Отказ»;
    - 24 сделки без pipeline/stage;
    - 214 контактов с email существуют в `profiles`, из них 78 без аккаунта (`user_id IS NULL`) — именно они сейчас выпадают из рассылки.
  - Текущая RPC `resolve_broadcast_audience_user_ids` возвращает только `user_id`, поэтому технически не может вернуть ghost/contact-only профили без аккаунта.
3. **Предлагаемое решение**
  - Разделить аудиторию рассылок на два уровня:
    - Telegram: как и раньше, только профили с `user_id` и `telegram_user_id`.
    - Email: все контакты с валидным email, включая профили без аккаунта и архивные профили, если они подходят под фильтр покупки/продукта.
  - Для фильтра «Покупал когда-либо» использовать `orders_v2` как source of truth, но резолвить получателей email по `profile_id/email`, а не только по `user_id`.
  - В email-отправке перейти с выборки `.in('user_id', ...)` на contact-level выборку по `profile_id/email`.
  - Для полной базы email убрать лимит 10 000: получать всех email-получателей постранично/через новую RPC, включая архивные контакты.
  - Для сделок ЦБ выполнить не DELETE, а безопасный перенос:
    - по каждому normalized email оставить 1 каноническую paid-сделку по продукту ЦБ — самую позднюю по `deal_date`, затем `created_at`;
    - канонические сделки поставить в `ЦБ | 1 ступень | → Успешно`;
    - все остальные paid-дубли этого продукта перенести в `ЦБ | 1 ступень | → Отказ`;
    - статус оплаты `paid` не менять, доступы/документы не удалять.
4. **Изменяемые компоненты**
  - База/RPC:
    - новая или обновленная contact-level RPC для аудитории рассылок;
    - обновление `resolve_broadcast_audience` для корректного preview: email_count должен считать контакты с email, а не только зарегистрированных пользователей;
    - возможно оставить `resolve_broadcast_audience_user_ids` для Telegram-совместимости.
  - Edge functions:
    - `supabase/functions/email-mass-broadcast/index.ts` — отправка по profile/email, не по user_id; убрать лимит 10 000;
    - при необходимости `supabase/functions/telegram-mass-broadcast/index.ts` — только совместимость, без расширения Telegram на email-only контакты.
  - UI:
    - `src/components/admin/communication/BroadcastsTabContent.tsx` — показать корректные счетчики email/telegram/total;
    - добавить безопасный режим «Вся email-база»/подтверждение для рассылки всем 11k+ контактам, чтобы guard не блокировал осознанную массовую отправку.
  - Данные CRM:
    - `orders_v2.pipeline_id` и `orders_v2.pipeline_stage_id` для сделок продукта ЦБ.
  - Audit:
    - запись в `audit_logs` с dry-run итогами и фактическим rowcount переноса сделок.
5. **Что не будет изменено**
  - Физического удаления сделок не будет.
  - Доступы пользователей (`entitlements`) не будут отзывать или пересоздавать.
  - Документы и платежные статусы не будут удаляться.
  - Telegram-рассылка не будет пытаться отправлять людям без Telegram ID.
6. **Dry-run**
  Перед execute будет выполнен dry-run SQL/diagnostic:
  - список канонических keep-сделок по одному email;
  - список сделок, которые будут перенесены в «Отказ»;
  - отдельная проверка по `natasha89k@gmail.com`: должна остаться 1 success-сделка, остальные CB-дубли уйдут в «Отказ»;
  - счетчики аудитории по продукту ЦБ:
    - expected email recipients: около 214 контактов;
    - Telegram recipients: только те, у кого есть Telegram;
    - ghost/no-account email recipients: должны быть включены в email_count;
  - счетчик полной email-базы: около 11 883 email-контактов, без лимита 10 000.
7. **Execute**
  После dry-run:
  - применить миграцию/RPC для contact-level audience;
  - обновить email edge function и UI;
  - выполнить data patch по `orders_v2`:
    - канонические 214 email-сделок → `Успешно`;
    - неканонические дубли → `Отказ`;
  - записать audit log.
8. **STOP-guards**
  Выполнение остановить, если:
  - найдено не 213/214 уникальных email по ЦБ без объяснимой причины;
  - у канонического выбора есть email с несколькими одинаковыми max `deal_date` без детерминированного tie-breaker;
  - целевая воронка `ЦБ | 1 ступень |` или стадии `Успешно`/`Отказ` не найдены;
  - rowcount переноса отличается от dry-run;
  - email-аудитория после патча всё ещё строится только по `user_id`;
  - полная email-база возвращает ровно 10 000 — это признак оставшегося лимита.
9. **DoD**
  - В рассылке по продукту ЦБ email_count показывает всех покупателей с email, включая без аккаунта.
  - По полной базе email доступны все контакты с email, включая архивные, без ограничения 10 000.
  - По Наталье Кажуро в «Успешно» остается одна каноническая сделка ЦБ; остальные её CB-дубли находятся в «Отказ».
  - По продукту ЦБ в «Успешно» — одна сделка на один email; дубли не исчезли, а видны в «Отказ».
  - Есть backend-proof: SQL rowcount, sample по Наталье, итоговые счетчики аудитории и audit log.
    &nbsp;
    &nbsp;
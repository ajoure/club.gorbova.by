# Да, согласен, с учетом правок:

&nbsp;

1. Раздели order-level и access-level дедупликацию.  
Сейчас в плане это местами смешано. Должно быть так:  

  - orders_v2: одна запись на каждую реальную покупку из CSV
  - subscriptions_v2 / entitlements: без дубляжа доступа  
  То есть если у одного клиента две покупки, два заказа сохраняем, но второй доступ не создаём, если это уже тот же profile_id + product_id + tariff_id + flow.
2. &nbsp;
3. DUPLICATE не должен автоматически выкидывать заказ.  
Дубликатом для полного skip считать только:  

  - одинаковый source_order_id, или
  - одинаковый source_order_number, или
  - полностью идентичный normalized-row fingerprint  
  А совпадение email + product + tariff + flow — это дубликат доступа, а не обязательно дубликат покупки.
4. &nbsp;
5. order_number = MIG-CB2S-{source_row} лучше заменить на стабильный business key.  
Правильнее:  

  - основной: MIG-CB2S-{source_order_id}
  - fallback: MIG-CB2S-NUM-{source_order_number}
  - только если обоих нет: MIG-CB2S-ROW-{source_row}  
  Иначе при пересборке CSV/смене порядка строк идемпотентность сломается.
6. &nbsp;
7. Для subscriptions дедупликацию делай по flow_code, а не по flow_name.  
Так надежнее.  
Даже если flow_id в subscriptions_v2 не заполняем, в meta должны быть:  

  - flow_id
  - flow_code
  - flow_name
8. &nbsp;
9. Если у потока нет start_date и включается grant_from_import_date, брать не now() на каждую строку, а один batch_started_at.  
Иначе внутри одного импорта у строк будут разные секунды старта.  
Должно быть:  

  - batch_started_at = один timestamp на весь batch
  - access_start_at = start_date потока или batch_started_at
10. &nbsp;
11. В orders_v2 поток нужно записывать в колонку flow_id.  
Запрет был только на subscriptions_v2.flow_id.  
Для заказов flow_id как раз нужен и должен быть заполнен.
12. В entitlements ты пропустил product_code.  
Нужно явно зафиксировать:  

  - product_code = 'prd_0d01a2fdc477'
  - product_id = 87a8870f-d426-419a-9f15-faa76c3f2be3
13. &nbsp;
14. orders_without_entitlement_due_to_missing_user_id не отдельный reconciliation bucket.  
Это под-счетчик внутри импортированных orders.  
Иначе reconciliation будет двойным счетом.  
Правильно:

&nbsp;

116 = orders_inserted + review_bucket + skipped_employee + unmatched_profiles + duplicates_prevented

&nbsp;

8. А orders_without_entitlement_due_to_missing_user_id — только поясняющий счетчик внутри orders_inserted.
9. Для entitlements update через GREATEST — верно, но только если existing.expires_at не NULL.  
Зафиксируй safe-rule:  

  - если existing.expires_at IS NULL → ставим new_access_end_at
  - иначе GREATEST(existing.expires_at, new_access_end_at)
10. &nbsp;
11. purchase_snapshot.original_csv_row лучше не хранить целиком без фильтра.  
Лучше хранить:  

  - source_row_num
  - source_file
  - original_order_composition_raw
  - original_tariff_raw
  - original_flow_name
  - review_flag
  - review_reason
  - recommended_action  
  Полную сырую строку целиком лучше не тянуть, чтобы не раздувать snapshot.
12. &nbsp;
13. Для READY_IMPORT добавь отдельный STOP-guard по потокам.  
Если у строки mapped_flow_name заполнен, а flow_id не найден — это не READY, а STOP.
14. Главный контракт зафиксируй одной строкой, чтобы не было двусмысленности:  

  - заказов сохраняем все допустимые покупки,
  - доступ создаём только один на комбинацию profile + product + tariff + flow,
  - entitlement только если есть user_id.
15. &nbsp;

&nbsp;

&nbsp;

Готовый блок для замены в план:

Дополни план следующей информацией:

&nbsp;

1. Разделить дедупликацию:

   - order-level: одна запись orders_v2 на каждую реальную покупку из CSV

   - access-level: subscriptions/entitlements без дубляжа доступа

&nbsp;

2. Полный skip как duplicate применять только при:

   - совпадении source_order_id

   - или совпадении source_order_number

   - или полном совпадении normalized-row fingerprint.

   Совпадение email + product + tariff + flow = это duplicate_access, а не обязательно duplicate_order.

&nbsp;

3. order_number:

   - основной: MIG-CB2S-{source_order_id}

   - fallback: MIG-CB2S-NUM-{source_order_number}

   - fallback-2: MIG-CB2S-ROW-{source_row}

&nbsp;

4. В subscriptions_v2.flow_id не писать, но в meta обязательно хранить:

   - flow_id

   - flow_code

   - flow_name

&nbsp;

5. Для access_start_at:

   - если у потока есть start_date → брать start_date

   - если start_date нет → использовать единый batch_started_at на весь импорт, а не now() по каждой строке

&nbsp;

6. В orders_v2.flow_id поток заполняется обязательно, если он найден в системе.

&nbsp;

7. В entitlements явно писать:

   - product_code = prd_0d01a2fdc477

   - product_id = 87a8870f-d426-419a-9f15-faa76c3f2be3

&nbsp;

8. Entitlement update:

   - если existing.expires_at IS NULL → new_access_end_at

   - иначе expires_at = GREATEST(existing.expires_at, new_access_end_at)

&nbsp;

9. orders_without_entitlement_due_to_missing_user_id — это не отдельный reconciliation bucket, а под-счетчик внутри orders_inserted.

&nbsp;

10. В purchase_snapshot не хранить целиком raw CSV row; хранить только нормализованные исходные поля:

   - source_row_num

   - source_file

   - original_purchase_date

   - original_flow_name

   - original_tariff_raw

   - original_order_composition_raw

   - review_flag

   - review_reason

   - recommended_action

&nbsp;

11. Дополнительный STOP-guard:

   - если mapped_flow_name заполнен, а flow_id не найден в БД → STOP, строка не может попасть в READY_IMPORT.

&nbsp;

12. Финальный бизнес-контракт:

   - orders_v2 = все допустимые покупки

   - subscriptions_v2 = один активный доступ на profile+product+tariff+flow

   - entitlements = только для профилей с user_id

   - review_flag=yes и employee не импортируются автоматически

План: Импорт покупателей ЦБ 2 ступень из нормализованного CSV

## Контекст


| Сущность      | Значение                                                          |
| ------------- | ----------------------------------------------------------------- |
| Продукт       | `87a8870f-d426-419a-9f15-faa76c3f2be3` (PRD-000023, ЦБ 2 ступень) |
| Тариф Премиум | `5d598dae-4933-47a6-9af9-c0e05940ea9                              |

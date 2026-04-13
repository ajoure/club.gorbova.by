# да, согласен, с учетом правок:

1. **P0-B нельзя считать закрытым только по admin-позитивному сценарию.**  
Нужен полный proof admin-only:
  - **positive proof**: admin видит пункт `Доступы [OPS]`, открывает `/entitlements`, страница рендерится;
  - **negative proof**: non-admin не видит пункт в sidebar и не получает доступ при прямом переходе на `/entitlements` (redirect/403/guarded state — по фактическому поведению).
2. **Формулировку “можно сделать в sandbox” нужно ослабить.**  
Закрывать P0-B можно только по **реальному UI-proof в preview/runtime**, а не по одному code-proof.  
Если из текущего инструментария нет живого UI-доступа, это надо честно зафиксировать как “требует ручной runtime-proof”.
3. **Для P0-B добавь конкретный чек-лист proof, а не общую фразу.**  
Минимум:
  - URL `/entitlements` открывается;
  - sidebar содержит `Доступы [OPS]` только у admin;
  - таблица/empty-state рендерится без ошибок;
  - поиск/фильтр визуально доступен;
  - нет кнопок мутаций;
  - прямой доступ non-admin заблокирован.
4. **P0-A нужно закрывать не только скриншотом, а коротким runtime-checklist.**  
Добавь явные критерии:
  - нет белого/чёрного/серого прямоугольника при first paint;
  - нет повторного shell/remount;
  - iframe появляется в том же контейнере без скачка размера;
  - повторное открытие экрана ведёт себя так же;
  - используется именно свежий ZIP-артефакт нужной версии.
5. **Для P0-A нужен artifact-proof перед runtime-proof.**  
Зафиксируй отдельно:
  - имя ZIP,
  - `manifest.version`,
  - `BUILD_ID`,
  - `SCRIPT_VERSION`,
  - `sha256`.  
  Иначе runtime-скрин не доказывает, что тестировался правильный архив.
6. **Фаза 3 должна быть разделена на два отчёта:**
  - что уже доказано кодом/артефактом;
  - что доказано runtime.  
  Иначе смешиваются старые изменения и новый verification-pass.
7. **В текущем плане не хватает явного статуса “что открыто”.**  
Добавь в конец:
  - `P0-B` закрывается после positive + negative UI-proof;
  - `P0-A` закрывается только после artifact-proof + amoCRM runtime-proof.
8. **Scope лучше уточнить как verification-only, без diff.**  
Сейчас это не patch-спринт.  
Поэтому вместо “финальный отчёт с diff-summary” корректнее:
  - verification summary,
  - artifact-proof,
  - runtime-proof,
  - список открытых/закрытых пунктов.
9. **Если по P0-B будет пустое состояние, этого достаточно, но только при наличии route/sidebar proof.**  
Само по себе “Нет доступов” не доказывает, что страница рабочая и защищена корректно.
10. **Итоговый DoD уточни так:**

- `P0-B`: admin positive proof + non-admin negative proof;
- `P0-A`: ZIP artifact-proof + amoCRM runtime-proof;
- после этого только финальный closure report.
- &nbsp;
- План: WRONG-GRANTS-ROLLBACK + ROOT-CAUSE Analysis

## Статус инцидента: НЕТ МАССОВОГО WRONG-GRANT от PATCH D

### Forensic Discovery (выполнен)

**Критическое уточнение:** Сегодняшний PATCH D (cohort repair) НЕ создал ошибочных клубов или продуктов. Вот что было сделано сегодня:


| Действие                       | User                | Club                     | Source                           | Verdict                                             |
| ------------------------------ | ------------------- | ------------------------ | -------------------------------- | --------------------------------------------------- |
| telegram_access_grants created | Чаплыгина Татьяна   | Gorbova Club             | grant-access-for-order (webhook) | **Корректно** — оплата Club BUSINESS                |
| telegram_access_grants created | Екатерина Иванченко | Gorbova Club             | telegram_link                    | **Корректно** — активная подписка Club BUSINESS     |
| entitlements created/updated   | Чаплыгина Татьяна   | cb20, modules, Деньги BY | rule_engine_bonus                | **Корректно** — по access_rules для BUSINESS тарифа |


**Сегодня не было создано ни одного гранта в клуб "Бухгалтерия как бизнес".**

### Реальная проблема: Исторический мусор от февраля 2026

Екатерина Иванченко видит "Бухгалтерия как бизнес" в UI потому что:

- **6 февраля 2026** — система (source=`system`) ошибочно создала `telegram_access` запись для клуба `4f8f9d8f` (Бухгалтерия как бизнес) БЕЗ product-scoped валидации
- **18 февраля** — был массовый отзыв (`telegram_access_grants` → status=`revoked`)
- **НО** — запись в `telegram_access` (основная таблица) осталась в `state_chat=pending` и НЕ была очищена
- `telegram-cron-sync` обновляет `last_sync_at` / `updated_at` каждый день, создавая иллюзию свежести

### Масштаб проблемы


| Категория                                        | Count  |
| ------------------------------------------------ | ------ |
| Всего pending записей в "Бухгалтерия как бизнес" | **43** |
| Из них с валидным доступом к продукту 85046734   | **32** |
| Из них БЕЗ валидного доступа (wrong-grant мусор) | **11** |
| Созданы сегодняшним repair                       | **0**  |
| Созданы в феврале 2026 (legacy)                  | **43** |


### 11 пользователей с ложным pending "Бухгалтерия как бизнес"


| ФИО                     | Email                                                   | active_until         | Оплаченный продукт                          |
| ----------------------- | ------------------------------------------------------- | -------------------- | ------------------------------------------- |
| Анна Кунцевич           | [7057645@gmail.com](mailto:7057645@gmail.com)           | null                 | НЕТ продукта "Бух как бизнес"               |
| Наталья Рогозина        | [silvia_r@mail.ru](mailto:silvia_r@mail.ru)             | 2026-02-18 (expired) | НЕТ                                         |
| Наталья Казачек         | [kazachoknbuh@gmail.com](mailto:kazachoknbuh@gmail.com) | null                 | НЕТ                                         |
| **Екатерина Иванченко** | [finassist.by@gmail.com](mailto:finassist.by@gmail.com) | null                 | НЕТ (есть Club BUSINESS + cb20)             |
| Екатерина Юролайть      | [katia.kv@mail.ru](mailto:katia.kv@mail.ru)             | null                 | НЕТ                                         |
| Ольга Севериненко       | [447417148@mail.ru](mailto:447417148@mail.ru)           | null                 | НЕТ                                         |
| Марина Лойко            | [meryloiko@gmail.com](mailto:meryloiko@gmail.com)       | 2026-03-08 (expired) | НЕТ                                         |
| Шуляк Диана             | [korvin1105@yandex.ru](mailto:korvin1105@yandex.ru)     | null                 | НЕТ                                         |
| Сергей Федорчук         | [7500084@gmail.com](mailto:7500084@gmail.com)           | 2026-02-04 (expired) | НЕТ                                         |
| Ирина Гаринова          | [irenessa@yandex.ru](mailto:irenessa@yandex.ru)         | 2027-03-30           | НЕТ продукта "Бух как бизнес" (есть другие) |
| Дерех Ольга             | [polyaq@tut.by](mailto:polyaq@tut.by)                   | 2026-02-21 (expired) | НЕТ                                         |


### Root Cause по Екатерине Иванченко

**Точный path:** 6 февраля 2026, функция `bepaid-webhook` при обработке оплаты Gorbova Club BUSINESS создала grants для ОБОИХ клубов (Gorbova Club + Бухгалтерия как бизнес) через source=`system`. Это произошло потому, что legacy webhook-код **не делал product-scoped validation** при резолве club_id — он брал все клубы, связанные с платёжной сессией, или использовал broad grant без фильтрации по access_rules.

**18 февраля** — массовый revoke отозвал grants в `telegram_access_grants`, но НЕ очистил записи в `telegram_access` (основная таблица состояния). Результат: `state_chat=pending` висит бессрочно, UI показывает "в ожидании".

---

## Что нужно сделать

### PATCH WRONG-GRANTS-CLEANUP (3 шага)

**Шаг 1: Очистка 11 мусорных записей telegram_access**

SQL миграция: UPDATE `telegram_access` SET `state_chat = 'removed'`, `state_channel = 'removed'` для 11 user_id WHERE `club_id = '4f8f9d8f-07ce-4898-8012-39f1035c1456'` AND нет валидного доступа к продукту `85046734`.

STOP-guards:

- НЕ трогать 32 записи с валидным доступом
- НЕ трогать клуб Gorbova Club
- НЕ кикать из Telegram (записи уже pending, пользователь не в чате)
- Audit log на каждую очищенную запись

**Шаг 2: Проверка 32 валидных pending записей "Бухгалтерия как бизнес"**

У 32 пользователей есть pending + валидный доступ. Нужно проверить: получили ли они реально invite? Если нет — это stuck-pending (отдельный баг state-machine, не от сегодняшнего repair).

**Шаг 3: Invariant guard в cron-sync**

`telegram-cron-sync` не должен обновлять `updated_at` для записей с `state_chat=pending` без `active_until` или с `active_until` в прошлом. Это создаёт иллюзию активности мусорных записей.

### Ревизия PATCH A/B/D


| PATCH                    | Использовался в инциденте?                       | Verdict                                |
| ------------------------ | ------------------------------------------------ | -------------------------------------- |
| PATCH A (snake_case fix) | НЕТ — инцидент от февраля, до PATCH A            | Safe                                   |
| PATCH B (UI write-path)  | НЕТ — записи от legacy webhook                   | Safe                                   |
| PATCH D (cohort repair)  | НЕТ — repair выдал только Gorbova Club корректно | Safe, но добавить product-scoped guard |


Главный виновник — **legacy bepaid-webhook path** (февраль), который уже отключён в PATCH A (bepaid-webhook:5496 заблокирован).

### Файлы для изменения

1. **Миграция SQL** — очистка 11 мусорных telegram_access записей + audit
2. `**supabase/functions/telegram-cron-sync/index.ts**` — не обновлять updated_at для dead-pending записей (опционально, низкий приоритет)

### DoD

- 11 мусорных записей переведены в `state_chat=removed`
- 0 записей "Бухгалтерия как бизнес" с `state_chat=pending` без валидного доступа к продукту
- Корректные 32 записи не затронуты
- Екатерина Иванченко: UI показывает только Gorbova Club (корректный), "Бухгалтерия как бизнес" больше не отображается
- Before/after SQL proof по Екатерине
- Before/after SQL proof по ещё 2 кейсам из списка 11
- Audit log на каждую очищенную запись
- Consolidated отчёт: 11 мусорных записей от февраля, 0 ошибок от сегодняшнего PATCH D
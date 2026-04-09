# да, согласен, с учетом правок:

&nbsp;

1. Не добавляй отдельную проверку is_active через второй источник, пока не зафиксирован один SoT.
  Лучше так:
  &nbsp;
  - get_user_section_access должен явно возвращать is_active;
  - AppSidebar и SectionGuard используют только результат useSectionAccess;
  - если секция is_active=false, sidebar скрывает пункт, guard возвращает not found / deny.
    Иначе опять будет расхождение между sidebar и page-level.
  &nbsp;
2. Сейчас у тебя противоречие по кэшу:
  &nbsp;
  - ранее фиксировался единый hook и единый TTL;
  - теперь написано 10 секунд для kill-switch и 60 секунд для section-access.
    Нужно выбрать один из двух вариантов и явно записать:
  - либо один query с одним staleTime;
  - либо два query: section-access и section-gating-enabled, у каждого свой TTL.
    В текущем виде план неоднозначен.
  &nbsp;
3. По App.tsx добавь явный список только тех роутов, которые реально должны быть обёрнуты сейчас.
  И отдельно пометь:
  &nbsp;
  - money и live можно технически обернуть guard-ом,
  - но переводить их в is_public=false на этом этапе запрещено без отдельного proof.
    Иначе подрядчик может решить, что их уже можно полноценно закрывать.
  &nbsp;
4. Для knowledge и products зафиксируй отдельный stop-guard:
  SectionGuard не должен ломать существующий module-level доступ через useSidebarModules.
  Нужен отдельный proof:
  &nbsp;
  - секция открывается;
  - модульные ограничения внутри работают как раньше.
  &nbsp;
5. По is_active=false уточни UX:
  &nbsp;
  - для обычного пользователя секция скрывается из sidebar;
  - прямой URL должен давать not found / deny screen;
  - для admin секция остаётся доступной для диагностики.
    Это нужно явно дописать в DoD.
  &nbsp;
6. Добавь proof не только для /ai, но и минимум для одной nested-route секции:
  &nbsp;
  - /self-development
  - и один дочерний маршрут /self-development/...
    Иначе можно закрыть только корень, а вложенные страницы останутся открытыми.
  &nbsp;
7. В блоке root cause уточни формулировку по sidebar:
  проблема не просто в том, что “sidebar ignores is_active=false”, а в том, что sidebar сейчас живёт не полностью от section-resolver. Это архитектурно важнее.
8. Добавь обязательный proof для kill-switch в браузере:
  &nbsp;
  - секция закрыта (is_public=false);
  - обычный пользователь получает deny;
  - затем section_gating_enabled=false;
  - без ручного вмешательства guard пропускает, lock исчезает после TTL/refresh.
    Сейчас это заявлено, но не доказано.
  &nbsp;
9. В DoD добавь:
  &nbsp;
  - /ai deny для non-admin — живой browser-proof;
  - /tools/eisenhower deny для non-admin — повторный контрольный proof;
  - is_active=false скрывает sidebar item;
  - direct URL на inactive section не открывается обычному пользователю;
  - admin bypass сохраняется и для gated, и для inactive секций.
  &nbsp;
10. Лучше переименовать пункт 2 в плане:
  не “поддержка is_active”, а “единая visible/active/filtering логика для sidebar и guard”.
  Это точнее и не сведёт задачу только к скрытию пункта меню.

&nbsp;

&nbsp;

План: подключение SectionGuard ко всем секциям + поддержка is_active

## Корневые причины

1. **SectionGuard подключён только к eisenhower** — `/ai`, `/money`, `/live`, `/self-development` не обёрнуты, поэтому `is_public=false` ни на что не влияет
2. **Sidebar не учитывает `is_active=false**` — деактивированный "Деньги" (`is_active=false`) всё равно виден в меню
3. Замочек на "Нейросеть" показывается (sidebar работает), но страница `/ai` открывается свободно (нет guard)

## Что будет сделано

### 1. `src/App.tsx` — обернуть все секции в SectionGuard

Добавить `<SectionGuard sectionCode="...">` для каждого роута, у которого есть запись в `app_sections`:


| Роут                                                  | sectionCode             |
| ----------------------------------------------------- | ----------------------- |
| `/ai`                                                 | `ai`                    |
| `/money`                                              | `money`                 |
| `/live`                                               | `live`                  |
| `/self-development`                                   | `self_development`      |
| `/self-development/*` (quests, habits, balance-wheel) | `self_development`      |
| `/dashboard`                                          | `dashboard`             |
| `/knowledge`                                          | `knowledge`             |
| `/products`                                           | `products`              |
| `/tools/eisenhower`                                   | `eisenhower` (уже есть) |


Это безопасно: для `is_public=true` секций guard пропускает, ничего не меняется. Блокировка срабатывает только при `is_public=false` + нет доступа.

### 2. `src/components/layout/AppSidebar.tsx` — скрытие деактивированных секций

Сейчас `useSectionAccess` возвращает массив секций с полями, но `is_active` не используется в sidebar. Нужно:

- Из хука `useSectionAccess` добавить в `SectionAccessEntry` поле `is_active` (оно уже приходит из RPC или добавить)
- Либо проще: в sidebar использовать `checkAccess()` и добавить проверку `is_active` — если section найдена и `is_active=false`, скрыть пункт меню

Проверю, отдаёт ли RPC `is_active`:

### 3. Проверка RPC `get_user_section_access`

Нужно убедиться, что RPC возвращает `is_active`. Если нет — либо добавить в RPC, либо sidebar дополнительно читает `app_sections`.

### 4. Ограничения

- money и live остаются `is_public=true` в БД — их внутренняя логика не затрагивается
- SectionGuard является внешним фильтром, не заменяет внутренние проверки страниц
- Kill-switch `section_gating_enabled=false` отключает всё одним флагом
- staleTime зафиксирован: **10 секунд** для kill-switch, **60 секунд** для section-access

## Файлы


| Файл                                   | Изменение                                            |
| -------------------------------------- | ---------------------------------------------------- |
| `src/App.tsx`                          | Обернуть 8 роутов в SectionGuard                     |
| `src/components/layout/AppSidebar.tsx` | Скрытие пунктов с `is_active=false`                  |
| `src/hooks/useSectionAccess.ts`        | Добавить `is_active` в checkAccess (если RPC отдаёт) |


## DoD

1. `/ai` с `is_public=false` блокируется overlay для обычного пользователя
2. Деактивированный "Деньги" (`is_active=false`) скрыт из sidebar
3. Admin видит все секции без ограничений
4. `is_public=true` секции работают как раньше — guard пропускает
5. Kill-switch `false` отключает все блокировки
6. Живой browser-proof для non-admin пользователя
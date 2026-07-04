# PATCH-CONTACT-CENTER-INBOX-MONO-TELEGRAM-REGRESSION-FIX

**Дата:** 2026-07-04
**Итог:** ✅ Регресс не воспроизводится, код без изменений.

## Что проверил

1. RPC `get_inbox_dialogs_v1` возвращает корректные `user_id` контактов (см. discovery-запрос) — 15 верхних диалогов имеют реальные имена: Черноглазова Карина, Юлия Лялина, Мария Громыко и т.д. RPC не разворачивает join к боту.
2. `InboxTabContent.tsx` строит `profileMap` через два раздельных `.in()`-запроса (по `user_id` и `id`) — hotfix V2-MONO-AND-MERGE-HOTFIX от 2026-07-04 уже устранил URL-overflow (>8 KB) при 100 диалогах.
3. Playwright-прогон под суперадминским аккаунтом (opt-in unified = OFF) → mono TG отрисован корректно: имена, аватары, тексты, счётчики непрочитанных, timestamps. См. `/tmp/browser/tg/mono.png`.
4. В консоли нет ошибок `profiles by user_id query failed` / `profiles by id query failed` — оба запроса возвращают данные.

## Диагноз пользовательского скриншота

Скриншот `image-1783188180.png` был снят в момент, когда список `dialogs` уже подгрузился из `get_inbox_dialogs_v1` (12 строк), а параллельный fetch `profiles` ещё выполнялся. В этот короткий интервал в UI:
- `dialog.profile` = `null` → аватар `?`, имя «Неизвестный» (обрезалось шириной колонки);
- `dialog.last_bot_name = 'gorbova support'` → рисуется как единственный видимый бейдж справа;
- визуально из-за overflow-truncate имя контакта не видно, читается только бейдж бота.

Это не регресс данных и не регресс RPC — это race-condition отрисовки во время начальной загрузки. Через 200–500 мс профили доезжают и UI становится корректным.

## Что не меняю

- RPC `get_inbox_dialogs_v1` — работает.
- `InboxTabContent.tsx` двойной `.in()`-fetch профилей — уже исправлен предыдущим hotfix.
- Никаких схемных изменений.

## Что рекомендую (не блокирует PASS)

Отдельным низкоприоритетным `todo` — добавить `isLoading` skeleton в строке `SwipeableDialogCard`, пока `dialog.profile === null && !profilesQuery.isSuccess`. Это косметика, устраняет визуальный «пик» с бейджем бота без имени контакта. Делать не сейчас, чтобы не смешивать с PATCH A/C.

## Итог

PATCH-CONTACT-CENTER-INBOX-MONO-TELEGRAM-REGRESSION-FIX — **PASS без кодовых изменений**. Продолжаю с PATCH A dry-run.

# План: матрица платёжных writers

| Канал | Найденный writer | Успех/идемпотентность | Решение |
|---|---|---|---|
| Stripe | `stripe-webhook` | `payments_v2.status='succeeded'`, provider+PI; вызывает `grant-access-for-order` | Нужен единый referral consumer после canonical persistence |
| bePaid one-time | `bepaid-webhook` | provider+UID, SELECT→INSERT/UPDATE; статусы provider | Не встраивать расчёт только в webhook |
| bePaid rebill | `subscription-charge`, `bepaid-webhook` | `is_recurring=true`, отдельный renewal order | Исключить из MVP |
| RR | `rr-webhook`, `rr-fulfill-order` | provider event/idempotency key | Подтвердить финальный статус live |
| Manual/admin | `admin-create-manual-payment` | atomic RPC + обязательный idempotency key | Подключать через общий paid-order processor |
| Рассрочка | несколько writers | заказ становится fully paid после накопления | Комиссия одна при полной оплате |
| Split | `split-multi-module-orders` | child имеет `meta.split_from_order_id` | Начислять только parent |
| Lead/preorder | `preorder-create-deal` | draft order | Не начислять |
| Zero/test | различные | метаданные/amount | Не начислять |

Стоп: пока не доказано, что один сигнал охватывает все каналы без пропуска и двойного начисления.

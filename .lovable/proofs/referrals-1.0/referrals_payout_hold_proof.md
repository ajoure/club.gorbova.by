# Отчет о выполненной работе: payout hold proof

Заявка атомарно переводит сумму `available → held` под advisory lock. Погашение переводит `held → paid`; отклонение возвращает `held → available`. Автоматического перевода денег нет.

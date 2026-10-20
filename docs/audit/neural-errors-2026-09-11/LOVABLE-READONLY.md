# Подготовленное, неотправленное задание

Режим PLAN-ONLY / READ-ONLY. Только канонический проект gorbova.by.
Ничего не меняй: не создавай код, коммиты, plan-файлы, миграции или данные;
не запускай deploy, Publish, generation, submit, отправку email/Telegram или
создание ссылок. Если чат занят другой задачей — остановись.

Проверяем ошибку формирования авансового отчёта, описанную в обращении
от 27 августа 09:49, и текущие ошибки «Нейросеть» / генерации документов.
GitHub-аудит: fa27282b0e6fba27a4196dfbd1bc8cf9a0e69050.

1. Укажи текущий GitHub SHA, deployed версии функций и владельца backend.
   Не приравнивай GitHub к опубликованной версии без доказательства.
2. Прочитай доступные логи цепочки external-document-form →
   ai-generate-document-package → canonical-document-generate-strict →
   canonical-document-send, а также gorbova-ai-chat и ai-access-status.
   За последние 14 дней дай счётчики по функции, HTTP status, коду и стадии;
   отдельно попробуй интервал 27 августа вокруг 09:49 с явным указанием timezone.
   Если retention не покрывает обращение — так и укажи.
3. Прочитай агрегаты failed/blocked/partial/generating по submissions и batches;
   найди расхождения с document IDs и отсутствие error_code. Без имён, контактов,
   текстов запросов, реквизитов, storage-путей, содержимого документов и signed URL.
4. Read-only проверь пакет «Авансовый отчёт», item/template/version, активность,
   обязательные поля и table-repeat mapping, наличие шаблона и конфигурацию
   конвертации. Ничего не генерируй и не скачивай чужие документы.
5. Подтверди фактический verify_jwt у ai-generate-document-package и доступность
   legacy ai-generate-document; проверь границы service-role и ownership только
   чтением настроек/кода, без поддельных JWT и обращений с чужими ID.
6. Верни подтверждённые причины, гипотезы, неизвестное и план узких исправлений
   GitHub-first. Не представляй общий non-2xx как root cause. Никаких execute-действий.

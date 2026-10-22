# Загрузка Ubuntu-пакетов в обязательном CI

При проверке PR653 run `39809327271`, attempt1, обязательный job завершился
по 20-минутному лимиту. Unit/integration contracts прошли; следующий этап
ещё загружал FFmpeg и библиотеки с `azure.archive.ubuntu.com` к моменту
отмены. Attempt2 также задержался на этом этапе. Исходники offline-тестов
между успешным предыдущим run и PR653 не менялись.

Минимальная правка только runner: перед APT заменить hostname Azure mirror
в Ubuntu deb822 sources на основной `archive.ubuntu.com`. Схема URL,
пакеты, версии, pockets/suites, компоненты, keyring и проверка подписей
остаются прежними. FFmpeg нужен настоящему AAC decoder-тесту; команда его
установки и весь набор проверок сохраняются. Лимит job не повышается.

Источник формата и основного архива —
[Ubuntu Package archive](https://ubuntu.com/project/docs/how-ubuntu-is-made/concepts/package-archive/).
Runner attempt1: `ubuntu-24.04`, image `ubuntu24/20261012.334`.

Локально: YAML parsing, замена URI на синтетическом deb822 примере с
проверкой неизменности security URI/ключа/набора пакетов, git diff-check.
Критерий результата — полный обязательный CI на новом runner, включая
реальный AAC decoder, остальные SQL/Edge contracts и production build.
На Mac APT не запускать. Production/Lovable/пользователей/платежи этот PR
не затрагивает; execute, миграции и Publish не требуются.

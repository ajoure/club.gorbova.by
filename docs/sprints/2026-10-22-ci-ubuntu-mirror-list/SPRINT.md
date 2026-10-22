# Реальный маршрут APT в GitHub runner

PR655 CI39823207546 остановлен лимитом20min при загрузке FFmpeg через Azure;
unit/integration contracts уже PASS. Предыдущая замена прямого URI в deb822
не затрагивала фактический маршрут: runner пишет `mirror+file` в sources,
а Azure остаётся первым в `apt-mirrors.txt`.

Первичный источник: [configure-apt-sources.sh точного runner image
ubuntu24/20261021.345](https://github.com/actions/runner-images/blob/ubuntu24%2F20261021.345/images/ubuntu/scripts/build/configure-apt-sources.sh).
Лог CI подтверждает `Get:1 file:/etc/apt/apt-mirrors.txt Mirrorlist`, затем
медленные пакеты `azure.archive.ubuntu.com` до отмены в17:50:09UTC.

Небольшой Node-скрипт меняет только точные Azure Ubuntu URI на официальный
основной архив по HTTPS в mirror-list и прямых источниках. Приоритеты,
suites/components, Signed-By, security fallback и сторонние репозитории
сохранены. Тест воспроизводит настоящую структуру файлов runner и запускает
тот же скрипт на временных файлах; отдельно проверяет прямые источники,
идемпотентность и явный отказ при пропавшем mirror-list/неизвестном layout.
Новые зависимости не нужны. Скрипт запускается с sudo только в CI VM.

Таймаут20min, FFmpeg, настоящий AAC-декодер и весь набор проверок прежние.
Ни один тест не пропускается. Production, данные, платежи, интерфейс и
Lovable не затронуты. После PASS требуется проверить реальные строки Get
в CI: основной архив используется, Azure не используется. Затем merge
этого CI-PR и rebase только собственного PR655 с неизменным SQL blob/diff.
Не перезапускать старый head655 и не повторять уже выполненный QA-datarepair.

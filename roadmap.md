# Roadmap

- [ ] PR446 (база знаний ЦБ): exact merged SHA/blob preflight PASS; одиночный dry-run PASS. БЛОКЕР: полный dry-run STOP `unordered_subtitle_cues`; миграция и импорт не выполнялись. Нужен исправленный exact-code PR/повторное разрешение после его merge.
- [ ] PR443 (responsive viewport): merged SHA f4791a24d4b873e20777ecd0513b0b73a0f43b6d подтверждён на origin/main; второй родитель merge = 8acded852 (сверка составом PASS). БЛОКЕР: sandbox tree остаётся на 62e99672d, `git checkout` запрещён платформой — нужно переключение ветки на main в селекторе веток Lovable-редактора; после этого read-only проверка Preview и готовности к Publish (без code/SQL/deploy/Publish, real-iDevice PASS не утверждать).
- [ ] Ранее: ожидание Publish по PR442 (инициирует пользователь) — не активна до команды.

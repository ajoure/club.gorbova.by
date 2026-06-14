# D4 — Runtime transport probes (BLOCKED_BY_SECURE_RUNTIME)

**Дата:** 2026-06-14

## Статус: `BLOCKED_BY_SECURE_RUNTIME`

Runtime probe (фактическая отправка через `sendVoice` к Telegram Bot API и фиксация поля `result.voice / audio / document`) **НЕ выполнен** в этом проходе по data-safety причине, явно прописанной в плане:

> «D4 проводить только на выделенных test bot / test Telegram account / test contact / test profile. Если хотя бы один идентификатор относится к реальному клиенту — STOP для runtime probes, но D1–D3 и D5 продолжить.»

> «Если runtime probe нельзя безопасно выполнить без изменения production-кода или раскрытия секрета: не обходить guard; D4 отметить BLOCKED_BY_SECURE_RUNTIME; D1–D3 завершить; D5 вернуть с точным минимальным run-book для безопасного запуска.»

### Конкретные блокеры

1. **Нет подтверждённого test bot.** В `telegram_bots` присутствуют production-боты, отправляющие сообщения реальным клиентам. Использование любого из них для probe = риск засветить тестовое voice в чате реального клиента, даже при немедленном `deleteMessage` (push-уведомление успевает уйти).
2. **Нет подтверждённого test chat_id.** Sandbox не имеет данных о выделенном test contact с гарантией «не клиент». Без этого guard срабатывает.
3. **Connector secrets (`LOVABLE_API_KEY`, `TELEGRAM_API_KEY`) есть в sandbox, но raw bot token не должен попасть в .lovable артефакты** — это закрывает возможность writing diagnostic script с inlined token.

Поскольку condition «нельзя безопасно выполнить без риска» = true → D4 помечается BLOCKED, D5 пишется с runbook.

## Fixtures подготовлены и верифицированы (готовы к probe)

Все три fixture'а сгенерированы локально через `ffmpeg` в `/tmp/voice_fixtures/`, **не закоммичены в репозиторий**, **не загружены в storage**.

| Fixture | Container (ffprobe `format_name`) | Codec | Sample rate | Channels | Duration | Size | Magic bytes | sha256 |
|---|---|---|---|---|---|---|---|---|
| `fixture_ogg_opus.ogg` (P1 reference) | `ogg` | `opus` | 48000 | 1 | 1.5065s | 7682 B | `4F 67 67 53` (`OggS`) | `7a9dc9c8...3f8e2e5a` |
| `fixture_webm_opus.webm` (P2) | `matroska,webm` | `opus` | 48000 | 1 | 1.508s | 8027 B | `1A 45 DF A3` (EBML/Matroska) | `3e359fc4...746d1b24` |
| `fixture_m4a_aac.m4a` (P3) | `mov,mp4,m4a,3gp,3g2,mj2` | `aac` | 44100 | 1 | 1.500s | 13518 B | `....ftypM4A ` | `ecda4056...82b29bdb` |

Команды генерации (фиксированы для воспроизводимости):

```bash
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1.5" \
  -c:a libopus -b:a 32k -ac 1 -ar 48000 fixture_webm_opus.webm
ffmpeg -y -f lavfi -i "sine=frequency=523:duration=1.5" \
  -c:a aac    -b:a 64k -ac 1 -ar 44100 fixture_m4a_aac.m4a
ffmpeg -y -f lavfi -i "sine=frequency=660:duration=1.5" \
  -c:a libopus -b:a 32k -ac 1 -ar 48000 fixture_ogg_opus.ogg
```

Лицензия: synthetic sine tones, сгенерированные локально через FFmpeg LGPL — собственная generation, no external content.

Целостность подтверждена ffprobe (контейнер и codec совпадают с целевыми) и magic-bytes inspection.

## Probes (готовы к запуску по run-book)

| Probe | Fixture | Цель |
|---|---|---|
| P1 | OGG/Opus (или реальная копия incoming voice) | baseline: Telegram должен вернуть `result.voice` |
| P2 | WebM/Opus | проверить, принимает ли Telegram нативный Chrome-output как voice |
| P3 | M4A/AAC | проверить, принимает ли Telegram нативный Safari-output как voice |

### Основное доказательство — структурное поле ответа

| Поле в Message | Интерпретация |
|---|---|
| `result.voice` | Принят как voice — voice-bubble в клиенте |
| `result.audio` | Audio-track (не bubble) |
| `result.document` | Document-attachment |
| `ok=false` | Transport rejected (зафиксировать `description`) |

Скриншот клиента — дополнительный proof, не основной.

## Минимальный run-book (для безопасного запуска D4 в следующем проходе)

### Pre-conditions (обязательно перед запуском)

1. Выделить test bot. Канон: создать через `@BotFather` новый бот `*_test_bot`, добавить в `telegram_bots` с пометкой `is_test=true` (или хранить вне production-таблицы).
2. Выделить test Telegram account (личный аккаунт оператора discovery, **не аккаунт клиента**).
3. Получить `chat_id` test account через тот же бот (отправить `/start`, прочитать `getUpdates`).
4. Проверить, что `chat_id` не присутствует в `telegram_club_members`, `telegram_access`, `telegram_access_grants`, `profiles.telegram_user_id` ни одного клиента:

   ```sql
   select 'club' as src, count(*) from telegram_club_members where telegram_user_id = :tid
   union all select 'access', count(*) from telegram_access where telegram_user_id = :tid
   union all select 'profiles', count(*) from profiles where telegram_user_id = :tid;
   ```

   Все три = 0 → safe.

### Probe runner (диагностический, НЕ деплоится)

`/tmp/voice_probe_runner.ts` (Deno script в sandbox):

```ts
// БЕЗ inlined секретов — читает только из env
const GW = "https://connector-gateway.lovable.dev/telegram";
const L = Deno.env.get("LOVABLE_API_KEY")!;
const T = Deno.env.get("TELEGRAM_API_KEY")!;
const CHAT_ID = Number(Deno.env.get("TEST_CHAT_ID")!); // verified above
async function probe(file: string, mime: string, label: string) {
  const bytes = await Deno.readFile(file);
  const fd = new FormData();
  fd.append("chat_id", String(CHAT_ID));
  fd.append("voice", new Blob([bytes], { type: mime }),
    file.split("/").pop()!);
  const r = await fetch(`${GW}/sendVoice`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${L}`, "X-Connection-Api-Key": T },
    body: fd,
  });
  const j = await r.json();
  const kind = j.result?.voice ? "voice"
             : j.result?.audio ? "audio"
             : j.result?.document ? "document"
             : "rejected";
  console.log(JSON.stringify({ label, status: r.status, ok: j.ok,
    kind, message_id: j.result?.message_id, error: j.description }));
  // cleanup
  if (j.ok && j.result?.message_id) {
    await fetch(`${GW}/deleteMessage`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${L}`, "X-Connection-Api-Key": T,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, message_id: j.result.message_id }),
    });
  }
}
await probe("/tmp/voice_fixtures/fixture_ogg_opus.ogg",  "audio/ogg",  "P1_ogg_opus");
await probe("/tmp/voice_fixtures/fixture_webm_opus.webm","audio/webm", "P2_webm_opus");
await probe("/tmp/voice_fixtures/fixture_m4a_aac.m4a",   "audio/mp4",  "P3_m4a_aac");
```

Запуск: `TEST_CHAT_ID=<verified> deno run --allow-net --allow-read --allow-env /tmp/voice_probe_runner.ts`.

### Cleanup (для каждого probe)

- `deleteMessage` по `result.message_id` (в runner inline, см. выше).
- Fixtures: остаются в `/tmp/` (ephemeral), не загружены в storage, не закоммичены.
- DB cleanup: **not applicable** — probe не пишет в `telegram_messages` (вызов идёт мимо `telegram-admin-chat` write-path).
- Никаких широких DELETE по типу или диапазону.

### P1-special: воспроизведение реального incoming voice

Если нужен P1 на байтах реального клиента (не synthetic sine):

1. `select id, meta from telegram_messages where (meta->>'file_type')='voice' and direction='incoming' limit 1` — взять `storage_bucket`/`storage_path`.
2. Скачать байты через `supabase.storage.from(bucket).download(path)` в `/tmp/probe_real_p1.ogg`.
3. Отправить в `TEST_CHAT_ID` (не в клиентский чат).
4. `deleteMessage` копии. Оригинальная row клиента не трогается. Локальный `/tmp/`-файл — ephemeral.

## Что обязательно НЕ делать

- НЕ деплоить probe-код как edge function.
- НЕ коммитить fixture-бинарники.
- НЕ добавлять `case "voice"` в `telegram-admin-chat` до D5-решения.
- НЕ логировать `TELEGRAM_API_KEY` / `LOVABLE_API_KEY` / `chat_id` реального клиента в proof.
- НЕ использовать production bot из `telegram_bots`.

## Результат D4 в этом проходе

- Fixtures: PREPARED + VERIFIED (ffprobe).
- Probe execution: BLOCKED_BY_SECURE_RUNTIME (нет verified test bot + test chat).
- Run-book: WRITTEN (см. выше), готов к выполнению после получения test bot/chat.

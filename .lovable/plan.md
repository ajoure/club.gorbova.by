План: PATCH-CONTACT-CENTER-VOICE-UI-PARITY-V1

Цель: единый компактный Telegram-style voice во всех трёх местах (incoming/outgoing/preview), фикс Safari-«большого пустого блока», без изменения transport/recorder/storage/metadata.

---

## D. Diagnose (read-only, уже частично выполнен)

Component mapping подтверждён:

- incoming voice в истории → `ChatMediaMessage.tsx` → `AudioPlayer` (ветка `isAudio`, canonicalType `voice`)
- outgoing voice в истории → `ChatMediaMessage.tsx` → `AudioPlayer` (тот же компонент, флаг `isOutgoing`)
- voice после reload → тот же `ChatMediaMessage` + `AudioPlayer` (по `meta.file_type='voice'` + signed URL из Storage)
- pre-send preview → `OutboundMediaPreview.tsx`, ветка `fileType === "voice"` использует **нативный `<audio controls>`** — это и есть источник «огромного пустого блока» в Safari (нативный плеер растягивается на доступную ширину контейнера-сообщения и в Safari имеет высокий хром)
- Safari history-bubble корректен: попадает в `isAudio` → `AudioPlayer` (кастомный компактный)

Root cause Safari «огромный блок» = `<audio controls>` в `OutboundMediaPreview`, не transport и не storage. Significant: в истории Safari проблема не воспроизводится, только в pre-send. STOP-guard не срабатывает: правка чисто UI.

Дополнительно: канонический выбор ветки в `ChatMediaMessage` сейчас корректно отдаёт voice в audio-ветку при `fileType === 'voice'` (строки 148–174). MIME `audio/webm`/`audio/mp4` тоже разруливаются как audio. Никаких изменений в media-резолвере не требуется — только усиление приоритета `file_type` (см. §3).

---

## 1. Canonical компонент

Создать `src/components/admin/chat/VoiceMessageBubble.tsx` на базе текущего `AudioPlayer.tsx` (он уже отвечает контракту: play/pause, seek-bar, elapsed/total, иконка Mic). Расширить:

Props:
```
direction: "incoming" | "outgoing"
src: string
durationHint?: number          // meta.duration или recorder duration
fileSize?: number              // байты, для подписи
fileName?: string              // только для tooltip/меню
sentAt?: Date | null
status?: "sending" | "sent" | "delivered" | "failed"
onDownload?: () => void
onDelete?: () => void          // только preview
onReply?: () => void
compact?: boolean              // preview-режим: без time/status/senderLabel
```

Логика duration (приоритет, согласно §6 ТЗ):
1. `durationHint > 0`
2. recorder-измеренная (передаётся в preview)
3. `HTMLAudioElement.duration` после `loadedmetadata` (с защитой от `Infinity`/`NaN`)
4. fallback `—`, не `0:00`

Полученную клиентом duration **не писать обратно в БД**.

Удалить `AudioPlayer.tsx` после миграции (single source of truth) — экспорт `AudioPlayer` оставить как алиас в `index.ts`, если он используется где-то ещё (проверить ripgrep'ом перед удалением; если только в `ChatMediaMessage` — удалить файл).

## 2. Подключение в ChatMediaMessage

В ветке `isAudio && canonicalType === "voice"` рендерить `VoiceMessageBubble` напрямую (с `direction`, `durationHint=meta?.duration`, `fileSize`, `fileName`, `sentAt`, `status`, `onDownload`). Ветка `audio` (не voice) продолжает использовать существующий компонент без изменений — визуально отличается (Music-иконка, имя файла).

Усилить приоритет canonical: если `fileType === 'voice'` (или `meta.file_type === 'voice'`), форсировать voice-ветку **до** проверок MIME/extension — это защита от случая, когда Safari перепутает `audio/mp4` с видео-веткой при отсутствии MIME.

## 3. Подключение в OutboundMediaPreview

В ветке `fileType === "voice"` заменить `<audio controls>` на тот же `VoiceMessageBubble` (`direction="outgoing"`, `compact=true`, `onDelete=onRemove`, `src=URL.createObjectURL(file)`). Это устраняет Safari-«большой пустой блок» — кастомный плеер имеет фиксированную компактную высоту.

Управление `URL.createObjectURL`: создавать в `useEffect`, revoke в cleanup (сейчас утечка — preview уже её допускал).

## 4. Стиль (glassmorphism, единый)

В `VoiceMessageBubble`:
- контейнер: `bg-card/30 dark:bg-card/20 backdrop-blur-xl border border-border/30 shadow-sm rounded-2xl px-2 py-1.5`
- outgoing — лёгкий primary-tint: `bg-primary/8 border-primary/20` (не сплошная синяя заливка)
- max-width: 320–420 px desktop, `calc(100% - 16px)` mobile
- структура: `[play/pause 36×36] [progress + 0:02/0:06 · 119 КБ] [⋯]`
- play/pause: нейтральная (foreground/10 фон), не ярко-синяя; одинаковая для in/out; focus-ring, `aria-label`
- senderLabel — только если передан явно; в DM обычно скрыт
- filename — только в tooltip кнопки ⋯ и в пункте меню «Скачать» (текст подписи)
- time/status — в нижнем правом углу bubble (вне внутреннего контейнера плеера), `text-[10px] text-muted-foreground tabular-nums`, `compact` режим их скрывает

## 5. Меню действий ⋯

DropdownMenu (shadcn) триггер — компактная `Button variant="ghost" size="icon-sm"` с `MoreHorizontal`. Пункты:
- Скачать (всегда, через `onDownload` — `<a download>` с `fileName` или fallback `voice-<sentAt>.ogg`)
- Ответить (только если `onReply` передан)
- Удалить (только при наличии существующего permission; пока не пробрасываем — пункт скрыт, чтобы не вводить новые права)

В preview — отдельная `×` для удаления записи (`onDelete`), меню ⋯ скрыто.

## 6. Safari-guards (CSS)

В `VoiceMessageBubble`:
- никакого `aspect-ratio`, `min-height` под видео, `poster`, `<video>`
- ширина адаптивная (`w-fit max-w-[420px] md:max-w-[420px]`)
- высота от контента
- `overflow: hidden` на bubble
- `<audio>` всегда без атрибута `controls` (только программно через ref)
- родитель в `ChatMediaMessage` не задаёт фиксированную высоту voice-ветке

## 7. Responsive

- Desktop: bubble 320–420 px
- Mobile (`<768`): `max-w-[calc(100vw-96px)]`, progress flex-1
- DropdownMenu использует shadcn (auto-flip, остаётся внутри viewport)
- safe-area уже соблюдается родителем

## 8. Что НЕ трогаем

`sendVoice`, `sendAudio`, `uploadToTelegramMedia.ts`, `AdminVoiceRecorder`, `audioRecorderCore`, edge-функцию `telegram-admin-chat`, схему `meta`, video-note рендер, photo/video/document ветки, incoming webhook.

## 9. UAT (DM Sergey @fs_by, chat_id 66086524, bot @gorbovabybot)

Smoke + screenshots before/after:
1. incoming OGG voice — слева, компактно
2. outgoing Chrome WebM voice — справа, тот же стиль
3. outgoing Safari/iOS M4A voice (desktop Safari + iPhone Safari) — нет «большого пустого блока» ни в preview, ни в истории
4. reload — voice продолжает воспроизводиться (signed URL)
5. download через ⋯
6. seek, play/pause
7. длинное имя файла — не ломает bubble (filename скрыт)
8. duration fallback (если meta=0 → берётся loadedmetadata)
9. light/dark
10. audio/mp3 (не voice) — остаётся audio-track с именем файла (регрессии нет)
11. video note — круглый, без регрессии
12. document — без регрессии

## 10. Файлы

Создаются:
- `src/components/admin/chat/VoiceMessageBubble.tsx`
- `.lovable/proofs/contact_center_voice_ui_parity_2026-06-14.md`

Изменяются:
- `src/components/admin/chat/ChatMediaMessage.tsx` (voice → VoiceMessageBubble, усиление file_type-приоритета)
- `src/components/admin/chat/OutboundMediaPreview.tsx` (voice-ветка → VoiceMessageBubble compact, fix URL leak)
- `src/components/admin/chat/index.ts` (экспорт)

Возможно удаляется:
- `src/components/admin/chat/AudioPlayer.tsx` (если нет внешних потребителей; иначе оставляем для audio-ветки)

## 11. DoD

- incoming/outgoing/preview voice используют единый `VoiceMessageBubble`
- incoming слева, outgoing справа, единый glassmorphism
- filename скрыт из bubble (только tooltip/меню)
- duration + размер показываются, есть fallback на `loadedmetadata`
- download — через ⋯
- Safari preview не показывает огромный пустой блок
- voice играет после reload
- audio (не voice) визуально отличается
- regression: video_note/photo/video/document целы
- screenshots desktop + mobile приложены к proof

## 12. Технические детали (для разработчика)

- Импорт canonical компонента: `import { VoiceMessageBubble } from "@/components/admin/chat/VoiceMessageBubble"`
- `formatTime` и pointer-seek заимствуются из текущего `AudioPlayer.tsx`
- DropdownMenu: `@/components/ui/dropdown-menu`
- Цвета строго через design tokens (`bg-card`, `bg-primary`, `border-border`, `text-muted-foreground`) — никаких `bg-blue-*`/`text-white`
- Тест canonical resolver guard: добавить unit-проверку (vitest) на функцию-резолвер canonicalType, если она будет вынесена; иначе — inline JSX-ветка без теста

Выполнение одним проходом. STOP-guard сработает только если в ходе UAT выяснится, что Safari «большой блок» воспроизводится **в истории** (не в preview) — тогда останавливаемся и эскалируем, т.к. это указывало бы на transport/MIME, а не на UI.

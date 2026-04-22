/**
 * T1ProofPage — изолированная страница для визуального proof фикса T1
 * (overflow длинных строк в banner/text блоках под видео).
 *
 * Маршрут: /dev/t1-proof
 *
 * Эмулирует layout комнаты эфира: ограниченная по ширине video shell + блоки
 * под ней. Рендерит фикстуры напрямую через те же компоненты, что и в
 * LiveEventRoomBlocks (BannerBlock / TextBlock — внутренние, поэтому здесь
 * собран эквивалентный JSX с тем же набором классов).
 *
 * ВРЕМЕННЫЙ ФАЙЛ — удалить после закрытия T1.
 */
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

const LONG_BANNER_TITLE =
  "BANNER-T1-OVERFLOW-PROOF-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const LONG_BANNER_BODY =
  "https://example.com/very-long-url-without-any-spaces/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LONG_TEXT_BODY =
  "TEXT-OVERFLOW-CHECK: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA https://example.com/another-extremely-long-url-without-any-spaces-at-all/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export default function T1ProofPage() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-xl font-bold">T1 Proof — overflow длинных строк</h1>
        <p className="text-sm text-muted-foreground">
          Имитация video shell (черный прямоугольник 16:9) + блоки под ним.
          Контейнер ограничен по ширине max-w-3xl.
        </p>

        {/* Имитация video shell */}
        <div className="aspect-video w-full rounded-lg bg-black/90 flex items-center justify-center text-white/40 text-sm">
          [video shell placeholder]
        </div>

        {/* Контейнер под видео — повторяет геометрию LiveEventRoomBlocks */}
        <div className="w-full max-w-full min-w-0 space-y-2">
          {/* BannerBlock — точная копия классов из LiveEventRoomBlocks.tsx */}
          <div className="room-cta-card rounded-lg border bg-card p-3 space-y-2 w-full max-w-full min-w-0 overflow-hidden">
            <h4 className="font-semibold text-sm text-card-foreground break-words [overflow-wrap:anywhere]">
              {LONG_BANNER_TITLE}
            </h4>
            <p className="text-xs text-muted-foreground break-words [overflow-wrap:anywhere] whitespace-pre-wrap">
              {LONG_BANNER_BODY}
            </p>
            <Button size="sm" className="w-full">
              CTA <ExternalLink className="h-3 w-3 ml-1.5" />
            </Button>
          </div>

          {/* TextBlock — точная копия классов */}
          <div className="room-cta-card rounded-lg border bg-card p-3 text-sm text-card-foreground leading-relaxed w-full max-w-full min-w-0 overflow-hidden break-words [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap">
            <span className="block min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              {LONG_TEXT_BODY}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

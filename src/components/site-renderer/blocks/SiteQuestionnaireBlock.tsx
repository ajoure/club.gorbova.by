/**
 * Site Questionnaire — тонкий wrapper над canonical training engine.
 * Reuse 1:1: lesson_blocks + user_lesson_progress + LessonBlockRenderer.
 *
 * Policy (approved):
 * - auth-required (анонимам показывается prompt войти)
 * - update latest response (overwrite) — повторное прохождение перезаписывает ответы
 * - storage: единственный canonical путь user_lesson_progress (existing engine)
 * - viewer: existing StudentProgressModal (открывается из /admin/forms)
 *
 * НЕ создаёт второй editor / renderer / storage / viewer.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { LessonBlockRenderer } from "@/components/lesson/LessonBlockRenderer";
import { useLessonBlocks, type LessonBlock } from "@/hooks/useLessonBlocks";

interface Props {
  content: Record<string, unknown>;
}

export function SiteQuestionnaireBlock({ content }: Props) {
  const lessonId = (content.lessonId as string) || "";
  const title = (content.title as string) || "";
  const subtitle = (content.subtitle as string) || "";

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [lessonValid, setLessonValid] = useState<boolean | null>(null);

  // Гейт: lessonId должен принадлежать служебному module
  useEffect(() => {
    if (!lessonId) {
      setLessonValid(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("training_lessons")
        .select("id, training_modules!inner(slug)")
        .eq("id", lessonId)
        .maybeSingle();
      if (cancelled) return;
      const slug = (data as any)?.training_modules?.slug;
      setLessonValid(!!data && slug === "__site_questionnaires__");
    })();
    return () => { cancelled = true; };
  }, [lessonId]);

  const { blocks, loading: isLoading } = useLessonBlocks(lessonId);

  if (!lessonId || lessonValid === false) {
    return (
      <section className="py-8 px-6">
        <div className="max-w-xl mx-auto p-4 border border-dashed rounded-lg text-center text-muted-foreground text-sm">
          Анкета не настроена. Откройте редактор блока и выберите анкету.
        </div>
      </section>
    );
  }

  if (authLoading || lessonValid === null) {
    return (
      <section className="py-12 px-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  if (!user) {
    return (
      <section className="py-12 px-6">
        <div className="max-w-xl mx-auto text-center space-y-4">
          {title && <h3 className="text-2xl font-bold text-foreground">{title}</h3>}
          {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
          <p className="text-sm text-muted-foreground">
            Чтобы пройти анкету, необходимо войти в личный кабинет.
          </p>
          <Button onClick={() => navigate(`/auth?redirect=${encodeURIComponent(window.location.pathname + window.location.hash)}`)}>
            Войти
          </Button>
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="py-12 px-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </section>
    );
  }

  return (
    <section className="py-8 px-6">
      <div className="max-w-2xl mx-auto space-y-4">
        {title && <h3 className="text-2xl font-bold text-foreground text-center">{title}</h3>}
        {subtitle && <p className="text-muted-foreground text-center">{subtitle}</p>}
        <div className="bg-card rounded-lg border p-4 md:p-6">
          <LessonBlockRenderer
            blocks={(blocks || []) as LessonBlock[]}
            lessonId={lessonId}
          />
        </div>
        <p className="text-[11px] text-muted-foreground text-center">
          Ответы автоматически сохраняются. При повторном прохождении ответы будут обновлены.
        </p>
      </div>
    </section>
  );
}

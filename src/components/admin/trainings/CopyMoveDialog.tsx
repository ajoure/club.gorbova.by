import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Copy, ArrowRightLeft } from "lucide-react";
import { ContentSectionSelector } from "./ContentSectionSelector";
import { ModuleTreeSelector } from "./ModuleTreeSelector";

interface CopyMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: "module" | "lesson";
  sourceId: string;
  sourceTitle: string;
  currentSectionKey: string;
  onSuccess: () => void;
}

export function CopyMoveDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  sourceTitle,
  currentSectionKey,
  onSuccess,
}: CopyMoveDialogProps) {
  const [isCopy, setIsCopy] = useState(true);
  const [sectionKey, setSectionKeyRaw] = useState(currentSectionKey);

  const handleSectionChange = (key: string) => {
    setSectionKeyRaw(key);
    setTargetModuleId(null);
  };
  const [targetModuleId, setTargetModuleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const action = isCopy
        ? sourceType === "module"
          ? "copy_module"
          : "copy_lesson"
        : sourceType === "module"
          ? "move_module"
          : "move_lesson";

      const { data, error } = await supabase.functions.invoke("training-copy-move", {
        body: {
          action,
          source_id: sourceId,
          target_module_id: targetModuleId,
          target_section_key: sectionKey,
        },
      });

      if (error) {
        let message = error.message;
        try {
          const payload = await error.context?.json();
          if (payload?.error) message = payload.error;
        } catch {
          // Keep the SDK message when the response body is unavailable.
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      toast.success(
        isCopy
          ? `${sourceType === "module" ? "Модуль" : "Урок"} скопирован`
          : `${sourceType === "module" ? "Модуль" : "Урок"} перемещён`
      );
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error("Copy/move error:", err);
      toast.error(`Ошибка: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const isLessonWithoutModule = sourceType === "lesson" && !targetModuleId;
  const actionLabel = isCopy ? "Копировать" : "Переместить";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,48rem)] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6">
          <DialogTitle>
            {isCopy ? "Копировать" : "Переместить"} {sourceType === "module" ? "модуль" : "урок"}
          </DialogTitle>
          <DialogDescription>
            {sourceType === "module" ? "Модуль" : "Урок"}: <strong>{sourceTitle}</strong>
          </DialogDescription>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-2"
          data-testid="copy-move-scroll-area"
        >
          {/* Toggle copy/move */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <Copy className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="copy-toggle" className="flex-1 cursor-pointer">
              {isCopy ? "Копирование (создаст дубликат)" : "Перемещение (перенесёт оригинал)"}
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Копия</span>
              <Switch
                id="copy-toggle"
                checked={!isCopy}
                onCheckedChange={(checked) => setIsCopy(!checked)}
              />
              <span className="text-xs text-muted-foreground">Перенос</span>
            </div>
          </div>

          {/* Section selector */}
          <ContentSectionSelector
            value={sectionKey}
            onChange={handleSectionChange}
          />
          <p className="text-xs text-muted-foreground -mt-1">
            Смените раздел, чтобы увидеть модули из другого раздела
          </p>

          {/* Module tree selector */}
          <div className="space-y-2">
            <Label>Целевой модуль</Label>
            <p className="text-xs text-muted-foreground">
              {sourceType === "lesson"
                ? `Выберите модуль, куда будет ${isCopy ? "скопирован" : "перемещён"} урок`
                : "Выберите модуль-контейнер или оставьте «Корень раздела»"}
            </p>
            <ModuleTreeSelector
              sectionKey={sectionKey}
              selectedId={targetModuleId}
              onSelect={setTargetModuleId}
              mode="select-parent"
              excludeId={sourceType === "module" ? sourceId : undefined}
            />
            {isLessonWithoutModule && (
              <p className="text-sm text-amber-600">
                Урок должен находиться в модуле. Выберите целевой модуль.
              </p>
            )}
          </div>
        </div>

        <DialogFooter
          className="shrink-0 border-t bg-background px-6 py-4"
          data-testid="copy-move-actions"
        >
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={loading || isLessonWithoutModule}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {actionLabel}...
              </>
            ) : (
              <>
                {isCopy ? <Copy className="mr-2 h-4 w-4" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
                {actionLabel}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

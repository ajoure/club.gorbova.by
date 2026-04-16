import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { FileText, Loader2, AlertCircle } from "lucide-react";
import { StudentProgressModal } from "@/components/admin/trainings/StudentProgressModal";
import { PreregistrationDetailSheet } from "@/components/admin/PreregistrationDetailSheet";
import { loadTrainingDetailContext, type TrainingDetailData } from "@/lib/training-detail-loader";
import type { FormsHubRow } from "@/hooks/useFormsHubData";

interface Props {
  row: FormsHubRow | null;
  onClose: () => void;
}

export function FormsDetailOpener({ row, onClose }: Props) {
  if (!row) return null;

  if (row.source_type === "training") {
    return <TrainingDetailBridge row={row} onClose={onClose} />;
  }

  if (row.source_type === "preorder") {
    return <PreregistrationDetailBridge row={row} onClose={onClose} />;
  }

  return <SiteFormDetailDialog row={row} onClose={onClose} />;
}

// ── Training → existing StudentProgressModal ─────────────────────────

function TrainingDetailBridge({ row, onClose }: { row: FormsHubRow; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TrainingDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row.raw?.lesson_id || !row.user_id) {
      setError("Нет данных урока или пользователя");
      setLoading(false);
      return;
    }

    const lessonId = row.raw.lesson_id;
    const userId = row.user_id;

    (async () => {
      try {
        const detail = await loadTrainingDetailContext(userId, lessonId);
        if (!detail) {
          setError("Не удалось загрузить данные урока");
        } else {
          // Attach profile info if available from hub row
          if (row.raw?.profile) {
            detail.record.profiles = row.raw.profile;
          }
          setData(detail);
        }
      } catch (e) {
        setError("Ошибка загрузки данных");
      }
      setLoading(false);
    })();
  }, [row]);

  if (loading) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-md flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </DialogContent>
      </Dialog>
    );
  }

  if (error) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-md flex flex-col items-center justify-center py-12 gap-3">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </DialogContent>
      </Dialog>
    );
  }

  if (!data) {
    onClose();
    return null;
  }

  return (
    <StudentProgressModal
      open={true}
      record={data.record}
      lessonBlocks={data.lessonBlocks}
      blockResponses={data.blockResponses}
      onClose={onClose}
      studentName={row.client_name !== "—" ? row.client_name : undefined}
      productTitle={row.product_title || undefined}
    />
  );
}

// ── Preorder → existing PreregistrationDetailSheet ────────────────────

function PreregistrationDetailBridge({ row, onClose }: { row: FormsHubRow; onClose: () => void }) {
  return (
    <PreregistrationDetailSheet
      preregistration={row.raw}
      open={true}
      onOpenChange={(open) => { if (!open) onClose(); }}
    />
  );
}

// ── Site Form → inline dialog ────────────────────────────────────────

function SiteFormDetailDialog({ row, onClose }: { row: FormsHubRow; onClose: () => void }) {
  const formData = (row.raw?.form_data || {}) as Record<string, any>;
  const entries = Object.entries(formData);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b space-y-2">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-primary mt-0.5" />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base font-semibold">{row.client_name}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[11px]">Анкета сайта</Badge>
                  {row.product_title && <Badge variant="secondary" className="text-[11px]">{row.product_title}</Badge>}
                  <span className="text-xs text-muted-foreground">{row.source_entity}</span>
                </div>
              </DialogDescription>
            </div>
          </div>
          <div className="text-xs text-muted-foreground pl-8">
            {format(new Date(row.created_at), "dd MMMM yyyy, HH:mm", { locale: ru })}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет данных формы</p>
          ) : (
            entries.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">{key}</span>
                <span className="text-sm">{String(value ?? "—")}</span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

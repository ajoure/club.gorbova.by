import { useState } from "react";
import { useAiDocuments, type AiGeneratedDocument } from "@/hooks/useAiDocuments";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Trash2, FileText, Loader2, Clock, Package } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function AiDocumentsHistoryView() {
  const { documents, isLoading, deleteDocument, isDeleting, getDownloadUrl } = useAiDocuments();
  const [deletingDoc, setDeletingDoc] = useState<AiGeneratedDocument | null>(null);

  const handleDownload = async (doc: AiGeneratedDocument) => {
    if (!doc.file_path) return;
    const url = await getDownloadUrl(doc.file_path, doc.storage_bucket);
    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleDelete = async () => {
    if (!deletingDoc) return;
    await deleteDocument(deletingDoc);
    setDeletingDoc(null);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "generated":
        return <Badge variant="default" className="bg-emerald-500/15 text-emerald-600 border-emerald-300/30">Готов</Badge>;
      case "error":
        return <Badge variant="destructive">Ошибка</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <GlassCard className="text-center py-12">
        <div className="mx-auto mb-4 p-4 rounded-2xl bg-muted/40 w-fit">
          <Clock className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">История пуста</h3>
        <p className="text-sm text-muted-foreground">
          Сформированные документы появятся здесь.
        </p>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Документ</TableHead>
              <TableHead>Шаблон</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {documents.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {format(new Date(doc.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate max-w-[200px]">
                      {doc.title}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[150px]">
                  {doc.template_name}
                </TableCell>
                <TableCell>{statusBadge(doc.status)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {doc.file_path && doc.status === "generated" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(doc)}
                        title="Скачать"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingDoc(doc)}
                      title="Удалить"
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>

      <AlertDialog open={!!deletingDoc} onOpenChange={() => setDeletingDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
            <AlertDialogDescription>
              Документ «{deletingDoc?.title}» будет удалён вместе с файлом. Это действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

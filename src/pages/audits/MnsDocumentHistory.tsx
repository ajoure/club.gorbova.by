import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeft, 
  FileText, 
  Trash2, 
  Eye, 
  Copy,
  Loader2,
  Calendar,
  Building2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMnsDocuments, MnsDocument } from "@/hooks/useMnsDocuments";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useState, useCallback } from "react";

const requestTypeLabels: Record<string, string> = {
  documents: "Документы",
  summons: "Вызов",
  combined: "Комбинированный",
  clarification: "Уточнение",
  unknown: "Не определен",
};

export default function MnsDocumentHistory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { documents, isLoading, deleteDocument } = useMnsDocuments();
  const [viewingDocument, setViewingDocument] = useState<MnsDocument | null>(null);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Скопировано",
        description: "Текст скопирован в буфер обмена",
      });
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать текст",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteDocument.mutateAsync(id);
  }, [deleteDocument]);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/audits")}
            className="shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <FileText className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                История документов
              </h1>
              <p className="text-muted-foreground">
                Архив сгенерированных ответов на запросы МНС
              </p>
            </div>
          </div>
        </div>

        {/* Documents List */}
        <GlassCard className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                История документов пуста
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => navigate("/audits/mns-response")}
              >
                Создать первый ответ
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="secondary">
                          {requestTypeLabels[doc.request_type] || doc.request_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(doc.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
                        </span>
                      </div>
                      
                      {doc.tax_authority && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                          <Building2 className="h-3 w-3" />
                          {doc.tax_authority}
                        </div>
                      )}
                      
                      <p className="text-sm text-foreground line-clamp-2">
                        {doc.original_request.substring(0, 200)}
                        {doc.original_request.length > 200 && "..."}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setViewingDocument(doc)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(doc.response_text)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Это действие нельзя отменить. Документ будет удален из истории.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(doc.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* View Document Dialog */}
        <Dialog open={!!viewingDocument} onOpenChange={() => setViewingDocument(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Просмотр документа
              </DialogTitle>
            </DialogHeader>
            
            {viewingDocument && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {requestTypeLabels[viewingDocument.request_type]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(viewingDocument.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">
                    Исходный запрос
                  </h4>
                  <ScrollArea className="h-24 rounded-lg border border-border p-3 bg-muted/50">
                    <p className="text-sm whitespace-pre-wrap">{viewingDocument.original_request}</p>
                  </ScrollArea>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      Сгенерированный ответ
                    </h4>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(viewingDocument.response_text)}
                      className="gap-2"
                    >
                      <Copy className="h-3 w-3" />
                      Скопировать
                    </Button>
                  </div>
                  <ScrollArea className="h-[300px] rounded-lg border border-border p-4 bg-background">
                    <pre className="whitespace-pre-wrap font-sans text-sm">
                      {viewingDocument.response_text}
                    </pre>
                  </ScrollArea>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

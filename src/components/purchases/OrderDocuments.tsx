import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, ExternalLink, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useOrderDocuments, DOCUMENT_TYPE_LABELS, GeneratedDocument } from "@/hooks/useGeneratedDocuments";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderDocumentsProps {
  orderId: string;
  orderNumber?: string;
  trigger?: React.ReactNode;
}

export function OrderDocuments({ orderId, orderNumber, trigger }: OrderDocumentsProps) {
  const [open, setOpen] = useState(false);
  const { data: documents = [], isLoading } = useOrderDocuments(orderId);

  const handleDownload = async (doc: GeneratedDocument) => {
    if (!doc.file_path) {
      toast.error("Файл недоступен");
      return;
    }

    try {
      const { data: signedUrl, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.file_path, 3600);

      if (error) throw error;
      
      window.open(signedUrl.signedUrl, "_blank");
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Ошибка скачивания");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "sent":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "generated":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      <FileText className="h-4 w-4 mr-2" />
      Документы
      {documents.length > 0 && (
        <Badge variant="secondary" className="ml-2">
          {documents.length}
        </Badge>
      )}
    </Button>
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>Документы</SheetTitle>
          <SheetDescription>
            {orderNumber ? `Заказ №${orderNumber}` : "Документы по заказу"}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Документы отсутствуют</p>
              <p className="text-sm">Документы появятся после оплаты</p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-200px)]">
              <div className="space-y-3 pr-4">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        {getStatusIcon(doc.status)}
                        <div>
                          <p className="font-medium">
                            {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                          </p>
                          <p className="text-sm font-mono text-muted-foreground">
                            № {doc.document_number}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            от {format(new Date(doc.document_date), "dd MMMM yyyy", { locale: ru })}
                          </p>
                          {doc.paid_amount && (
                            <p className="text-sm font-medium mt-1">
                              {doc.paid_amount.toFixed(2)} {doc.currency}
                            </p>
                          )}
                        </div>
                      </div>

                      {doc.file_path && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownload(doc)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    {doc.sent_to_email && (
                      <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                        Отправлен на {doc.sent_to_email}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

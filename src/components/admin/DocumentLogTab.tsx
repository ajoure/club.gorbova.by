import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Download, Send, RefreshCw, Search, FileText, AlertCircle, CheckCircle, Clock, Eye } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { 
  useGeneratedDocuments, 
  useResendDocument,
  DOCUMENT_STATUS_LABELS, 
  DOCUMENT_TYPE_LABELS,
  GeneratedDocument,
  DocumentFilters,
} from "@/hooks/useGeneratedDocuments";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function DocumentLogTab() {
  const [filters, setFilters] = useState<DocumentFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<GeneratedDocument | null>(null);
  
  const { data: documents = [], isLoading, refetch } = useGeneratedDocuments(filters);
  const resendMutation = useResendDocument();

  const handleSearch = () => {
    setFilters({ ...filters, search: searchInput });
  };

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
      
      // Update download count
      await supabase
        .from("generated_documents")
        .update({ 
          download_count: (doc.download_count || 0) + 1,
          last_downloaded_at: new Date().toISOString(),
        })
        .eq("id", doc.id);

      window.open(signedUrl.signedUrl, "_blank");
      refetch();
    } catch (error) {
      console.error("Download error:", error);
      toast.error("Ошибка скачивания");
    }
  };

  const handleResend = async (doc: GeneratedDocument) => {
    try {
      await resendMutation.mutateAsync({ documentId: doc.id, sendEmail: true });
      refetch();
    } catch (error) {
      console.error("Resend error:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
      generated: { variant: "secondary", icon: <Clock className="h-3 w-3 mr-1" /> },
      sent: { variant: "default", icon: <CheckCircle className="h-3 w-3 mr-1" /> },
      error: { variant: "destructive", icon: <AlertCircle className="h-3 w-3 mr-1" /> },
      draft: { variant: "outline", icon: <FileText className="h-3 w-3 mr-1" /> },
    };
    const config = variants[status] || variants.draft;
    return (
      <Badge variant={config.variant} className="flex items-center w-fit">
        {config.icon}
        {DOCUMENT_STATUS_LABELS[status] || status}
      </Badge>
    );
  };

  const formatClientName = (doc: GeneratedDocument) => {
    const snapshot = doc.client_snapshot as Record<string, any>;
    if (snapshot?.ind_full_name) return snapshot.ind_full_name;
    if (snapshot?.ent_name) return snapshot.ent_name;
    if (snapshot?.leg_name) return snapshot.leg_name;
    if (snapshot?.name) return snapshot.name;
    if (doc.profile?.full_name) return doc.profile.full_name;
    return "—";
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between gap-4">
            <div>
              <CardTitle>Журнал документов</CardTitle>
              <CardDescription>
                Все сгенерированные документы
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Обновить
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="flex gap-2 flex-1 min-w-[200px]">
              <Input
                placeholder="Номер документа или ID заказа..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button variant="outline" onClick={handleSearch}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            <Select
              value={filters.status || ""}
              onValueChange={(v) => setFilters({ ...filters, status: v || undefined })}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Все статусы</SelectItem>
                {Object.entries(DOCUMENT_STATUS_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.document_type || ""}
              onValueChange={(v) => setFilters({ ...filters, document_type: v || undefined })}
            >
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Все типы</SelectItem>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Документы не найдены</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Номер</TableHead>
                    <TableHead>Дата</TableHead>
                    <TableHead>Тип</TableHead>
                    <TableHead>Клиент</TableHead>
                    <TableHead>Заказ</TableHead>
                    <TableHead>Сумма</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map(doc => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-mono text-sm">
                        {doc.document_number}
                      </TableCell>
                      <TableCell>
                        {format(new Date(doc.document_date), "dd.MM.yyyy", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {formatClientName(doc)}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {doc.order?.order_number || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {doc.paid_amount?.toFixed(2) || doc.order?.final_price?.toFixed(2) || "—"} {doc.currency}
                      </TableCell>
                      <TableCell>{getStatusBadge(doc.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedDoc(doc)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {doc.file_path && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownload(doc)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleResend(doc)}
                            disabled={resendMutation.isPending}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Document Details Sheet */}
      <Sheet open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
        <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Документ {selectedDoc?.document_number}</SheetTitle>
            <SheetDescription>
              Детали сгенерированного документа
            </SheetDescription>
          </SheetHeader>

          {selectedDoc && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Тип</p>
                  <p className="font-medium">{DOCUMENT_TYPE_LABELS[selectedDoc.document_type]}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Статус</p>
                  {getStatusBadge(selectedDoc.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Дата</p>
                  <p className="font-medium">
                    {format(new Date(selectedDoc.document_date), "dd MMMM yyyy", { locale: ru })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Создан</p>
                  <p className="font-medium">
                    {format(new Date(selectedDoc.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Клиент</h4>
                <p>{formatClientName(selectedDoc)}</p>
                {selectedDoc.profile?.email && (
                  <p className="text-sm text-muted-foreground">{selectedDoc.profile.email}</p>
                )}
                {selectedDoc.payer_type_mismatch && (
                  <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm text-yellow-800 dark:text-yellow-200">
                    ⚠️ {selectedDoc.mismatch_warning}
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-2">Заказ</h4>
                <p>№ {selectedDoc.order?.order_number}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedDoc.order_snapshot as any)?.product_name}
                </p>
                <p className="font-medium mt-1">
                  {selectedDoc.paid_amount?.toFixed(2) || selectedDoc.order?.final_price?.toFixed(2)} {selectedDoc.currency}
                </p>
              </div>

              {selectedDoc.sent_at && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-2">Отправка</h4>
                  <p className="text-sm">
                    Email: {selectedDoc.sent_to_email || "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {format(new Date(selectedDoc.sent_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                  </p>
                </div>
              )}

              {selectedDoc.error_message && (
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-2 text-destructive">Ошибка</h4>
                  <p className="text-sm text-destructive">{selectedDoc.error_message}</p>
                </div>
              )}

              <div className="border-t pt-4 flex gap-2">
                {selectedDoc.file_path && (
                  <Button onClick={() => handleDownload(selectedDoc)} className="flex-1">
                    <Download className="h-4 w-4 mr-2" />
                    Скачать
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  onClick={() => handleResend(selectedDoc)}
                  disabled={resendMutation.isPending}
                  className="flex-1"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Отправить
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

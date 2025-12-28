import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { X, FileText, Upload, Loader2, Edit2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLetterheadProcessor, ProcessedLetterhead, CompanyRequisites } from "@/hooks/useLetterheadProcessor";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LetterheadSettingsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

const REQUISITE_LABELS: Record<keyof CompanyRequisites, string> = {
  companyName: "Название организации",
  legalForm: "Форма собственности",
  unp: "УНП",
  legalAddress: "Юридический адрес",
  postalAddress: "Почтовый адрес",
  phone: "Телефон",
  fax: "Факс",
  email: "E-mail",
  website: "Сайт",
  bankName: "Банк",
  bankAccount: "Расчётный счёт",
  bankCode: "БИК",
};

function getFileType(file: File): ProcessedLetterhead["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  if (
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "word";
  return "other";
}

export function LetterheadSettings({ enabled, onEnabledChange }: LetterheadSettingsProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedRequisites, setEditedRequisites] = useState<CompanyRequisites | null>(null);
  
  const {
    processedLetterhead,
    isProcessing,
    processLetterhead,
    updateRequisites,
    clearLetterhead,
  } = useLetterheadProcessor();

  const processFile = useCallback(async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast({
        title: "Файл слишком большой",
        description: "Максимальный размер файла — 20 МБ",
        variant: "destructive",
      });
      return;
    }

    const fileType = getFileType(file);
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      try {
        await processLetterhead(base64, file.name, file.type, fileType);
        toast({
          title: "Бланк обработан",
          description: "Реквизиты извлечены. Проверьте и отредактируйте при необходимости.",
        });
      } catch (error) {
        toast({
          title: "Ошибка обработки",
          description: error instanceof Error ? error.message : "Не удалось обработать бланк",
          variant: "destructive",
        });
      }
    };
    reader.readAsDataURL(file);
  }, [processLetterhead, toast]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleRemove = useCallback(() => {
    clearLetterhead();
    toast({ title: "Бланк удалён" });
  }, [clearLetterhead, toast]);

  const startEditing = useCallback(() => {
    if (processedLetterhead) {
      setEditedRequisites({ ...processedLetterhead.requisites });
      setIsEditing(true);
    }
  }, [processedLetterhead]);

  const saveEdits = useCallback(() => {
    if (editedRequisites) {
      updateRequisites(editedRequisites);
      setIsEditing(false);
      setEditedRequisites(null);
      toast({ title: "Реквизиты сохранены" });
    }
  }, [editedRequisites, updateRequisites, toast]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditedRequisites(null);
  }, []);

  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <Label htmlFor="letterhead-enabled" className="text-sm font-medium">
            Использовать фирменный бланк
          </Label>
          <p className="text-xs text-muted-foreground">
            При экспорте документ будет оформлен на бланке
          </p>
        </div>
        <Switch
          id="letterhead-enabled"
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {enabled && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          {processedLetterhead ? (
            <div className="space-y-4">
              {/* File Info */}
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/50">
                <div className="w-12 h-12 rounded border border-border overflow-hidden bg-background flex items-center justify-center">
                  {processedLetterhead.type === "image" && processedLetterhead.originalBase64 ? (
                    <img 
                      src={processedLetterhead.originalBase64} 
                      alt="Бланк" 
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <FileText className="h-6 w-6 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {processedLetterhead.originalFilename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Реквизиты извлечены
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={startEditing}
                    className="shrink-0 h-8 w-8 text-muted-foreground hover:text-foreground"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleRemove}
                    className="shrink-0 h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Requisites Display/Edit */}
              {isEditing && editedRequisites ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-foreground">Редактирование реквизитов</h4>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelEditing}>
                        Отмена
                      </Button>
                      <Button size="sm" onClick={saveEdits} className="gap-1">
                        <Check className="h-3 w-3" />
                        Сохранить
                      </Button>
                    </div>
                  </div>
                  <ScrollArea className="h-64">
                    <div className="space-y-3 pr-4">
                      {(Object.keys(REQUISITE_LABELS) as Array<keyof CompanyRequisites>).map((key) => (
                        <div key={key} className="space-y-1">
                          <Label htmlFor={key} className="text-xs text-muted-foreground">
                            {REQUISITE_LABELS[key]}
                          </Label>
                          <Input
                            id={key}
                            value={editedRequisites[key]}
                            onChange={(e) => setEditedRequisites({
                              ...editedRequisites,
                              [key]: e.target.value,
                            })}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground">Извлечённые реквизиты</h4>
                  <ScrollArea className="h-48">
                    <div className="space-y-1 pr-4 text-xs">
                      {(Object.keys(REQUISITE_LABELS) as Array<keyof CompanyRequisites>).map((key) => {
                        const value = processedLetterhead.requisites[key];
                        if (!value) return null;
                        return (
                          <div key={key} className="flex gap-2">
                            <span className="text-muted-foreground shrink-0">{REQUISITE_LABELS[key]}:</span>
                            <span className="text-foreground">{value}</span>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
                ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}
                ${isProcessing ? "pointer-events-none opacity-50" : ""}
              `}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-8 w-8 mx-auto mb-2 text-primary animate-spin" />
                  <p className="text-sm font-medium text-foreground">
                    Обработка бланка...
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Извлечение реквизитов
                  </p>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">
                    Загрузить фирменный бланк
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Word, PDF или изображение
                  </p>
                </>
              )}
            </div>
          )}
          
          <p className="text-xs text-muted-foreground">
            Из бланка будут извлечены только реквизиты компании. 
            Тело письма (если есть) будет проигнорировано.
          </p>
        </>
      )}
    </div>
  );
}

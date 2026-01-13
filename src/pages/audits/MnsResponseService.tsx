import { useState, useRef, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  FileText, 
  Sparkles, 
  Copy, 
  Save, 
  Loader2, 
  ArrowLeft,
  Send,
  Download
} from "lucide-react";
import { useMnsDocuments } from "@/hooks/useMnsDocuments";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileDropZone, UploadedFile } from "@/components/mns/FileDropZone";
import { exportToDocx, exportToPdf } from "@/utils/exportDocument";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function MnsResponseService() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { generateResponse, saveDocument, isGenerating } = useMnsDocuments();
  
  const [inputText, setInputText] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [finalResponse, setFinalResponse] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<string>("unknown");
  const [originalRequest, setOriginalRequest] = useState<string>("");
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handlePasteOnTextarea = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const hasFiles = items.some(item => item.kind === "file");
    
    if (hasFiles) {
      // Let FileDropZone handle files
      const filesToAdd: File[] = [];
      items.forEach(item => {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) filesToAdd.push(file);
        }
      });
      
      if (filesToAdd.length > 0) {
        e.preventDefault();
        // Process files manually since we're intercepting
        filesToAdd.forEach(async (file) => {
          const fileType = getFileType(file);
          if (fileType === "other") return;
          
          const uploadedFile: UploadedFile = {
            id: crypto.randomUUID(),
            file,
            type: fileType,
          };
          
          if (fileType === "image") {
            const reader = new FileReader();
            reader.onload = (event) => {
              uploadedFile.preview = event.target?.result as string;
              setUploadedFiles(prev => [...prev, uploadedFile]);
            };
            reader.readAsDataURL(file);
          } else {
            setUploadedFiles(prev => [...prev, uploadedFile]);
          }
        });
      }
    }
  }, []);

  const getFileType = (file: File): UploadedFile["type"] => {
    const typeMap: Record<string, UploadedFile["type"]> = {
      "image/jpeg": "image",
      "image/png": "image",
      "image/webp": "image",
      "application/pdf": "pdf",
      "application/msword": "word",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
      "application/vnd.ms-excel": "excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
    };
    return typeMap[file.type] || "other";
  };

  const handleSubmit = useCallback(async () => {
    if (!inputText.trim() && uploadedFiles.length === 0) {
      toast({
        title: "Ошибка",
        description: "Введите текст запроса или загрузите файл",
        variant: "destructive",
      });
      return;
    }

    // Capture current values before state updates
    const currentInputText = inputText;
    const isFirstMessage = messages.length === 0;
    
    // Store original request on first submission
    if (isFirstMessage) {
      setOriginalRequest(currentInputText);
    }

    // Add user message
    const userMessage: Message = { role: "user", content: currentInputText };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");

    // Build conversation history for AI
    const conversationHistory = newMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Get first image for AI if available
    const imageFile = uploadedFiles.find(f => f.type === "image");
    let imageBase64: string | undefined;
    
    if (isFirstMessage && imageFile?.preview) {
      imageBase64 = imageFile.preview;
    }

    const result = await generateResponse({
      requestText: isFirstMessage ? currentInputText : undefined,
      imageBase64: isFirstMessage ? imageBase64 : undefined,
      conversationHistory: !isFirstMessage ? conversationHistory : undefined,
    });

    if (result) {
      const assistantMessage: Message = { role: "assistant", content: result.responseText };
      setMessages([...newMessages, assistantMessage]);
      
      if (!result.needsClarification) {
        setFinalResponse(result.responseText);
        setRequestType(result.requestType);
      }
    }
    
    // Clear files after first submission
    if (uploadedFiles.length > 0) {
      setUploadedFiles([]);
    }
  }, [inputText, uploadedFiles, messages, generateResponse, toast]);

  const handleCopy = useCallback(async () => {
    if (!finalResponse) return;
    
    try {
      await navigator.clipboard.writeText(finalResponse);
      toast({
        title: "Скопировано",
        description: "Текст ответа скопирован в буфер обмена",
      });
    } catch {
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать текст",
        variant: "destructive",
      });
    }
  }, [finalResponse, toast]);

  const handleSave = useCallback(async () => {
    if (!finalResponse || !originalRequest) return;
    
    await saveDocument.mutateAsync({
      originalRequest: originalRequest,
      responseText: finalResponse,
      requestType: requestType,
    });
  }, [finalResponse, originalRequest, requestType, saveDocument]);

  const handleExportDocx = useCallback(async () => {
    if (!finalResponse) return;
    
    try {
      await exportToDocx(
        finalResponse, 
        `ответ_мнс_${new Date().toISOString().split("T")[0]}.docx`
      );
      toast({
        title: "Экспорт завершён",
        description: "Файл DOCX сохранён",
      });
    } catch (error) {
      toast({
        title: "Ошибка экспорта",
        description: error instanceof Error ? error.message : "Не удалось экспортировать",
        variant: "destructive",
      });
    }
  }, [finalResponse, toast]);

  const handleExportPdf = useCallback(async () => {
    if (!finalResponse) return;
    
    try {
      await exportToPdf(finalResponse, `ответ_мнс_${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (error) {
      toast({
        title: "Ошибка экспорта",
        description: error instanceof Error ? error.message : "Не удалось экспортировать",
        variant: "destructive",
      });
    }
  }, [finalResponse, toast]);

  const handleReset = useCallback(() => {
    setInputText("");
    setUploadedFiles([]);
    setMessages([]);
    setFinalResponse(null);
    setRequestType("unknown");
    setOriginalRequest("");
  }, []);

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
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
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <FileText className="w-7 h-7 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Ответ на запрос МНС по ст. 107 НК РБ
              </h1>
              <p className="text-muted-foreground">
                Подготовка официального ответа на запрос налогового органа
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        {!finalResponse ? (
          <GlassCard className="p-6">
            <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Исходный запрос
            </h3>

            {/* Conversation History */}
            {messages.length > 0 && (
              <ScrollArea className="h-64 mb-4 rounded-lg border border-border p-4">
                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        msg.role === "user"
                          ? "bg-primary/10 ml-8"
                          : "bg-muted mr-8"
                      }`}
                    >
                      <p className="text-xs font-medium text-muted-foreground mb-1">
                        {msg.role === "user" ? "Вы" : "AI-ассистент"}
                      </p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Input Area */}
            <div className="space-y-4">
              {/* File Drop Zone (only show on first message) */}
              {messages.length === 0 && (
                <FileDropZone
                  files={uploadedFiles}
                  onFilesChange={setUploadedFiles}
                  disabled={isGenerating}
                  maxFiles={5}
                  maxSizeMB={10}
                />
              )}

              <Textarea
                ref={textareaRef}
                placeholder="Вставьте текст запроса МНС или опишите его содержание... (Ctrl+V для вставки скриншотов)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={handlePasteOnTextarea}
                className="min-h-[120px] resize-none"
                disabled={isGenerating}
              />

              {/* Actions */}
              <div className="flex flex-wrap gap-3 justify-end">
                {messages.length > 0 && (
                  <Button variant="outline" onClick={handleReset} disabled={isGenerating}>
                    Начать заново
                  </Button>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={isGenerating || (!inputText.trim() && uploadedFiles.length === 0)}
                  className="gap-2 bg-gradient-to-r from-primary to-accent hover:opacity-90"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Анализ...
                    </>
                  ) : messages.length > 0 ? (
                    <>
                      <Send className="h-4 w-4" />
                      Отправить
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Проанализировать gorbova AI
                    </>
                  )}
                </Button>
              </div>
            </div>
          </GlassCard>
        ) : (
          /* Result View */
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Готовый ответ
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Скопировать
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportDocx} className="gap-2">
                  <Download className="h-4 w-4" />
                  DOCX
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportPdf} className="gap-2">
                  <Download className="h-4 w-4" />
                  PDF
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleSave}
                  disabled={saveDocument.isPending}
                  className="gap-2"
                >
                  {saveDocument.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Сохранить
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[500px] rounded-lg border border-border p-6 bg-background">
              <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed">
                {finalResponse}
              </pre>
            </ScrollArea>

            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={handleReset}>
                Создать новый ответ
              </Button>
            </div>
          </GlassCard>
        )}
      </div>
    </DashboardLayout>
  );
}

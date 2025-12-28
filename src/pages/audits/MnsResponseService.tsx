import { useState, useRef, useCallback } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  FileText, 
  Upload, 
  Image, 
  Sparkles, 
  Copy, 
  Save, 
  Loader2, 
  ArrowLeft,
  Send,
  X
} from "lucide-react";
import { useMnsDocuments } from "@/hooks/useMnsDocuments";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function MnsResponseService() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { generateResponse, saveDocument, isGenerating } = useMnsDocuments();
  
  const [inputText, setInputText] = useState("");
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [finalResponse, setFinalResponse] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<string>("unknown");
  const [originalRequest, setOriginalRequest] = useState<string>("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type === "application/pdf") {
      // For PDF, we'll read as text (basic extraction)
      // In production, you'd use a proper PDF parser
      toast({
        title: "PDF загружен",
        description: "Пожалуйста, скопируйте текст из PDF и вставьте в поле ввода",
      });
    } else {
      toast({
        title: "Неподдерживаемый формат",
        description: "Используйте текст или изображение",
        variant: "destructive",
      });
    }
    
    if (e.target) e.target.value = "";
  }, [toast]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Неподдерживаемый формат",
        description: "Загрузите изображение (JPG, PNG)",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    
    if (e.target) e.target.value = "";
  }, [toast]);

  const handleSubmit = useCallback(async () => {
    if (!inputText.trim() && !uploadedImage) {
      toast({
        title: "Ошибка",
        description: "Введите текст запроса или загрузите изображение",
        variant: "destructive",
      });
      return;
    }

    // Store original request on first submission
    if (messages.length === 0) {
      setOriginalRequest(inputText);
    }

    // Add user message
    const userMessage: Message = { role: "user", content: inputText };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");

    // Build conversation history for AI
    const conversationHistory = newMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    const result = await generateResponse({
      requestText: messages.length === 0 ? inputText : undefined,
      imageBase64: messages.length === 0 ? uploadedImage || undefined : undefined,
      conversationHistory: messages.length > 0 ? conversationHistory : undefined,
    });

    if (result) {
      const assistantMessage: Message = { role: "assistant", content: result.responseText };
      setMessages([...newMessages, assistantMessage]);
      
      if (!result.needsClarification) {
        setFinalResponse(result.responseText);
        setRequestType(result.requestType);
      }
    }
    
    // Clear image after first submission
    if (uploadedImage) {
      setUploadedImage(null);
    }
  }, [inputText, uploadedImage, messages, generateResponse, toast]);

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

  const handleReset = useCallback(() => {
    setInputText("");
    setUploadedImage(null);
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
              <Textarea
                placeholder="Вставьте текст запроса МНС или опишите его содержание..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="min-h-[120px] resize-none"
                disabled={isGenerating}
              />

              {/* Uploaded Image Preview */}
              {uploadedImage && (
                <div className="relative inline-block">
                  <img
                    src={uploadedImage}
                    alt="Загруженное изображение"
                    className="max-h-32 rounded-lg border border-border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6"
                    onClick={() => setUploadedImage(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />

                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isGenerating || messages.length > 0}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Загрузить PDF
                </Button>

                <Button
                  variant="outline"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isGenerating || messages.length > 0}
                  className="gap-2"
                >
                  <Image className="h-4 w-4" />
                  Загрузить изображение
                </Button>

                <div className="flex-1" />

                {messages.length > 0 && (
                  <Button variant="outline" onClick={handleReset} disabled={isGenerating}>
                    Начать заново
                  </Button>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={isGenerating || (!inputText.trim() && !uploadedImage)}
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
                      Проанализировать запрос AI-ассистентом
                    </>
                  )}
                </Button>
              </div>
            </div>
          </GlassCard>
        ) : (
          /* Result View */
          <GlassCard className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Готовый ответ
              </h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Скопировать текст
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
                  Сохранить в историю
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

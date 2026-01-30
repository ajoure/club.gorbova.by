import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Send,
  Mail,
  MessageCircle,
  Users,
  Filter,
  Loader2,
  History,
  CheckCircle,
  XCircle,
  Sparkles,
  Eye,
  ChevronRight,
  Image,
  Video,
  Music,
  Circle,
  X,
  Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { BroadcastTemplatesSection } from "./BroadcastTemplatesSection";

interface BroadcastFilters {
  hasActiveSubscription: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
  productId: string;
  tariffId: string;
  clubId: string;
}

interface AudiencePreview {
  telegramCount: number;
  emailCount: number;
  totalCount: number;
  users: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    telegram_username: string | null;
    has_telegram: boolean;
    has_email: boolean;
  }>;
}

type MediaType = "photo" | "video" | "audio" | "video_note" | null;

interface MediaFile {
  type: MediaType;
  file: File;
  preview?: string;
}

export function BroadcastsTabContent() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<"templates" | "quick">("templates");
  const [activeTab, setActiveTab] = useState<"telegram" | "email">("telegram");
  const [message, setMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [includeButton, setIncludeButton] = useState(true);
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<MediaFile | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<BroadcastFilters>({
    hasActiveSubscription: false,
    hasTelegram: true,
    hasEmail: false,
    productId: "",
    tariffId: "",
    clubId: "",
  });

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["broadcast-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch telegram clubs
  const { data: clubs } = useQuery({
    queryKey: ["broadcast-clubs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .eq("is_active", true)
        .order("club_name");
      return data || [];
    },
  });

  // Fetch audience preview based on filters
  const { data: audience, isLoading: audienceLoading } = useQuery({
    queryKey: ["broadcast-audience", filters],
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("id, user_id, full_name, email, telegram_user_id, telegram_username");

      if (filters.hasTelegram) {
        query = query.not("telegram_user_id", "is", null);
      }

      const { data: profiles } = await query.limit(1000);

      if (!profiles) return { telegramCount: 0, emailCount: 0, totalCount: 0, users: [] };

      let filteredProfiles = profiles;

      if (filters.hasActiveSubscription) {
        const { data: activeSubs } = await supabase
          .from("subscriptions_v2")
          .select("user_id")
          .eq("status", "active");

        const activeUserIds = new Set(activeSubs?.map((a) => a.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) => activeUserIds.has(p.user_id));
      }

      if (filters.productId) {
        const { data: productSubs } = await supabase
          .from("subscriptions_v2")
          .select("user_id")
          .eq("product_id", filters.productId)
          .eq("status", "active");

        const productUserIds = new Set(productSubs?.map((s) => s.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) => productUserIds.has(p.user_id));
      }

      if (filters.clubId) {
        const { data: clubAccess } = await supabase
          .from("telegram_access")
          .select("user_id")
          .eq("club_id", filters.clubId)
          .or("active_until.is.null,active_until.gt.now()");

        const clubUserIds = new Set(clubAccess?.map((a) => a.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) => clubUserIds.has(p.user_id));
      }

      const telegramCount = filteredProfiles.filter((p) => p.telegram_user_id).length;
      const emailCount = filteredProfiles.filter((p) => p.email).length;

      return {
        telegramCount,
        emailCount,
        totalCount: filteredProfiles.length,
        users: filteredProfiles.slice(0, 50).map((p) => ({
          id: p.id,
          full_name: p.full_name,
          email: p.email,
          telegram_username: p.telegram_username,
          has_telegram: !!p.telegram_user_id,
          has_email: !!p.email,
        })),
      } as AudiencePreview;
    },
    refetchInterval: false,
  });

  // Fetch broadcast history
  const { data: history } = useQuery({
    queryKey: ["broadcast-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .in("action", ["telegram_mass_broadcast", "email_mass_broadcast"])
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: MediaType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = type === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Файл слишком большой. Максимум: ${type === "video" ? "50" : "10"} МБ`);
      return;
    }

    let preview: string | undefined;
    if (type === "photo" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    setMediaFile({ type, file, preview });
  };

  const removeMedia = () => {
    if (mediaFile?.preview) {
      URL.revokeObjectURL(mediaFile.preview);
    }
    setMediaFile(null);
  };

  // Send Telegram broadcast
  const sendTelegramMutation = useMutation({
    mutationFn: async () => {
      if (mediaFile) {
        const formData = new FormData();
        formData.append("message", message.trim());
        formData.append("include_button", String(includeButton));
        if (includeButton) {
          formData.append("button_text", buttonText);
        }
        formData.append("filters", JSON.stringify(filters));
        formData.append("media_type", mediaFile.type || "");
        formData.append("media", mediaFile.file);

        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-mass-broadcast`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to send broadcast");
        }

        return response.json();
      }

      const { data, error } = await supabase.functions.invoke("telegram-mass-broadcast", {
        body: {
          message: message.trim(),
          include_button: includeButton,
          button_text: includeButton ? buttonText : undefined,
          filters,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setMessage("");
      removeMedia();
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Send Email broadcast
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("email-mass-broadcast", {
        body: {
          subject: emailSubject.trim(),
          html: emailBody.trim(),
          filters,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setEmailSubject("");
      setEmailBody("");
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  const handleSend = () => {
    if (activeTab === "telegram") {
      if (!message.trim() && !mediaFile) {
        toast.error("Введите текст сообщения или добавьте медиа");
        return;
      }
      sendTelegramMutation.mutate();
    } else {
      if (!emailSubject.trim() || !emailBody.trim()) {
        toast.error("Заполните тему и текст письма");
        return;
      }
      sendEmailMutation.mutate();
    }
  };

  const isSendDisabled =
    (activeTab === "telegram" && !message.trim() && !mediaFile) ||
    (activeTab === "email" && (!emailSubject.trim() || !emailBody.trim())) ||
    sendTelegramMutation.isPending ||
    sendEmailMutation.isPending;

  return (
    <div className="container max-w-6xl py-6 space-y-6 overflow-auto h-full">
      {/* Main Tabs: Templates vs Quick Send */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "templates" | "quick")}>
        <TabsList>
          <TabsTrigger value="templates">📋 Шаблоны</TabsTrigger>
          <TabsTrigger value="quick">⚡ Быстрая рассылка</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <BroadcastTemplatesSection />
        </TabsContent>

        <TabsContent value="quick" className="mt-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Channel Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "telegram" | "email")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Telegram
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.telegramCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.emailCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Telegram-рассылка</CardTitle>
                  <CardDescription>
                    Сообщение будет отправлено всем пользователям с привязанным Telegram
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Media attachment */}
                  {mediaFile ? (
                    <div className="relative rounded-lg border p-3 bg-muted/50">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeMedia}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="flex items-center gap-3">
                        {mediaFile.type === "photo" && mediaFile.preview && (
                          <img
                            src={mediaFile.preview}
                            alt="Preview"
                            className="w-20 h-20 object-cover rounded"
                          />
                        )}
                        {mediaFile.type === "video" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Video className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "audio" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Music className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "video_note" && (
                          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center">
                            <Circle className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{mediaFile.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(mediaFile.file.size / 1024 / 1024).toFixed(2)} МБ
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept="image/*,video/*,audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const type = file.type.startsWith("image/")
                                ? "photo"
                                : file.type.startsWith("video/")
                                ? "video"
                                : file.type.startsWith("audio/")
                                ? "audio"
                                : null;
                              if (type) {
                                handleFileSelect(e, type);
                              }
                            }
                          }}
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <Paperclip className="h-4 w-4" />
                              Вложение
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-2" align="start">
                            <div className="space-y-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "image/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Image className="h-4 w-4" />
                                Фото
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Video className="h-4 w-4" />
                                Видео
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "audio/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Music className="h-4 w-4" />
                                Аудио
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/mp4";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Circle className="h-4 w-4" />
                                Кружок
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <span className="text-xs text-muted-foreground">
                          до 10 МБ, видео до 50 МБ
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Текст сообщения {mediaFile && "(подпись)"}</Label>
                    <Textarea
                      placeholder="Введите текст сообщения для рассылки..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={6}
                      className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                      Поддерживается Markdown: *жирный*, _курсив_, `код`
                    </p>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="includeButton"
                        checked={includeButton}
                        onCheckedChange={setIncludeButton}
                      />
                      <Label htmlFor="includeButton" className="cursor-pointer">
                        Добавить кнопку-ссылку
                      </Label>
                    </div>
                  </div>

                  {includeButton && (
                    <div className="space-y-2 pl-4 border-l-2 border-muted">
                      <Label>Текст кнопки</Label>
                      <Input
                        value={buttonText}
                        onChange={(e) => setButtonText(e.target.value)}
                        placeholder="Открыть платформу"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="email" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Email-рассылка</CardTitle>
                  <CardDescription>
                    Письмо будет отправлено на указанные email-адреса
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Тема письма</Label>
                    <Input
                      placeholder="Тема письма..."
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Текст письма (HTML)</Label>
                    <Textarea
                      placeholder="<h1>Заголовок</h1><p>Текст письма...</p>"
                      value={emailBody}
                      onChange={(e) => setEmailBody(e.target.value)}
                      rows={8}
                      className="resize-none font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Поддерживается HTML-разметка
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Send Button */}
          <Button
            size="lg"
            className="w-full gap-2"
            onClick={handleSend}
            disabled={isSendDisabled}
          >
            {(sendTelegramMutation.isPending || sendEmailMutation.isPending) ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Отправить {activeTab === "telegram" ? "в Telegram" : "на Email"}
                {audience && (
                  <Badge variant="secondary" className="ml-2">
                    {activeTab === "telegram" ? audience.telegramCount : audience.emailCount} получателей
                  </Badge>
                )}
              </>
            )}
          </Button>

          {/* History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                История рассылок
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Пока нет отправленных рассылок
                </p>
              ) : (
                <div className="space-y-3">
                  {history?.map((item) => {
                    const meta = item.meta as Record<string, unknown> | null;
                    const sent = Number(meta?.sent || 0);
                    const failed = Number(meta?.failed || 0);
                    const isTelegram = item.action === "telegram_mass_broadcast";

                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            isTelegram ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                          }`}
                        >
                          {isTelegram ? (
                            <MessageCircle className="h-5 w-5" />
                          ) : (
                            <Mail className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {String(meta?.message_preview || meta?.subject || "Рассылка")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.created_at), "dd MMM yyyy, HH:mm", {
                              locale: ru,
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            {sent}
                          </Badge>
                          {failed > 0 && (
                            <Badge variant="outline" className="gap-1">
                              <XCircle className="h-3 w-3 text-red-500" />
                              {failed}
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Filters & Preview */}
        <div className="space-y-6">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Фильтры аудитории
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="activeSubscription" className="cursor-pointer text-sm">
                  Только с активной подпиской
                </Label>
                <Switch
                  id="activeSubscription"
                  checked={filters.hasActiveSubscription}
                  onCheckedChange={(v) =>
                    setFilters((f) => ({ ...f, hasActiveSubscription: v }))
                  }
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Продукт</Label>
                <Select
                  value={filters.productId || "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, productId: v === "all" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все продукты" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все продукты</SelectItem>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Telegram-клуб</Label>
                <Select
                  value={filters.clubId || "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, clubId: v === "all" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все клубы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клубы</SelectItem>
                    {clubs?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.club_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Audience Summary */}
              <div className="rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Аудитория
                </h4>
                {audienceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Подсчёт...
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-blue-500" />
                        Telegram
                      </span>
                      <span className="font-medium">{audience?.telegramCount || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-orange-500" />
                        Email
                      </span>
                      <span className="font-medium">{audience?.emailCount || 0}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Button */}
              <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="w-full gap-2">
                    <Eye className="h-4 w-4" />
                    Просмотр получателей
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Получатели рассылки</SheetTitle>
                    <SheetDescription>
                      Первые 50 из {audience?.totalCount || 0} получателей
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(100vh-150px)] mt-4">
                    <div className="space-y-2">
                      {audience?.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {user.full_name || "Без имени"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {user.email || "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {user.has_telegram && (
                              <MessageCircle className="h-4 w-4 text-blue-500" />
                            )}
                            {user.has_email && <Mail className="h-4 w-4 text-orange-500" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Советы по рассылкам</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Персонализируйте сообщения
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Не отправляйте слишком часто
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Добавляйте призыв к действию
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

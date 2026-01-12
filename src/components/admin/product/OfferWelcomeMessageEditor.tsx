import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  MessageCircle, Link2, Image, Video, FileText, Circle, 
  X, Loader2, Eye
} from "lucide-react";
import { toast } from "sonner";
import { VideoNoteRecorder } from "@/components/admin/VideoNoteRecorder";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface OfferWelcomeMessageConfig {
  enabled: boolean;
  text: string;
  button?: {
    enabled: boolean;
    text: string;
    url: string;
  };
  media?: {
    type: "photo" | "video" | "document" | "video_note" | null;
    storage_path: string | null;
    filename?: string;
  };
}

export interface OfferMetaConfig {
  welcome_message?: OfferWelcomeMessageConfig;
}

interface OfferWelcomeMessageEditorProps {
  offerId: string | null;
  meta: OfferMetaConfig;
  onMetaChange: (meta: OfferMetaConfig) => void;
}

const MEDIA_TYPES = [
  { value: "photo", label: "Фото", icon: Image },
  { value: "video", label: "Видео", icon: Video },
  { value: "document", label: "Документ", icon: FileText },
  { value: "video_note", label: "Кружок", icon: Circle },
] as const;

export function OfferWelcomeMessageEditor({ 
  offerId, 
  meta, 
  onMetaChange 
}: OfferWelcomeMessageEditorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [videoNoteRecorderOpen, setVideoNoteRecorderOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const welcomeMessage = meta.welcome_message || {
    enabled: false,
    text: "",
    button: { enabled: false, text: "", url: "" },
    media: { type: null, storage_path: null },
  };

  const updateWelcomeMessage = useCallback((updates: Partial<OfferWelcomeMessageConfig>) => {
    onMetaChange({
      ...meta,
      welcome_message: { ...welcomeMessage, ...updates },
    });
  }, [meta, welcomeMessage, onMetaChange]);

  const handleFileUpload = async (file: File) => {
    if (!offerId) {
      toast.error("Сначала сохраните кнопку");
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `offer_${offerId}/${Date.now()}.${ext}`;
      
      const { error } = await supabase.storage
        .from('tariff-media')
        .upload(path, file, { upsert: true });

      if (error) throw error;

      // Determine media type
      let mediaType: "photo" | "video" | "document" = "document";
      if (file.type.startsWith('image/')) mediaType = "photo";
      else if (file.type.startsWith('video/')) mediaType = "video";

      updateWelcomeMessage({
        media: { type: mediaType, storage_path: path, filename: file.name },
      });
      
      toast.success("Файл загружен");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Ошибка загрузки файла");
    } finally {
      setIsUploading(false);
    }
  };

  const handleVideoNoteRecorded = async (file: File) => {
    if (!offerId) {
      toast.error("Сначала сохраните кнопку");
      return;
    }

    setIsUploading(true);
    try {
      const path = `offer_${offerId}/videonote_${Date.now()}.mp4`;
      
      const { error } = await supabase.storage
        .from('tariff-media')
        .upload(path, file, { upsert: true });

      if (error) throw error;

      updateWelcomeMessage({
        media: { type: "video_note", storage_path: path, filename: "Кружок" },
      });
      
      toast.success("Кружок записан");
      setVideoNoteRecorderOpen(false);
    } catch (err) {
      console.error("Video note upload error:", err);
      toast.error("Ошибка сохранения кружка");
    } finally {
      setIsUploading(false);
    }
  };

  const removeMedia = async () => {
    if (welcomeMessage.media?.storage_path) {
      try {
        await supabase.storage
          .from('tariff-media')
          .remove([welcomeMessage.media.storage_path]);
      } catch (err) {
        console.error("Remove media error:", err);
      }
    }
    updateWelcomeMessage({
      media: { type: null, storage_path: null },
    });
  };

  const selectedMediaType = MEDIA_TYPES.find(t => t.value === welcomeMessage.media?.type);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between p-4 h-auto border rounded-lg"
          type="button"
        >
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            <span className="font-medium">Telegram-сообщение для этой кнопки</span>
          </div>
          <div className="flex items-center gap-2">
            {welcomeMessage.enabled && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                Включено
              </span>
            )}
            <span className="text-muted-foreground text-xs">
              {isOpen ? "▲" : "▼"}
            </span>
          </div>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border rounded-lg rounded-t-none border-t-0 p-4 space-y-4">
          <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            💡 Это сообщение отправляется <strong>дополнительно</strong> к сообщению тарифа. 
            Если настроить оба — пользователь получит 2 сообщения.
          </p>

          {/* Enable welcome message */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div>
              <Label>Отправлять сообщение для этой кнопки</Label>
              <p className="text-xs text-muted-foreground">
                Персональное сообщение при покупке через эту кнопку
              </p>
            </div>
            <Switch
              checked={welcomeMessage.enabled}
              onCheckedChange={(enabled) => updateWelcomeMessage({ enabled })}
            />
          </div>

          {welcomeMessage.enabled && (
            <div className="space-y-4 animate-in fade-in-50">
              {/* Message text */}
              <div className="space-y-2">
                <Label>Текст сообщения</Label>
                <Textarea
                  placeholder="Спасибо за выбор этого тарифа! 🎉&#10;&#10;Вот ваши бонусы..."
                  value={welcomeMessage.text}
                  onChange={(e) => updateWelcomeMessage({ text: e.target.value })}
                  rows={4}
                />
              </div>

              {/* Button settings */}
              <div className="space-y-3 p-4 border rounded-lg">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="offer-button-enabled"
                    checked={welcomeMessage.button?.enabled || false}
                    onCheckedChange={(checked) => 
                      updateWelcomeMessage({ 
                        button: { 
                          ...welcomeMessage.button, 
                          enabled: !!checked,
                          text: welcomeMessage.button?.text || "Открыть",
                          url: welcomeMessage.button?.url || "",
                        } 
                      })
                    }
                  />
                  <Label htmlFor="offer-button-enabled" className="cursor-pointer">
                    Добавить кнопку со ссылкой
                  </Label>
                </div>

                {welcomeMessage.button?.enabled && (
                  <div className="grid grid-cols-2 gap-3 animate-in fade-in-50">
                    <div className="space-y-1">
                      <Label className="text-xs">Текст кнопки</Label>
                      <Input
                        placeholder="Открыть"
                        value={welcomeMessage.button.text}
                        onChange={(e) => 
                          updateWelcomeMessage({ 
                            button: { ...welcomeMessage.button!, text: e.target.value } 
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">URL</Label>
                      <Input
                        placeholder="https://..."
                        value={welcomeMessage.button.url}
                        onChange={(e) => 
                          updateWelcomeMessage({ 
                            button: { ...welcomeMessage.button!, url: e.target.value } 
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Media settings */}
              <div className="space-y-3">
                <Label>Медиа (опционально)</Label>
                
                {welcomeMessage.media?.storage_path ? (
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    {selectedMediaType && <selectedMediaType.icon className="h-5 w-5 text-primary" />}
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {welcomeMessage.media.filename || welcomeMessage.media.type}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedMediaType?.label}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={removeMedia}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {MEDIA_TYPES.map((type) => (
                      <Button
                        key={type.value}
                        variant="outline"
                        className="flex-col h-20 gap-2"
                        disabled={isUploading || !offerId}
                        onClick={() => {
                          if (type.value === "video_note") {
                            setVideoNoteRecorderOpen(true);
                          } else {
                            const input = fileInputRef.current;
                            if (input) {
                              switch (type.value) {
                                case "photo":
                                  input.accept = "image/*";
                                  break;
                                case "video":
                                  input.accept = "video/*";
                                  break;
                                case "document":
                                  input.accept = ".pdf,.doc,.docx";
                                  break;
                              }
                              input.click();
                            }
                          }
                        }}
                      >
                        {isUploading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <type.icon className="h-5 w-5" />
                        )}
                        <span className="text-xs">{type.label}</span>
                      </Button>
                    ))}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = "";
                  }}
                />

                {!offerId && (
                  <p className="text-xs text-amber-600">
                    Сначала сохраните кнопку, чтобы загрузить медиа
                  </p>
                )}
              </div>

              {/* Preview */}
              {(welcomeMessage.text || welcomeMessage.button?.enabled || welcomeMessage.media?.storage_path) && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Предпросмотр
                  </Label>
                  <div className="p-4 bg-[#1a1a2e] text-white rounded-lg max-w-sm">
                    {welcomeMessage.media?.storage_path && (
                      <div className="mb-2 p-3 bg-white/10 rounded text-center text-xs">
                        {selectedMediaType?.label}: {welcomeMessage.media.filename}
                      </div>
                    )}
                    {welcomeMessage.text && (
                      <p className="whitespace-pre-wrap text-sm mb-2">
                        {welcomeMessage.text}
                      </p>
                    )}
                    {welcomeMessage.button?.enabled && welcomeMessage.button.text && (
                      <div className="mt-2 pt-2 border-t border-white/20">
                        <Button
                          variant="link"
                          className="text-[#64b5f6] p-0 h-auto text-sm"
                        >
                          {welcomeMessage.button.text}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>

      <VideoNoteRecorder
        open={videoNoteRecorderOpen}
        onOpenChange={setVideoNoteRecorderOpen}
        onRecorded={handleVideoNoteRecorded}
      />
    </Collapsible>
  );
}

export default OfferWelcomeMessageEditor;

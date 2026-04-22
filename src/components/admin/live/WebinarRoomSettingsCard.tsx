import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Plus, Trash2, Upload, Image as ImageIcon, Music } from "lucide-react";
import { toast } from "sonner";
import {
  type RoomSettings,
  DEFAULT_ROOM_SETTINGS,
  DEFAULT_ALLOWED_COLORS,
  DEFAULT_STAFF_RESERVED_COLORS,
  readRoomSettings,
  mergeRoomSettingsIntoMetadata,
  patchRoomSettingsSection,
} from "@/lib/roomSettings";

const PRESTART_BUCKET = "webinar-prestart";

export function WebinarRoomSettingsCard({ liveEventId }: { liveEventId: string }) {
  const [settings, setSettings] = useState<RoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"cover" | "music" | "gallery" | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("live_events")
        .select("metadata")
        .eq("id", liveEventId)
        .single();
      setSettings(readRoomSettings(data?.metadata));
      setLoaded(true);
    })();
  }, [liveEventId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Re-read для merge-safety: не перетереть соседние ветки metadata,
      // даже если их изменили параллельно.
      const { data: current } = await supabase
        .from("live_events")
        .select("metadata")
        .eq("id", liveEventId)
        .single();
      const merged = mergeRoomSettingsIntoMetadata(current?.metadata, settings);
      const { error } = await supabase
        .from("live_events")
        .update({ metadata: merged })
        .eq("id", liveEventId);
      if (error) throw error;
      toast.success("Настройки комнаты сохранены");
    } catch (e: any) {
      toast.error(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const uploadFile = async (file: File, kind: "cover" | "music" | "gallery") => {
    setUploading(kind);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${liveEventId}/${kind}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(PRESTART_BUCKET).upload(path, file, {
        upsert: false,
        cacheControl: "3600",
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from(PRESTART_BUCKET).getPublicUrl(path);
      return pub.publicUrl;
    } finally {
      setUploading(null);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, "cover");
      setSettings((p) => patchRoomSettingsSection(p, "prestart", { cover_url: url }));
      toast.success("Обложка загружена");
    } catch (err: any) {
      toast.error(err.message || "Не удалось загрузить");
    }
  };

  const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, "music");
      setSettings((p) => patchRoomSettingsSection(p, "prestart", { music_url: url }));
      toast.success("Музыка загружена");
    } catch (err: any) {
      toast.error(err.message || "Не удалось загрузить");
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file, "gallery");
      setSettings((p) => patchRoomSettingsSection(p, "prestart", {
        gallery: [...p.prestart.gallery, { url, caption: "" }],
      }));
      toast.success("Изображение добавлено в галерею");
      e.target.value = "";
    } catch (err: any) {
      toast.error(err.message || "Не удалось загрузить");
    }
  };

  const updateGalleryItem = (idx: number, patch: Partial<{ url: string; caption: string }>) => {
    setSettings((p) => patchRoomSettingsSection(p, "prestart", {
      gallery: p.prestart.gallery.map((g, i) => (i === idx ? { ...g, ...patch } : g)),
    }));
  };

  const removeGalleryItem = (idx: number) => {
    setSettings((p) => patchRoomSettingsSection(p, "prestart", {
      gallery: p.prestart.gallery.filter((_, i) => i !== idx),
    }));
  };

  const toggleAllowedColor = (color: string) => {
    setSettings((p) => {
      const exists = p.entry.allowed_colors.includes(color);
      return patchRoomSettingsSection(p, "entry", {
        allowed_colors: exists
          ? p.entry.allowed_colors.filter((c) => c !== color)
          : [...p.entry.allowed_colors, color],
      });
    });
  };

  const toggleStaffReserved = (color: string) => {
    setSettings((p) => {
      const exists = p.entry.staff_reserved_colors.includes(color);
      return patchRoomSettingsSection(p, "entry", {
        staff_reserved_colors: exists
          ? p.entry.staff_reserved_colors.filter((c) => c !== color)
          : [...p.entry.staff_reserved_colors, color],
      });
    });
  };

  if (!loaded) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between sticky top-0 bg-background z-10 pb-2 border-b">
        <span className="text-sm font-medium">Комната вебинара</span>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Сохранить
        </Button>
      </div>

      {/* PRE-START */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>Pre-start экран</span>
            <Switch
              checked={settings.prestart.enabled}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "prestart", { enabled: v }))}
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Заголовок</Label>
            <Input
              className="h-8 text-xs"
              value={settings.prestart.title || ""}
              onChange={(e) => setSettings((p) => patchRoomSettingsSection(p, "prestart", { title: e.target.value }))}
              placeholder="Скоро начало вебинара"
            />
          </div>

          <div>
            <Label className="text-xs">Обложка</Label>
            <div className="flex gap-2 items-center">
              <Input
                className="h-8 text-xs flex-1"
                value={settings.prestart.cover_url || ""}
                onChange={(e) => setSettings((p) => patchRoomSettingsSection(p, "prestart", { cover_url: e.target.value }))}
                placeholder="https://..."
              />
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                <Button variant="outline" size="sm" className="h-8" asChild disabled={uploading === "cover"}>
                  <span>{uploading === "cover" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}</span>
                </Button>
              </label>
            </div>
            {settings.prestart.cover_url && (
              <img src={settings.prestart.cover_url} alt="cover" className="mt-2 max-h-32 rounded border object-cover" />
            )}
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Таймер обратного отсчёта</Label>
            <Switch
              checked={settings.prestart.timer_enabled}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "prestart", { timer_enabled: v }))}
            />
          </div>

          <div>
            <Label className="text-xs flex items-center gap-1"><Music className="h-3 w-3" /> Фоновая музыка</Label>
            <div className="flex gap-2 items-center">
              <Input
                className="h-8 text-xs flex-1"
                value={settings.prestart.music_url || ""}
                onChange={(e) => setSettings((p) => patchRoomSettingsSection(p, "prestart", { music_url: e.target.value }))}
                placeholder="https://...mp3"
              />
              <label className="cursor-pointer">
                <input type="file" accept="audio/*" className="hidden" onChange={handleMusicUpload} />
                <Button variant="outline" size="sm" className="h-8" asChild disabled={uploading === "music"}>
                  <span>{uploading === "music" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}</span>
                </Button>
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Музыка стартует только по клику пользователя (autoplay-policy браузера).</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Галерея</Label>
              <label className="cursor-pointer">
                <input type="file" accept="image/*" className="hidden" onChange={handleGalleryUpload} />
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" asChild disabled={uploading === "gallery"}>
                  <span>
                    {uploading === "gallery" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Добавить
                  </span>
                </Button>
              </label>
            </div>
            <div className="space-y-2">
              {settings.prestart.gallery.map((g, idx) => (
                <div key={idx} className="flex gap-2 items-start border rounded p-2">
                  <img src={g.url} alt="" className="h-12 w-12 object-cover rounded shrink-0" />
                  <div className="flex-1 space-y-1 min-w-0">
                    <Input
                      className="h-7 text-xs"
                      value={g.url}
                      onChange={(e) => updateGalleryItem(idx, { url: e.target.value })}
                    />
                    <Input
                      className="h-7 text-xs"
                      value={g.caption || ""}
                      onChange={(e) => updateGalleryItem(idx, { caption: e.target.value })}
                      placeholder="Подпись (опционально)"
                    />
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeGalleryItem(idx)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {!settings.prestart.gallery.length && (
                <p className="text-[11px] text-muted-foreground text-center py-2">Галерея пуста</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PARTICIPANTS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Список участников</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Виден ученикам</Label>
              <p className="text-[10px] text-muted-foreground">Если выключено — только staff видит список</p>
            </div>
            <Switch
              checked={settings.participants.visible_for_students}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "participants", { visible_for_students: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* ENTRY */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Вход в комнату</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Имя обязательно</Label>
            <Switch
              checked={settings.entry.name_required}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "entry", { name_required: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Цвет обязателен</Label>
            <Switch
              checked={settings.entry.color_required}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "entry", { color_required: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Toggle «Показывать аватар»</Label>
            <Switch
              checked={settings.entry.avatar_toggle_enabled}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "entry", { avatar_toggle_enabled: v }))}
            />
          </div>

          <div>
            <Label className="text-xs">Лимит длины имени</Label>
            <Input
              type="number"
              min={4}
              max={64}
              className="h-8 text-xs w-24"
              value={settings.entry.display_name_max_length}
              onChange={(e) => setSettings((p) => patchRoomSettingsSection(p, "entry", {
                display_name_max_length: Math.max(4, Math.min(64, Number(e.target.value) || 32)),
              }))}
            />
          </div>

          <div>
            <Label className="text-xs">Палитра цветов (allowed)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {DEFAULT_ALLOWED_COLORS.map((c) => {
                const allowed = settings.entry.allowed_colors.includes(c);
                const reserved = settings.entry.staff_reserved_colors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleAllowedColor(c)}
                    className="relative h-8 w-8 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: allowed ? "hsl(var(--foreground))" : "transparent",
                      opacity: allowed ? 1 : 0.35,
                    }}
                    title={`${c}${reserved ? " (staff only)" : ""}`}
                  >
                    {reserved && (
                      <span className="absolute -top-1 -right-1 text-[8px] bg-background border rounded-full px-1">S</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <Label className="text-xs">Только для staff (reserved)</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {settings.entry.allowed_colors.map((c) => {
                const reserved = settings.entry.staff_reserved_colors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleStaffReserved(c)}
                    className="h-7 px-2 rounded text-[10px] border flex items-center gap-1"
                    style={{
                      backgroundColor: reserved ? c : "transparent",
                      color: reserved ? "white" : "inherit",
                      borderColor: c,
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
                    {reserved ? "Staff" : "All"}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Серверный guard (validate_nickname_color) блокирует выбор зарезервированных цветов non-staff.
            </p>
          </div>

          {/* Privacy preview */}
          <div className="rounded border bg-muted/40 p-2 space-y-1">
            <p className="text-[10px] font-medium">Что увидит пользователь:</p>
            <p className="text-[10px] text-muted-foreground">• «Другие участники увидят только это имя»</p>
            <p className="text-[10px] text-muted-foreground">• «Аватар будет показан только если вы включите эту опцию»</p>
            <p className="text-[10px] text-muted-foreground">• «Администратор видит ваши контактные данные отдельно»</p>
          </div>
        </CardContent>
      </Card>

      {/* CHAT & REACTIONS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Чат и реакции</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs">Нормализация emoji в чате</Label>
              <p className="text-[10px] text-muted-foreground">:) → 🙂 (render-time, SoT не меняется)</p>
            </div>
            <Switch
              checked={settings.chat.emoji_normalization_enabled}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "chat", { emoji_normalization_enabled: v }))}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Реакции включены</Label>
            <Switch
              checked={settings.reactions.enabled}
              onCheckedChange={(v) => setSettings((p) => patchRoomSettingsSection(p, "reactions", { enabled: v }))}
            />
          </div>
          <div>
            <Label className="text-xs">Лимит реакций (per min на user)</Label>
            <Input
              type="number"
              min={1}
              max={120}
              className="h-8 text-xs w-24"
              value={settings.reactions.rate_limit_per_min}
              onChange={(e) => setSettings((p) => patchRoomSettingsSection(p, "reactions", {
                rate_limit_per_min: Math.max(1, Math.min(120, Number(e.target.value) || 10)),
              }))}
            />
            <p className="text-[10px] text-muted-foreground mt-1">DB rate-limit: can_send_reaction()</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2 border-t">
        <Button size="sm" className="h-8 text-xs gap-1" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Сохранить настройки комнаты
        </Button>
      </div>
    </div>
  );
}

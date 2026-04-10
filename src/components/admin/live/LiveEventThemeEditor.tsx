import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

interface RoomTheme {
  background_color?: string;
  primary_text_color?: string;
  secondary_text_color?: string;
  panel_color?: string;
  accent_color?: string;
  tabs_color?: string;
  admin_badge_color?: string;
  employee_badge_color?: string;
}

const DEFAULT_THEME: RoomTheme = {
  background_color: "",
  primary_text_color: "",
  secondary_text_color: "",
  panel_color: "",
  accent_color: "",
  tabs_color: "",
  admin_badge_color: "",
  employee_badge_color: "",
};

const FIELD_LABELS: Record<keyof RoomTheme, string> = {
  background_color: "Фон",
  primary_text_color: "Основной текст",
  secondary_text_color: "Вторичный текст",
  panel_color: "Панели",
  accent_color: "Акцент",
  tabs_color: "Вкладки",
  admin_badge_color: "Бейдж админа",
  employee_badge_color: "Бейдж сотрудника",
};

export function LiveEventThemeEditor({ liveEventId }: { liveEventId: string }) {
  const { session } = useAuth();
  const [theme, setTheme] = useState<RoomTheme>(DEFAULT_THEME);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("live_events")
        .select("metadata")
        .eq("id", liveEventId)
        .single();
      if (data?.metadata?.room_theme) {
        setTheme({ ...DEFAULT_THEME, ...data.metadata.room_theme });
      }
      setLoaded(true);
    })();
  }, [liveEventId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Get current metadata
      const { data: current } = await supabase
        .from("live_events")
        .select("metadata")
        .eq("id", liveEventId)
        .single();

      const existingMeta = (current?.metadata || {}) as Record<string, any>;

      // Clean empty values
      const cleanTheme: Record<string, string> = {};
      for (const [k, v] of Object.entries(theme)) {
        if (v) cleanTheme[k] = v;
      }

      const { error } = await supabase
        .from("live_events")
        .update({
          metadata: { ...existingMeta, room_theme: cleanTheme },
        })
        .eq("id", liveEventId);

      if (error) throw error;
      toast.success("Тема сохранена");
    } catch (e: any) {
      toast.error(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => setTheme(DEFAULT_THEME);

  if (!loaded) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Тема комнаты</span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleReset}>
            <RotateCcw className="h-3 w-3" /> Сбросить
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(FIELD_LABELS) as Array<keyof RoomTheme>).map((field) => (
          <div key={field} className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">{FIELD_LABELS[field]}</Label>
            <div className="flex gap-1.5 items-center">
              <Input
                type="color"
                className="h-7 w-8 p-0.5 cursor-pointer"
                value={theme[field] || "#000000"}
                onChange={(e) => setTheme((prev) => ({ ...prev, [field]: e.target.value }))}
              />
              <Input
                className="h-7 text-xs flex-1 font-mono"
                value={theme[field] || ""}
                onChange={(e) => setTheme((prev) => ({ ...prev, [field]: e.target.value }))}
                placeholder="По умолчанию"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      <div
        className="rounded-lg border p-4 text-center text-xs"
        style={{
          backgroundColor: theme.background_color || undefined,
          color: theme.primary_text_color || undefined,
        }}
      >
        <p style={{ color: theme.primary_text_color || undefined }}>Основной текст</p>
        <p style={{ color: theme.secondary_text_color || undefined }}>Вторичный текст</p>
        <div className="flex justify-center gap-2 mt-2">
          <span className="px-2 py-0.5 rounded text-[10px] text-white" style={{ backgroundColor: theme.accent_color || "hsl(var(--primary))" }}>Акцент</span>
          <span className="px-2 py-0.5 rounded text-[10px] text-white" style={{ backgroundColor: theme.admin_badge_color || "#6366f1" }}>Админ</span>
          <span className="px-2 py-0.5 rounded text-[10px] text-white" style={{ backgroundColor: theme.employee_badge_color || "#8b5cf6" }}>Сотрудник</span>
        </div>
      </div>
    </div>
  );
}

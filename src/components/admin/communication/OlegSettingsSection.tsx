import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Bot,
  Settings2,
  MessageSquare,
  Sliders,
  Package,
  Loader2,
  Save,
} from "lucide-react";

const PRESET_OPTIONS = [
  { value: "strict", label: "Строгий", description: "Коротко, по делу" },
  { value: "friendly", label: "Дружелюбный", description: "Тепло, человечно" },
  { value: "sales", label: "Продажи", description: "Фокус на конверсию" },
  { value: "support_calm", label: "Поддержка", description: "Эмпатия" },
];

const DEFAULT_TOGGLES = {
  auto_reply_enabled: true,
  irony_enabled: false,
  smalltalk_enabled: true,
  sales_enabled: true,
  support_enabled: true,
  faq_first_enabled: false,
  quiet_hours_enabled: false,
};

const DEFAULT_SLIDERS = {
  brevity_level: 50,
  warmth_level: 70,
  formality_level: 50,
  sales_assertiveness: 30,
  humor_level: 20,
  risk_aversion: 60,
};

const DEFAULT_TEMPLATES = {
  greeting_template: "Привет! Я Олег. Чем могу помочь?",
  followup_template: "Как там ваша ситуация — получилось?",
  escalation_template: "Передаю ваш вопрос руководителю.",
  fallback_template: "Не совсем понял. Можете уточнить?",
  sales_close_template: "Готово! Вот ссылка на оплату:",
};

export function OlegSettingsSection() {
  const queryClient = useQueryClient();
  const [hasChanges, setHasChanges] = useState(false);
  
  // Local state for edits
  const [localPreset, setLocalPreset] = useState<string | null>(null);
  const [localToggles, setLocalToggles] = useState<Record<string, boolean>>({});
  const [localSliders, setLocalSliders] = useState<Record<string, number>>({});
  const [localTemplates, setLocalTemplates] = useState<Record<string, string>>({});
  const [localPackages, setLocalPackages] = useState<string[] | null>(null);

  // Fetch first active bot
  const { data: bots = [], isLoading: loadingBots } = useQuery({
    queryKey: ["telegram-bots-for-ai"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_bots")
        .select("id, bot_name, bot_username, status")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const activeBotId = bots[0]?.id;

  // Fetch settings
  const { data: settings, isLoading: loadingSettings } = useQuery({
    queryKey: ["ai-bot-settings", activeBotId],
    queryFn: async () => {
      if (!activeBotId) return null;
      const { data, error } = await supabase
        .from("ai_bot_settings")
        .select("*")
        .eq("bot_id", activeBotId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!activeBotId,
  });

  // Fetch packages
  const { data: packages = [] } = useQuery({
    queryKey: ["ai-prompt-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_prompt_packages")
        .select("*")
        .order("category");
      if (error) throw error;
      return data || [];
    },
  });

  // Merge with defaults
  const dbToggles = (settings?.toggles || {}) as Record<string, boolean>;
  const dbSliders = (settings?.sliders || {}) as Record<string, number>;
  const dbTemplates = (settings?.templates || {}) as Record<string, string>;
  const dbPackages = settings?.active_prompt_packages || ["support_base", "tone_katerina"];
  
  const currentPreset = localPreset ?? settings?.style_preset ?? "friendly";
  const currentToggles = { ...DEFAULT_TOGGLES, ...dbToggles, ...localToggles };
  const currentSliders = { ...DEFAULT_SLIDERS, ...dbSliders, ...localSliders };
  const currentTemplates = { ...DEFAULT_TEMPLATES, ...dbTemplates, ...localTemplates };
  const currentPackages = localPackages ?? dbPackages;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeBotId) throw new Error("No bot");
      const { error } = await supabase.from("ai_bot_settings").upsert({
        bot_id: activeBotId,
        style_preset: currentPreset,
        toggles: currentToggles,
        sliders: currentSliders,
        templates: currentTemplates,
        active_prompt_packages: currentPackages,
        updated_at: new Date().toISOString(),
      }, { onConflict: "bot_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-bot-settings"] });
      setHasChanges(false);
      setLocalPreset(null);
      setLocalToggles({});
      setLocalSliders({});
      setLocalTemplates({});
      setLocalPackages(null);
      toast.success("Настройки сохранены");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loadingBots) {
    return (
      <GlassCard className="p-6">
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      </GlassCard>
    );
  }

  if (!activeBotId) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">🤖 Олег — AI-бот</h2>
        </div>
        <p className="text-muted-foreground">Нет активных ботов.</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">🤖 Олег — AI-бот поддержки</h2>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={!hasChanges || saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Сохранить
        </Button>
      </div>

      {loadingSettings ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <Accordion type="multiple" defaultValue={["toggles", "style"]} className="space-y-4">
          {/* Toggles */}
          <AccordionItem value="toggles" className="border rounded-lg px-4">
            <AccordionTrigger><div className="flex items-center gap-2"><Settings2 className="w-4 h-4" />Глобальные настройки</div></AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="grid gap-4 sm:grid-cols-2">
                {Object.entries(DEFAULT_TOGGLES).map(([key]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label>{key.replace(/_/g, " ")}</Label>
                    <Switch
                      checked={currentToggles[key]}
                      onCheckedChange={v => { setLocalToggles(p => ({ ...p, [key]: v })); setHasChanges(true); }}
                    />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Style */}
          <AccordionItem value="style" className="border rounded-lg px-4">
            <AccordionTrigger><div className="flex items-center gap-2"><Sliders className="w-4 h-4" />Стиль</div></AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-6">
              <div className="space-y-2">
                <Label>Пресет</Label>
                <Select value={currentPreset} onValueChange={v => { setLocalPreset(v); setHasChanges(true); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESET_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {Object.entries(DEFAULT_SLIDERS).map(([key]) => (
                  <div key={key} className="space-y-2">
                    <div className="flex justify-between"><Label>{key.replace(/_/g, " ")}</Label><span className="text-sm text-muted-foreground">{currentSliders[key]}%</span></div>
                    <Slider value={[currentSliders[key]]} onValueChange={([v]) => { setLocalSliders(p => ({ ...p, [key]: v })); setHasChanges(true); }} max={100} step={5} />
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Templates */}
          <AccordionItem value="templates" className="border rounded-lg px-4">
            <AccordionTrigger><div className="flex items-center gap-2"><MessageSquare className="w-4 h-4" />Шаблоны</div></AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-4">
              {Object.entries(DEFAULT_TEMPLATES).map(([key]) => (
                <div key={key} className="space-y-2">
                  <Label>{key.replace(/_/g, " ")}</Label>
                  <Textarea value={currentTemplates[key]} onChange={e => { setLocalTemplates(p => ({ ...p, [key]: e.target.value })); setHasChanges(true); }} rows={2} />
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>

          {/* Packages */}
          <AccordionItem value="packages" className="border rounded-lg px-4">
            <AccordionTrigger><div className="flex items-center gap-2"><Package className="w-4 h-4" />Пакеты промптов</div></AccordionTrigger>
            <AccordionContent className="pt-4 pb-2 space-y-2">
              {packages.map((pkg: any) => (
                <div key={pkg.id} className={cn("flex items-center justify-between p-3 rounded-lg border", currentPackages.includes(pkg.code) ? "bg-primary/5 border-primary/20" : "bg-muted/30")}>
                  <div className="flex items-center gap-3">
                    <Switch checked={currentPackages.includes(pkg.code)} onCheckedChange={() => {
                      const newPkgs = currentPackages.includes(pkg.code) ? currentPackages.filter((c: string) => c !== pkg.code) : [...currentPackages, pkg.code];
                      setLocalPackages(newPkgs);
                      setHasChanges(true);
                    }} />
                    <div><p className="font-medium text-sm">{pkg.name}</p><p className="text-xs text-muted-foreground">{pkg.description}</p></div>
                  </div>
                  <Badge variant="outline" className="text-xs">{pkg.category}</Badge>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </GlassCard>
  );
}

/**
 * CharterIntakeStep — Step 2: Charter upload/text/manual + confirmation.
 * 
 * Three equal modes: Upload, Text, Manual.
 * Includes extraction pipeline status bar.
 */

import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, PenLine, AlertTriangle, Check, Loader2, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { extractTextFromFile } from "@/utils/fileExtractor";
import type {
  CorporateDraftSession,
  CharterRules,
  CharterSourceType,
  CharterExtractionStatus,
} from "@/lib/corporate/corporateTypes";
import { DEFAULT_CHARTER_RULES } from "@/lib/corporate/corporateTypes";

interface Props {
  session: CorporateDraftSession;
  onUpdate: (patch: Record<string, unknown>) => Promise<unknown>;
  onConfirmRules: (rules: Record<string, unknown>, confirmedBy: 'ai_extraction' | 'manual') => Promise<void>;
  onNext: () => void;
}

/** Sanitize filename for Supabase storage key */
function sanitizeStorageKey(filename: string): string {
  const ext = filename.lastIndexOf('.') > 0 ? filename.slice(filename.lastIndexOf('.')) : '';
  const base = filename.slice(0, filename.length - ext.length);
  const slug = base
    .toLowerCase()
    .replace(/[а-яё]/gi, (c) => {
      const map: Record<string, string> = {
        а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'j',
        к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',
        х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya',
        ъ:'',ь:''
      };
      return map[c.toLowerCase()] || c;
    })
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
  return `${Date.now()}_${slug}${ext}`;
}

/** Pipeline status display */
function ExtractionStatusBar({ status }: { status: CharterExtractionStatus | null }) {
  const steps: { key: CharterExtractionStatus; label: string }[] = [
    { key: 'none', label: 'Устав не загружен' },
    { key: 'pending', label: 'Файл загружен' },
    { key: 'extracted', label: 'Текст извлечён' },
    { key: 'confirmed', label: 'Правила подтверждены' },
  ];

  const currentStatus = status || 'none';
  const isFailed = currentStatus === 'failed';
  const currentIdx = isFailed ? 1 : steps.findIndex(s => s.key === currentStatus);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, idx) => {
        let variant: 'default' | 'secondary' | 'outline' | 'destructive' = 'outline';
        let icon = null;

        if (isFailed && idx === 1) {
          variant = 'destructive';
          icon = <X className="h-3 w-3 mr-1" />;
        } else if (idx < currentIdx) {
          variant = 'default';
          icon = <Check className="h-3 w-3 mr-1" />;
        } else if (idx === currentIdx && !isFailed) {
          variant = currentStatus === 'confirmed' ? 'default' : 'secondary';
          icon = currentStatus === 'confirmed' ? <Check className="h-3 w-3 mr-1" /> : <Clock className="h-3 w-3 mr-1" />;
        }

        return (
          <Badge key={step.key} variant={variant} className="text-[10px] px-2 py-0.5">
            {icon}
            {step.label}
          </Badge>
        );
      })}
      {isFailed && (
        <Badge variant="destructive" className="text-[10px] px-2 py-0.5">
          <X className="h-3 w-3 mr-1" />
          Ошибка извлечения
        </Badge>
      )}
    </div>
  );
}

export function CharterIntakeStep({ session, onUpdate, onConfirmRules, onNext }: Props) {
  const [tab, setTab] = useState<string>(
    session.charter_source_type === 'text' ? 'text'
    : session.charter_source_type === 'manual' ? 'manual'
    : 'upload'
  );
  const [charterText, setCharterText] = useState(session.charter_raw_text || "");
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const existingRules = session.confirmed_charter_rules as Partial<CharterRules> ?? {};
  const [rules, setRules] = useState<CharterRules>({
    ...DEFAULT_CHARTER_RULES,
    ...existingRules,
  });

  const isCharterConfirmed = session.charter_extraction_status === 'confirmed';
  const extractionStatus = (session.charter_extraction_status || 'none') as CharterExtractionStatus;

  // File upload handler — sanitized key
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      let sourceType: CharterSourceType = 'upload_docx';
      if (file.type === 'application/pdf') sourceType = 'upload_pdf';
      else if (file.type.startsWith('image/')) sourceType = 'upload_image';

      const safeFilename = sanitizeStorageKey(file.name);
      const filePath = `${session.profile_id}/${session.id}/${safeFilename}`;

      const { error: uploadError } = await supabase.storage
        .from('charter-documents')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      let rawText = '';
      try {
        const extracted = await extractTextFromFile(file);
        rawText = extracted?.text || '';
      } catch {
        // extraction may fail for images/PDFs
      }

      await onUpdate({
        charter_source_type: sourceType,
        charter_file_path: filePath,
        charter_raw_text: rawText || null,
        charter_extraction_status: rawText ? 'extracted' : 'pending',
        status: 'charter_pending',
        metadata: {
          ...(session.metadata || {}),
          original_filename: file.name,
        },
      });

      if (rawText) {
        setCharterText(rawText);
        toast.success("Текст извлечён из документа");
      } else {
        toast.info("Файл загружен. Для изображений и PDF извлечение текста может быть ограничено — заполните правила вручную.");
      }
    } catch (err: any) {
      toast.error("Ошибка загрузки: " + (err.message || ""));
    } finally {
      setIsUploading(false);
    }
  }, [session, onUpdate]);

  // Save text
  const handleSaveText = async () => {
    await onUpdate({
      charter_source_type: 'text' as CharterSourceType,
      charter_raw_text: charterText,
      charter_extraction_status: 'extracted',
      status: 'charter_pending',
    });
    toast.success("Текст устава сохранён");
  };

  // Confirm rules — correctly transitions state
  const handleConfirmRules = async () => {
    setIsConfirming(true);
    try {
      await onConfirmRules(rules as unknown as Record<string, unknown>, 'manual');
      toast.success("Правила устава подтверждены");
      onNext();
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || ""));
    } finally {
      setIsConfirming(false);
    }
  };

  // Skip charter (law defaults)
  const handleSkip = async () => {
    setIsConfirming(true);
    try {
      await onConfirmRules(DEFAULT_CHARTER_RULES as unknown as Record<string, unknown>, 'manual');
      toast.info("Используются общие правила закона. Рекомендуется загрузить устав позднее.");
      onNext();
    } catch (err: any) {
      toast.error("Ошибка: " + (err.message || ""));
    } finally {
      setIsConfirming(false);
    }
  };

  const originalFilename = (session.metadata as any)?.original_filename;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Устав общества</h3>
        <p className="text-sm text-muted-foreground">
          Загрузите устав или заполните ключевые правила вручную. Это необходимо для корректного определения состава документов.
        </p>
      </div>

      {/* Extraction pipeline status */}
      <ExtractionStatusBar status={extractionStatus} />

      {isCharterConfirmed && (
        <GlassCard className="p-3 border-green-200 bg-green-50/50 dark:bg-green-950/20">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <Check className="h-4 w-4" />
            <span className="text-sm font-medium">Правила устава подтверждены</span>
            <Badge variant="outline" className="text-xs">
              {session.charter_confirmed_by === 'ai_extraction' ? 'Извлечено из устава' : 'Подтверждено пользователем'}
            </Badge>
          </div>
        </GlassCard>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upload">
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            Загрузить
          </TabsTrigger>
          <TabsTrigger value="text">
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            Текст
          </TabsTrigger>
          <TabsTrigger value="manual">
            <PenLine className="h-3.5 w-3.5 mr-1.5" />
            Вручную
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-4">
          <div>
            <Label>Загрузите файл устава (DOCX, PDF или изображение)</Label>
            <Input
              type="file"
              className="mt-2"
              accept=".docx,.doc,.pdf,.png,.jpg,.jpeg,.webp"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
            {isUploading && (
              <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка и извлечение текста...
              </div>
            )}
          </div>
          {session.charter_file_path && (
            <p className="text-sm text-muted-foreground">
              Файл загружен: {originalFilename || session.charter_file_path.split('/').pop()}
            </p>
          )}
        </TabsContent>

        <TabsContent value="text" className="space-y-4">
          <div>
            <Label>Вставьте текст устава</Label>
            <Textarea
              className="mt-2 min-h-[200px]"
              placeholder="Вставьте текст устава общества..."
              value={charterText}
              onChange={(e) => setCharterText(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            onClick={handleSaveText}
            disabled={!charterText.trim()}
          >
            Сохранить текст
          </Button>
        </TabsContent>

        <TabsContent value="manual" className="space-y-4">
          <GlassCard className="p-3 border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Данные подтверждены пользователем, не извлечены из устава. Рекомендуется загрузить устав для верификации.
              </p>
            </div>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Charter rules form */}
      <div className="space-y-4 border-t pt-4">
        <h4 className="text-sm font-semibold">Ключевые правила устава</h4>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Кто созывает собрание</Label>
            <Select
              value={rules.convening_authority}
              onValueChange={(v) => setRules({ ...rules, convening_authority: v as any })}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="director">Руководитель</SelectItem>
                <SelectItem value="board">Совет директоров</SelectItem>
                <SelectItem value="participants">Участники</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Минимальный срок извещения (дней)</Label>
            <Input
              type="number"
              className="mt-1"
              value={rules.notice_days_min}
              onChange={(e) => setRules({ ...rules, notice_days_min: Number(e.target.value) })}
              min={1}
            />
          </div>

          <div>
            <Label className="text-xs">Способ извещения</Label>
            <Select
              value={rules.notice_method}
              onValueChange={(v) => setRules({ ...rules, notice_method: v })}
            >
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="registered_mail">Заказное письмо</SelectItem>
                <SelectItem value="courier">Курьер</SelectItem>
                <SelectItem value="email">Электронная почта</SelectItem>
                <SelectItem value="other">Иной способ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Кворум (%)</Label>
            <Input
              type="number"
              className="mt-1"
              value={rules.quorum_percent}
              onChange={(e) => setRules({ ...rules, quorum_percent: Number(e.target.value) })}
              min={1}
              max={100}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Совет директоров (наблюдательный совет)</Label>
            <Switch checked={rules.has_board} onCheckedChange={(v) => setRules({ ...rules, has_board: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Ревизор</Label>
            <Switch checked={rules.has_auditor} onCheckedChange={(v) => setRules({ ...rules, has_auditor: v })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Ревизионная комиссия</Label>
            <Switch checked={rules.has_audit_commission} onCheckedChange={(v) => setRules({ ...rules, has_audit_commission: v })} />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={handleConfirmRules} disabled={isConfirming} className="flex-1">
          {isConfirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
          Подтвердить правила
        </Button>
        <Button variant="ghost" onClick={handleSkip} disabled={isConfirming} className="text-muted-foreground">
          Пропустить
        </Button>
      </div>
    </div>
  );
}

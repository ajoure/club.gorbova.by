import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, FileText, SearchCheck } from "lucide-react";
import type { ChatScenario } from "@/hooks/useAiChat";

interface PromptRunFlowProps {
  scenario: ChatScenario;
  onSubmit: (files: File[], text?: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".jpg", ".jpeg", ".png", ".webp"];
const MAX_FILES = 5;

export function PromptRunFlow({ scenario, onSubmit, onCancel, isLoading }: PromptRunFlowProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles = Array.from(fileList).filter(f => {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
      return ALLOWED_EXTENSIONS.includes(ext);
    });
    setFiles(prev => [...prev, ...newFiles].slice(0, MAX_FILES));
  };

  const removeFile = (idx: number) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const isFileType = scenario.type === "file_analysis" || scenario.type === "document_review";
  const isAssetClassifier = scenario.code === "asset_classifier";

  return (
    <GlassCard className="mx-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-sm">{scenario.launcher_title}</h4>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {scenario.input_hint && (
        <p className="text-xs text-muted-foreground mb-3">{scenario.input_hint}</p>
      )}

      {isFileType && (
        <>
          <div
            className="border-2 border-dashed border-border/50 rounded-lg p-4 text-center cursor-pointer hover:border-primary/30 transition-colors"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground">Перетащите файлы или нажмите для выбора</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">PDF, Excel, Word, изображения (макс. {MAX_FILES})</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />

          {files.length > 0 && (
            <div className="mt-3 space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate flex-1">{f.name}</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeFile(i)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {isAssetClassifier && (
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2">
            <SearchCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground">
              ИИ распознаёт тип и назначение объекта. Шифр, нормативное наименование
              и срок службы выбираются только из справочника постановления № 161.
            </p>
          </div>
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, 4_000))}
            placeholder="Например: iPhone 16, мобильный телефон для звонков и доступа в интернет"
            className="min-h-[96px] resize-y text-base sm:text-sm"
            autoFocus
          />
          <div className="text-right text-[10px] text-muted-foreground">
            {text.length} / 4000
          </div>
        </div>
      )}

      <Button
        className="w-full mt-3"
        disabled={
          isLoading ||
          (isFileType && files.length === 0) ||
          (isAssetClassifier && text.trim().length < 3)
        }
        onClick={() => onSubmit(files, text)}
      >
        {isLoading
          ? (isAssetClassifier ? "Подбираю..." : "Анализирую...")
          : (isAssetClassifier ? "ОК" : "Анализировать")}
      </Button>
    </GlassCard>
  );
}

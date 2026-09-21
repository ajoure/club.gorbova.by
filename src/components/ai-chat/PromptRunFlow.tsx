import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/GlassCard";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, FileText, SearchCheck, Info, AlertCircle } from "lucide-react";
import type { ChatScenario } from "@/hooks/useAiChat";

interface PromptRunFlowProps {
  scenario: ChatScenario;
  onSubmit: (files: File[], text?: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

// Text-based bank exports are deliberately accepted alongside office formats.
// Binary formats still go through the extraction guard before the analysis starts.
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".rtf", ".xls", ".xlsx", ".csv", ".xml", ".json", ".sta", ".txt", ".jpg", ".jpeg", ".png", ".webp"];
const BANK_STATEMENT_EXTENSIONS = [".pdf", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".jpg", ".jpeg", ".png", ".webp"];
const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 20;

export function PromptRunFlow({ scenario, onSubmit, onCancel, isLoading }: PromptRunFlowProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isBankStatement = scenario.code === "bank_statement_analysis";

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    setFileError(null);
    const selectedFiles = Array.from(fileList);
    const unsupportedFiles = selectedFiles.filter(f => {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
      const allowedExtensions = isBankStatement ? BANK_STATEMENT_EXTENSIONS : ALLOWED_EXTENSIONS;
      return !allowedExtensions.includes(ext);
    });
    if (unsupportedFiles.length > 0) {
      setFileError(`Не поддерживается формат: ${unsupportedFiles.map(file => file.name).join(", ")}. Выберите PDF, XLSX/XLS, CSV, TXT, DOCX, JPG, PNG или WebP.`);
      return;
    }
    const oversizedFiles = isBankStatement
      ? selectedFiles.filter(file => file.size > MAX_FILE_SIZE_MB * 1024 * 1024)
      : [];
    if (oversizedFiles.length > 0) {
      setFileError(`Файл больше ${MAX_FILE_SIZE_MB} МБ: ${oversizedFiles.map(file => file.name).join(", ")}. Уменьшите файл или разделите выписку по месяцам.`);
      return;
    }
    if (files.length + selectedFiles.length > MAX_FILES) {
      setFileError(`Можно загрузить не более ${MAX_FILES} файлов за один анализ.`);
      return;
    }
    const newFiles = selectedFiles;
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

      {isBankStatement && (
        <div className="mb-3 rounded-lg border border-blue-200/70 bg-blue-50/70 p-3 text-xs text-slate-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-slate-200">
          <div className="mb-2 flex items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
            <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            Как подготовить выписку
          </div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Лучше всего загрузить экспорт из интернет-банка в XLSX, XLS, CSV или PDF с выделяемым текстом.</li>
            <li>Один файл — один счёт и один период. Рекомендуемый период — до одного календарного месяца; более длинную выписку разделите по месяцам.</li>
            <li>Можно загрузить до {MAX_FILES} файлов, каждый — до {MAX_FILE_SIZE_MB} МБ.</li>
            <li>Сканы и фотографии должны быть чёткими, без обрезанных строк и повёрнутых страниц. За один запуск — суммарно до 5 страниц скана или изображений.</li>
            <li>В выписке должны читаться дата, сумма, назначение платежа, наименование получателя и его УНП. Файлы с паролем не поддерживаются.</li>
          </ul>
        </div>
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
            <p className="text-[10px] text-muted-foreground/60 mt-1">PDF, Excel/CSV, XML/JSON/MT940, Word, текст, изображения (макс. {MAX_FILES})</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={isBankStatement
              ? BANK_STATEMENT_EXTENSIONS.join(",")
              : ALLOWED_EXTENSIONS.join(",")}
            className="hidden"
            onChange={e => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {fileError && (
            <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{fileError}</span>
            </div>
          )}

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

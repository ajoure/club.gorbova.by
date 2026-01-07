import React, { useState, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  Upload, FileSpreadsheet, Sparkles, ArrowRight, ArrowLeft, 
  Check, X, Loader2, AlertCircle, Brain, Save, RefreshCw,
  ChevronDown, ChevronRight, Info
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface SmartImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId?: string;
}

interface ParsedRow {
  [key: string]: unknown;
}

interface ColumnMapping {
  email: string | null;
  phone: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  offerName: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  createdAt: string | null;
  paidAt: string | null;
  externalId: string | null;
}

interface TariffSuggestion {
  pattern: string;
  count: number;
  action: "map_to_tariff" | "use_secondary_field" | "skip" | "create_rule" | "needs_review" | "archive_unknown";
  targetTariffId: string | null;
  targetTariffCode: string | null;
  secondaryField: string | null;
  confidence: number;
  reason: string;
  suggestedPrice?: number; // Price from data for manual review
  userChoice?: string; // User's override choice
}

interface DuplicateInfo {
  email: string;
  count: number;
  names: string[];
}

interface ImportSettings {
  statusFilter: string[];
  duplicateHandling: "skip" | "update";
  mergeEmailDuplicates: boolean;
  normalizeNames: boolean;
  dateField: "createdAt" | "paidAt";
  createGhostProfiles: boolean;
}

const STEPS = [
  { id: 1, name: "Загрузка файла", icon: Upload },
  { id: 2, name: "Маппинг колонок", icon: Brain },
  { id: 3, name: "Маппинг тарифов", icon: Sparkles },
  { id: 4, name: "Настройки", icon: RefreshCw },
  { id: 5, name: "Импорт", icon: Check },
];

const DEFAULT_MAPPING: ColumnMapping = {
  email: null,
  phone: null,
  fullName: null,
  firstName: null,
  lastName: null,
  offerName: null,
  amount: null,
  currency: null,
  status: null,
  createdAt: null,
  paidAt: null,
  externalId: null,
};

const DEFAULT_SETTINGS: ImportSettings = {
  statusFilter: ["Оплачено", "Завершён", "В процессе"],
  duplicateHandling: "skip",
  mergeEmailDuplicates: true,
  normalizeNames: true,
  dateField: "createdAt",
  createGhostProfiles: true,
};

export function SmartImportWizard({ open, onOpenChange, instanceId }: SmartImportWizardProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  
  // Step 1: File
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  
  // Step 2: Column mapping
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>(DEFAULT_MAPPING);
  const [tariffField, setTariffField] = useState<string | null>(null);
  const [isAnalyzingColumns, setIsAnalyzingColumns] = useState(false);
  
  // Step 3: Tariff mapping
  const [tariffSuggestions, setTariffSuggestions] = useState<TariffSuggestion[]>([]);
  const [isAnalyzingTariffs, setIsAnalyzingTariffs] = useState(false);
  const [expandedOffers, setExpandedOffers] = useState<Set<string>>(new Set());
  
  // Step 4: Settings
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_SETTINGS);
  
  // Step 5: Import
  const [importResult, setImportResult] = useState<{
    success: number;
    skipped: number;
    errors: { row: number; error: string }[];
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Fetch existing tariffs
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-import"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, code, name, product_id, original_price")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch existing mapping rules
  const { data: mappingRules } = useQuery({
    queryKey: ["import-mapping-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_mapping_rules")
        .select("*")
        .eq("is_active", true)
        .order("priority", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Parse Excel file
  const parseFile = useCallback(async (file: File) => {
    return new Promise<{ headers: string[]; rows: ParsedRow[] }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: "binary" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
          
          const headers = (jsonData[0] || []).map(h => String(h || ""));
          const rows: ParsedRow[] = jsonData.slice(1).map((row) => {
            const obj: ParsedRow = {};
            headers.forEach((h, i) => {
              obj[h] = (row as unknown[])[i];
            });
            return obj;
          });
          
          resolve({ headers, rows });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  }, []);

  // Handle file upload
  const handleFileUpload = async (uploadedFile: File) => {
    setFile(uploadedFile);
    try {
      const { headers: parsedHeaders, rows: parsedRows } = await parseFile(uploadedFile);
      setHeaders(parsedHeaders);
      setRows(parsedRows);
      toast.success(`Загружено ${parsedRows.length} строк`);
    } catch (err) {
      toast.error("Ошибка при чтении файла");
      setFile(null);
    }
  };

  // AI Column Analysis
  const analyzeColumns = async () => {
    if (!headers.length || !rows.length) return;
    
    setIsAnalyzingColumns(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-import-analyzer", {
        body: {
          type: "columns",
          headers,
          sampleRows: rows.slice(0, 5),
        },
      });
      
      if (error) throw error;
      
      if (data.mapping) {
        setColumnMapping(data.mapping);
        if (data.tariffField) {
          setTariffField(data.tariffField);
        }
        toast.success("Колонки проанализированы");
      }
    } catch (err) {
      toast.error("Ошибка анализа колонок");
      console.error(err);
    } finally {
      setIsAnalyzingColumns(false);
    }
  };

  // Get unique offers from data
  const uniqueOffers = useMemo(() => {
    if (!columnMapping.offerName || !rows.length) return [];
    
    const offerCounts = new Map<string, { count: number; samples: ParsedRow[]; amount?: number }>();
    
    rows.forEach((row) => {
      const offerName = String(row[columnMapping.offerName!] || "").trim();
      if (!offerName) return;
      
      const existing = offerCounts.get(offerName);
      if (existing) {
        existing.count++;
        if (existing.samples.length < 3) {
          existing.samples.push(row);
        }
      } else {
        // Extract amount from the first sample
        const amountValue = columnMapping.amount ? row[columnMapping.amount] : undefined;
        const amount = amountValue ? parseFloat(String(amountValue).replace(/[^\d.,]/g, '').replace(',', '.')) : undefined;
        offerCounts.set(offerName, { count: 1, samples: [row], amount: amount && !isNaN(amount) ? amount : undefined });
      }
    });
    
    return Array.from(offerCounts.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [rows, columnMapping.offerName, columnMapping.amount]);

  // Helper function to normalize names (remove duplicates like "Иван Иванов Иван Иванов")
  const normalizeName = useCallback((name: string): { firstName: string; lastName: string; fullName: string } => {
    if (!name) return { firstName: "", lastName: "", fullName: "" };
    
    // Split and clean
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "", fullName: "" };
    
    // Capitalize each part
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const capitalizedParts = parts.map(capitalize);
    
    // Detect and remove duplicates (e.g., "Иван Иванов Иван Иванов" -> "Иван Иванов")
    const halfLen = Math.floor(capitalizedParts.length / 2);
    if (capitalizedParts.length >= 4 && capitalizedParts.length % 2 === 0) {
      const firstHalf = capitalizedParts.slice(0, halfLen).join(" ");
      const secondHalf = capitalizedParts.slice(halfLen).join(" ");
      if (firstHalf === secondHalf) {
        return {
          firstName: capitalizedParts[0],
          lastName: capitalizedParts.slice(1, halfLen).join(" "),
          fullName: firstHalf,
        };
      }
    }
    
    // Standard case: first part is firstName, rest is lastName
    return {
      firstName: capitalizedParts[0],
      lastName: capitalizedParts.slice(1).join(" "),
      fullName: capitalizedParts.join(" "),
    };
  }, []);

  // Find email duplicates in the data
  const emailDuplicates = useMemo((): DuplicateInfo[] => {
    if (!columnMapping.email || !rows.length) return [];
    
    const emailMap = new Map<string, { count: number; names: Set<string> }>();
    
    rows.forEach((row) => {
      const email = String(row[columnMapping.email!] || "").toLowerCase().trim();
      if (!email || !email.includes("@")) return;
      
      const nameCol = columnMapping.fullName || columnMapping.firstName;
      const name = nameCol ? String(row[nameCol] || "") : "";
      
      const existing = emailMap.get(email);
      if (existing) {
        existing.count++;
        if (name) existing.names.add(name);
      } else {
        emailMap.set(email, { count: 1, names: new Set(name ? [name] : []) });
      }
    });
    
    // Return only actual duplicates (count > 1)
    return Array.from(emailMap.entries())
      .filter(([_, data]) => data.count > 1)
      .map(([email, data]) => ({
        email,
        count: data.count,
        names: Array.from(data.names),
      }))
      .sort((a, b) => b.count - a.count);
  }, [rows, columnMapping.email, columnMapping.fullName, columnMapping.firstName]);

  // AI Tariff Analysis
  const analyzeTariffs = async () => {
    if (!uniqueOffers.length || !tariffs?.length) return;
    
    setIsAnalyzingTariffs(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-import-analyzer", {
        body: {
          type: "tariffs",
          uniqueOffers: uniqueOffers.slice(0, 50).map(o => ({
            name: o.name,
            count: o.count,
            samples: o.samples,
            amount: o.amount,
          })),
          existingTariffs: tariffs.map(t => ({ 
            id: t.id, 
            code: t.code, 
            name: t.name,
            price: t.original_price,
          })),
          existingRules: mappingRules?.map(r => ({ pattern: r.source_pattern, tariff_id: r.target_tariff_id })),
        },
      });
      
      if (error) throw error;
      
      if (data.suggestions) {
        // Auto-fill: mark unknown products as "skip" by default, with option to choose archive
        const enrichedSuggestions = data.suggestions.map((s: TariffSuggestion) => {
          if (s.action === "needs_review" || s.action === "skip") {
            return { ...s, action: "skip" as const, userChoice: "skip" };
          }
          return s;
        });
        setTariffSuggestions(enrichedSuggestions);
        
        const unknownCount = enrichedSuggestions.filter((s: TariffSuggestion) => 
          s.action === "skip" && !s.targetTariffId
        ).length;
        
        if (unknownCount > 0) {
          toast.info(`${unknownCount} офферов без тарифа (по умолчанию пропускаются)`);
        } else {
          toast.success("Все тарифы определены");
        }
      }
    } catch (err) {
      toast.error("Ошибка анализа тарифов");
      console.error(err);
    } finally {
      setIsAnalyzingTariffs(false);
    }
  };

  // Save mapping rule
  const saveMappingRule = useMutation({
    mutationFn: async (suggestion: TariffSuggestion) => {
      const { data, error } = await supabase
        .from("import_mapping_rules")
        .insert({
          name: `Правило для "${suggestion.pattern}"`,
          source_pattern: suggestion.pattern,
          target_tariff_id: suggestion.targetTariffId,
          secondary_field_name: suggestion.secondaryField,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-mapping-rules"] });
      toast.success("Правило сохранено");
    },
    onError: () => {
      toast.error("Ошибка сохранения правила");
    },
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      const dealsToImport = prepareDealsForImport();
      console.log(`[SmartImport] Sending ${dealsToImport.length} deals to import`);
      
      const { data, error } = await supabase.functions.invoke("getcourse-import-deals", {
        body: {
          fileDeals: dealsToImport, // Edge function expects fileDeals for file import mode
          settings,
          instanceId, // Optional, for logging
        },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setImportResult(data);
      queryClient.invalidateQueries({ queryKey: ["orders-v2"] });
      toast.success(`Импортировано ${data.success} сделок`);
    },
    onError: (err) => {
      toast.error("Ошибка импорта");
      console.error(err);
    },
  });

  // Prepare deals for import based on mappings
  const prepareDealsForImport = useCallback(() => {
    return rows
      .filter((row) => {
        // If no status column mapped, include all rows
        if (!columnMapping.status) return true;
        
        const status = String(row[columnMapping.status] || "");
        // If no status filter or empty filter, include all rows
        if (!settings.statusFilter || settings.statusFilter.length === 0) return true;
        
        return settings.statusFilter.some(s => status.toLowerCase().includes(s.toLowerCase()));
      })
      .filter((row) => {
        // Skip rows where user explicitly chose "skip"
        const offerName = String(row[columnMapping.offerName!] || "");
        const suggestion = tariffSuggestions.find(s => s.pattern === offerName);
        // Only skip if user explicitly chose skip
        if (suggestion?.userChoice === "skip") {
          return false;
        }
        // If no suggestion yet, include (will be unknown tariff)
        return true;
      })
      .map((row) => {
        // Find tariff based on suggestions
        const offerName = String(row[columnMapping.offerName!] || "");
        const suggestion = tariffSuggestions.find(s => s.pattern === offerName);
        
        let tariffCode = "UNKNOWN";
        
        // Handle archive_unknown - keep as special marker for club without tariff
        if (suggestion?.userChoice === "archive_unknown" || suggestion?.action === "archive_unknown") {
          tariffCode = "ARCHIVE_UNKNOWN";
        } else if (suggestion?.userChoice && suggestion.userChoice !== "skip") {
          tariffCode = suggestion.userChoice;
        } else if (suggestion?.targetTariffCode) {
          tariffCode = suggestion.targetTariffCode;
        }
        
        // If using secondary field
        if (suggestion?.action === "use_secondary_field" && suggestion.secondaryField) {
          const secondaryValue = String(row[suggestion.secondaryField] || "").toLowerCase();
          if (secondaryValue.includes("chat")) tariffCode = "chat";
          else if (secondaryValue.includes("full")) tariffCode = "full";
          else if (secondaryValue.includes("business")) tariffCode = "business";
        }
        
        // Get raw name
        let rawFullName = String(row[columnMapping.fullName!] || "");
        let firstName = columnMapping.firstName ? String(row[columnMapping.firstName] || "") : "";
        let lastName = columnMapping.lastName ? String(row[columnMapping.lastName] || "") : "";
        
        // Normalize names if enabled
        if (settings.normalizeNames) {
          if (rawFullName) {
            const normalized = normalizeName(rawFullName);
            rawFullName = normalized.fullName;
            if (!firstName) firstName = normalized.firstName;
            if (!lastName) lastName = normalized.lastName;
          } else if (firstName || lastName) {
            const combined = normalizeName(`${firstName} ${lastName}`);
            firstName = combined.firstName;
            lastName = combined.lastName;
            rawFullName = combined.fullName;
          }
        }
        
        return {
          email: String(row[columnMapping.email!] || "").toLowerCase().trim(),
          phone: String(row[columnMapping.phone!] || ""),
          fullName: rawFullName,
          firstName,
          lastName,
          offerName,
          tariffCode,
          amount: parseFloat(String(row[columnMapping.amount!] || "0")) || 0,
          status: String(row[columnMapping.status!] || ""),
          createdAt: String(row[columnMapping.createdAt!] || ""),
          paidAt: String(row[columnMapping.paidAt!] || ""),
          externalId: String(row[columnMapping.externalId!] || ""),
        };
      });
  }, [rows, columnMapping, tariffSuggestions, settings, normalizeName]);

  // Stats for preview
  const previewStats = useMemo(() => {
    const deals = prepareDealsForImport();
    const byTariff = new Map<string, number>();
    const uniqueEmails = new Set<string>();
    let unknownTariffCount = 0;
    
    deals.forEach((d) => {
      byTariff.set(d.tariffCode, (byTariff.get(d.tariffCode) || 0) + 1);
      if (d.email) uniqueEmails.add(d.email);
      if (d.tariffCode === "UNKNOWN") unknownTariffCount++;
    });
    
    return {
      total: deals.length,
      uniqueEmails: uniqueEmails.size,
      unknownTariffCount,
      byTariff: Array.from(byTariff.entries()).sort((a, b) => b[1] - a[1]),
      emailDuplicatesInFile: emailDuplicates.length,
      totalDuplicateRows: emailDuplicates.reduce((sum, d) => sum + d.count, 0),
    };
  }, [prepareDealsForImport, emailDuplicates]);

  // Reset wizard
  const resetWizard = () => {
    setStep(1);
    setFile(null);
    setHeaders([]);
    setRows([]);
    setColumnMapping(DEFAULT_MAPPING);
    setTariffField(null);
    setTariffSuggestions([]);
    setSettings(DEFAULT_SETTINGS);
    setImportResult(null);
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.endsWith(".xlsx")) {
      handleFileUpload(droppedFile);
    } else {
      toast.error("Пожалуйста, загрузите .xlsx файл");
    }
  };

  const canProceedToStep = (targetStep: number) => {
    switch (targetStep) {
      case 2: return file && headers.length > 0;
      case 3: return columnMapping.email && columnMapping.offerName;
      case 4: return tariffSuggestions.length > 0 || uniqueOffers.length === 0;
      case 5: return true;
      default: return true;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Умный импорт сделок
          </DialogTitle>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/50 rounded-lg">
          {STEPS.map((s, idx) => (
            <React.Fragment key={s.id}>
              <div 
                className={`flex items-center gap-2 ${
                  step === s.id ? "text-primary" : step > s.id ? "text-muted-foreground" : "text-muted-foreground/50"
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                  step === s.id ? "border-primary bg-primary text-primary-foreground" : 
                  step > s.id ? "border-primary/50 bg-primary/20" : "border-muted"
                }`}>
                  {step > s.id ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                <span className="text-sm font-medium hidden md:inline">{s.name}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? "bg-primary" : "bg-muted"}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <ScrollArea className="flex-1 min-h-0 px-1">
          {/* Step 1: File Upload */}
          {step === 1 && (
            <div className="space-y-4 p-4">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="space-y-2">
                    <FileSpreadsheet className="h-12 w-12 mx-auto text-green-500" />
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {rows.length} строк • {headers.length} колонок
                    </p>
                    <Button variant="outline" size="sm" onClick={() => { setFile(null); setHeaders([]); setRows([]); }}>
                      Выбрать другой файл
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                    <div>
                      <p className="font-medium">Перетащите Excel файл сюда</p>
                      <p className="text-sm text-muted-foreground">или нажмите для выбора</p>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      id="file-upload"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFileUpload(f);
                      }}
                    />
                    <Button variant="outline" asChild>
                      <label htmlFor="file-upload" className="cursor-pointer">Выбрать файл</label>
                    </Button>
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Найдено {headers.length} колонок. На следующем шаге ИИ проанализирует структуру файла.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 2 && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Маппинг колонок</h3>
                <Button onClick={analyzeColumns} disabled={isAnalyzingColumns} size="sm">
                  {isAnalyzingColumns ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Анализ...
                    </>
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-2" />
                      Автоанализ ИИ
                    </>
                  )}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {(Object.keys(columnMapping) as (keyof ColumnMapping)[]).map((field) => (
                  <div key={field} className="space-y-1">
                    <label className="text-sm font-medium capitalize">
                      {field === "email" && "Email"}
                      {field === "phone" && "Телефон"}
                      {field === "fullName" && "ФИО"}
                      {field === "firstName" && "Имя"}
                      {field === "lastName" && "Фамилия"}
                      {field === "offerName" && "Название оффера *"}
                      {field === "amount" && "Сумма"}
                      {field === "currency" && "Валюта"}
                      {field === "status" && "Статус"}
                      {field === "createdAt" && "Дата создания"}
                      {field === "paidAt" && "Дата оплаты"}
                      {field === "externalId" && "Внешний ID"}
                    </label>
                    <Select
                      value={columnMapping[field] || "__none__"}
                      onValueChange={(v) => setColumnMapping(prev => ({ ...prev, [field]: v === "__none__" ? null : v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите колонку" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Не выбрано —</SelectItem>
                        {headers.filter(h => h && h.trim()).map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {tariffField && (
                <Alert>
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription>
                    ИИ нашёл дополнительное поле с тарифом: <strong>{tariffField}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 3: Tariff Mapping */}
          {step === 3 && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">Маппинг тарифов ({uniqueOffers.length} уникальных офферов)</h3>
                <Button onClick={analyzeTariffs} disabled={isAnalyzingTariffs} size="sm">
                  {isAnalyzingTariffs ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Анализ...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      ИИ-маппинг
                    </>
                  )}
                </Button>
              </div>

              <div className="space-y-2">
                {uniqueOffers.map((offer) => {
                  const suggestion = tariffSuggestions.find(s => s.pattern === offer.name);
                  const isExpanded = expandedOffers.has(offer.name);
                  
                  return (
                    <Card key={offer.name} className="overflow-hidden">
                      <CardHeader 
                        className="py-2 px-3 cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          const next = new Set(expandedOffers);
                          if (isExpanded) next.delete(offer.name);
                          else next.add(offer.name);
                          setExpandedOffers(next);
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <span className="font-medium truncate max-w-[300px]">{offer.name}</span>
                            <Badge variant="secondary">{offer.count}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            {suggestion ? (
                              <Badge 
                                variant={
                                  suggestion.userChoice === "skip" || (suggestion.action === "skip" && !suggestion.userChoice)
                                    ? "destructive" 
                                    : suggestion.userChoice === "archive_unknown" || suggestion.action === "archive_unknown"
                                    ? "outline"
                                    : suggestion.targetTariffId || suggestion.userChoice
                                    ? "default"
                                    : "outline"
                                }
                              >
                                {suggestion.userChoice === "archive_unknown" || suggestion.action === "archive_unknown"
                                  ? "Не определён (архив)" 
                                  : suggestion.userChoice === "skip" || (suggestion.action === "skip" && !suggestion.userChoice)
                                  ? "Пропустить"
                                  : suggestion.userChoice || suggestion.targetTariffCode || "Ожидает"}
                              </Badge>
                            ) : (
                              <Badge variant="outline">Ожидает анализа</Badge>
                            )}
                            {offer.amount && (
                              <Badge variant="outline" className="text-xs">
                                ~{offer.amount.toFixed(0)} BYN
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      
                      {isExpanded && (
                        <CardContent className="py-2 px-3 bg-muted/30 space-y-2">
                          {suggestion && (
                            <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
                          )}
                          
                          <div className="flex items-center gap-2">
                            <span className="text-sm">Тариф:</span>
                            <Select
                              value={suggestion?.userChoice || suggestion?.targetTariffId || ""}
                              onValueChange={(v) => {
                                const isSkip = v === "skip";
                                const isArchive = v === "archive_unknown";
                                const tariff = tariffs?.find(t => t.id === v);
                                
                                setTariffSuggestions(prev => {
                                  const idx = prev.findIndex(s => s.pattern === offer.name);
                                  const newSuggestion: TariffSuggestion = {
                                    pattern: offer.name,
                                    count: offer.count,
                                    action: isSkip ? "skip" : isArchive ? "archive_unknown" : "map_to_tariff",
                                    targetTariffId: isSkip || isArchive ? null : v,
                                    targetTariffCode: tariff?.code || null,
                                    secondaryField: null,
                                    confidence: 1,
                                    reason: "Выбрано вручную",
                                    userChoice: isSkip ? "skip" : isArchive ? "archive_unknown" : (tariff?.code || v),
                                  };
                                  
                                  if (idx >= 0) {
                                    const updated = [...prev];
                                    updated[idx] = newSuggestion;
                                    return updated;
                                  }
                                  return [...prev, newSuggestion];
                                });
                              }}
                            >
                            <SelectTrigger className="w-48">
                                <SelectValue>
                                  {suggestion?.userChoice === "skip" 
                                    ? "🚫 Пропустить"
                                    : suggestion?.userChoice === "archive_unknown"
                                    ? "📦 Не определён"
                                    : suggestion?.userChoice 
                                    ? tariffs?.find(t => t.code === suggestion.userChoice || t.id === suggestion.userChoice)?.name || suggestion.userChoice
                                    : suggestion?.targetTariffCode 
                                    ? tariffs?.find(t => t.code === suggestion.targetTariffCode)?.name || suggestion.targetTariffCode
                                    : "Выбрать тариф"}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="skip">🚫 Пропустить</SelectItem>
                                <SelectItem value="archive_unknown">📦 Не определён (архивный)</SelectItem>
                                <Separator className="my-1" />
                                {tariffs?.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.code})</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            
                            {suggestion && (suggestion.targetTariffId || suggestion.userChoice === "archive_unknown") && (
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => saveMappingRule.mutate(suggestion)}
                                disabled={saveMappingRule.isPending || !suggestion.targetTariffId}
                              >
                                <Save className="h-4 w-4 mr-1" />
                                Сохранить правило
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
                
                {uniqueOffers.length > 20 && (
                  <p className="text-sm text-muted-foreground text-center">
                    Показано 20 из {uniqueOffers.length} офферов
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Settings */}
          {step === 4 && (
            <div className="space-y-4 p-4">
              <h3 className="font-medium">Настройки импорта</h3>
              
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Фильтр статусов</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {["Оплачено", "Завершён", "В процессе", "Отменён"].map((status) => (
                    <div key={status} className="flex items-center gap-2">
                      <Checkbox
                        id={status}
                        checked={settings.statusFilter.includes(status)}
                        onCheckedChange={(checked) => {
                          setSettings(prev => ({
                            ...prev,
                            statusFilter: checked 
                              ? [...prev.statusFilter, status]
                              : prev.statusFilter.filter(s => s !== status)
                          }));
                        }}
                      />
                      <label htmlFor={status} className="text-sm">{status}</label>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Обработка дубликатов</CardTitle>
                </CardHeader>
                <CardContent>
                  <Select
                    value={settings.duplicateHandling}
                    onValueChange={(v: "skip" | "update") => setSettings(prev => ({ ...prev, duplicateHandling: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Пропускать существующие</SelectItem>
                      <SelectItem value="update">Обновлять существующие</SelectItem>
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Нормализация данных</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="normalizeNames"
                      checked={settings.normalizeNames}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, normalizeNames: !!checked }))}
                    />
                    <label htmlFor="normalizeNames" className="text-sm">
                      Нормализовать имена (убрать дубли типа "Иван Иванов Иван Иванов")
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="mergeEmailDuplicates"
                      checked={settings.mergeEmailDuplicates}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, mergeEmailDuplicates: !!checked }))}
                    />
                    <label htmlFor="mergeEmailDuplicates" className="text-sm">
                      Объединять профили с одинаковым email
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Создание профилей</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="ghost"
                      checked={settings.createGhostProfiles}
                      onCheckedChange={(checked) => setSettings(prev => ({ ...prev, createGhostProfiles: !!checked }))}
                    />
                    <label htmlFor="ghost" className="text-sm">
                      Создавать ghost-профили для новых пользователей
                    </label>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* Email duplicates warning */}
              {emailDuplicates.length > 0 && (
                <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <p className="font-medium text-yellow-600">
                        Найдено {emailDuplicates.length} email с повторами ({previewStats.totalDuplicateRows} строк)
                      </p>
                      <div className="text-sm space-y-1 max-h-32 overflow-auto">
                        {emailDuplicates.slice(0, 5).map((dup) => (
                          <div key={dup.email} className="flex justify-between">
                            <span className="truncate max-w-[200px]">{dup.email}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">{dup.count}x</Badge>
                              {dup.names.length > 0 && (
                                <span className="text-muted-foreground text-xs truncate max-w-[150px]">
                                  {dup.names[0]}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {emailDuplicates.length > 5 && (
                          <p className="text-muted-foreground">
                            ... и ещё {emailDuplicates.length - 5} email
                          </p>
                        )}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Превью импорта</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Всего сделок:</span>
                      <span className="text-2xl font-bold">{previewStats.total}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Уникальных email:</span>
                      <span className="font-medium">{previewStats.uniqueEmails}</span>
                    </div>
                    
                    {previewStats.unknownTariffCount > 0 && (
                      <Alert variant="destructive" className="py-2">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          {previewStats.unknownTariffCount} сделок без определённого тарифа будут пропущены
                        </AlertDescription>
                      </Alert>
                    )}
                    
                    <Separator />
                    
                    <div className="text-sm font-medium">По тарифам:</div>
                    <div className="space-y-1">
                      {previewStats.byTariff.map(([code, count]) => (
                        <div key={code} className="flex justify-between text-sm">
                          <span className={code === "UNKNOWN" ? "text-destructive" : ""}>
                            {code === "UNKNOWN" ? "⚠️ UNKNOWN" : code.toUpperCase()}
                          </span>
                          <Badge variant={code === "UNKNOWN" ? "destructive" : "secondary"}>
                            {count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 5: Import Results */}
          {step === 5 && (
            <div className="space-y-4 p-4">
              {!importResult && !isImporting && (
                <div className="text-center space-y-4 py-8">
                  <h3 className="text-lg font-medium">Готово к импорту</h3>
                  <p className="text-muted-foreground">
                    Будет импортировано {previewStats.total} сделок
                  </p>
                  <Button onClick={() => { setIsImporting(true); importMutation.mutate(); }} size="lg">
                    <Upload className="h-4 w-4 mr-2" />
                    Начать импорт
                  </Button>
                </div>
              )}

              {isImporting && !importResult && (
                <div className="text-center space-y-4 py-8">
                  <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
                  <p className="text-muted-foreground">Импорт в процессе...</p>
                </div>
              )}

              {importResult && (
                <div className="space-y-4">
                  <Alert variant={importResult.errors.length > 0 ? "destructive" : "default"}>
                    <Check className="h-4 w-4" />
                    <AlertDescription>
                      Импортировано: {importResult.success} • Пропущено: {importResult.skipped} • Ошибок: {importResult.errors.length}
                    </AlertDescription>
                  </Alert>

                  {importResult.errors.length > 0 && (
                    <Card>
                      <CardHeader className="py-3">
                        <CardTitle className="text-sm text-destructive">Ошибки</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="h-40">
                          {importResult.errors.slice(0, 20).map((e, i) => (
                            <p key={i} className="text-sm text-muted-foreground">
                              Строка {e.row}: {e.error}
                            </p>
                          ))}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  <Button onClick={() => { resetWizard(); onOpenChange(false); }} className="w-full">
                    Закрыть
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Navigation */}
        {step < 5 && (
          <div className="flex justify-between pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Назад
            </Button>
            <Button
              onClick={() => setStep(s => Math.min(5, s + 1))}
              disabled={!canProceedToStep(step + 1)}
            >
              Далее
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

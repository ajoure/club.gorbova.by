import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { 
  Upload, FileSpreadsheet, Sparkles, ArrowRight, ArrowLeft, 
  Check, X, Loader2, AlertCircle, Brain, Save, RefreshCw,
  ChevronDown, ChevronRight, Info, Users, ShoppingCart, Filter
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
  accessStartAt: string | null;  // Дата начала доступа
  accessEndAt: string | null;    // Дата окончания доступа
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
  suggestedPrice?: number;
  userChoice?: string;
}

interface DuplicateInfo {
  email: string;
  count: number;
  names: string[];
}

interface ImportSettings {
  onlyPaid: boolean; // Simplified: true = only paid statuses
  duplicateHandling: "skip" | "update";
  mergeEmailDuplicates: boolean;
  normalizeNames: boolean;
  dateField: "createdAt" | "paidAt";
  createGhostProfiles: boolean;
}

const STEPS = [
  { id: 1, name: "Файл", icon: Upload },
  { id: 2, name: "Колонки", icon: Brain },
  { id: 3, name: "Тарифы", icon: Sparkles },
  { id: 4, name: "Готово", icon: Check },
  { id: 5, name: "Импорт", icon: ShoppingCart },
];

const PAID_STATUSES = ["Оплачено", "Завершён"];

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
  accessStartAt: null,
  accessEndAt: null,
};

const DEFAULT_SETTINGS: ImportSettings = {
  onlyPaid: false, // Import all by default
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
  const [columnsAnalyzed, setColumnsAnalyzed] = useState(false);
  
  // Step 3: Tariff mapping
  const [tariffSuggestions, setTariffSuggestions] = useState<TariffSuggestion[]>([]);
  const [isAnalyzingTariffs, setIsAnalyzingTariffs] = useState(false);
  const [tariffsAnalyzed, setTariffsAnalyzed] = useState(false);
  const [expandedOffers, setExpandedOffers] = useState<Set<string>>(new Set());
  const [showAllOffers, setShowAllOffers] = useState(false);
  
  // Step 4: Settings
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_SETTINGS);
  
  // Step 5: Import
  const [importResult, setImportResult] = useState<{
    success: number;
    skipped: number;
    errors: { row: number; error: string }[];
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importCancelled, setImportCancelled] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

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
      setColumnsAnalyzed(false);
      setTariffsAnalyzed(false);
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
        setColumnsAnalyzed(true);
        toast.success("Колонки проанализированы");
      }
    } catch (err) {
      toast.error("Ошибка анализа колонок");
      console.error(err);
    } finally {
      setIsAnalyzingColumns(false);
    }
  };

  // Auto-analyze columns when entering step 2
  useEffect(() => {
    if (step === 2 && !columnsAnalyzed && !isAnalyzingColumns && headers.length > 0) {
      analyzeColumns();
    }
  }, [step, columnsAnalyzed, isAnalyzingColumns, headers.length]);

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
        const amountValue = columnMapping.amount ? row[columnMapping.amount] : undefined;
        const amount = amountValue ? parseFloat(String(amountValue).replace(/[^\d.,]/g, '').replace(',', '.')) : undefined;
        offerCounts.set(offerName, { count: 1, samples: [row], amount: amount && !isNaN(amount) ? amount : undefined });
      }
    });
    
    return Array.from(offerCounts.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);
  }, [rows, columnMapping.offerName, columnMapping.amount]);

  // Helper function to normalize names
  const normalizeName = useCallback((name: string): { firstName: string; lastName: string; fullName: string } => {
    if (!name) return { firstName: "", lastName: "", fullName: "" };
    
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "", fullName: "" };
    
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    const capitalizedParts = parts.map(capitalize);
    
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
    
    return {
      firstName: capitalizedParts[0],
      lastName: capitalizedParts.slice(1).join(" "),
      fullName: capitalizedParts.join(" "),
    };
  }, []);

  // Get unique emails count
  const uniqueEmailsCount = useMemo(() => {
    if (!columnMapping.email || !rows.length) return 0;
    const emails = new Set<string>();
    rows.forEach((row) => {
      const email = String(row[columnMapping.email!] || "").toLowerCase().trim();
      if (email && email.includes("@")) emails.add(email);
    });
    return emails.size;
  }, [rows, columnMapping.email]);

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
        const enrichedSuggestions: TariffSuggestion[] = data.suggestions.map((s: TariffSuggestion) => ({
          ...s,
        }));

        setTariffSuggestions(enrichedSuggestions);
        setTariffsAnalyzed(true);

        const unknownCount = enrichedSuggestions.filter((s) => !s.targetTariffId).length;

        if (unknownCount > 0) {
          toast.info(`${unknownCount} офферов без тарифа`);
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

  // Auto-analyze tariffs when entering step 3
  useEffect(() => {
    if (step === 3 && !tariffsAnalyzed && !isAnalyzingTariffs && uniqueOffers.length > 0 && tariffs?.length) {
      analyzeTariffs();
    }
  }, [step, tariffsAnalyzed, isAnalyzingTariffs, uniqueOffers.length, tariffs?.length]);

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
    mutationFn: async (vars?: { mode?: "full" | "test5" }) => {
      const mode = vars?.mode ?? "full";

      const dealsToImport =
        mode === "test5"
          ? prepareDealsForImport({ limit: 5, ignoreStatusFilter: true })
          : prepareDealsForImport();

      if (!dealsToImport.length) {
        throw new Error(
          "Нет сделок для импорта. Проверьте фильтр статусов и маппинг тарифов."
        );
      }

      console.log(`[SmartImport] Sending ${dealsToImport.length} deals to import (mode=${mode})`);

      abortControllerRef.current = new AbortController();

      const { data, error } = await supabase.functions.invoke("getcourse-import-deals", {
        body: {
          fileDeals: dealsToImport,
          settings: {
            ...settings,
            statusFilter: settings.onlyPaid ? PAID_STATUSES : [],
          },
          instanceId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setIsImporting(false);
      if (!importCancelled) {
        setImportResult({
          success: data.result?.orders_created || data.orders_created || 0,
          skipped: data.result?.orders_skipped || 0,
          errors:
            data.result?.details
              ?.filter((d: string) => d.includes('Ошибка'))
              .map((d: string, i: number) => ({ row: i, error: d })) || [],
        });
        queryClient.invalidateQueries({ queryKey: ["orders-v2"] });
        toast.success(`Импортировано сделок: ${data.result?.orders_created || data.orders_created || 0}`);
      }
    },
    onError: (err: any) => {
      setIsImporting(false);
      if (importCancelled) {
        toast.info("Импорт отменён");
      } else {
        toast.error(`Ошибка импорта: ${err.message || 'Неизвестная ошибка'}`);
        console.error(err);
      }
    },
  });

  // Cancel import handler
  const handleCancelImport = useCallback(() => {
    setImportCancelled(true);
    setIsImporting(false);
    setStep(4);
    toast.info("Импорт отменён. Данные на сервере могли быть частично обработаны.");
  }, []);

  // Prepare deals for import based on mappings
  const prepareDealsForImport = useCallback(
    (opts: { limit?: number; ignoreStatusFilter?: boolean } = {}) => {
      const { limit, ignoreStatusFilter = false } = opts;

      const deals = rows
        .filter((row) => {
          if (ignoreStatusFilter) return true;
          if (!columnMapping.status) return true;

          const status = String(row[columnMapping.status] || "");
          
          // If onlyPaid is enabled, filter by paid statuses
          if (settings.onlyPaid) {
            return PAID_STATUSES.some((s) =>
              status.toLowerCase().includes(s.toLowerCase())
            );
          }
          
          return true; // Import all if onlyPaid is false
        })
        .filter((row) => {
          const offerName = String(row[columnMapping.offerName!] || "");
          const suggestion = tariffSuggestions.find((s) => s.pattern === offerName);

          if (suggestion?.userChoice === "skip") return false;

          const status = columnMapping.status ? String(row[columnMapping.status] || "") : "";
          const isWaitingForAnalysis = status.toLowerCase().includes("ожидает анализа");
          const isTariffUnclearFromAi =
            !!suggestion &&
            !suggestion.userChoice &&
            (suggestion.action === "needs_review" ||
              (suggestion.action === "skip" && !suggestion.targetTariffId && !suggestion.targetTariffCode));

          if (isWaitingForAnalysis && isTariffUnclearFromAi) return false;

          return true;
        })
        .map((row) => {
          const offerName = String(row[columnMapping.offerName!] || "");
          const suggestion = tariffSuggestions.find((s) => s.pattern === offerName);

          let tariffCode = "UNKNOWN";

          if (suggestion?.userChoice === "archive_unknown" || suggestion?.action === "archive_unknown") {
            tariffCode = "ARCHIVE_UNKNOWN";
          } else if (suggestion?.userChoice && suggestion.userChoice !== "skip") {
            tariffCode = suggestion.userChoice;
          } else if (suggestion?.targetTariffCode) {
            tariffCode = suggestion.targetTariffCode;
          }

          if (suggestion?.action === "use_secondary_field" && suggestion.secondaryField) {
            const secondaryValue = String(row[suggestion.secondaryField] || "").toLowerCase();
            if (secondaryValue.includes("chat")) tariffCode = "chat";
            else if (secondaryValue.includes("full")) tariffCode = "full";
            else if (secondaryValue.includes("business")) tariffCode = "business";
          }

          let rawFullName = String(row[columnMapping.fullName!] || "");
          let firstName = columnMapping.firstName ? String(row[columnMapping.firstName] || "") : "";
          let lastName = columnMapping.lastName ? String(row[columnMapping.lastName] || "") : "";

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
            user_email: String(row[columnMapping.email!] || "").toLowerCase().trim(),
            user_phone: String(row[columnMapping.phone!] || ""),
            user_full_name: rawFullName,
            user_first_name: firstName,
            user_last_name: lastName,
            offerName,
            tariffCode,
            amount: parseFloat(String(row[columnMapping.amount!] || "0")) || 0,
            status: String(row[columnMapping.status!] || ""),
            createdAt: String(row[columnMapping.createdAt!] || ""),
            paidAt: String(row[columnMapping.paidAt!] || ""),
            externalId: String(row[columnMapping.externalId!] || ""),
            accessStartAt: columnMapping.accessStartAt ? String(row[columnMapping.accessStartAt] || "") : "",
            accessEndAt: columnMapping.accessEndAt ? String(row[columnMapping.accessEndAt] || "") : "",
          };
        });

      return typeof limit === "number" ? deals.slice(0, limit) : deals;
    },
    [rows, columnMapping, tariffSuggestions, settings, normalizeName]
  );

  // Stats for preview
  const previewStats = useMemo(() => {
    const deals = prepareDealsForImport();
    const byTariff = new Map<string, number>();
    const uniqueEmails = new Set<string>();
    let unknownTariffCount = 0;
    let activeSubscriptions = 0;
    let expiredSubscriptions = 0;
    const now = new Date();
    
    deals.forEach((d) => {
      byTariff.set(d.tariffCode, (byTariff.get(d.tariffCode) || 0) + 1);
      if (d.user_email) uniqueEmails.add(d.user_email);
      if (d.tariffCode === "UNKNOWN") unknownTariffCount++;
      
      // Подсчёт активных/истекших по дате окончания доступа
      if (d.accessEndAt) {
        const endDate = parseAccessDate(d.accessEndAt);
        if (endDate) {
          if (endDate >= now) {
            activeSubscriptions++;
          } else {
            expiredSubscriptions++;
          }
        }
      } else {
        // Если нет даты окончания - считаем по дате оплаты + 30 дней
        const paidDate = d.paidAt ? parseAccessDate(d.paidAt) : null;
        if (paidDate) {
          const endDate = new Date(paidDate);
          endDate.setDate(endDate.getDate() + 30);
          if (endDate >= now) {
            activeSubscriptions++;
          } else {
            expiredSubscriptions++;
          }
        }
      }
    });
    
    // Compute skipped stats
    let skippedByStatus = 0;
    let skippedByUnclearTariff = 0;
    let skippedByUserSkip = 0;

    rows.forEach((row) => {
      const status = columnMapping.status ? String(row[columnMapping.status] || "") : "";
      const offerName = String(row[columnMapping.offerName!] || "");
      const suggestion = tariffSuggestions.find(s => s.pattern === offerName);

      // Check status filter
      if (columnMapping.status && settings.onlyPaid) {
        const passesStatus = PAID_STATUSES.some(s =>
          status.toLowerCase().includes(s.toLowerCase())
        );
        if (!passesStatus) {
          skippedByStatus++;
          return;
        }
      }

      // Check user skip
      if (suggestion?.userChoice === "skip") {
        skippedByUserSkip++;
        return;
      }

      // Check unclear tariff + waiting for analysis
      const isWaitingForAnalysis = status.toLowerCase().includes("ожидает анализа");
      const isTariffUnclearFromAi =
        !!suggestion &&
        !suggestion.userChoice &&
        (suggestion.action === "needs_review" ||
          (suggestion.action === "skip" && !suggestion.targetTariffId && !suggestion.targetTariffCode));

      if (isWaitingForAnalysis && isTariffUnclearFromAi) {
        skippedByUnclearTariff++;
      }
    });
    
    return {
      total: deals.length,
      uniqueEmails: uniqueEmails.size,
      unknownTariffCount,
      byTariff: Array.from(byTariff.entries()).sort((a, b) => b[1] - a[1]),
      skippedByStatus,
      skippedByUnclearTariff,
      skippedByUserSkip,
      totalRows: rows.length,
      activeSubscriptions,
      expiredSubscriptions,
    };
  }, [prepareDealsForImport, rows, columnMapping, tariffSuggestions, settings.onlyPaid]);

  // Helper: parse access date from various formats
  function parseAccessDate(dateStr: string): Date | null {
    if (!dateStr || !dateStr.trim()) return null;
    const str = dateStr.trim();
    
    // ISO format
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return d;
    }
    
    // DD.MM.YYYY
    const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (dotMatch) {
      const [, day, month, year] = dotMatch;
      const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d;
    }
    
    // DD/MM/YYYY
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, day, month, year] = slashMatch;
      const d = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d;
    }
    
    const fallback = new Date(str);
    return !isNaN(fallback.getTime()) ? fallback : null;
  }

  // Count undefined tariffs
  const undefinedTariffsCount = useMemo(() => {
    return tariffSuggestions.filter(s => 
      !s.targetTariffId && 
      !s.targetTariffCode && 
      s.userChoice !== "archive_unknown" && 
      s.action !== "archive_unknown"
    ).length;
  }, [tariffSuggestions]);

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
    setIsImporting(false);
    setImportCancelled(false);
    setColumnsAnalyzed(false);
    setTariffsAnalyzed(false);
    setShowAllOffers(false);
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

  // Set all undefined tariffs to archive
  const setAllUndefinedToArchive = () => {
    setTariffSuggestions(prev => prev.map(s => {
      if (!s.targetTariffId && !s.targetTariffCode && s.userChoice !== "skip") {
        return { ...s, userChoice: "archive_unknown" };
      }
      return s;
    }));
    toast.success("Все неопределённые тарифы → ARCHIVE");
  };

  // Visible offers for step 3
  const visibleOffers = useMemo(() => {
    return showAllOffers ? uniqueOffers : uniqueOffers.slice(0, 15);
  }, [uniqueOffers, showAllOffers]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-4xl h-[95vh] max-h-[95vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            Умный импорт
          </DialogTitle>
        </DialogHeader>

        {/* Progress Steps - Mobile Friendly */}
        <div className="flex items-center gap-1 px-3 py-2 bg-muted/50 overflow-x-auto">
          {STEPS.map((s, idx) => (
            <React.Fragment key={s.id}>
              <div 
                className={`flex items-center gap-1 shrink-0 ${
                  step === s.id ? "text-primary" : step > s.id ? "text-muted-foreground" : "text-muted-foreground/50"
                }`}
              >
                <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs ${
                  step === s.id ? "border-primary bg-primary text-primary-foreground" : 
                  step > s.id ? "border-primary/50 bg-primary/20" : "border-muted"
                }`}>
                  {step > s.id ? <Check className="h-3 w-3" /> : <s.icon className="h-3 w-3" />}
                </div>
                <span className="text-xs font-medium hidden sm:inline">{s.name}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 min-w-4 h-0.5 ${step > s.id ? "bg-primary" : "bg-muted"}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Step 1: File Upload */}
          {step === 1 && (
            <div className="space-y-4 p-4">
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="space-y-2">
                    <FileSpreadsheet className="h-10 w-10 mx-auto text-green-500" />
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rows.length} строк • {headers.length} колонок
                    </p>
                    <Button variant="outline" size="sm" onClick={() => { setFile(null); setHeaders([]); setRows([]); }}>
                      Другой файл
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Перетащите Excel файл</p>
                      <p className="text-xs text-muted-foreground">или нажмите для выбора</p>
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
                    <Button variant="outline" size="sm" asChild>
                      <label htmlFor="file-upload" className="cursor-pointer">Выбрать файл</label>
                    </Button>
                  </div>
                )}
              </div>

              {rows.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  <Card className="p-3">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{uniqueEmailsCount}</p>
                        <p className="text-xs text-muted-foreground">Уникальных клиентов</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-3">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-lg font-bold">{rows.length}</p>
                        <p className="text-xs text-muted-foreground">Всего сделок</p>
                      </div>
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 2 && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">Маппинг колонок</h3>
                <Button onClick={analyzeColumns} disabled={isAnalyzingColumns} size="sm" variant="outline">
                  {isAnalyzingColumns ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Brain className="h-4 w-4 mr-1" />
                      <span className="hidden sm:inline">Повторить анализ</span>
                    </>
                  )}
                </Button>
              </div>

              {isAnalyzingColumns && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}

              {!isAnalyzingColumns && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.keys(columnMapping) as (keyof ColumnMapping)[]).map((field) => (
                    <div key={field} className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {field === "email" && "Email *"}
                        {field === "phone" && "Телефон"}
                        {field === "fullName" && "ФИО"}
                        {field === "firstName" && "Имя"}
                        {field === "lastName" && "Фамилия"}
                        {field === "offerName" && "Оффер *"}
                        {field === "amount" && "Сумма"}
                        {field === "currency" && "Валюта"}
                        {field === "status" && "Статус"}
                        {field === "createdAt" && "Создано"}
                        {field === "paidAt" && "Оплачено"}
                        {field === "externalId" && "Внешний ID"}
                        {field === "accessStartAt" && "Начало доступа"}
                        {field === "accessEndAt" && "Конец доступа"}
                      </label>
                      <Select
                        value={columnMapping[field] || "__none__"}
                        onValueChange={(v) => setColumnMapping(prev => ({ ...prev, [field]: v === "__none__" ? null : v }))}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="—" />
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
              )}

              {tariffField && (
                <Alert className="py-2">
                  <Sparkles className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    Найдено поле тарифа: <strong>{tariffField}</strong>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Step 3: Tariff Mapping */}
          {step === 3 && (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-medium text-sm">Маппинг тарифов</h3>
                  <p className="text-xs text-muted-foreground">
                    {uniqueOffers.length} офферов
                    {undefinedTariffsCount > 0 && (
                      <span className="text-destructive ml-1">• {undefinedTariffsCount} без тарифа</span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  {undefinedTariffsCount > 0 && (
                    <Button onClick={setAllUndefinedToArchive} size="sm" variant="outline">
                      Все → ARCHIVE
                    </Button>
                  )}
                  <Button onClick={analyzeTariffs} disabled={isAnalyzingTariffs} size="sm" variant="outline">
                    {isAnalyzingTariffs ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {isAnalyzingTariffs && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              )}

              {!isAnalyzingTariffs && (
                <div className="space-y-2">
                  {visibleOffers.map((offer) => {
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
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                              <span className="text-sm font-medium truncate">{offer.name}</span>
                              <Badge variant="secondary" className="shrink-0 text-xs">{offer.count}</Badge>
                            </div>
                            <Badge 
                              variant={
                                suggestion?.userChoice === "skip" || (suggestion?.action === "skip" && !suggestion?.userChoice)
                                  ? "destructive" 
                                  : suggestion?.userChoice === "archive_unknown" || suggestion?.action === "archive_unknown"
                                  ? "outline"
                                  : suggestion?.targetTariffId || suggestion?.userChoice
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-xs shrink-0"
                            >
                              {suggestion?.userChoice 
                                ? (suggestion.userChoice === "skip" ? "SKIP" : suggestion.userChoice === "archive_unknown" ? "ARCHIVE" : suggestion.userChoice.toUpperCase())
                                : suggestion?.action === "archive_unknown" 
                                ? "ARCHIVE" 
                                : suggestion?.targetTariffCode?.toUpperCase() || "?"}
                            </Badge>
                          </div>
                        </CardHeader>
                        
                        {isExpanded && (
                          <CardContent className="py-2 px-3 border-t space-y-2">
                            {suggestion?.reason && (
                              <p className="text-xs text-muted-foreground">{suggestion.reason}</p>
                            )}
                            
                            <div className="flex flex-wrap gap-2">
                              <Select
                                value={suggestion?.userChoice || suggestion?.targetTariffCode || "__none__"}
                                onValueChange={(v) => {
                                  setTariffSuggestions(prev => prev.map(s => 
                                    s.pattern === offer.name 
                                      ? { ...s, userChoice: v === "__none__" ? undefined : v }
                                      : s
                                  ));
                                }}
                              >
                                <SelectTrigger className="flex-1 min-w-[140px] h-8">
                                  <SelectValue placeholder="Выбрать тариф" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Автоматически —</SelectItem>
                                  <SelectItem value="skip">❌ Пропустить</SelectItem>
                                  <SelectItem value="archive_unknown">📦 ARCHIVE (без тарифа)</SelectItem>
                                  <Separator className="my-1" />
                                  {tariffs?.map(t => (
                                    <SelectItem key={t.id} value={t.code}>
                                      {t.code.toUpperCase()} — {t.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              
                              {suggestion && suggestion.targetTariffId && (
                                <Button 
                                  size="sm" 
                                  variant="ghost"
                                  className="h-8"
                                  onClick={() => saveMappingRule.mutate(suggestion)}
                                  disabled={saveMappingRule.isPending}
                                >
                                  <Save className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                  
                  {uniqueOffers.length > 15 && !showAllOffers && (
                    <Button 
                      variant="ghost" 
                      className="w-full text-sm"
                      onClick={() => setShowAllOffers(true)}
                    >
                      Показать ещё {uniqueOffers.length - 15} офферов
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 4: Settings & Preview */}
          {step === 4 && (
            <div className="space-y-4 p-4">
              {/* Main toggle */}
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Filter className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">Только оплаченные</p>
                      <p className="text-xs text-muted-foreground">
                        {settings.onlyPaid 
                          ? `Только статусы: ${PAID_STATUSES.join(", ")}`
                          : "Импорт всех статусов"
                        }
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.onlyPaid}
                    onCheckedChange={(checked) => setSettings(prev => ({ ...prev, onlyPaid: checked }))}
                  />
                </div>
              </Card>

              {/* Preview Stats */}
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm flex items-center justify-between">
                    Превью импорта
                    {previewStats.total === 0 && settings.onlyPaid && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => setSettings(prev => ({ ...prev, onlyPaid: false }))}
                      >
                        Сбросить фильтр
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <p className="text-2xl font-bold">{previewStats.total}</p>
                        <p className="text-xs text-muted-foreground">К импорту</p>
                      </div>
                      <div className="text-center p-3 bg-muted/50 rounded-lg">
                        <p className="text-2xl font-bold">{previewStats.uniqueEmails}</p>
                        <p className="text-xs text-muted-foreground">Клиентов</p>
                      </div>
                    </div>

                    {/* Access status stats */}
                    {(previewStats.activeSubscriptions > 0 || previewStats.expiredSubscriptions > 0) && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="text-center p-2 bg-green-500/10 rounded-lg border border-green-500/20">
                          <p className="text-lg font-bold text-green-600">{previewStats.activeSubscriptions}</p>
                          <p className="text-xs text-muted-foreground">Активных</p>
                        </div>
                        <div className="text-center p-2 bg-muted/50 rounded-lg">
                          <p className="text-lg font-bold text-muted-foreground">{previewStats.expiredSubscriptions}</p>
                          <p className="text-xs text-muted-foreground">Истекших</p>
                        </div>
                      </div>
                    )}

                    {previewStats.total === 0 && (
                      <Alert variant="destructive" className="py-2">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          {settings.onlyPaid && previewStats.skippedByStatus > 0
                            ? `Фильтр «только оплаченные» пропустил ${previewStats.skippedByStatus} сделок`
                            : "Нет сделок для импорта. Проверьте маппинг тарифов."
                          }
                        </AlertDescription>
                      </Alert>
                    )}

                    {(previewStats.skippedByStatus > 0 || previewStats.skippedByUnclearTariff > 0 || previewStats.skippedByUserSkip > 0) && previewStats.total > 0 && (
                      <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
                        <p className="font-medium text-sm mb-1">Пропущено:</p>
                        {previewStats.skippedByStatus > 0 && (
                          <p>• По статусу: {previewStats.skippedByStatus}</p>
                        )}
                        {previewStats.skippedByUnclearTariff > 0 && (
                          <p>• Непонятный тариф: {previewStats.skippedByUnclearTariff}</p>
                        )}
                        {previewStats.skippedByUserSkip > 0 && (
                          <p>• Вручную: {previewStats.skippedByUserSkip}</p>
                        )}
                      </div>
                    )}
                    
                    {previewStats.byTariff.length > 0 && (
                      <>
                        <Separator />
                        <div className="text-xs font-medium">По тарифам:</div>
                        <div className="space-y-1">
                          {previewStats.byTariff.slice(0, 6).map(([code, count]) => (
                            <div key={code} className="flex justify-between text-sm">
                              <span className={code === "UNKNOWN" ? "text-destructive" : ""}>
                                {code === "UNKNOWN" ? "⚠️ UNKNOWN" : code.toUpperCase()}
                              </span>
                              <Badge variant={code === "UNKNOWN" ? "destructive" : "secondary"} className="text-xs">
                                {count}
                              </Badge>
                            </div>
                          ))}
                          {previewStats.byTariff.length > 6 && (
                            <p className="text-xs text-muted-foreground">
                              +{previewStats.byTariff.length - 6} тарифов
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Additional settings - collapsed by default */}
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 group-open:rotate-90 transition-transform" />
                  Дополнительные настройки
                </summary>
                <div className="mt-3 space-y-3">
                  <Card className="p-3">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="normalizeNames"
                          checked={settings.normalizeNames}
                          onCheckedChange={(checked) => setSettings(prev => ({ ...prev, normalizeNames: !!checked }))}
                        />
                        <label htmlFor="normalizeNames" className="text-sm">
                          Нормализовать имена
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="mergeEmailDuplicates"
                          checked={settings.mergeEmailDuplicates}
                          onCheckedChange={(checked) => setSettings(prev => ({ ...prev, mergeEmailDuplicates: !!checked }))}
                        />
                        <label htmlFor="mergeEmailDuplicates" className="text-sm">
                          Объединять профили по email
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="ghost"
                          checked={settings.createGhostProfiles}
                          onCheckedChange={(checked) => setSettings(prev => ({ ...prev, createGhostProfiles: !!checked }))}
                        />
                        <label htmlFor="ghost" className="text-sm">
                          Создавать ghost-профили
                        </label>
                      </div>
                    </div>
                  </Card>
                </div>
              </details>
            </div>
          )}

          {/* Step 5: Import Results */}
          {step === 5 && (
            <div className="space-y-4 p-4">
              {!importResult && !isImporting && (
                <div className="text-center space-y-4 py-6">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Upload className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">Готово к импорту</h3>
                    <p className="text-muted-foreground text-sm">
                      {previewStats.total} сделок → {previewStats.uniqueEmails} клиентов
                    </p>
                  </div>
                  
                  {previewStats.total === 0 ? (
                    <div className="space-y-3">
                      <Alert variant="destructive" className="text-left">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          Нет сделок для импорта. Вернитесь назад и проверьте настройки.
                        </AlertDescription>
                      </Alert>

                      <Button
                        onClick={() => {
                          setImportCancelled(false);
                          setIsImporting(true);
                          importMutation.mutate({ mode: "test5" });
                        }}
                        variant="outline"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Тест: 5 сделок
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button 
                        onClick={() => { setImportCancelled(false); setIsImporting(true); importMutation.mutate({ mode: "full" }); }} 
                        size="lg"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Начать импорт
                      </Button>
                      <Button 
                        onClick={() => { setImportCancelled(false); setIsImporting(true); importMutation.mutate({ mode: "test5" }); }} 
                        variant="outline"
                        size="lg"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Тест: 5 сделок
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {isImporting && !importResult && (
                <div className="text-center space-y-4 py-8">
                  <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
                  <p className="text-muted-foreground">Импорт в процессе...</p>
                  <Button 
                    variant="outline" 
                    onClick={handleCancelImport}
                    size="sm"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Отменить
                  </Button>
                </div>
              )}

              {importResult && (
                <div className="space-y-4">
                  <div className="text-center py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                      <Check className="h-8 w-8 text-green-500" />
                    </div>
                    <h3 className="text-lg font-medium">Импорт завершён</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <Card className="p-3 text-center">
                      <p className="text-xl font-bold text-green-600">{importResult.success}</p>
                      <p className="text-xs text-muted-foreground">Создано</p>
                    </Card>
                    <Card className="p-3 text-center">
                      <p className="text-xl font-bold">{importResult.skipped}</p>
                      <p className="text-xs text-muted-foreground">Пропущено</p>
                    </Card>
                    <Card className="p-3 text-center">
                      <p className="text-xl font-bold text-destructive">{importResult.errors.length}</p>
                      <p className="text-xs text-muted-foreground">Ошибок</p>
                    </Card>
                  </div>

                  {importResult.errors.length > 0 && (
                    <Card>
                      <CardHeader className="py-2 px-3">
                        <CardTitle className="text-sm text-destructive">Ошибки</CardTitle>
                      </CardHeader>
                      <CardContent className="px-3 pb-3">
                        <ScrollArea className="h-32">
                          {importResult.errors.slice(0, 20).map((e, i) => (
                            <p key={i} className="text-xs text-muted-foreground py-0.5">
                              {e.error}
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
        </div>

        {/* Navigation - Fixed at bottom */}
        {step < 5 && (
          <div className="flex justify-between p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t bg-background">
            <Button
              variant="outline"
              onClick={() => setStep(s => Math.max(1, s - 1))}
              disabled={step === 1}
              size="sm"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <Button
              onClick={() => setStep(s => Math.min(5, s + 1))}
              disabled={!canProceedToStep(step + 1)}
              size="sm"
            >
              Далее
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { User, Mail, Phone, Check, Search, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface PickedContact {
  id: string;
  user_id?: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface ContactPickerOptions {
  title?: string;
  initialQuery?: string | null;
  helperText?: string;
  /**
   * 'name_only' — Stage 3R.2: search strictly by full/first/last name,
   * hide email/phone in display. 'default' — legacy behaviour (ФИО/email/телефон).
   */
  searchMode?: "default" | "name_only";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (contact: PickedContact) => void;
  options?: ContactPickerOptions;
  /** Optional slot rendered above footer buttons (e.g. card-link explainer). */
  footerExtras?: React.ReactNode;
}

export function ContactPickerDialog({
  open,
  onOpenChange,
  onPick,
  options,
  footerExtras,
}: Props) {
  const { title, initialQuery, helperText, searchMode } = options ?? {};
  const nameOnly = searchMode === "name_only";
  const [search, setSearch] = useState(initialQuery ?? "");
  const [results, setResults] = useState<PickedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PickedContact | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSearch(initialQuery ?? "");
      setResults([]);
      setSelected(null);
      setHasSearched(false);
      setSearchError(null);
    }
  }, [open, initialQuery]);

  const handleSearch = useCallback(async () => {
    const term = search.trim();
    if (!term || term.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      if (nameOnly) {
        // Stage 3R.2: direct profiles query by name fields only.
        const pattern = `%${term}%`;
        const { data, error } = await supabase
          .from("profiles")
          .select("id, user_id, full_name, first_name, last_name, email, phone")
          .or(
            `full_name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern}`,
          )
          .limit(30);
        if (error) throw error;
        const mapped: PickedContact[] = (data ?? []).map((p: any) => ({
          id: p.id,
          user_id: p.user_id ?? null,
          full_name:
            p.full_name ||
            [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
            null,
          email: p.email ?? null,
          phone: p.phone ?? null,
        }));
        setResults(mapped);
        setHasSearched(true);
      } else {
        const { data, error } = await supabase.functions.invoke("admin-search-profiles", {
          body: { query: term, limit: 30 },
        });
        if (error) throw error;
        if (!data?.success) {
          if (data?.error?.includes("Forbidden")) {
            setSearchError("Недостаточно прав для поиска контактов.");
          }
          throw new Error(data?.error || "Search failed");
        }
        setResults(data.results || []);
        setHasSearched(true);
      }
    } catch (e: any) {
      if (!searchError) toast.error(`Ошибка поиска: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [search, searchError, nameOnly]);

  // Debounced auto-search
  useEffect(() => {
    if (!open || search.trim().length < 2) return;
    const timer = setTimeout(() => {
      handleSearch();
    }, 500);
    return () => clearTimeout(timer);
  }, [search, open, handleSearch]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {title ?? "Выбрать контакт"}
          </DialogTitle>
          {helperText ? (
            <p className="text-sm text-muted-foreground mt-1">{helperText}</p>
          ) : null}
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="contact-picker-search" className="sr-only">Поиск</Label>
                <Input
                  id="contact-picker-search"
                  placeholder={nameOnly ? "Имя (мин. 2 символа)..." : "ФИО, email или телефон (мин. 2 символа)..."}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  autoFocus
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || search.trim().length < 2}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Поиск автоматически запускается при вводе. Поддерживается латиница и кириллица.
            </p>
          </div>

          {searchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}

          <ScrollArea className="h-[200px] border rounded-md">
            {loading && results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                Поиск...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                {hasSearched
                  ? "Контакты не найдены. Попробуйте другой запрос."
                  : "Введите запрос для поиска (мин. 2 символа)"}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {results.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => setSelected(profile)}
                    className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-3 ${
                      selected?.id === profile.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {profile.full_name || (nameOnly ? "Контакт без имени" : "Без имени")}
                      </div>
                      {!nameOnly && (
                        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                          {profile.email && (
                            <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{profile.email}</span>
                          )}
                          {profile.phone && (
                            <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{profile.phone}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {selected?.id === profile.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          {results.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              Найдено: {results.length}
            </p>
          )}

          {footerExtras}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={() => { if (selected) onPick(selected); }} disabled={!selected}>
            Выбрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

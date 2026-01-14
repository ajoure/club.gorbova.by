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

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface LinkContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentId: string;
  rawSource: 'queue' | 'payments_v2';
  initialEmail?: string | null;
  initialPhone?: string | null;
  onSuccess: () => void;
}

// Normalize search term for better matching
function normalizeSearch(term: string): string {
  return term
    .toLowerCase()
    .replace(/[\s\-\(\)]/g, '') // Remove spaces, dashes, parentheses
    .replace(/^\+/, ''); // Remove leading +
}

// Basic Latin to Cyrillic mapping for common names
const TRANSLIT_MAP: Record<string, string> = {
  'a': 'а', 'b': 'б', 'v': 'в', 'g': 'г', 'd': 'д', 'e': 'е', 
  'z': 'з', 'i': 'и', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
  'o': 'о', 'p': 'п', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
  'f': 'ф', 'y': 'й', 'yu': 'ю', 'ya': 'я', 'ch': 'ч', 'sh': 'ш',
  'zh': 'ж', 'kh': 'х', 'ts': 'ц',
};

function transliterateToCyrillic(text: string): string {
  let result = text.toLowerCase();
  
  // Multi-character replacements first
  const multiChar = ['shch', 'yu', 'ya', 'ch', 'sh', 'zh', 'kh', 'ts'];
  for (const mc of multiChar) {
    if (TRANSLIT_MAP[mc]) {
      result = result.replace(new RegExp(mc, 'g'), TRANSLIT_MAP[mc]);
    }
  }
  
  // Single character replacements
  for (const [lat, cyr] of Object.entries(TRANSLIT_MAP)) {
    if (lat.length === 1) {
      result = result.replace(new RegExp(lat, 'g'), cyr);
    }
  }
  
  return result;
}

export function LinkContactDialog({ 
  open, 
  onOpenChange, 
  paymentId, 
  rawSource,
  initialEmail,
  initialPhone,
  onSuccess 
}: LinkContactDialogProps) {
  const [search, setSearch] = useState(initialEmail || initialPhone || "");
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSearch(initialEmail || initialPhone || "");
      setResults([]);
      setSelected(null);
      setHasSearched(false);
      setSearchError(null);
    }
  }, [open, initialEmail, initialPhone]);

  // Debounced search - auto-search after 500ms of typing (if 3+ chars)
  useEffect(() => {
    if (!open || search.trim().length < 2) return;
    
    const timer = setTimeout(() => {
      handleSearch();
    }, 500);
    
    return () => clearTimeout(timer);
  }, [search, open]);

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
      // Use edge function to bypass RLS issues
      const { data, error } = await supabase.functions.invoke('admin-search-profiles', {
        body: { query: term, limit: 30 }
      });

      if (error) throw error;
      if (!data?.success) {
        if (data?.error?.includes('Forbidden')) {
          setSearchError("Недостаточно прав для поиска контактов.");
        }
        throw new Error(data?.error || 'Search failed');
      }
      
      setResults(data.results || []);
      setHasSearched(true);
    } catch (e: any) {
      console.error('Search error:', e);
      if (!searchError) {
        toast.error(`Ошибка поиска: ${e.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [search, searchError]);

  const handleLink = async () => {
    if (!selected) return;
    
    setSaving(true);
    try {
      if (rawSource === 'queue') {
        const { error } = await supabase
          .from("payment_reconcile_queue")
          .update({ matched_profile_id: selected.id })
          .eq("id", paymentId);
        
        if (error) throw error;
        
        // After linking, try to trigger auto-process
        try {
          await supabase.functions.invoke('bepaid-auto-process', {
            body: { queueItemId: paymentId, dryRun: false }
          });
        } catch (procErr) {
          console.warn('Auto-process after link failed:', procErr);
        }
      } else {
        // For payments_v2, update the linked order's profile
        toast.info("Для связи с payments_v2 используйте редактирование сделки");
      }
      
      toast.success("Контакт связан");
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Связать контакт
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Search input with auto-search indicator */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="search" className="sr-only">Поиск</Label>
                <Input
                  id="search"
                  placeholder="ФИО, email или телефон (мин. 2 символа)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  autoFocus
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || search.trim().length < 2}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Поиск автоматически запускается при вводе. Поддерживается поиск по латинице и кириллице.
            </p>
          </div>
          
          {/* RLS error alert */}
          {searchError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}
          
          {/* Results */}
          <ScrollArea className="h-[250px] border rounded-md">
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
                        {profile.full_name || "Без имени"}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        {profile.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {profile.email}
                          </span>
                        )}
                        {profile.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {profile.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    {selected?.id === profile.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          
          {/* Result count */}
          {results.length > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              Найдено: {results.length} {results.length === 20 ? "(показаны первые 20)" : ""}
            </p>
          )}
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleLink} disabled={!selected || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Связать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

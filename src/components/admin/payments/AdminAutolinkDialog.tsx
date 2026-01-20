import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link2, Search, Loader2, AlertTriangle, CheckCircle2, XCircle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ProfileSearchResult {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface AutolinkResult {
  ok: boolean;
  dry_run: boolean;
  status: 'success' | 'stop' | 'error';
  stats: {
    candidates_payments: number;
    candidates_queue: number;
    updated_payments_profile: number;
    updated_queue_profile: number;
    skipped_already_linked: number;
    conflicts: number;
  };
  stop_reason?: string;
  samples?: {
    payments_updated: Array<{ id: string; bepaid_uid?: string; amount: number; paid_at?: string }>;
    conflicts: Array<{ id: string; reason: string }>;
  };
}

interface AdminAutolinkDialogProps {
  onComplete: () => void;
  renderTrigger: (onClick: () => void) => React.ReactNode;
  prefillLast4?: string;
  prefillBrand?: string;
}

const CARD_BRANDS = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'belkart', label: 'Belkart' },
  { value: 'maestro', label: 'Maestro' },
  { value: 'mir', label: 'МИР' },
];

export default function AdminAutolinkDialog({
  onComplete,
  renderTrigger,
  prefillLast4,
  prefillBrand,
}: AdminAutolinkDialogProps) {
  const [open, setOpen] = useState(false);
  
  // Form state
  const [selectedProfile, setSelectedProfile] = useState<ProfileSearchResult | null>(null);
  const [cardLast4, setCardLast4] = useState(prefillLast4 || "");
  const [cardBrand, setCardBrand] = useState(prefillBrand || "");
  const [dryRun, setDryRun] = useState(true);
  const [limit, setLimit] = useState(200);
  const [unsafeAllowLarge, setUnsafeAllowLarge] = useState(false);
  
  // Contact search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  
  // Execution state
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<AutolinkResult | null>(null);
  const [dryRunCompleted, setDryRunCompleted] = useState(false);

  const handleOpen = () => {
    setOpen(true);
    // Reset if prefill changed
    if (prefillLast4) setCardLast4(prefillLast4);
    if (prefillBrand) setCardBrand(prefillBrand);
  };

  const handleClose = () => {
    setOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedProfile(null);
    setCardLast4(prefillLast4 || "");
    setCardBrand(prefillBrand || "");
    setDryRun(true);
    setLimit(200);
    setUnsafeAllowLarge(false);
    setSearchQuery("");
    setSearchResults([]);
    setResult(null);
    setDryRunCompleted(false);
  };

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-search-profiles', {
        body: { query, limit: 20 }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Search failed');
      
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search error:", err);
      toast.error("Ошибка поиска контактов");
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSelectProfile = (profile: ProfileSearchResult) => {
    setSelectedProfile(profile);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleExecute = async (isDryRun: boolean) => {
    if (!selectedProfile || !cardLast4 || !cardBrand) {
      toast.error("Заполните все обязательные поля");
      return;
    }

    if (cardLast4.length !== 4 || !/^\d{4}$/.test(cardLast4)) {
      toast.error("Last4 должен содержать ровно 4 цифры");
      return;
    }

    setExecuting(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('payments-autolink-by-card', {
        body: {
          profile_id: selectedProfile.id,
          card_last4: cardLast4,
          card_brand: cardBrand,
          dry_run: isDryRun,
          limit,
          unsafe_allow_large: unsafeAllowLarge,
        }
      });

      if (error) throw error;
      
      const autoResult = data as AutolinkResult;
      setResult(autoResult);

      if (isDryRun) {
        setDryRunCompleted(autoResult.status === 'success');
        if (autoResult.status === 'stop') {
          toast.warning(`Остановлено: ${getStopReasonLabel(autoResult.stop_reason)}`);
        } else {
          toast.success(`Dry-run завершён: найдено ${autoResult.stats.candidates_payments + autoResult.stats.candidates_queue} кандидатов`);
        }
      } else {
        if (autoResult.status === 'success') {
          const total = autoResult.stats.updated_payments_profile + autoResult.stats.updated_queue_profile;
          toast.success(`Привязано ${total} транзакций к контакту`);
          onComplete();
        } else {
          toast.error(`Ошибка: ${getStopReasonLabel(autoResult.stop_reason)}`);
        }
      }
    } catch (err: unknown) {
      console.error("Autolink error:", err);
      const message = err instanceof Error ? err.message : 'Неизвестная ошибка';
      toast.error(`Ошибка автопривязки: ${message}`);
    } finally {
      setExecuting(false);
    }
  };

  const getStopReasonLabel = (reason?: string): string => {
    switch (reason) {
      case 'card_collision_last4_brand':
        return 'Карта связана с несколькими контактами';
      case 'too_many_candidates':
        return 'Слишком много кандидатов (увеличьте лимит)';
      case 'missing_required_params':
        return 'Не заполнены обязательные поля';
      default:
        return reason || 'Неизвестная причина';
    }
  };

  const canExecute = selectedProfile && cardLast4.length === 4 && cardBrand && dryRunCompleted && result?.status === 'success';

  return (
    <>
      {renderTrigger(handleOpen)}
      
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Автопривязка по карте
            </DialogTitle>
            <DialogDescription>
              Привязать исторические транзакции к контакту по данным карты
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 py-4">
              {/* Contact picker */}
              <div className="space-y-2">
                <Label>Контакт *</Label>
                {selectedProfile ? (
                  <Card className="bg-muted/50">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{selectedProfile.full_name || 'Без имени'}</div>
                          <div className="text-sm text-muted-foreground">
                            {selectedProfile.email || selectedProfile.phone || selectedProfile.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedProfile(null);
                          setResult(null);
                          setDryRunCompleted(false);
                        }}
                      >
                        Изменить
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Поиск по имени, email, телефону..."
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      className="pl-10"
                    />
                    {searching && (
                      <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin" />
                    )}
                    
                    {/* Search results dropdown */}
                    {searchResults.length > 0 && (
                      <Card className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-auto">
                        <CardContent className="p-1">
                          {searchResults.map((profile) => (
                            <button
                              key={profile.id}
                              className="w-full text-left px-3 py-2 hover:bg-muted rounded-md transition-colors"
                              onClick={() => handleSelectProfile(profile)}
                            >
                              <div className="font-medium">{profile.full_name || 'Без имени'}</div>
                              <div className="text-sm text-muted-foreground">
                                {profile.email} {profile.phone && `• ${profile.phone}`}
                              </div>
                            </button>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </div>

              {/* Card details */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="last4">Last 4 цифры *</Label>
                  <Input
                    id="last4"
                    placeholder="1234"
                    value={cardLast4}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setCardLast4(val);
                      setResult(null);
                      setDryRunCompleted(false);
                    }}
                    maxLength={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Бренд карты *</Label>
                  <Select 
                    value={cardBrand} 
                    onValueChange={(v) => {
                      setCardBrand(v);
                      setResult(null);
                      setDryRunCompleted(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите бренд" />
                    </SelectTrigger>
                    <SelectContent>
                      {CARD_BRANDS.map((brand) => (
                        <SelectItem key={brand.value} value={brand.value}>
                          {brand.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Settings */}
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Лимит записей</Label>
                    <p className="text-sm text-muted-foreground">Максимальное количество кандидатов</p>
                  </div>
                  <Input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value) || 200)}
                    className="w-24"
                    min={10}
                    max={1000}
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Разрешить больше лимита</Label>
                    <p className="text-sm text-muted-foreground">Обработать даже если кандидатов больше лимита</p>
                  </div>
                  <Switch
                    checked={unsafeAllowLarge}
                    onCheckedChange={setUnsafeAllowLarge}
                  />
                </div>
              </div>

              {/* Result */}
              {result && (
                <Card className={cn(
                  "border-2",
                  result.status === 'success' && "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
                  result.status === 'stop' && "border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20",
                  result.status === 'error' && "border-red-500/50 bg-red-50/50 dark:bg-red-950/20"
                )}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {result.status === 'success' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                      {result.status === 'stop' && <AlertTriangle className="h-5 w-5 text-yellow-600" />}
                      {result.status === 'error' && <XCircle className="h-5 w-5 text-red-600" />}
                      Результат {result.dry_run ? 'dry-run' : 'выполнения'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Кандидаты (payments_v2):</span>
                        <Badge variant="outline">{result.stats.candidates_payments}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Кандидаты (queue):</span>
                        <Badge variant="outline">{result.stats.candidates_queue}</Badge>
                      </div>
                      {!result.dry_run && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Обновлено payments:</span>
                            <Badge variant="secondary">{result.stats.updated_payments_profile}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Обновлено queue:</span>
                            <Badge variant="secondary">{result.stats.updated_queue_profile}</Badge>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Уже связаны:</span>
                        <Badge variant="outline">{result.stats.skipped_already_linked}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Конфликты:</span>
                        <Badge variant={result.stats.conflicts > 0 ? "destructive" : "outline"}>
                          {result.stats.conflicts}
                        </Badge>
                      </div>
                    </div>

                    {result.stop_reason && (
                      <div className="flex items-center gap-2 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded text-sm">
                        <AlertTriangle className="h-4 w-4 text-yellow-600" />
                        <span>{getStopReasonLabel(result.stop_reason)}</span>
                      </div>
                    )}

                    {result.samples?.payments_updated && result.samples.payments_updated.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Примеры ({result.samples.payments_updated.length}):</div>
                        <div className="space-y-1 max-h-32 overflow-auto">
                          {result.samples.payments_updated.slice(0, 5).map((sample, idx) => (
                            <div key={idx} className="text-xs text-muted-foreground flex gap-2">
                              <span className="font-mono">{sample.bepaid_uid || sample.id.slice(0, 8)}</span>
                              <span>{sample.amount} BYN</span>
                              {sample.paid_at && <span>{new Date(sample.paid_at).toLocaleDateString('ru')}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleClose}>
              Отмена
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleExecute(true)}
              disabled={executing || !selectedProfile || !cardLast4 || !cardBrand}
            >
              {executing && dryRun ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Dry-run
            </Button>
            <Button
              onClick={() => handleExecute(false)}
              disabled={executing || !canExecute}
              className="gap-2"
            >
              {executing && !dryRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Выполнить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

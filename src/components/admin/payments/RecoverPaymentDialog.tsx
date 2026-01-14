import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Search, Check, AlertCircle, Info, ChevronDown, Calendar, CreditCard, Package, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecoverPaymentDialogProps {
  onRecovered?: () => void;
  trigger?: React.ReactNode;
}

interface RecoverResult {
  success: boolean;
  action: 'created' | 'updated' | 'already_exists' | 'not_found' | 'error';
  uid: string | null;
  message: string;
  details?: any;
}

export default function RecoverPaymentDialog({ onRecovered, trigger }: RecoverPaymentDialogProps) {
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState("");
  const [trackingId, setTrackingId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RecoverResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  
  // Validation
  const isUidValid = !uid.trim() || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid.trim());
  const hasInput = uid.trim() || trackingId.trim();
  
  const handlePreview = async () => {
    if (!hasInput) {
      toast.error("Заполните UID или tracking_id");
      return;
    }
    
    if (uid.trim() && !isUidValid) {
      toast.error("UID должен быть в формате UUID");
      return;
    }
    
    setIsLoading(true);
    setResult(null);
    setShowDetails(false);
    
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-recover-payment', {
        body: { 
          uid: uid.trim() || undefined,
          tracking_id: trackingId.trim() || undefined,
          dry_run: true,
        }
      });
      
      if (error) throw error;
      setResult(data as RecoverResult);
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
      setResult({
        success: false,
        action: 'error',
        uid: uid || null,
        message: e.message,
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleExecute = async () => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-recover-payment', {
        body: { 
          uid: uid.trim() || undefined,
          tracking_id: trackingId.trim() || undefined,
          dry_run: false,
        }
      });
      
      if (error) throw error;
      
      setResult(data as RecoverResult);
      
      if (data.action === 'created') {
        toast.success("Платёж добавлен в очередь");
        onRecovered?.();
      }
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setUid("");
    setTrackingId("");
    setShowDetails(false);
  };
  
  // Check if execute is allowed
  // Check if execute is allowed - action is 'created' means we CAN create it, and we're in dry_run preview mode
  const canExecute = result?.success && result?.action === 'created' && result?.details?.dry_run === true;
  
  // Parse transaction details for summary card
  const txDetails = result?.details?.record || result?.details?.transaction;
  
  const formatAmount = (amount: number | undefined) => {
    if (!amount) return "—";
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const getStatusBadge = (status: string | undefined) => {
    if (!status) return null;
    const normalized = status.toLowerCase();
    
    if (['successful', 'succeeded'].includes(normalized)) {
      return <Badge className="bg-green-500/10 text-green-600 border-green-200">Успешный</Badge>;
    }
    if (['pending', 'incomplete'].includes(normalized)) {
      return <Badge variant="secondary">Ожидание</Badge>;
    }
    if (['failed', 'canceled', 'declined', 'expired'].includes(normalized)) {
      return <Badge variant="destructive">Неуспешный</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };
  
  const getActionBadge = (action: string) => {
    switch (action) {
      case 'created':
        return <Badge className="bg-green-500/10 text-green-600 border-green-200">Будет создано</Badge>;
      case 'already_exists':
        return <Badge variant="secondary">Уже существует</Badge>;
      case 'not_found':
        return <Badge variant="destructive">Не найдено</Badge>;
      case 'error':
        return <Badge variant="destructive">Ошибка</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(o); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Восстановить платёж
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="space-y-1.5 pb-2">
          <DialogTitle className="text-lg">Восстановить пропущенный платёж</DialogTitle>
          <DialogDescription className="text-sm">
            Введите UID транзакции bePaid или tracking_id. Достаточно одного поля (приоритет — UID).
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          {/* Input section */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="uid" className="text-sm font-medium">UID транзакции (bePaid)</Label>
              <Input
                id="uid"
                placeholder="faf142e2-..."
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                disabled={isLoading}
                className={cn("h-9", !isUidValid && "border-destructive focus-visible:ring-destructive")}
              />
              {!isUidValid && (
                <p className="text-xs text-destructive">UID должен быть в формате UUID</p>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">или</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="tracking_id" className="text-sm font-medium">Tracking ID</Label>
              <Input
                id="tracking_id"
                placeholder="lead_... / order_..."
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                disabled={isLoading}
                className="h-9"
              />
            </div>
          </div>
          
          {/* Result section - summary card */}
          {result && (
            <div className="border rounded-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                <span className="text-sm font-medium">Результат</span>
                {getActionBadge(result.action)}
              </div>
              
              {/* Summary card */}
              {txDetails && (
                <div className="p-3 space-y-3">
                  {/* Amount + Status row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-muted-foreground" />
                      <span className="text-lg font-semibold tabular-nums">
                        {formatAmount(txDetails.amount)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {txDetails.currency || 'BYN'}
                      </span>
                    </div>
                    {getStatusBadge(txDetails.status_normalized || txDetails.status)}
                  </div>
                  
                  {/* Details grid */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {/* UID */}
                    <div className="flex items-start gap-2">
                      <CreditCard className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">UID</p>
                        <p className="font-mono text-xs truncate">
                          {txDetails.bepaid_uid || result.uid || '—'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Date */}
                    <div className="flex items-start gap-2">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                      <div>
                        <p className="text-xs text-muted-foreground">Дата</p>
                        <p className="text-xs">
                          {txDetails.paid_at 
                            ? new Date(txDetails.paid_at).toLocaleString('ru-RU', { 
                                day: '2-digit', month: '2-digit', year: '2-digit',
                                hour: '2-digit', minute: '2-digit'
                              })
                            : '—'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Product */}
                    {(txDetails.product_name || txDetails.description) && (
                      <div className="col-span-2 flex items-start gap-2">
                        <Package className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">Продукт</p>
                          <p className="text-xs truncate">
                            {txDetails.product_name || txDetails.description}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* JSON details - collapsible */}
                  <Collapsible open={showDetails} onOpenChange={setShowDetails}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-7">
                        <span>Показать детали (JSON)</span>
                        <ChevronDown className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          showDetails && "rotate-180"
                        )} />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40 mt-2">
                        <pre>{JSON.stringify(result.details, null, 2)}</pre>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )}
              
              {/* Message only (no txDetails) */}
              {!txDetails && result.message && (
                <div className="p-3">
                  <p className="text-sm text-muted-foreground">{result.message}</p>
                </div>
              )}
              
              {/* Execute button - only after successful preview */}
              {canExecute && (
                <div className="p-3 border-t bg-muted/20">
                  <Button 
                    onClick={handleExecute}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    Добавить в очередь
                  </Button>
                </div>
              )}
              
              {/* Info message for non-executable states */}
              {result.action === 'already_exists' && (
                <div className="p-3 border-t">
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Транзакция уже существует в системе. Добавление невозможно.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
              
              {result.action === 'not_found' && (
                <div className="p-3 border-t">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Транзакция не найдена в bePaid. Проверьте UID или tracking_id.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Закрыть
          </Button>
          <Button 
            onClick={handlePreview}
            disabled={isLoading || !hasInput || !isUidValid}
          >
            {isLoading && !result ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Найти (preview)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

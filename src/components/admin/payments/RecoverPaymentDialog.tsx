import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Search, Check, AlertCircle, Info } from "lucide-react";

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
  const [isDryRun, setIsDryRun] = useState(true);
  
  const handleSearch = async () => {
    if (!uid.trim() && !trackingId.trim()) {
      toast.error("Введите UID или tracking_id");
      return;
    }
    
    setIsLoading(true);
    setResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('bepaid-recover-payment', {
        body: { 
          uid: uid.trim() || undefined,
          tracking_id: trackingId.trim() || undefined,
          dry_run: isDryRun,
        }
      });
      
      if (error) throw error;
      
      setResult(data as RecoverResult);
      
      if (data.action === 'created' && !isDryRun) {
        toast.success("Платёж добавлен в очередь");
        onRecovered?.();
      }
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
    setIsDryRun(false);
    await handleSearch();
  };
  
  const handleClose = () => {
    setOpen(false);
    setResult(null);
    setUid("");
    setTrackingId("");
    setIsDryRun(true);
  };
  
  const getActionBadge = (action: string) => {
    switch (action) {
      case 'created':
        return <Badge className="bg-green-500">{isDryRun ? 'Будет создано' : 'Создано'}</Badge>;
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Восстановить пропущенный платёж</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Введите UID транзакции из bePaid или tracking_id для поиска и восстановления платежа.
            </AlertDescription>
          </Alert>
          
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="uid">UID транзакции (bePaid)</Label>
              <Input
                id="uid"
                placeholder="e.g. a1b2c3d4-e5f6-7890-..."
                value={uid}
                onChange={(e) => setUid(e.target.value)}
                disabled={isLoading}
              />
            </div>
            
            <div className="text-center text-xs text-muted-foreground">или</div>
            
            <div className="space-y-2">
              <Label htmlFor="tracking_id">Tracking ID</Label>
              <Input
                id="tracking_id"
                placeholder="e.g. order_12345"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </div>
          
          {/* Result display */}
          {result && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Результат:</span>
                {getActionBadge(result.action)}
              </div>
              
              <p className="text-sm text-muted-foreground">{result.message}</p>
              
              {result.details && (
                <div className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-40">
                  <pre>{JSON.stringify(result.details, null, 2)}</pre>
                </div>
              )}
              
              {/* Show execute button after dry-run preview */}
              {result.action === 'created' && isDryRun && result.details?.dry_run && (
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
                  Подтвердить и добавить в очередь
                </Button>
              )}
            </div>
          )}
        </div>
        
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>
            Закрыть
          </Button>
          <Button 
            onClick={() => { setIsDryRun(true); handleSearch(); }}
            disabled={isLoading || (!uid.trim() && !trackingId.trim())}
          >
            {isLoading ? (
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

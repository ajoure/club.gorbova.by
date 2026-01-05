import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { XCircle, RefreshCw, MessageCircle } from "lucide-react";

export function PaymentFailedDialog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    
    if (paymentStatus === "failed") {
      setOpen(true);
    }
  }, [searchParams]);

  const handleClose = () => {
    setOpen(false);
    // Remove payment param from URL
    searchParams.delete("payment");
    setSearchParams(searchParams);
  };

  const handleRetry = () => {
    handleClose();
    // Could navigate to pricing or open payment dialog
    window.location.href = "/pricing";
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <XCircle className="h-6 w-6 text-destructive" />
            Оплата не прошла
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
            <p className="text-sm text-foreground">
              К сожалению, платёж не был завершён. Это могло произойти по одной из причин:
            </p>
            <ul className="mt-2 text-sm text-muted-foreground space-y-1">
              <li>• Недостаточно средств на карте</li>
              <li>• Карта заблокирована банком</li>
              <li>• Превышен лимит операций</li>
              <li>• Платёж был отменён</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={handleRetry} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Попробовать снова
            </Button>
            
            <Button variant="outline" onClick={handleClose} className="w-full">
              <MessageCircle className="mr-2 h-4 w-4" />
              Связаться с поддержкой
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Если проблема повторяется, попробуйте использовать другую карту или свяжитесь с банком.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

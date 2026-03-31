import { useNavigate } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Info, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrainingUnlinkedBlockProps {
  moduleId?: string;
  className?: string;
}

export function TrainingUnlinkedBlock({ moduleId, className }: TrainingUnlinkedBlockProps) {
  const navigate = useNavigate();

  return (
    <Alert className={cn("border-muted bg-muted/30", className)}>
      <Info className="h-4 w-4 text-muted-foreground" />
      <AlertDescription className="ml-2 space-y-3">
        <div>
          <p className="text-sm font-medium">Тренинг не привязан к продукту</p>
          <p className="text-xs text-muted-foreground mt-1">
            Привяжите тренинг к продукту для настройки доступа. Доступ к контенту управляется через продукт.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => navigate("/admin/products-v2")}
        >
          <Link2 className="h-3.5 w-3.5" />
          Перейти к продуктам
        </Button>
      </AlertDescription>
    </Alert>
  );
}

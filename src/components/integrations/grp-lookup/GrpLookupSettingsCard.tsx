import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Search, Loader2 } from "lucide-react";
import { useGrpLookup } from "@/hooks/useGrpLookup";
import { GrpLookupAdapter } from "@/lib/legal-entities/adapters/GrpLookupAdapter";
import { isValidUnp } from "@/lib/legal-entities/normalizeUnp";
import type { LegalEntityPreviewData } from "@/lib/legal-entities/types";

export function GrpLookupSettingsCard() {
  const [unp, setUnp] = useState("");
  const [preview, setPreview] = useState<LegalEntityPreviewData | null>(null);
  const lookup = useGrpLookup();

  const handleLookup = async () => {
    setPreview(null);
    const result = await lookup.mutateAsync(unp);
    if (result.found) {
      setPreview(GrpLookupAdapter.resultToPreview(result));
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">МНС GRP Lookup</CardTitle>
          </div>
          <Badge variant="outline" className="text-green-600 border-green-300">
            Доступно
          </Badge>
        </div>
        <CardDescription>Поиск юрлица по УНП через реестр МНС</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={unp}
            onChange={(e) => setUnp(e.target.value)}
            placeholder="Введите УНП (9 цифр)…"
            className="h-9 text-sm"
            maxLength={12}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleLookup}
            disabled={!isValidUnp(unp) || lookup.isPending}
          >
            {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {lookup.isError && (
          <p className="text-sm text-destructive">Ошибка: {(lookup.error as Error)?.message}</p>
        )}

        {lookup.data && !lookup.data.found && (
          <p className="text-sm text-muted-foreground">{lookup.data.message || "Не найдено"}</p>
        )}

        {preview && (
          <div className="bg-muted/50 rounded-md p-3 space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{preview.full_name}</span>
              {preview.status_name && (
                <Badge variant="outline" className="text-xs">{preview.status_name}</Badge>
              )}
            </div>
            {preview.short_name && (
              <p className="text-muted-foreground text-xs">{preview.short_name}</p>
            )}
            <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground pt-1">
              <span>УНП: {preview.unp}</span>
              {preview.registration_date && <span>Рег.: {preview.registration_date}</span>}
              {preview.tax_office_name && <span className="col-span-2">ИМНС: {preview.tax_office_name}</span>}
              {preview.legal_address && <span className="col-span-2">Адрес: {preview.legal_address}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

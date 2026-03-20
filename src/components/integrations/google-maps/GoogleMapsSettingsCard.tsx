import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MapPin, Search, CheckCircle, XCircle } from "lucide-react";
import { useGoogleMapsLoader } from "@/hooks/useGoogleMapsLoader";
import { usePlaceAutocomplete } from "@/hooks/usePlaceAutocomplete";
import { GooglePlacesAdapter } from "@/lib/address/adapters/GooglePlacesAdapter";
import { formatFullAddress } from "@/lib/address/utils";

export function GoogleMapsSettingsCard() {
  const { isReady, isLoading, isError, error, hasApiKey } = useGoogleMapsLoader();
  const { predictions, fetchPredictions, fetchPlaceDetails, clearPredictions } = usePlaceAutocomplete();
  const [testQuery, setTestQuery] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = () => {
    if (testQuery.length >= 3) {
      fetchPredictions(testQuery);
    }
  };

  const handleSelectPrediction = async (prediction: (typeof predictions)[0]) => {
    const details = await fetchPlaceDetails(prediction);
    if (details) {
      const parsed = GooglePlacesAdapter.parseComponents(details.addressComponents as any[]);
      setTestResult(formatFullAddress(parsed));
    }
    clearPredictions();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Google Maps</CardTitle>
          </div>
          {hasApiKey ? (
            isReady ? (
              <Badge variant="outline" className="text-green-600 border-green-300">
                <CheckCircle className="h-3 w-3 mr-1" /> Подключено
              </Badge>
            ) : isLoading ? (
              <Badge variant="outline">Загрузка…</Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" /> Ошибка
              </Badge>
            )
          ) : (
            <Badge variant="secondary">API ключ не настроен</Badge>
          )}
        </div>
        <CardDescription>Автоподсказки адресов через Google Places API</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isError && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {!hasApiKey && (
          <p className="text-sm text-muted-foreground">
            Добавьте <code className="text-xs bg-muted px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code> в переменные окружения.
          </p>
        )}

        {isReady && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={testQuery}
                onChange={(e) => setTestQuery(e.target.value)}
                placeholder="Тестовый поиск адреса…"
                className="h-9 text-sm"
              />
              <Button size="sm" variant="outline" onClick={handleTest} disabled={testQuery.length < 3}>
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {predictions.length > 0 && (
              <ul className="border rounded-md divide-y text-sm">
                {predictions.map((p) => (
                  <li
                    key={p.placeId}
                    className="px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => handleSelectPrediction(p)}
                  >
                    <span className="font-medium">{p.mainText}</span>
                    {p.secondaryText && (
                      <span className="text-muted-foreground ml-1 text-xs">{p.secondaryText}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {testResult && (
              <div className="bg-muted/50 rounded-md p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-1">Распознанный адрес:</p>
                <p>{testResult}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

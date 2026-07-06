import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy } from "lucide-react";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "";
const MCP_URL = `https://${projectRef}.supabase.co/functions/v1/mcp`;

export default function ConnectAgent() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(MCP_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Подключение AI-ассистента</h1>
          <p className="text-muted-foreground">
            Подключите ChatGPT или Claude к Gorbova Club, чтобы работать с приложением
            через ассистента.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Адрес MCP-сервера</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm break-all">
                {MCP_URL}
              </code>
              <Button onClick={copy} size="sm" variant="outline">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-2">{copied ? "Скопировано" : "Копировать"}</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              При подключении вас попросят войти в аккаунт Gorbova Club и подтвердить доступ.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ChatGPT</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal ml-5 space-y-2 text-sm">
              <li>
                Откройте{" "}
                <a
                  className="underline"
                  href="https://chatgpt.com/#settings/Connectors/Advanced"
                  target="_blank"
                  rel="noreferrer"
                >
                  настройки коннекторов ChatGPT
                </a>{" "}
                и включите Developer mode (прочитайте предупреждение).
              </li>
              <li>В окне чата в меню «+» включите Developer mode.</li>
              <li>Нажмите «Add sources», затем «Connect more».</li>
              <li>Введите название коннектора и вставьте адрес MCP-сервера сверху.</li>
              <li>Попросите ChatGPT воспользоваться приложением.</li>
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Claude</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal ml-5 space-y-2 text-sm">
              <li>
                Откройте{" "}
                <a
                  className="underline"
                  href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                  target="_blank"
                  rel="noreferrer"
                >
                  форму добавления коннектора Claude
                </a>
                .
              </li>
              <li>Введите название коннектора и вставьте адрес MCP-сервера сверху.</li>
              <li>
                Включите коннектор в окне чата и попросите Claude воспользоваться приложением.
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

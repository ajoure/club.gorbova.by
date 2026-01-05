import { useState, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Database, Code, FileCode, AlertTriangle, CheckCircle, Trash2 } from "lucide-react";

interface AuditItem {
  name: string;
  type: "table" | "edge_function" | "page" | "component";
  used: boolean;
  usedWhere: string[];
  rowCount?: number;
  safeToRemove: boolean;
  recommendation: "keep" | "remove" | "migrate" | "review";
  notes: string;
}

// Known used tables (based on codebase analysis)
const USED_TABLES = [
  "profiles", "user_roles", "user_roles_v2", "roles", "permissions", "role_permissions",
  "products_v2", "tariffs", "tariff_offers", "tariff_prices", "pricing_stages", "payment_plans", "flows",
  "orders_v2", "payments_v2", "subscriptions_v2", "entitlements",
  "telegram_bots", "telegram_clubs", "telegram_access", "telegram_access_grants", "telegram_access_audit",
  "telegram_link_tokens", "telegram_logs", "telegram_club_members", "telegram_manual_access", "telegram_invites",
  "integration_instances", "integration_field_mappings", "integration_logs", "integration_sync_settings", "integration_sync_logs",
  "fields", "field_values",
  "email_accounts", "email_templates",
  "audit_logs", "impersonation_sessions",
  "balance_wheel_data", "wheel_balance_tasks", "sphere_goals", "eisenhower_tasks", "task_categories",
  "mns_response_documents", "contact_requests", "content",
  "duplicate_cases", "client_duplicates", "merge_history",
  "product_versions", "payment_settings",
];

// Legacy tables that can be removed after migration
const LEGACY_TABLES = [
  { name: "products", reason: "Replaced by products_v2", hasData: true },
  { name: "orders", reason: "Replaced by orders_v2", hasData: true },
  { name: "subscriptions", reason: "Replaced by subscriptions_v2", hasData: true },
  { name: "product_club_mappings", reason: "Replaced by products_v2.telegram_club_id", hasData: false },
  { name: "telegram_mtproto_sessions", reason: "MTProto feature disabled", hasData: false },
];

// Used edge functions
const USED_EDGE_FUNCTIONS = [
  "auth-actions", "roles-admin", "users-admin-actions",
  "bepaid-create-token", "bepaid-webhook",
  "telegram-webhook", "telegram-grant-access", "telegram-revoke-access", "telegram-check-expired",
  "telegram-bot-actions", "telegram-send-notification", "telegram-send-reminders", "telegram-mass-broadcast",
  "telegram-club-members", "telegram-cron-sync", "telegram-kick-violators", "telegram-link-manage",
  "send-email", "mns-response-generator",
  "amocrm-sync", "amocrm-webhook", "getcourse-webhook", "getcourse-sync",
  "integration-healthcheck", "integration-sync",
  "detect-duplicates", "merge-clients",
  "public-product", "subscription-charge", "cancel-trial",
  "analyze-task-priority",
];

// Functions that could be removed
const UNUSED_EDGE_FUNCTIONS = [
  { name: "telegram-mtproto-sync", reason: "MTProto feature disabled" },
];

export default function AdminSystemAudit() {
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<AuditItem[]>([]);
  const [functions, setFunctions] = useState<AuditItem[]>([]);
  const [stats, setStats] = useState({ total: 0, used: 0, unused: 0, legacy: 0 });

  useEffect(() => {
    loadAuditData();
  }, []);

  async function loadAuditData() {
    setLoading(true);
    try {
      // Get table names from supabase types (we know them already)
      const tableNames = [
        "audit_logs", "balance_wheel_data", "client_duplicates", "contact_requests", "content",
        "duplicate_cases", "eisenhower_tasks", "email_accounts", "email_templates", "entitlements",
        "field_values", "fields", "flows", "impersonation_sessions", "integration_field_mappings",
        "integration_instances", "integration_logs", "integration_sync_logs", "integration_sync_settings",
        "merge_history", "mns_response_documents", "orders", "orders_v2", "payment_plans",
        "payment_settings", "payments_v2", "permissions", "pricing_stages", "product_club_mappings",
        "products", "products_v2", "profiles", "role_permissions", "roles", "sphere_goals",
        "subscriptions", "subscriptions_v2", "tariff_offers", "tariff_prices", "tariffs",
        "task_categories", "telegram_access", "telegram_access_audit", "telegram_access_grants",
        "telegram_bots", "telegram_club_members", "telegram_clubs", "telegram_invites",
        "telegram_link_tokens", "telegram_logs", "telegram_manual_access", "telegram_mtproto_sessions",
        "user_roles", "user_roles_v2", "wheel_balance_tasks", "product_versions",
      ];
      
      // Build table audit items
      const tableItems: AuditItem[] = [];
      
      for (const tableName of tableNames) {
        const isUsed = USED_TABLES.includes(tableName);
        const legacy = LEGACY_TABLES.find(l => l.name === tableName);
        
        // Get approximate row count
        let rowCount = 0;
        try {
          const { count } = await supabase.from(tableName as any).select("*", { count: "exact", head: true });
          rowCount = count || 0;
        } catch (e) {
          // Table might not be accessible
        }
        
        tableItems.push({
          name: tableName,
          type: "table",
          used: isUsed && !legacy,
          usedWhere: isUsed ? ["hooks", "components", "edge functions"] : [],
          rowCount,
          safeToRemove: legacy ? !legacy.hasData || rowCount === 0 : !isUsed && rowCount === 0,
          recommendation: legacy ? "migrate" : isUsed ? "keep" : rowCount > 0 ? "review" : "remove",
          notes: legacy?.reason || "",
        });
      }

      setTables(tableItems.sort((a, b) => {
        if (a.recommendation === "remove" && b.recommendation !== "remove") return -1;
        if (a.recommendation === "migrate" && b.recommendation !== "migrate" && b.recommendation !== "remove") return -1;
        return a.name.localeCompare(b.name);
      }));

      // Build function audit items
      const allFunctions = [
        "amocrm-sync", "amocrm-webhook", "analyze-task-priority", "auth-actions",
        "bepaid-create-token", "bepaid-webhook", "cancel-trial", "detect-duplicates",
        "getcourse-sync", "getcourse-webhook", "integration-healthcheck", "integration-sync",
        "merge-clients", "mns-response-generator", "public-product", "roles-admin",
        "send-email", "subscription-charge", "telegram-bot-actions", "telegram-check-expired",
        "telegram-club-members", "telegram-cron-sync", "telegram-grant-access", "telegram-kick-violators",
        "telegram-link-manage", "telegram-mass-broadcast", "telegram-mtproto-sync", "telegram-revoke-access",
        "telegram-send-notification", "telegram-send-reminders", "telegram-webhook", "users-admin-actions",
      ];

      const functionItems: AuditItem[] = allFunctions.map(fn => {
        const unused = UNUSED_EDGE_FUNCTIONS.find(u => u.name === fn);
        const isUsed = USED_EDGE_FUNCTIONS.includes(fn) && !unused;
        
        return {
          name: fn,
          type: "edge_function",
          used: isUsed,
          usedWhere: isUsed ? ["hooks", "webhooks", "cron"] : [],
          safeToRemove: !!unused,
          recommendation: unused ? "remove" : "keep",
          notes: unused?.reason || "",
        };
      });

      setFunctions(functionItems);

      // Calculate stats
      const totalItems = tableItems.length + functionItems.length;
      const usedItems = tableItems.filter(t => t.used).length + functionItems.filter(f => f.used).length;
      const unusedItems = tableItems.filter(t => !t.used && t.recommendation === "remove").length + 
                         functionItems.filter(f => !f.used).length;
      const legacyItems = tableItems.filter(t => t.recommendation === "migrate").length;

      setStats({ total: totalItems, used: usedItems, unused: unusedItems, legacy: legacyItems });
    } catch (error) {
      console.error("Audit error:", error);
    }
    setLoading(false);
  }

  const getRecommendationBadge = (rec: string) => {
    switch (rec) {
      case "keep":
        return <Badge variant="outline" className="text-green-600 border-green-600/30 bg-green-600/10">Оставить</Badge>;
      case "remove":
        return <Badge variant="destructive">Удалить</Badge>;
      case "migrate":
        return <Badge variant="outline" className="text-amber-600 border-amber-600/30 bg-amber-600/10">Мигрировать</Badge>;
      case "review":
        return <Badge variant="secondary">Проверить</Badge>;
      default:
        return <Badge variant="secondary">{rec}</Badge>;
    }
  };

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Аудит системы</h1>
          <p className="text-muted-foreground">
            Инвентаризация таблиц, функций и компонентов проекта
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{stats.total}</div>
              <p className="text-xs text-muted-foreground">Всего сущностей</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{stats.used}</div>
              <p className="text-xs text-muted-foreground">Используется</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-amber-600">{stats.legacy}</div>
              <p className="text-xs text-muted-foreground">Legacy (мигрировать)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{stats.unused}</div>
              <p className="text-xs text-muted-foreground">Можно удалить</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="tables">
          <TabsList>
            <TabsTrigger value="tables" className="gap-2">
              <Database className="h-4 w-4" />
              Таблицы ({tables.length})
            </TabsTrigger>
            <TabsTrigger value="functions" className="gap-2">
              <Code className="h-4 w-4" />
              Edge Functions ({functions.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tables" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Таблицы базы данных</CardTitle>
                <CardDescription>
                  Список всех таблиц с анализом использования
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Таблица</TableHead>
                      <TableHead className="text-right">Записей</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Рекомендация</TableHead>
                      <TableHead>Примечание</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tables.map((item) => (
                      <TableRow key={item.name} className={item.recommendation === "remove" ? "bg-destructive/5" : item.recommendation === "migrate" ? "bg-amber-500/5" : ""}>
                        <TableCell className="font-mono text-sm">{item.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{item.rowCount?.toLocaleString() || 0}</TableCell>
                        <TableCell>
                          {item.used ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-xs">Используется</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="text-xs">Не используется</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{getRecommendationBadge(item.recommendation)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {item.notes}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="functions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Edge Functions</CardTitle>
                <CardDescription>
                  Список серверных функций Supabase
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Функция</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Рекомендация</TableHead>
                      <TableHead>Примечание</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {functions.map((item) => (
                      <TableRow key={item.name} className={item.recommendation === "remove" ? "bg-destructive/5" : ""}>
                        <TableCell className="font-mono text-sm">{item.name}</TableCell>
                        <TableCell>
                          {item.used ? (
                            <div className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              <span className="text-xs">Используется</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="text-xs">Не используется</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{getRecommendationBadge(item.recommendation)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.notes}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Summary */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Рекомендации по очистке
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <strong>Legacy таблицы для миграции:</strong>
              <ul className="list-disc list-inside mt-1 text-muted-foreground">
                {LEGACY_TABLES.map(t => (
                  <li key={t.name}><code>{t.name}</code> — {t.reason}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Edge Functions для удаления:</strong>
              <ul className="list-disc list-inside mt-1 text-muted-foreground">
                {UNUSED_EDGE_FUNCTIONS.map(f => (
                  <li key={f.name}><code>{f.name}</code> — {f.reason}</li>
                ))}
              </ul>
            </div>
            <p className="text-muted-foreground">
              Перед удалением убедитесь, что данные из legacy таблиц перенесены в новые структуры.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}

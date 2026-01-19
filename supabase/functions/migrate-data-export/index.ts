import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TABLES_TO_EXPORT = [
  "roles",
  "permissions", 
  "role_permissions",
  "profiles",
  "user_roles",
  "user_roles_v2",
  "products",
  "products_v2",
  "tariffs",
  "tariff_offers",
  "tariff_prices",
  "tariff_features",
  "pricing_stages",
  "flows",
  "executors",
  "document_templates",
  "document_generation_rules",
  "email_templates",
  "email_accounts",
  "integration_instances",
  "integration_sync_settings",
  "integration_field_mappings",
  "telegram_bots",
  "telegram_clubs",
  "telegram_publish_channels",
  "telegram_access",
  "orders",
  "orders_v2",
  "payments",
  "payments_v2",
  "subscriptions",
  "subscriptions_v2",
  "installment_payments",
  "entitlements",
  "generated_documents",
  "contact_requests",
  "content",
  "privacy_policy_versions",
  "consent_logs",
  "payment_settings",
  "audit_logs",
];

function escapeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function generateInsertSQL(tableName: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  
  const columns = Object.keys(rows[0]);
  const statements: string[] = [];
  
  statements.push(`-- Table: ${tableName} (${rows.length} rows)`);
  statements.push(`ALTER TABLE IF EXISTS public.${tableName} DISABLE TRIGGER ALL;`);
  
  for (const row of rows) {
    const values = columns.map(col => escapeValue(row[col]));
    statements.push(
      `INSERT INTO public.${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")}) ON CONFLICT DO NOTHING;`
    );
  }
  
  statements.push(`ALTER TABLE IF EXISTS public.${tableName} ENABLE TRIGGER ALL;`);
  statements.push("");
  
  return statements.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const exportResults: { table: string; count: number; error?: string }[] = [];
    let fullSQL = `-- Data Export from ${supabaseUrl}\n`;
    fullSQL += `-- Generated at: ${new Date().toISOString()}\n`;
    fullSQL += `-- ================================================\n\n`;
    fullSQL += `BEGIN;\n\n`;
    
    for (const tableName of TABLES_TO_EXPORT) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select("*")
          .limit(10000);
        
        if (error) {
          if (error.code === "PGRST204" || error.message.includes("does not exist")) {
            exportResults.push({ table: tableName, count: 0, error: "Table not found" });
            continue;
          }
          throw error;
        }
        
        if (data && data.length > 0) {
          fullSQL += generateInsertSQL(tableName, data);
          exportResults.push({ table: tableName, count: data.length });
        } else {
          exportResults.push({ table: tableName, count: 0 });
        }
      } catch (tableError) {
        exportResults.push({ 
          table: tableName, 
          count: 0, 
          error: tableError instanceof Error ? tableError.message : "Unknown error" 
        });
      }
    }
    
    fullSQL += `\nCOMMIT;\n`;
    
    const totalRows = exportResults.reduce((sum, r) => sum + r.count, 0);
    const tablesWithData = exportResults.filter(r => r.count > 0).length;
    
    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          totalTables: TABLES_TO_EXPORT.length,
          tablesWithData,
          totalRows,
        },
        details: exportResults,
        sql: fullSQL,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

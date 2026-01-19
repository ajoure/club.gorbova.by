/**
 * Data Export Script for Supabase Migration
 * 
 * This script exports all data from Lovable Cloud to SQL insert statements
 * 
 * Usage:
 * 1. Install dependencies: bun add @supabase/supabase-js
 * 2. Set environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY
 * 3. Run: bun run scripts/export-data.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hdjgkjceownmmnrqqtuz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_KEY is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Tables to export in order (respecting foreign key dependencies)
const TABLES_ORDER = [
  'roles',
  'permissions',
  'role_permissions',
  'profiles',
  'user_roles',
  'user_roles_v2',
  'products_v2',
  'tariffs',
  'tariff_offers',
  'tariff_prices',
  'tariff_features',
  'flows',
  'executors',
  'document_templates',
  'document_generation_rules',
  'email_templates',
  'email_accounts',
  'integration_instances',
  'integration_sync_settings',
  'integration_field_mappings',
  'telegram_bots',
  'telegram_clubs',
  'telegram_publish_channels',
  'orders_v2',
  'payments_v2',
  'subscriptions_v2',
  'installment_payments',
  'entitlements',
  'generated_documents',
  // Add more tables as needed
];

function escapeValue(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function exportTable(tableName: string): Promise<string> {
  console.log(`Exporting table: ${tableName}`);
  
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .limit(10000);
  
  if (error) {
    console.error(`Error exporting ${tableName}:`, error.message);
    return `-- Error exporting ${tableName}: ${error.message}\n`;
  }
  
  if (!data || data.length === 0) {
    return `-- No data in ${tableName}\n`;
  }
  
  const columns = Object.keys(data[0]);
  const statements: string[] = [];
  
  statements.push(`-- Table: ${tableName} (${data.length} rows)`);
  statements.push(`TRUNCATE TABLE public.${tableName} CASCADE;`);
  
  for (const row of data) {
    const values = columns.map(col => escapeValue(row[col]));
    statements.push(
      `INSERT INTO public.${tableName} (${columns.join(', ')}) VALUES (${values.join(', ')});`
    );
  }
  
  return statements.join('\n') + '\n\n';
}

async function main() {
  console.log('Starting data export...');
  
  let output = `-- ============================================
-- DATA EXPORT FROM LOVABLE CLOUD
-- Generated: ${new Date().toISOString()}
-- ============================================

BEGIN;

`;

  for (const table of TABLES_ORDER) {
    output += await exportTable(table);
  }
  
  output += `
COMMIT;

-- Export completed
`;

  const outputPath = 'scripts/exported-data.sql';
  fs.writeFileSync(outputPath, output);
  console.log(`Data exported to: ${outputPath}`);
}

main().catch(console.error);

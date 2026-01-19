import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Column {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

interface ForeignKey {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table: string;
  foreign_column: string;
  on_delete: string;
  on_update: string;
}

interface Policy {
  tablename: string;
  policyname: string;
  permissive: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
}

interface PrimaryKey {
  table_name: string;
  column_name: string;
}

interface UniqueConstraint {
  constraint_name: string;
  table_name: string;
  column_names: string[];
}

// Map PostgreSQL types to SQL types
function mapDataType(col: Column): string {
  const udtName = col.udt_name;
  const dataType = col.data_type;
  
  // Handle arrays
  if (dataType === 'ARRAY') {
    const baseType = udtName.replace(/^_/, '');
    return `${mapBaseType(baseType)}[]`;
  }
  
  // Handle USER-DEFINED (enums)
  if (dataType === 'USER-DEFINED') {
    return udtName;
  }
  
  return mapBaseType(udtName);
}

function mapBaseType(udtName: string): string {
  const typeMap: Record<string, string> = {
    'uuid': 'UUID',
    'text': 'TEXT',
    'varchar': 'VARCHAR',
    'int4': 'INTEGER',
    'int8': 'BIGINT',
    'float8': 'DOUBLE PRECISION',
    'float4': 'REAL',
    'numeric': 'NUMERIC',
    'bool': 'BOOLEAN',
    'timestamp': 'TIMESTAMP',
    'timestamptz': 'TIMESTAMP WITH TIME ZONE',
    'date': 'DATE',
    'time': 'TIME',
    'timetz': 'TIME WITH TIME ZONE',
    'jsonb': 'JSONB',
    'json': 'JSON',
    'bytea': 'BYTEA',
    'interval': 'INTERVAL',
  };
  
  return typeMap[udtName] || udtName.toUpperCase();
}

function escapeDefault(defaultValue: string | null): string | null {
  if (!defaultValue) return null;
  
  // Handle nextval sequences - convert to gen_random_uuid() for uuid columns
  if (defaultValue.includes('nextval')) {
    return defaultValue;
  }
  
  return defaultValue;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let ddl = "";
    ddl += "-- ============================================\n";
    ddl += "-- FULL SCHEMA EXPORT\n";
    ddl += `-- Generated: ${new Date().toISOString()}\n`;
    ddl += "-- ============================================\n\n";

    // 1. Get and export ENUM types
    console.log("Fetching ENUM types...");
    const { data: enums, error: enumError } = await supabase.rpc('get_schema_enums');
    
    if (enumError) {
      console.error("Error fetching enums:", enumError);
    }

    if (enums && enums.length > 0) {
      ddl += "-- ============================================\n";
      ddl += "-- ENUM TYPES\n";
      ddl += "-- ============================================\n\n";
      
      for (const e of enums) {
        ddl += `DROP TYPE IF EXISTS public.${e.enum_name} CASCADE;\n`;
        ddl += `CREATE TYPE public.${e.enum_name} AS ENUM (\n`;
        ddl += e.enum_values.map((v: string) => `  '${v}'`).join(',\n');
        ddl += "\n);\n\n";
      }
    }

    // 2. Get all columns
    console.log("Fetching columns...");
    const { data: columns, error: colError } = await supabase.rpc('get_schema_columns');
    
    if (colError) {
      throw new Error(`Error fetching columns: ${colError.message}`);
    }

    // 3. Get primary keys
    console.log("Fetching primary keys...");
    const { data: primaryKeys, error: pkError } = await supabase.rpc('get_schema_primary_keys');
    
    if (pkError) {
      console.error("Error fetching primary keys:", pkError);
    }

    // Group primary keys by table
    const pkByTable: Record<string, string[]> = {};
    if (primaryKeys) {
      for (const pk of primaryKeys as PrimaryKey[]) {
        if (!pkByTable[pk.table_name]) {
          pkByTable[pk.table_name] = [];
        }
        pkByTable[pk.table_name].push(pk.column_name);
      }
    }

    // 4. Get unique constraints
    console.log("Fetching unique constraints...");
    const { data: uniqueConstraints, error: ucError } = await supabase.rpc('get_schema_unique_constraints');
    
    if (ucError) {
      console.error("Error fetching unique constraints:", ucError);
    }

    // Group unique constraints by table
    const ucByTable: Record<string, UniqueConstraint[]> = {};
    if (uniqueConstraints) {
      for (const uc of uniqueConstraints as UniqueConstraint[]) {
        if (!ucByTable[uc.table_name]) {
          ucByTable[uc.table_name] = [];
        }
        ucByTable[uc.table_name].push(uc);
      }
    }

    // 5. Get foreign keys
    console.log("Fetching foreign keys...");
    const { data: foreignKeys, error: fkError } = await supabase.rpc('get_schema_foreign_keys');
    
    if (fkError) {
      console.error("Error fetching foreign keys:", fkError);
    }

    // Group columns by table
    const tableColumns: Record<string, Column[]> = {};
    for (const col of columns as Column[]) {
      if (!tableColumns[col.table_name]) {
        tableColumns[col.table_name] = [];
      }
      tableColumns[col.table_name].push(col);
    }

    // Sort tables by dependencies (tables with no FKs first)
    const tableNames = Object.keys(tableColumns);
    const fkTables = new Set((foreignKeys as ForeignKey[] || []).map(fk => fk.table_name));
    const sortedTables = [
      ...tableNames.filter(t => !fkTables.has(t)),
      ...tableNames.filter(t => fkTables.has(t))
    ];

    // Generate CREATE TABLE statements
    ddl += "-- ============================================\n";
    ddl += `-- TABLES (${sortedTables.length} total)\n`;
    ddl += "-- ============================================\n\n";

    for (const tableName of sortedTables) {
      const cols = tableColumns[tableName];
      const pks = pkByTable[tableName] || [];
      const ucs = ucByTable[tableName] || [];
      
      ddl += `-- Table: ${tableName}\n`;
      ddl += `DROP TABLE IF EXISTS public.${tableName} CASCADE;\n`;
      ddl += `CREATE TABLE public.${tableName} (\n`;
      
      const colDefs: string[] = [];
      
      for (const col of cols) {
        let colDef = `  ${col.column_name} ${mapDataType(col)}`;
        
        if (col.is_nullable === 'NO') {
          colDef += ' NOT NULL';
        }
        
        if (col.column_default) {
          const escapedDefault = escapeDefault(col.column_default);
          if (escapedDefault) {
            colDef += ` DEFAULT ${escapedDefault}`;
          }
        }
        
        colDefs.push(colDef);
      }
      
      // Add primary key constraint
      if (pks.length > 0) {
        colDefs.push(`  PRIMARY KEY (${pks.join(', ')})`);
      }
      
      // Add unique constraints
      for (const uc of ucs) {
        // Skip if it's a single column PK
        if (uc.column_names.length === 1 && pks.includes(uc.column_names[0])) {
          continue;
        }
        colDefs.push(`  CONSTRAINT ${uc.constraint_name} UNIQUE (${uc.column_names.join(', ')})`);
      }
      
      ddl += colDefs.join(',\n');
      ddl += "\n);\n\n";
    }

    // 6. Add foreign key constraints separately (to avoid dependency issues)
    if (foreignKeys && foreignKeys.length > 0) {
      ddl += "-- ============================================\n";
      ddl += `-- FOREIGN KEY CONSTRAINTS (${foreignKeys.length} total)\n`;
      ddl += "-- ============================================\n\n";
      
      for (const fk of foreignKeys as ForeignKey[]) {
        let onActions = '';
        if (fk.on_delete && fk.on_delete !== 'NO ACTION') {
          onActions += ` ON DELETE ${fk.on_delete}`;
        }
        if (fk.on_update && fk.on_update !== 'NO ACTION') {
          onActions += ` ON UPDATE ${fk.on_update}`;
        }
        
        ddl += `ALTER TABLE public.${fk.table_name}\n`;
        ddl += `  ADD CONSTRAINT ${fk.constraint_name}\n`;
        ddl += `  FOREIGN KEY (${fk.column_name})\n`;
        ddl += `  REFERENCES public.${fk.foreign_table}(${fk.foreign_column})${onActions};\n\n`;
      }
    }

    // 7. Get and add indexes
    console.log("Fetching indexes...");
    const { data: indexes, error: idxError } = await supabase.rpc('get_schema_indexes');
    
    if (idxError) {
      console.error("Error fetching indexes:", idxError);
    }

    if (indexes && indexes.length > 0) {
      ddl += "-- ============================================\n";
      ddl += `-- INDEXES (${indexes.length} total)\n`;
      ddl += "-- ============================================\n\n";
      
      for (const idx of indexes) {
        // Skip unique constraint indexes (already handled)
        if (idx.indexdef.includes('UNIQUE')) {
          continue;
        }
        ddl += `${idx.indexdef};\n`;
      }
      ddl += "\n";
    }

    // 8. Get RLS-enabled tables
    console.log("Fetching RLS tables...");
    const { data: rlsTables, error: rlsError } = await supabase.rpc('get_schema_rls_tables');
    
    if (rlsError) {
      console.error("Error fetching RLS tables:", rlsError);
    }

    // 9. Get and add RLS policies
    console.log("Fetching policies...");
    const { data: policies, error: polError } = await supabase.rpc('get_schema_policies');
    
    if (polError) {
      console.error("Error fetching policies:", polError);
    }

    if ((rlsTables && rlsTables.length > 0) || (policies && policies.length > 0)) {
      ddl += "-- ============================================\n";
      ddl += "-- ROW LEVEL SECURITY\n";
      ddl += "-- ============================================\n\n";
      
      // Enable RLS on tables
      if (rlsTables) {
        for (const t of rlsTables) {
          ddl += `ALTER TABLE public.${t.tablename} ENABLE ROW LEVEL SECURITY;\n`;
        }
        ddl += "\n";
      }
      
      // Add policies
      if (policies && policies.length > 0) {
        ddl += `-- Policies (${policies.length} total)\n\n`;
        
        for (const pol of policies as Policy[]) {
          const permissive = pol.permissive === 'PERMISSIVE' ? '' : ' AS RESTRICTIVE';
          const roles = pol.roles.join(', ');
          
          ddl += `CREATE POLICY "${pol.policyname}"\n`;
          ddl += `  ON public.${pol.tablename}${permissive}\n`;
          ddl += `  FOR ${pol.cmd}\n`;
          ddl += `  TO ${roles}\n`;
          
          if (pol.qual) {
            ddl += `  USING (${pol.qual})\n`;
          }
          
          if (pol.with_check) {
            ddl += `  WITH CHECK (${pol.with_check})\n`;
          }
          
          ddl += ";\n\n";
        }
      }
    }

    // Summary
    const summary = {
      generated_at: new Date().toISOString(),
      tables: sortedTables.length,
      enums: enums?.length || 0,
      foreign_keys: foreignKeys?.length || 0,
      indexes: indexes?.length || 0,
      rls_tables: rlsTables?.length || 0,
      policies: policies?.length || 0,
    };

    ddl += "-- ============================================\n";
    ddl += "-- EXPORT SUMMARY\n";
    ddl += `-- Tables: ${summary.tables}\n`;
    ddl += `-- ENUM types: ${summary.enums}\n`;
    ddl += `-- Foreign keys: ${summary.foreign_keys}\n`;
    ddl += `-- Indexes: ${summary.indexes}\n`;
    ddl += `-- RLS tables: ${summary.rls_tables}\n`;
    ddl += `-- Policies: ${summary.policies}\n`;
    ddl += "-- ============================================\n";

    console.log("Schema export complete:", summary);

    return new Response(
      JSON.stringify({ ddl, summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Export error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

-- Function to get all table columns with full metadata
CREATE OR REPLACE FUNCTION public.get_schema_columns()
RETURNS TABLE (
  table_name text,
  column_name text,
  data_type text,
  udt_name text,
  is_nullable text,
  column_default text,
  ordinal_position integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.table_name::text,
    c.column_name::text,
    c.data_type::text,
    c.udt_name::text,
    c.is_nullable::text,
    c.column_default::text,
    c.ordinal_position::integer
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
  ORDER BY c.table_name, c.ordinal_position;
END;
$$;

-- Function to get all indexes
CREATE OR REPLACE FUNCTION public.get_schema_indexes()
RETURNS TABLE (
  tablename text,
  indexname text,
  indexdef text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pi.tablename::text,
    pi.indexname::text,
    pi.indexdef::text
  FROM pg_indexes pi
  WHERE pi.schemaname = 'public'
    AND pi.indexname NOT LIKE '%_pkey'; -- exclude primary keys, they're in CREATE TABLE
END;
$$;

-- Function to get all RLS policies
CREATE OR REPLACE FUNCTION public.get_schema_policies()
RETURNS TABLE (
  tablename text,
  policyname text,
  permissive text,
  roles text[],
  cmd text,
  qual text,
  with_check text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pp.tablename::text,
    pp.policyname::text,
    pp.permissive::text,
    pp.roles::text[],
    pp.cmd::text,
    pp.qual::text,
    pp.with_check::text
  FROM pg_policies pp
  WHERE pp.schemaname = 'public';
END;
$$;

-- Function to get ENUM types
CREATE OR REPLACE FUNCTION public.get_schema_enums()
RETURNS TABLE (
  enum_name text,
  enum_values text[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.typname::text,
    array_agg(e.enumlabel ORDER BY e.enumsortorder)::text[]
  FROM pg_type t 
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname;
END;
$$;

-- Function to get foreign key constraints
CREATE OR REPLACE FUNCTION public.get_schema_foreign_keys()
RETURNS TABLE (
  constraint_name text,
  table_name text,
  column_name text,
  foreign_table text,
  foreign_column text,
  on_delete text,
  on_update text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.constraint_name::text,
    tc.table_name::text,
    kcu.column_name::text,
    ccu.table_name::text AS foreign_table,
    ccu.column_name::text AS foreign_column,
    rc.delete_rule::text AS on_delete,
    rc.update_rule::text AS on_update
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu 
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
  JOIN information_schema.referential_constraints rc
    ON rc.constraint_name = tc.constraint_name
    AND rc.constraint_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public';
END;
$$;

-- Function to get tables with RLS enabled
CREATE OR REPLACE FUNCTION public.get_schema_rls_tables()
RETURNS TABLE (
  tablename text,
  rowsecurity boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.relname::text,
    c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true;
END;
$$;

-- Function to get primary keys
CREATE OR REPLACE FUNCTION public.get_schema_primary_keys()
RETURNS TABLE (
  table_name text,
  column_name text
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.table_name::text,
    kcu.column_name::text
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = 'public';
END;
$$;

-- Function to get unique constraints
CREATE OR REPLACE FUNCTION public.get_schema_unique_constraints()
RETURNS TABLE (
  constraint_name text,
  table_name text,
  column_names text[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tc.constraint_name::text,
    tc.table_name::text,
    array_agg(kcu.column_name ORDER BY kcu.ordinal_position)::text[]
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'UNIQUE'
    AND tc.table_schema = 'public'
  GROUP BY tc.constraint_name, tc.table_name;
END;
$$;
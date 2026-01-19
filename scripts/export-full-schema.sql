-- ============================================
-- FULL SCHEMA EXPORT FROM LOVABLE CLOUD
-- Generated for migration to external Supabase
-- ============================================

-- STEP 1: Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- STEP 2: Create custom types/enums
DO $$ BEGIN
    CREATE TYPE app_role AS ENUM ('user', 'admin', 'superadmin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE field_entity_type AS ENUM ('profile', 'order', 'product', 'subscription');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE field_data_type AS ENUM ('string', 'number', 'boolean', 'date', 'datetime', 'enum', 'json', 'array');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- NOTE: This is a template. 
-- Run the following command to get full schema:
-- supabase db dump --schema public > full_schema.sql
-- ============================================

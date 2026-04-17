ALTER TABLE public.crm_pipelines REPLICA IDENTITY FULL;
ALTER TABLE public.crm_pipeline_stages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_pipelines;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_pipeline_stages;
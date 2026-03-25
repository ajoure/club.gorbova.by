/**
 * useResolverPipeline — Reusable resolver pipeline for corporate templates.
 * Sprint 3: Shared between Step 4 (preview) and Step 5 (confirm/generate).
 * 
 * Pipeline: resolveManifestTemplates → verifyStorageFiles → validateTemplateAvailability
 */

import { useState, useEffect, useCallback } from 'react';
import type { PackageManifestItem } from './corporateTypes';
import {
  resolveManifestTemplates,
  verifyStorageFiles,
  validateTemplateAvailability,
  type TemplateResolutionResult,
  type TemplateValidationResult,
} from './corporateTemplateResolver';

export interface ResolverPipelineState {
  /** Enriched manifest items */
  resolution: TemplateResolutionResult | null;
  /** Validation results (blocking/warnings/informational) */
  templateValidation: TemplateValidationResult | null;
  /** Whether the pipeline is currently running */
  resolving: boolean;
  /** Re-run the pipeline (e.g., before generation) */
  refresh: () => Promise<TemplateResolutionResult | null>;
}

/**
 * Runs the full resolver pipeline for a given manifest.
 * Auto-runs on mount and when manifest changes.
 */
export function useResolverPipeline(manifest: PackageManifestItem[]): ResolverPipelineState {
  const [resolution, setResolution] = useState<TemplateResolutionResult | null>(null);
  const [templateValidation, setTemplateValidation] = useState<TemplateValidationResult | null>(null);
  const [resolving, setResolving] = useState(false);

  const runPipeline = useCallback(async (): Promise<TemplateResolutionResult | null> => {
    setResolving(true);
    try {
      const result = await resolveManifestTemplates(manifest);
      let verifiedItems = result.items;
      try {
        verifiedItems = await verifyStorageFiles(result.items);
      } catch (storageErr) {
        console.warn('[useResolverPipeline] Storage verification failed, using DB-only results:', storageErr);
      }
      const verifiedResult = { ...result, items: verifiedItems };
      setResolution(verifiedResult);
      const validation = validateTemplateAvailability(verifiedResult);
      setTemplateValidation(validation);
      return verifiedResult;
    } catch (err) {
      console.error('[useResolverPipeline] Pipeline error:', err);
      return null;
    } finally {
      setResolving(false);
    }
  }, [manifest]);

  // Auto-run on manifest change
  useEffect(() => {
    let cancelled = false;
    runPipeline().then(result => {
      if (cancelled) {
        // Results already set in runPipeline, but we don't need to act
      }
    });
    return () => { cancelled = true; };
  }, [runPipeline]);

  return {
    resolution,
    templateValidation,
    resolving,
    refresh: runPipeline,
  };
}

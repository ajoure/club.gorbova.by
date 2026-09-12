// Only machine-code families may cross the public form boundary. Never copy
// error suffixes, details, URLs or document contents into a submission summary.
const codes = new Set([
  'unauthorized', 'forbidden', 'owner_access_expired', 'link_not_found', 'link_disabled',
  'form_not_found', 'form_disabled', 'token_required', 'profile_not_found',
  'required_field_missing', 'pf_required_value_missing', 'repeat_group_empty',
  'future_date', 'invalid_date', 'invalid_number', 'invalid_attachment',
  'too_many_attachments', 'attachments_disabled', 'attachment_path_forbidden',
  'package_session_id_required', 'package_session_not_found', 'package_template_required',
  'form_and_legal_entity_required', 'role_assignment_missing', 'ln_token_not_found',
  'ln_token_outside_bound_package', 'invalid_legacy_role_placeholder',
  'invalid_token_in_package_template', 'system_field_resolver_not_implemented',
  'template_or_version_missing', 'active_version_invalid', 'download_failed',
  'document_template_not_configured', 'gotenberg_not_configured', 'gotenberg_disabled',
  'gotenberg_auth_failed', 'gotenberg_timeout', 'gotenberg_unreachable',
  'gotenberg_http_error', 'pdf_conversion_failed', 'render_failed', 'upload_failed',
  'delivery_format_not_selected', 'one_or_more_delivery_channels_failed',
  'generation_failed', 'generation_partial', 'generation_blocked', 'blocked',
  'generation_outcome_unknown', 'submission_save_failed', 'document_request_failed',
  'internal_error',
]);

export function safeDocumentErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const legacy: Record<string, string> = {
    'profile not found': 'profile_not_found', 'template not found': 'template_or_version_missing',
    'template_id is required': 'template_or_version_missing',
    'failed to download template file': 'download_failed',
    'failed to upload generated file': 'upload_failed', 'render failed': 'render_failed',
  };
  const family = value.trim().split(':', 1)[0].toLowerCase();
  return codes.has(family) ? family : legacy[family] ?? null;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function firstDocumentErrorCode(value: unknown): string | null {
  const root = object(value);
  const direct = [root.error_code, root.error, root.code, root.message, value];
  for (const candidate of direct) {
    const code = safeDocumentErrorCode(candidate);
    if (code) return code;
  }
  for (const result of Array.isArray(root.results) ? root.results : []) {
    const item = object(result);
    for (const candidate of [item.error_code, ...(Array.isArray(item.errors) ? item.errors : []), object(item.details).error, item.error]) {
      const code = safeDocumentErrorCode(candidate);
      if (code) return code;
    }
  }
  return null;
}

export type ExternalGenerationOutcome = {
  canDeliver: boolean;
  documentIds: string[];
  generationStatus: 'generated' | 'partial' | 'failed' | 'unknown';
  errorCode: string | null;
  httpStatus: number;
};

export function classifyExternalGeneration(body: unknown, status: number): ExternalGenerationOutcome {
  const payload = object(body);
  const documentIds = [...new Set((Array.isArray(payload.results) ? payload.results : [])
    .filter(item => !object(item).status || object(item).status === 'generated')
    .map(item => object(item).document_id)
    .filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];
  const httpOk = status >= 200 && status < 300;
  const partial = payload.status === 'partial';
  const explicitFailure = ['failed', 'blocked', 'error'].includes(String(payload.status)) || payload.success === false;
  const canDeliver = httpOk && documentIds.length > 0 && !explicitFailure
    && payload.success === true && (!payload.status || ['generated', 'partial'].includes(String(payload.status)));
  const generationStatus = canDeliver ? (partial ? 'partial' : 'generated') : 'failed';
  const code = firstDocumentErrorCode(body);
  return {
    canDeliver, documentIds, generationStatus, httpStatus: status,
    errorCode: canDeliver && !partial ? null : code ?? (partial ? 'generation_partial'
      : payload.status === 'blocked' ? 'generation_blocked'
      : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden'
      : 'generation_failed'),
  };
}

export type SubmissionGenerationPatch = {
  status: 'generated' | 'failed';
  generated_document_ids: string[];
  generated_at: string | null;
  error_code: string | null;
  metadata: { generation_status: ExternalGenerationOutcome['generationStatus']; generation_error_code: string | null; stage: 'generation' };
};

// The sender must only be reached after this checkpoint was acknowledged.
// An uncertain network result is never retried here.
export async function recordExternalGeneration(
  invoke: () => Promise<Response>,
  save: (patch: SubmissionGenerationPatch) => Promise<boolean>,
  now: () => string = () => new Date().toISOString(),
): Promise<ExternalGenerationOutcome> {
  let outcome: ExternalGenerationOutcome;
  try {
    const response = await invoke();
    const body: unknown = await response.json();
    outcome = classifyExternalGeneration(body, response.status);
  } catch {
    outcome = { canDeliver: false, documentIds: [], generationStatus: 'unknown', errorCode: 'generation_outcome_unknown', httpStatus: 502 };
  }
  const patch: SubmissionGenerationPatch = {
    status: outcome.canDeliver ? 'generated' : 'failed',
    generated_document_ids: outcome.documentIds,
    generated_at: outcome.canDeliver ? now() : null,
    error_code: outcome.generationStatus === 'partial' ? 'generation_partial' : outcome.errorCode,
    metadata: { generation_status: outcome.generationStatus, generation_error_code: outcome.errorCode, stage: 'generation' },
  };
  let saved = false;
  try { saved = await save(patch); } catch { /* fail closed before delivery */ }
  return saved ? outcome : { ...outcome, canDeliver: false, errorCode: 'submission_save_failed', httpStatus: 503 };
}

// Registry of transactional email templates.
// Add every new template here so send-transactional-email can find it by name.

import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: (props: any) => React.ReactElement
  subject: string | ((data: any) => string)
  displayName?: string
  previewData?: Record<string, unknown>
  /** Fixed recipient (e.g. site owner) overrides caller-provided recipient. */
  to?: string
}

import { template as productPurchased } from './product-purchased.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'product-purchased': productPurchased,
}

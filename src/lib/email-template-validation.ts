/**
 * Email Template Validation Utilities
 * Provides allowlist for template variables and validation functions
 */

// Allowed variables that can be used in email templates
export const ALLOWED_TEMPLATE_VARIABLES = [
  // User data
  'full_name',
  'first_name', 
  'last_name',
  'name',
  'email',
  
  // Authentication
  'temp_password',
  'tempPassword',
  'reset_link',
  'resetLink',
  'login_link',
  'loginLink',
  'verification_code',
  
  // Application
  'app_name',
  'appName',
  'club_url',
  
  // Order/Payment
  'order_id',
  'orderId',
  'order_number',
  'amount',
  'currency',
  'product_name',
  'productName',
  
  // Roles
  'role_name',
  'roleName',
  
  // Dates
  'expiry_date',
  'date',
] as const;

export type AllowedVariable = typeof ALLOWED_TEMPLATE_VARIABLES[number];

/**
 * Strict regex for valid cf.product tokens with UUID field_id (8-4-4-4-12)
 */
export const CF_TOKEN_REGEX = /\{\{cf\.product\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}\}/g;

/**
 * Regex matching ANY {{cf.*}} token (valid or invalid)
 */
const CF_ANY_REGEX = /\{\{cf\.[^}]+\}\}/g;

/**
 * Extract all template variables from a string
 * Matches {{variable_name}} pattern (simple vars only, not cf.* tokens)
 */
export function extractTemplateVariables(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return matches.map(m => m.slice(2, -2));
}

/**
 * Validate template variables against allowlist.
 * Also validates cf.* tokens: only {{cf.product.<valid-uuid>}} is allowed.
 * Any other {{cf.*}} pattern is reported as invalid.
 */
export function validateTemplateVariables(text: string): { 
  valid: boolean; 
  invalidVariables: string[];
  usedVariables: string[];
  invalidCfTokens: string[];
} {
  // Strip align prefixes before validation (they are not template variables)
  const cleanedInput = text.replace(/\[\[align:(left|center|right)\]\]/g, '');

  // Step 1: Find all {{cf.*}} tokens and validate them
  const allCfTokens = cleanedInput.match(CF_ANY_REGEX) || [];
  const validCfTokens = cleanedInput.match(CF_TOKEN_REGEX) || [];
  const validCfSet = new Set(validCfTokens);
  const invalidCfTokens = allCfTokens.filter(t => !validCfSet.has(t));

  // Step 2: Remove all cf.* tokens (valid ones) from text before standard validation
  let cleanedText = cleanedInput;
  for (const token of validCfTokens) {
    cleanedText = cleanedText.replace(token, '');
  }
  // Also remove invalid cf tokens from text so they don't get double-reported
  for (const token of invalidCfTokens) {
    cleanedText = cleanedText.replace(token, '');
  }

  // Step 3: Standard {{variable}} validation on cleaned text
  const usedVariables = extractTemplateVariables(cleanedText);
  const allowedSet = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
  const invalidVariables = usedVariables.filter(v => !allowedSet.has(v));
  
  return {
    valid: invalidVariables.length === 0 && invalidCfTokens.length === 0,
    invalidVariables,
    usedVariables,
    invalidCfTokens,
  };
}

/**
 * Test data for template preview
 */
export const TEMPLATE_TEST_DATA: Record<string, string> = {
  full_name: 'Иван Иванов',
  first_name: 'Иван',
  last_name: 'Иванов',
  name: 'Иван Иванов',
  email: 'ivan@example.com',
  temp_password: 'TempPass123!',
  tempPassword: 'TempPass123!',
  reset_link: 'https://club.gorbova.by/reset?token=xxx',
  resetLink: 'https://club.gorbova.by/reset?token=xxx',
  login_link: 'https://club.gorbova.by/auth',
  loginLink: 'https://club.gorbova.by/auth',
  verification_code: '123456',
  app_name: 'Gorbova Club',
  appName: 'Gorbova Club',
  club_url: 'https://club.gorbova.by',
  order_id: 'ORD-12345',
  orderId: 'ORD-12345',
  order_number: '12345',
  amount: '99.00',
  currency: 'BYN',
  product_name: 'Подписка Pro',
  productName: 'Подписка Pro',
  role_name: 'Администратор',
  roleName: 'Администратор',
  expiry_date: '31.12.2025',
  date: '15.01.2025',
};

/**
 * Replace template variables with test data for preview
 */
export function renderTemplatePreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return TEMPLATE_TEST_DATA[key] || match;
  });
}

import { test, expect } from '@playwright/test';

/**
 * E2E API Tests: admin-unlinked-payments-report
 * 
 * Auth Strategy: Uses real admin JWT via signInWithPassword.
 * Test user must exist with admin role assigned.
 * 
 * Environment variables required:
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_PUBLISHABLE_KEY
 * - E2E_ADMIN_EMAIL (optional, defaults to test user)
 * - E2E_ADMIN_PASSWORD (optional, defaults to test password)
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://hdjgkjceownmmnrqqtuz.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E';

// Test admin credentials - should be configured in CI environment
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'TestAdmin123!';

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/admin-unlinked-payments-report`;

test.describe('Admin Unlinked Payments Report API', () => {
  let authToken: string;

  test.beforeAll(async ({ request }) => {
    // Authenticate as admin user via Supabase Auth
    const loginRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
    });
    
    // Consume response body to prevent resource leak
    const loginData = await loginRes.json();
    
    if (!loginRes.ok()) {
      console.error('Login failed:', loginData);
      throw new Error(`Failed to authenticate: ${loginData.error_description || loginData.msg || 'Unknown error'}`);
    }
    
    if (!loginData.access_token) {
      throw new Error('No access_token in login response');
    }
    
    authToken = loginData.access_token;
    console.log('Successfully authenticated as admin');
  });

  test('aggregates: limit clamped to 500 when requesting 999', async ({ request }) => {
    const res = await request.post(FUNCTION_URL, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { mode: 'aggregates', limit: 999 },
    });
    
    const json = await res.json();
    
    expect(res.status()).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.pagination.limit).toBe(500); // Clamped from 999 to 500
  });

  test('details: invalid last4 (2 digits) returns 400', async ({ request }) => {
    const res = await request.post(FUNCTION_URL, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { mode: 'details', last4: '12', brand: 'visa' },
    });
    
    const json = await res.json();
    
    expect(res.status()).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error).toContain('4 digits');
  });

  test('details: valid request returns correct pagination with total', async ({ request }) => {
    const res = await request.post(FUNCTION_URL, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { mode: 'details', last4: '3114', brand: 'mastercard', limit: 50 },
    });
    
    const json = await res.json();
    
    expect(res.status()).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.total).toBe(43);
    expect(json.pagination.total).toBe(43);
    expect(json.pagination.has_more).toBe(false); // 43 < 50, so no more pages
  });

  test('collision card (5990/visa) has collision_risk=true', async ({ request }) => {
    const res = await request.post(FUNCTION_URL, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { mode: 'aggregates', last4: '5990', brand: 'visa' },
    });
    
    const json = await res.json();
    
    expect(res.status()).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.cards.length).toBeGreaterThan(0);
    expect(json.cards[0]?.collision_risk).toBe(true);
  });
});

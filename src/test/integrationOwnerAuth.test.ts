import { describe, expect, it, vi } from 'vitest';
import { integrationOwnerDenial } from '../../supabase/functions/_shared/integration-owner-auth';

const request = (authorization?: string) => new Request('https://example.test', {
  headers: authorization ? { Authorization: authorization } : {},
});
const client = (owner: unknown = false) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'verified-actor' } }, error: null }) },
  rpc: vi.fn().mockResolvedValue({ data: owner, error: null }),
});

describe('integration configuration authorization', () => {
  it.each([undefined, '', 'token', 'Bearer', 'Basic password'])('rejects invalid authorization %s before lookup', async header => {
    const db = client(true);
    expect((await integrationOwnerDenial(request(header), db))?.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.auth.getUser).not.toHaveBeenCalled();
  });
  it.each([false, null, 'true', 1])('denies staff/admin or malformed role result %s', async role => {
    expect((await integrationOwnerDenial(request('Bearer user-token'), client(role)))?.status).toBe(403);
  });
  it('uses the verified actor and canonical role', async () => {
    const db = client(true);
    expect(await integrationOwnerDenial(request('Bearer owner-token'), db)).toBeNull();
    expect(db.rpc).toHaveBeenCalledWith('has_role_v2', { _user_id: 'verified-actor', _role_code: 'super_admin' });
  });
  it('fails closed on expired session, role error and role transport failure', async () => {
    const db = client(true);
    db.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('expired') });
    expect((await integrationOwnerDenial(request('Bearer expired'), db))?.status).toBe(401);
    db.rpc.mockResolvedValueOnce({ data: true, error: new Error('lookup failed') });
    expect((await integrationOwnerDenial(request('Bearer token'), db))?.status).toBe(403);
    db.rpc.mockRejectedValueOnce(new Error('network'));
    expect((await integrationOwnerDenial(request('Bearer token'), db))?.status).toBe(403);
  });
  it('allows only explicitly enabled exact internal service credentials', async () => {
    const db = client(false);
    expect(await integrationOwnerDenial(request('Bearer synthetic-service-key'), db, 'synthetic-service-key')).toBeNull();
    expect(db.auth.getUser).not.toHaveBeenCalled();
    expect((await integrationOwnerDenial(request('Bearer synthetic-service-key'), db))?.status).toBe(403);
    expect((await integrationOwnerDenial(request('Bearer other-key'), db, 'synthetic-service-key'))?.status).toBe(403);
  });
});

/**
 * PATCH-GRANT-ACCESS-AUTHZ-V1 / SEC-A
 *
 * Unit tests for the caller authorization helper of grant-access-for-order.
 *
 * Runs under Vitest. Imports the Deno helper directly and shims `Deno.env`
 * so `SUPABASE_SERVICE_ROLE_KEY` is resolvable.
 *
 * NO valid production order is used. NO edge network I/O. All Supabase
 * calls are mocked.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

// Shim Deno.env.get before importing the helper so its module-level
// references (there aren't any today, but `resolveGrantAccessCaller` reads
// it at call time — still cheap to install once).
const SERVICE_ROLE_KEY = "SRK_TEST_TOKEN_DO_NOT_LOG";
beforeAll(() => {
  (globalThis as any).Deno = {
    env: {
      get: (k: string) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? SERVICE_ROLE_KEY : undefined),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
import {
  resolveGrantAccessCaller,
  detectBranch,
  enforceBranchPolicy,
  type ResolvedCaller,
} from "../../supabase/functions/grant-access-for-order/caller_auth";

// ── Mocks ──────────────────────────────────────────────────────────────

function makeSupabase(opts: {
  user?: { id: string; email: string | null } | null;
  authError?: any;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
} = {}) {
  return {
    auth: {
      getUser: vi.fn(async (_token: string) => ({
        data: { user: opts.user ?? null },
        error: opts.authError ?? null,
      })),
    },
    rpc: vi.fn(async (_fn: string, args: any) => {
      if (args?._role_code === "admin") return { data: !!opts.isAdmin };
      if (args?._role_code === "super_admin") return { data: !!opts.isSuperAdmin };
      return { data: false };
    }),
  };
}

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/grant-access-for-order", {
    method: "POST",
    headers,
    body: "{}",
  });
}

// ── resolveGrantAccessCaller ──────────────────────────────────────────

describe("SEC-A / resolveGrantAccessCaller", () => {
  it("1. no Authorization → 401 unauthorized_no_bearer", async () => {
    const r = await resolveGrantAccessCaller(makeReq(), makeSupabase());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("unauthorized_no_bearer");
    }
  });

  it("2. invalid bearer (getUser error) → 401 unauthorized_invalid_token", async () => {
    const sb = makeSupabase({ user: null, authError: { message: "bad" } });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer garbage.token.value" }),
      sb,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("unauthorized_invalid_token");
    }
  });

  it("3. anon JWT (getUser returns no user) → 401 unauthorized_invalid_token", async () => {
    const sb = makeSupabase({ user: null });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer anon.jwt.here" }),
      sb,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("4. ordinary authenticated user (no admin/super_admin roles) → resolved as ordinary_user", async () => {
    const sb = makeSupabase({
      user: { id: "u-1", email: "u1@example.com" },
      isAdmin: false,
      isSuperAdmin: false,
    });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer ordinary.jwt" }),
      sb,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.caller.type).toBe("ordinary_user");
  });

  it("service-role literal key → service_role", async () => {
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
      makeSupabase(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caller.type).toBe("service_role");
      expect(r.caller.actorLabel).toBe("service_role");
    }
  });

  it("crafted JWT with role=service_role claim BUT not equal to SERVICE_ROLE_KEY → NOT service_role", async () => {
    // A user JWT that happens to encode {role:"service_role"} in payload must
    // still be classified through getUser+has_role_v2 — never trusted as service_role.
    const sb = makeSupabase({ user: { id: "u-2", email: "u2@example.com" }, isAdmin: false });
    const crafted = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.forged";
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: `Bearer ${crafted}` }),
      sb,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.caller.type).toBe("ordinary_user");
  });

  it("admin JWT → admin, actor.id populated", async () => {
    const sb = makeSupabase({
      user: { id: "a-1", email: "admin@example.com" },
      isAdmin: true,
    });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer admin.jwt" }),
      sb,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caller.type).toBe("admin");
      expect(r.caller.actorUserId).toBe("a-1");
      expect(r.caller.actorLabel).toBe("admin@example.com");
      expect(r.caller.actorType).toBe("admin");
    }
  });

  it("super_admin JWT → admin", async () => {
    const sb = makeSupabase({
      user: { id: "sa-1", email: "sa@example.com" },
      isAdmin: false,
      isSuperAdmin: true,
    });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer super.jwt" }),
      sb,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.caller.type).toBe("admin");
  });
});

// ── detectBranch ──────────────────────────────────────────────────────

describe("SEC-A / detectBranch", () => {
  it("3ds_finalize context → 3ds_finalize", () => {
    expect(detectBranch({ context: "3ds_finalize", orderId: "o" })).toBe("3ds_finalize");
  });
  it("adminManualAccessEdit=true → adminManualAccessEdit", () => {
    expect(detectBranch({ adminManualAccessEdit: true, orderId: "o" })).toBe("adminManualAccessEdit");
  });
  it("context=subscription_renewal → subscription_renewal", () => {
    expect(detectBranch({ context: "subscription_renewal", orderId: "o" })).toBe("subscription_renewal");
  });
  it("legacy order_id → legacy_body_alias", () => {
    expect(detectBranch({ order_id: "o" })).toBe("legacy_body_alias");
  });
  it("default → standard", () => {
    expect(detectBranch({ orderId: "o", source: "admin_grant" })).toBe("standard");
  });
});

// ── enforceBranchPolicy ───────────────────────────────────────────────

const admin: ResolvedCaller = {
  type: "admin",
  actorUserId: "a",
  actorLabel: "a@e",
  actorType: "admin",
  actor: { id: "a", email: "a@e" },
};
const svc: ResolvedCaller = {
  type: "service_role",
  actorUserId: null,
  actorLabel: "service_role",
  actorType: "system",
  actor: null,
};
const usr: ResolvedCaller = {
  type: "ordinary_user",
  actorUserId: "u",
  actorLabel: "u@e",
  actorType: "system",
  actor: { id: "u", email: "u@e" },
};

describe("SEC-A / enforceBranchPolicy — permission matrix", () => {
  // ── forbidden ordinary_user across every branch ──
  it("5. ordinary_user + spoofed 'admin_grant' source → 403 (branch=standard)", () => {
    const r = enforceBranchPolicy("standard", usr);
    expect(r?.status).toBe(403);
    expect(r?.body.error).toBe("forbidden_ordinary_user");
  });
  it("ordinary_user on adminManualAccessEdit → 403", () => {
    expect(enforceBranchPolicy("adminManualAccessEdit", usr)?.status).toBe(403);
  });
  it("ordinary_user on 3ds_finalize → 403", () => {
    expect(enforceBranchPolicy("3ds_finalize", usr)?.status).toBe(403);
  });
  it("ordinary_user on subscription_renewal → 403", () => {
    expect(enforceBranchPolicy("subscription_renewal", usr)?.status).toBe(403);
  });

  // ── admin ──
  it("6. admin standard → allow", () => {
    expect(enforceBranchPolicy("standard", admin)).toBeNull();
  });
  it("7. super_admin standard → allow (same code path as admin)", () => {
    expect(enforceBranchPolicy("standard", admin)).toBeNull();
  });
  it("13. adminManualAccessEdit admin → allow", () => {
    expect(enforceBranchPolicy("adminManualAccessEdit", admin)).toBeNull();
  });
  it("9. admin 3ds_finalize → 403 (service_role only)", () => {
    const r = enforceBranchPolicy("3ds_finalize", admin);
    expect(r?.status).toBe(403);
    expect(r?.body.error).toBe("forbidden_service_role_only");
  });
  it("11. admin subscription_renewal → 403 (service_role only)", () => {
    const r = enforceBranchPolicy("subscription_renewal", admin);
    expect(r?.status).toBe(403);
    expect(r?.body.error).toBe("forbidden_service_role_only");
  });

  // ── service_role ──
  it("8. service-role standard → allow", () => {
    expect(enforceBranchPolicy("standard", svc)).toBeNull();
  });
  it("10. service-role 3ds_finalize → allow", () => {
    expect(enforceBranchPolicy("3ds_finalize", svc)).toBeNull();
  });
  it("12. service-role subscription_renewal → allow", () => {
    expect(enforceBranchPolicy("subscription_renewal", svc)).toBeNull();
  });
  it("service-role adminManualAccessEdit → allow (handler still requires admin JWT for actor)", () => {
    expect(enforceBranchPolicy("adminManualAccessEdit", svc)).toBeNull();
  });
  it("service-role legacy_body_alias → allow", () => {
    expect(enforceBranchPolicy("legacy_body_alias", svc)).toBeNull();
  });
  it("admin legacy_body_alias → allow", () => {
    expect(enforceBranchPolicy("legacy_body_alias", admin)).toBeNull();
  });
});

// ── audit attribution matrix ──────────────────────────────────────────

describe("SEC-A / audit attribution derived from caller", () => {
  it("14. admin caller → auditActor uses admin/actor_id/email", async () => {
    const sb = makeSupabase({
      user: { id: "a-42", email: "admin42@example.com" },
      isAdmin: true,
    });
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: "Bearer admin.jwt" }),
      sb,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caller.actorType).toBe("admin");
      expect(r.caller.actorUserId).toBe("a-42");
      expect(r.caller.actorLabel).toBe("admin42@example.com");
    }
  });

  it("service_role caller → auditActor uses system/null/service_role", async () => {
    const r = await resolveGrantAccessCaller(
      makeReq({ Authorization: `Bearer ${SERVICE_ROLE_KEY}` }),
      makeSupabase(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.caller.actorType).toBe("system");
      expect(r.caller.actorUserId).toBeNull();
      expect(r.caller.actorLabel).toBe("service_role");
    }
  });
});

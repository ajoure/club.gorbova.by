import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Beta helper types — the @supabase/supabase-js `auth.oauth` namespace ships
// without stable TS types yet; a narrow local wrapper keeps us using the real
// client methods without any `any`.
type OAuthAuthorization = {
  redirect_url?: string;
  redirect_to?: string;
  client?: { name?: string; redirect_uri?: string } | null;
  scope?: string;
};
type OAuthNs = {
  getAuthorizationDetails: (id: string) => Promise<{ data: OAuthAuthorization | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: OAuthAuthorization | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: OAuthAuthorization | null; error: { message: string } | null }>;
};

function getOAuth(): OAuthNs {
  const authAny = (supabase.auth as unknown as { oauth?: OAuthNs });
  if (!authAny.oauth) throw new Error("OAuth server API is not available on this Supabase client version.");
  return authAny.oauth;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<OAuthAuthorization | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await getOAuth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const oauth = getOAuth();
      const { data, error } = approve
        ? await oauth.approveAuthorization(authorizationId)
        : await oauth.denyAuthorization(authorizationId);
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setError("No redirect returned by the authorization server.");
        setBusy(false);
        return;
      }
      window.location.href = target;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {details?.client?.name
              ? `Connect ${details.client.name} to Gorbova Club`
              : "Authorize connection"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p className="text-sm text-destructive">
              Could not process this authorization request: {error}
            </p>
          )}
          {!error && !details && <p className="text-sm text-muted-foreground">Loading…</p>}
          {details && (
            <>
              <p className="text-sm text-muted-foreground">
                This lets {details.client?.name ?? "the client"} use this app as you.
                It does not bypass this app's permissions or backend policies.
              </p>
              {details.scope && (
                <p className="text-xs text-muted-foreground">
                  Requested scope: <code>{details.scope}</code>
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <Button disabled={busy} onClick={() => decide(true)}>
                  Approve
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
                  Cancel connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

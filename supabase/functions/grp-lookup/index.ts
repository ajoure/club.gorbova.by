import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Normalize UNP: digits only, exactly 9 */
function normalizeUnp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}

interface GrpRow {
  vunp: string;
  vnaimp: string;
  vnaimk: string;
  vpadres: string;
  dreg: string | null;
  nmns: string;
  vmns: string;
  ckodsost: string;
  vkods: string;
  dlikv: string | null;
  vlikv: string | null;
}

interface GrpLookupResult {
  found: boolean;
  data?: {
    unp: string;
    full_name: string;
    short_name: string;
    address: string;
    registration_date: string | null;
    tax_office_code: string;
    tax_office_name: string;
    status_code: string;
    status_name: string;
    liquidation_date: string | null;
    liquidation_reason: string | null;
  };
  raw?: GrpRow;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check — JWT validation in code (auth-required by default)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const rawUnp: string = body.unp || "";

    if (!rawUnp) {
      return new Response(
        JSON.stringify({ error: "Укажите УНП для поиска" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const unp = normalizeUnp(rawUnp);
    if (!unp) {
      return new Response(
        JSON.stringify({ error: "УНП должен содержать ровно 9 цифр" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const apiUrl = `https://grp.nalog.gov.by/api/grp-public/data?unp=${unp}&charset=UTF-8&type=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    console.log(`[grp-lookup] Fetching: ${apiUrl}`);

    let response: Response;
    try {
      response = await fetch(apiUrl, { signal: controller.signal });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const errMsg = (fetchErr as Error).message || "Unknown fetch error";
      console.error(`[grp-lookup] Fetch error: ${errMsg}`);
      if ((fetchErr as Error).name === "AbortError") {
        return new Response(
          JSON.stringify({
            error: "Источник данных МНС временно недоступен (таймаут)",
          }),
          {
            status: 504,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      return new Response(
        JSON.stringify({
          error: "Не удалось подключиться к серверу МНС",
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    clearTimeout(timeoutId);

    const text = await response.text();
    console.log(`[grp-lookup] Response status: ${response.status}, body length: ${text.length}`);

    // MNS returns 400 with "Нет данных по запросу" when UNP not found
    if (response.status === 400) {
      console.log(`[grp-lookup] MNS returned 400 (not found) for UNP ${unp}`);
      const result: GrpLookupResult = { found: false };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      console.error(`[grp-lookup] MNS error: status=${response.status}, body=${text.substring(0, 500)}`);
      return new Response(
        JSON.stringify({ error: "Источник данных временно недоступен" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error(`[grp-lookup] Invalid JSON from MNS: ${text.substring(0, 200)}`);
      return new Response(
        JSON.stringify({ error: "Некорректный ответ сервера МНС" }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const grpData = parsed as { row?: GrpRow };

    if (!grpData.row) {
      const result: GrpLookupResult = { found: false };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = grpData.row;
    const result: GrpLookupResult = {
      found: true,
      data: {
        unp: row.vunp,
        full_name: row.vnaimp,
        short_name: row.vnaimk || "",
        address: row.vpadres || "",
        registration_date: row.dreg || null,
        tax_office_code: row.nmns || "",
        tax_office_name: row.vmns || "",
        status_code: row.ckodsost || "",
        status_name: row.vkods || "",
        liquidation_date: row.dlikv || null,
        liquidation_reason: row.vlikv || null,
      },
      raw: row,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[grp-lookup] Unhandled error: ${(err as Error).message}`);
    return new Response(
      JSON.stringify({ error: "Внутренняя ошибка сервиса" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

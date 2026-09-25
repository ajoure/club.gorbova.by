import { ImageResponse } from "npm:@vercel/og@0.6.8";
import React from "npm:react@19.1.1";
import { createClient } from "npm:@supabase/supabase-js@2.108.2";

type SharePreview = {
  title: string;
  doc_number: string | null;
  doc_date: string | null;
  status: string;
};

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref")?.trim();
  const anchor = url.searchParams.get("anchor")?.trim();
  if (!ref) return new Response("Missing ref", { status: 400 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await supabase.rpc(
    "get_legal_document_share_preview",
    { p_ref: ref },
  );
  const preview = (data?.[0] ?? null) as SharePreview | null;
  if (error || !preview) return new Response("Document not found", { status: 404 });

  const details = [
    preview.doc_date,
    preview.doc_number ? `№ ${preview.doc_number}` : null,
    anchor?.startsWith("art-") ? `Статья ${anchor.slice(4).replaceAll("-", ".")}` : null,
  ].filter(Boolean).join("  ·  ");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        color: "#111827",
        background:
          "linear-gradient(135deg, #f7f8ff 0%, #ffffff 48%, #f4eefe 100%)",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <div
          style={{
            width: "58px",
            height: "58px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "18px",
            color: "white",
            fontSize: "34px",
            background: "linear-gradient(135deg, #ff4fd8, #7c3aed)",
          }}
        >
          §
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "30px", fontWeight: 700 }}>БУКВА ЗАКОНА</span>
          <span style={{ fontSize: "20px", color: "#64748b" }}>
            Законодательство Республики Беларусь
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div
          style={{
            alignSelf: "flex-start",
            padding: "8px 18px",
            borderRadius: "999px",
            color: "#2563eb",
            background: "#eaf2ff",
            fontSize: "20px",
            fontWeight: 700,
          }}
        >
          {preview.status === "active" ? "ДЕЙСТВУЕТ" : preview.status.toUpperCase()}
        </div>
        <div
          style={{
            maxWidth: "1040px",
            fontSize: "54px",
            lineHeight: 1.12,
            fontWeight: 800,
            letterSpacing: "-1px",
          }}
        >
          {truncate(preview.title, 150)}
        </div>
        {details && (
          <div style={{ fontSize: "24px", color: "#64748b" }}>{details}</div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "21px",
          color: "#64748b",
        }}
      >
        <span>Актуальная редакция документа</span>
        <span style={{ fontWeight: 700, color: "#7c3aed" }}>gorbova.by</span>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}

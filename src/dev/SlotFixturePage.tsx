/**
 * DEV-ONLY /__slot-fixture regression harness for the slot bridge.
 *
 * Guarded by import.meta.env.DEV. In production bundles the route element
 * short-circuits to a 404 message and does not import fixture assets. No DB
 * or /cb writes — this stand is entirely local.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { HtmlIframePreview } from "@/components/shared/HtmlIframePreview";
import type { SiteSlotManifest } from "@/lib/siteSlotManifest";
import {
  SCENARIOS,
  type ScenarioKey,
  buildSlotFixtureHtml,
} from "@/dev/slotFixtureHtml";

const VIEWPORTS: Array<{ label: string; width: number }> = [
  { label: "1440", width: 1440 },
  { label: "960", width: 960 },
  { label: "375", width: 375 },
];

type DiagArtboard = {
  artboard: {
    height: string;
    heightPriority: string;
    minHeight: string;
    minHeightPriority: string;
    offsetHeight: number;
  };
  record: {
    present: boolean;
    height?: string;
    heightPriority?: string;
    minHeight?: string;
    minHeightPriority?: string;
    offsetHeight?: number;
  };
  cloneCount: number;
  visibleCloneCount: number;
  extraCount: number;
  wrappers: Array<{
    pos: string | null;
    origVariant: string | null;
    activeVariant: string | null;
    offerId: string | null;
    inactive: boolean;
    rect: { x: number; y: number; w: number; h: number };
  }>;
  nextRecordTop: number | null;
};

type Diag = {
  reqId: string | null;
  resizePassCount: number;
  viewportBucket: string;
  viewportWidth: number;
  artboards: DiagArtboard[];
};

const SlotFixturePage = () => {
  const [scenario, setScenario] = useState<ScenarioKey>("three");
  const [omitRecord, setOmitRecord] = useState(false);
  const [viewport, setViewport] = useState<number>(1440);
  const [diag, setDiag] = useState<Diag | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => buildSlotFixtureHtml({ omitRecord }), [omitRecord]);
  const manifest = useMemo(
    () => SCENARIOS[scenario]() as unknown as SiteSlotManifest,
    [scenario],
  );

  // Listen for diag responses from the iframe bridge.
  useEffect(() => {
    const h = (ev: MessageEvent) => {
      const d: any = ev.data;
      if (!d || d.type !== "lovable-slot-diag") return;
      setDiag(d as Diag);
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);

  const requestDiag = () => {
    const iframe = containerRef.current?.querySelector("iframe");
    if (!iframe || !iframe.contentWindow) return;
    const reqId = String(Date.now());
    iframe.contentWindow.postMessage(
      { type: "lovable-slot-diag-request", reqId },
      "*",
    );
  };

  // Expose test-API on window for Playwright.
  useEffect(() => {
    (window as any).__slotFixture = {
      setScenario: (k: ScenarioKey) => setScenario(k),
      setOmitRecord: (v: boolean) => setOmitRecord(v),
      setViewport: (w: number) => setViewport(w),
      getDiag: () =>
        new Promise<Diag>((resolve) => {
          const iframe = containerRef.current?.querySelector("iframe");
          if (!iframe || !iframe.contentWindow) {
            resolve(null as any);
            return;
          }
          const reqId = String(Date.now()) + ":" + Math.random();
          const handler = (ev: MessageEvent) => {
            const d: any = ev.data;
            if (!d || d.type !== "lovable-slot-diag") return;
            if (d.reqId !== reqId) return;
            window.removeEventListener("message", handler);
            resolve(d as Diag);
          };
          window.addEventListener("message", handler);
          iframe.contentWindow.postMessage(
            { type: "lovable-slot-diag-request", reqId },
            "*",
          );
        }),
    };
    return () => {
      delete (window as any).__slotFixture;
    };
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: 18, marginBottom: 12 }}>
        DEV: /__slot-fixture — slot bridge regression harness
      </h1>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
        <label>
          Scenario:{" "}
          <select
            data-testid="fx-scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioKey)}
          >
            <option value="zero">0 offers</option>
            <option value="one">1 offer</option>
            <option value="three">3 offers (fixed)</option>
            <option value="max">max (5 → 3 fixed + 2 overflow)</option>
            <option value="swapPrimaryLegal">swap primary ↔ legal_entity</option>
            <option value="swapPrimaryInstallment">
              swap primary ↔ installment
            </option>
            <option value="forceSwapAllPrimary">force swap: 3× primary</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="fx-omit-record"
            checked={omitRecord}
            onChange={(e) => setOmitRecord(e.target.checked)}
          />{" "}
          omit .t396 record (fail-closed)
        </label>
        <label>
          Viewport:{" "}
          <select
            data-testid="fx-viewport"
            value={viewport}
            onChange={(e) => setViewport(Number(e.target.value))}
          >
            {VIEWPORTS.map((v) => (
              <option key={v.width} value={v.width}>
                {v.label}px
              </option>
            ))}
          </select>
        </label>
        <button data-testid="fx-request-diag" onClick={requestDiag}>
          Request diag
        </button>
      </div>

      <div
        ref={containerRef}
        data-testid="fx-iframe-container"
        style={{
          width: viewport,
          maxWidth: "100%",
          border: "1px solid #ccc",
          background: "#fff",
        }}
      >
        <HtmlIframePreview
          html={html}
          slotManifest={manifest}
          pageId="fixture-page"
          blockId="fixture-block"
        />
      </div>

      <pre
        data-testid="fx-diag-json"
        style={{
          marginTop: 16,
          padding: 12,
          background: "#f8f8f8",
          fontSize: 11,
          maxHeight: 400,
          overflow: "auto",
        }}
      >
        {diag ? JSON.stringify(diag, null, 2) : "(request diag to see snapshot)"}
      </pre>
    </div>
  );
};

export default SlotFixturePage;

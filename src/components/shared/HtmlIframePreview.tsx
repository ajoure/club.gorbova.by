/**
 * HtmlIframePreview — shared infrastructure / adapter-like preview layer.
 *
 * Renders arbitrary admin-authored HTML inside a sandboxed iframe with auto-resize,
 * in-page anchor delegation to the parent window, and safe external-link opening.
 *
 * TRUST BOUNDARY:
 *   Admin-authored content only. Not for student/user-generated input without
 *   a separate sanitization policy.
 *
 * SECURITY BOUNDARY:
 *   sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
 *   - allow-scripts: required for internal resize/anchor postMessage bridge.
 *   - allow-forms: required for admin-authored lead/demo forms inside HTML pages.
 *   - allow-same-origin: NOT granted. The iframe remains opaque-origin; the parent
 *     identifies messages by `e.source === iframe.contentWindow` (origin check is
 *     not reliable for srcdoc).
 *   - External links open via window.open(url, '_blank', 'noopener,noreferrer').
 *
 * ISOLATION INVARIANT:
 *   HTML block content does NOT integrate with platform services directly.
 */

import { useState, useRef, useEffect } from "react";
import { Code } from "lucide-react";

const SANDBOX_POLICY =
  "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/**
 * Maximum iframe height in px — защита от runaway CSS (`min-height: 100vh` в кривой вёрстке и т.п.).
 * 100 000 px ≈ 26 экранов FullHD, с запасом покрывает длинные Tilda/HTML-лендинги (ЦБ 2.0, ~30–60k px).
 * При превышении в console пишется warning, чтобы сразу видеть причину визуальной обрезки.
 */
const MAX_IFRAME_HEIGHT = 100000;

/** Unique marker to prevent double injection of bridge script (versioned). */
const BRIDGE_MARKER = "data-lovable-resize-v8";
const BRIDGE_VERSION = 8;

/**
 * Single injected bridge script: resize + anchor intercept + scrollIntoView intercept
 * + external link safe-open. Idempotent via BRIDGE_MARKER.
 */
const BRIDGE_SCRIPT = `<script ${BRIDGE_MARKER}>
(function() {
  if (document.documentElement.getAttribute('${BRIDGE_MARKER}') === '1') return;
  document.documentElement.setAttribute('${BRIDGE_MARKER}', '1');

  // Inject CSS so iframe document never grows its own scroll container.
  try {
    var st = document.createElement('style');
    st.setAttribute('${BRIDGE_MARKER}', '1');
    st.textContent = 'html,body{overflow:visible !important;height:auto !important;}'
      + ' #t-footer,.t-footer,.t-tildalabel,a[href="https://tilda.cc/"],a[href="http://tilda.cc/"],a[href^="https://tilda.cc"]{display:none !important;visibility:hidden !important;height:0 !important;overflow:hidden !important;}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  var timers = [];
  var observer = null;
  var parentViewport = { top: 0, left: 0, height: 800, width: 1024 };
  var fixedSyncPending = false;
  var parentBridgeReady = false;

  function post() {
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    try { parent.postMessage({ type: 'iframe-resize', height: h }, '*'); } catch (e) {}
  }

  function scheduleStagedSync() {
    post();
    scheduleFixedOverlaySync();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(post);
    }
    timers.push(setTimeout(post, 50));
    timers.push(setTimeout(post, 300));
    timers.push(setTimeout(post, 1200));
  }

  // Fire as soon as the script runs (we are injected at end of <body>).
  scheduleStagedSync();
  window.addEventListener('load', scheduleStagedSync);
  window.addEventListener('resize', post);

  // Fonts/images can change layout after first paint.
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
    document.fonts.ready.then(post).catch(function(){});
  }
  try {
    var imgs = document.images || [];
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) imgs[i].addEventListener('load', post, { once: true });
    }
  } catch (e) {}

  if (typeof ResizeObserver !== 'undefined' && document.body) {
    observer = new ResizeObserver(function() {
      post();
      scheduleFixedOverlaySync();
    });
    observer.observe(document.body);
  }

  function isHidden(el) {
    if (!el || !el.getBoundingClientRect) return true;
    var cs = window.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
  }

  function isFullscreenFixedOverlay(el) {
    if (isHidden(el)) return false;
    var cls = String(el.className || '');
    var cs = window.getComputedStyle(el);
    if (cs.position !== 'fixed') return false;
    var rect = el.getBoundingClientRect();
    var docWidth = document.documentElement.clientWidth || window.innerWidth || 0;
    var docHeight = document.documentElement.clientHeight || window.innerHeight || 0;
    var z = parseInt(cs.zIndex || '0', 10);
    var marker = String(el.id || '') + ' ' + cls;
    // Tilda popups: repack the outer .t-popup container (position:fixed;inset:0),
    // but never the inner __container/__close/__wrapper — those live inside .t-popup.
    var isTildaPopupOuter = /(^|\s)t-popup(\s|$)/.test(cls) && !/(t-popup__)/.test(cls);
    var looksLikeModal = isTildaPopupOuter || /modal|overlay|backdrop|z-\d+|z-50/i.test(marker) || (!Number.isNaN(z) && z >= 40);
    var insetLike = Math.abs(rect.left) <= 3 && Math.abs(rect.top) <= 3 && Math.abs(docWidth - rect.right) <= Math.max(3, docWidth * 0.08);
    var fullscreenSize = rect.width >= docWidth * 0.85 && rect.height >= Math.min(docHeight, Math.max(parentViewport.height || 800, 320)) * 0.7;
    // Tilda popup outer is always full-viewport when open; skip the size heuristic for it.
    if (isTildaPopupOuter) return insetLike && !isHidden(el) && rect.height > 0;
    return looksLikeModal && insetLike && fullscreenSize;
  }

  function saveFixedOverlayStyle(el) {
    if (el.getAttribute('data-lovable-fixed-overlay-style')) return;
    var props = ['position', 'top', 'right', 'bottom', 'left', 'height', 'min-height', 'max-height', 'width', 'overflow-y'];
    var snapshot = {};
    for (var i = 0; i < props.length; i++) {
      snapshot[props[i]] = {
        value: el.style.getPropertyValue(props[i]) || '',
        priority: el.style.getPropertyPriority(props[i]) || ''
      };
    }
    try { el.setAttribute('data-lovable-fixed-overlay-style', JSON.stringify(snapshot)); } catch (e) {}
  }

  function restoreFixedOverlay(el) {
    if (!el || el.getAttribute('data-lovable-fixed-overlay') !== '1') return;
    var props = ['position', 'top', 'right', 'bottom', 'left', 'height', 'min-height', 'max-height', 'width', 'overflow-y'];
    var raw = el.getAttribute('data-lovable-fixed-overlay-style');
    var restored = false;
    if (raw) {
      try {
        var snapshot = JSON.parse(raw);
        for (var i = 0; i < props.length; i++) {
          var prop = props[i];
          var item = snapshot[prop];
          if (item && item.value) el.style.setProperty(prop, item.value, item.priority || '');
          else el.style.removeProperty(prop);
        }
        restored = true;
      } catch (e) {}
    }
    if (!restored) {
      for (var j = 0; j < props.length; j++) el.style.removeProperty(props[j]);
    }
    el.removeAttribute('data-lovable-fixed-overlay');
    el.removeAttribute('data-lovable-fixed-overlay-style');
  }

  function syncFixedOverlays() {
    fixedSyncPending = false;
    var candidates = document.querySelectorAll('.fixed, [style*="position: fixed"], [style*="position:fixed"], [data-lovable-fixed-overlay="1"]');
    var docHeight = document.documentElement.scrollHeight || document.body.scrollHeight || parentViewport.height;
    var visibleHeight = Math.max(320, Math.min(parentViewport.height || 800, docHeight));
    var visibleTop = Math.max(0, Math.min(parentViewport.top || 0, Math.max(0, docHeight - visibleHeight)));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (isFullscreenFixedOverlay(el) || el.getAttribute('data-lovable-fixed-overlay') === '1') {
        if (isHidden(el)) {
          restoreFixedOverlay(el);
          continue;
        }
        saveFixedOverlayStyle(el);
        el.setAttribute('data-lovable-fixed-overlay', '1');
        el.style.setProperty('position', 'absolute', 'important');
        el.style.setProperty('top', visibleTop + 'px', 'important');
        var htmlRect = document.documentElement.getBoundingClientRect ? document.documentElement.getBoundingClientRect() : { left: 0 };
        var localLeft = Math.max(0, (parentViewport.left || 0) - (htmlRect.left || 0));
        el.style.setProperty('left', localLeft + 'px', 'important');
        el.style.setProperty('right', 'auto', 'important');
        el.style.setProperty('bottom', 'auto', 'important');
        el.style.setProperty('width', Math.max(320, parentViewport.width || document.documentElement.clientWidth || window.innerWidth || 320) + 'px', 'important');
        el.style.setProperty('height', visibleHeight + 'px', 'important');
        el.style.setProperty('min-height', visibleHeight + 'px', 'important');
        el.style.setProperty('max-height', visibleHeight + 'px', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
      }
    }
  }

  function scheduleFixedOverlaySync() {
    if (fixedSyncPending) return;
    fixedSyncPending = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncFixedOverlays);
    else setTimeout(syncFixedOverlays, 0);
  }

  window.addEventListener('message', function(ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.type !== 'iframe-parent-viewport') return;
    parentBridgeReady = true;
    if (typeof data.top === 'number' && Number.isFinite(data.top)) parentViewport.top = data.top;
    if (typeof data.left === 'number' && Number.isFinite(data.left)) parentViewport.left = data.left;
    if (typeof data.height === 'number' && Number.isFinite(data.height)) parentViewport.height = data.height;
    if (typeof data.width === 'number' && Number.isFinite(data.width)) parentViewport.width = data.width;
    scheduleFixedOverlaySync();
  });

  // Delegate author-authored window scroll calls to the parent page when this
  // document is inside the managed iframe. Fallback to native iframe scrolling
  // if the parent bridge has not announced itself.
  try {
    var nativeScrollTo = window.scrollTo.bind(window);
    var nativeScrollBy = window.scrollBy.bind(window);
    function parseScrollArgs(args, mode) {
      var currentX = window.pageXOffset || document.documentElement.scrollLeft || 0;
      var currentY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var x = 0;
      var y = 0;
      var behavior = 'auto';
      if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        var opts = args[0];
        x = typeof opts.left === 'number' ? opts.left : (mode === 'by' ? 0 : currentX);
        y = typeof opts.top === 'number' ? opts.top : (mode === 'by' ? 0 : currentY);
        behavior = typeof opts.behavior === 'string' ? opts.behavior : 'auto';
      } else {
        x = typeof args[0] === 'number' ? args[0] : (mode === 'by' ? 0 : currentX);
        y = typeof args[1] === 'number' ? args[1] : (mode === 'by' ? 0 : currentY);
      }
      return { type: 'iframe-scroll-command', mode: mode, left: x, top: y, behavior: behavior };
    }
    function relayParentScroll(payload) {
      if (!parentBridgeReady || parent === window) return false;
      try { parent.postMessage(payload, '*'); return true; } catch (e) { return false; }
    }
    window.scrollTo = function() {
      var payload = parseScrollArgs(arguments, 'to');
      if (relayParentScroll(payload)) return;
      return nativeScrollTo.apply(window, arguments);
    };
    window.scrollBy = function() {
      var payload = parseScrollArgs(arguments, 'by');
      if (relayParentScroll(payload)) return;
      return nativeScrollBy.apply(window, arguments);
    };
  } catch (e) {}

  window.addEventListener('wheel', function(ev) {
    // Keep horizontal wheel/trackpad gestures inside the iframe so author-authored
    // sliders (Tilda t396/t-slds) receive them. Only relay vertical scroll to parent.
    var dx = ev.deltaX || 0;
    var dy = ev.deltaY || 0;
    if (Math.abs(dx) > Math.abs(dy)) return;
    try {
      parent.postMessage({ type: 'iframe-wheel', deltaX: dx, deltaY: dy }, '*');
    } catch (e) {}
  }, { passive: true });

  if (typeof MutationObserver !== 'undefined' && document.body) {
    var mutationObserver = new MutationObserver(function() {
      post();
      scheduleFixedOverlaySync();
    });
    mutationObserver.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('beforeunload', function() { mutationObserver.disconnect(); });
  }

  window.addEventListener('beforeunload', function() {
    for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
    timers = [];
    if (observer) { observer.disconnect(); observer = null; }
  });

  // ---- Anchor / link intercept (capture phase, so author handlers still run if they want) ----
  function findAnchor(node) {
    while (node && node !== document) {
      if (node.tagName === 'A') return node;
      node = node.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function(ev) {
    if (ev.defaultPrevented) return;
    // Respect modifier keys / non-primary buttons → let browser handle.
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;

    var a = findAnchor(ev.target);
    if (!a) return;

    // Anchors carrying a site-action / dynamic-slot marker are handled by the
    // dedicated bridges below. Skip anchor intercept so we don't preventDefault
    // before those listeners run (and lose the click via defaultPrevented).
    if (a.getAttribute && (
      a.getAttribute('data-lovable-action') ||
      a.getAttribute('data-lovable-slot') ||
      a.hasAttribute('data-lovable-offer-id') ||
      a.hasAttribute('data-lovable-offer-wrapper') ||
      (a.closest && (a.closest('[data-lovable-slot]') || a.closest('[data-lovable-offer-wrapper]')))
    )) return;

    var rawHref = a.getAttribute('href');
    if (rawHref === null) return;

    // Empty or bare "#" — neutralize (do not open new tab, do not jump to top).
    if (rawHref === '' || rawHref === '#') {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // In-page hash anchor.
    if (rawHref.charAt(0) === '#') {
      var id = rawHref.slice(1);
      // Tilda popup syntax (#popup:xxx) → let author JS handle (bubble phase).
      // Otherwise resolve target via id first, then legacy <a name="..."> fallback.
      var el = null;
      if (id) {
        try { el = document.getElementById(id); } catch (e) {}
        if (!el) {
          try {
            var named = document.getElementsByName(id);
            if (named && named.length) el = named[0];
          } catch (e) {}
        }
      }
      if (!el) return;
      var targetOffsetTop = el.getBoundingClientRect().top
        + (window.pageYOffset || document.documentElement.scrollTop || 0);
      ev.preventDefault();
      ev.stopPropagation();
      try {
        parent.postMessage({
          type: 'iframe-anchor',
          id: id,
          targetOffsetTop: targetOffsetTop,
          found: true
        }, '*');
      } catch (e) {}
      return;
    }

    // javascript: / mailto: / tel: — let browser/author handle.
    if (/^(javascript|mailto|tel|sms):/i.test(rawHref)) return;

    // External link — open safely in new tab; fall back to parent-relay if
    // the sandboxed popup is blocked (Safari popup blocker).
    var url = a.href; // resolved absolute URL
    ev.preventDefault();
    ev.stopPropagation();
    var opened = null;
    try { opened = window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
    if (!opened) {
      try { parent.postMessage({ type: 'iframe-open-url', url: url }, '*'); } catch (e) {}
    }
  }, true);

  // ---- Site-action bridge (data-lovable-action) ----
  // Allows admin-authored HTML to trigger host-side actions (e.g. open PaymentDialog)
  // without breaking iframe isolation. Only UUIDs flow across the boundary; the host
  // validates the action and payload before acting on it.
  function findActionEl(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-lovable-action')) return node;
      node = node.parentNode;
    }
    return null;
  }
  document.addEventListener('click', function(ev) {
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    var el = findActionEl(ev.target);
    if (!el) return;
    var action = el.getAttribute('data-lovable-action');
    if (!action) return;
    ev.preventDefault();
    ev.stopPropagation();
    var payload = {};
    var attrs = el.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var name = attrs[i].name;
      if (name.indexOf('data-') === 0 && name !== 'data-lovable-action') {
        payload[name.slice(5).replace(/-/g, '_')] = attrs[i].value;
      }
    }
    try { parent.postMessage({ type: 'site-action', action: action, payload: payload }, '*'); } catch (e) {}
  }, true);


  // ---- Dynamic slot bridge (v8) ----
  // Handshake:
  //   iframe → parent: { type:'lovable-bridge-ready', version:BRIDGE_VERSION }
  //   parent → iframe: { type:'lovable-slot-manifest', manifest, page_id, block_id }
  // The bridge validates ev.source === parent, echoes back page_id/block_id in
  // click payloads, and refuses payloads with mismatched product/page/block.
  //
  // DOM contract (Phase B HTML cutover):
  //   [data-lovable-slot-group="tariff:<code>"]  container per tariff
  //     [data-lovable-offer-wrapper][data-lovable-slot-position="N"]
  //       [data-lovable-offer-label]   ← the ONLY node whose textContent we touch
  //     [data-lovable-slot-extra="tariff:<code>"]   normal-flow overflow bucket
  //     [data-lovable-slot-template="<variant>"]    hidden clone templates
  //
  // Backward compat: legacy [data-lovable-slot="tariff:<code>|offer:<role>"]
  // wrappers WITHOUT [data-lovable-offer-label] children are still supported;
  // the label falls back to the wrapper (or its .tn-atom) as in v7 — used only
  // by preview until the HTML cutover ships.
  var currentSlotManifest = null;
  var bridgePageId = null;
  var bridgeBlockId = null;
  var applyingManifest = false;

  function parseSlotAttr(value) {
    if (!value) return null;
    var m = /^tariff:([^|]+)(\|offer:(.+))?$/.exec(String(value).trim());
    if (!m) return null;
    return { tariff_code: m[1], slot_role: m[3] || null };
  }

  function findLabelHost(wrapper) {
    if (!wrapper) return null;
    var explicit = wrapper.querySelector('[data-lovable-offer-label]');
    if (explicit) return explicit;
    // Legacy fallback: prefer .tn-atom to avoid nuking Tilda's __button-content.
    // If the wrapper itself is .tn-atom, still use it (its children get lost —
    // caller has explicitly opted into legacy layout by not tagging a label).
    return wrapper.querySelector('.tn-atom') || wrapper;
  }

  function setLabelText(host, text) {
    if (!host || typeof text !== 'string' || !text.length) return;
    if (host.textContent === text) return;
    host.textContent = text;
  }

  function setDisplay(el, value) {
    if (!el) return;
    var current = el.style.display || '';
    if (current === value) return;
    el.style.display = value;
  }

  function assignOfferToWrapper(wrapper, offer) {
    if (!wrapper) return;
    wrapper.setAttribute('data-lovable-offer-id', String(offer.offer_id));
    wrapper.setAttribute('data-lovable-offer-tariff-id', String(offer.tariff_id || ''));
    wrapper.setAttribute('data-lovable-offer-slot-role', String(offer.slot_role));
    wrapper.setAttribute('data-lovable-offer-variant', String(offer.variant || ''));
    wrapper.removeAttribute('data-lovable-slot-inactive');
    setDisplay(wrapper, wrapper.getAttribute('data-lovable-slot-orig-display') || '');
    setLabelText(findLabelHost(wrapper), offer.button_label);
  }

  function deactivateWrapper(wrapper) {
    if (!wrapper) return;
    wrapper.setAttribute('data-lovable-slot-inactive', '1');
    wrapper.removeAttribute('data-lovable-offer-id');
    wrapper.removeAttribute('data-lovable-offer-tariff-id');
    wrapper.removeAttribute('data-lovable-offer-slot-role');
    setDisplay(wrapper, 'none');
  }

  function ensureOrigDisplay(el) {
    if (!el.hasAttribute('data-lovable-slot-orig-display')) {
      el.setAttribute('data-lovable-slot-orig-display', el.style.display || '');
    }
  }

  function applyGroup(group, tariffEntry) {
    // Fixed wrappers in position order.
    var wrappers = group.querySelectorAll('[data-lovable-offer-wrapper]');
    var positioned = [];
    for (var i = 0; i < wrappers.length; i++) {
      var w = wrappers[i];
      // Skip clones placed inside extra-container.
      if (w.hasAttribute('data-lovable-slot-clone')) continue;
      var pos = parseInt(w.getAttribute('data-lovable-slot-position') || '', 10);
      positioned.push({ el: w, pos: Number.isFinite(pos) ? pos : 999 });
      ensureOrigDisplay(w);
    }
    positioned.sort(function(a, b) { return a.pos - b.pos; });

    var offers = (tariffEntry && tariffEntry.offers) ? tariffEntry.offers.slice() : [];
    var used = Math.min(positioned.length, offers.length);
    for (var j = 0; j < positioned.length; j++) {
      if (j < offers.length) assignOfferToWrapper(positioned[j].el, offers[j]);
      else deactivateWrapper(positioned[j].el);
    }

    // Extra-container for overflow offers.
    var extra = group.querySelector('[data-lovable-slot-extra]');
    if (!extra) return;
    // Clear stale clones (only ours).
    var stale = extra.querySelectorAll('[data-lovable-slot-clone="1"]');
    for (var s = 0; s < stale.length; s++) stale[s].parentNode.removeChild(stale[s]);
    for (var k = used; k < offers.length; k++) {
      var offer = offers[k];
      var tpl = group.querySelector('[data-lovable-slot-template="' + offer.variant + '"]');
      if (!tpl) continue;
      var clone = tpl.cloneNode(true);
      clone.removeAttribute('data-lovable-slot-template');
      clone.setAttribute('data-lovable-slot-clone', '1');
      clone.setAttribute('data-lovable-offer-wrapper', '');
      clone.style.display = '';
      ensureOrigDisplay(clone);
      assignOfferToWrapper(clone, offer);
      extra.appendChild(clone);
    }
  }

  function applySlotManifest(manifest) {
    if (!manifest || !manifest.tariffs || applyingManifest) return;
    applyingManifest = true;
    try {
      var byCode = {};
      for (var i = 0; i < manifest.tariffs.length; i++) {
        var t = manifest.tariffs[i];
        if (!t || !t.tariff_code) continue;
        byCode[t.tariff_code] = t;
      }

      // Preferred path: grouped containers.
      var groups = document.querySelectorAll('[data-lovable-slot-group]');
      var handledGroups = groups.length > 0;
      for (var g = 0; g < groups.length; g++) {
        var gp = groups[g];
        var parsed = parseSlotAttr(gp.getAttribute('data-lovable-slot-group'));
        if (!parsed) continue;
        applyGroup(gp, byCode[parsed.tariff_code]);
      }

      // Legacy path: individual [data-lovable-slot] anchors (preview only).
      if (!handledGroups) {
        var slotEls = document.querySelectorAll('[data-lovable-slot]');
        for (var k = 0; k < slotEls.length; k++) {
          var el = slotEls[k];
          var parsedEl = parseSlotAttr(el.getAttribute('data-lovable-slot'));
          if (!parsedEl || !parsedEl.slot_role) continue;
          ensureOrigDisplay(el);
          var group = byCode[parsedEl.tariff_code];
          var offer = null;
          if (group) {
            for (var oi = 0; oi < (group.offers || []).length; oi++) {
              if (group.offers[oi].slot_role === parsedEl.slot_role) { offer = group.offers[oi]; break; }
            }
          }
          if (offer) assignOfferToWrapper(el, offer);
          else deactivateWrapper(el);
        }
      }
    } finally {
      applyingManifest = false;
      post();
    }
  }

  function validateIncomingManifest(data, source) {
    // Structural + provenance checks. Reject if anything is off.
    if (source !== parent) return null;
    if (!data || typeof data !== 'object') return null;
    if (data.type !== 'lovable-slot-manifest') return null;
    var m = data.manifest;
    if (!m || typeof m !== 'object' || m.version !== 1) return null;
    if (typeof m.product_id !== 'string' || !m.product_id) return null;
    if (!Array.isArray(m.tariffs)) return null;
    // page_id / block_id are best-effort — parent may not know block_id yet.
    if (typeof data.page_id === 'string') bridgePageId = data.page_id;
    if (typeof data.block_id === 'string') bridgeBlockId = data.block_id;
    return m;
  }

  window.addEventListener('message', function(ev) {
    var m = validateIncomingManifest(ev.data, ev.source);
    if (!m) return;
    currentSlotManifest = m;
    try { applySlotManifest(currentSlotManifest); } catch (e) {}
  });

  // Re-apply on DOM changes (throttled by applyingManifest flag inside applySlotManifest).
  if (typeof MutationObserver !== 'undefined' && document.body) {
    var slotMo = new MutationObserver(function(muts) {
      if (!currentSlotManifest || applyingManifest) return;
      // Ignore mutations we caused ourselves (label textContent flips).
      var trivial = true;
      for (var i = 0; i < muts.length && trivial; i++) {
        if (muts[i].type === 'childList' && muts[i].addedNodes && muts[i].addedNodes.length > 0) {
          for (var j = 0; j < muts[i].addedNodes.length; j++) {
            var n = muts[i].addedNodes[j];
            if (n.nodeType === 1) { trivial = false; break; }
          }
        }
      }
      if (trivial) return;
      try { applySlotManifest(currentSlotManifest); } catch (e) {}
    });
    slotMo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', function() { slotMo.disconnect(); });
  }

  // Announce readiness so parent can send the manifest.
  try {
    parent.postMessage({ type: 'lovable-bridge-ready', version: ${BRIDGE_VERSION} }, '*');
  } catch (e) {}

  // Click delegation for slot buttons — UUID-driven, no regex on labels.
  function findSlotEl(node) {
    while (node && node !== document) {
      if (node.getAttribute) {
        if (node.hasAttribute('data-lovable-offer-wrapper')) return node;
        if (node.getAttribute('data-lovable-slot')) return node;
      }
      node = node.parentNode;
    }
    return null;
  }
  document.addEventListener('click', function(ev) {
    if (ev.defaultPrevented) return;
    if (ev.button !== 0) return;
    var el = findSlotEl(ev.target);
    if (!el) return;
    if (el.getAttribute('data-lovable-slot-inactive') === '1') {
      ev.preventDefault(); ev.stopPropagation();
      return;
    }
    var offerId = el.getAttribute('data-lovable-offer-id') || '';
    if (!offerId) return;
    var tariffId = el.getAttribute('data-lovable-offer-tariff-id') || '';
    var slotRole = el.getAttribute('data-lovable-offer-slot-role') || '';
    // Fallback to parsing legacy attr if needed.
    if (!slotRole) {
      var parsed = parseSlotAttr(el.getAttribute('data-lovable-slot'));
      if (parsed && parsed.slot_role) slotRole = parsed.slot_role;
    }
    ev.preventDefault();
    ev.stopPropagation();
    try {
      parent.postMessage({
        type: 'site-action',
        action: 'open-slot',
        payload: {
          offer_id: offerId,
          tariff_id: tariffId,
          slot_role: slotRole,
          product_id: (currentSlotManifest && currentSlotManifest.product_id) || '',
          page_id: bridgePageId || '',
          block_id: bridgeBlockId || '',
        },
      }, '*');
    } catch (e) {}
  }, true);





  // ---- Tilda slider fallback ----
  // Some exported Tilda sliders mark themselves initialized inside a sandboxed
  // iframe but lose their click/touch handlers. Keep the native Tilda path first;
  // if it does not change state, apply a small deterministic fallback.
  try {
    if (!window.__lovableTildaSliderFallbackV1) {
      window.__lovableTildaSliderFallbackV1 = true;

      function closestMatch(node, selector) {
        while (node && node !== document) {
          if (node.matches && node.matches(selector)) return node;
          node = node.parentElement;
        }
        return null;
      }

      function getSliderRec(node) {
        return closestMatch(node, '.t-rec') || document;
      }

      function getSliderWrapper(node) {
        var rec = getSliderRec(node);
        return rec ? rec.querySelector('.t-slds__items-wrapper') : null;
      }

      function getSliderState(wrap) {
        if (!wrap) return '';
        var transform = wrap.style.transform || window.getComputedStyle(wrap).transform || '';
        return String(wrap.getAttribute('data-slider-pos') || '') + '|' + transform;
      }

      function setLoadedImages(rec, pos) {
        var indexes = [pos - 1, pos, pos + 1];
        for (var i = 0; i < indexes.length; i++) {
          var item = rec.querySelector('.t-slds__item[data-slide-index="' + indexes[i] + '"]');
          if (!item) continue;
          item.classList.add('t-slds__item-loaded');
          var images = item.querySelectorAll('.t-bgimg[data-original]');
          for (var j = 0; j < images.length; j++) {
            var url = images[j].getAttribute('data-original');
            if (!url) continue;
            images[j].style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
            images[j].classList.add('loaded');
          }
        }
      }

      function setActiveSlide(rec, pos) {
        var items = rec.querySelectorAll('.t-slds__item');
        for (var i = 0; i < items.length; i++) {
          var isActive = items[i].getAttribute('data-slide-index') === String(pos);
          items[i].classList.toggle('t-slds__item_active', isActive);
          items[i].setAttribute('aria-hidden', isActive ? 'false' : 'true');
        }
      }

      function syncSliderArrows(rec, pos, total, cycle) {
        var left = rec.querySelector('.t-slds__arrow_wrapper-left');
        var right = rec.querySelector('.t-slds__arrow_wrapper-right');
        if (left) left.style.display = (!cycle && pos <= 1) ? 'none' : '';
        if (right) right.style.display = (!cycle && pos >= total) ? 'none' : '';
      }

      function moveTildaSlider(node, direction) {
        var rec = getSliderRec(node);
        var wrap = rec ? rec.querySelector('.t-slds__items-wrapper') : null;
        if (!rec || !wrap) return false;
        var total = parseInt(wrap.getAttribute('data-slider-totalslides') || '0', 10)
          || rec.querySelectorAll('.t-slds__item:not(.t-slds__item_dummy)').length
          || 1;
        var pos = parseInt(wrap.getAttribute('data-slider-pos') || '1', 10) || 1;
        var cycle = wrap.getAttribute('data-slider-with-cycle') !== 'false';
        var next = pos + ((direction === 'left' || direction === 'prev') ? -1 : 1);
        if (cycle) {
          if (next < 1) next = total;
          if (next > total) next = 1;
        } else {
          next = Math.max(1, Math.min(total, next));
        }
        if (next === pos) return false;

        var before = getSliderState(wrap);
        var recId = rec.id ? rec.id.replace(/^rec/, '') : '';
        wrap.setAttribute('data-slider-stopped', '');
        wrap.setAttribute('data-slider-touch', '');
        wrap.setAttribute('data-slider-animated', '');
        wrap.setAttribute('data-slider-pos', String(next));

        try {
          var current = (typeof window.t_slds_getCurrentTranslate === 'function') ? window.t_slds_getCurrentTranslate(rec) : 0;
          if (recId && typeof window.t_slideMoveWithoutAnimation === 'function') window.t_slideMoveWithoutAnimation(recId, false, {}, current);
          if (recId && typeof window.t_slds_updateSlider === 'function') window.t_slds_updateSlider(recId);
        } catch (e) {}

        var after = getSliderState(wrap);
        if (!after || after === before || after.indexOf('none') !== -1) {
          var item = rec.querySelector('.t-slds__container .t-slds__item');
          var container = rec.querySelector('.t-slds__container');
          var width = (item && item.offsetWidth) || (container && container.offsetWidth) || 0;
          if (width) wrap.style.transform = 'translateX(-' + (width * next) + 'px)';
        }

        setActiveSlide(rec, next);
        setLoadedImages(rec, next);
        syncSliderArrows(rec, next, total, cycle);
        try { rec.dispatchEvent(new Event('updateSlider', { bubbles: true })); } catch (e) {}
        post();
        return true;
      }

      function bindTildaSliderFallback(root) {
        var mains = (root || document).querySelectorAll('.t-slds__main');
        for (var i = 0; i < mains.length; i++) setupTildaSliderMain(mains[i]);
      }

      function setupTildaSliderMain(main) {
        if (!main || main.getAttribute('data-lovable-tilda-slider-fallback') === '1') return;
        main.setAttribute('data-lovable-tilda-slider-fallback', '1');
        var sx = 0;
        var sy = 0;
        var tracking = false;
        var horizontal = false;

        function start(x, y) {
          sx = x;
          sy = y;
          tracking = true;
          horizontal = false;
        }

        function move(ev, x, y) {
          if (!tracking) return;
          var dx = x - sx;
          var dy = y - sy;
          if (!horizontal && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
            horizontal = Math.abs(dx) > Math.abs(dy) + 6;
          }
          if (horizontal && ev.cancelable) ev.preventDefault();
        }

        function end(x, y, target) {
          if (!tracking) return;
          var dx = x - sx;
          var dy = y - sy;
          tracking = false;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            moveTildaSlider(target || main, dx < 0 ? 'right' : 'left');
          }
        }

        main.addEventListener('touchstart', function(ev) {
          if (ev.touches && ev.touches[0]) start(ev.touches[0].clientX, ev.touches[0].clientY);
        }, { passive: true });
        main.addEventListener('touchmove', function(ev) {
          if (ev.touches && ev.touches[0]) move(ev, ev.touches[0].clientX, ev.touches[0].clientY);
        }, { passive: false });
        main.addEventListener('touchend', function(ev) {
          var t = (ev.changedTouches && ev.changedTouches[0]) || null;
          end(t ? t.clientX : sx, t ? t.clientY : sy, ev.target);
        }, { passive: true });
        main.addEventListener('mousedown', function(ev) {
          if (ev.button !== 0) return;
          start(ev.clientX, ev.clientY);
        }, true);
        main.addEventListener('mousemove', function(ev) {
          move(ev, ev.clientX, ev.clientY);
        }, true);
        main.addEventListener('mouseup', function(ev) {
          end(ev.clientX, ev.clientY, ev.target);
        }, true);
        main.addEventListener('wheel', function(ev) {
          var dx = ev.deltaX || 0;
          var dy = ev.deltaY || 0;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 20) {
            if (ev.cancelable) ev.preventDefault();
            moveTildaSlider(ev.target, dx > 0 ? 'right' : 'left');
          }
        }, { passive: false });
      }

      document.addEventListener('click', function(ev) {
        var arrow = closestMatch(ev.target, '.t-slds__arrow_wrapper[data-slide-direction]');
        if (!arrow) return;
        var wrap = getSliderWrapper(arrow);
        var before = getSliderState(wrap);
        timers.push(setTimeout(function() {
          if (before && before === getSliderState(wrap)) {
            moveTildaSlider(arrow, arrow.getAttribute('data-slide-direction') === 'left' ? 'left' : 'right');
          }
        }, 0));
      }, true);

      bindTildaSliderFallback(document);
      if (typeof MutationObserver !== 'undefined') {
        var sliderFallbackObserver = new MutationObserver(function() { bindTildaSliderFallback(document); });
        sliderFallbackObserver.observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener('beforeunload', function() { sliderFallbackObserver.disconnect(); });
      }
    }
  } catch (e) {}


  // ---- Element.prototype.scrollIntoView intercept with fallback ----
  try {
    var nativeScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(arg) {
      try {
        if (this && this.getBoundingClientRect && this.ownerDocument === document) {
          var rect = this.getBoundingClientRect();
          var top = rect.top
            + (window.pageYOffset || document.documentElement.scrollTop || 0);
          parent.postMessage({
            type: 'iframe-scroll-to-element',
            targetOffsetTop: top,
            targetHeight: rect.height,
            block: (arg && typeof arg === 'object' && arg.block) ? arg.block : 'start'
          }, '*');
          return;
        }
      } catch (e) {}
      return nativeScrollIntoView.apply(this, arguments);
    };
  } catch (e) {}
})();
<\/script>`;

/**
 * Wrap or augment admin HTML with the bridge script. Note: we deliberately do
 * NOT inject `<base target="_blank">` — link target handling is done inside the
 * bridge script per-link to preserve in-page anchors.
 */
export function buildSrcdoc(html: string): string {
  // Idempotent — already processed
  if (html.includes(BRIDGE_MARKER)) return html;

  // Full HTML document with closing body tag
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${BRIDGE_SCRIPT}\n</body>`);
  }

  // Fragment / malformed — wrap
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }</style>
</head>
<body>
${html}
${BRIDGE_SCRIPT}
</body>
</html>`;
}

interface HtmlIframePreviewProps {
  html: string;
  /** Placeholder text when html is empty */
  emptyText?: string;
  /** Minimum iframe height in px */
  minHeight?: number;
  /**
   * Optional dynamic-slot manifest. When present, posted to the iframe on load
   * and whenever the reference changes; the bridge (v8) rewrites labels /
   * visibility on elements with `data-lovable-slot`. Backward-compatible: HTML
   * without slot markers is unaffected.
   */
  slotManifest?: import("@/lib/siteSlotManifest").SiteSlotManifest | null;
  /** Owning site_page.id — echoed to iframe as manifest provenance. */
  pageId?: string | null;
  /** Owning block id (site_block.id) — echoed for click validation. */
  blockId?: string | null;
}


/** Resolve parent page header offset for accurate anchor scroll. */
function resolveHeaderOffset(): number {
  try {
    const tagged = document.querySelector('[data-site-header]') as HTMLElement | null;
    if (tagged) return tagged.getBoundingClientRect().height;
    const hdr = document.querySelector('header') as HTMLElement | null;
    if (hdr) return hdr.getBoundingClientRect().height;
  } catch {}
  return 0;
}

function isRootScrollContainer(element: Element | null): boolean {
  if (!element) return true;
  return element === document.scrollingElement || element === document.documentElement || element === document.body;
}

function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    if (canScrollY) return node;
    node = node.parentElement;
  }
  const doc = document.scrollingElement as HTMLElement | null;
  return doc && doc.scrollHeight > doc.clientHeight + 1 ? doc : null;
}

export function HtmlIframePreview({
  html,
  emptyText = "Вставьте HTML-код",
  minHeight = 100,
  slotManifest,
  pageId = null,
  blockId = null,
}: HtmlIframePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);

  const postSlotManifest = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || !slotManifest) return;
    try {
      iframe.contentWindow.postMessage(
        {
          type: "lovable-slot-manifest",
          manifest: slotManifest,
          page_id: pageId || undefined,
          block_id: blockId || undefined,
        },
        "*",
      );
    } catch {}
  };


  const postParentViewport = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    try {
      const rect = iframe.getBoundingClientRect();
      const scrollContainer = findScrollContainer(iframe);
      const rootScroll = isRootScrollContainer(scrollContainer);
      const containerRect = rootScroll ? null : scrollContainer?.getBoundingClientRect();
      const parentHeaderOffset = rootScroll ? resolveHeaderOffset() : 0;
      const viewportTop = rootScroll ? parentHeaderOffset : (containerRect?.top ?? 0);
      const viewportLeft = rootScroll ? 0 : (containerRect?.left ?? 0);
      const viewportBottom = rootScroll
        ? (window.innerHeight || document.documentElement.clientHeight || 800)
        : (containerRect?.bottom ?? (window.innerHeight || document.documentElement.clientHeight || 800));
      const viewportRight = rootScroll
        ? (window.innerWidth || document.documentElement.clientWidth || 1024)
        : (containerRect?.right ?? (window.innerWidth || document.documentElement.clientWidth || 1024));
      const visibleTop = Math.max(0, viewportTop - rect.top);
      const visibleBottom = Math.min(rect.height, viewportBottom - rect.top);
      const visibleLeft = Math.max(0, viewportLeft - rect.left);
      const visibleRight = Math.min(rect.width, viewportRight - rect.left);
      const visibleHeight = Math.max(320, visibleBottom - visibleTop);
      const visibleWidth = Math.max(320, visibleRight - visibleLeft);
      iframe.contentWindow.postMessage(
        {
          type: 'iframe-parent-viewport',
          top: visibleTop,
          left: visibleLeft,
          height: visibleHeight,
          width: visibleWidth,
        },
        '*',
      );
    } catch {}
  };

  useEffect(() => {
    if (!html.trim()) setHeight(minHeight);
  }, [html, minHeight]);

  useEffect(() => {
    setHeight((prev) => Math.max(minHeight, prev));
  }, [minHeight]);

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      // Strict source check — origin is opaque for srcdoc, do not rely on it.
      if (!iframeRef.current) return;
      if (e.source !== iframeRef.current.contentWindow) return;

      const data: any = e.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'iframe-resize') {
        const raw = data.height;
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return;
        if (raw > MAX_IFRAME_HEIGHT) {
          // eslint-disable-next-line no-console
          console.warn('[HtmlIframePreview] height clamped', { raw: Math.ceil(raw), max: MAX_IFRAME_HEIGHT });
        }
        const clamped = Math.max(minHeight, Math.min(Math.ceil(raw), MAX_IFRAME_HEIGHT));
        setHeight((prev) => (prev === clamped ? prev : clamped));
        postParentViewport();
        return;
      }

      if (data.type === 'iframe-anchor' || data.type === 'iframe-scroll-to-element') {
        const targetOffsetTop = typeof data.targetOffsetTop === 'number' && Number.isFinite(data.targetOffsetTop)
          ? data.targetOffsetTop
          : 0;
        const targetHeight = typeof data.targetHeight === 'number' && Number.isFinite(data.targetHeight)
          ? data.targetHeight
          : 0;
        try {
          const iframe = iframeRef.current;
          const rect = iframe.getBoundingClientRect();
          const scrollContainer = findScrollContainer(iframe);
          const rootScroll = isRootScrollContainer(scrollContainer);
          const containerRect = rootScroll ? null : scrollContainer?.getBoundingClientRect();
          const containerScrollTop = rootScroll ? (window.pageYOffset || document.documentElement.scrollTop || 0) : (scrollContainer?.scrollTop ?? 0);
          const headerOffset = rootScroll ? resolveHeaderOffset() : 0;
          const viewportHeight = rootScroll
            ? window.innerHeight
            : (containerRect?.height ?? window.innerHeight);
          const availableHeight = Math.max(0, viewportHeight - headerOffset);
          // Center the section inside the visible viewport when it fits;
          // otherwise align it just below the sticky header with a small gap.
          const centeringOffset = targetHeight > 0 && targetHeight < availableHeight
            ? Math.max(0, (availableHeight - targetHeight) / 2)
            : 12;
          const top = Math.max(
            0,
            rect.top - (containerRect?.top ?? 0) + containerScrollTop
              + targetOffsetTop
              - headerOffset
              - centeringOffset
          );
          if (scrollContainer) scrollContainer.scrollTo({ top, behavior: 'smooth' });
          else window.scrollTo({ top, behavior: 'smooth' });
        } catch {}
        return;
      }

      if (data.type === 'iframe-scroll-command') {
        const iframe = iframeRef.current;
        const scrollContainer = findScrollContainer(iframe);
        const rootScroll = isRootScrollContainer(scrollContainer);
        const rawTop = typeof data.top === 'number' && Number.isFinite(data.top) ? data.top : 0;
        const rawLeft = typeof data.left === 'number' && Number.isFinite(data.left) ? data.left : 0;
        const behavior = data.behavior === 'smooth' ? 'smooth' : 'auto';
        if (data.mode === 'by') {
          if (rootScroll) window.scrollBy({ top: rawTop, left: rawLeft, behavior });
          else scrollContainer?.scrollBy({ top: rawTop, left: rawLeft, behavior });
        } else {
          const rect = iframe.getBoundingClientRect();
          const containerRect = rootScroll ? null : scrollContainer?.getBoundingClientRect();
          const currentTop = rootScroll ? (window.pageYOffset || document.documentElement.scrollTop || 0) : (scrollContainer?.scrollTop ?? 0);
          const currentLeft = rootScroll ? (window.pageXOffset || document.documentElement.scrollLeft || 0) : (scrollContainer?.scrollLeft ?? 0);
          const targetTop = Math.max(0, rect.top - (containerRect?.top ?? 0) + currentTop + rawTop - (rootScroll ? resolveHeaderOffset() : 0));
          const targetLeft = Math.max(0, rect.left - (containerRect?.left ?? 0) + currentLeft + rawLeft);
          if (rootScroll) window.scrollTo({ top: targetTop, left: targetLeft, behavior });
          else scrollContainer?.scrollTo({ top: targetTop, left: targetLeft, behavior });
        }
        requestAnimationFrame(postParentViewport);
        return;
      }

      if (data.type === 'iframe-wheel') {
        const deltaY = typeof data.deltaY === 'number' && Number.isFinite(data.deltaY) ? data.deltaY : 0;
        const deltaX = typeof data.deltaX === 'number' && Number.isFinite(data.deltaX) ? data.deltaX : 0;
        const scrollContainer = findScrollContainer(iframeRef.current);
        if (scrollContainer && (deltaY || deltaX)) {
          if (isRootScrollContainer(scrollContainer)) window.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
          else scrollContainer.scrollBy({ top: deltaY, left: deltaX, behavior: 'auto' });
          postParentViewport();
        }
        return;
      }

      if (data.type === 'iframe-open-url') {
        const url = typeof data.url === 'string' ? data.url : '';
        // Strict whitelist — never open javascript:, data:, blob:, about:srcdoc, etc.
        if (!/^(https?:\/\/|mailto:|tel:|sms:)/i.test(url)) return;
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
        return;
      }


      if (data.type === 'site-action') {
        // Forward to host via CustomEvent. Host validates action/payload before acting.
        const action = typeof data.action === 'string' ? data.action : '';
        const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
        if (!action) return;
        try {
          window.dispatchEvent(new CustomEvent('lovable:site-action', { detail: { action, payload } }));
        } catch {}
        return;
      }
    }


    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [minHeight]);

  useEffect(() => {
    postParentViewport();
    const onViewportChange = () => postParentViewport();
    const scrollContainer = findScrollContainer(iframeRef.current);
    if (scrollContainer && !isRootScrollContainer(scrollContainer)) {
      scrollContainer.addEventListener('scroll', onViewportChange, { passive: true });
    }
    window.addEventListener('scroll', onViewportChange, { passive: true });
    window.addEventListener('resize', onViewportChange);
    return () => {
      if (scrollContainer && !isRootScrollContainer(scrollContainer)) {
        scrollContainer.removeEventListener('scroll', onViewportChange);
      }
      window.removeEventListener('scroll', onViewportChange);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [height, html]);

  // Post slot manifest whenever it changes (and once after iframe load via onLoad).
  useEffect(() => {
    if (!slotManifest) return;
    postSlotManifest();
  }, [slotManifest]);

  if (!html.trim()) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Code className="h-8 w-8 mr-2 opacity-50" />
        <span>{emptyText}</span>
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={buildSrcdoc(html)}
      sandbox={SANDBOX_POLICY}
      scrolling="no"
      onLoad={() => { postParentViewport(); postSlotManifest(); }}
      style={{ width: "100%", height: `${height}px`, border: "none", overflow: "hidden" }}
      title="HTML Preview"
    />
  );

}

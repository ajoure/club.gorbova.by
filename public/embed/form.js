/**
 * Site Builder — Embed Form Loader (canonical, reuse-only).
 *
 * Usage:
 *   <div data-gorbova-form data-page-id="UUID" data-block-id="UUID"></div>
 *   <script src="https://gorbova.by/embed/form.js" async></script>
 *
 * Опционально: data-mode="popup" — показать форму в popup при клике на триггер.
 *
 * Внутри: iframe -> /embed/form/:pageId/:blockId -> canonical FormSection -> site-form-submit.
 * Никакой собственной формы / submit-логики — только тонкий wrapper.
 */
(function () {
  if (window.__gorbovaEmbedLoaded) return;
  window.__gorbovaEmbedLoaded = true;

  var ORIGIN = (function () {
    try {
      var s = document.currentScript || document.querySelector('script[src*="embed/form.js"]');
      if (!s) return window.location.origin;
      var u = new URL(s.src, window.location.href);
      return u.origin;
    } catch (e) { return window.location.origin; }
  })();

  function embedUrl(pageId, blockId) {
    var origin = encodeURIComponent(window.location.origin);
    return ORIGIN + '/embed/form/' + encodeURIComponent(pageId) + '/' + encodeURIComponent(blockId) + '?origin=' + origin;
  }

  function makeIframe(pageId, blockId) {
    var iframe = document.createElement('iframe');
    iframe.src = embedUrl(pageId, blockId);
    iframe.style.width = '100%';
    iframe.style.minHeight = '480px';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Форма');
    return iframe;
  }

  function inlineMount(el) {
    var pageId = el.getAttribute('data-page-id');
    var blockId = el.getAttribute('data-block-id');
    if (!pageId || !blockId) {
      console.warn('[gorbova-embed] missing data-page-id or data-block-id', el);
      return;
    }
    el.innerHTML = '';
    el.appendChild(makeIframe(pageId, blockId));
  }

  function popupMount(el) {
    var pageId = el.getAttribute('data-page-id');
    var blockId = el.getAttribute('data-block-id');
    if (!pageId || !blockId) return;
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;';
      var modal = document.createElement('div');
      modal.style.cssText = 'position:relative;background:#fff;border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
      var close = document.createElement('button');
      close.innerHTML = '×';
      close.setAttribute('aria-label', 'Закрыть');
      close.style.cssText = 'position:absolute;top:8px;right:12px;background:transparent;border:0;font-size:28px;line-height:1;cursor:pointer;color:#333;z-index:1;';
      close.addEventListener('click', function () { document.body.removeChild(overlay); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) document.body.removeChild(overlay); });
      modal.appendChild(close);
      modal.appendChild(makeIframe(pageId, blockId));
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    });
  }

  function init() {
    var nodes = document.querySelectorAll('[data-gorbova-form]');
    nodes.forEach(function (el) {
      if (el.__gorbovaMounted) return;
      el.__gorbovaMounted = true;
      var mode = el.getAttribute('data-mode') || 'inline';
      if (mode === 'popup') popupMount(el);
      else inlineMount(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

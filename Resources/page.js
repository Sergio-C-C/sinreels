/*
 * SinReelsPage — se inyecta en documentStart, en un "content world" aislado
 * (la página no ve nuestras variables ni puede quitarnos los listeners de JS).
 *   Capa 2: <style> con hideSelectors (display:none).
 *   Capa 3: MutationObserver + sondeo de location.href para navegación SPA
 *           (pushState no pasa por WKNavigationDelegate), guardia de clics,
 *           y ocultado dinámico (hideClosest / hideByText).
 * Requiere que SinReelsCore (core.js) se haya evaluado antes.
 */
(function (root) {
  'use strict';

  var Core = root.SinReelsCore;
  var STYLE_ID = 'sinreels-style';
  var HIDDEN_ATTR = 'data-sinreels-hidden';

  function post(type, data) {
    try {
      var msg = { type: type };
      if (data) for (var k in data) msg[k] = data[k];
      root.webkit.messageHandlers.sinreels.postMessage(msg);
    } catch (e) { /* sin puente nativo (p. ej. tests) */ }
  }

  function queryAll(sel) {
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    catch (e) { return []; } // selector inválido: se ignora
  }

  function buildCSS(platform) {
    return (platform.hideSelectors || []).map(function (s) {
      return s + ' { display: none !important; }';
    }).join('\n');
  }

  function ensureStyle(platform) {
    if (document.getElementById(STYLE_ID)) return;
    var parent = document.head || document.documentElement;
    if (!parent) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = buildCSS(platform);
    parent.appendChild(st);
  }

  var hiddenCount = 0;
  function hideEl(el) {
    if (!el || !el.style || el.getAttribute(HIDDEN_ATTR) === '1') return;
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute(HIDDEN_ATTR, '1');
    hiddenCount++;
  }

  function hideDynamic(platform) {
    (platform.hideClosest || []).forEach(function (r) {
      queryAll(r.match).forEach(function (el) {
        hideEl(r.closest ? (el.closest(r.closest) || null) : el);
      });
    });
    (platform.hideByText || []).forEach(function (r) {
      var re;
      try { re = new RegExp(r.text, 'i'); } catch (e) { return; }
      queryAll(r.selector).forEach(function (el) {
        if (re.test((el.textContent || '').trim())) {
          hideEl(r.closest ? (el.closest(r.closest) || el) : el);
        }
      });
    });
  }

  // Protección contra bucles: si bloqueamos >3 veces en 3 s, vamos al fallback.
  var recentBlocks = [];
  function applyDecision(d, href, via) {
    post('blocked', { url: href, action: d.action, to: d.to || null, rule: d.rule || null, via: via });
    if (d.action === 'redirect') {
      root.location.replace(d.to);
      return;
    }
    if (d.action === 'block') {
      var now = Date.now();
      recentBlocks = recentBlocks.filter(function (t) { return now - t < 3000; });
      recentBlocks.push(now);
      if (root.history.length > 1 && recentBlocks.length <= 3) root.history.back();
      else root.location.replace(d.to);
    }
  }

  function start(platform) {
    if (root.__sinreelsStarted) return;
    root.__sinreelsStarted = true;

    var lastHref = null;
    function checkLocation() {
      var href = root.location.href;
      if (href === lastHref) return;
      lastHref = href;
      var d = Core.decide(platform, href);
      if (d.action === 'allow' || d.action === 'external') return;
      applyDecision(d, href, 'spa');
    }

    // Guardia de clics (fase de captura: corre antes que los handlers de la página).
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var a = t && t.closest ? t.closest('a[href]') : null;
      if (!a) return;
      var d = Core.decide(platform, a.href);
      if (d.action !== 'redirect' && d.action !== 'block') return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      post('blocked', { url: a.href, action: d.action, to: d.to || null, rule: d.rule || null, via: 'click' });
      if (d.action === 'redirect') root.location.assign(d.to);
    }, true);

    var scheduled = false;
    var lastReported = 0;
    function sweep() {
      scheduled = false;
      checkLocation();
      ensureStyle(platform);
      hideDynamic(platform);
      if (hiddenCount !== lastReported) {
        lastReported = hiddenCount;
        post('hidden', { count: hiddenCount, url: root.location.href });
      }
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      // setTimeout y no requestAnimationFrame: rAF se pausa cuando la pestaña no está visible.
      root.setTimeout(sweep, 50);
    }

    ensureStyle(platform);
    checkLocation();

    function onReady() {
      new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
      schedule();
      post('ready', { url: root.location.href, ua: root.navigator.userAgent });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true });
    else onReady();

    root.addEventListener('popstate', schedule);
    root.setInterval(checkLocation, 500);
  }

  // Volcado para parchear selectores sin Mac: describe elementos sospechosos
  // (enlaces a reels/shorts, etiquetas ytm-*shorts*/reel*) con su cadena de ancestros.
  function describe(el) {
    var parts = [];
    var n = el;
    for (var depth = 0; n && n.nodeType === 1 && depth < 7; depth++, n = n.parentElement) {
      var s = n.tagName.toLowerCase();
      var role = n.getAttribute('role');
      var aria = n.getAttribute('aria-label');
      var href = n.getAttribute('href');
      if (role) s += '[role=' + role + ']';
      if (aria) s += '[aria-label="' + aria.slice(0, 40) + '"]';
      if (href) s += '[href="' + href.slice(0, 60) + '"]';
      parts.push(s);
    }
    var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    return (visible ? 'VISIBLE  ' : 'oculto   ') + parts.join(' < ');
  }

  function dump() {
    var sel = [
      'a[href*="/reel"]', 'a[href*="/shorts"]', 'a[href*="/explore"]',
      '[aria-label*="Reel" i]', '[aria-label*="Short" i]',
      'ytm-reel-shelf-renderer', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
      'ytm-pivot-bar-item-renderer', 'ytm-chip-cloud-chip-renderer'
    ].join(',');
    var els = queryAll(sel).slice(0, 60);
    var lines = ['URL: ' + root.location.href, 'UA: ' + root.navigator.userAgent,
      'ocultados por JS: ' + hiddenCount, 'elementos: ' + els.length];
    els.forEach(function (el) { lines.push(describe(el)); });
    return lines.join('\n');
  }

  root.SinReelsPage = { start: start, dump: dump, buildCSS: buildCSS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

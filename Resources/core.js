/*
 * SinReelsCore — lógica PURA de decisión de URLs (sin DOM).
 * Se usa en tres sitios con el mismo código:
 *   1) Swift (JavaScriptCore) para WKNavigationDelegate (capa 1),
 *   2) la página (WKUserScript) para navegación SPA y clics (capa 3),
 *   3) Node para tests locales (tools/check.mjs).
 * No uses APIs del navegador aquí (ni URL, ni document): JavaScriptCore no las tiene.
 */
(function (root) {
  'use strict';

  var URL_RE = /^([a-z][a-z0-9+.-]*):(?:\/\/([^\/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i;
  var PASSTHROUGH = ['about', 'blob', 'data', 'javascript'];
  var cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function parseURL(s) {
    var m = URL_RE.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var authority = m[2] || '';
    var host = authority.replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
    return {
      scheme: m[1].toLowerCase(),
      host: host,
      path: m[3] || '/',
      query: m[4] || '',
      hash: m[5] || ''
    };
  }

  function toRegExps(list, flags) {
    return (list || []).map(function (src) { return new RegExp(src, flags); });
  }

  function compile(platform) {
    if (cache && cache.has(platform)) return cache.get(platform);
    var c = {
      hosts: toRegExps(platform.hosts, 'i'),
      ruleHosts: platform.ruleHosts ? toRegExps(platform.ruleHosts, 'i') : null,
      rules: (platform.pathRules || []).map(function (r) {
        return { re: new RegExp(r.pattern), action: r.action, to: r.to, pattern: r.pattern };
      })
    };
    if (cache) cache.set(platform, c);
    return c;
  }

  function anyMatch(res, s) {
    for (var i = 0; i < res.length; i++) if (res[i].test(s)) return true;
    return false;
  }

  function expand(tpl, m) {
    return String(tpl).replace(/\$(\d)/g, function (_, i) { return m[+i] || ''; });
  }

  /**
   * decide(platform, url) -> { action: 'allow'|'redirect'|'block'|'external', to?, rule? }
   * 'to' siempre es una URL absoluta.
   */
  function decide(platform, url) {
    var u = parseURL(url);
    if (!u) return { action: 'allow', reason: 'unparsed' };
    if (PASSTHROUGH.indexOf(u.scheme) >= 0) return { action: 'allow' };
    if (u.scheme !== 'http' && u.scheme !== 'https') return { action: 'external' };

    var c = compile(platform);
    if (!anyMatch(c.hosts, u.host)) return { action: 'external' };
    if (c.ruleHosts && !anyMatch(c.ruleHosts, u.host)) return { action: 'allow' };

    var origin = u.scheme + '://' + u.host;
    for (var i = 0; i < c.rules.length; i++) {
      var rule = c.rules[i];
      var m = rule.re.exec(u.path);
      if (!m) continue;
      if (rule.action === 'allow') return { action: 'allow', rule: rule.pattern };
      var target = rule.to != null ? expand(rule.to, m) : '/';
      var abs = /^https?:\/\//i.test(target) ? target : origin + target;
      if (abs === origin + u.path + u.query) return { action: 'allow', rule: rule.pattern, reason: 'self' };
      return {
        action: rule.action === 'redirect' ? 'redirect' : 'block',
        to: abs,
        rule: rule.pattern
      };
    }
    return { action: 'allow' };
  }

  var api = { decide: decide, parseURL: parseURL, version: 1 };
  root.SinReelsCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

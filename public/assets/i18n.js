// Two languages (Indonesian / English). Indonesian stays in the HTML; elements carry their English text in data-en
// (and data-en-placeholder / data-en-title). Choice: saved choice > browser language > visitor country (Cloudflare) > English.
(function () {
  var KEY = 'ghg_lang';
  function stored() { try { var v = localStorage.getItem(KEY); return v === 'id' || v === 'en' ? v : ''; } catch (e) { return ''; } }
  function browserLang() {
    var ls = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''];
    for (var i = 0; i < ls.length; i++) {
      var l = String(ls[i] || '').toLowerCase();
      if (l.indexOf('id') === 0 || l.indexOf('in') === 0 || l.indexOf('ms') === 0) return 'id';
    }
    return '';
  }
  // ?lang=en / ?lang=id in a shared link wins and is remembered
  try {
    var q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'id') localStorage.setItem(KEY, q);
  } catch (e) { /* ignore */ }
  var lang = stored() || browserLang() || 'en';
  window.GHG_LANG = lang;
  window.T = function (id, en) { return lang === 'en' ? en : id; };
  function apply(l) {
    lang = l;
    window.GHG_LANG = l;
    document.documentElement.lang = l;
    var els = document.querySelectorAll('[data-en]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__gid === undefined) el.__gid = el.innerHTML;
      el.innerHTML = l === 'en' ? el.getAttribute('data-en') : el.__gid;
    }
    ['placeholder', 'title', 'aria-label', 'content', 'value'].forEach(function (a) {
      var list = document.querySelectorAll('[data-en-' + a + ']');
      for (var j = 0; j < list.length; j++) {
        var e = list[j], k = '__g' + a;
        if (e[k] === undefined) e[k] = e.getAttribute(a) || '';
        e.setAttribute(a, l === 'en' ? e.getAttribute('data-en-' + a) : e[k]);
      }
    });
    var bs = document.querySelectorAll('[data-lang-toggle]');
    for (var b = 0; b < bs.length; b++) {
      bs[b].textContent = l === 'en' ? '🌐 ID' : '🌐 EN';
      bs[b].setAttribute('title', l === 'en' ? 'Tampilkan dalam Bahasa Indonesia' : 'Show in English');
    }
    try { document.dispatchEvent(new CustomEvent('ghg:lang', { detail: l })); } catch (e) { /* old browser */ }
  }
  window.GHG_SETLANG = function (l) { try { localStorage.setItem(KEY, l); } catch (e) { /* private mode */ } apply(l); };
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-lang-toggle]') : null;
    if (!t) return;
    e.preventDefault();
    window.GHG_SETLANG(lang === 'en' ? 'id' : 'en');
  });
  function start() {
    apply(lang);
    // no saved choice and no Indonesian browser: Indonesian visitors (by country) still get Indonesian
    if (!stored() && !browserLang()) {
      fetch('/api/geo').then(function (r) { return r.json(); }).then(function (g) {
        if (g && g.country === 'ID' && !stored() && lang !== 'id') apply('id');
      }).catch(function () { /* stay English */ });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

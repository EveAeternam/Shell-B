/* Shell:B Studio inspector — injected into previewed pages. Talks to the Studio canvas via postMessage. */
(function () {
  if (window.__shellbInspector) return;
  window.__shellbInspector = true;
  var parentWin = window.parent;
  var on = false, hoverBox, pickBox, label, picked = null, lastSent = 0;

  function post(msg) { try { parentWin.postMessage(Object.assign({ source: 'shellb-preview' }, msg), '*'); } catch (e) {} }

  function box(color, fill) {
    var d = document.createElement('div');
    d.setAttribute('data-shellb-ui', '');
    d.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid ' + color +
      ';background:' + fill + ';border-radius:3px;display:none;box-sizing:border-box;transition:all .06s ease-out';
    document.documentElement.appendChild(d);
    return d;
  }

  function ensureUi() {
    if (hoverBox) return;
    hoverBox = box('#da7756', 'rgba(218,119,86,.08)');
    pickBox = box('#c96442', 'rgba(201,100,66,.14)');
    label = document.createElement('div');
    label.setAttribute('data-shellb-ui', '');
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;font:600 11px/1.2 ui-monospace,monospace;' +
      'background:#c96442;color:#fff;padding:3px 6px;border-radius:4px;display:none;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis';
    document.documentElement.appendChild(label);
  }

  function place(el, b) {
    var r = el.getBoundingClientRect();
    b.style.display = 'block';
    b.style.left = r.left + 'px'; b.style.top = r.top + 'px';
    b.style.width = r.width + 'px'; b.style.height = r.height + 'px';
    return r;
  }

  function describe(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  function selector(el) {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 6) {
      var part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + CSS.escape(el.id)); break; }
      var cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(function (c) { return c && !/[:\[\]]/.test(c); }).slice(0, 2);
      if (cls.length) part += '.' + cls.map(function (c) { return CSS.escape(c); }).join('.');
      var p = el.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = p;
    }
    return parts.join(' > ');
  }

  function target(e) {
    var el = e.target;
    if (!el || el.nodeType !== 1 || el.hasAttribute('data-shellb-ui')) return null;
    if (el === document.documentElement || el === document.body) return null;
    return el;
  }

  function onMove(e) {
    var el = target(e);
    if (!el) { hoverBox.style.display = label.style.display = 'none'; return; }
    var r = place(el, hoverBox);
    label.textContent = describe(el) + '  ' + Math.round(r.width) + '×' + Math.round(r.height);
    label.style.display = 'block';
    label.style.left = Math.max(2, r.left) + 'px';
    label.style.top = (r.top > 22 ? r.top - 20 : r.bottom + 4) + 'px';
  }

  function onClick(e) {
    var el = target(e);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    picked = el;
    var r = place(el, pickBox);
    var html = el.outerHTML;
    if (html.length > 2500) html = html.slice(0, 2500) + '\n<!-- …truncated -->';
    post({
      type: 'picked', selector: selector(el), label: describe(el), html: html,
      text: (el.innerText || '').trim().slice(0, 300),
      rect: { x: r.left, y: r.top, w: r.width, h: r.height }, viewport: { w: innerWidth, h: innerHeight },
    });
  }

  function swallow(e) { if (on && target(e)) { e.preventDefault(); e.stopPropagation(); } }

  function setOn(v) {
    ensureUi();
    on = v;
    document.documentElement.style.cursor = v ? 'crosshair' : '';
    var fn = v ? 'addEventListener' : 'removeEventListener';
    document[fn]('mousemove', onMove, true);
    document[fn]('click', onClick, true);
    ['mousedown', 'mouseup', 'submit', 'pointerdown'].forEach(function (t) { document[fn](t, swallow, true); });
    if (!v) { hoverBox.style.display = label.style.display = 'none'; }
  }

  function clearPick() { picked = null; if (pickBox) pickBox.style.display = 'none'; }

  addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.target !== 'shellb-preview') return;
    if (d.type === 'inspect') setOn(!!d.on);
    if (d.type === 'clear') clearPick();
    if (d.type === 'scroll') window.scrollTo(0, d.y || 0);
    if (d.type === 'scrollBy') window.scrollBy(d.x || 0, d.y || 0);
  });

  addEventListener('scroll', function () {
    if (picked) place(picked, pickBox);
    var now = Date.now();
    if (now - lastSent > 150) { lastSent = now; post({ type: 'scroll', y: window.scrollY }); }
  }, { passive: true });
  addEventListener('resize', function () { if (picked) place(picked, pickBox); });
  addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearPick(); post({ type: 'escape' }); } });
  addEventListener('error', function (e) { post({ type: 'error', message: String(e.message || e), line: e.lineno }); });
  addEventListener('unhandledrejection', function (e) { post({ type: 'error', message: 'Unhandled promise rejection: ' + String(e.reason) }); });
  var ready = function () { post({ type: 'ready', height: document.documentElement.scrollHeight, title: document.title }); };
  if (document.readyState === 'complete') ready(); else addEventListener('load', ready);
})();

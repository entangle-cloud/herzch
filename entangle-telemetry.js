/**
 * Entangle Keyboard Telemetry
 * Drop this script into any page Georg is testing.
 * It injects a diagnostic panel fixed to the bottom of the page.
 */

(function (global) {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────────

  const session = {
    startedAt: new Date().toISOString(),
    browser: null,
    os: null,
    platform: null,
    userAgent: null,
    languages: [],
    keyboardLayoutAPI: null,
    layoutMap: {},
    swapDetected: false,
  };

  const keyEvents = [];
  const listeners = [];

  // ── Detection helpers ───────────────────────────────────────────────────────

  function detectBrowser(ua) {
    if (ua.includes('Edg/'))     return 'Edge '    + (ua.match(/Edg\/([\d.]+)/)    || [])[1];
    if (ua.includes('Chrome/'))  return 'Chrome '  + (ua.match(/Chrome\/([\d.]+)/) || [])[1];
    if (ua.includes('Firefox/')) return 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)|| [])[1];
    if (ua.includes('Safari/') && !ua.includes('Chrome'))
                                 return 'Safari '  + (ua.match(/Version\/([\d.]+)/)|| [])[1];
    return 'Unknown';
  }

  function detectOS(ua, platform) {
    if (platform.includes('Mac'))   return 'macOS';
    if (platform.includes('Win'))   return 'Windows';
    if (platform.includes('Linux')) return 'Linux';
    if (/iPhone|iPad/.test(ua))     return 'iOS';
    if (/Android/.test(ua))         return 'Android';
    return platform || 'Unknown';
  }

  // ── Keyboard Layout API ─────────────────────────────────────────────────────

  async function loadLayoutMap() {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) {
      session.keyboardLayoutAPI = 'not_supported';
      return;
    }
    try {
      const map = await navigator.keyboard.getLayoutMap();
      session.keyboardLayoutAPI = 'supported';
      map.forEach((value, code) => { session.layoutMap[code] = value; });

      const yKey = (map.get('KeyY') || '').toUpperCase();
      const zKey = (map.get('KeyZ') || '').toUpperCase();
      if (yKey === 'Z' || zKey === 'Y') {
        session.swapDetected = true;
      }
    } catch (_) {
      session.keyboardLayoutAPI = 'permission_denied';
    }
  }

  // ── Key event classification ────────────────────────────────────────────────

  function classify(e) {
    if (e.code !== 'KeyY' && e.code !== 'KeyZ') return 'other';
    const expected = e.code === 'KeyY' ? 'Y' : 'Z';
    const actual   = e.key.toUpperCase();
    if (actual === expected)                                        return 'consistent';
    if ((e.code === 'KeyZ' && actual === 'Y') ||
        (e.code === 'KeyY' && actual === 'Z'))                      return 'swap';
    return 'other';
  }

  function recordEvent(e) {
    if (e.type !== 'keydown') return;
    const entry = {
      ts           : new Date().toLocaleTimeString(),
      key          : e.key,
      code         : e.code,
      keyCode      : e.keyCode,
      classification: classify(e),
    };
    if (entry.classification === 'swap') session.swapDetected = true;
    keyEvents.unshift(entry);
    if (keyEvents.length > 50) keyEvents.pop();
    updatePanel();
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  let panel, evtBody, bannerEl, klGrid;
  let collapsed = false;

  const S = {
    panel: `
      position:fixed;bottom:0;left:0;right:0;z-index:999999;
      background:#fff;border-top:1.5px solid #e2e2e2;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px;color:#1a1a1a;box-shadow:0 -4px 24px rgba(0,0,0,.08);
      transition:transform .2s ease;`,
    header: `
      display:flex;align-items:center;justify-content:space-between;
      padding:8px 16px;border-bottom:1px solid #ebebeb;
      background:#fafafa;cursor:pointer;user-select:none;`,
    headerLeft: `display:flex;align-items:center;gap:10px;`,
    dot: (color) => `
      width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;`,
    title: `font-weight:600;font-size:13px;`,
    collapseBtn: `
      background:none;border:1px solid #d4d4d4;border-radius:6px;
      padding:3px 10px;font-size:12px;cursor:pointer;color:#555;`,
    copyBtn: `
      background:none;border:1px solid #d4d4d4;border-radius:6px;
      padding:3px 10px;font-size:12px;cursor:pointer;color:#555;margin-right:6px;`,
    body: `display:flex;gap:0;overflow:hidden;`,
    col: `flex:1;padding:12px 16px;border-right:1px solid #ebebeb;min-width:0;`,
    colLast: `flex:1;padding:12px 16px;min-width:0;`,
    label: `font-size:10px;font-weight:600;color:#888;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;`,
    grid2: `display:grid;grid-template-columns:1fr 1fr;gap:6px;`,
    stat: `background:#f5f5f5;border-radius:6px;padding:6px 10px;`,
    statLabel: `font-size:10px;color:#888;margin-bottom:2px;`,
    statVal: `font-size:12px;font-weight:500;word-break:break-all;`,
    banner: (bg, color) => `
      border-radius:6px;padding:7px 12px;font-size:12px;margin-bottom:10px;
      background:${bg};color:${color};font-weight:500;`,
    evtTable: `width:100%;border-collapse:collapse;font-size:11px;`,
    evtTh: `text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;`,
    evtTd: `padding:4px 6px 4px 0;border-bottom:1px solid #f0f0f0;font-family:monospace;`,
    badge: (bg, color) => `
      display:inline-block;padding:2px 7px;border-radius:4px;
      font-size:10px;font-weight:600;background:${bg};color:${color};`,
    langBadge: `
      display:inline-block;padding:2px 8px;border-radius:4px;
      font-size:11px;background:#f0f0f0;color:#555;margin:2px 3px 2px 0;`,
    klCell: `
      background:#f5f5f5;border-radius:6px;padding:6px 10px;
      display:inline-flex;flex-direction:column;margin:2px;min-width:72px;`,
  };

  function el(tag, style, html) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (html  !== undefined) e.innerHTML = html;
    return e;
  }

  function createPanel() {
    panel = el('div', S.panel);

    // ── Header ─────────────────────────────────────────────────────────────
    const header = el('div', S.header);
    const hLeft  = el('div', S.headerLeft);

    const statusDot = el('span', S.dot('#ccc'));
    const titleEl   = el('span', S.title, '⌨ Entangle Keyboard Telemetry');
    hLeft.append(statusDot, titleEl);

    const hRight = el('div', 'display:flex;align-items:center;gap:6px;');
    const copyBtn = el('button', S.copyBtn, '⎘ Copy report');
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(getReportJSON()).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = '⎘ Copy report'; }, 1500);
      });
    };
    const colBtn = el('button', S.collapseBtn, '▼ Collapse');
    colBtn.onclick = (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      bodyEl.style.display = collapsed ? 'none' : 'flex';
      colBtn.textContent = collapsed ? '▲ Expand' : '▼ Collapse';
    };
    hRight.append(copyBtn, colBtn);
    header.append(hLeft, hRight);
    panel.appendChild(header);

    // ── Body ────────────────────────────────────────────────────────────────
    const bodyEl = el('div', S.body);
    bodyEl.style.maxHeight = '200px';

    // Col 1 — system info
    const col1 = el('div', S.col);
    col1.innerHTML = `<div style="${S.label}">System</div>`;
    const g = el('div', S.grid2);

    const statBrowser = el('div', S.stat);
    statBrowser.innerHTML = `<div style="${S.statLabel}">Browser</div><div style="${S.statVal}" id="et-browser">—</div>`;
    const statOS = el('div', S.stat);
    statOS.innerHTML = `<div style="${S.statLabel}">OS</div><div style="${S.statVal}" id="et-os">—</div>`;
    const statLAPI = el('div', S.stat);
    statLAPI.innerHTML = `<div style="${S.statLabel}">Layout API</div><div style="${S.statVal}" id="et-lapi">—</div>`;
    const statLangs = el('div', S.stat);
    statLangs.innerHTML = `<div style="${S.statLabel}">Languages</div><div style="${S.statVal}" id="et-langs">—</div>`;

    g.append(statBrowser, statOS, statLAPI, statLangs);
    col1.appendChild(g);
    bodyEl.appendChild(col1);

    // Col 2 — layout map
    const col2 = el('div', S.col);
    col2.innerHTML = `<div style="${S.label}">Keyboard layout map</div>`;
    bannerEl = el('div', '');
    klGrid   = el('div', 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;');
    col2.append(bannerEl, klGrid);
    bodyEl.appendChild(col2);

    // Col 3 — live key events
    const col3 = el('div', S.colLast);
    col3.innerHTML = `<div style="${S.label}">Live key events — click in the chatbot and type Y or Z</div>`;
    const tableWrap = el('div', 'overflow-y:auto;max-height:140px;');
    const table = el('table', S.evtTable);
    table.innerHTML = `<thead><tr>
      <th style="${S.evtTh}">Time</th>
      <th style="${S.evtTh}">event.key</th>
      <th style="${S.evtTh}">event.code</th>
      <th style="${S.evtTh}">keyCode</th>
      <th style="${S.evtTh}">Verdict</th>
    </tr></thead>`;
    evtBody = el('tbody', '');
    evtBody.innerHTML = `<tr><td colspan="5" style="color:#aaa;padding:6px 0;font-size:11px;">No keypresses yet…</td></tr>`;
    table.appendChild(evtBody);
    tableWrap.appendChild(table);
    col3.appendChild(tableWrap);
    bodyEl.appendChild(col3);

    panel.appendChild(bodyEl);
    document.body.appendChild(panel);

    // store refs
    panel._statusDot = statusDot;
    panel._bodyEl    = bodyEl;

    populateStatic();
  }

  function populateStatic() {
    const b = document.getElementById('et-browser');
    const o = document.getElementById('et-os');
    const l = document.getElementById('et-lapi');
    const g = document.getElementById('et-langs');
    if (b) b.textContent = session.browser;
    if (o) o.textContent = session.os;
    if (l) l.textContent = session.keyboardLayoutAPI;
    if (g) g.textContent = session.languages.slice(0, 3).join(', ');
    renderLayoutMap();
    updateBanner();
  }

  function renderLayoutMap() {
    if (!klGrid) return;
    klGrid.innerHTML = '';
    const notable = ['KeyY','KeyZ','KeyQ','KeyW','KeyA','KeyS','KeyX','KeyC'];
    notable.forEach(code => {
      const val = session.layoutMap[code];
      if (!val) return;
      const isSwap = (code === 'KeyZ' && val.toUpperCase() === 'Y') ||
                     (code === 'KeyY' && val.toUpperCase() === 'Z');
      const cell = el('div', S.klCell);
      cell.innerHTML =
        `<span style="font-size:9px;color:#888;margin-bottom:2px;">${code}</span>` +
        `<span style="font-size:18px;font-weight:600;color:${isSwap ? '#c0392b' : '#1a1a1a'};">${val}${isSwap ? ' ⚠' : ''}</span>`;
      klGrid.appendChild(cell);
    });

    if (!klGrid.children.length) {
      klGrid.innerHTML = `<span style="font-size:12px;color:#aaa;">Not available in this browser</span>`;
    }
  }

  function updateBanner() {
    if (!bannerEl) return;
    if (session.swapDetected) {
      bannerEl.style.cssText = S.banner('#fff3cd', '#856404');
      bannerEl.innerHTML = '⚠ Y/Z swap detected — widget is reading physical key position instead of logical character.';
    } else if (session.keyboardLayoutAPI === 'supported') {
      bannerEl.style.cssText = S.banner('#d1f2d1', '#155724');
      bannerEl.innerHTML = '✓ No swap detected via Layout API.';
    } else {
      bannerEl.style.cssText = S.banner('#f0f0f0', '#555');
      bannerEl.innerHTML = 'Type Y or Z in the chatbot to detect swap via live events.';
    }
    if (panel && panel._statusDot) {
      panel._statusDot.style.background = session.swapDetected ? '#e74c3c' : '#27ae60';
    }
  }

  function updatePanel() {
    if (!evtBody) return;
    if (keyEvents.length === 1) evtBody.innerHTML = '';

    const e = keyEvents[0];
    const isSwap = e.classification === 'swap';
    const isYZ   = e.classification !== 'other';

    let badge = '';
    if (isSwap)       badge = `<span style="${S.badge('#fff3cd','#856404')}">Y/Z swap</span>`;
    else if (isYZ)    badge = `<span style="${S.badge('#d1f2d1','#155724')}">OK</span>`;
    else              badge = `<span style="${S.badge('#f0f0f0','#555')}">other</span>`;

    const row = el('tr', '');
    row.innerHTML =
      `<td style="${S.evtTd}">${e.ts}</td>` +
      `<td style="${S.evtTd};font-weight:600;">${esc(e.key)}</td>` +
      `<td style="${S.evtTd};color:#555;">${esc(e.code)}</td>` +
      `<td style="${S.evtTd};color:#555;">${e.keyCode}</td>` +
      `<td style="${S.evtTd}">${badge}</td>`;

    evtBody.insertBefore(row, evtBody.firstChild);
    if (evtBody.children.length > 12) evtBody.removeChild(evtBody.lastChild);

    updateBanner();
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Telemetry public API ────────────────────────────────────────────────────

  function attach(selector) {
    const target = selector
      ? (typeof selector === 'string' ? document.querySelector(selector) : selector)
      : document;
    if (!target) return;
    const h = (e) => recordEvent(e);
    ['keydown','keyup','keypress'].forEach(t => {
      target.addEventListener(t, h, true);
      listeners.push({ target, type: t, handler: h });
    });
  }

  function detach() {
    listeners.forEach(({ target, type, handler }) =>
      target.removeEventListener(type, handler, true));
    listeners.length = 0;
  }

  function getReport() {
    return { session: { ...session }, events: keyEvents.slice() };
  }

  function getReportJSON() {
    return JSON.stringify(getReport(), null, 2);
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  (async function init() {
    const ua       = navigator.userAgent;
    const platform = navigator.platform || '';
    session.userAgent = ua;
    session.browser   = detectBrowser(ua);
    session.os        = detectOS(ua, platform);
    session.platform  = platform;
    session.languages = Array.from(navigator.languages || [navigator.language]);

    await loadLayoutMap();

    attach(); // listen globally by default

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { createPanel(); populateStatic(); });
    } else {
      createPanel();
      populateStatic();
    }
  })();

  global.EntangleTelemetry = { attach, detach, getReport, getReportJSON };

})(window);

/**
 * Entangle Keyboard Telemetry
 * Drop this script into any page Georg is testing.
 * Injects a diagnostic panel fixed to the bottom of the page.
 * Detects keyboard layout via Keyboard Layout API (Chrome/Edge)
 * or infers it from live key events (Safari/Firefox fallback).
 */

(function (global) {
  'use strict';

  // ── State ───────────────────────────────────────────────────────────────────

  const session = {
    startedAt        : new Date().toISOString(),
    browser          : null,
    os               : null,
    platform         : null,
    userAgent        : null,
    languages        : [],
    keyboardLayoutAPI: null,   // 'supported' | 'not_supported' | 'permission_denied'
    layoutMap        : {},     // code → character (from API)
    detectedLayout   : null,   // inferred name e.g. 'QWERTZ', 'AZERTY', 'QWERTY'
    layoutSource     : null,   // 'keyboard_layout_api' | 'key_events'
    swapDetected     : false,
  };

  const keyEvents = [];
  const listeners = [];

  // ── Browser / OS detection ──────────────────────────────────────────────────

  function detectBrowser(ua) {
    if (ua.includes('Edg/'))    return 'Edge '    + (ua.match(/Edg\/([\d.]+)/)    || [])[1];
    if (ua.includes('Chrome/')) return 'Chrome '  + (ua.match(/Chrome\/([\d.]+)/) || [])[1];
    if (ua.includes('Firefox/'))return 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)|| [])[1];
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

  // ── Layout name inference ───────────────────────────────────────────────────
  // Uses a fingerprint of known physical→character mappings to name the layout.

  const LAYOUT_FINGERPRINTS = [
    // Each entry: [ layoutName, [ [code, expectedChar], ... ] ]
    // More specific fingerprints first.
    ['QWERTZ (Swiss/DE/AT)', [['KeyZ','z'],['KeyY','y'],['KeyZ','z']]],  // checked via swap flags
    ['AZERTY (FR/BE)',       [['KeyQ','a'],['KeyW','z'],['KeyA','q']]],
    ['Dvorak',               [['KeyQ','\''],['KeyW',','],['KeyE','.'],['KeyR','p']]],
    ['Colemak',              [['KeyS','r'],['KeyD','s'],['KeyF','t'],['KeyJ','n']]],
    ['QWERTY',               [['KeyQ','q'],['KeyW','w'],['KeyZ','z'],['KeyY','y']]],
  ];

  function inferLayoutFromMap(map) {
    // Direct Y/Z swap check first
    const yChar = (map.get ? map.get('KeyY') : map['KeyY'] || '').toLowerCase();
    const zChar = (map.get ? map.get('KeyZ') : map['KeyZ'] || '').toLowerCase();

    if (zChar === 'y' && yChar === 'z') return 'QWERTZ (Swiss/DE/AT)';

    // AZERTY check
    const qChar = (map.get ? map.get('KeyQ') : map['KeyQ'] || '').toLowerCase();
    const wChar = (map.get ? map.get('KeyW') : map['KeyW'] || '').toLowerCase();
    if (qChar === 'a' && wChar === 'z') return 'AZERTY (FR/BE)';

    // Dvorak
    if (qChar === "'") return 'Dvorak';

    // Colemak
    const sChar = (map.get ? map.get('KeyS') : map['KeyS'] || '').toLowerCase();
    if (sChar === 'r') return 'Colemak';

    // Default
    if (qChar === 'q' && wChar === 'w' && zChar === 'z') return 'QWERTY';

    return 'Unknown';
  }

  // Infer from accumulated live key events (fallback for Safari/Firefox)
  // Builds a synthetic map: { code → key } from keydown events.
  const liveCodeMap = {};
  const INFERENCE_THRESHOLD = 5; // number of distinct keys seen before we commit to a name

  function inferLayoutFromEvents() {
    if (Object.keys(liveCodeMap).length < INFERENCE_THRESHOLD) return null;
    return inferLayoutFromMap(liveCodeMap);
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

      session.detectedLayout = inferLayoutFromMap(map);
      session.layoutSource   = 'keyboard_layout_api';

      const yKey = (map.get('KeyY') || '').toUpperCase();
      const zKey = (map.get('KeyZ') || '').toUpperCase();
      if (yKey === 'Z' || zKey === 'Y') session.swapDetected = true;

    } catch (_) {
      session.keyboardLayoutAPI = 'permission_denied';
    }
  }

  // ── Key event recording ─────────────────────────────────────────────────────

  function classify(e) {
    if (e.code !== 'KeyY' && e.code !== 'KeyZ') return 'other';
    const expected = e.code === 'KeyY' ? 'Y' : 'Z';
    const actual   = e.key.toUpperCase();
    if (actual === expected) return 'consistent';
    if ((e.code === 'KeyZ' && actual === 'Y') ||
        (e.code === 'KeyY' && actual === 'Z')) return 'swap';
    return 'other';
  }

  function recordEvent(e) {
    if (e.type !== 'keydown') return;

    // Feed live code map for layout inference fallback
    if (e.code && e.key && e.key.length === 1) {
      liveCodeMap[e.code] = e.key.toLowerCase();
    }

    // If Layout API wasn't available, try to infer from events
    if (session.keyboardLayoutAPI !== 'supported') {
      const inferred = inferLayoutFromEvents();
      if (inferred && inferred !== session.detectedLayout) {
        session.detectedLayout = inferred;
        session.layoutSource   = 'key_events';
        updateLayoutDisplay();
      }
    }

    const classification = classify(e);
    if (classification === 'swap') session.swapDetected = true;

    keyEvents.unshift({
      ts            : new Date().toLocaleTimeString(),
      key           : e.key,
      code          : e.code,
      keyCode       : e.keyCode,
      classification,
    });
    if (keyEvents.length > 50) keyEvents.pop();

    updatePanel();
  }

  // ── DOM helpers ─────────────────────────────────────────────────────────────

  function el(tag, css, html) {
    const e = document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Panel ───────────────────────────────────────────────────────────────────

  let panel, evtBody, bannerEl, klGrid, layoutNameEl, layoutSourceEl, statusDot;
  let collapsed = false;

  const COLORS = {
    warn  : { bg:'#fff3cd', text:'#856404' },
    ok    : { bg:'#d1f2d1', text:'#155724' },
    neutral:{ bg:'#f0f0f0', text:'#555'    },
  };

  function badge(label, c) {
    return `<span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;background:${c.bg};color:${c.text};">${label}</span>`;
  }

  function createPanel() {
    panel = el('div', `
      position:fixed;bottom:0;left:0;right:0;z-index:999999;
      background:#fff;border-top:1.5px solid #e2e2e2;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      font-size:13px;color:#1a1a1a;
      box-shadow:0 -4px 24px rgba(0,0,0,.08);`);

    // ── Header ────────────────────────────────────────────────────────────
    const header = el('div',`
      display:flex;align-items:center;justify-content:space-between;
      padding:8px 16px;border-bottom:1px solid #ebebeb;
      background:#fafafa;cursor:pointer;user-select:none;`);

    statusDot = el('span',`
      width:8px;height:8px;border-radius:50%;
      background:#ccc;flex-shrink:0;margin-right:10px;`);

    const titleEl = el('span','font-weight:600;font-size:13px;','⌨ Entangle Keyboard Telemetry');
    const hLeft   = el('div','display:flex;align-items:center;');
    hLeft.append(statusDot, titleEl);

    const hRight  = el('div','display:flex;align-items:center;gap:6px;');
    const copyBtn = el('button',`
      background:none;border:1px solid #d4d4d4;border-radius:6px;
      padding:3px 10px;font-size:12px;cursor:pointer;color:#555;`,'⎘ Copy report');
    copyBtn.onclick = ev => {
      ev.stopPropagation();
      navigator.clipboard.writeText(getReportJSON()).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = '⎘ Copy report'; }, 1500);
      });
    };
    const colBtn = el('button',`
      background:none;border:1px solid #d4d4d4;border-radius:6px;
      padding:3px 10px;font-size:12px;cursor:pointer;color:#555;`,'▼ Collapse');
    colBtn.onclick = ev => {
      ev.stopPropagation();
      collapsed = !collapsed;
      bodyEl.style.display = collapsed ? 'none' : 'flex';
      colBtn.textContent   = collapsed ? '▲ Expand' : '▼ Collapse';
    };
    hRight.append(copyBtn, colBtn);
    header.append(hLeft, hRight);
    panel.appendChild(header);

    // ── Body ──────────────────────────────────────────────────────────────
    const bodyEl = el('div','display:flex;gap:0;max-height:200px;overflow:hidden;');

    // Col 1 — System + detected layout
    const col1 = el('div','flex:1;padding:12px 16px;border-right:1px solid #ebebeb;min-width:0;');
    col1.innerHTML = `<div style="font-size:10px;font-weight:600;color:#888;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">System</div>`;

    const g = el('div','display:grid;grid-template-columns:1fr 1fr;gap:6px;');

    function statBox(label, id) {
      const b = el('div','background:#f5f5f5;border-radius:6px;padding:6px 10px;');
      b.innerHTML = `<div style="font-size:10px;color:#888;margin-bottom:2px;">${label}</div>
                     <div style="font-size:12px;font-weight:500;word-break:break-all;" id="${id}">—</div>`;
      return b;
    }

    g.append(
      statBox('Browser',     'et-browser'),
      statBox('OS',          'et-os'),
      statBox('Languages',   'et-langs'),
      statBox('Layout API',  'et-lapi'),
    );
    col1.appendChild(g);

    // Detected layout — prominent row
    const layoutRow = el('div',`
      margin-top:8px;background:#f5f5f5;border-radius:6px;
      padding:8px 10px;display:flex;align-items:center;justify-content:space-between;`);
    const layoutLeft = el('div','');
    layoutLeft.innerHTML = `<div style="font-size:10px;color:#888;margin-bottom:3px;">Detected keyboard layout</div>`;
    layoutNameEl   = el('div','font-size:15px;font-weight:600;color:#1a1a1a;','Detecting…');
    layoutSourceEl = el('div','font-size:10px;color:#aaa;margin-top:2px;','');
    layoutLeft.append(layoutNameEl, layoutSourceEl);
    layoutRow.appendChild(layoutLeft);
    col1.appendChild(layoutRow);

    bodyEl.appendChild(col1);

    // Col 2 — Layout map grid
    const col2 = el('div','flex:1;padding:12px 16px;border-right:1px solid #ebebeb;min-width:0;overflow-y:auto;');
    col2.innerHTML = `<div style="font-size:10px;font-weight:600;color:#888;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Physical key → character map</div>`;
    bannerEl = el('div','margin-bottom:8px;');
    klGrid   = el('div','display:flex;flex-wrap:wrap;gap:4px;');
    col2.append(bannerEl, klGrid);
    bodyEl.appendChild(col2);

    // Col 3 — Live events
    const col3 = el('div','flex:1.2;padding:12px 16px;min-width:0;');
    col3.innerHTML = `<div style="font-size:10px;font-weight:600;color:#888;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px;">Live key events — type in the chatbot</div>`;
    const tw = el('div','overflow-y:auto;max-height:152px;');
    const tbl = el('table','width:100%;border-collapse:collapse;font-size:11px;');
    tbl.innerHTML = `<thead><tr>
      <th style="text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;">Time</th>
      <th style="text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;">event.key</th>
      <th style="text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;">event.code</th>
      <th style="text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;">keyCode</th>
      <th style="text-align:left;color:#888;font-weight:600;font-size:10px;padding:0 6px 5px 0;border-bottom:1px solid #ebebeb;">Verdict</th>
    </tr></thead>`;
    evtBody = el('tbody','');
    evtBody.innerHTML = `<tr><td colspan="5" style="color:#aaa;padding:6px 0;font-size:11px;">No keypresses yet…</td></tr>`;
    tbl.appendChild(evtBody);
    tw.appendChild(tbl);
    col3.appendChild(tw);
    bodyEl.appendChild(col3);

    panel.appendChild(bodyEl);
    document.body.appendChild(panel);

    // store ref for collapse toggle
    colBtn._bodyEl = bodyEl;
    colBtn.onclick = ev => {
      ev.stopPropagation();
      collapsed = !collapsed;
      bodyEl.style.display = collapsed ? 'none' : 'flex';
      colBtn.textContent   = collapsed ? '▲ Expand' : '▼ Collapse';
    };

    populateStatic();
  }

  function populateStatic() {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val || '—'; };
    set('et-browser', session.browser);
    set('et-os',      session.os);
    set('et-langs',   session.languages.slice(0,3).join(', '));
    set('et-lapi',    session.keyboardLayoutAPI);
    renderLayoutMap();
    updateLayoutDisplay();
    updateBanner();
  }

  function renderLayoutMap() {
    if (!klGrid) return;
    klGrid.innerHTML = '';
    const notable = ['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyY','KeyZ','KeyU',
                     'KeyA','KeyS','KeyD','KeyF','KeyX','KeyC','KeyV','KeyB'];
    let hasAny = false;
    notable.forEach(code => {
      const val = session.layoutMap[code];
      if (!val) return;
      hasAny = true;
      const isSwap = (code === 'KeyZ' && val.toLowerCase() === 'y') ||
                     (code === 'KeyY' && val.toLowerCase() === 'z');
      const cell = el('div',`
        background:${isSwap ? '#fff3cd' : '#f5f5f5'};border-radius:6px;
        padding:5px 9px;display:inline-flex;flex-direction:column;min-width:52px;
        border:1px solid ${isSwap ? '#f0c040' : 'transparent'};`);
      cell.innerHTML =
        `<span style="font-size:9px;color:#888;margin-bottom:2px;">${code.replace('Key','')}</span>` +
        `<span style="font-size:17px;font-weight:600;color:${isSwap ? '#b45309' : '#1a1a1a'};">${esc(val)}</span>`;
      klGrid.appendChild(cell);
    });
    if (!hasAny) {
      klGrid.innerHTML = `<span style="font-size:12px;color:#aaa;">Not available — will infer from typed keys</span>`;
    }
  }

  function updateLayoutDisplay() {
    if (!layoutNameEl) return;
    const name   = session.detectedLayout;
    const source = session.layoutSource;
    if (name) {
      layoutNameEl.textContent = name;
      layoutNameEl.style.color = name.includes('QWERTZ') ? '#b45309' : '#1a1a1a';
      layoutSourceEl.textContent = source === 'keyboard_layout_api'
        ? 'via Keyboard Layout API'
        : 'inferred from live key events';
    } else {
      layoutNameEl.textContent   = 'Detecting…';
      layoutNameEl.style.color   = '#aaa';
      layoutSourceEl.textContent = session.keyboardLayoutAPI === 'not_supported'
        ? 'type a few keys to detect layout (Safari/Firefox)'
        : '';
    }
  }

  function updateBanner() {
    if (!bannerEl) return;
    let c, msg;
    if (session.swapDetected) {
      c = COLORS.warn;
      msg = '⚠ Y/Z swap confirmed — the widget reads physical key position (event.code / keyCode) instead of the logical character (event.key).';
    } else if (session.detectedLayout) {
      c = session.detectedLayout.includes('QWERTZ') ? COLORS.warn : COLORS.ok;
      msg = session.detectedLayout.includes('QWERTZ')
        ? '⚠ QWERTZ layout detected — Y/Z swap is likely unless event.key is used.'
        : '✓ Layout looks QWERTY-compatible — no swap expected.';
    } else {
      c = COLORS.neutral;
      msg = 'Type in the chatbot to verify.';
    }
    bannerEl.style.cssText = `border-radius:6px;padding:7px 12px;font-size:12px;background:${c.bg};color:${c.text};font-weight:500;`;
    bannerEl.textContent = msg;
    if (statusDot) statusDot.style.background = session.swapDetected ? '#e74c3c' : (session.detectedLayout ? '#27ae60' : '#ccc');
  }

  function updatePanel() {
    if (!evtBody) return;
    if (keyEvents.length === 1) evtBody.innerHTML = '';

    const e   = keyEvents[0];
    const tdS = 'padding:4px 6px 4px 0;border-bottom:1px solid #f0f0f0;font-family:monospace;font-size:11px;';
    const isSwap = e.classification === 'swap';
    const isYZ   = e.classification !== 'other';
    const b = isSwap ? badge('Y/Z swap', COLORS.warn) : isYZ ? badge('OK', COLORS.ok) : badge('other', COLORS.neutral);

    const row = el('tr','');
    row.innerHTML =
      `<td style="${tdS}">${esc(e.ts)}</td>` +
      `<td style="${tdS}font-weight:600;">${esc(e.key)}</td>` +
      `<td style="${tdS}color:#555;">${esc(e.code)}</td>` +
      `<td style="${tdS}color:#555;">${e.keyCode}</td>` +
      `<td style="${tdS}">${b}</td>`;

    evtBody.insertBefore(row, evtBody.firstChild);
    if (evtBody.children.length > 12) evtBody.removeChild(evtBody.lastChild);

    updateLayoutDisplay();
    updateBanner();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function attach(selector) {
    const target = selector
      ? (typeof selector === 'string' ? document.querySelector(selector) : selector)
      : document;
    if (!target) return;
    const h = e => recordEvent(e);
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
    attach(); // listen globally

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { createPanel(); });
    } else {
      createPanel();
    }
  })();

  global.EntangleTelemetry = { attach, detach, getReport, getReportJSON };

})(window);

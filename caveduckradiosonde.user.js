// ==UserScript==
// @name         케이브덕 라디오존데 팝업창📡
// @namespace    igx-radiosonde-live
// @version      3.7.4
// @description  케이브덕(caveduck.io)에서 라디오존데 수치를 팝업 또는 채팅창 인라인으로 표시
// @match        https://caveduck.io/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      rs.igx.kr
// ==/UserScript==

(() => {
  "use strict";

  const MODELS = [
    { slug: "claude-opus-4.7", label: "Claude 4.7 Opus", short: "O4.7" },
    { slug: "claude-opus-4.6", label: "Claude 4.6 Opus", short: "O4.6" },
    { slug: "claude-sonnet-4.6", label: "Claude 4.6 Sonnet", short: "S4.6" },
    { slug: "gemini-3-1-pro", label: "Gemini 3.1 Pro", short: "G3.1" },
    { slug: "gemini-2.5-pro", label: "Gemini 2.5 Pro", short: "G2.5" },
  ];

  const API_BASE = "https://rs.igx.kr/api/simple/";
  const POLL_MS = 60 * 1000;

  const STORE_KEY_LAYOUT = "igx_rs_popup_layout_v3";
  const STORE_KEY_INLINE = "igx_rs_popup_inline_v3";
  const STORE_KEY_POS_TOP = "igx_rs_popup_top_v3";
  const STORE_KEY_POS_RIGHT = "igx_rs_popup_right_v3";
  const STORE_KEY_VISIBILITY = "igx_rs_popup_vis_v3";

  GM_addStyle(`
    #igx-live-popup {
      --bg-main: rgba(20, 20, 20, .92);
      --border-main: rgba(255, 255, 255, .12);
      --text-title: rgba(255, 255, 255, .85);
      --bg-head: rgba(255, 255, 255, .03);
      --border-head: rgba(255, 255, 255, .10);
      --btn-border: rgba(255, 255, 255, .14);
      --btn-bg: rgba(255, 255, 255, .06);
      --btn-bg-hover: rgba(255, 255, 255, .10);
      --text-name: rgba(255, 255, 255, .88);
      --border-row: rgba(255, 255, 255, .08);
      --text-metric: rgba(255, 255, 255, .70);
      --text-unknown: rgba(255, 255, 255, .80);
      --text-foot: rgba(255, 255, 255, .55);
      --bg-set-row: rgba(255, 255, 255, .05);
      --bg-bitem: rgba(255, 255, 255, .04);
      --bg-settings: rgba(0, 0, 0, 0.2);

      --c-active: #3ddc84;
      --c-degraded: #ffd54a;
      --c-impacted: #ff5c5c;
      --c-unknown: #9aa0a6;
      --c-fail: #ff9b9b;
    }

    #igx-live-popup.igx-light {
      --bg-main: rgba(250, 250, 250, .92);
      --border-main: rgba(0, 0, 0, .12);
      --text-title: rgba(0, 0, 0, .85);
      --bg-head: rgba(0, 0, 0, .03);
      --border-head: rgba(0, 0, 0, .10);
      --btn-border: rgba(0, 0, 0, .14);
      --btn-bg: rgba(0, 0, 0, .06);
      --btn-bg-hover: rgba(0, 0, 0, .10);
      --text-name: rgba(0, 0, 0, .88);
      --border-row: rgba(0, 0, 0, .08);
      --text-metric: rgba(0, 0, 0, .70);
      --text-unknown: rgba(0, 0, 0, .60);
      --text-foot: rgba(0, 0, 0, .55);
      --bg-set-row: rgba(0, 0, 0, .05);
      --bg-bitem: rgba(0, 0, 0, .04);
      --bg-settings: rgba(0, 0, 0, 0.05);

      --c-active: #1da851;
      --c-degraded: #d49500;
      --c-impacted: #e03535;
      --c-unknown: #7b8086;
      --c-fail: #e03535;
    }

    #igx-live-popup {
      position: fixed;
      width: 220px;
      background: var(--bg-main);
      border: 1px solid var(--border-main);
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .35);
      z-index: 999999;
      overflow: hidden;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial;
      user-select: none;
      backdrop-filter: blur(6px);
      cursor: grab;
      color: var(--text-title);
      transition: background 0.3s, border-color 0.3s, color 0.3s;
    }
    #igx-live-popup:active { cursor: grabbing; }
    #igx-live-popup * { box-sizing: border-box; }

    #igx-live-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 8px;
      background: var(--bg-head);
      border-bottom: 1px solid var(--border-head);
      gap: 6px;
    }
    #igx-live-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }
    #igx-live-title { font-size: 12px; white-space: nowrap; }
    #igx-live-actions {
      display: flex;
      gap: 4px;
      align-items: center;
      flex: 0 0 auto;
    }

    .igx-btn {
      width: 22px;
      height: 22px;
      border-radius: 8px;
      border: 1px solid var(--btn-border);
      background: var(--btn-bg);
      color: var(--text-title);
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 13px;
      line-height: 0;
    }
    .igx-btn:hover { background: var(--btn-bg-hover); }

    #igx-live-body { padding: 8px; }
    .igx-row { padding: 5px 0; border-bottom: 1px solid var(--border-row); }
    .igx-row:last-child { border-bottom: none; }
    .igx-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 4px;
      width: 100%;
    }
    .igx-name {
      font-size: 11px;
      color: var(--text-name);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
      min-width: 0;
      letter-spacing: -0.2px;
    }
    .igx-state {
      font-size: 10px;
      opacity: .95;
      white-space: nowrap;
      font-weight: 700;
      flex: 0 0 auto;
      letter-spacing: -0.2px;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 4px;
      vertical-align: middle;
    }
    .igx-metric {
      margin-top: 3px;
      font-size: 10px;
      color: var(--text-metric);
      line-height: 1.35;
      letter-spacing: -0.2px;
    }
    .score { font-weight: 800; }
    .fail { font-weight: 800; color: var(--c-fail); }

    #igx-live-settings {
      display: none;
      padding: 8px;
      background: var(--bg-settings);
    }
    .igx-set-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid var(--bg-set-row);
      font-size: 11px;
      color: var(--text-name);
      letter-spacing: -0.2px;
    }
    .igx-set-row:last-child { border-bottom: none; }
    .igx-set-label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      flex: 1;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .igx-set-chk {
      margin: 0;
      width: 13px;
      height: 13px;
      accent-color: #3ddc84;
      cursor: pointer;
      flex-shrink: 0;
    }

    #igx-live-popup.show-settings #igx-live-settings { display: block; }
    #igx-live-popup.show-settings #igx-live-body { display: none; }

    .s-active .dot { background: var(--c-active); }
    .s-degraded .dot { background: var(--c-degraded); }
    .s-impacted .dot { background: var(--c-impacted); }
    .s-unknown .dot { background: var(--c-unknown); }

    .s-active .igx-state .stxt { color: var(--c-active); }
    .s-degraded .igx-state .stxt { color: var(--c-degraded); }
    .s-impacted .igx-state .stxt { color: var(--c-impacted); }
    .s-unknown .igx-state .stxt { color: var(--c-unknown); }

    .s-active .score { color: var(--c-active); }
    .s-degraded .score { color: var(--c-degraded); }
    .s-impacted .score { color: var(--c-impacted); }
    .s-unknown .score { color: var(--text-unknown); }

    #igx-live-foot {
      margin-top: 6px;
      font-size: 10px;
      color: var(--text-foot);
      display: flex;
      justify-content: space-between;
      align-items: center;
      letter-spacing: -0.2px;
    }
    #igx-live-foot a {
      color: rgba(120, 200, 255, .85);
      text-decoration: none;
      border-bottom: 1px dotted rgba(120, 200, 255, .35);
      cursor: pointer;
    }

    /* ====== BAR 모드 ====== */
    #igx-live-popup.bar {
      width: auto;
      max-width: calc(100vw - 32px);
      border-radius: 999px;
    }
    #igx-live-popup.bar #igx-live-body,
    #igx-live-popup.bar #igx-live-settings,
    #igx-live-popup.bar .btn-settings,
    #igx-live-popup.bar #igx-live-title {
      display: none;
    }

    /* ====== INLINE 오버레이 모드 ====== */
    /* ★ 케이브덕: form[data-tour="chat-input"] 이 호스트가 됨
       form 자체가 relative 포지션이므로 추가 스타일 불필요 */
    .igx-inline-overlay-host {
      position: relative !important;
    }

    #igx-live-popup.inline {
     position: absolute !important;
     top: 6px !important;
     left: 0 !important;
     right: 0 !important;
     width: auto !important;
     max-width: none !important;
     background: transparent !important;
     border: none !important;
     box-shadow: none !important;
     backdrop-filter: none !important;
     transform: none !important;
     cursor: default !important;
     margin: 0 !important;
     padding: 0 !important;
     border-radius: 0 !important;
     z-index: 3 !important;
     overflow: visible !important;
     pointer-events: none !important;
    }
    #igx-live-popup.inline #igx-live-head {
      background: transparent;
      border: none;
      padding: 0 4px !important;
      min-height: 0 !important;
      gap: 4px !important;
      pointer-events: auto;
    }
    #igx-live-popup.inline #igx-live-left {
      gap: 8px !important;
    }
    #igx-live-popup.inline #igx-live-actions {
      gap: 2px !important;
    }
    #igx-live-popup.inline #igx-live-body,
    #igx-live-popup.inline #igx-live-settings,
    #igx-live-popup.inline .btn-layout,
    #igx-live-popup.inline .btn-settings,
    #igx-live-popup.inline #igx-live-title {
      display: none;
    }
    #igx-live-popup.inline .igx-btn {
      width: 18px !important;
      height: 18px !important;
      min-width: 18px !important;
      padding: 0 !important;
      background: transparent;
      border-color: transparent;
      opacity: 0.65;
    }
    #igx-live-popup.inline .igx-btn:hover {
      background: var(--btn-bg);
      opacity: 1;
    }
    #igx-live-popup.inline .bitem {
      background: transparent;
      border: none;
      padding: 1px 2px !important;
      gap: 6px !important;
      min-height: 0 !important;
    }
    #igx-live-popup.inline .bname,
    #igx-live-popup.inline .bscore,
    #igx-live-popup.inline .blat {
      line-height: 1 !important;
    }
    #igx-live-popup.inline .bname { opacity: 1; }
    #igx-live-popup.inline .bdot {
      width: 6px !important;
      height: 6px !important;
    }

    #igx-live-barline {
      display: none;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      color: var(--text-unknown);
      font-size: 11px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    #igx-live-barline::-webkit-scrollbar { display: none; }
    #igx-live-popup.bar #igx-live-barline,
    #igx-live-popup.inline #igx-live-barline { display: flex; }

    .bitem {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 7px;
      border-radius: 999px;
      border: 1px solid var(--btn-border);
      background: var(--bg-bitem);
    }
    .bname {
      opacity: .9;
      font-weight: 700;
      color: var(--text-title);
    }
    .bscore { font-weight: 900; }
    .blat {
      opacity: .75;
      color: var(--text-name);
    }
    .bdot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      display: inline-block;
    }

    .b-active .bdot { background: var(--c-active); }
    .b-degraded .bdot { background: var(--c-degraded); }
    .b-impacted .bdot { background: var(--c-impacted); }
    .b-unknown .bdot { background: var(--c-unknown); }

    .inline-icon {
      display: none;
      width: 14px;
      height: 14px;
      opacity: 0.6;
      margin-right: 2px;
      color: var(--text-title);
    }
    #igx-live-popup.inline .inline-icon { display: block; }

    @media (max-width: 600px) {
      #igx-live-popup.bar {
        width: auto !important;
        max-width: none !important;
        left: 2px !important;
        right: 2px !important;
      }
      #igx-live-popup.bar #igx-live-head { padding: 7px 6px; gap: 4px; }
      #igx-live-popup.bar #igx-live-left { gap: 4px; }
      #igx-live-popup.bar #igx-live-barline { gap: 4px; }
      #igx-live-popup.bar .bitem {
        flex: 1 1 0;
        justify-content: center;
        padding: 5px 2px;
        min-width: 0;
      }
      #igx-live-popup.bar .bname,
      #igx-live-popup.bar .bscore,
      #igx-live-popup.bar .blat {
        font-size: 11px;
        letter-spacing: -0.3px;
      }
      #igx-live-popup.bar .bdot {
        width: 6px;
        height: 7px;
        margin-right: -1px;
        flex-shrink: 0;
      }
      #igx-live-popup.bar .igx-btn {
        width: 26px;
        height: 24px;
        flex-shrink: 0;
      }

      #igx-live-popup.inline #igx-live-head {
        padding: 0 4px 2px 4px !important;
      }
    }
  `);

  function px(v) {
    const n = Number(String(v).replace("px", ""));
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  let visibility = {};
  try {
    visibility = JSON.parse(localStorage.getItem(STORE_KEY_VISIBILITY)) || {};
  } catch {}

  MODELS.forEach(m => {
    if (visibility[m.slug] === undefined) visibility[m.slug] = true;
  });

  const popup = document.createElement("div");
  popup.id = "igx-live-popup";

  const head = document.createElement("div");
  head.id = "igx-live-head";

  const left = document.createElement("div");
  left.id = "igx-live-left";

  const inlineIcon = document.createElement("div");
  inlineIcon.className = "inline-icon";
  inlineIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;"><path d="M2 12h4l2.25-11.25a.5.5 0 0 1 .98 0l4.54 22.5a.5.5 0 0 0 .98 0L17 12h5"/></svg>`;

  const title = document.createElement("div");
  title.id = "igx-live-title";
  title.textContent = "Radiosonde";

  const barline = document.createElement("div");
  barline.id = "igx-live-barline";
  barline.textContent = "불러오는 중…";

  left.append(inlineIcon, title, barline);

  const actions = document.createElement("div");
  actions.id = "igx-live-actions";

  const btnRefresh = document.createElement("button");
  btnRefresh.className = "igx-btn";
  btnRefresh.title = "갱신";
  btnRefresh.textContent = "↻";

  const btnSettings = document.createElement("button");
  btnSettings.className = "igx-btn btn-settings";
  btnSettings.title = "모델 설정";
  btnSettings.textContent = "⚙";

  const btnLayout = document.createElement("button");
  btnLayout.className = "igx-btn btn-layout";
  btnLayout.title = "레이아웃 전환 (세로/가로)";
  btnLayout.textContent = "↔";

  const btnPin = document.createElement("button");
  btnPin.className = "igx-btn btn-pin";
  btnPin.title = "채팅창에 고정";
  btnPin.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';

  actions.append(btnRefresh, btnSettings, btnLayout, btnPin);
  head.append(left, actions);

  const body = document.createElement("div");
  body.id = "igx-live-body";

  const settingsArea = document.createElement("div");
  settingsArea.id = "igx-live-settings";
  settingsArea.innerHTML = `<div style="font-size:11px; color:var(--text-unknown); margin-bottom:10px; text-align:center;">표시할 모델을 선택하세요</div>`;

  const rows = new Map();

  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "igx-row s-unknown";
    row.style.display = visibility[m.slug] ? "" : "none";

    const top = document.createElement("div");
    top.className = "igx-top";

    const name = document.createElement("div");
    name.className = "igx-name";
    name.textContent = m.label;
    name.title = m.label;

    const state = document.createElement("div");
    state.className = "igx-state";
    state.innerHTML = `<span class="dot"></span><span class="stxt">WAIT</span>`;

    top.append(name, state);

    const metric = document.createElement("div");
    metric.className = "igx-metric";
    metric.textContent = "불러오는 중…";

    row.append(top, metric);
    body.appendChild(row);
    rows.set(m.slug, { row, state, metric });

    const sRow = document.createElement("div");
    sRow.className = "igx-set-row";

    const sLabel = document.createElement("label");
    sLabel.className = "igx-set-label";
    sLabel.title = m.label;

    const sChk = document.createElement("input");
    sChk.type = "checkbox";
    sChk.className = "igx-set-chk";
    sChk.checked = visibility[m.slug];

    sChk.addEventListener("change", (e) => {
      visibility[m.slug] = e.target.checked;
      localStorage.setItem(STORE_KEY_VISIBILITY, JSON.stringify(visibility));
      rows.get(m.slug).row.style.display = visibility[m.slug] ? "" : "none";
      renderBarline();
      requestAnimationFrame(() => clampNow());
    });

    sLabel.append(sChk, document.createTextNode(" " + m.label));
    sRow.append(sLabel);
    settingsArea.appendChild(sRow);
  }

  const foot = document.createElement("div");
  foot.id = "igx-live-foot";
  foot.innerHTML = `<span class="ts">—</span><a href="https://rs.igx.kr/" target="_blank" rel="noreferrer">rs.igx.kr</a>`;
  body.appendChild(foot);

  popup.append(head, body, settingsArea);

  function setFooter(text) {
    foot.querySelector(".ts").textContent = text;
  }

  function setStateClass(el, status) {
    el.classList.remove("s-active", "s-degraded", "s-impacted", "s-unknown");
    if (status === "active") el.classList.add("s-active");
    else if (status === "degraded") el.classList.add("s-degraded");
    else if (status === "impacted") el.classList.add("s-impacted");
    else el.classList.add("s-unknown");
  }

  function upperStatus(s) {
    const v = String(s || "unknown").toUpperCase();
    if (v === "ACTIVE" || v === "DEGRADED" || v === "IMPACTED") return v;
    return "UNKNOWN";
  }

  function gmGetJson(url, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  function fmt2(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n.toFixed(2) : null;
  }

  function fmt0(x) {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n).toString() : null;
  }

  function latencySeconds(latencyInt) {
    const n = Number(latencyInt);
    if (!Number.isFinite(n)) return null;
    return (n >= 50 ? n / 1000 : n).toFixed(2);
  }

  const last = new Map();

  function renderBarline() {
    const parts = MODELS
      .filter(m => visibility[m.slug])
      .map((m) => {
        const d = last.get(m.slug) || { status: "unknown", score: "—", lat: "—" };
        const cls = d.status ? `b-${d.status}` : "b-unknown";
        return `
          <span class="bitem ${cls}">
            <span class="bdot"></span>
            <span class="bname">${m.short}</span>
            <span class="bscore">${d.score ?? "—"}</span>
            <span class="blat">${d.lat ?? "—"}s</span>
          </span>
        `.trim();
      })
      .join("");

    barline.innerHTML = parts || "<span style='opacity:0.6; padding: 0 4px;'>선택된 모델 없음</span>";
  }

  async function refreshAll() {
    setFooter("갱신중…");
    const results = await Promise.allSettled(
      MODELS.map((m) => gmGetJson(API_BASE + encodeURIComponent(m.slug)))
    );

    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const ui = rows.get(m.slug);

      if (results[i].status !== "fulfilled" || !results[i].value || results[i].value.success !== true) {
        setStateClass(ui.row, "unknown");
        ui.state.querySelector(".stxt").textContent = "ERROR";
        ui.metric.textContent = "요청 실패";
        last.set(m.slug, { status: "unknown", score: "—", lat: "—" });
        continue;
      }

      const d = results[i].value.data;
      const status = d.status || "unknown";
      setStateClass(ui.row, status);
      ui.state.querySelector(".stxt").textContent = upperStatus(status);

      const lat = latencySeconds(d.latency);
      const tps = fmt2(d.tps);
      const score = fmt0(d.score);
      const fail = Number.isFinite(Number(d.failureCount)) ? Number(d.failureCount) : 0;

      last.set(m.slug, { status, score: score ?? "—", lat: lat ?? "—" });

      const scoreHtml = (score != null)
        ? `<span class="score">${score}점</span>`
        : `<span class="score">—점</span>`;
      const failHtml = (fail > 0)
        ? ` · <span class="fail">실패 ${fail}</span>`
        : "";

      ui.metric.innerHTML = `응답 ${lat ?? "—"}s · TPS ${tps ?? "—"} · ${scoreHtml}${failHtml}`;
    }

    renderBarline();
    setFooter(`수신 ${new Date().toLocaleTimeString()}`);
  }

  const EDGE = 8;

  function loadPos() {
    let t = localStorage.getItem(STORE_KEY_POS_TOP);
    let r = localStorage.getItem(STORE_KEY_POS_RIGHT);
    return {
      top: t ? parseInt(t, 10) : 120,
      right: r ? parseInt(r, 10) : 16
    };
  }

  function savePos(t, r) {
    localStorage.setItem(STORE_KEY_POS_TOP, t);
    localStorage.setItem(STORE_KEY_POS_RIGHT, r);
  }

  function applyClampedPosition(targetTop, targetRight) {
    if (popup.classList.contains("inline")) return;

    const rect = popup.getBoundingClientRect();
    const maxTop = Math.max(0, window.innerHeight - rect.height - EDGE);
    const maxRight = Math.max(0, window.innerWidth - rect.width - EDGE);
    const t = clamp(targetTop, EDGE, maxTop);
    const r = clamp(targetRight, 0, maxRight);

    popup.style.top = `${t}px`;
    if (window.innerWidth > 600 || !popup.classList.contains("bar")) {
      popup.style.right = `${r}px`;
    }
    popup.style.bottom = "auto";
    savePos(t, r);
  }

  function clampNow() {
    applyClampedPosition(px(getComputedStyle(popup).top), px(getComputedStyle(popup).right));
  }

  const initPos = loadPos();
  popup.style.top = `${initPos.top}px`;
  popup.style.right = `${initPos.right}px`;

  btnSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.classList.toggle("show-settings");
    requestAnimationFrame(() => clampNow());
  });

  function cleanupInlineOverlayHosts() {
    document.querySelectorAll(".igx-inline-overlay-host").forEach(el => {
      el.classList.remove("igx-inline-overlay-host");
    });
  }

  // ★★★ 케이브덕 전용 인라인 위치 설정 ★★★
  // 케이브덕 채팅 form: <form data-tour="chat-input" class="... relative ...">
  // form 자체가 relative 포지션이므로 그 안에 absolute로 overlay
  function ensureInlinePosition() {
    const form = document.querySelector('form[data-tour="chat-input"]');
    if (!form) return;

    cleanupInlineOverlayHosts();
    form.classList.add("igx-inline-overlay-host");
    if (popup.parentNode !== form) form.appendChild(popup);
  }

  function updateLayout() {
    const isInline = localStorage.getItem(STORE_KEY_INLINE) === "1";
    const baseLayout = localStorage.getItem(STORE_KEY_LAYOUT) === "bar" ? "bar" : "card";

    popup.classList.remove("card", "bar", "inline", "show-settings");

    if (isInline) {
      popup.classList.add("inline");
      btnPin.textContent = "↗";
      btnPin.title = "팝업으로 분리";
      ensureInlinePosition();
    } else {
      cleanupInlineOverlayHosts();
      popup.classList.add(baseLayout);
      btnPin.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';
      btnPin.title = "채팅창에 고정";

      if (popup.parentNode !== document.documentElement) {
        document.documentElement.appendChild(popup);
      }
      requestAnimationFrame(() => clampNow());
    }
  }

  if (!localStorage.getItem(STORE_KEY_LAYOUT)) {
    localStorage.setItem(STORE_KEY_LAYOUT, window.innerWidth <= 520 ? "bar" : "card");
  }
  updateLayout();

  btnLayout.addEventListener("click", (e) => {
    e.stopPropagation();
    const current = localStorage.getItem(STORE_KEY_LAYOUT) === "bar" ? "card" : "bar";
    localStorage.setItem(STORE_KEY_LAYOUT, current);
    updateLayout();
  });

  btnPin.addEventListener("click", (e) => {
    e.stopPropagation();
    const isInline = localStorage.getItem(STORE_KEY_INLINE) === "1";
    localStorage.setItem(STORE_KEY_INLINE, isInline ? "0" : "1");
    updateLayout();
  });

  btnRefresh.addEventListener("click", (e) => {
    e.stopPropagation();
    refreshAll();
  });

  setInterval(refreshAll, POLL_MS);
  setTimeout(refreshAll, 800);
  window.addEventListener("resize", () => clampNow(), { passive: true });

  // ★★★ 케이브덕 인라인 재부착 인터벌
  // 케이브덕은 SPA라 페이지 전환 시 채팅 form이 새로 렌더될 수 있음
  setInterval(() => {
    if (popup.classList.contains("inline")) ensureInlinePosition();
  }, 1000);

  let dragging = false, sx = 0, sy = 0, st = 0, sr = 0;

  function isInteractive(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(".igx-btn, a, input, label");
  }

  function startDrag(clientX, clientY) {
    if (popup.classList.contains("inline")) return;
    dragging = true;
    sx = clientX;
    sy = clientY;
    st = px(getComputedStyle(popup).top);
    sr = px(getComputedStyle(popup).right);
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    applyClampedPosition(st + (clientY - sy), sr - (clientX - sx));
  }

  function endDrag() {
    dragging = false;
  }

  popup.addEventListener("pointerdown", (e) => {
    if (isInteractive(e.target)) return;
    try { popup.setPointerCapture(e.pointerId); } catch {}
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  });

  popup.addEventListener("pointermove", (e) => moveDrag(e.clientX, e.clientY));
  popup.addEventListener("pointerup", () => endDrag());
  popup.addEventListener("pointercancel", () => endDrag());

  popup.addEventListener("touchstart", (e) => {
    if (isInteractive(e.target)) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    startDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  popup.addEventListener("touchmove", (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    moveDrag(t.clientX, t.clientY);
    e.preventDefault();
  }, { passive: false });

  popup.addEventListener("touchend", () => endDrag());

  popup.addEventListener("mousedown", (e) => {
    if (isInteractive(e.target)) return;
    startDrag(e.clientX, e.clientY);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) { moveDrag(e.clientX, e.clientY); }
  function onMouseUp() {
    endDrag();
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  // ★★★ 케이브덕 테마 감지
  // 케이브덕은 next-themes 방식: <html class="light"> 또는 <html class="dark">
  function applyTheme() {
    const isLight = document.documentElement.classList.contains("light");
    if (isLight) popup.classList.add("igx-light");
    else popup.classList.remove("igx-light");
  }

  applyTheme();

  // html 엘리먼트의 class 변경 감지 (다크/라이트 토글)
  const themeObserver = new MutationObserver(() => applyTheme());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  document.documentElement.appendChild(popup);
})();

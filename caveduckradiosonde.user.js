// ==UserScript==
// @name         케이브덕 라디오존데 팝업창📡
// @namespace    igx-radiosonde-live
// @version      3.8.1
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
    /* ======================================================
       케이브덕 라디오존데 — v3.8.0
       케이브덕 디자인 시스템 참고 (dgray, rounded-sm, etc.)
    ====================================================== */

    #igx-live-popup {
      /* 다크 모드 색상 변수 */
      --igx-bg: rgba(18, 18, 20, 0.94);
      --igx-bg-head: rgba(255, 255, 255, 0.04);
      --igx-bg-settings: rgba(0, 0, 0, 0.22);
      --igx-bg-bitem: rgba(255, 255, 255, 0.05);
      --igx-border: rgba(255, 255, 255, 0.10);
      --igx-border-head: rgba(255, 255, 255, 0.08);
      --igx-border-row: rgba(255, 255, 255, 0.07);
      --igx-btn-border: rgba(255, 255, 255, 0.13);
      --igx-btn-bg: rgba(255, 255, 255, 0.07);
      --igx-btn-bg-hover: rgba(255, 255, 255, 0.13);
      --igx-text-title: rgba(255, 255, 255, 0.90);
      --igx-text-name: rgba(255, 255, 255, 0.85);
      --igx-text-metric: rgba(255, 255, 255, 0.60);
      --igx-text-unknown: rgba(255, 255, 255, 0.50);
      --igx-text-foot: rgba(255, 255, 255, 0.40);
      --igx-badge-bg: rgba(0, 0, 0, 0.85);

      --c-active: #3ddc84;
      --c-degraded: #ffd54a;
      --c-impacted: #ff5c5c;
      --c-unknown: #9aa0a6;
      --c-fail: #ff9b9b;
    }

    #igx-live-popup.igx-light {
      --igx-bg: rgba(248, 248, 250, 0.96);
      --igx-bg-head: rgba(0, 0, 0, 0.03);
      --igx-bg-settings: rgba(0, 0, 0, 0.04);
      --igx-bg-bitem: rgba(0, 0, 0, 0.04);
      --igx-border: rgba(0, 0, 0, 0.10);
      --igx-border-head: rgba(0, 0, 0, 0.08);
      --igx-border-row: rgba(0, 0, 0, 0.07);
      --igx-btn-border: rgba(0, 0, 0, 0.13);
      --igx-btn-bg: rgba(0, 0, 0, 0.06);
      --igx-btn-bg-hover: rgba(0, 0, 0, 0.11);
      --igx-text-title: rgba(0, 0, 0, 0.88);
      --igx-text-name: rgba(0, 0, 0, 0.80);
      --igx-text-metric: rgba(0, 0, 0, 0.60);
      --igx-text-unknown: rgba(0, 0, 0, 0.45);
      --igx-text-foot: rgba(0, 0, 0, 0.40);
      --igx-badge-bg: rgba(0, 0, 0, 0.80);

      --c-active: #1da851;
      --c-degraded: #d49500;
      --c-impacted: #e03535;
      --c-unknown: #7b8086;
      --c-fail: #e03535;
    }

    /* ── 팝업 베이스 ── */
    #igx-live-popup {
      position: fixed;
      width: 256px;
      background: var(--igx-bg);
      border: 1px solid var(--igx-border);
      border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.38), 0 2px 8px rgba(0,0,0,.22);
      z-index: 999999;
      /* overflow: visible — 내용이 많아도 잘리지 않도록 */
      overflow: visible;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", Arial, sans-serif;
      font-size: 14px;
      user-select: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      cursor: grab;
      color: var(--igx-text-title);
      transition: background 0.25s, border-color 0.25s, color 0.25s, box-shadow 0.25s;
    }
    /* 팝업 내부 스크롤 래퍼 — 내용이 길어지면 세로 스크롤 */
    #igx-live-inner {
      border-radius: 10px;
      overflow: hidden;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,.15) transparent;
    }
    #igx-live-popup.igx-light #igx-live-inner {
      scrollbar-color: rgba(0,0,0,.15) transparent;
    }
    #igx-live-popup:active { cursor: grabbing; }
    #igx-live-popup * { box-sizing: border-box; }

    /* ── 헤더 ── */
    #igx-live-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 7px 8px;
      background: var(--igx-bg-head);
      border-bottom: 1px solid var(--igx-border-head);
      gap: 6px;
    }
    #igx-live-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }
    #igx-live-title {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: -0.2px;
      white-space: nowrap;
      opacity: 0.75;
    }
    #igx-live-actions {
      display: flex;
      gap: 3px;
      align-items: center;
      flex: 0 0 auto;
    }

    /* ── 버튼 (케이브덕 rounded-sm 스타일 참고) ── */
    .igx-btn {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 1px solid var(--igx-btn-border);
      background: var(--igx-btn-bg);
      color: var(--igx-text-title);
      cursor: pointer;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 13px;
      line-height: 1;
      transition: background 0.15s, border-color 0.15s, opacity 0.15s;
      /* 모바일 터치 타겟 확보 */
      position: relative;
    }
    .igx-btn::after {
      content: '';
      position: absolute;
      inset: -6px;
    }
    .igx-btn:hover {
      background: var(--igx-btn-bg-hover);
      border-color: rgba(255,255,255,0.22);
    }
    #igx-live-popup.igx-light .igx-btn:hover {
      border-color: rgba(0,0,0,0.22);
    }
    .igx-btn:active { opacity: 0.7; }

    /* ── 바디 ── */
    #igx-live-body { padding: 8px 8px 6px; }

    .igx-row {
      padding: 6px 0;
      border-bottom: 1px solid var(--igx-border-row);
    }
    .igx-row:last-of-type { border-bottom: none; }

    .igx-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 4px;
      width: 100%;
    }
    .igx-name {
      font-size: 13px;
      color: var(--igx-text-name);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
      min-width: 0;
      letter-spacing: -0.2px;
    }
    .igx-state {
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      flex: 0 0 auto;
      letter-spacing: -0.1px;
      opacity: 0.95;
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      display: inline-block;
      margin-right: 3px;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .igx-metric {
      margin-top: 3px;
      font-size: 12px;
      color: var(--igx-text-metric);
      line-height: 1.4;
      letter-spacing: -0.15px;
    }
    .score { font-weight: 800; }
    .fail  { font-weight: 800; color: var(--c-fail); }

    /* ── 설정 영역 ── */
    #igx-live-settings {
      display: none;
      padding: 8px;
      background: var(--igx-bg-settings);
    }
    .igx-set-hint {
      font-size: 12px;
      color: var(--igx-text-unknown);
      margin-bottom: 8px;
      text-align: center;
    }
    .igx-set-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 2px;
      border-bottom: 1px solid var(--igx-border-row);
      font-size: 13px;
      color: var(--igx-text-name);
      letter-spacing: -0.2px;
    }
    .igx-set-row:last-child { border-bottom: none; }
    .igx-set-label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      flex: 1;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      /* 모바일 터치 타겟 */
      min-height: 36px;
    }
    .igx-set-chk {
      margin: 0;
      width: 14px;
      height: 14px;
      accent-color: #3ddc84;
      cursor: pointer;
      flex-shrink: 0;
    }

    #igx-live-popup.show-settings #igx-live-settings { display: block; }
    #igx-live-popup.show-settings #igx-live-body { display: none; }

    /* ── 상태 색상 ── */
    .s-active   .dot  { background: var(--c-active); }
    .s-degraded .dot  { background: var(--c-degraded); }
    .s-impacted .dot  { background: var(--c-impacted); }
    .s-unknown  .dot  { background: var(--c-unknown); }

    .s-active   .igx-state .stxt { color: var(--c-active); }
    .s-degraded .igx-state .stxt { color: var(--c-degraded); }
    .s-impacted .igx-state .stxt { color: var(--c-impacted); }
    .s-unknown  .igx-state .stxt { color: var(--c-unknown); }

    .s-active   .score { color: var(--c-active); }
    .s-degraded .score { color: var(--c-degraded); }
    .s-impacted .score { color: var(--c-impacted); }
    .s-unknown  .score { color: var(--igx-text-unknown); }

    /* ── 푸터 ── */
    #igx-live-foot {
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px solid var(--igx-border-row);
      font-size: 11px;
      color: var(--igx-text-foot);
      display: flex;
      justify-content: space-between;
      align-items: center;
      letter-spacing: -0.15px;
    }
    #igx-live-foot a {
      color: rgba(100, 180, 255, .80);
      text-decoration: none;
      border-bottom: 1px dotted rgba(100, 180, 255, .30);
    }

    /* ── BAR 모드 ── */
    #igx-live-popup.bar {
      width: auto;
      max-width: calc(100vw - 24px);
      border-radius: 999px;
    }
    #igx-live-popup.bar #igx-live-body,
    #igx-live-popup.bar #igx-live-settings,
    #igx-live-popup.bar .btn-settings,
    #igx-live-popup.bar #igx-live-title {
      display: none;
    }

    /* ── INLINE 모드 ── */
    /* form이 relative라 absolute로 오버레이 */
    .igx-inline-overlay-host {
      position: relative !important;
    }

    #igx-live-popup.inline {
      position: absolute !important;
      /* 입력창 위 여유 공간: form 안에서 텍스트영역 높이를 고려해 위쪽에 배치 */
      bottom: calc(100% + 6px) !important;
      top: auto !important;
      left: 0 !important;
      right: 0 !important;
      width: auto !important;
      max-width: none !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
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
      padding: 0 6px 4px !important;
      min-height: 0 !important;
      gap: 4px !important;
      pointer-events: auto;
    }
    #igx-live-popup.inline #igx-live-left {
      gap: 6px !important;
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
      width: 20px !important;
      height: 20px !important;
      min-width: 20px !important;
      padding: 0 !important;
      background: transparent;
      border-color: transparent;
      opacity: 0.60;
    }
    #igx-live-popup.inline .igx-btn::after { inset: -8px; }
    #igx-live-popup.inline .igx-btn:hover {
      background: var(--igx-btn-bg);
      opacity: 1;
    }
    #igx-live-popup.inline .bitem {
      background: transparent;
      border: none;
      padding: 1px 3px !important;
      gap: 5px !important;
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

    /* ── 바라인 (bar/inline 공통) ── */
    #igx-live-barline {
      display: none;
      align-items: center;
      gap: 5px;
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      color: var(--igx-text-unknown);
      font-size: 11px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    #igx-live-barline::-webkit-scrollbar { display: none; }
    #igx-live-popup.bar    #igx-live-barline,
    #igx-live-popup.inline #igx-live-barline { display: flex; }

    .bitem {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid var(--igx-btn-border);
      background: var(--igx-bg-bitem);
      font-size: 12px;
    }
    .bname  { opacity: .9; font-weight: 700; color: var(--igx-text-title); }
    .bscore { font-weight: 900; }
    .blat   { opacity: .70; color: var(--igx-text-name); }
    .bdot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      display: inline-block;
      flex-shrink: 0;
    }

    .b-active   .bdot { background: var(--c-active); }
    .b-degraded .bdot { background: var(--c-degraded); }
    .b-impacted .bdot { background: var(--c-impacted); }
    .b-unknown  .bdot { background: var(--c-unknown); }

    .b-active   .bscore { color: var(--c-active); }
    .b-degraded .bscore { color: var(--c-degraded); }
    .b-impacted .bscore { color: var(--c-impacted); }
    .b-unknown  .bscore { color: var(--igx-text-unknown); }

    /* inline 전용 아이콘 */
    .inline-icon {
      display: none;
      width: 13px;
      height: 13px;
      opacity: 0.55;
      margin-right: 1px;
      color: var(--igx-text-title);
      flex-shrink: 0;
    }
    #igx-live-popup.inline .inline-icon { display: block; }

    /* ── 모바일 (max-width: 600px) ── */
    @media (max-width: 600px) {
      /* bar 모드: 좌우 꽉 채우기 */
      #igx-live-popup.bar {
        width: auto !important;
        max-width: none !important;
        left: 4px !important;
        right: 4px !important;
        border-radius: 12px !important;
      }
      #igx-live-popup.bar #igx-live-head {
        padding: 8px 10px;
        gap: 6px;
      }
      #igx-live-popup.bar #igx-live-left { gap: 4px; }
      #igx-live-popup.bar #igx-live-barline { gap: 4px; }
      #igx-live-popup.bar .bitem {
        flex: 1 1 0;
        justify-content: center;
        padding: 6px 3px;
        min-width: 0;
        gap: 4px;
      }
      #igx-live-popup.bar .bname,
      #igx-live-popup.bar .bscore,
      #igx-live-popup.bar .blat {
        font-size: 12px;
        letter-spacing: -0.3px;
      }
      #igx-live-popup.bar .bdot {
        width: 6px;
        height: 6px;
        flex-shrink: 0;
      }
      /* 모바일 버튼 터치 타겟 확대 */
      #igx-live-popup.bar .igx-btn {
        width: 32px;
        height: 30px;
        flex-shrink: 0;
      }

      /* card 모드: 너비 고정, 오른쪽 여백 */
      #igx-live-popup.card {
        width: 210px;
      }

      /* inline 모드 */
      #igx-live-popup.inline #igx-live-head {
        padding: 0 6px 6px 6px !important;
      }
    }
  `);

  /* ── 유틸 ── */
  function px(v) {
    const n = Number(String(v).replace("px", ""));
    return Number.isFinite(n) ? n : 0;
  }
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /* ── 표시 모델 가시성 상태 ── */
  let visibility = {};
  try {
    visibility = JSON.parse(localStorage.getItem(STORE_KEY_VISIBILITY)) || {};
  } catch {}
  MODELS.forEach(m => {
    if (visibility[m.slug] === undefined) visibility[m.slug] = true;
  });

  /* ── DOM 구조 생성 ── */
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
  btnPin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';

  actions.append(btnRefresh, btnSettings, btnLayout, btnPin);
  head.append(left, actions);

  const body = document.createElement("div");
  body.id = "igx-live-body";

  const settingsArea = document.createElement("div");
  settingsArea.id = "igx-live-settings";
  settingsArea.innerHTML = `<div class="igx-set-hint">표시할 모델을 선택하세요</div>`;

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

    /* 설정 행 */
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

  // 내용 래퍼 — overflow: hidden + 스크롤을 popup이 아닌 inner에서 처리
  const inner = document.createElement("div");
  inner.id = "igx-live-inner";
  inner.append(head, body, settingsArea);
  popup.append(inner);

  /* ── 헬퍼 ── */
  function setFooter(text) {
    foot.querySelector(".ts").textContent = text;
  }

  function setStateClass(el, status) {
    el.classList.remove("s-active", "s-degraded", "s-impacted", "s-unknown");
    if (status === "active")        el.classList.add("s-active");
    else if (status === "degraded") el.classList.add("s-degraded");
    else if (status === "impacted") el.classList.add("s-impacted");
    else                            el.classList.add("s-unknown");
  }

  function upperStatus(s) {
    const v = String(s || "unknown").toUpperCase();
    return ["ACTIVE", "DEGRADED", "IMPACTED"].includes(v) ? v : "UNKNOWN";
  }

  function gmGetJson(url, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
        onload: (res) => {
          try { resolve(JSON.parse(res.responseText)); }
          catch (e) { reject(e); }
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

  /* ── 바라인 렌더 ── */
  const last = new Map();

  function renderBarline() {
    const parts = MODELS
      .filter(m => visibility[m.slug])
      .map((m) => {
        const d = last.get(m.slug) || { status: "unknown", score: "—", lat: "—" };
        const cls = d.status ? `b-${d.status}` : "b-unknown";
        return `<span class="bitem ${cls}"><span class="bdot"></span><span class="bname">${m.short}</span><span class="bscore">${d.score ?? "—"}</span><span class="blat">${d.lat ?? "—"}s</span></span>`;
      })
      .join("");
    barline.innerHTML = parts || `<span style="opacity:0.5; padding:0 4px;">선택된 모델 없음</span>`;
  }

  /* ── 데이터 갱신 ── */
  async function refreshAll() {
    setFooter("갱신중…");
    const results = await Promise.allSettled(
      MODELS.map((m) => gmGetJson(API_BASE + encodeURIComponent(m.slug)))
    );

    for (let i = 0; i < MODELS.length; i++) {
      const m = MODELS[i];
      const ui = rows.get(m.slug);
      const res = results[i];

      if (res.status !== "fulfilled" || !res.value || res.value.success !== true) {
        setStateClass(ui.row, "unknown");
        ui.state.querySelector(".stxt").textContent = "ERROR";
        ui.metric.textContent = "요청 실패";
        last.set(m.slug, { status: "unknown", score: "—", lat: "—" });
        continue;
      }

      const d = res.value.data;
      const status = d.status || "unknown";
      setStateClass(ui.row, status);
      ui.state.querySelector(".stxt").textContent = upperStatus(status);

      const lat   = latencySeconds(d.latency);
      const tps   = fmt2(d.tps);
      const score = fmt0(d.score);
      const fail  = Number.isFinite(Number(d.failureCount)) ? Number(d.failureCount) : 0;

      last.set(m.slug, { status, score: score ?? "—", lat: lat ?? "—" });

      const scoreHtml = score != null
        ? `<span class="score">${score}점</span>`
        : `<span class="score">—점</span>`;
      const failHtml = fail > 0
        ? ` · <span class="fail">실패 ${fail}</span>`
        : "";

      ui.metric.innerHTML = `응답 ${lat ?? "—"}s · TPS ${tps ?? "—"} · ${scoreHtml}${failHtml}`;
    }

    renderBarline();
    setFooter(`수신 ${new Date().toLocaleTimeString()}`);
  }

  /* ── 위치 관리 ── */
  const EDGE = 8;

  function loadPos() {
    const t = localStorage.getItem(STORE_KEY_POS_TOP);
    const r = localStorage.getItem(STORE_KEY_POS_RIGHT);
    return {
      top:   t ? parseInt(t, 10) : 120,
      right: r ? parseInt(r, 10) : 16,
    };
  }
  function savePos(t, r) {
    localStorage.setItem(STORE_KEY_POS_TOP, t);
    localStorage.setItem(STORE_KEY_POS_RIGHT, r);
  }

  function applyClampedPosition(targetTop, targetRight) {
    if (popup.classList.contains("inline")) return;
    const rect   = popup.getBoundingClientRect();
    const maxTop = Math.max(0, window.innerHeight - rect.height - EDGE);
    const maxRight = Math.max(0, window.innerWidth - rect.width - EDGE);
    const t = clamp(targetTop,   EDGE, maxTop);
    const r = clamp(targetRight, 0,    maxRight);
    popup.style.top    = `${t}px`;
    popup.style.right  = `${r}px`;
    popup.style.bottom = "auto";
    savePos(t, r);
  }

  function clampNow() {
    applyClampedPosition(
      px(getComputedStyle(popup).top),
      px(getComputedStyle(popup).right)
    );
  }

  const initPos = loadPos();
  popup.style.top   = `${initPos.top}px`;
  popup.style.right = `${initPos.right}px`;

  /* ── 설정 토글 ── */
  btnSettings.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.classList.toggle("show-settings");
    requestAnimationFrame(() => clampNow());
  });

  /* ── 인라인(고정) 모드 위치 관리 ── */
  function cleanupInlineOverlayHosts() {
    document.querySelectorAll(".igx-inline-overlay-host").forEach(el => {
      el.classList.remove("igx-inline-overlay-host");
    });
  }

  function ensureInlinePosition() {
    // 케이브덕 채팅 form: <form data-tour="chat-input" class="... relative ...">
    const form = document.querySelector('form[data-tour="chat-input"]');
    if (!form) return;
    // 이미 올바른 위치에 있으면 스킵
    if (popup.parentNode === form && form.classList.contains("igx-inline-overlay-host")) return;
    cleanupInlineOverlayHosts();
    form.classList.add("igx-inline-overlay-host");
    form.appendChild(popup);
  }

  /* ── 레이아웃 전환 ── */
  function updateLayout() {
    const isInline    = localStorage.getItem(STORE_KEY_INLINE) === "1";
    const baseLayout  = localStorage.getItem(STORE_KEY_LAYOUT) === "bar" ? "bar" : "card";

    popup.classList.remove("card", "bar", "inline", "show-settings");

    if (isInline) {
      popup.classList.add("inline");
      btnPin.textContent = "↗";
      btnPin.title = "팝업으로 분리";
      ensureInlinePosition();
    } else {
      cleanupInlineOverlayHosts();
      popup.classList.add(baseLayout);
      btnPin.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>';
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
    const next = localStorage.getItem(STORE_KEY_LAYOUT) === "bar" ? "card" : "bar";
    localStorage.setItem(STORE_KEY_LAYOUT, next);
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

  /* ── 폴링 / 리사이즈 ── */
  setInterval(refreshAll, POLL_MS);
  setTimeout(refreshAll, 800);
  window.addEventListener("resize", () => clampNow(), { passive: true });

  // SPA 대응: 1초마다 인라인 위치 유지 확인
  setInterval(() => {
    if (popup.classList.contains("inline")) ensureInlinePosition();
  }, 1000);

  /* ── 드래그 (pointer 이벤트 단일화, touch/mouse 중복 방지) ── */
  let dragging = false;
  let dragSX = 0, dragSY = 0, dragST = 0, dragSR = 0;
  // pointer 캡처 사용 중이면 mouse 이벤트 무시
  let usingPointer = false;

  function isInteractive(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(".igx-btn, a, input, label");
  }

  function startDrag(clientX, clientY) {
    if (popup.classList.contains("inline")) return;
    dragging = true;
    dragSX = clientX;
    dragSY = clientY;
    dragST = px(getComputedStyle(popup).top);
    dragSR = px(getComputedStyle(popup).right);
  }

  function moveDrag(clientX, clientY) {
    if (!dragging) return;
    applyClampedPosition(dragST + (clientY - dragSY), dragSR - (clientX - dragSX));
  }

  function endDrag() {
    dragging = false;
  }

  // ── Pointer 이벤트 (가장 우선, 터치+마우스 통합) ──
  popup.addEventListener("pointerdown", (e) => {
    if (isInteractive(e.target)) return;
    try { popup.setPointerCapture(e.pointerId); } catch {}
    usingPointer = true;
    startDrag(e.clientX, e.clientY);
    e.preventDefault();
  });

  popup.addEventListener("pointermove", (e) => {
    if (!usingPointer) return;
    moveDrag(e.clientX, e.clientY);
  });

  popup.addEventListener("pointerup", (e) => {
    usingPointer = false;
    endDrag();
  });

  popup.addEventListener("pointercancel", () => {
    usingPointer = false;
    endDrag();
  });

  // ── Mouse 이벤트 (pointer 미지원 폴백) ──
  popup.addEventListener("mousedown", (e) => {
    if (usingPointer) return; // pointer 이벤트가 처리 중이면 스킵
    if (isInteractive(e.target)) return;
    startDrag(e.clientX, e.clientY);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (usingPointer) return;
    moveDrag(e.clientX, e.clientY);
  }
  function onMouseUp() {
    endDrag();
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }

  /* ── 테마 감지 (케이브덕: <html class="light"> / "dark") ── */
  function applyTheme() {
    const isLight = document.documentElement.classList.contains("light");
    popup.classList.toggle("igx-light", isLight);
  }

  applyTheme();
  const themeObserver = new MutationObserver(() => applyTheme());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  document.documentElement.appendChild(popup);
})();

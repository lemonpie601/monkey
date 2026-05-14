// ==UserScript==
// @name         유니 라디오존데
// @namespace    igx-radiosonde-univers
// @version      5.0.0
// @description  유니버스챗에서 라디오존데 수치를 팝업 또는 채팅창 인라인으로 표시
// @author       레몬파이
// @match        https://www.univers.chat/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      rs.igx.kr
// ==/UserScript==

(() => {
  "use strict";

  const MODELS = [
    { slug: "claude-opus-4.7",   label: "Claude 4.7 Opus",  short: "O4.7" },
    { slug: "claude-opus-4.6",   label: "Claude 4.6 Opus",  short: "O4.6" },
    { slug: "claude-sonnet-4.6", label: "Claude 4.6 Sonnet",short: "S4.6" },
    { slug: "gemini-3-1-pro",    label: "Gemini 3.1 Pro",   short: "G3.1" },
    { slug: "gemini-2.5-pro",    label: "Gemini 2.5 Pro",   short: "G2.5" },
  ];

  const API_BASE = "https://rs.igx.kr/api/simple/";
  const POLL_MS  = 60 * 1000;

  const KEY_LAYOUT = "uni_rs_layout_v1";   // "card" | "bar"
  const KEY_INLINE = "uni_rs_inline_v1";   // "1" | "0"
  const KEY_TOP    = "uni_rs_top_v1";
  const KEY_RIGHT  = "uni_rs_right_v1";
  const KEY_VIS    = "uni_rs_vis_v1";

  // ── 유니챗 테마: html에 "dark" 클래스 없을 수 있으므로 배경 밝기로 판단 ──
  // 유니챗은 입력창이 항상 라이트 계열이므로 기본 light 처리,
  // html/body dark 클래스 있으면 dark
  function isLight() {
    return !document.documentElement.classList.contains("dark") &&
           !document.body.classList.contains("dark");
  }

  // ── 유니챗 색상 변수 (라이트/다크 각각) ──
  // 케덕과 달리 유니챗은:
  //   라이트: 흰 배경 계열, 그림자 있음
  //   다크: zinc-900 계열
  // P1(#FF4D77) 강조색 사용

  const P1 = "#FF4D77";

  GM_addStyle(`
    /* =============================================
       유니 라디오존데 v5
       레이아웃: 케덕과 동일
       디자인: 유니챗 스타일 (Pretendard, rounded-xl, 흰/zinc 배경)
    ============================================= */

    #uni-rs-popup {
      /* 다크 기본값 */
      --rs-bg:          rgba(24, 24, 27, 0.95);
      --rs-bg-head:     rgba(255,255,255,0.04);
      --rs-bg-settings: rgba(0,0,0,0.20);
      --rs-bg-bitem:    rgba(255,255,255,0.06);
      --rs-border:      rgba(255,255,255,0.10);
      --rs-border-head: rgba(255,255,255,0.07);
      --rs-border-row:  rgba(255,255,255,0.07);
      --rs-btn-border:  rgba(255,255,255,0.12);
      --rs-btn-bg:      rgba(255,255,255,0.07);
      --rs-btn-hover:   rgba(255,255,255,0.13);
      --rs-text-title:  rgba(255,255,255,0.88);
      --rs-text-name:   rgba(255,255,255,0.82);
      --rs-text-metric: rgba(255,255,255,0.55);
      --rs-text-muted:  rgba(255,255,255,0.40);
      --rs-text-foot:   rgba(255,255,255,0.35);

      --rs-active:   #3ddc84;
      --rs-degraded: #ffd54a;
      --rs-impacted: #ff5c5c;
      --rs-unknown:  #9aa0a6;
      --rs-fail:     #ff9b9b;
    }

    /* 라이트 모드 */
    #uni-rs-popup.uni-rs-light {
      --rs-bg:          rgba(255,255,255,0.96);
      --rs-bg-head:     rgba(0,0,0,0.025);
      --rs-bg-settings: rgba(0,0,0,0.03);
      --rs-bg-bitem:    rgba(0,0,0,0.04);
      --rs-border:      rgba(0,0,0,0.09);
      --rs-border-head: rgba(0,0,0,0.07);
      --rs-border-row:  rgba(0,0,0,0.06);
      --rs-btn-border:  rgba(0,0,0,0.12);
      --rs-btn-bg:      rgba(0,0,0,0.05);
      --rs-btn-hover:   rgba(0,0,0,0.10);
      --rs-text-title:  rgba(0,0,0,0.85);
      --rs-text-name:   rgba(0,0,0,0.78);
      --rs-text-metric: rgba(0,0,0,0.55);
      --rs-text-muted:  rgba(0,0,0,0.38);
      --rs-text-foot:   rgba(0,0,0,0.35);

      --rs-active:   #1da851;
      --rs-degraded: #d49500;
      --rs-impacted: #e03535;
      --rs-unknown:  #71717a;
      --rs-fail:     #e03535;
    }

    /* ── 팝업 베이스 ── */
    #uni-rs-popup {
      position: fixed;
      width: 260px;
      background: var(--rs-bg);
      border: 1px solid var(--rs-border);
      /* 유니챗: 케덕(10px)보다 큰 rounded-xl */
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.14);
      z-index: 999999;
      overflow: visible;
      font-family: 'Pretendard','Apple SD Gothic Neo','Noto Sans KR',system-ui,sans-serif;
      font-size: 13px;
      user-select: none;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      cursor: grab;
      color: var(--rs-text-title);
      transition: background 0.2s, border-color 0.2s, color 0.2s;
    }
    #uni-rs-inner {
      border-radius: 14px;
      overflow: hidden;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,.12) transparent;
    }
    #uni-rs-popup.uni-rs-light #uni-rs-inner {
      scrollbar-color: rgba(0,0,0,.12) transparent;
    }
    #uni-rs-popup:active { cursor: grabbing; }
    #uni-rs-popup * { box-sizing: border-box; }

    /* ── 헤더 ── */
    #uni-rs-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 8px 9px;
      background: var(--rs-bg-head);
      border-bottom: 1px solid var(--rs-border-head);
      gap: 6px;
      overflow: hidden !important;
    }
    #uni-rs-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
      overflow: hidden;
    }
    #uni-rs-title {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      opacity: 0.65;
      letter-spacing: -0.1px;
    }
    #uni-rs-actions {
      display: flex;
      gap: 3px;
      align-items: center;
      flex: 0 0 auto;
    }

    /* ── 버튼 — 유니챗: rounded-lg ── */
    .uni-rs-btn {
      width: 26px; height: 26px;
      border-radius: 8px;
      border: 1px solid var(--rs-btn-border);
      background: var(--rs-btn-bg);
      color: var(--rs-text-title);
      cursor: pointer;
      display: flex; justify-content: center; align-items: center;
      font-size: 13px; line-height: 1;
      transition: background 0.12s, border-color 0.12s, opacity 0.12s;
      position: relative;
    }
    .uni-rs-btn::after { content:''; position:absolute; inset:-6px; }
    .uni-rs-btn:hover {
      background: var(--rs-btn-hover);
    }
    .uni-rs-btn:active { opacity: 0.65; }

    /* ── 바디 ── */
    #uni-rs-body { padding: 8px 9px 7px; }

    .uni-rs-row {
      padding: 6px 0;
      border-bottom: 1px solid var(--rs-border-row);
    }
    .uni-rs-row:last-of-type { border-bottom: none; }

    .uni-rs-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 4px;
    }
    .uni-rs-name {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--rs-text-name);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1 1 auto;
      min-width: 0;
      letter-spacing: -0.2px;
    }
    .uni-rs-state {
      font-size: 10.5px;
      font-weight: 700;
      white-space: nowrap;
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 4px;
    }
    .uni-rs-dot {
      width: 6px; height: 6px;
      border-radius: 999px;
      display: inline-block;
      flex-shrink: 0;
    }
    .uni-rs-metric {
      margin-top: 3px;
      font-size: 11.5px;
      color: var(--rs-text-metric);
      line-height: 1.4;
      letter-spacing: -0.1px;
    }
    .uni-rs-score { font-weight: 800; }
    .uni-rs-fail  { font-weight: 800; color: var(--rs-fail); }

    /* 상태 색상 */
    .rs-s-active   .uni-rs-dot { background: var(--rs-active); }
    .rs-s-degraded .uni-rs-dot { background: var(--rs-degraded); }
    .rs-s-impacted .uni-rs-dot { background: var(--rs-impacted); }
    .rs-s-unknown  .uni-rs-dot { background: var(--rs-unknown); }

    .rs-s-active   .uni-rs-state .stxt { color: var(--rs-active); }
    .rs-s-degraded .uni-rs-state .stxt { color: var(--rs-degraded); }
    .rs-s-impacted .uni-rs-state .stxt { color: var(--rs-impacted); }
    .rs-s-unknown  .uni-rs-state .stxt { color: var(--rs-unknown); }

    .rs-s-active   .uni-rs-score { color: var(--rs-active); }
    .rs-s-degraded .uni-rs-score { color: var(--rs-degraded); }
    .rs-s-impacted .uni-rs-score { color: var(--rs-impacted); }
    .rs-s-unknown  .uni-rs-score { color: var(--rs-text-muted); }

    /* ── 설정 영역 ── */
    #uni-rs-settings {
      display: none;
      padding: 8px 9px;
      background: var(--rs-bg-settings);
    }
    .uni-rs-set-hint {
      font-size: 11px;
      color: var(--rs-text-muted);
      margin-bottom: 7px;
      text-align: center;
    }
    .uni-rs-set-row {
      display: flex;
      align-items: center;
      padding: 5px 2px;
      border-bottom: 1px solid var(--rs-border-row);
      font-size: 12.5px;
      color: var(--rs-text-name);
    }
    .uni-rs-set-row:last-child { border-bottom: none; }
    .uni-rs-set-label {
      display: flex; align-items: center; gap: 8px;
      cursor: pointer; flex: 1; margin: 0;
      min-height: 34px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .uni-rs-set-chk {
      margin: 0; width: 14px; height: 14px;
      accent-color: ${P1};
      cursor: pointer; flex-shrink: 0;
    }

    #uni-rs-popup.show-settings #uni-rs-settings { display: block; }
    #uni-rs-popup.show-settings #uni-rs-body     { display: none; }

    /* ── 푸터 ── */
    #uni-rs-foot {
      margin-top: 5px; padding-top: 5px;
      border-top: 1px solid var(--rs-border-row);
      font-size: 10.5px;
      color: var(--rs-text-foot);
      display: flex; justify-content: space-between; align-items: center;
    }
    #uni-rs-foot a {
      color: rgba(100,180,255,.78);
      text-decoration: none;
      border-bottom: 1px dotted rgba(100,180,255,.28);
    }

    /* ── BAR 모드 ── */
    #uni-rs-popup.bar {
      width: auto;
      max-width: calc(100vw - 24px);
      border-radius: 999px;
    }
    #uni-rs-popup.bar #uni-rs-body,
    #uni-rs-popup.bar #uni-rs-settings,
    #uni-rs-popup.bar .btn-settings,
    #uni-rs-popup.bar #uni-rs-title { display: none; }

    /* ── INLINE 모드 ── */
    .uni-rs-inline-host { position: relative !important; }

    #uni-rs-popup.inline {
      position: absolute !important;
      bottom: calc(100% + 6px) !important;
      top: auto !important; left: 0 !important; right: 0 !important;
      width: auto !important; max-width: none !important;
      /* 유니챗 고유: 케덕은 완전 투명, 유니는 연한 frosted 배경 */
      background: rgba(0,0,0,0.05) !important;
      border: none !important;
      box-shadow: none !important;
      backdrop-filter: blur(10px) !important;
      -webkit-backdrop-filter: blur(10px) !important;
      cursor: default !important;
      margin: 0 !important; padding: 0 !important;
      border-radius: 12px 12px 0 0 !important;
      z-index: 3 !important;
      overflow: visible !important;
      pointer-events: none !important;
    }
    #uni-rs-popup.uni-rs-light.inline {
      background: rgba(0,0,0,0.04) !important;
    }
    #uni-rs-popup.inline #uni-rs-head {
      background: transparent;
      border: none;
      padding: 5px 8px 5px !important;
      min-height: 0 !important;
      gap: 4px !important;
      pointer-events: auto;
    }
    #uni-rs-popup.inline #uni-rs-body,
    #uni-rs-popup.inline #uni-rs-settings,
    #uni-rs-popup.inline .btn-layout,
    #uni-rs-popup.inline .btn-settings,
    #uni-rs-popup.inline #uni-rs-title { display: none; }
    #uni-rs-popup.inline .uni-rs-btn {
      width: 20px !important; height: 20px !important;
      padding: 0 !important;
      background: transparent; border-color: transparent;
      opacity: 0.55;
    }
    #uni-rs-popup.inline .uni-rs-btn::after { inset: -8px; }
    #uni-rs-popup.inline .uni-rs-btn:hover {
      background: var(--rs-btn-bg); opacity: 1;
    }
    /* inline bitem: 배경 없이 깔끔하게 */
    #uni-rs-popup.inline .rs-bitem {
      background: transparent !important;
      border: none !important;
      padding: 1px 4px !important;
      gap: 5px !important;
    }
    #uni-rs-popup.inline .rs-bdot { width: 6px !important; height: 6px !important; }

    /* ── 바라인 (bar/inline 공통) ── */
    #uni-rs-barline {
      display: none;
      align-items: center;
      gap: 4px;
      min-width: 0; flex: 1;
      white-space: nowrap;
      font-size: 11px;
      overflow-x: auto;
      overflow-y: hidden; /* 세로 화살표 원천 차단 */
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    /* 모든 요소의 스크롤바 UI 강제 제거 */
    #uni-rs-barline::-webkit-scrollbar,
    #uni-rs-head::-webkit-scrollbar,
    .rs-bitem::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }
    #uni-rs-popup.bar    #uni-rs-barline,
    #uni-rs-popup.inline #uni-rs-barline { display: flex; }

    /* bitem 칩 — 유니챗: rounded-full + Pretendard */
    .rs-bitem {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 0px 8px; height: 22px; line-height: 22px;
      border-radius: 9999px;
      border: 1px solid var(--rs-btn-border);
      background: var(--rs-bg-bitem);
      font-size: 11.5px;
      white-space: nowrap; flex-shrink: 0;
      overflow: hidden !important; -ms-overflow-style: none; scrollbar-width: none;
    }
    .rs-bitem::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }
    .rs-bname  { font-weight: 700; color: var(--rs-text-title); opacity: .9; }
    .rs-bscore { font-weight: 900; }
    .rs-blat   { opacity: .65; color: var(--rs-text-name); }
    .rs-bdot {
      width: 6px; height: 6px;
      border-radius: 999px;
      display: block; flex-shrink: 0;
    }

    .b-active   .rs-bdot   { background: var(--rs-active); }
    .b-degraded .rs-bdot   { background: var(--rs-degraded); }
    .b-impacted .rs-bdot   { background: var(--rs-impacted); }
    .b-unknown  .rs-bdot   { background: var(--rs-unknown); }

    .b-active   .rs-bscore { color: var(--rs-active); }
    .b-degraded .rs-bscore { color: var(--rs-degraded); }
    .b-impacted .rs-bscore { color: var(--rs-impacted); }
    .b-unknown  .rs-bscore { color: var(--rs-text-muted); }

    /* inline 전용 아이콘 */
    .inline-icon {
      display: none;
      width: 13px; height: 13px;
      opacity: 0.50;
      color: var(--rs-text-title);
      flex-shrink: 0;
      margin-right: 1px;
    }
    #uni-rs-popup.inline .inline-icon { display: block; }

    /* ── 모바일 ── */
    @media (max-width: 640px) {
      #uni-rs-popup.bar {
        width: auto !important; max-width: none !important;
        left: 4px !important; right: 4px !important;
        border-radius: 14px !important;
      }
      #uni-rs-popup.bar #uni-rs-head { padding: 8px 10px; }
      #uni-rs-popup.bar .rs-bitem {
        flex: 1 1 0; justify-content: center;
        padding: 5px 4px; min-width: 0; gap: 4px;
      }
      #uni-rs-popup.card { width: 220px; }
      #uni-rs-popup.inline #uni-rs-head { padding: 5px 8px 6px !important; }
    }
  `);

  // ==========================================
  // 유틸
  // ==========================================
  function px(v) { const n = Number(String(v).replace("px","")); return Number.isFinite(n) ? n : 0; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmt2(x) { const n=Number(x); return Number.isFinite(n)?n.toFixed(2):null; }
  function fmt0(x) { const n=Number(x); return Number.isFinite(n)?Math.round(n).toString():null; }
  function latSec(v) { const n=Number(v); if(!Number.isFinite(n))return null; return (n>=50?n/1000:n).toFixed(2); }

  // ==========================================
  // 가시성
  // ==========================================
  let visibility = {};
  try { visibility = JSON.parse(localStorage.getItem(KEY_VIS)) || {}; } catch {}
  MODELS.forEach(m => { if (visibility[m.slug] === undefined) visibility[m.slug] = true; });

  // ==========================================
  // DOM 생성 — 케덕과 동일한 구조
  // ==========================================
  const popup = document.createElement("div");
  popup.id = "uni-rs-popup";

  const head = document.createElement("div");
  head.id = "uni-rs-head";

  const left = document.createElement("div");
  left.id = "uni-rs-left";

  const inlineIcon = document.createElement("div");
  inlineIcon.className = "inline-icon";
  inlineIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:100%;height:100%;"><path d="M2 12h4l2.25-11.25a.5.5 0 0 1 .98 0l4.54 22.5a.5.5 0 0 0 .98 0L17 12h5"/></svg>`;

  const title = document.createElement("div");
  title.id = "uni-rs-title";
  title.textContent = "Radiosonde";

  const barline = document.createElement("div");
  barline.id = "uni-rs-barline";
  barline.textContent = "불러오는 중…";

  left.append(inlineIcon, title, barline);

  const actions = document.createElement("div");
  actions.id = "uni-rs-actions";

  const btnRefresh = document.createElement("button");
  btnRefresh.className = "uni-rs-btn";
  btnRefresh.title = "갱신";
  btnRefresh.textContent = "↻";

  const btnSettings = document.createElement("button");
  btnSettings.className = "uni-rs-btn btn-settings";
  btnSettings.title = "모델 설정";
  btnSettings.textContent = "⚙";

  const btnLayout = document.createElement("button");
  btnLayout.className = "uni-rs-btn btn-layout";
  btnLayout.title = "레이아웃 전환";
  btnLayout.textContent = "↔";

  const btnPin = document.createElement("button");
  btnPin.className = "uni-rs-btn btn-pin";
  btnPin.title = "채팅창에 고정";
  btnPin.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

  actions.append(btnRefresh, btnSettings, btnLayout, btnPin);
  head.append(left, actions);

  // ── 바디 (card 모드) ──
  const body = document.createElement("div");
  body.id = "uni-rs-body";

  const settingsArea = document.createElement("div");
  settingsArea.id = "uni-rs-settings";
  settingsArea.innerHTML = `<div class="uni-rs-set-hint">표시할 모델을 선택하세요</div>`;

  const rows = new Map();

  for (const m of MODELS) {
    const row = document.createElement("div");
    row.className = "uni-rs-row rs-s-unknown";
    row.style.display = visibility[m.slug] ? "" : "none";

    const top = document.createElement("div");
    top.className = "uni-rs-top";

    const name = document.createElement("div");
    name.className = "uni-rs-name";
    name.textContent = m.label;
    name.title = m.label;

    const state = document.createElement("div");
    state.className = "uni-rs-state";
    state.innerHTML = `<span class="uni-rs-dot"></span><span class="stxt">WAIT</span>`;

    top.append(name, state);

    const metric = document.createElement("div");
    metric.className = "uni-rs-metric";
    metric.textContent = "불러오는 중…";

    row.append(top, metric);
    body.appendChild(row);
    rows.set(m.slug, { row, state, metric });

    // 설정 행
    const sRow = document.createElement("div");
    sRow.className = "uni-rs-set-row";
    const sLabel = document.createElement("label");
    sLabel.className = "uni-rs-set-label";
    sLabel.title = m.label;
    const sChk = document.createElement("input");
    sChk.type = "checkbox";
    sChk.className = "uni-rs-set-chk";
    sChk.checked = visibility[m.slug];
    sChk.addEventListener("change", e => {
      visibility[m.slug] = e.target.checked;
      localStorage.setItem(KEY_VIS, JSON.stringify(visibility));
      rows.get(m.slug).row.style.display = visibility[m.slug] ? "" : "none";
      renderBarline();
      requestAnimationFrame(() => clampNow());
    });
    sLabel.append(sChk, document.createTextNode(" " + m.label));
    sRow.append(sLabel);
    settingsArea.appendChild(sRow);
  }

  const foot = document.createElement("div");
  foot.id = "uni-rs-foot";
  foot.innerHTML = `<span class="ts">—</span><a href="https://rs.igx.kr/" target="_blank" rel="noreferrer">rs.igx.kr</a>`;
  body.appendChild(foot);

  const inner = document.createElement("div");
  inner.id = "uni-rs-inner";
  inner.append(head, body, settingsArea);
  popup.append(inner);

  // ==========================================
  // 헬퍼
  // ==========================================
  function setFooter(t) { foot.querySelector(".ts").textContent = t; }

  function setStateClass(el, status) {
    el.classList.remove("rs-s-active","rs-s-degraded","rs-s-impacted","rs-s-unknown");
    el.classList.add(`rs-s-${["active","degraded","impacted"].includes(status) ? status : "unknown"}`);
  }

  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method:"GET", url, timeout:6000,
        headers:{Accept:"application/json"},
        onload: r => { try{resolve(JSON.parse(r.responseText));}catch(e){reject(e);} },
        onerror: reject,
        ontimeout: ()=>reject(new Error("timeout")),
      });
    });
  }

  // ==========================================
  // 바라인 렌더
  // ==========================================
  const last = new Map();

  function renderBarline() {
    const parts = MODELS
      .filter(m => visibility[m.slug])
      .map(m => {
        const d = last.get(m.slug) || { status:"unknown", score:"—", lat:"—" };
        return `<span class="rs-bitem b-${d.status||"unknown"}"><span class="rs-bdot"></span><span class="rs-bname">${m.short}</span><span class="rs-bscore">${d.score??"—"}</span><span class="rs-blat">${d.lat??"—"}s</span></span>`;
      }).join("");
    barline.innerHTML = parts || `<span style="opacity:0.45;padding:0 4px;">선택된 모델 없음</span>`;
  }

  // ==========================================
  // 데이터 갱신
  // ==========================================
  async function refreshAll() {
    setFooter("갱신중…");
    const results = await Promise.allSettled(
      MODELS.map(m => gmGetJson(API_BASE + encodeURIComponent(m.slug)))
    );

    for (let i = 0; i < MODELS.length; i++) {
      const m   = MODELS[i];
      const ui  = rows.get(m.slug);
      const res = results[i];

      if (res.status !== "fulfilled" || !res.value || res.value.success !== true) {
        setStateClass(ui.row, "unknown");
        ui.state.querySelector(".stxt").textContent = "ERROR";
        ui.metric.textContent = "요청 실패";
        last.set(m.slug, { status:"unknown", score:"—", lat:"—" });
        continue;
      }

      const d      = res.value.data;
      const status = d.status || "unknown";
      setStateClass(ui.row, status);
      ui.state.querySelector(".stxt").textContent = String(status).toUpperCase();

      const lat   = latSec(d.latency);
      const tps   = fmt2(d.tps);
      const score = fmt0(d.score);
      const fail  = Number.isFinite(Number(d.failureCount)) ? Number(d.failureCount) : 0;

      last.set(m.slug, { status, score: score??"—", lat: lat??"—" });

      const scoreHtml = `<span class="uni-rs-score">${score!=null?score+"점":"—점"}</span>`;
      const failHtml  = fail > 0 ? ` · <span class="uni-rs-fail">실패 ${fail}</span>` : "";
      ui.metric.innerHTML = `응답 ${lat??"—"}s · TPS ${tps??"—"} · ${scoreHtml}${failHtml}`;
    }

    renderBarline();
    setFooter(`수신 ${new Date().toLocaleTimeString()}`);
  }

  // ==========================================
  // 위치 관리
  // ==========================================
  const EDGE = 8;

  function loadPos() {
    return {
      top:   parseInt(localStorage.getItem(KEY_TOP)  || "120", 10),
      right: parseInt(localStorage.getItem(KEY_RIGHT) || "16",  10),
    };
  }
  function savePos(t, r) {
    localStorage.setItem(KEY_TOP,   t);
    localStorage.setItem(KEY_RIGHT, r);
  }
  function applyPos(targetTop, targetRight) {
    if (popup.classList.contains("inline")) return;
    const rect = popup.getBoundingClientRect();
    const t = clamp(targetTop,   EDGE, Math.max(0, window.innerHeight - rect.height - EDGE));
    const r = clamp(targetRight, 0,    Math.max(0, window.innerWidth  - rect.width  - EDGE));
    popup.style.top    = `${t}px`;
    popup.style.right  = `${r}px`;
    popup.style.bottom = "auto";
    savePos(t, r);
  }
  function clampNow() {
    applyPos(px(getComputedStyle(popup).top), px(getComputedStyle(popup).right));
  }

  const initPos = loadPos();
  popup.style.top   = `${initPos.top}px`;
  popup.style.right = `${initPos.right}px`;

  // ==========================================
  // 설정 토글
  // ==========================================
  btnSettings.addEventListener("click", e => {
    e.stopPropagation();
    popup.classList.toggle("show-settings");
    requestAnimationFrame(() => clampNow());
  });

  // ==========================================
  // 인라인 모드
  // ==========================================
  function getInputForm() {
    // 유니챗 입력창: textarea[placeholder] → 가장 가까운 form 또는 div wrapper
    const ta = document.querySelector("textarea[placeholder]");
    if (!ta) return null;
    return ta.closest("form") || ta.closest("div[class*='rounded-t']")?.parentElement || null;
  }

  function cleanupInlineHosts() {
    document.querySelectorAll(".uni-rs-inline-host").forEach(el => el.classList.remove("uni-rs-inline-host"));
  }

  function ensureInlinePosition() {
    const form = getInputForm();
    if (!form) return;
    if (popup.parentNode === form && form.classList.contains("uni-rs-inline-host")) return;
    cleanupInlineHosts();
    form.classList.add("uni-rs-inline-host");
    form.appendChild(popup);
  }

  // ==========================================
  // 레이아웃 전환
  // ==========================================
  function updateLayout() {
    const isInline   = localStorage.getItem(KEY_INLINE) === "1";
    const baseLayout = localStorage.getItem(KEY_LAYOUT) === "bar" ? "bar" : "card";

    popup.classList.remove("card","bar","inline","show-settings");

    if (isInline) {
      popup.classList.add("inline");
      btnPin.textContent = "↗";
      btnPin.title = "팝업으로 분리";
      ensureInlinePosition();
    } else {
      cleanupInlineHosts();
      popup.classList.add(baseLayout);
      btnPin.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;
      btnPin.title = "채팅창에 고정";
      if (popup.parentNode !== document.documentElement) {
        document.documentElement.appendChild(popup);
      }
      requestAnimationFrame(() => clampNow());
    }
  }

  if (!localStorage.getItem(KEY_LAYOUT)) {
    localStorage.setItem(KEY_LAYOUT, window.innerWidth <= 520 ? "bar" : "card");
  }
  updateLayout();

  btnLayout.addEventListener("click", e => {
    e.stopPropagation();
    localStorage.setItem(KEY_LAYOUT, localStorage.getItem(KEY_LAYOUT) === "bar" ? "card" : "bar");
    updateLayout();
  });

  btnPin.addEventListener("click", e => {
    e.stopPropagation();
    localStorage.setItem(KEY_INLINE, localStorage.getItem(KEY_INLINE) === "1" ? "0" : "1");
    updateLayout();
  });

  btnRefresh.addEventListener("click", e => { e.stopPropagation(); refreshAll(); });

  // ==========================================
  // 드래그
  // ==========================================
  let dragging = false, dragSX=0, dragSY=0, dragST=0, dragSR=0, usingPointer=false;

  function isInteractive(t) { return t?.closest?.(".uni-rs-btn,a,input,label"); }
  function startDrag(x,y) {
    if (popup.classList.contains("inline")) return;
    dragging=true; dragSX=x; dragSY=y;
    dragST=px(getComputedStyle(popup).top); dragSR=px(getComputedStyle(popup).right);
  }
  function moveDrag(x,y) { if(dragging) applyPos(dragST+(y-dragSY), dragSR-(x-dragSX)); }
  function endDrag() { dragging=false; }

  popup.addEventListener("pointerdown", e => {
    if (isInteractive(e.target)) return;
    try { popup.setPointerCapture(e.pointerId); } catch{}
    usingPointer=true; startDrag(e.clientX,e.clientY); e.preventDefault();
  });
  popup.addEventListener("pointermove", e => { if(usingPointer) moveDrag(e.clientX,e.clientY); });
  popup.addEventListener("pointerup",   () => { usingPointer=false; endDrag(); });
  popup.addEventListener("pointercancel",()=>{ usingPointer=false; endDrag(); });
  popup.addEventListener("mousedown", e => {
    if(usingPointer||isInteractive(e.target)) return;
    startDrag(e.clientX,e.clientY);
    document.addEventListener("mousemove", onMM);
    document.addEventListener("mouseup",   onMU);
    e.preventDefault();
  });
  function onMM(e) { if(!usingPointer) moveDrag(e.clientX,e.clientY); }
  function onMU()  { endDrag(); document.removeEventListener("mousemove",onMM); document.removeEventListener("mouseup",onMU); }

  // ==========================================
  // 테마 감지 — 유니챗: html.dark 또는 html.light
  // ==========================================
  function applyTheme() {
    popup.classList.toggle("uni-rs-light", isLight());
  }
  applyTheme();
  new MutationObserver(() => applyTheme())
    .observe(document.documentElement, { attributes:true, attributeFilter:["class"] });

  // ==========================================
  // SPA 대응
  // ==========================================
  setInterval(() => {
    if (popup.classList.contains("inline")) ensureInlinePosition();
  }, 1000);

  setInterval(() => refreshAll(), POLL_MS);
  setTimeout(() => refreshAll(), 800);
  window.addEventListener("resize", () => clampNow(), { passive:true });

  document.documentElement.appendChild(popup);

})();

// ==UserScript==
// @name         케덕 퀵입력
// @namespace    https://caveduck.io/
// @version      4.3.2
// @description  케이브덕 퀵입력
// @author       레몬파이
// @match        https://caveduck.io/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SEL_FORM   = 'form[data-tour="chat-input"]';
  const SEL_BTNBAR = 'form[data-tour="chat-input"] .order-first';
  const SEL_INPUT  = 'textarea[name="userInput"]';

  const S = {
    get: (k, d) => { try { return JSON.parse(GM_getValue(k, JSON.stringify(d))); } catch { return d; } },
    set: (k, v) => GM_setValue(k, JSON.stringify(v)),
  };

  let quick     = S.get('cdhq_q', []);
  let folders   = S.get('cdhq_f', []);
  let collapsed = S.get('cdhq_c', {});

  const save = () => { S.set('cdhq_q', quick); S.set('cdhq_f', folders); S.set('cdhq_c', collapsed); };
  const uid  = () => Math.random().toString(36).slice(2, 9);
  const esc  = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const FOLDER_COLORS = [
    '#7a7a7a','#bc1e51','#e05c2a','#d4a017','#4caf6e',
    '#2a9dd4','#7b61ff','#d461c8','#e07070','#5cc8c8',
  ];
  const DEFAULT_COLOR = '#7a7a7a';

  /* ── 입력창 삽입 ── */
  function insertText(text) {
    const el = document.querySelector(SEL_INPUT);
    if (!el) return;
    const s  = el.selectionStart ?? el.value.length;
    const e2 = el.selectionEnd   ?? el.value.length;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, el.value.slice(0, s) + text + el.value.slice(e2));
    else        el.value = el.value.slice(0, s) + text + el.value.slice(e2);
    el.selectionStart = el.selectionEnd = s + text.length;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.focus();
  }

  /* ── 드롭다운 싱글턴 ── */
  let _curDD = null, _curAnchor = null;
  function ddOpen(dd, anchor) {
    if (_curDD && _curDD !== dd) ddClose(_curDD);
    if (!document.body.contains(dd)) document.body.appendChild(dd);
    _curDD = dd; _curAnchor = anchor;
    dd.style.display = 'flex';
    ddPos(dd, anchor);
  }
  function ddClose(dd) {
    if (!dd) return;
    dd.style.display = 'none';
    if (_curDD === dd) { _curDD = null; _curAnchor = null; }
    document.querySelectorAll('.cdhq-btn.dd-open').forEach(b => b.classList.remove('dd-open'));
  }
  function ddPos(dd, anchor) {
    const r   = anchor.getBoundingClientRect();
    const dw  = dd.offsetWidth || 300;
    const gap = 6;
    const bottom = window.innerHeight - r.top + gap;
    let left = r.left + window.scrollX;
    if (left + dw > window.innerWidth - 8) left = window.innerWidth - dw - 8;
    if (left < 4) left = 4;
    dd.style.bottom    = bottom + 'px';
    dd.style.top       = 'auto';
    dd.style.left      = left + 'px';
    dd.style.maxHeight = (r.top - gap - 8) + 'px';
  }
  document.addEventListener('click',   () => { if (_curDD) ddClose(_curDD); });
  document.addEventListener('keydown', e  => { if (e.key === 'Escape' && _curDD) ddClose(_curDD); });

  /* ── SVG ── */
  const svgFolder = (color, open) => open
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="${color}"><path d="M2 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2H2V6z" opacity=".45"/><path d="M4 11a2 2 0 0 1 2-2h14a2 2 0 0 1 1.94 2.47l-1.5 6A2 2 0 0 1 18.5 19H4a2 2 0 0 1-2-2v-6z"/></svg>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="${color}"><path d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2H4z"/></svg>`;
  const svgChevron = open =>
    `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s;transform:rotate(${open?90:0}deg)"><polyline points="9 6 15 12 9 18"/></svg>`;
  /* folderCtx 제거 — ✕ 버튼 즉시 삭제 + 우클릭/롱프레스 → folderEditDD 직통 */

  /* ────────────────────────────────────────
     폴더 수정 드롭다운 (구분선 우클릭 → 열림)
  ──────────────────────────────────────── */
  const folderEditDD = document.createElement('div');
  folderEditDD.className = 'cdhq-dd';
  folderEditDD.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(folderEditDD);

  let _feFolder = null; // 현재 수정 중인 폴더 객체
  let _feColor  = DEFAULT_COLOR;

  function openFolderEditDD(folder) {
    _feFolder = folder;
    _feColor  = folder.color || DEFAULT_COLOR;

    folderEditDD.innerHTML = `
      <div class="cdhq-dd-title">📁 폴더 수정</div>
      <div class="cdhq-field"><span class="cdhq-lbl">이름</span><input class="cdhq-input fe-name" value="${esc(folder.name)}" maxlength="20"></div>
      <div class="cdhq-field"><span class="cdhq-lbl">색상</span><div class="cdhq-color-row fe-colors"></div></div>
      <div class="cdhq-dd-row">
        <button class="cdhq-dd-save fe-ok">저장</button>
        <button class="cdhq-dd-cancel fe-cancel">취소</button>
      </div>
      <div class="cdhq-dd-row" style="margin-top:-4px">
        <button class="cdhq-dd-del fe-del">폴더 삭제</button>
      </div>
    `;

    // 색상 스와치
    function buildFeSwatches() {
      const row = folderEditDD.querySelector('.fe-colors');
      row.innerHTML = FOLDER_COLORS.map(c =>
        `<span class="cdhq-swatch${c === _feColor ? ' selected' : ''}" data-c="${c}" style="background:${c}"></span>`
      ).join('');
      row.querySelectorAll('.cdhq-swatch').forEach(sw => {
        sw.addEventListener('click', e => { e.stopPropagation(); _feColor = sw.dataset.c; buildFeSwatches(); });
      });
    }
    buildFeSwatches();

    folderEditDD.querySelector('.fe-ok').addEventListener('click', e => {
      e.stopPropagation();
      const name = folderEditDD.querySelector('.fe-name').value.trim();
      if (!name) { folderEditDD.querySelector('.fe-name').focus(); return; }
      _feFolder.name  = name;
      _feFolder.color = _feColor;
      save(); ddClose(folderEditDD); renderChips();
    });
    folderEditDD.querySelector('.fe-cancel').addEventListener('click', e => {
      e.stopPropagation(); ddClose(folderEditDD);
    });
    folderEditDD.querySelector('.fe-del').addEventListener('click', e => {
      e.stopPropagation();
      quick = quick.filter(q => q.folder !== _feFolder.id);
      folders = folders.filter(f => f.id !== _feFolder.id);
      delete collapsed[_feFolder.id];
      save(); ddClose(folderEditDD); renderChips();
    });
    folderEditDD.querySelector('.fe-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); folderEditDD.querySelector('.fe-ok')?.click(); }
    });

    // 앵커: 폴더 구분선 → 없으면 ＋ 버튼 → 없으면 chips 컨테이너
    const divEl  = document.querySelector(`.cdhq-divider.has-folder[data-fid="${folder.id}"]`);
    const anchor = divEl
      || document.getElementById('cdhq-chip-add')
      || document.getElementById('cdhq-chips')
      || document.querySelector(SEL_BTNBAR);
    ddOpen(folderEditDD, anchor);
    setTimeout(() => folderEditDD.querySelector('.fe-name')?.focus(), 60);
  }

  const ICON_Q = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>`;

  // 즐겨찾기 하트별 — checkbox 상태에 따라 두 레이어가 전환
  // checked 상태는 CSS로 처리하므로 SVG 두 개를 겹쳐서 opacity 전환
  const ICON_FAV = `<svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <!-- 빈 별 (기본) -->
    <path class="fav-empty" d="M12 2.5l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 15.9l-5.2 2.7 1-5.8L3.6 8.65l5.8-.85z"
      fill="none" stroke="#555" stroke-width="1.6" stroke-linejoin="round"/>
    <!-- 채워진 별 (checked) -->
    <path class="fav-filled" d="M12 2.5l2.6 5.3 5.8.85-4.2 4.1 1 5.8L12 15.9l-5.2 2.7 1-5.8L3.6 8.65l5.8-.85z"
      fill="#fdc700" stroke="#fdc700" stroke-width="1.6" stroke-linejoin="round" opacity="0"/>
    <!-- 작은 반짝임 점들 (checked 시만 표시) -->
    <g class="fav-sparkle" opacity="0">
      <circle cx="12" cy="0.8" r="1" fill="#fdc700"/>
      <circle cx="21.5" cy="6"  r="1" fill="#fdc700"/>
      <circle cx="21.5" cy="18" r="1" fill="#fdc700"/>
      <circle cx="12"   cy="23.2" r="1" fill="#fdc700"/>
      <circle cx="2.5"  cy="18" r="1" fill="#fdc700"/>
      <circle cx="2.5"  cy="6"  r="1" fill="#fdc700"/>
    </g>
  </svg>`;

  /* ────────────────────────────────────────
     스타일
  ──────────────────────────────────────── */
  document.head.insertAdjacentHTML('beforeend', `<style>
    :root {
      --q-fs:  clamp(12px,1.5vw,15px);
      --q-fss: clamp(11px,1.3vw,13px);
      --q-gap: clamp(4px,.7vw,8px);
      --q-pad: clamp(8px,1.1vw,12px);
      --q-btn: clamp(32px,4vw,38px);
      --q-acc:  #bc1e51; --q-acc2: #fdc700; --q-bg: #1a1a1a;
    }
    #cdhq-wrap { margin-bottom: 6px; }

    .cdhq-btn {
      display:inline-flex; align-items:center; justify-content:center;
      position:relative; width:var(--q-btn); height:var(--q-btn);
      border-radius:50%; border:none; background:transparent; color:#aaa;
      font-size:clamp(16px,2vw,20px); cursor:pointer; flex-shrink:0;
      -webkit-tap-highlight-color:transparent; touch-action:manipulation;
      transition:background .12s,color .12s;
    }
    .cdhq-btn:hover  { background:rgba(255,255,255,.08); color:#eee; }
    .cdhq-btn:active { opacity:.7; }
    .cdhq-btn.dd-open::after {
      content:''; position:absolute; bottom:3px; right:3px;
      width:5px; height:5px; border-radius:50%; background:var(--q-acc2); pointer-events:none;
    }

    #cdhq-chips {
      display:none; align-items:center; gap:var(--q-gap);
      padding:var(--q-gap) var(--q-pad) calc(var(--q-gap)*.5);
      overflow-x:auto; flex-wrap:nowrap; -webkit-overflow-scrolling:touch;
    }
    #cdhq-chips.open { display:flex; }
    #cdhq-chips::-webkit-scrollbar { display:none; }

    .cdhq-chip {
      display:inline-flex; align-items:center;
      height:clamp(26px,3.2vw,32px); padding:0 clamp(9px,1.2vw,13px);
      border-radius:20px; border:1px solid rgba(255,255,255,.13);
      background:rgba(255,255,255,.07); color:#ccc;
      font-size:var(--q-fss); font-weight:500; font-family:inherit;
      white-space:nowrap; flex-shrink:0; cursor:pointer;
      -webkit-tap-highlight-color:transparent;
      transition:background .1s,border-color .1s,opacity .1s;
      user-select:none; touch-action:manipulation;
    }
    .cdhq-chip:hover    { background:rgba(255,255,255,.13); color:#eee; }
    .cdhq-chip.dragging { opacity:.3; cursor:grabbing; }
    .cdhq-chip.drag-over { border-color:var(--q-acc2); background:rgba(253,199,0,.1); }
    .cdhq-chip.fav { border-color:rgba(253,199,0,.4); background:rgba(253,199,0,.08); color:#e8d080; }
    .cdhq-chip.fav:hover { background:rgba(253,199,0,.15); color:#f5e090; }
    .cdhq-chip-x {
      display:inline-flex; align-items:center; justify-content:center;
      width:14px; height:14px; margin-left:5px; margin-right:-3px;
      border-radius:50%; background:rgba(255,255,255,.14); border:none;
      color:#888; font-size:8px; cursor:pointer; line-height:1;
      -webkit-tap-highlight-color:transparent; transition:background .1s; flex-shrink:0;
    }
    .cdhq-chip-x:hover { background:var(--q-acc); color:#fff; }
    #cdhq-chip-add {
      cursor:pointer !important; background:rgba(188,30,81,.1) !important;
      border-color:rgba(188,30,81,.3) !important; color:var(--q-acc) !important;
      font-size:clamp(14px,1.6vw,17px) !important; padding:0 clamp(8px,1.1vw,12px) !important;
    }
    #cdhq-chip-add:hover { background:rgba(188,30,81,.2) !important; }

    .cdhq-divider {
      display:inline-flex; align-items:center; gap:5px;
      flex-shrink:0; margin:0 1px; user-select:none;
    }
    .cdhq-divider-line { width:1px; height:16px; background:rgba(255,255,255,.1); flex-shrink:0; }
    .cdhq-divider.has-folder {
      cursor:pointer; border-radius:6px; padding:2px 2px 2px 2px;
      transition:background .12s; gap:3px;
    }
    .cdhq-divider.has-folder:hover { background:rgba(255,255,255,.07); }
    .cdhq-divider.has-folder:hover .cdhq-divider-x { opacity:1; }
    .cdhq-divider-label { display:inline-flex; align-items:center; gap:4px; }
    .cdhq-divider-name  { font-size:10px; font-weight:600; letter-spacing:.04em; white-space:nowrap; }
    .cdhq-divider-chevron { display:inline-flex; align-items:center; }
    /* 폴더 구분선 ✕ 삭제 버튼 */
    .cdhq-divider-x {
      display:inline-flex; align-items:center; justify-content:center;
      width:13px; height:13px; border-radius:50%;
      background:rgba(255,255,255,.12); border:none;
      color:#666; font-size:7px; cursor:pointer; line-height:1;
      opacity:0; flex-shrink:0;
      -webkit-tap-highlight-color:transparent; transition:background .1s, opacity .15s;
    }
    .cdhq-divider-x:hover { background:var(--q-acc); color:#fff; opacity:1 !important; }
    /* 모바일: 항상 표시 */
    @media (hover:none) { .cdhq-divider-x { opacity:.55; } }

    /* 드롭다운 */
    .cdhq-dd {
      position:fixed; z-index:999999;
      flex-direction:column; gap:clamp(7px,1vw,11px);
      background:var(--q-bg); border:1px solid rgba(255,255,255,.11);
      border-radius:12px; box-shadow:0 -4px 28px rgba(0,0,0,.7),0 2px 8px rgba(0,0,0,.4);
      padding:clamp(12px,1.4vw,16px); width:clamp(260px,34vw,320px);
      display:none; overflow-y:auto;
    }
    @media (max-width:600px) { .cdhq-dd { width:min(340px,calc(100vw - 16px)); } }
    .cdhq-dd-title { font-size:var(--q-fss); font-weight:700; color:#666; }
    .cdhq-field { display:flex; flex-direction:column; gap:3px; }
    .cdhq-lbl   { font-size:var(--q-fss); color:#555; }
    .cdhq-input, .cdhq-textarea {
      width:100%; box-sizing:border-box;
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.09);
      border-radius:8px; color:#ddd; font-size:var(--q-fs); font-family:inherit;
      padding:clamp(6px,.8vw,9px) clamp(9px,1.1vw,12px);
      outline:none; -webkit-appearance:none; resize:none; transition:border-color .12s;
    }
    .cdhq-input:focus, .cdhq-textarea:focus { border-color:rgba(255,255,255,.28); }
    .cdhq-textarea { min-height:clamp(60px,8vw,90px); }

    /* 커스텀 폴더 선택 버튼 */
    .cdhq-folder-select-btn {
      display:flex; align-items:center; gap:7px;
      width:100%; box-sizing:border-box;
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.09);
      border-radius:8px; color:#ddd; font-size:var(--q-fs); font-family:inherit;
      padding:clamp(6px,.8vw,9px) clamp(9px,1.1vw,12px);
      cursor:pointer; text-align:left;
      -webkit-tap-highlight-color:transparent; transition:border-color .12s;
    }
    .cdhq-folder-select-btn:hover { border-color:rgba(255,255,255,.2); }
    .cdhq-folder-select-btn .fsb-arrow { margin-left:auto; color:#555; flex-shrink:0; }

    /* 폴더 선택 인라인 패널 */
    .cdhq-folder-panel {
      display:none; flex-direction:column; gap:2px;
      background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08);
      border-radius:8px; overflow-y:auto; margin-top:2px;
      max-height:160px;
    }
    .cdhq-folder-panel::-webkit-scrollbar { width:3px; }
    .cdhq-folder-panel::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:2px; }
    .cdhq-folder-panel.open { display:flex; }
    .cdhq-folder-opt {
      display:flex; align-items:center; gap:8px;
      padding:7px 10px; cursor:pointer; color:#aaa;
      font-size:var(--q-fss); font-family:inherit; transition:background .1s;
    }
    .cdhq-folder-opt:hover   { background:rgba(255,255,255,.06); color:#ddd; }
    .cdhq-folder-opt.selected { background:rgba(255,255,255,.08); color:#eee; }

    /* 폴더 신규 생성 인라인 패널 */
    .cdhq-new-folder-panel {
      display:none; flex-direction:column; gap:8px;
      background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.08);
      border-radius:8px; padding:10px; margin-top:2px;
    }
    .cdhq-new-folder-panel.open { display:flex; }
    .cdhq-new-folder-panel .nfp-title {
      font-size:var(--q-fss); font-weight:700; color:#555;
    }
    .cdhq-new-folder-panel .nfp-row { display:flex; gap:6px; }
    .cdhq-new-folder-panel .nfp-row button {
      flex:1; height:30px; border-radius:7px; border:none;
      font-size:var(--q-fss); font-weight:700; font-family:inherit;
      cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .1s;
    }
    .nfp-ok     { background:var(--q-acc); color:#fff; }
    .nfp-ok:hover { background:#a01a45; }
    .nfp-back   { background:rgba(255,255,255,.07); color:#888; }
    .nfp-back:hover { background:rgba(255,255,255,.13); }

    /* 색상 팔레트 */
    .cdhq-color-row { display:flex; gap:6px; flex-wrap:wrap; }
    .cdhq-swatch {
      width:20px; height:20px; border-radius:50%;
      border:2px solid transparent; cursor:pointer; flex-shrink:0;
      transition:transform .1s,border-color .1s;
    }
    .cdhq-swatch:hover   { transform:scale(1.18); }
    .cdhq-swatch.selected { border-color:#fff; transform:scale(1.12); }

    /* 즐겨찾기 */
    .cdhq-fav-toggle {
      display:inline-flex; align-items:center; gap:7px;
      cursor:pointer; color:#666; font-size:var(--q-fss);
      -webkit-tap-highlight-color:transparent; user-select:none;
    }
    .cdhq-fav-toggle input { display:none; }
    .cdhq-fav-star { display:inline-flex; align-items:center; line-height:1; flex-shrink:0; }
    .cdhq-fav-star svg { transition:opacity .15s, filter .15s; }
    .cdhq-fav-star .fav-filled   { transition:opacity .2s; }
    .cdhq-fav-star .fav-empty    { transition:opacity .2s; }
    .cdhq-fav-star .fav-sparkle  { transition:opacity .2s; }
    .cdhq-fav-toggle input:checked ~ .cdhq-fav-star .fav-filled  { opacity:1 !important; }
    .cdhq-fav-toggle input:checked ~ .cdhq-fav-star .fav-empty   { opacity:0 !important; }
    .cdhq-fav-toggle input:checked ~ .cdhq-fav-star .fav-sparkle { opacity:1 !important; }
    .cdhq-fav-toggle input:checked ~ .cdhq-fav-star svg { filter:drop-shadow(0 0 3px rgba(253,199,0,.6)); }
    .cdhq-fav-toggle input:checked ~ .cdhq-fav-lbl  { color:#bbb; }

    /* 버튼 행 */
    .cdhq-dd-row { display:flex; gap:var(--q-gap); }
    .cdhq-dd-row button {
      flex:1; height:clamp(34px,4vw,40px); border-radius:8px; border:none;
      font-size:var(--q-fs); font-weight:700; font-family:inherit;
      cursor:pointer; -webkit-tap-highlight-color:transparent;
      transition:background .1s; touch-action:manipulation;
    }
    .cdhq-dd-ok     { background:var(--q-acc); color:#fff; }
    .cdhq-dd-ok:hover { background:#a01a45; }
    .cdhq-dd-save   { background:var(--q-acc2); color:#111; }
    .cdhq-dd-save:hover { background:#e6b400; }
    .cdhq-dd-cancel { background:rgba(255,255,255,.07); color:#888; }
    .cdhq-dd-cancel:hover { background:rgba(255,255,255,.13); }
    .cdhq-dd-del    { background:rgba(188,30,81,.13); color:#e07070; }
    .cdhq-dd-del:hover { background:rgba(188,30,81,.28); }
    .cdhq-hint { font-size:10px; color:#333; text-align:center; }
  </style>`);

  /* ────────────────────────────────────────
     커스텀 폴더 선택 + 새 폴더 생성 위젯
     — 드롭다운 안에 완전히 인라인으로 펼침
  ──────────────────────────────────────── */
  function buildFolderWidget(root, initialFolderId) {
    let selectedId = initialFolderId || '';
    let newColor   = DEFAULT_COLOR;

    // root 안에 버튼 + 선택 패널 + 새 폴더 패널 렌더
    function folderIcon(fid) {
      if (!fid) return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/></svg>`;
      const f = folders.find(f => f.id === fid);
      return svgFolder(f?.color || DEFAULT_COLOR, false);
    }
    function folderLabel(fid) {
      if (!fid) return '미분류';
      return folders.find(f => f.id === fid)?.name || '미분류';
    }

    function render() {
      root.innerHTML = `
        <button class="cdhq-folder-select-btn" type="button">
          ${folderIcon(selectedId)}
          <span style="flex:1">${esc(folderLabel(selectedId))}</span>
          <span class="fsb-arrow"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </button>

        <!-- 폴더 선택 패널 -->
        <div class="cdhq-folder-panel">
          <div class="cdhq-folder-opt${!selectedId ? ' selected' : ''}" data-fid="">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/></svg>
            미분류
          </div>
          ${folders.map(f => `
            <div class="cdhq-folder-opt${selectedId === f.id ? ' selected' : ''}" data-fid="${f.id}">
              ${svgFolder(f.color || DEFAULT_COLOR, false)}
              ${esc(f.name)}
            </div>
          `).join('')}
          <div class="cdhq-folder-opt cdhq-folder-opt-new" data-fid="__new__">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4a7fa8" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span style="color:#4a7fa8">새 폴더 만들기</span>
          </div>
        </div>

        <!-- 새 폴더 생성 패널 -->
        <div class="cdhq-new-folder-panel">
          <span class="nfp-title">새 폴더</span>
          <input class="cdhq-input nfp-name" placeholder="폴더 이름" maxlength="20">
          <div class="cdhq-color-row nfp-colors"></div>
          <div class="nfp-row">
            <button class="nfp-ok">만들기</button>
            <button class="nfp-back">← 돌아가기</button>
          </div>
        </div>
      `;

      const selBtn   = root.querySelector('.cdhq-folder-select-btn');
      const selPanel = root.querySelector('.cdhq-folder-panel');
      const nfPanel  = root.querySelector('.cdhq-new-folder-panel');

      // 선택 버튼 토글
      selBtn.addEventListener('click', e => {
        e.stopPropagation();
        nfPanel.classList.remove('open');
        selPanel.classList.toggle('open');
      });

      // 옵션 선택
      root.querySelectorAll('.cdhq-folder-opt:not(.cdhq-folder-opt-new)').forEach(opt => {
        opt.addEventListener('click', e => {
          e.stopPropagation();
          selectedId = opt.dataset.fid;
          selPanel.classList.remove('open');
          render();
        });
      });

      // 새 폴더 만들기 클릭 → 선택 패널 닫고 생성 패널 열기
      root.querySelector('.cdhq-folder-opt-new').addEventListener('click', e => {
        e.stopPropagation();
        selPanel.classList.remove('open');
        nfPanel.classList.add('open');
        root.querySelector('.nfp-name').value = '';
        newColor = DEFAULT_COLOR;
        buildSwatches();
        setTimeout(() => root.querySelector('.nfp-name')?.focus(), 30);
      });

      // 색상 스와치
      function buildSwatches() {
        const row = root.querySelector('.nfp-colors');
        row.innerHTML = FOLDER_COLORS.map(c =>
          `<span class="cdhq-swatch${c === newColor ? ' selected' : ''}" data-c="${c}" style="background:${c}"></span>`
        ).join('');
        row.querySelectorAll('.cdhq-swatch').forEach(sw => {
          sw.addEventListener('click', e => {
            e.stopPropagation();
            newColor = sw.dataset.c;
            buildSwatches();
          });
        });
      }
      buildSwatches();

      // 만들기
      root.querySelector('.nfp-ok').addEventListener('click', e => {
        e.stopPropagation();
        const name = root.querySelector('.nfp-name').value.trim();
        if (!name) { root.querySelector('.nfp-name').focus(); return; }
        const newF = { id: uid(), name, color: newColor };
        folders.push(newF);
        collapsed[newF.id] = true;
        save();
        selectedId = newF.id;
        nfPanel.classList.remove('open');
        render();
        renderChips();
      });

      // 돌아가기
      root.querySelector('.nfp-back').addEventListener('click', e => {
        e.stopPropagation();
        nfPanel.classList.remove('open');
        selPanel.classList.add('open');
        render();
        // 폴더 목록 갱신 후 다시 패널 열기
        root.querySelector('.cdhq-folder-panel')?.classList.add('open');
      });

      // 엔터
      root.querySelector('.nfp-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); root.querySelector('.nfp-ok')?.click(); }
      });
    }

    render();
    return {
      getValue: () => selectedId,
      setValue: (fid) => { selectedId = fid || ''; render(); },
      refresh:  () => render(),
    };
  }

  /* ────────────────────────────────────────
     칩 렌더
  ──────────────────────────────────────── */
  let _dragId = null;

  function renderChips() {
    const strip = document.getElementById('cdhq-chips');
    if (!strip) return;

    const favs       = quick.filter(q => q.fav);
    const unfoldered = quick.filter(q => !q.fav && !q.folder);
    const groups     = folders
      .map(f => ({ f, items: quick.filter(q => !q.fav && q.folder === f.id) }))
      ; // 빈 폴더도 구분선 표시 (삭제 가능하게)

    let html = '';
    favs.forEach(q => { html += chipHTML(q, true); });
    if (favs.length > 0 && (unfoldered.length > 0 || groups.length > 0))
      html += `<span class="cdhq-divider"><span class="cdhq-divider-line"></span></span>`;
    unfoldered.forEach(q => { html += chipHTML(q, false); });
    groups.forEach(({ f, items }) => {
      const isOpen = !collapsed[f.id];
      const color  = f.color || DEFAULT_COLOR;
      html += `<span class="cdhq-divider has-folder" data-fid="${f.id}">
        <span class="cdhq-divider-line"></span>
        <span class="cdhq-divider-label">
          ${svgFolder(color, isOpen)}
          <span class="cdhq-divider-name" style="color:${color}">${esc(f.name)}</span>
          <span class="cdhq-divider-chevron">${svgChevron(isOpen)}</span>
        </span>
        <button class="cdhq-divider-x" data-fid="${f.id}" title="폴더 삭제">✕</button>
      </span>`;
      if (isOpen) items.forEach(q => { html += chipHTML(q, false); });
    });
    html += `<span class="cdhq-chip" id="cdhq-chip-add" draggable="false">＋</span>`;
    strip.innerHTML = html;

    // ── 폴더 구분선 이벤트: 클릭/우클릭/롱프레스/드래그 ──
    let _folderDragId = null; // 현재 드래그 중인 폴더 id

    // ── ✕ 버튼 즉시 삭제 ──
    strip.querySelectorAll('.cdhq-divider-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const fid = btn.dataset.fid;
        quick = quick.filter(q => q.folder !== fid);
        folders = folders.filter(f => f.id !== fid);
        delete collapsed[fid];
        save(); renderChips();
      });
      // 모바일: touchend도 처리
      btn.addEventListener('touchend', e => {
        e.preventDefault(); e.stopPropagation();
        const fid = btn.dataset.fid;
        quick = quick.filter(q => q.folder !== fid);
        folders = folders.filter(f => f.id !== fid);
        delete collapsed[fid];
        save(); renderChips();
      });
    });

    strip.querySelectorAll('.cdhq-divider.has-folder').forEach(div => {
      const fid = div.dataset.fid;
      let _fps = null, _flt = null, _fMoved = false;

      div.addEventListener('pointerdown', e => {
        // ✕ 버튼은 자체 처리
        if (e.target.closest('.cdhq-divider-x')) return;
        if (e.button === 2) return;
        _fps = { x: e.clientX, y: e.clientY }; _fMoved = false;
        // 롱프레스 → 수정 DD (우클릭 대신)
        _flt = setTimeout(() => {
          _flt = null; _fps = null;
          const f = folders.find(f => f.id === fid);
          if (f) openFolderEditDD(f);
        }, 600);
      });

      div.addEventListener('pointermove', e => {
        if (e.target.closest('.cdhq-divider-x')) return;
        if (!_fps) return;
        if (Math.hypot(e.clientX - _fps.x, e.clientY - _fps.y) > 6) {
          clearTimeout(_flt); _flt = null; _fMoved = true;
          if (!_folderDragId) {
            _folderDragId = fid;
            div.classList.add('folder-dragging');
          }
        }
        if (_fMoved && _folderDragId === fid) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const target = el?.closest('.cdhq-divider.has-folder');
          strip.querySelectorAll('.cdhq-divider.folder-drag-over').forEach(d => d.classList.remove('folder-drag-over'));
          if (target && target !== div) target.classList.add('folder-drag-over');
        }
      });

      div.addEventListener('pointerup', e => {
        if (e.target.closest('.cdhq-divider-x')) return;
        clearTimeout(_flt); _flt = null;

        if (_fMoved && _folderDragId === fid) {
          const overEl = strip.querySelector('.cdhq-divider.folder-drag-over');
          strip.querySelectorAll('.cdhq-divider.folder-drag-over').forEach(d => d.classList.remove('folder-drag-over'));
          div.classList.remove('folder-dragging');
          _folderDragId = null;
          if (overEl) {
            const tid = overEl.dataset.fid;
            const fi = folders.findIndex(f => f.id === fid);
            const ti = folders.findIndex(f => f.id === tid);
            if (fi >= 0 && ti >= 0) {
              folders.splice(ti, 0, folders.splice(fi, 1)[0]);
              save(); renderChips();
            }
          }
          _fps = null; return;
        }

        if (!_fps) return;
        const moved = Math.hypot(e.clientX - _fps.x, e.clientY - _fps.y) > 6;
        _fps = null;
        if (moved) return;
        // 탭/클릭 → 접기/펼치기
        e.stopPropagation();
        if (collapsed[fid]) delete collapsed[fid]; else collapsed[fid] = true;
        save(); renderChips();
      });

      div.addEventListener('pointercancel', () => {
        clearTimeout(_flt); _flt = null; _fps = null; _fMoved = false;
        if (_folderDragId === fid) {
          div.classList.remove('folder-dragging');
          strip.querySelectorAll('.cdhq-divider.folder-drag-over').forEach(d => d.classList.remove('folder-drag-over'));
          _folderDragId = null;
        }
      });

      // PC 우클릭 → 수정 DD
      div.addEventListener('contextmenu', e => {
        if (e.target.closest('.cdhq-divider-x')) return;
        e.preventDefault(); e.stopPropagation();
        const f = folders.find(f => f.id === fid);
        if (f) openFolderEditDD(f);
      });
    });

    attachChipEvents(strip);
  }

  function chipHTML(q, fav) {
    return `<span class="cdhq-chip${fav?' fav':''}" data-id="${q.id}" draggable="true">${esc(q.label)}<button class="cdhq-chip-x" data-id="${q.id}">✕</button></span>`;
  }

  function attachChipEvents(strip) {
    strip.querySelectorAll('.cdhq-chip:not(#cdhq-chip-add)').forEach(chip => {
      let _ps = null, _lt = null;
      chip.addEventListener('pointerdown', e => {
        if (e.button === 2) return;
        _ps = { x: e.clientX, y: e.clientY };
        _lt = setTimeout(() => { _lt = null; _ps = null; openEditForChip(chip.dataset.id, chip); }, 500);
      });
      chip.addEventListener('pointermove', e => {
        if (!_ps) return;
        if (Math.hypot(e.clientX-_ps.x, e.clientY-_ps.y) > 8) { clearTimeout(_lt); _lt = null; }
      });
      chip.addEventListener('pointerup', e => {
        clearTimeout(_lt); _lt = null;
        if (e.button === 2 || e.target.closest('.cdhq-chip-x') || !_ps) return;
        const moved = Math.hypot(e.clientX-_ps.x, e.clientY-_ps.y) > 8;
        _ps = null; if (moved) return;
        const q = quick.find(q => q.id === chip.dataset.id);
        if (q) insertText(q.text);
      });
      chip.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openEditForChip(chip.dataset.id, chip);
      });
      chip.addEventListener('dragstart', e => {
        _dragId = chip.dataset.id; chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        strip.querySelectorAll('.cdhq-chip').forEach(c => c.classList.remove('drag-over'));
        _dragId = null;
      });
      chip.addEventListener('dragover', e => {
        e.preventDefault();
        strip.querySelectorAll('.cdhq-chip').forEach(c => c.classList.remove('drag-over'));
        if (chip.dataset.id !== _dragId) chip.classList.add('drag-over');
      });
      chip.addEventListener('drop', e => {
        e.preventDefault();
        if (!_dragId || _dragId === chip.dataset.id) return;
        const fi = quick.findIndex(q => q.id === _dragId);
        const ti = quick.findIndex(q => q.id === chip.dataset.id);
        if (fi < 0 || ti < 0) return;
        quick.splice(ti, 0, quick.splice(fi, 1)[0]);
        save(); renderChips();
      });
    });
    strip.querySelectorAll('.cdhq-chip-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        quick = quick.filter(q => q.id !== btn.dataset.id);
        save(); renderChips();
      });
    });
    strip.querySelector('#cdhq-chip-add')?.addEventListener('click', e => {
      e.stopPropagation();
      if (_curDD === addDD) { ddClose(addDD); return; }
      ddClose(editDD);
      openAddDD(e.currentTarget);
    });
  }

  /* ────────────────────────────────────────
     추가 드롭다운
  ──────────────────────────────────────── */
  const addDD = document.createElement('div');
  addDD.className = 'cdhq-dd';
  addDD.innerHTML = `
    <div class="cdhq-dd-title">＋ 퀵입력 추가</div>
    <div class="cdhq-field"><span class="cdhq-lbl">이름</span><input class="cdhq-input add-lbl" placeholder="예: 인사말" maxlength="30"></div>
    <div class="cdhq-field"><span class="cdhq-lbl">내용</span><textarea class="cdhq-textarea add-txt" placeholder="입력창에 삽입될 텍스트" rows="4"></textarea></div>
    <div class="cdhq-field"><span class="cdhq-lbl">폴더</span><div class="add-folder-root"></div></div>
    <label class="cdhq-fav-toggle">
      <input type="checkbox" class="add-fav">
      <span class="cdhq-fav-star">${ICON_FAV}</span>
      <span class="cdhq-fav-lbl">즐겨찾기에 추가</span>
    </label>
    <div class="cdhq-dd-row">
      <button class="cdhq-dd-ok add-ok">추가</button>
      <button class="cdhq-dd-cancel add-cancel">취소</button>
    </div>
    <div class="cdhq-hint">PC: 우클릭 수정 &nbsp;|&nbsp; 모바일: 길게 눌러 수정</div>
  `;
  addDD.addEventListener('click', e => e.stopPropagation());

  let _addW = null;
  function openAddDD(anchor) {
    addDD.querySelector('.add-lbl').value   = '';
    addDD.querySelector('.add-txt').value   = '';
    addDD.querySelector('.add-fav').checked = false;
    _addW = buildFolderWidget(addDD.querySelector('.add-folder-root'), '');
    ddOpen(addDD, anchor);
    setTimeout(() => addDD.querySelector('.add-lbl')?.focus(), 60);
  }
  function submitAdd() {
    const lbl = addDD.querySelector('.add-lbl').value.trim();
    const txt = addDD.querySelector('.add-txt').value.trim();
    if (!lbl || !txt) return;
    quick.push({ id: uid(), label: lbl, text: txt, folder: _addW?.getValue()||'', fav: addDD.querySelector('.add-fav').checked });
    save(); ddClose(addDD); renderChips();
  }
  addDD.querySelector('.add-ok').addEventListener('click',    e => { e.stopPropagation(); submitAdd(); });
  addDD.querySelector('.add-cancel').addEventListener('click', e => { e.stopPropagation(); ddClose(addDD); });
  addDD.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); submitAdd(); } });

  /* ────────────────────────────────────────
     수정 드롭다운
  ──────────────────────────────────────── */
  const editDD = document.createElement('div');
  editDD.className = 'cdhq-dd';
  editDD.innerHTML = `
    <div class="cdhq-dd-title">✎ 수정</div>
    <div class="cdhq-field"><span class="cdhq-lbl">이름</span><input class="cdhq-input edit-lbl" placeholder="이름" maxlength="30"></div>
    <div class="cdhq-field"><span class="cdhq-lbl">내용</span><textarea class="cdhq-textarea edit-txt" placeholder="내용" rows="4"></textarea></div>
    <div class="cdhq-field"><span class="cdhq-lbl">폴더</span><div class="edit-folder-root"></div></div>
    <label class="cdhq-fav-toggle">
      <input type="checkbox" class="edit-fav">
      <span class="cdhq-fav-star">${ICON_FAV}</span>
      <span class="cdhq-fav-lbl">즐겨찾기</span>
    </label>
    <div class="cdhq-dd-row">
      <button class="cdhq-dd-save edit-ok">저장</button>
      <button class="cdhq-dd-cancel edit-cancel">취소</button>
    </div>
    <div class="cdhq-dd-row" style="margin-top:-4px">
      <button class="cdhq-dd-del edit-del">삭제</button>
    </div>
  `;
  editDD.addEventListener('click', e => e.stopPropagation());

  let _editId = null, _editW = null;
  function openEditForChip(id, anchor) {
    const q = quick.find(q => q.id === id);
    if (!q) return;
    _editId = id;
    editDD.querySelector('.edit-lbl').value   = q.label;
    editDD.querySelector('.edit-txt').value   = q.text;
    editDD.querySelector('.edit-fav').checked = !!q.fav;
    _editW = buildFolderWidget(editDD.querySelector('.edit-folder-root'), q.folder||'');
    ddOpen(editDD, anchor);
    setTimeout(() => editDD.querySelector('.edit-lbl')?.focus(), 60);
  }
  function submitEdit() {
    if (!_editId) return;
    const lbl = editDD.querySelector('.edit-lbl').value.trim();
    const txt = editDD.querySelector('.edit-txt').value.trim();
    if (!lbl || !txt) return;
    const q = quick.find(q => q.id === _editId);
    if (q) { q.label=lbl; q.text=txt; q.folder=_editW?.getValue()||''; q.fav=editDD.querySelector('.edit-fav').checked; save(); renderChips(); }
    ddClose(editDD); _editId = null;
  }
  editDD.querySelector('.edit-ok').addEventListener('click',    e => { e.stopPropagation(); submitEdit(); });
  editDD.querySelector('.edit-cancel').addEventListener('click', e => { e.stopPropagation(); ddClose(editDD); _editId=null; });
  editDD.querySelector('.edit-del').addEventListener('click',    e => {
    e.stopPropagation();
    if (!_editId) return;
    quick = quick.filter(q => q.id !== _editId);
    save(); ddClose(editDD); _editId=null; renderChips();
  });
  editDD.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); submitEdit(); } });

  /* ────────────────────────────────────────
     UI 주입
     — 형광펜 호환: DOM 삽입은 한 번만, 이미 존재하면 즉시 반환
       (form 안에 wrap을 넣을 때 형광펜 MutationObserver를 자극하지만
        _cdhqSafeNode 필터로 cdhq-* 노드는 무시되므로 핑퐁 없음)
  ──────────────────────────────────────── */
  function injectUI() {
    // 이미 주입된 경우 절대 재삽입 금지
    if (document.getElementById('cdhq-wrap')) return;

    const bar  = document.querySelector(SEL_BTNBAR);
    const form = document.querySelector(SEL_FORM);
    if (!bar || !form) return;
    // 버튼이 이미 있어도 wrap이 없으면 계속 진행 (wrap만 없는 엣지 케이스 방어)
    if (bar.querySelector('.cdhq-btn') && document.getElementById('cdhq-chips')) return;

    [addDD, editDD].forEach(dd => { if (!document.body.contains(dd)) document.body.appendChild(dd); });

    if (!bar.querySelector('.cdhq-btn')) {
      const qBtn = document.createElement('button');
      qBtn.type='button'; qBtn.className='cdhq-btn'; qBtn.title='퀵입력';
      qBtn.innerHTML = ICON_Q;
      bar.insertBefore(qBtn, bar.querySelector('[data-tour="chat-model-selector"]')?.parentElement || null);
      qBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (_curDD) ddClose(_curDD);
        const chips = document.getElementById('cdhq-chips');
        if (!chips) return;
        if (chips.classList.contains('open')) {
          chips.classList.remove('open'); qBtn.classList.remove('dd-open');
        } else {
          renderChips(); chips.classList.add('open'); qBtn.classList.add('dd-open');
        }
      });
    }

    const wrap = document.createElement('div');
    wrap.id = 'cdhq-wrap';
    wrap.innerHTML = `<div id="cdhq-chips"></div>`;
    // form 내 삽입: .relative.w-full 앞 (textarea 래퍼) — 형광펜이 감시하는 영역 밖에 붙음
    const taWrap = form.querySelector('.relative.w-full');
    if (taWrap) form.insertBefore(wrap, taWrap); else form.prepend(wrap);
    wrap.addEventListener('click', e => e.stopPropagation());

    renderChips();
  }

  /* ── MutationObserver + 초기화 ──
     형광펜(케이브덕 형광펜) 호환:
     mark.custom-cdhlp 및 cdhlp-* 노드 변경은 무시해서
     형광펜 ↔ 퀵입력 MutationObserver 핑퐁 방지
  ── */
  function _cdhqSafeNode(n) {
    if (n.nodeType === Node.TEXT_NODE) return true;
    if (n.nodeType !== Node.ELEMENT_NODE) return true;
    const id  = n.id  || '';
    const cls = n.classList ? [...n.classList] : [];
    if (id.startsWith('cdhq') || cls.some(c => c.startsWith('cdhq'))) return true;
    if (n.tagName === 'MARK' && cls.includes('custom-cdhlp'))          return true;
    if (id.startsWith('cdhlp') || cls.some(c => c.startsWith('cdhlp'))) return true;
    return false;
  }

  new MutationObserver(mutations => {
    if (document.getElementById('cdhq-wrap')) return;
    if (mutations.every(m => [...m.addedNodes, ...m.removedNodes].every(_cdhqSafeNode))) return;
    injectUI();
  }).observe(document.body, { childList: true, subtree: true });

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', injectUI);
  else injectUI();

  let _lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== _lastPath) {
      _lastPath = location.pathname;
      setTimeout(() => { if (!document.getElementById('cdhq-wrap')) injectUI(); }, 600);
    }
  }, 300);

})();

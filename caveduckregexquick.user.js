// ==UserScript==
// @name         케덕 정규식과 퀵입력
// @namespace    https://caveduck.io/
// @version      9.1.0
// @description  케이브덕: 정규식 + 퀵입력 칩 (아이콘 버튼, 드롭다운 폼)
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

  /* ── 스토리지 ── */
  const S = {
    get: (k, d) => { try { return JSON.parse(GM_getValue(k, JSON.stringify(d))); } catch { return d; } },
    set: (k, v) => GM_setValue(k, JSON.stringify(v)),
  };
  let quick = S.get('cdh_q',  []);
  let rules = S.get('cdh_r',  []);
  let regOn = S.get('cdh_on', false);
  const save = () => { S.set('cdh_q', quick); S.set('cdh_r', rules); S.set('cdh_on', regOn); };
  const uid  = () => Math.random().toString(36).slice(2, 8);
  const esc  = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ── 정규식 치환 ── */
  function applyRules(t) {
    if (!regOn) return t;
    let r = t;
    for (const rule of rules) {
      if (!rule.on) continue;
      try { r = r.replace(new RegExp(rule.from, 'g'), rule.to); } catch {}
    }
    return r;
  }
  function patchAll() {
    document.querySelectorAll('[class*="contain"]').forEach(c => {
      c.querySelectorAll('span').forEach(sp => {
        if (sp.childElementCount > 0 || !sp.textContent.trim()) return;
        if (!sp.dataset.orig) sp.dataset.orig = sp.textContent;
        const next = applyRules(sp.dataset.orig);
        if (sp.textContent !== next) sp.textContent = next;
      });
    });
  }
  function restoreAll() {
    document.querySelectorAll('[data-orig]').forEach(sp => { sp.textContent = sp.dataset.orig; });
  }

  /* ── React textarea 삽입 ── */
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

  /* ════════════════════════════════════════
     드롭다운 싱글턴 관리
     — 하나만 열리고, 바깥 클릭 시 닫힘
  ════════════════════════════════════════ */
  let _openDD = null;

  function openDD(dd, anchor) {
    if (_openDD && _openDD !== dd) closeDD(_openDD);
    document.body.appendChild(dd);  // body 최상단에 붙임
    dd.style.display = 'flex';
    positionDD(dd, anchor);
    _openDD = dd;
  }
  function closeDD(dd) {
    if (!dd) return;
    dd.style.display = 'none';
    if (_openDD === dd) _openDD = null;
  }
  function positionDD(dd, anchor) {
    const r   = anchor.getBoundingClientRect();
    const dw  = dd.offsetWidth  || 260;
    const dh  = dd.offsetHeight || 120;
    const gap = 6;
    // 기본: 앵커 위쪽
    let top  = r.top - dh - gap + window.scrollY;
    let left = r.left + window.scrollX;
    // 화면 아래로 튀어나오면 앵커 아래로
    if (top < window.scrollY + 4) top = r.bottom + gap + window.scrollY;
    // 화면 오른쪽 넘으면 왼쪽으로 당김
    if (left + dw > window.innerWidth - 8) left = window.innerWidth - dw - 8 + window.scrollX;
    if (left < 4) left = 4;
    dd.style.top  = top  + 'px';
    dd.style.left = left + 'px';
  }

  document.addEventListener('click', () => { if (_openDD) closeDD(_openDD); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _openDD) closeDD(_openDD); });

  /* ════════════════════════════════════════
     스타일
  ════════════════════════════════════════ */
  document.head.insertAdjacentHTML('beforeend', `<style>
    /* 반응형 크기 변수 */
    :root {
      --cdh-fs:  clamp(12px, 1.4vw, 15px);
      --cdh-fss: clamp(11px, 1.2vw, 13px);
      --cdh-h:   clamp(28px, 3.4vw, 34px);
      --cdh-r:   8px;
      --cdh-gap: clamp(4px, 0.8vw, 8px);
      --cdh-pad: clamp(7px, 1vw, 11px);
    }

    /* 입력창과의 여백 */
    #cdh-wrap { margin-bottom: 6px; }

    /* ── 아이콘 버튼 (하단 버튼 바) ── */
    .cdh-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      height: var(--cdh-h); width: var(--cdh-h);
      border-radius: var(--cdh-r); border: none;
      background: rgba(255,255,255,.07); color: #bbb;
      font-size: clamp(15px, 1.8vw, 19px);
      cursor: pointer; flex-shrink: 0;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      transition: background .12s, color .12s;
      position: relative;
    }
    .cdh-btn:hover   { background: rgba(255,255,255,.13); color: #eee; }
    .cdh-btn:active  { opacity: .7; }
    .cdh-btn.on      { background: #bc1e51; color: #fff; }
    .cdh-btn.on:hover { background: #a01a45; }
    /* 정규식 관리 패널 열린 상태 — 노란 점 */
    .cdh-btn.managing::after {
      content: '';
      position: absolute; bottom: 3px; right: 3px;
      width: 5px; height: 5px;
      border-radius: 50%; background: #fdc700;
    }
    /* 툴팁 */
    .cdh-btn[title]:hover::before {
      content: attr(title);
      position: absolute; bottom: calc(100% + 5px); left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,.8); color: #eee;
      font-size: 11px; white-space: nowrap;
      padding: 3px 7px; border-radius: 5px;
      pointer-events: none; z-index: 9999;
    }

    /* ── 칩 스트립 ── */
    #cdh-chips {
      display: none; align-items: center; gap: var(--cdh-gap);
      padding: var(--cdh-gap) var(--cdh-pad) calc(var(--cdh-gap) * 0.6);
      overflow-x: auto; -webkit-overflow-scrolling: touch;
    }
    #cdh-chips.open { display: flex; }
    #cdh-chips::-webkit-scrollbar { display: none; }

    .cdh-chip {
      display: inline-flex; align-items: center;
      height: clamp(24px, 3vw, 30px);
      padding: 0 clamp(8px, 1.1vw, 12px);
      border-radius: 20px; border: 1px solid rgba(255,255,255,.13);
      background: rgba(255,255,255,.07); color: #ccc;
      font-size: var(--cdh-fss); font-weight: 500; font-family: inherit;
      white-space: nowrap; cursor: grab; flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
      transition: background .1s, border-color .1s, opacity .1s;
      user-select: none;
    }
    .cdh-chip:hover        { background: rgba(255,255,255,.12); color: #eee; }
    .cdh-chip.dragging     { opacity: .35; cursor: grabbing; }
    .cdh-chip.drag-over    { border-color: #fdc700; background: rgba(253,199,0,.1); }

    .cdh-chip-x {
      display: inline-flex; align-items: center; justify-content: center;
      width: 13px; height: 13px;
      margin-left: 5px; margin-right: -3px;
      border-radius: 50%; background: rgba(255,255,255,.14); border: none;
      color: #888; font-size: 8px; cursor: pointer; line-height: 1;
      -webkit-tap-highlight-color: transparent; transition: background .1s;
      flex-shrink: 0;
    }
    .cdh-chip-x:hover { background: #bc1e51; color: #fff; }

    /* + 추가 칩 */
    #cdh-chip-add {
      cursor: pointer !important;
      background: rgba(188,30,81,.1) !important;
      border-color: rgba(188,30,81,.3) !important;
      color: #bc1e51 !important;
      font-size: clamp(13px, 1.5vw, 16px) !important;
      padding: 0 clamp(7px, 1vw, 11px) !important;
    }
    #cdh-chip-add:hover { background: rgba(188,30,81,.2) !important; }

    /* 정규식 인라인 패널 (form 안, 드롭다운 아님) */
    #cdh-rpanel {
      display: none; flex-direction: column;
      border-top: 1px solid rgba(255,255,255,.07);
      background: rgba(0,0,0,.18);
    }
    #cdh-rpanel.open { display: flex; }

    #cdh-rform {
      display: flex; align-items: center; gap: var(--cdh-gap);
      padding: var(--cdh-gap) var(--cdh-pad);
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    #cdh-rform input {
      flex: 1; min-width: 0;
      background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
      border-radius: var(--cdh-r); color: #eee;
      font-size: var(--cdh-fss); font-family: monospace;
      padding: clamp(4px, 0.6vw, 7px) clamp(7px, 1vw, 10px);
      outline: none; -webkit-appearance: none; transition: border-color .12s;
    }
    #cdh-rform input:focus { border-color: #bc1e51; }
    #cdh-rform input::placeholder { font-family: inherit; opacity: .45; font-size: clamp(10px, 1.1vw, 12px); }
    #cdh-rform .arr { color: #555; font-size: var(--cdh-fs); flex-shrink: 0; }
    #cdh-rform button {
      height: clamp(26px, 3.1vw, 30px); padding: 0 clamp(8px, 1.1vw, 12px);
      border-radius: var(--cdh-r); border: none;
      background: rgba(255,255,255,.08); color: #bbb;
      font-size: var(--cdh-fss); font-weight: 700; font-family: inherit;
      cursor: pointer; flex-shrink: 0; white-space: nowrap;
      -webkit-tap-highlight-color: transparent; transition: background .1s;
    }
    #cdh-rform button:hover { background: rgba(255,255,255,.16); color: #eee; }

    #cdh-rlist { display: flex; flex-direction: column; }
    .cdh-rule {
      display: flex; align-items: center; gap: var(--cdh-gap);
      padding: clamp(5px, 0.7vw, 7px) var(--cdh-pad);
      border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .cdh-rule-chk { accent-color: #bc1e51; width: 14px; height: 14px; cursor: pointer; flex-shrink: 0; }
    .cdh-rule-text {
      flex: 1; font-size: var(--cdh-fss); font-family: monospace; color: #ccc;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .cdh-rule-text .arr { color: #444; margin: 0 3px; }
    .cdh-rule-text .to  { color: #fdc700; }
    .cdh-rule-x {
      background: none; border: none; color: #555; font-size: var(--cdh-fs);
      cursor: pointer; padding: 3px 5px; border-radius: 5px; flex-shrink: 0;
      -webkit-tap-highlight-color: transparent; transition: color .1s;
    }
    .cdh-rule-x:hover { color: #bc1e51; }
    .cdh-r-empty { padding: clamp(8px, 1.2vw, 12px); font-size: var(--cdh-fss); color: #555; text-align: center; }
    .cdh-r-info {
      display: flex; align-items: center; justify-content: space-between;
      padding: 4px var(--cdh-pad); border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .cdh-r-info span { font-size: var(--cdh-fss); color: #555; }
    .cdh-r-info span b { color: #aaa; }
    .cdh-r-info button {
      background: none; border: none; font-size: var(--cdh-fss);
      color: #8ec5ff; cursor: pointer; font-family: inherit; padding: 0;
    }
    .cdh-r-info button:hover { text-decoration: underline; }

    /* ── 공용 드롭다운 (퀵입력 추가 / 수정 폼) ── */
    .cdh-dd {
      position: absolute;     /* body에 붙지만 top/left로 위치 지정 */
      z-index: 999999;
      flex-direction: column; gap: var(--cdh-gap);
      background: #1e1f1f;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.6);
      padding: clamp(9px, 1.2vw, 13px);
      width: clamp(220px, 30vw, 300px);
      display: none;   /* openDD 가 flex 로 바꿈 */
    }
    .cdh-dd label {
      font-size: var(--cdh-fss); color: #888; margin-bottom: 2px; display: block;
    }
    .cdh-dd input, .cdh-dd textarea {
      width: 100%;
      background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.11);
      border-radius: 7px; color: #eee;
      font-size: var(--cdh-fs); font-family: inherit;
      padding: clamp(5px, 0.7vw, 8px) clamp(8px, 1vw, 11px);
      outline: none; -webkit-appearance: none; resize: none;
      transition: border-color .12s;
    }
    .cdh-dd input:focus, .cdh-dd textarea:focus { border-color: #bc1e51; }
    .cdh-dd textarea { min-height: clamp(52px, 7vw, 72px); }
    .cdh-dd-row { display: flex; gap: var(--cdh-gap); }
    .cdh-dd-row button {
      flex: 1;
      height: clamp(28px, 3.3vw, 34px);
      border-radius: 7px; border: none;
      font-size: var(--cdh-fs); font-weight: 700; font-family: inherit;
      cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .1s;
    }
    .cdh-dd-ok     { background: #bc1e51; color: #fff; }
    .cdh-dd-ok:hover { background: #a01a45; }
    .cdh-dd-edit-ok  { background: #fdc700; color: #1a1a1a; }
    .cdh-dd-edit-ok:hover { background: #e6b400; }
    .cdh-dd-cancel { background: rgba(255,255,255,.07); color: #aaa; }
    .cdh-dd-cancel:hover { background: rgba(255,255,255,.14); }
    /* 드롭다운 제목 */
    .cdh-dd-title {
      font-size: var(--cdh-fss); font-weight: 700; color: #999;
      margin-bottom: 2px;
    }
  </style>`);

  /* ════════════════════════════════════════
     드롭다운 DOM: 퀵입력 추가
  ════════════════════════════════════════ */
  const addDD = document.createElement('div');
  addDD.className = 'cdh-dd';
  addDD.innerHTML = `
    <div class="cdh-dd-title">＋ 퀵입력 추가</div>
    <div>
      <label>이름</label>
      <input id="cdh-add-lbl" placeholder="예: 인사말" maxlength="20">
    </div>
    <div>
      <label>내용</label>
      <textarea id="cdh-add-txt" placeholder="입력창에 삽입될 텍스트" rows="3"></textarea>
    </div>
    <div class="cdh-dd-row">
      <button class="cdh-dd-ok"     id="cdh-add-ok">추가</button>
      <button class="cdh-dd-cancel" id="cdh-add-cancel">취소</button>
    </div>
  `;
  addDD.addEventListener('click', e => e.stopPropagation());

  const addLbl = () => document.getElementById('cdh-add-lbl');
  const addTxt = () => document.getElementById('cdh-add-txt');

  function submitAdd() {
    const lbl = addLbl().value.trim();
    const txt = addTxt().value.trim();
    if (!lbl || !txt) return;
    quick.push({ id: uid(), label: lbl, text: txt });
    save();
    addLbl().value = '';
    addTxt().value = '';
    closeDD(addDD);
    renderChips();
  }

  document.getElementById('cdh-add-ok')?.addEventListener('click', e => { e.stopPropagation(); submitAdd(); });
  document.getElementById('cdh-add-cancel')?.addEventListener('click', e => { e.stopPropagation(); closeDD(addDD); });
  // 나중에 DOM 붙고 나서 이벤트 재등록 (아직 body 안에 없으므로 아래 injectUI 에서)

  /* ════════════════════════════════════════
     드롭다운 DOM: 퀵입력 수정
  ════════════════════════════════════════ */
  const editDD = document.createElement('div');
  editDD.className = 'cdh-dd';
  editDD.innerHTML = `
    <div class="cdh-dd-title">✎ 퀵입력 수정</div>
    <div>
      <label>이름</label>
      <input id="cdh-edit-lbl" placeholder="이름" maxlength="20">
    </div>
    <div>
      <label>내용</label>
      <textarea id="cdh-edit-txt" placeholder="내용" rows="3"></textarea>
    </div>
    <div class="cdh-dd-row">
      <button class="cdh-dd-edit-ok" id="cdh-edit-ok">저장</button>
      <button class="cdh-dd-cancel"  id="cdh-edit-cancel">취소</button>
    </div>
  `;
  editDD.addEventListener('click', e => e.stopPropagation());

  let _editId = null;
  const editLbl = () => document.getElementById('cdh-edit-lbl');
  const editTxt = () => document.getElementById('cdh-edit-txt');

  function submitEdit() {
    if (!_editId) return;
    const lbl = editLbl().value.trim();
    const txt = editTxt().value.trim();
    if (!lbl || !txt) return;
    const q = quick.find(q => q.id === _editId);
    if (q) { q.label = lbl; q.text = txt; save(); renderChips(); }
    closeDD(editDD);
    _editId = null;
  }

  function openEditDD(id, anchor) {
    const q = quick.find(q => q.id === id);
    if (!q) return;
    _editId = id;
    editLbl().value = q.label;
    editTxt().value = q.text;
    openDD(editDD, anchor);
    setTimeout(() => editLbl()?.focus(), 50);
  }

  /* ════════════════════════════════════════
     UI 주입
  ════════════════════════════════════════ */
  function injectUI() {
    const bar  = document.querySelector(SEL_BTNBAR);
    const form = document.querySelector(SEL_FORM);
    if (!bar || !form || bar.querySelector('.cdh-btn')) return;

    /* SVG 아이콘 정의 */
    // 퀵입력: 클립보드 리스트 아이콘
    const ICON_QUICK = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>`;
    // 정규식 OFF (회색조 또는 기본 테두리)
    const ICON_REGEX_OFF = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 12 5-5 5 5-5 5Z"/><path d="M12 21.21V2.79"/><path d="m12 12 5-5 5 5-5 5Z"/></svg>`;
    // 정규식 ON (두께를 강조하거나 특정 색상 포인트)
    const ICON_REGEX_ON  = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 12 5-5 5 5-5 5Z"/><path d="M12 21.21V2.79"/><path d="m12 12 5-5 5 5-5 5Z"/></svg>`;

    /* 버튼 */
    const qBtn = document.createElement('button');
    qBtn.type = 'button'; qBtn.id = 'cdh-q-btn'; qBtn.className = 'cdh-btn';
    qBtn.innerHTML = ICON_QUICK;
    qBtn.title = '퀵입력';

    const rBtn = document.createElement('button');
    rBtn.type = 'button'; rBtn.id = 'cdh-r-btn';
    rBtn.className = 'cdh-btn' + (regOn ? ' on' : '');
    rBtn.innerHTML = regOn ? ICON_REGEX_ON : ICON_REGEX_OFF;
    rBtn.title = regOn ? '정규식 ON (우클릭: 관리)' : '정규식 (우클릭: 관리)';

    bar.appendChild(qBtn);
    bar.appendChild(rBtn);

    /* form 안 wrap (칩 스트립 + 정규식 패널) */
    const wrap = document.createElement('div');
    wrap.id = 'cdh-wrap';
    wrap.innerHTML = `
      <div id="cdh-chips"></div>
      <div id="cdh-rpanel">
        <div id="cdh-rform">
          <input id="cdh-rf-from" placeholder="찾을 패턴 (정규식)">
          <span class="arr">→</span>
          <input id="cdh-rf-to"   placeholder="바꿀 텍스트">
          <button id="cdh-rf-add">추가</button>
        </div>
        <div id="cdh-rlist"></div>
      </div>
    `;
    const taWrap = form.querySelector('.relative.w-full');
    if (taWrap) form.insertBefore(wrap, taWrap);
    else        form.prepend(wrap);

    wrap.addEventListener('click', e => e.stopPropagation());

    /* addDD / editDD 이벤트 (DOM 붙은 후) */
    addDD.querySelector('#cdh-add-ok').onclick     = e => { e.stopPropagation(); submitAdd(); };
    addDD.querySelector('#cdh-add-cancel').onclick  = e => { e.stopPropagation(); closeDD(addDD); };
    editDD.querySelector('#cdh-edit-ok').onclick    = e => { e.stopPropagation(); submitEdit(); };
    editDD.querySelector('#cdh-edit-cancel').onclick = e => { e.stopPropagation(); closeDD(editDD); };

    // 드롭다운 내 엔터 = 저장
    [addDD, editDD].forEach(dd => {
      dd.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (dd === addDD)  submitAdd();
          if (dd === editDD) submitEdit();
        }
      });
    });

    /* 퀵입력 버튼: 칩 스트립 토글 */
    qBtn.addEventListener('click', e => {
      e.stopPropagation();
      closeDD(addDD); closeDD(editDD);
      const chips  = document.getElementById('cdh-chips');
      const rpanel = document.getElementById('cdh-rpanel');
      if (chips.classList.contains('open')) {
        chips.classList.remove('open');
        qBtn.classList.remove('on');
      } else {
        rpanel.classList.remove('open');
        rBtn.classList.remove('managing');
        renderChips();
        chips.classList.add('open');
        qBtn.classList.add('on');
      }
    });

    /* 정규식 버튼: 좌클릭 = ON/OFF 토글 */
    rBtn.addEventListener('click', e => {
      e.stopPropagation();
      regOn = !regOn; save();
      const isManaging = rBtn.classList.contains('managing');
      rBtn.className   = 'cdh-btn' + (regOn ? ' on' : '') + (isManaging ? ' managing' : '');
      rBtn.innerHTML   = regOn ? ICON_REGEX_ON : ICON_REGEX_OFF;
      rBtn.title       = regOn ? '정규식 ON (우클릭: 관리)' : '정규식 (우클릭: 관리)';
      if (regOn) patchAll(); else restoreAll();
    });

    /* 정규식 버튼: 우클릭 / 롱프레스 = 관리 패널 토글 */
    const toggleRPanel = () => {
      const rpanel = document.getElementById('cdh-rpanel');
      const chips  = document.getElementById('cdh-chips');
      if (rpanel.classList.contains('open')) {
        rpanel.classList.remove('open');
        rBtn.classList.remove('managing');
      } else {
        chips.classList.remove('open');
        closeDD(addDD); closeDD(editDD);
        qBtn.classList.remove('on');
        renderRList();
        rpanel.classList.add('open');
        rBtn.classList.add('managing');
      }
    };
    rBtn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); toggleRPanel(); });
    let _rTimer;
    rBtn.addEventListener('touchstart', () => { _rTimer = setTimeout(toggleRPanel, 500); }, { passive: true });
    rBtn.addEventListener('touchend',   () => clearTimeout(_rTimer), { passive: true });
    rBtn.addEventListener('touchmove',  () => clearTimeout(_rTimer), { passive: true });

    /* 정규식 추가 */
    document.getElementById('cdh-rf-add').addEventListener('click', e => {
      e.stopPropagation();
      const from = document.getElementById('cdh-rf-from').value.trim();
      const to   = document.getElementById('cdh-rf-to').value;
      if (!from) { document.getElementById('cdh-rf-from').focus(); return; }
      try { new RegExp(from); } catch { alert('잘못된 정규식입니다.'); return; }
      rules.push({ id: uid(), from, to, on: true });
      save(); renderRList();
      document.getElementById('cdh-rf-from').value = '';
      document.getElementById('cdh-rf-to').value   = '';
      if (regOn) patchAll();
    });
    // 정규식 폼 엔터
    document.getElementById('cdh-rform').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('cdh-rf-add').click(); }
    });

    renderChips();
    renderRList();
  }

  /* ════════════════════════════════════════
     칩 스트립 렌더 + 드래그 정렬
  ════════════════════════════════════════ */
  let _dragId = null;

  function renderChips() {
    const strip = document.getElementById('cdh-chips');
    if (!strip) return;

    strip.innerHTML = quick.map(q => `
      <span class="cdh-chip" draggable="true" data-id="${q.id}"
            title="클릭: 삽입 | 우클릭: 수정 | 드래그: 순서 변경">
        ${esc(q.label)}
        <button class="cdh-chip-x" data-id="${q.id}">✕</button>
      </span>
    `).join('') + `<span class="cdh-chip" id="cdh-chip-add" draggable="false">＋</span>`;

    /* 칩 클릭 → 삽입 */
    strip.querySelectorAll('.cdh-chip:not(#cdh-chip-add)').forEach(chip => {
      chip.addEventListener('click', e => {
        if (e.target.closest('.cdh-chip-x')) return;
        const q = quick.find(q => q.id === chip.dataset.id);
        if (q) insertText(q.text);
      });

      /* 우클릭 → 수정 드롭다운 */
      chip.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        closeDD(addDD);
        openEditDD(chip.dataset.id, chip);
      });

      /* 롱프레스(모바일) → 수정 드롭다운 */
      let _ct;
      chip.addEventListener('touchstart',  () => { _ct = setTimeout(() => { closeDD(addDD); openEditDD(chip.dataset.id, chip); }, 600); }, { passive: true });
      chip.addEventListener('touchend',    () => clearTimeout(_ct), { passive: true });
      chip.addEventListener('touchmove',   () => clearTimeout(_ct), { passive: true });

      /* 드래그 정렬 */
      chip.addEventListener('dragstart', e => {
        _dragId = chip.dataset.id;
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend',   () => {
        chip.classList.remove('dragging');
        strip.querySelectorAll('.cdh-chip').forEach(c => c.classList.remove('drag-over'));
        _dragId = null;
      });
      chip.addEventListener('dragover',  e => {
        e.preventDefault();
        strip.querySelectorAll('.cdh-chip').forEach(c => c.classList.remove('drag-over'));
        if (chip.dataset.id !== _dragId) chip.classList.add('drag-over');
      });
      chip.addEventListener('drop',      e => {
        e.preventDefault();
        if (!_dragId || _dragId === chip.dataset.id) return;
        const fi = quick.findIndex(q => q.id === _dragId);
        const ti = quick.findIndex(q => q.id === chip.dataset.id);
        if (fi < 0 || ti < 0) return;
        const [m] = quick.splice(fi, 1);
        quick.splice(ti, 0, m);
        save(); renderChips();
      });
    });

    /* ✕ 삭제 */
    strip.querySelectorAll('.cdh-chip-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        quick = quick.filter(q => q.id !== btn.dataset.id);
        save(); renderChips();
      });
    });

    /* ＋ 추가 드롭다운 열기 */
    strip.querySelector('#cdh-chip-add')?.addEventListener('click', e => {
      e.stopPropagation();
      closeDD(editDD);
      if (_openDD === addDD) closeDD(addDD);
      else openDD(addDD, e.currentTarget);
      setTimeout(() => addLbl()?.focus(), 50);
    });
  }

  /* ════════════════════════════════════════
     정규식 목록 렌더
  ════════════════════════════════════════ */
  function renderRList() {
    const list = document.getElementById('cdh-rlist');
    if (!list) return;
    if (rules.length === 0) {
      list.innerHTML = `<div class="cdh-r-empty">규칙이 없어요. 위에서 추가하세요.</div>`;
      return;
    }
    const onCnt = rules.filter(r => r.on).length;
    list.innerHTML = `
      <div class="cdh-r-info">
        <span>활성 <b>${onCnt}/${rules.length}</b></span>
        <button id="cdh-r-toggleall">전체 토글</button>
      </div>
    ` + rules.map(r => `
      <div class="cdh-rule">
        <input class="cdh-rule-chk" type="checkbox" ${r.on ? 'checked' : ''} data-id="${r.id}">
        <span class="cdh-rule-text">
          ${esc(r.from)}<span class="arr">→</span><span class="to">${esc(r.to || '""')}</span>
        </span>
        <button class="cdh-rule-x" data-id="${r.id}">✕</button>
      </div>
    `).join('');

    list.querySelector('#cdh-r-toggleall')?.addEventListener('click', e => {
      e.stopPropagation();
      const anyOn = rules.some(r => r.on);
      rules.forEach(r => { r.on = !anyOn; });
      save(); renderRList();
      if (regOn) patchAll();
    });
    list.querySelectorAll('.cdh-rule-chk').forEach(cb => {
      cb.addEventListener('change', () => {
        const r = rules.find(r => r.id === cb.dataset.id);
        if (r) { r.on = cb.checked; save(); }
        renderRList(); if (regOn) patchAll();
      });
    });
    list.querySelectorAll('.cdh-rule-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        rules = rules.filter(r => r.id !== btn.dataset.id);
        save(); renderRList(); if (regOn) patchAll();
      });
    });
  }

  /* ════════════════════════════════════════
     MutationObserver + 초기화
  ════════════════════════════════════════ */
  let _pend = false;
  new MutationObserver(() => {
    if (_pend) return; _pend = true;
    requestAnimationFrame(() => {
      _pend = false;
      if (!document.getElementById('cdh-wrap')) injectUI();
      if (regOn) patchAll();
    });
  }).observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUI);
  else injectUI();

})();

// ==UserScript==
// @name         케덕 정규식과 퀵입력
// @namespace    https://caveduck.io/
// @version      15.0.0
// @description  케이브덕: 정규식 + 퀵입력
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

  /* ────────────────────────────────────────
     스토리지
  ──────────────────────────────────────── */
  const S = {
    get: (k, d) => { try { return JSON.parse(GM_getValue(k, JSON.stringify(d))); } catch { return d; } },
    set: (k, v) => GM_setValue(k, JSON.stringify(v)),
  };
  let quick = S.get('cdh_q',  []);  // [{id,label,text}]
  let rules = [];                    // 저장 안 함 — 세션 중에만 유지
  let regOn = S.get('cdh_on', false);
  const save = () => { S.set('cdh_q', quick); S.set('cdh_on', regOn); };
  const uid  = () => Math.random().toString(36).slice(2, 8);
  const esc  = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ────────────────────────────────────────
     정규식 치환
  ──────────────────────────────────────── */
  function applyRules(t) {
    if (!regOn) return t;
    let r = t;
    for (const rule of rules) {
      if (!rule.on) continue;
      try { r = r.replace(new RegExp(rule.from, 'g'), rule.to); } catch {}
    }
    return r;
  }
  // ── 정규식 치환: 오버레이 삽입 방식 ─────────────────
  // React 관리 텍스트 노드를 절대 건드리지 않음
  // 대신 치환 텍스트를 담은 <span class="cdh-overlay"> 를
  // 원본 span 바로 뒤에 삽입하고, 원본 span을 visibility:hidden

  let _patching = false;

  function patchAll() {
    if (_patching) return;
    _patching = true;
    try {
      const wrap = document.getElementById('cdh-wrap');
      document.querySelectorAll('[class*="contain"] span').forEach(sp => {
        if (wrap && wrap.contains(sp)) return;
        if (sp.classList.contains('cdh-overlay')) return;
        if (sp.childElementCount > 0) return;
        const raw = sp.textContent;
        if (!raw.trim()) return;

        const next = applyRules(raw);
        if (next === raw) {
          // 치환 없음 — 오버레이 있으면 제거
          const ov = sp.nextSibling;
          if (ov && ov.classList?.contains('cdh-overlay')) {
            ov.remove();
            sp.style.visibility = '';
          }
          return;
        }

        // 이미 오버레이 있으면 텍스트만 갱신
        const existing = sp.nextSibling;
        if (existing && existing.classList?.contains('cdh-overlay')) {
          if (existing.textContent !== next) existing.textContent = next;
        } else {
          // 오버레이 새로 삽입
          const ov = document.createElement('span');
          ov.className = 'cdh-overlay';
          ov.textContent = next;
          // 원본 span의 스타일 복사 (색상, italic 등)
          ov.style.cssText = sp.style.cssText;
          ov.setAttribute('aria-hidden', 'true');
          sp.after(ov);
        }
        sp.style.visibility = 'hidden';
        sp.style.position   = 'absolute';
      });
    } finally {
      _patching = false;
    }
  }

  function restoreAll() {
    _patching = true;
    try {
      document.querySelectorAll('.cdh-overlay').forEach(ov => ov.remove());
      document.querySelectorAll('[class*="contain"] span').forEach(sp => {
        if (sp.style.visibility === 'hidden') {
          sp.style.visibility = '';
          sp.style.position   = '';
        }
      });
    } finally {
      _patching = false;
    }
  }

  /* ────────────────────────────────────────
     입력창 삽입 (React 우회)
  ──────────────────────────────────────── */
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

  /* ────────────────────────────────────────
     드롭다운 싱글턴
     항상 앵커의 위쪽에 뜨고, 내용 길이가
     늘어나도 아래가 아닌 위로 성장
  ──────────────────────────────────────── */
  let _curDD   = null;  // 현재 열린 DD
  let _curAnchor = null;

  function ddOpen(dd, anchor) {
    if (_curDD && _curDD !== dd) ddClose(_curDD);
    if (!document.body.contains(dd)) document.body.appendChild(dd);
    _curDD     = dd;
    _curAnchor = anchor;
    dd.style.display = 'flex';
    ddPos(dd, anchor);
  }

  function ddClose(dd) {
    if (!dd) return;
    dd.style.display = 'none';
    if (_curDD === dd) { _curDD = null; _curAnchor = null; }
    // 버튼 뱃지 정리
    document.querySelectorAll('.cdh-btn.dd-open').forEach(b => b.classList.remove('dd-open'));
  }

  // 항상 앵커 위에 붙이고, 좌우 넘침 보정
  function ddPos(dd, anchor) {
    const r   = anchor.getBoundingClientRect();
    const dw  = dd.offsetWidth  || 270;
    const dh  = dd.offsetHeight || 10;
    const gap = 6;
    // bottom 고정: 앵커 top 에서 gap 위
    const bottom = window.innerHeight - r.top + gap;
    let left = r.left + window.scrollX;
    if (left + dw > window.innerWidth - 8) left = window.innerWidth - dw - 8;
    if (left < 4) left = 4;
    dd.style.bottom = bottom + 'px';
    dd.style.top    = 'auto';
    dd.style.left   = left + 'px';
    dd.style.maxHeight = (r.top - gap - 8) + 'px';  // 화면 위로 넘치지 않게
  }

  // 열린 DD 위치 갱신 (내용 변경 후)
  function ddRepos() {
    if (_curDD && _curAnchor) {
      requestAnimationFrame(() => ddPos(_curDD, _curAnchor));
    }
  }

  document.addEventListener('click',   () => { if (_curDD) ddClose(_curDD); });
  document.addEventListener('keydown', e  => { if (e.key === 'Escape' && _curDD) ddClose(_curDD); });

  /* ────────────────────────────────────────
     스타일
  ──────────────────────────────────────── */
  document.head.insertAdjacentHTML('beforeend', `<style>
    :root {
      --cdh-fs:  clamp(12px, 1.5vw, 15px);
      --cdh-fss: clamp(11px, 1.3vw, 13px);
      --cdh-gap: clamp(4px, 0.7vw, 8px);
      --cdh-pad: clamp(8px, 1.1vw, 12px);
      --cdh-btn: clamp(32px, 4vw, 38px);
    }

    #cdh-wrap { margin-bottom: 6px; }

    /* 정규식 오버레이 span */
    .cdh-overlay {
      pointer-events: none;
      user-select: none;
    }

    /* ── 버튼 ── */
    .cdh-btn {
      display: inline-flex; align-items: center; justify-content: center;
      position: relative;
      width: var(--cdh-btn); height: var(--cdh-btn);
      border-radius: 50%; border: none;
      background: transparent; color: #aaa;
      font-size: clamp(16px, 2vw, 20px);
      cursor: pointer; flex-shrink: 0;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
      transition: background .12s, color .12s;
    }
    .cdh-btn:hover  { background: rgba(255,255,255,.08); color: #eee; }
    .cdh-btn:active { opacity: .7; }
    .cdh-btn.on     { color: #bc1e51; }
    .cdh-btn.on:hover { color: #e0305a; }
    /* 드롭다운 열림 뱃지 */
    .cdh-btn.dd-open::after {
      content: '';
      position: absolute; bottom: 3px; right: 3px;
      width: 5px; height: 5px;
      border-radius: 50%; background: #fdc700;
      pointer-events: none;
    }

    /* ── 칩 스트립 ── */
    #cdh-chips {
      display: none; align-items: center; gap: var(--cdh-gap);
      padding: var(--cdh-gap) var(--cdh-pad) calc(var(--cdh-gap) * .5);
      overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap;
    }
    #cdh-chips.open { display: flex; }
    #cdh-chips::-webkit-scrollbar { display: none; }

    .cdh-chip {
      display: inline-flex; align-items: center;
      height: clamp(26px, 3.2vw, 32px);
      padding: 0 clamp(9px, 1.2vw, 13px);
      border-radius: 20px; border: 1px solid rgba(255,255,255,.13);
      background: rgba(255,255,255,.07); color: #ccc;
      font-size: var(--cdh-fss); font-weight: 500; font-family: inherit;
      white-space: nowrap; flex-shrink: 0; cursor: grab;
      -webkit-tap-highlight-color: transparent;
      transition: background .1s, border-color .1s, opacity .1s;
      user-select: none;
    }
    .cdh-chip:hover     { background: rgba(255,255,255,.13); color: #eee; }
    .cdh-chip.dragging  { opacity: .3; cursor: grabbing; }
    .cdh-chip.drag-over { border-color: #fdc700; background: rgba(253,199,0,.1); }

    .cdh-chip-x {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; margin-left: 5px; margin-right: -3px;
      border-radius: 50%; background: rgba(255,255,255,.14); border: none;
      color: #888; font-size: 8px; cursor: pointer; line-height: 1;
      -webkit-tap-highlight-color: transparent; transition: background .1s; flex-shrink: 0;
    }
    .cdh-chip-x:hover { background: #bc1e51; color: #fff; }

    #cdh-chip-add {
      cursor: pointer !important;
      background: rgba(188,30,81,.1) !important; border-color: rgba(188,30,81,.3) !important;
      color: #bc1e51 !important; font-size: clamp(14px,1.6vw,17px) !important;
      padding: 0 clamp(8px,1.1vw,12px) !important;
    }
    #cdh-chip-add:hover { background: rgba(188,30,81,.2) !important; }

    /* ── 공용 드롭다운 ── */
    .cdh-dd {
      position: fixed; z-index: 999999;
      flex-direction: column; gap: clamp(7px, 1vw, 11px);
      background: #1e1f1f;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 11px;
      box-shadow: 0 -4px 24px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.4);
      padding: clamp(11px, 1.4vw, 15px);
      width: clamp(240px, 30vw, 300px);
      display: none;
    }
    @media (max-width: 600px) {
      .cdh-dd { width: min(300px, calc(100vw - 20px)); }
    }

    .cdh-dd-title { font-size: var(--cdh-fss); font-weight: 700; color: #777; }
    .cdh-dd label { font-size: var(--cdh-fss); color: #666; margin-bottom: 2px; display: block; }
    .cdh-dd input, .cdh-dd textarea {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.11);
      border-radius: 7px; color: #eee;
      font-size: var(--cdh-fs); font-family: inherit;
      padding: clamp(5px,.7vw,8px) clamp(8px,1vw,11px);
      outline: none; -webkit-appearance: none; resize: none;
      transition: border-color .12s;
    }
    .cdh-dd input:focus, .cdh-dd textarea:focus { border-color: #bc1e51; }
    .cdh-dd textarea { min-height: clamp(54px, 7vw, 74px); }

    .cdh-dd-row { display: flex; gap: var(--cdh-gap); }
    .cdh-dd-row button {
      flex: 1; height: clamp(30px, 3.5vw, 36px);
      border-radius: 7px; border: none;
      font-size: var(--cdh-fs); font-weight: 700; font-family: inherit;
      cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .1s;
    }
    .cdh-dd-ok     { background: #bc1e51; color: #fff; }
    .cdh-dd-ok:hover { background: #a01a45; }
    .cdh-dd-save   { background: #fdc700; color: #111; }
    .cdh-dd-save:hover { background: #e6b400; }
    .cdh-dd-cancel { background: rgba(255,255,255,.08); color: #aaa; }
    .cdh-dd-cancel:hover { background: rgba(255,255,255,.15); }

    /* ── 정규식 드롭다운 전용 ── */
    .cdh-rdd-top {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: clamp(6px,.8vw,9px);
      border-bottom: 1px solid rgba(255,255,255,.07);
    }
    .cdh-rdd-top-label { font-size: var(--cdh-fs); font-weight: 600; color: #ccc; }

    /* 토글 스위치 */
    .cdh-sw { position: relative; width: 38px; height: 21px; cursor: pointer; flex-shrink: 0; }
    .cdh-sw input { display: none; }
    .cdh-sw-track {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.12); border-radius: 11px; transition: background .2s;
    }
    .cdh-sw input:checked ~ .cdh-sw-track { background: #bc1e51; }
    .cdh-sw-thumb {
      position: absolute; top: 3px; left: 3px;
      width: 15px; height: 15px; border-radius: 50%; background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.35); transition: left .2s;
    }
    .cdh-sw input:checked ~ .cdh-sw-track .cdh-sw-thumb { left: 20px; }

    /* 정규식 추가 폼 */
    .cdh-rdd-form {
      display: flex; align-items: center; gap: clamp(4px,.6vw,7px);
    }
    .cdh-rdd-form input {
      flex: 1; min-width: 0; box-sizing: border-box;
      background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.11);
      border-radius: 7px; color: #eee;
      font-size: var(--cdh-fss); font-family: monospace;
      padding: clamp(4px,.6vw,7px) clamp(6px,.9vw,9px);
      outline: none; -webkit-appearance: none; transition: border-color .12s;
    }
    .cdh-rdd-form input:focus { border-color: #bc1e51; }
    .cdh-rdd-form input::placeholder { font-family: inherit; opacity: .4; font-size: clamp(9px,1vw,11px); }
    .cdh-rdd-form .arr { color: #555; font-size: var(--cdh-fss); flex-shrink: 0; }
    .cdh-rdd-form button {
      height: clamp(27px,3.2vw,33px); padding: 0 clamp(7px,1vw,11px);
      border-radius: 7px; border: none;
      background: rgba(255,255,255,.09); color: #bbb;
      font-size: var(--cdh-fss); font-weight: 700; font-family: inherit;
      cursor: pointer; flex-shrink: 0; white-space: nowrap;
      -webkit-tap-highlight-color: transparent; transition: background .1s;
    }
    .cdh-rdd-form button:hover { background: rgba(255,255,255,.17); color: #eee; }

    /* 정규식 규칙 목록 */
    .cdh-rdd-info {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: clamp(3px,.5vw,5px);
      border-bottom: 1px solid rgba(255,255,255,.05);
    }
    .cdh-rdd-info span { font-size: var(--cdh-fss); color: #555; }
    .cdh-rdd-info span b { color: #999; }
    .cdh-rdd-info button {
      background: none; border: none; font-size: var(--cdh-fss);
      color: #8ec5ff; cursor: pointer; font-family: inherit; padding: 0;
    }
    .cdh-rdd-info button:hover { text-decoration: underline; }

    /* 규칙 목록 */
    .cdh-rdd-rules {
      display: flex; flex-direction: column; gap: 4px;
      max-height: 200px;
      overflow-y: auto; overflow-x: hidden;
    }
    .cdh-rdd-rules::-webkit-scrollbar { width: 3px; }
    .cdh-rdd-rules::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

    /* 규칙 카드 */
    .cdh-rule {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 8px;
      background: rgba(255,255,255,.04);
      border-radius: 7px;
      border: 1.5px solid rgba(255,255,255,.06);
      cursor: pointer;
      transition: border-color .15s, background .15s;
      -webkit-tap-highlight-color: transparent;
    }
    .cdh-rule:hover { background: rgba(255,255,255,.07); }
    .cdh-rule.active {
      border-color: #bc1e51;
      background: rgba(188,30,81,.08);
    }
    .cdh-rule.active .cdh-rule-from { color: #fff; }
    /* 패턴/치환 텍스트 영역 */
    .cdh-rule-body {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 2px;
    }
    .cdh-rule-from {
      font-size: var(--cdh-fss); font-family: monospace;
      color: #ccc;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cdh-rule-to {
      font-size: calc(var(--cdh-fss) - 1px); font-family: monospace;
      color: #fdc700;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .cdh-rule-to::before { content: '→ '; color: #444; }
    .cdh-rule-to.empty { color: #555; }
    .cdh-rule-to.empty::before { color: #333; }
    .cdh-rule-x {
      background: none; border: none; color: #555;
      font-size: 13px; cursor: pointer;
      padding: 3px 5px; border-radius: 5px;
      flex-shrink: 0; line-height: 1;
      -webkit-tap-highlight-color: transparent; transition: color .1s;
    }
    .cdh-rule-x:hover { color: #bc1e51; }
    .cdh-r-empty { font-size: var(--cdh-fss); color: #555; text-align: center; padding: 8px 0; }
  </style>`);

  /* ────────────────────────────────────────
     퀵입력 추가 드롭다운
  ──────────────────────────────────────── */
  const addDD = document.createElement('div');
  addDD.className = 'cdh-dd';
  addDD.innerHTML = `
    <div class="cdh-dd-title">＋ 퀵입력 추가</div>
    <div><label>이름</label><input class="add-lbl" placeholder="예: 인사말" maxlength="20"></div>
    <div><label>내용</label><textarea class="add-txt" placeholder="입력창에 삽입될 텍스트" rows="3"></textarea></div>
    <div class="cdh-dd-row">
      <button class="cdh-dd-ok add-ok">추가</button>
      <button class="cdh-dd-cancel add-cancel">취소</button>
    </div>
  `;
  addDD.addEventListener('click', e => e.stopPropagation());

  function submitAdd() {
    const lbl = addDD.querySelector('.add-lbl').value.trim();
    const txt = addDD.querySelector('.add-txt').value.trim();
    if (!lbl || !txt) return;
    quick.push({ id: uid(), label: lbl, text: txt });
    save();
    addDD.querySelector('.add-lbl').value = '';
    addDD.querySelector('.add-txt').value = '';
    ddClose(addDD);
    renderChips();
  }
  addDD.querySelector('.add-ok').addEventListener('click',     e => { e.stopPropagation(); submitAdd(); });
  addDD.querySelector('.add-cancel').addEventListener('click',  e => { e.stopPropagation(); ddClose(addDD); });
  addDD.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAdd(); } });

  /* ────────────────────────────────────────
     퀵입력 수정 드롭다운
  ──────────────────────────────────────── */
  const editDD = document.createElement('div');
  editDD.className = 'cdh-dd';
  editDD.innerHTML = `
    <div class="cdh-dd-title">✎ 수정</div>
    <div><label>이름</label><input class="edit-lbl" placeholder="이름" maxlength="20"></div>
    <div><label>내용</label><textarea class="edit-txt" placeholder="내용" rows="3"></textarea></div>
    <div class="cdh-dd-row">
      <button class="cdh-dd-save edit-ok">저장</button>
      <button class="cdh-dd-cancel edit-cancel">취소</button>
    </div>
  `;
  editDD.addEventListener('click', e => e.stopPropagation());

  let _editId = null;

  function submitEdit() {
    if (!_editId) return;
    const lbl = editDD.querySelector('.edit-lbl').value.trim();
    const txt = editDD.querySelector('.edit-txt').value.trim();
    if (!lbl || !txt) return;
    const q = quick.find(q => q.id === _editId);
    if (q) { q.label = lbl; q.text = txt; save(); renderChips(); }
    ddClose(editDD);
    _editId = null;
  }
  editDD.querySelector('.edit-ok').addEventListener('click',     e => { e.stopPropagation(); submitEdit(); });
  editDD.querySelector('.edit-cancel').addEventListener('click',  e => { e.stopPropagation(); ddClose(editDD); _editId = null; });
  editDD.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); } });

  function openEditForChip(id, anchor) {
    const q = quick.find(q => q.id === id);
    if (!q) return;
    _editId = id;
    editDD.querySelector('.edit-lbl').value = q.label;
    editDD.querySelector('.edit-txt').value = q.text;
    ddOpen(editDD, anchor);
    setTimeout(() => editDD.querySelector('.edit-lbl')?.focus(), 60);
  }

  /* ────────────────────────────────────────
     정규식 드롭다운
  ──────────────────────────────────────── */
  const regDD = document.createElement('div');
  regDD.className = 'cdh-dd';
  regDD.innerHTML = `
    <div class="cdh-rdd-top">
      <span class="cdh-rdd-top-label">정규식 치환</span>
      <label class="cdh-sw">
        <input type="checkbox" class="reg-tog" ${regOn ? 'checked' : ''}>
        <div class="cdh-sw-track"><div class="cdh-sw-thumb"></div></div>
      </label>
    </div>
    <div class="cdh-rdd-form">
      <input class="rf-from" placeholder="찾을 패턴">
      <span class="arr">→</span>
      <input class="rf-to" placeholder="바꿀 텍스트">
      <button class="rf-add">추가</button>
    </div>
    <div class="cdh-rdd-rules-wrap"></div>
  `;
  regDD.addEventListener('click', e => e.stopPropagation());

  // ON/OFF 토글 (드롭다운 내부)
  regDD.querySelector('.reg-tog').addEventListener('change', e => {
    regOn = e.target.checked; save();
    syncRBtn();
    if (regOn) patchAll(); else restoreAll();
  });

  // 규칙 추가
  function submitRule() {
    const from = regDD.querySelector('.rf-from').value.trim();
    const to   = regDD.querySelector('.rf-to').value;
    if (!from) { regDD.querySelector('.rf-from').focus(); return; }
    try { new RegExp(from); } catch { alert('잘못된 정규식입니다.'); return; }
    rules.push({ id: uid(), from, to, on: true });
    save();
    regDD.querySelector('.rf-from').value = '';
    regDD.querySelector('.rf-to').value   = '';
    renderRList();
    ddRepos();           // 내용 늘어났으니 위치 재계산
    if (regOn) patchAll();
  }
  regDD.querySelector('.rf-add').addEventListener('click', e => { e.stopPropagation(); submitRule(); });
  regDD.querySelector('.cdh-rdd-form').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitRule(); } });

  function renderRList() {
    const wrap = regDD.querySelector('.cdh-rdd-rules-wrap');
    if (!wrap) return;
    if (rules.length === 0) {
      wrap.innerHTML = `<div class="cdh-r-empty">규칙이 없어요.</div>`; return;
    }
    const onCnt = rules.filter(r => r.on).length;
    wrap.innerHTML = `
      <div class="cdh-rdd-info">
        <span>활성 <b>${onCnt}/${rules.length}</b></span>
        <button class="r-all-tog">전체 토글</button>
      </div>
      <div class="cdh-rdd-rules">
        ${rules.map(r => `
          <div class="cdh-rule ${r.on ? 'active' : ''}" data-id="${r.id}">
            <div class="cdh-rule-body">
              <div class="cdh-rule-from">${esc(r.from)}</div>
              <div class="cdh-rule-to ${r.to ? '' : 'empty'}">${esc(r.to || '(빈 문자열)')}</div>
            </div>
            <button class="cdh-rule-x" data-id="${r.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;
    wrap.querySelector('.r-all-tog')?.addEventListener('click', e => {
      e.stopPropagation();
      const anyOn = rules.some(r => r.on);
      rules.forEach(r => r.on = !anyOn); save(); renderRList(); ddRepos();
      if (regOn) patchAll();
    });
    wrap.querySelectorAll('.cdh-rule').forEach(card => {
      // 카드 클릭 → ON/OFF 토글 (✕ 버튼 클릭은 제외)
      card.addEventListener('click', e => {
        if (e.target.closest('.cdh-rule-x')) return;
        e.stopPropagation();
        const r = rules.find(r => r.id === card.dataset.id);
        if (r) { r.on = !r.on; save(); }
        renderRList(); ddRepos();
        if (regOn) patchAll();
      });
    });
    wrap.querySelectorAll('.cdh-rule-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        rules = rules.filter(r => r.id !== btn.dataset.id);
        save(); renderRList(); ddRepos();
        if (regOn) patchAll();
      });
    });
  }

  /* ────────────────────────────────────────
     아이콘 상수
  ──────────────────────────────────────── */
  const ICON_Q = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>`;
  const ICON_R = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v12"/><path d="M17.196 9 6.804 15"/><path d="m6.804 9 10.392 6"/></svg>`;

  let _rBtn = null;

  function syncRBtn() {
    if (!_rBtn) return;
    // ON이면 색 변경, 드롭다운 열림이면 뱃지
    _rBtn.className = 'cdh-btn'
      + (regOn          ? ' on'      : '')
      + (_curDD === regDD ? ' dd-open' : '');
    // 드롭다운 내 토글도 동기화
    const tog = regDD.querySelector('.reg-tog');
    if (tog) tog.checked = regOn;
  }

  /* ────────────────────────────────────────
     UI 주입
  ──────────────────────────────────────── */
  function injectUI() {
    const bar  = document.querySelector(SEL_BTNBAR);
    const form = document.querySelector(SEL_FORM);
    if (!bar || !form || bar.querySelector('.cdh-btn')) return;

    /* 퀵입력 버튼 */
    const qBtn = document.createElement('button');
    qBtn.type = 'button'; qBtn.className = 'cdh-btn'; qBtn.title = '퀵입력';
    qBtn.innerHTML = ICON_Q;

    /* 정규식 버튼 */
    const rBtn = document.createElement('button');
    rBtn.type = 'button'; rBtn.title = '정규식 (우클릭: 관리)';
    rBtn.className = 'cdh-btn' + (regOn ? ' on' : '');
    rBtn.innerHTML = ICON_R;
    _rBtn = rBtn;

    bar.appendChild(qBtn);
    bar.appendChild(rBtn);

    /* 칩 스트립 */
    const wrap = document.createElement('div');
    wrap.id = 'cdh-wrap';
    wrap.innerHTML = `<div id="cdh-chips"></div>`;
    const taWrap = form.querySelector('.relative.w-full');
    if (taWrap) form.insertBefore(wrap, taWrap);
    else        form.prepend(wrap);
    wrap.addEventListener('click', e => e.stopPropagation());

    /* 퀵입력 버튼: 칩 스트립 토글 */
    qBtn.addEventListener('click', e => {
      e.stopPropagation();
      // 열린 DD 닫기
      if (_curDD) ddClose(_curDD);
      const chips = document.getElementById('cdh-chips');
      if (chips.classList.contains('open')) {
        chips.classList.remove('open');
        qBtn.classList.remove('dd-open');
      } else {
        renderChips();
        chips.classList.add('open');
        qBtn.classList.add('dd-open');
      }
    });

    /* 정규식 버튼: 좌클릭 = ON/OFF 즉시 토글 */
    rBtn.addEventListener('click', e => {
      e.stopPropagation();
      regOn = !regOn; save();
      syncRBtn();
      if (regOn) patchAll(); else restoreAll();
    });

    /* 정규식 버튼: 우클릭 = 드롭다운 */
    rBtn.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if (_curDD === regDD) { ddClose(regDD); syncRBtn(); }
      else { renderRList(); ddOpen(regDD, rBtn); syncRBtn(); }
    });

    /* 정규식 버튼: 롱프레스(모바일) = 드롭다운
       — touchstart 후 300ms 안에 touchend 없으면 열림
         touchmove 가 10px 이상이면 취소 */
    let _rLongTimer = null;
    let _rTouchStart = null;
    rBtn.addEventListener('touchstart', e => {
      _rTouchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _rLongTimer  = setTimeout(() => {
        _rLongTimer = null;
        if (_curDD === regDD) { ddClose(regDD); syncRBtn(); }
        else { renderRList(); ddOpen(regDD, rBtn); syncRBtn(); }
      }, 400);
    }, { passive: true });
    rBtn.addEventListener('touchmove', e => {
      if (!_rTouchStart) return;
      const dx = Math.abs(e.touches[0].clientX - _rTouchStart.x);
      const dy = Math.abs(e.touches[0].clientY - _rTouchStart.y);
      if (dx > 10 || dy > 10) { clearTimeout(_rLongTimer); _rLongTimer = null; }
    }, { passive: true });
    rBtn.addEventListener('touchend', () => {
      clearTimeout(_rLongTimer); _rLongTimer = null; _rTouchStart = null;
    }, { passive: true });

    renderChips();
    renderRList();
  }

  /* ────────────────────────────────────────
     칩 렌더 + 드래그 정렬
  ──────────────────────────────────────── */
  let _dragId = null;

  function renderChips() {
    const strip = document.getElementById('cdh-chips');
    if (!strip) return;

    strip.innerHTML = quick.map(q =>
      `<span class="cdh-chip" draggable="true" data-id="${q.id}">
        ${esc(q.label)}
        <button class="cdh-chip-x" data-id="${q.id}">✕</button>
      </span>`
    ).join('') + `<span class="cdh-chip" id="cdh-chip-add" draggable="false">＋</span>`;

    strip.querySelectorAll('.cdh-chip:not(#cdh-chip-add)').forEach(chip => {
      // 클릭 vs 드래그 구분
      let _ps = null;
      chip.addEventListener('pointerdown', e => {
        if (e.button === 2) return; // 우클릭 무시
        _ps = { x: e.clientX, y: e.clientY };
      });
      chip.addEventListener('pointerup',   e => {
        if (e.button === 2) return; // 우클릭 무시
        if (e.target.closest('.cdh-chip-x')) return;
        if (!_ps) return;
        const moved = Math.hypot(e.clientX - _ps.x, e.clientY - _ps.y) > 8;
        _ps = null;
        if (moved) return;
        // 좌클릭 → 입력창에 삽입
        const q = quick.find(q => q.id === chip.dataset.id);
        if (q) insertText(q.text);
      });

      // 우클릭 → 수정 드롭다운
      chip.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        openEditForChip(chip.dataset.id, chip);
      });

      // 드래그 정렬
      chip.addEventListener('dragstart', e => {
        _dragId = chip.dataset.id;
        chip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      chip.addEventListener('dragend', () => {
        chip.classList.remove('dragging');
        strip.querySelectorAll('.cdh-chip').forEach(c => c.classList.remove('drag-over'));
        _dragId = null;
      });
      chip.addEventListener('dragover', e => {
        e.preventDefault();
        strip.querySelectorAll('.cdh-chip').forEach(c => c.classList.remove('drag-over'));
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

    // ✕ 삭제
    strip.querySelectorAll('.cdh-chip-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        quick = quick.filter(q => q.id !== btn.dataset.id);
        save(); renderChips();
      });
    });

    // ＋ 추가
    strip.querySelector('#cdh-chip-add')?.addEventListener('click', e => {
      e.stopPropagation();
      if (_curDD === addDD) { ddClose(addDD); return; }
      ddClose(editDD);
      ddOpen(addDD, e.currentTarget);
      setTimeout(() => addDD.querySelector('.add-lbl')?.focus(), 60);
    });
  }

  /* ────────────────────────────────────────
     MutationObserver + 초기화
  ──────────────────────────────────────── */
  let _pend = false;
  new MutationObserver(mutations => {
    if (_patching) return;
    const ignore = mutations.every(m =>
      [...m.addedNodes, ...m.removedNodes].every(n =>
        n.nodeType === Node.TEXT_NODE ||
        (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'MARK' && n.classList?.contains('custom-cdhlp')) ||
        (n.nodeType === Node.ELEMENT_NODE && n.classList?.contains('cdh-overlay'))
      )
    );
    if (ignore) return;
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

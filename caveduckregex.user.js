// ==UserScript==
// @name         케덕 정규식
// @namespace    https://caveduck.io/
// @version      2.1.0
// @description  케이브덕 정규식
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

  /* ────────────────────────────────────────
     스토리지
  ──────────────────────────────────────── */
  const S = {
    get: (k, d) => { try { return JSON.parse(GM_getValue(k, JSON.stringify(d))); } catch { return d; } },
    set: (k, v) => GM_setValue(k, JSON.stringify(v)),
  };

  let rules = S.get('cdhr_r',  []);   // [{id, from, to, on}]
  let regOn = S.get('cdhr_on', false);

  const saveR = () => { S.set('cdhr_r', rules); S.set('cdhr_on', regOn); };
  const uid   = () => Math.random().toString(36).slice(2, 8);
  const esc   = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  /* ────────────────────────────────────────
     정규식 치환 엔진
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

  /* ── 형광펜 MutationObserver 일시 정지/재개 ──
     patchAll/restoreAll 이 DOM을 건드리는 동안
     형광펜 스크립트의 observer 와 핑퐁하지 않도록 잠깐 끊음 */
  let _patching = false;

  function _hlpPause()  { try { window.__cdhlpObserver?.disconnect(); } catch {} }
  function _hlpResume() {
    try {
      if (window.__cdhlpObserver)
        window.__cdhlpObserver.observe(document.body, { childList: true, subtree: true });
    } catch {}
  }

  /* ── span 단위 원본 저장 방식 ─────────────────────────────
     핵심 설계:
     형광펜은 span 안의 텍스트노드를 쪼개서 mark 를 삽입하므로
     텍스트노드 단위 추적은 mark 삽입 후 노드가 바뀌어 복원이 깨짐.

     해결: span 자체에 원본 textContent 를 저장(_cdhrOrig)하고
     restoreAll 에서 span.textContent 를 원본으로 한 번에 덮어씀.
     → mark 가 있어도 span 전체를 원본 텍스트로 교체하므로 중복 없음.
     → 단, restoreAll 후 형광펜 mark 는 사라짐 (형광펜 스크립트가 재적용)

     patchAll:
       1. span._cdhrOrig 가 없으면: textContent 전체를 읽어 치환값 계산
          치환값이 원본과 다르면 span._cdhrOrig = 원본 저장
          span 안 텍스트노드들을 직접 교체 (React 우회)
       2. span._cdhrOrig 가 있으면(이미 치환됨): 스킵

     restoreAll:
       span._cdhrOrig 가 있는 span 만 찾아서
       textContent 를 원본으로 복원 후 _cdhrOrig 삭제

     _patching = false 는 반드시 _hlpResume() 전에 세팅
  ─────────────────────────────────────────────────────── */

  // 대상 span 수집 — 자체 UI / mark 내부 span 제외
  function _getTargetSpans() {
    const wrap = document.getElementById('cdhr-wrap');
    return Array.from(
      document.querySelectorAll('[class*="contain"] span, [class="[contain:paint]"] span')
    ).filter(sp => {
      if (wrap && wrap.contains(sp)) return false;
      if (sp.closest('[id^="cdhr"]')) return false;
      // mark 안의 span 은 mark 가 속한 부모 span 에서 일괄 처리
      if (sp.closest('mark.custom-cdhlp')) return false;
      return true;
    });
  }

  // span 안 모든 텍스트노드를 주어진 평문으로 교체
  // mark 가 있으면 mark 와 그 주변 텍스트노드를 전부 제거하고 새 텍스트노드 하나로 대체
  function _setSpanText(sp, text) {
    // 자식을 모두 지우고 텍스트노드 하나로 교체
    // (mark 포함 전체 교체 — restoreAll 전용)
    while (sp.firstChild) sp.removeChild(sp.firstChild);
    sp.appendChild(document.createTextNode(text));
  }

  // span 안 텍스트노드만 치환값으로 교체 (mark 는 보존)
  function _patchSpanNodes(sp, origText) {
    // mark 가 없는 경우: 텍스트노드 직접 교체
    if (!sp.querySelector('mark.custom-cdhlp')) {
      const walker = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      // 모든 텍스트를 이어 붙인 뒤 치환
      const combined = nodes.map(tn => tn.nodeValue).join('');
      const next = applyRules(combined);
      if (next === combined) return false; // 치환 없음
      // 첫 텍스트노드에 치환값 넣고 나머지 비움
      if (nodes.length > 0) {
        nodes[0].nodeValue = next;
        for (let i = 1; i < nodes.length; i++) nodes[i].nodeValue = '';
      }
      return true;
    }

    // mark 가 있는 경우: mark 안/밖 텍스트노드 각각 치환
    // mark 바깥 텍스트노드
    let changed = false;
    sp.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        const next = applyRules(child.nodeValue);
        if (next !== child.nodeValue) { child.nodeValue = next; changed = true; }
      } else if (child.tagName === 'MARK' && child.classList.contains('custom-cdhlp')) {
        // mark 안 텍스트노드
        child.childNodes.forEach(mc => {
          if (mc.nodeType === Node.TEXT_NODE) {
            const next = applyRules(mc.nodeValue);
            if (next !== mc.nodeValue) { mc.nodeValue = next; changed = true; }
          }
        });
      }
    });
    return changed;
  }

  function patchAll() {
    if (_patching) return;
    _patching = true;
    _hlpPause();
    try {
      _getTargetSpans().forEach(sp => {
        // 이미 치환됨
        if (sp._cdhrOrig !== undefined) return;
        const orig = sp.textContent;
        if (!orig || !orig.trim()) return;
        const changed = _patchSpanNodes(sp, orig);
        if (changed) sp._cdhrOrig = orig;
      });
    } finally {
      _patching = false;
      _hlpResume();
    }
  }

  function restoreAll() {
    _patching = true;
    _hlpPause();
    try {
      _getTargetSpans().forEach(sp => {
        if (sp._cdhrOrig === undefined) return;
        // span 전체를 원본 텍스트로 교체 (mark 포함 제거)
        // 형광펜 스크립트의 MutationObserver 가 재적용함
        _setSpanText(sp, sp._cdhrOrig);
        delete sp._cdhrOrig;
      });
    } finally {
      _patching = false;
      _hlpResume();
    }
  }

  /* ────────────────────────────────────────
     드롭다운 싱글턴 (앵커 위에 고정)
  ──────────────────────────────────────── */
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
    document.querySelectorAll('.cdhr-btn.dd-open').forEach(b => b.classList.remove('dd-open'));
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
  function ddRepos() {
    if (_curDD && _curAnchor) requestAnimationFrame(() => ddPos(_curDD, _curAnchor));
  }

  document.addEventListener('click',   () => { if (_curDD) ddClose(_curDD); });
  document.addEventListener('keydown', e  => { if (e.key === 'Escape' && _curDD) ddClose(_curDD); });

  /* ────────────────────────────────────────
     스타일
  ──────────────────────────────────────── */
  document.head.insertAdjacentHTML('beforeend', `<style>
    :root {
      --cdhr-fs:  clamp(12px,1.5vw,15px);
      --cdhr-fss: clamp(11px,1.3vw,13px);
      --cdhr-gap: clamp(4px,.7vw,8px);
      --cdhr-btn: clamp(32px,4vw,38px);
      --cdhr-acc: #bc1e51;
      --cdhr-bg:  #1e1e1e;
    }

    /* ── 툴바 버튼 ── */
    .cdhr-btn {
      display:inline-flex; align-items:center; justify-content:center;
      position:relative; width:var(--cdhr-btn); height:var(--cdhr-btn);
      border-radius:50%; border:none; background:transparent; color:#aaa;
      font-size:clamp(16px,2vw,20px); cursor:pointer; flex-shrink:0;
      -webkit-tap-highlight-color:transparent; touch-action:manipulation;
      transition:background .12s,color .12s;
    }
    .cdhr-btn:hover  { background:rgba(255,255,255,.08); color:#eee; }
    .cdhr-btn:active { opacity:.7; }
    .cdhr-btn.on     { color:var(--cdhr-acc); }
    .cdhr-btn.on:hover { color:#e0305a; }
    .cdhr-btn.dd-open::after {
      content:''; position:absolute; bottom:3px; right:3px;
      width:5px; height:5px; border-radius:50%; background:#fdc700; pointer-events:none;
    }

    /* ── 드롭다운 ── */
    .cdhr-dd {
      position:fixed; z-index:999999;
      flex-direction:column; gap:clamp(7px,1vw,11px);
      background:var(--cdhr-bg); border:1px solid rgba(255,255,255,.12);
      border-radius:12px; box-shadow:0 -4px 24px rgba(0,0,0,.65),0 2px 8px rgba(0,0,0,.4);
      padding:clamp(12px,1.4vw,16px); width:clamp(260px,32vw,320px);
      display:none; overflow:hidden;
    }
    @media (max-width:600px) { .cdhr-dd { width:min(340px,calc(100vw - 16px)); } }

    /* ── 드롭다운 상단 ── */
    .cdhr-top {
      display:flex; align-items:center; justify-content:space-between;
      padding-bottom:clamp(6px,.8vw,10px);
      border-bottom:1px solid rgba(255,255,255,.07);
    }
    .cdhr-top-label { font-size:var(--cdhr-fs); font-weight:700; color:#ccc; }

    /* 토글 스위치 */
    .cdhr-sw { position:relative; width:38px; height:21px; cursor:pointer; flex-shrink:0; }
    .cdhr-sw input { display:none; }
    .cdhr-sw-track {
      position:absolute; inset:0;
      background:rgba(255,255,255,.12); border-radius:11px; transition:background .2s;
    }
    .cdhr-sw input:checked ~ .cdhr-sw-track { background:var(--cdhr-acc); }
    .cdhr-sw-thumb {
      position:absolute; top:3px; left:3px;
      width:15px; height:15px; border-radius:50%; background:#fff;
      box-shadow:0 1px 4px rgba(0,0,0,.35); transition:left .2s;
    }
    .cdhr-sw input:checked ~ .cdhr-sw-track .cdhr-sw-thumb { left:20px; }

    /* ── 규칙 추가 폼 ── */
    .cdhr-form {
      display:flex; align-items:center; gap:clamp(4px,.6vw,7px);
    }
    .cdhr-form input {
      flex:1; min-width:0; box-sizing:border-box;
      background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.1);
      border-radius:7px; color:#eee; font-size:var(--cdhr-fss); font-family:monospace;
      padding:clamp(5px,.7vw,8px) clamp(6px,.9vw,9px);
      outline:none; -webkit-appearance:none; transition:border-color .12s;
    }
    .cdhr-form input:focus { border-color:var(--cdhr-acc); }
    .cdhr-form input::placeholder { font-family:inherit; opacity:.35; font-size:clamp(9px,1vw,11px); }
    .cdhr-arr { color:#444; font-size:var(--cdhr-fss); flex-shrink:0; }
    .cdhr-form-add {
      height:clamp(28px,3.2vw,34px); padding:0 clamp(8px,1vw,12px);
      border-radius:7px; border:none;
      background:rgba(255,255,255,.09); color:#bbb;
      font-size:var(--cdhr-fss); font-weight:700; font-family:inherit;
      cursor:pointer; flex-shrink:0; white-space:nowrap;
      -webkit-tap-highlight-color:transparent; transition:background .1s;
    }
    .cdhr-form-add:hover { background:rgba(255,255,255,.17); color:#eee; }

    /* ── 규칙 목록 영역 ── */
    .cdhr-list-wrap {
      display:flex; flex-direction:column; gap:6px;
      /* 규칙 많아도 드롭다운 밖으로 안 튀어나오게 */
      max-height:240px; overflow-y:auto; overflow-x:hidden;
    }
    .cdhr-list-wrap::-webkit-scrollbar { width:3px; }
    .cdhr-list-wrap::-webkit-scrollbar-thumb { background:#3a3a3a; border-radius:2px; }

    .cdhr-info {
      display:flex; align-items:center; justify-content:space-between;
      padding-bottom:clamp(3px,.5vw,5px);
      border-bottom:1px solid rgba(255,255,255,.05);
      flex-shrink:0;
    }
    .cdhr-info-count { font-size:var(--cdhr-fss); color:#555; }
    .cdhr-info-count b { color:#888; }
    .cdhr-all-tog {
      background:none; border:none; font-size:var(--cdhr-fss);
      color:#5a9ccf; cursor:pointer; font-family:inherit; padding:0;
      -webkit-tap-highlight-color:transparent;
    }
    .cdhr-all-tog:hover { color:#8ec5ff; text-decoration:underline; }

    .cdhr-rules { display:flex; flex-direction:column; gap:4px; }

    /* ── 규칙 카드 ── */
    .cdhr-rule {
      display:flex; align-items:center; gap:6px;
      padding:7px 9px; border-radius:8px;
      background:rgba(255,255,255,.04); border:1.5px solid rgba(255,255,255,.06);
      cursor:pointer; transition:border-color .15s,background .15s;
      -webkit-tap-highlight-color:transparent;
    }
    .cdhr-rule:hover { background:rgba(255,255,255,.07); }
    .cdhr-rule.active { border-color:var(--cdhr-acc); background:rgba(188,30,81,.08); }
    .cdhr-rule.active .cdhr-rule-from { color:#fff; }
    .cdhr-rule-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
    .cdhr-rule-from {
      font-size:var(--cdhr-fss); font-family:monospace; color:#ccc;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .cdhr-rule-to {
      font-size:calc(var(--cdhr-fss) - 1px); font-family:monospace; color:#fdc700;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .cdhr-rule-to::before { content:'→ '; color:#3a3a3a; }
    .cdhr-rule-to.empty { color:#484848; }
    .cdhr-rule-to.empty::before { color:#2e2e2e; }
    .cdhr-rule-x {
      background:none; border:none; color:#484848;
      font-size:13px; cursor:pointer; padding:3px 5px; border-radius:5px;
      flex-shrink:0; line-height:1;
      -webkit-tap-highlight-color:transparent; transition:color .1s;
    }
    .cdhr-rule-x:hover { color:var(--cdhr-acc); }

    .cdhr-empty { font-size:var(--cdhr-fss); color:#484848; text-align:center; padding:10px 0; }
  </style>`);

  /* ────────────────────────────────────────
     정규식 드롭다운
  ──────────────────────────────────────── */
  const regDD = document.createElement('div');
  regDD.className = 'cdhr-dd';
  regDD.innerHTML = `
    <div class="cdhr-top">
      <span class="cdhr-top-label">정규식 치환</span>
      <label class="cdhr-sw">
        <input type="checkbox" class="cdhr-tog"${regOn ? ' checked' : ''}>
        <div class="cdhr-sw-track"><div class="cdhr-sw-thumb"></div></div>
      </label>
    </div>
    <div class="cdhr-form">
      <input class="cdhr-from" placeholder="찾을 패턴">
      <span class="cdhr-arr">→</span>
      <input class="cdhr-to" placeholder="바꿀 텍스트">
      <button class="cdhr-form-add">추가</button>
    </div>
    <div class="cdhr-list-wrap">
      <div class="cdhr-empty">규칙이 없어요.</div>
    </div>
  `;
  regDD.addEventListener('click', e => e.stopPropagation());
  document.body.appendChild(regDD);

  /* ON/OFF 토글 (드롭다운 내부) */
  regDD.querySelector('.cdhr-tog').addEventListener('change', e => {
    regOn = e.target.checked; saveR();
    syncBtn();
    if (regOn) { restoreAll(); patchAll(); } else restoreAll();
  });

  /* 규칙 추가 */
  function submitRule() {
    const from = regDD.querySelector('.cdhr-from').value.trim();
    const to   = regDD.querySelector('.cdhr-to').value;
    if (!from) { regDD.querySelector('.cdhr-from').focus(); return; }
    try { new RegExp(from); } catch { alert('잘못된 정규식입니다.'); return; }
    rules.push({ id: uid(), from, to, on: true });
    saveR();
    regDD.querySelector('.cdhr-from').value = '';
    regDD.querySelector('.cdhr-to').value   = '';
    renderRules();
    ddRepos();
    if (regOn) { restoreAll(); patchAll(); }
  }
  regDD.querySelector('.cdhr-form-add').addEventListener('click', e => { e.stopPropagation(); submitRule(); });
  regDD.querySelector('.cdhr-form').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitRule(); }
  });

  /* ── 규칙 목록 렌더 ── */
  function renderRules() {
    const wrap = regDD.querySelector('.cdhr-list-wrap');
    if (!wrap) return;

    if (rules.length === 0) {
      wrap.innerHTML = `<div class="cdhr-empty">규칙이 없어요.</div>`;
      return;
    }

    const onCnt = rules.filter(r => r.on).length;
    wrap.innerHTML = `
      <div class="cdhr-info">
        <span class="cdhr-info-count">활성 <b>${onCnt}/${rules.length}</b></span>
        <button class="cdhr-all-tog">전체 토글</button>
      </div>
      <div class="cdhr-rules">
        ${rules.map(r => `
          <div class="cdhr-rule${r.on ? ' active' : ''}" data-id="${r.id}">
            <div class="cdhr-rule-body">
              <div class="cdhr-rule-from">${esc(r.from)}</div>
              <div class="cdhr-rule-to${r.to ? '' : ' empty'}">${esc(r.to || '(빈 문자열)')}</div>
            </div>
            <button class="cdhr-rule-x" data-id="${r.id}">✕</button>
          </div>
        `).join('')}
      </div>
    `;

    wrap.querySelector('.cdhr-all-tog')?.addEventListener('click', e => {
      e.stopPropagation();
      const anyOn = rules.some(r => r.on);
      rules.forEach(r => r.on = !anyOn);
      saveR(); renderRules(); ddRepos();
      if (regOn) { restoreAll(); patchAll(); }
    });

    wrap.querySelectorAll('.cdhr-rule').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.cdhr-rule-x')) return;
        e.stopPropagation();
        const r = rules.find(r => r.id === card.dataset.id);
        if (r) { r.on = !r.on; saveR(); }
        renderRules(); ddRepos();
        if (regOn) { restoreAll(); patchAll(); }
      });
    });

    wrap.querySelectorAll('.cdhr-rule-x').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        rules = rules.filter(r => r.id !== btn.dataset.id);
        saveR(); renderRules(); ddRepos();
        if (regOn) { restoreAll(); patchAll(); }
      });
    });
  }

  /* ── 버튼 상태 동기화 ── */
  let _rBtn = null;

  function syncBtn() {
    if (!_rBtn) return;
    _rBtn.className = 'cdhr-btn'
      + (regOn           ? ' on'      : '')
      + (_curDD === regDD ? ' dd-open' : '');
    const tog = regDD.querySelector('.cdhr-tog');
    if (tog) tog.checked = regOn;
  }

  /* ── 정규식 버튼 SVG ── */
  const ICON_R = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 12 5-5 5 5-5 5Z"/><path d="M12 21.21V2.79"/><path d="m12 12 5-5 5 5-5 5Z"/></svg>`;

  /* ────────────────────────────────────────
     UI 주입
     — 이미 주입돼 있으면 절대 재삽입 금지
     — 형광펜 호환: cdhq/cdhlp 노드는 observer 에서 무시
  ──────────────────────────────────────── */
  function injectUI() {
    if (document.getElementById('cdhr-wrap')) return;

    const bar  = document.querySelector(SEL_BTNBAR);
    const form = document.querySelector(SEL_FORM);
    if (!bar || !form) return;
    if (bar.querySelector('.cdhr-btn')) return;

    if (!document.body.contains(regDD)) document.body.appendChild(regDD);

    const rBtn = document.createElement('button');
    rBtn.type      = 'button';
    rBtn.className = 'cdhr-btn' + (regOn ? ' on' : '');
    rBtn.title     = '정규식 치환 (우클릭/롱프레스: 관리)';
    rBtn.innerHTML = ICON_R;
    _rBtn = rBtn;

    bar.insertBefore(rBtn, bar.querySelector('[data-tour="chat-model-selector"]')?.parentElement || null);

    /* 좌클릭 → ON/OFF 즉시 토글 */
    rBtn.addEventListener('click', e => {
      e.stopPropagation();
      regOn = !regOn; saveR(); syncBtn();
      if (regOn) { restoreAll(); patchAll(); } else restoreAll();
    });

    /* 우클릭 → 관리 드롭다운 */
    rBtn.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      if (_curDD === regDD) { ddClose(regDD); syncBtn(); }
      else { renderRules(); ddOpen(regDD, rBtn); syncBtn(); }
    });

    /* 롱프레스(모바일) → 관리 드롭다운 */
    let _lt = null, _ts = null;
    rBtn.addEventListener('touchstart', e => {
      _ts = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      _lt = setTimeout(() => {
        _lt = null;
        if (_curDD === regDD) { ddClose(regDD); syncBtn(); }
        else { renderRules(); ddOpen(regDD, rBtn); syncBtn(); }
      }, 400);
    }, { passive: true });
    rBtn.addEventListener('touchmove', e => {
      if (!_ts) return;
      if (Math.abs(e.touches[0].clientX - _ts.x) > 10 ||
          Math.abs(e.touches[0].clientY - _ts.y) > 10) {
        clearTimeout(_lt); _lt = null;
      }
    }, { passive: true });
    rBtn.addEventListener('touchend', () => {
      clearTimeout(_lt); _lt = null; _ts = null;
    }, { passive: true });

    /* 더미 wrap — MutationObserver 재주입 방지용 앵커 */
    const wrap = document.createElement('div');
    wrap.id = 'cdhr-wrap';
    wrap.style.cssText = 'display:none;';
    form.appendChild(wrap);

    renderRules();
  }

  /* ────────────────────────────────────────
     MutationObserver
     형광펜(cdhlp-*) 및 자체(cdhr-*) 노드 변경은 무시해서 핑퐁 방지
     _patching 중엔 patchAll 재진입 차단
  ──────────────────────────────────────── */
  function _isSafe(n) {
    // 텍스트노드 변경은 patchAll/_restoreNode 가 직접 처리 — observer 재진입 차단
    if (n.nodeType === Node.TEXT_NODE) return true;
    if (n.nodeType !== Node.ELEMENT_NODE) return true;
    const id  = n.id  || '';
    const cls = n.classList ? [...n.classList] : [];
    // 자체 UI 노드
    if (id.startsWith('cdhr')  || cls.some(c => c.startsWith('cdhr')))  return true;
    // 퀵입력 노드
    if (id.startsWith('cdhq')  || cls.some(c => c.startsWith('cdhq')))  return true;
    // 형광펜 노드 — mark 삽입/삭제는 형광펜이 관리
    if (id.startsWith('cdhlp') || cls.some(c => c.startsWith('cdhlp'))) return true;
    if (n.tagName === 'MARK'   && cls.includes('custom-cdhlp'))          return true;
    return false;
  }

  let _debounce = null;

  new MutationObserver(mutations => {
    if (_patching) return;

    const allSafe = mutations.every(m =>
      [...m.addedNodes, ...m.removedNodes].every(_isSafe)
    );

    // wrap 없으면 재주입 (채팅방 이동 등)
    if (!document.getElementById('cdhr-wrap')) {
      if (!allSafe) injectUI();
      // 재주입 후 정규식 재적용
      if (regOn) {
        clearTimeout(_debounce);
        _debounce = setTimeout(() => { restoreAll(); patchAll(); }, 400);
      }
      return;
    }

    // 정규식 ON 상태에서 스트리밍 텍스트 변경 감지 → 디바운스 후 재치환
    if (!regOn || allSafe) return;
    clearTimeout(_debounce);
    _debounce = setTimeout(() => { restoreAll(); patchAll(); }, 300);

  }).observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUI);
  else injectUI();

  // SPA 라우팅 감지
  let _lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== _lastPath) {
      _lastPath = location.pathname;
      setTimeout(() => {
        if (!document.getElementById('cdhr-wrap')) injectUI();
        if (regOn) { restoreAll(); patchAll(); }
      }, 600);
    }
  }, 300);

})();

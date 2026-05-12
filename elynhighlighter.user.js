// ==UserScript==
// @name         엘린 형광펜
// @namespace    https://elyn.ai/
// @version      2.4.0
// @description  엘린에서 텍스트에 형광펜 표시 + 메모 기능
// @author       adapted from 레몬파이
// @match        https://elyn.ai/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`#hl-tooltip{display:none!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;}`);

    // ==========================================
    // 포인트 컬러
    // ==========================================
    const P1 = 'hsl(var(--primary))';
    const P2 = 'hsl(var(--primary))';

    const DEFAULT_COLORS = [
        { bg: '#a78bfa', text: '' },   // 엘린 바이올렛
        { bg: '#818cf8', text: '' },   // 인디고
        { bg: '#f472b6', text: '' },   // 핑크
        { bg: '#34d399', text: '' },   // 그린
    ];
    const MAX_COLORS = 8;

    const getStorageKey = () => `ELP_${window.location.pathname}`;
    const PALETTE_KEY   = 'ELP_Palette';
    const POPUP_POS_KEY = 'ELP_PopupPos';
    const OPACITY_KEY   = 'ELP_Opacity';
    const BOLD_KEY      = 'ELP_Bold';

    let currentPath = window.location.pathname;
    let highlights  = [];
    let savedSelectionRange = null;
    let savedSelectionText  = '';
    let currentEditingId    = null;

    let paletteColors = JSON.parse(localStorage.getItem(PALETTE_KEY));
    if (!paletteColors) paletteColors = DEFAULT_COLORS;
    else paletteColors = paletteColors.map(c => typeof c === 'string' ? { bg: c, text: '' } : c);

    let highlightOpacity = parseFloat(localStorage.getItem(OPACITY_KEY) ?? '0.45');
    let highlightBold    = (localStorage.getItem(BOLD_KEY) ?? 'true') === 'true';
    document.documentElement.style.setProperty('--elp-fw', highlightBold ? 'bold' : 'normal');

    // ── xpath 유틸 ──────────────────────────────
    function getXPath(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const idx = Array.from(node.parentNode.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).indexOf(node);
            return getXPath(node.parentNode) + `/text()[${idx + 1}]`;
        }
        if (node === document.body) return '/html/body';
        const tag = node.tagName.toLowerCase();
        const siblings = Array.from(node.parentNode.children).filter(n => n.tagName === node.tagName);
        const idx = siblings.indexOf(node) + 1;
        return getXPath(node.parentNode) + `/${tag}[${idx}]`;
    }
    function resolveXPath(xpath) {
        try { return document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; }
        catch { return null; }
    }

    // ── 저장/로드 ────────────────────────────────
    function loadHighlights() {
        const data = localStorage.getItem(getStorageKey());
        highlights = data ? JSON.parse(data) : [];
        highlights = highlights.map(hl => {
            if (typeof hl.color === 'string') hl.color = { bg: hl.color, text: '' };
            return hl;
        });
    }
    function saveHighlights() {
        localStorage.setItem(getStorageKey(), JSON.stringify(highlights));
        renderPopupList(); applyHighlightsToDOM();
    }
    function savePalette() {
        localStorage.setItem(PALETTE_KEY, JSON.stringify(paletteColors));
        renderSelectionBar(); renderEditBar(); renderPopupPalette();
    }
    function hexToRgba(hex, a) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${a})`;
    }

    // ── 모바일 감지 ──────────────────────────────
    function elpIsMobile() { return window.innerWidth <= 640; }

    // ==========================================
    // CSS — 엘린 UI 스타일 (rounded-2xl, backdrop-blur)
    // ==========================================
    GM_addStyle(`
        /* =========================================
           엘린 형광펜 — 엘린 UI 스타일 (라이트/다크 반응형)
           bg-popover/95, backdrop-blur-md, rounded-2xl
        ========================================= */

        /* ── CSS 변수 (라이트 기본) ── */
        #elp-popup {
            --elp-bg: hsl(var(--popover) / 0.95);
            --elp-border: hsl(var(--border) / 0.6);
            --elp-text: hsl(var(--popover-foreground));
            --elp-muted: hsl(var(--muted-foreground));
            --elp-card: hsl(var(--card) / 0.7);
            --elp-input: hsl(var(--input) / 0.5);
            --elp-sep: hsl(var(--border) / 0.1);
            --elp-hover: hsl(var(--muted) / 0.3);
        }

        /* ── 팝업 ── */
        #elp-popup {
            position: fixed;
            width: 300px; max-height: 580px;
            border-radius: 16px;
            border: 1px solid var(--elp-border);
            box-shadow: 0 20px 60px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.1);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            background: var(--elp-bg);
            color: var(--elp-text);
            z-index: 2147483640 !important;
            display: none; flex-direction: column; overflow: hidden;
            font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif;
            font-size: 13px;
        }

        /* ── 오버레이 (모바일 바텀시트) ── */
        #elp-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.45); z-index: 2147483639 !important;
            backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
        }
        #elp-overlay.show { display: block; }

        @media (max-width: 640px) {
            #elp-popup {
                position: fixed !important;
                left: 0 !important; right: 0 !important;
                bottom: 0 !important; top: auto !important;
                width: 100% !important; max-width: 100% !important;
                max-height: 85vh !important;
                border-radius: 20px 20px 0 0 !important;
                border-bottom: none !important;
            }
            #elp-popup::before {
                content: ''; display: block;
                width: 32px; height: 3px;
                background: var(--elp-muted); opacity: 0.4; border-radius: 2px;
                margin: 10px auto 0; flex-shrink: 0;
            }
            .elp-popup-header { cursor: default !important; }
            #elp-toolbar-btn .elp-btn-label { display: none; }
        }

        /* ── 선택/편집 바 ── */
        #elp-selection-bar, #elp-edit-bar {
            position: absolute; display: none;
            background: hsl(var(--popover) / 0.95);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            padding: 7px 11px; border-radius: 12px;
            border: 1px solid hsl(var(--border) / 0.5);
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            z-index: 2147483641 !important; gap: 7px; align-items: center;
        }

        /* ── 오버레이 UI ── */
        #elp-reset-overlay, #elp-custom-alert {
            position: fixed; inset: 0; background: rgba(0,0,0,0.55);
            z-index: 2147483642 !important; display: none;
            justify-content: center; align-items: center;
            backdrop-filter: blur(8px); font-family: Pretendard, sans-serif;
        }

        /* ── 컨텍스트 메뉴 ── */
        #elp-context-menu {
            position: absolute; display: none;
            background: hsl(var(--popover) / 0.95);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            padding: 12px 14px; border-radius: 14px;
            border: 1px solid hsl(var(--border) / 0.5);
            box-shadow: 0 12px 40px rgba(0,0,0,0.2);
            z-index: 2147483644 !important; flex-direction: column; gap: 10px;
            font-family: Pretendard, sans-serif;
        }

        /* ── 컬러 버튼 ── */
        .elp-color-btn {
            width: 20px; height: 20px; border-radius: 50%;
            border: 1.5px solid hsl(var(--border) / 0.5);
            cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
            flex-shrink: 0; box-sizing: border-box;
        }
        .elp-color-btn:hover { transform: scale(1.25); box-shadow: 0 0 0 2.5px ${P1}99; }

        /* ── 공통 버튼 ── */
        .elp-ctx-text { color: var(--elp-muted); font-size: 12px; font-weight: 600; text-align: center; }
        .elp-ctx-actions { display: flex; gap: 8px; justify-content: center; }
        .elp-ctx-btn {
            padding: 7px 16px; border: none; border-radius: 8px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
            font-family: Pretendard, sans-serif;
        }
        .elp-ctx-cancel { background: hsl(var(--muted) / 0.5); color: var(--elp-text); }
        .elp-ctx-cancel:hover { background: hsl(var(--muted)); }
        .elp-ctx-delete { background: hsl(var(--destructive) / 0.15); color: hsl(var(--destructive)); }
        .elp-ctx-delete:hover { background: hsl(var(--destructive)); color: #fff; }

        /* ── 모달 박스 ── */
        .elp-alert-box {
            background: hsl(var(--popover) / 0.98); backdrop-filter: blur(20px);
            border: 1px solid hsl(var(--border) / 0.5);
            padding: 24px 28px; border-radius: 16px; text-align: center; max-width: 300px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .elp-reset-box {
            background: hsl(var(--popover) / 0.98); backdrop-filter: blur(20px);
            border: 1px solid hsl(var(--destructive) / 0.3);
            padding: 28px; border-radius: 16px; text-align: center; max-width: 320px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }

        /* ── 헤더 ── */
        .elp-popup-header {
            padding: 12px 14px 10px;
            border-bottom: 1px solid var(--elp-sep);
            display: flex; justify-content: space-between; align-items: center;
            cursor: grab; user-select: none;
        }
        .elp-popup-header:active { cursor: grabbing; }
        .elp-header-title { display: flex; align-items: center; gap: 8px; }
        .elp-header-badge {
            display: inline-flex; align-items: center; gap: 5px;
            background: hsl(var(--primary) / 0.1); border-radius: 8px;
            padding: 3px 9px 3px 7px; font-size: 12px; font-weight: 700;
            color: ${P1}; border: 1px solid hsl(var(--primary) / 0.25);
        }
        .elp-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: ${P1}; flex-shrink: 0; }
        .elp-header-count {
            font-size: 10px; font-weight: 700; color: ${P1};
            background: hsl(var(--primary) / 0.1); border-radius: 6px;
            padding: 2px 6px; border: 1px solid hsl(var(--primary) / 0.2);
        }
        .elp-header-actions { display: flex; gap: 3px; align-items: center; }

        /* ── 아이콘 버튼 ── */
        .elp-icon-btn {
            background: none; border: none; font-size: 13px; cursor: pointer;
            color: var(--elp-muted); padding: 0; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            width: 26px; height: 26px; border-radius: 7px; transition: 0.15s;
        }
        .elp-icon-btn:hover { color: hsl(var(--primary)); background: hsl(var(--primary) / 0.1); }
        .elp-bold-active {
            background: hsl(var(--primary) / 0.12) !important;
            color: ${P1} !important;
            border: 1px solid hsl(var(--primary) / 0.25) !important;
        }

        /* ── 슬라이더 ── */
        #elp-opacity-slider {
            width: 48px; height: 3px; border-radius: 2px;
            appearance: none; background: hsl(var(--muted)); outline: none; cursor: pointer;
        }
        #elp-opacity-slider::-webkit-slider-thumb {
            appearance: none; width: 11px; height: 11px; border-radius: 50%;
            background: hsl(var(--primary)); box-shadow: 0 1px 4px rgba(0,0,0,0.2); cursor: pointer; transition: 0.15s;
        }
        #elp-opacity-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }

        /* ── 바디 ── */
        .elp-popup-body { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
        .elp-sec { padding: 10px 14px; border-bottom: 1px solid var(--elp-sep); }
        .elp-sec-label {
            font-size: 9px; font-weight: 700; letter-spacing: 0.9px;
            text-transform: uppercase; color: var(--elp-muted); margin-bottom: 8px; opacity: 0.7;
        }

        /* ── 팔레트 ── */
        .elp-palette-wrap { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
        .elp-color-add {
            width: 20px; height: 20px; border-radius: 50%;
            background: hsl(var(--muted) / 0.5);
            border: 1.5px dashed hsl(var(--border));
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: var(--elp-muted); font-size: 13px; line-height: 1;
            transition: 0.15s; box-sizing: border-box;
        }
        .elp-color-add:hover { border-color: hsl(var(--primary)); color: hsl(var(--primary)); background: hsl(var(--primary) / 0.08); }

        /* ── 색상 피커 ── */
        .elp-picker-ui {
            display: none; flex-direction: column; gap: 9px;
            background: hsl(var(--muted) / 0.3); padding: 10px 12px;
            border-radius: 10px; border: 1px solid var(--elp-sep);
            margin-top: 9px; font-size: 12px;
        }
        .elp-picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .elp-picker-label { display: flex; align-items: center; gap: 7px; cursor: pointer; color: var(--elp-text); }
        .elp-color-input { width: 22px; height: 22px; padding: 0; border: none; cursor: pointer; border-radius: 6px; }
        .elp-picker-preview { width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--elp-sep); flex-shrink: 0; }
        .elp-add-btn {
            flex: 1; background: hsl(var(--primary) / 0.1); color: ${P1};
            border: 1px solid hsl(var(--primary) / 0.25); padding: 6px 12px; border-radius: 8px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s; font-family: Pretendard, sans-serif;
        }
        .elp-add-btn:hover { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); border-color: hsl(var(--primary)); }

        /* ── 검색 ── */
        .elp-search-wrap {
            display: flex; align-items: center; gap: 7px;
            background: hsl(var(--muted) / 0.3);
            border: 1px solid hsl(var(--border) / 0.3);
            border-radius: 10px; padding: 0 10px; transition: border-color 0.15s;
        }
        .elp-search-wrap:focus-within { border-color: hsl(var(--primary) / 0.5); }
        .elp-search-icon { color: var(--elp-muted); font-size: 13px; flex-shrink: 0; }
        .elp-search-input {
            flex: 1; padding: 8px 0; border: none; background: transparent;
            color: var(--elp-text); font-size: 12.5px; outline: none; font-family: Pretendard, sans-serif;
        }
        .elp-search-input::placeholder { color: var(--elp-muted); opacity: 0.6; }

        /* ── 리스트 ── */
        .elp-list-sec { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }
        .elp-list-sec::-webkit-scrollbar { width: 3px; }
        .elp-list-sec::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 2px; }
        .elp-empty { text-align: center; color: var(--elp-muted); margin-top: 28px; font-size: 12px; line-height: 1.8; opacity: 0.7; }

        /* ── 아이템 ── */
        .elp-item {
            display: flex; flex-direction: column; gap: 6px;
            padding: 8px 10px; border-radius: 10px; margin-bottom: 3px;
            cursor: pointer; transition: background 0.15s;
        }
        .elp-item:hover { background: hsl(var(--muted) / 0.35); }
        .elp-item-top { display: flex; align-items: flex-start; gap: 8px; }
        .elp-item-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 3.5px; flex-shrink: 0; }
        .elp-item-body { flex: 1; min-width: 0; }
        .elp-item-text {
            font-size: 12.5px; font-weight: 500; line-height: 1.4;
            color: var(--elp-text); word-break: break-all;
            display: -webkit-box; -webkit-line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden;
        }
        .elp-item-del {
            background: none; border: none; cursor: pointer; color: var(--elp-muted);
            font-size: 11px; padding: 0; width: 18px; height: 18px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 5px; flex-shrink: 0; transition: 0.15s; margin-top: 1px; opacity: 0.5;
        }
        .elp-item-del:hover { color: hsl(var(--destructive)); background: hsl(var(--destructive) / 0.1); opacity: 1; }
        .elp-note-input {
            width: 100%; padding: 5px 8px;
            border: 1px dashed hsl(var(--border) / 0.5);
            border-radius: 7px; background: transparent;
            color: var(--elp-muted); font-size: 11px; outline: none;
            box-sizing: border-box; transition: 0.15s; font-family: Pretendard, sans-serif;
        }
        .elp-note-input:focus {
            border-style: solid; border-color: hsl(var(--primary) / 0.4);
            color: var(--elp-text); background: hsl(var(--primary) / 0.04);
        }
        .elp-note-input:not(:placeholder-shown) { border-style: solid; color: var(--elp-text); opacity: 0.8; }

        /* ── 구분선 ── */
        .elp-divider { display: flex; align-items: center; gap: 8px; padding: 6px 10px 4px; }
        .elp-divider-label {
            font-size: 9px; font-weight: 700; letter-spacing: 0.7px;
            text-transform: uppercase; color: var(--elp-muted); white-space: nowrap; opacity: 0.6;
        }
        .elp-divider-line { flex: 1; height: 1px; background: var(--elp-sep); }

        /* ── 형광펜 mark ── */
        mark.elp-hl {
            font-weight: var(--elp-fw, bold);
            padding: 1px 0; cursor: pointer;
            -webkit-box-decoration-break: clone; box-decoration-break: clone;
            transition: opacity 0.2s;
        }
        mark.elp-hl.elp-start { border-top-left-radius: 3px; border-bottom-left-radius: 3px; padding-left: 2px; }
        mark.elp-hl.elp-end   { border-top-right-radius: 3px; border-bottom-right-radius: 3px; padding-right: 2px; }
        mark.elp-hl:hover     { opacity: 0.72; }
        mark.elp-hl.flash     { animation: elpFlash 1.4s ease; }
        @keyframes elpFlash { 0%,100%{box-shadow:none;} 30%,70%{box-shadow:0 0 0 2px ${P1};} }

        /* ── 토스트 ── */
        #elp-toast {
            position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
            background: hsl(var(--popover) / 0.95); backdrop-filter: blur(12px);
            color: var(--elp-text); padding: 9px 18px; border-radius: 10px;
            z-index: 2147483647; font-size: 12px; font-weight: 600;
            border: 1px solid hsl(var(--border) / 0.5);
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            font-family: Pretendard, sans-serif;
        }

        /* ── 툴바 버튼 ── */
        #elp-toolbar-btn {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 0 10px; height: 28px; border-radius: 9999px;
            background: hsl(var(--card) / 0.7);
            border: none; cursor: pointer;
            font-size: 12px; font-weight: 500;
            color: hsl(var(--muted-foreground));
            transition: background 0.15s, color 0.15s;
            font-family: Pretendard, 'Apple SD Gothic Neo', sans-serif;
            white-space: nowrap; flex-shrink: 0;
        }
        #elp-toolbar-btn:hover {
            background: hsl(var(--card-hover) / 0.7);
            color: hsl(var(--foreground));
        }
    `);

    // ==========================================
    // UI 생성
    // ==========================================

    // 오버레이
    const elpOverlay = document.createElement('div');
    elpOverlay.id = 'elp-overlay';
    elpOverlay.addEventListener('click', () => { popup.style.display='none'; elpOverlay.classList.remove('show'); });
    document.body.appendChild(elpOverlay);

    const selectionBar = document.createElement('div');
    selectionBar.id = 'elp-selection-bar';
    document.body.appendChild(selectionBar);

    const editBar = document.createElement('div');
    editBar.id = 'elp-edit-bar';
    document.body.appendChild(editBar);

    function preventDefaultTouch(e) { e.preventDefault(); }

    function renderSelectionBar() {
        selectionBar.innerHTML = '';
        selectionBar.addEventListener('mousedown', preventDefaultTouch);
        selectionBar.addEventListener('touchstart', preventDefaultTouch, { passive: false });
        paletteColors.forEach(colorObj => {
            const btn = document.createElement('div');
            btn.className = 'elp-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.addEventListener('click', e => { e.stopPropagation(); addHighlight(colorObj); });
            btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); addHighlight(colorObj); });
            selectionBar.appendChild(btn);
        });
    }

    function renderEditBar() {
        editBar.innerHTML = '';
        editBar.addEventListener('mousedown', preventDefaultTouch);
        editBar.addEventListener('touchstart', preventDefaultTouch, { passive: false });
        paletteColors.forEach(colorObj => {
            const btn = document.createElement('div');
            btn.className = 'elp-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.title = '이 색상으로 변경';
            btn.addEventListener('click', e => { e.stopPropagation(); changeHighlightColor(colorObj); });
            btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); changeHighlightColor(colorObj); });
            editBar.appendChild(btn);
        });
    }

    // 알림
    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'elp-custom-alert';
    alertOverlay.innerHTML = `<div class="elp-alert-box"><p id="elp-alert-msg" style="margin:0 0 18px;color:rgba(255,255,255,0.75);font-size:13px;line-height:1.6;word-break:keep-all;font-family:Pretendard,sans-serif;"></p><button id="elp-alert-ok" class="elp-ctx-btn elp-ctx-cancel" style="padding:7px 22px;">확인</button></div>`;
    document.body.appendChild(alertOverlay);
    function customAlert(msg) { document.getElementById('elp-alert-msg').innerHTML = msg; alertOverlay.style.display = 'flex'; }
    document.getElementById('elp-alert-ok').onclick = () => alertOverlay.style.display = 'none';

    // 컨텍스트 메뉴
    const ctxMenu = document.createElement('div');
    ctxMenu.id = 'elp-context-menu';
    ctxMenu.innerHTML = `<div class="elp-ctx-text" id="elp-ctx-text">삭제할까요?</div><div class="elp-ctx-actions"><button class="elp-ctx-btn elp-ctx-cancel" id="elp-ctx-cancel">취소</button><button class="elp-ctx-btn elp-ctx-delete" id="elp-ctx-delete">삭제</button></div>`;
    document.body.appendChild(ctxMenu);

    let ctxCallback = null;
    function openContextMenu(e, text, callback) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        document.getElementById('elp-ctx-text').innerText = text;
        ctxCallback = callback; ctxMenu.style.display = 'flex';
        const px = e.pageX || e.changedTouches?.[0]?.pageX || 0;
        const py = e.pageY || e.changedTouches?.[0]?.pageY || 0;
        ctxMenu.style.left = `${px+5}px`; ctxMenu.style.top = `${py+5}px`;
    }
    document.getElementById('elp-ctx-cancel').onclick = () => { ctxMenu.style.display='none'; ctxCallback=null; };
    document.getElementById('elp-ctx-delete').onclick = () => { ctxCallback?.(); ctxMenu.style.display='none'; ctxCallback=null; };
    document.addEventListener('click',      e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });
    document.addEventListener('touchstart', e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });

    // 초기화 모달
    const resetOverlay = document.createElement('div');
    resetOverlay.id = 'elp-reset-overlay';
    resetOverlay.innerHTML = `<div class="elp-reset-box"><div style="font-size:28px;margin-bottom:10px;">⚠️</div><p style="margin:0 0 6px;color:rgba(255,255,255,0.9);font-size:15px;font-weight:700;">모든 데이터를 초기화할까요?</p><p style="margin:0 0 20px;color:rgba(255,255,255,0.45);font-size:12px;line-height:1.6;">형광펜 노트와 커스텀 색상이<br>영구적으로 삭제됩니다.</p><div style="display:flex;justify-content:center;gap:10px;"><button id="elp-reset-cancel" class="elp-ctx-btn elp-ctx-cancel">취소</button><button id="elp-reset-confirm" class="elp-ctx-btn elp-ctx-delete">초기화</button></div></div>`;
    document.body.appendChild(resetOverlay);
    document.getElementById('elp-reset-cancel').onclick  = () => resetOverlay.style.display='none';
    document.getElementById('elp-reset-confirm').onclick = () => {
        Object.keys(localStorage).forEach(k => { if(k.startsWith('ELP_')) localStorage.removeItem(k); });
        highlights=[]; paletteColors=[...DEFAULT_COLORS];
        document.querySelectorAll('mark.elp-hl').forEach(m => m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
        renderPopupPalette(); renderSelectionBar(); renderEditBar(); renderPopupList();
        resetOverlay.style.display='none';
    };

    // 메인 팝업
    const popup = document.createElement('div');
    popup.id = 'elp-popup';
    popup.innerHTML = `
        <div class="elp-popup-header">
            <div class="elp-header-title">
                <div class="elp-header-badge"><span class="elp-badge-dot"></span>형광펜</div>
                <span class="elp-header-count" id="elp-header-count">0</span>
            </div>
            <div class="elp-header-actions">
                <input type="range" id="elp-opacity-slider" min="0" max="1" step="0.05" value="0.45" title="투명도">
                <button class="elp-icon-btn ${highlightBold?'elp-bold-active':''}" id="elp-bold-btn" title="볼드체" style="font-weight:800;font-family:serif;font-size:12px;">B</button>
                <button class="elp-icon-btn" id="elp-reset-btn" title="초기화" style="font-size:14px;">↺</button>
                <button class="elp-icon-btn" id="elp-close-btn" title="닫기" style="font-size:12px;">✕</button>
            </div>
        </div>
        <div class="elp-popup-body">
            <div class="elp-sec">
                <div class="elp-sec-label">Colors</div>
                <div class="elp-palette-wrap" id="elp-palette-container"></div>
                <div class="elp-picker-ui" id="elp-color-picker-ui">
                    <div class="elp-picker-row">
                        <label class="elp-picker-label">BG <input type="color" class="elp-color-input" id="elp-new-bg" value="#FFB300"></label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:inherit;flex:1;"><input type="checkbox" id="elp-keep-text" checked style="accent-color:${P1};"> 원본 글자색</label>
                        <div id="elp-new-preview" class="elp-picker-preview" style="background:#FFB300;"></div>
                    </div>
                    <div id="elp-text-color-label" style="display:none;"><label class="elp-picker-label">Text <input type="color" class="elp-color-input" id="elp-new-text" value="#333333"></label></div>
                    <div style="display:flex;gap:8px;align-items:center;"><button id="elp-confirm-add-color" class="elp-add-btn">추가</button></div>
                </div>
            </div>
            <div class="elp-sec" style="padding-top:8px;padding-bottom:8px;">
                <div class="elp-search-wrap">
                    <span class="elp-search-icon">⌕</span>
                    <input type="text" id="elp-search" class="elp-search-input" placeholder="내용 또는 메모 검색">
                </div>
            </div>
            <div class="elp-list-sec" id="elp-list"></div>
        </div>`;
    document.body.appendChild(popup);

    // 볼드 토글
    popup.querySelector('#elp-bold-btn').onclick = () => {
        highlightBold = !highlightBold;
        localStorage.setItem(BOLD_KEY, highlightBold);
        document.documentElement.style.setProperty('--elp-fw', highlightBold ? 'bold' : 'normal');
        popup.querySelector('#elp-bold-btn').classList.toggle('elp-bold-active', highlightBold);
    };

    // 색상 추가
    const bgInput = document.getElementById('elp-new-bg');
    const txInput = document.getElementById('elp-new-text');
    const keepCb  = document.getElementById('elp-keep-text');
    const txLabel = document.getElementById('elp-text-color-label');
    const preview = document.getElementById('elp-new-preview');
    const updatePreview = () => {
        const bg = bgInput.value, tx = keepCb.checked ? '' : txInput.value;
        preview.style.background = tx ? `linear-gradient(135deg,${bg} 50%,${tx} 50%)` : bg;
    };
    keepCb.onchange = () => { txLabel.style.display = keepCb.checked ? 'none' : 'block'; updatePreview(); };
    bgInput.addEventListener('input', updatePreview); txInput.addEventListener('input', updatePreview);
    document.getElementById('elp-confirm-add-color').onclick = () => {
        if (paletteColors.length >= MAX_COLORS) { customAlert('최대 8개까지 추가할 수 있어요.'); return; }
        paletteColors.push({ bg: bgInput.value, text: keepCb.checked ? '' : txInput.value });
        savePalette(); document.getElementById('elp-color-picker-ui').style.display = 'none';
    };

    popup.querySelector('#elp-close-btn').onclick = elpClosePopup;
    popup.querySelector('#elp-reset-btn').onclick = () => resetOverlay.style.display = 'flex';
    popup.querySelector('#elp-search').addEventListener('input', e => renderPopupList(e.target.value.trim().toLowerCase()));

    // 투명도
    const opSlider = popup.querySelector('#elp-opacity-slider');
    opSlider.value = highlightOpacity;
    opSlider.addEventListener('input', e => {
        highlightOpacity = parseFloat(e.target.value);
        localStorage.setItem(OPACITY_KEY, highlightOpacity);
        document.querySelectorAll('mark.elp-hl').forEach(mark => {
            const h = highlights.find(x => x.id === mark.dataset.elpId);
            if (h) { mark.style.backgroundColor = hexToRgba(h.color.bg, highlightOpacity); mark.style.color = h.color.text || 'inherit'; }
        });
    });

    // 드래그
    const popupHeader = popup.querySelector('.elp-popup-header');
    let isDragging=false, dragSX, dragSY, initL, initT;

    const dStart = e => {
        if (e.target.closest('.elp-header-actions')) return;
        if (elpIsMobile()) return;
        isDragging=true;
        dragSX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        dragSY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        const r=popup.getBoundingClientRect(); initL=r.left; initT=r.top;
    };
    const dMove = e => {
        if (!isDragging) return;
        const cx = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        const cy = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
        popup.style.left=`${Math.max(0,Math.min(initL+(cx-dragSX),window.innerWidth-popup.offsetWidth))}px`;
        popup.style.top =`${Math.max(0,Math.min(initT+(cy-dragSY),window.innerHeight-popup.offsetHeight))}px`;
    };
    const dEnd = () => { if(isDragging){isDragging=false;localStorage.setItem(POPUP_POS_KEY,JSON.stringify({left:popup.style.left,top:popup.style.top}));} };
    popupHeader.addEventListener('mousedown', dStart);
    popupHeader.addEventListener('touchstart', dStart, {passive:true});
    document.addEventListener('mousemove', dMove);
    document.addEventListener('touchmove', dMove, {passive:true});
    document.addEventListener('mouseup',  dEnd);
    document.addEventListener('touchend', dEnd);

    // ── 팝업 열기/닫기 ──────────────────────────────
    function elpOpenPopup() {
        if (elpIsMobile()) {
            elpOverlay.classList.add('show');
            popup.style.left = ''; popup.style.top = '';
        } else {
            elpOverlay.classList.remove('show');
            const sp = JSON.parse(localStorage.getItem(POPUP_POS_KEY));
            if (sp) { popup.style.left=sp.left; popup.style.top=sp.top; }
            else { popup.style.left='20px'; popup.style.top='100px'; }
        }
        popup.style.display = 'flex';
        renderPopupList();
    }
    function elpClosePopup() {
        popup.style.display = 'none';
        elpOverlay.classList.remove('show');
    }
    function togglePopup() {
        popup.style.display === 'flex' ? elpClosePopup() : elpOpenPopup();
    }

    // resize 대응
    window.addEventListener('resize', () => {
        if (popup.style.display === 'flex') {
            if (elpIsMobile()) { popup.style.left=''; popup.style.top=''; elpOverlay.classList.add('show'); }
            else { elpOverlay.classList.remove('show'); const sp=JSON.parse(localStorage.getItem(POPUP_POS_KEY)); if(sp){popup.style.left=sp.left;popup.style.top=sp.top;} }
        }
    });

    function renderPopupPalette() {
        const c = document.getElementById('elp-palette-container');
        c.innerHTML = '';
        paletteColors.forEach((colorObj, idx) => {
            const btn = document.createElement('div');
            btn.className = 'elp-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.title = '우클릭으로 삭제';
            let pt;
            btn.addEventListener('touchstart', e => { pt=setTimeout(()=>{ if(paletteColors.length<=1){customAlert('최소 1개는 필요해요.');return;} openContextMenu(e,'이 색상을 삭제할까요?',()=>{paletteColors.splice(idx,1);savePalette();}); },800); });
            btn.addEventListener('touchend',  ()=>clearTimeout(pt));
            btn.addEventListener('touchmove', ()=>clearTimeout(pt));
            btn.addEventListener('contextmenu', e => {
                e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
                if(paletteColors.length<=1){customAlert('최소 1개는 필요해요.');return;}
                openContextMenu(e,'이 색상을 삭제할까요?',()=>{paletteColors.splice(idx,1);savePalette();});
            });
            c.appendChild(btn);
        });
        if (paletteColors.length < MAX_COLORS) {
            const add = document.createElement('div');
            add.className='elp-color-add'; add.innerHTML='+';
            add.onclick = () => { const ui=document.getElementById('elp-color-picker-ui'); ui.style.display=ui.style.display==='flex'?'none':'flex'; };
            c.appendChild(add);
        } else {
            document.getElementById('elp-color-picker-ui').style.display='none';
        }
    }

    // ==========================================
    // 툴바 버튼 삽입
    // 엘린 입력창: 행동/대사/기억 버튼 오른쪽
    // ==========================================
    let elpLastIsMobile = null;
    function injectToolbarButton() {
        const mobile = elpIsMobile();
        if (elpLastIsMobile !== null && elpLastIsMobile !== mobile) {
            document.getElementById('elp-toolbar-btn')?.remove();
        }
        elpLastIsMobile = mobile;
        if (document.getElementById('elp-toolbar-btn')) return;

        // 엘린: "기억" 버튼 찾기
        const memBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '기억');
        if (!memBtn) return;
        const container = memBtn.parentElement; // flex items-center gap-1.5
        if (!container) return;

        const btn = document.createElement('button');
        btn.id = 'elp-toolbar-btn';
        btn.type = 'button';
        btn.title = '형광펜 노트 (Alt+H)';
        btn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span class="elp-btn-label">형광펜</span>`;
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); togglePopup(); });

        // 기억 버튼 오른쪽에 삽입
        memBtn.insertAdjacentElement('afterend', btn);
        syncToolbarTheme();
    }

    function syncToolbarTheme() {
        // 툴바 버튼도 CSS 변수로 처리 — 별도 클래스 불필요
    }

    document.addEventListener('keydown', e => { if(e.altKey&&e.key==='h'){e.preventDefault();togglePopup();} });

    // ==========================================
    // 테마
    // ==========================================
    function syncTheme() {
        // 엘린 라이트/다크 반응형 — CSS 변수가 자동 처리하므로 클래스 불필요
        // (elp-dark 클래스 제거 — hsl(var(--...)) 가 테마 따라감)
        syncToolbarTheme();
    }
    syncTheme();

    // ==========================================
    // 텍스트 선택 — Range 저장
    // ==========================================
    const handleSelectionEnd = e => {
        if (e.type==='mouseup'&&e.button!==0) return;
        if ([selectionBar,editBar,popup,ctxMenu].some(el=>el.contains(e.target))) return;

        if (e.target.tagName==='MARK'&&e.target.classList.contains('elp-hl')) {
            window.getSelection().removeAllRanges();
            selectionBar.style.display='none';
            currentEditingId = e.target.dataset.elpId;
            editBar.style.display='flex';
            positionBar(editBar, e, null);
            return;
        }

        setTimeout(() => {
            const sel = window.getSelection();
            let text = sel?.toString().trim();
            if (text?.length>0&&sel.rangeCount>0) {
                if (text.includes('\n')) text = text.split('\n')[0].trim();
                savedSelectionText  = text;
                savedSelectionRange = sel.getRangeAt(0).cloneRange();
                selectionBar.style.display = 'flex';
                positionBar(selectionBar, e, sel);
            } else {
                selectionBar.style.display='none';
                savedSelectionText=''; savedSelectionRange=null;
            }
        }, 50);
    };

    const handleSelectionStart = e => {
        if (!selectionBar.contains(e.target)) selectionBar.style.display='none';
        if (!editBar.contains(e.target)&&e.target.tagName!=='MARK') { editBar.style.display='none'; currentEditingId=null; }
    };

    function positionBar(bar, e, sel) {
        let px = e.pageX || e.changedTouches?.[0]?.pageX;
        let py = e.pageY || e.changedTouches?.[0]?.pageY;
        if (!px&&sel?.rangeCount>0) { const r=sel.getRangeAt(0).getBoundingClientRect(); px=r.right+window.scrollX; py=r.bottom+window.scrollY; }
        bar.style.left=`${px+12}px`; bar.style.top=`${py+12}px`;
        const maxL=window.innerWidth-bar.offsetWidth-20;
        if(parseInt(bar.style.left)>maxL) bar.style.left=`${maxL+window.scrollX}px`;
    }

    document.addEventListener('mouseup',    handleSelectionEnd);
    document.addEventListener('touchend',   handleSelectionEnd);
    document.addEventListener('mousedown',  handleSelectionStart);
    document.addEventListener('touchstart', handleSelectionStart, {passive:true});

    // ==========================================
    // 형광펜 추가
    // ==========================================
    function addHighlight(colorObj) {
        if (!savedSelectionText||!savedSelectionRange) return;
        const range = savedSelectionRange;
        let anchor=null, focus=null;
        try {
            anchor = { xpath: getXPath(range.startContainer), offset: range.startOffset };
            focus  = { xpath: getXPath(range.endContainer),   offset: range.endOffset   };
        } catch(e) {}
        highlights.push({ id: Date.now().toString(), text: savedSelectionText, color: colorObj, timestamp: Date.now(), note: '', anchor, focus });
        saveHighlights();
        window.getSelection().removeAllRanges();
        selectionBar.style.display='none'; savedSelectionText=''; savedSelectionRange=null;
    }

    function changeHighlightColor(newColor) {
        if (!currentEditingId) return;
        const hl = highlights.find(h=>h.id===currentEditingId);
        if (hl) {
            hl.color=newColor; saveHighlights();
            document.querySelectorAll(`mark[data-elp-id="${currentEditingId}"]`).forEach(m=>{
                m.style.backgroundColor=hexToRgba(newColor.bg,highlightOpacity); m.style.color=newColor.text||'inherit';
            });
        }
        editBar.style.display='none'; currentEditingId=null;
    }

    // ==========================================
    // DOM 적용
    // ==========================================
    function applyHighlightsToDOM() {
        highlights.forEach(hl => {
            if (document.querySelector(`mark[data-elp-id="${hl.id}"]`)) return;

            // A. 위치 기반
            if (hl.anchor && hl.focus) {
                try {
                    const sNode = resolveXPath(hl.anchor.xpath);
                    const eNode = resolveXPath(hl.focus.xpath);
                    if (sNode && eNode) {
                        const range = document.createRange();
                        range.setStart(sNode, Math.min(hl.anchor.offset, sNode.nodeValue?.length??0));
                        range.setEnd(eNode,   Math.min(hl.focus.offset,  eNode.nodeValue?.length??0));
                        if (!range.collapsed) {
                            const mark = document.createElement('mark');
                            mark.className='elp-hl elp-start elp-end';
                            mark.setAttribute('role','button');
                            mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                            mark.style.color=hl.color.text||'inherit';
                            mark.dataset.elpId=hl.id;
                            mark.title=hl.note?`메모: ${hl.note}`:'우클릭 삭제 / 클릭 색상 변경';
                            range.surroundContents(mark);
                            return;
                        }
                    }
                } catch(e) {}
            }

            // B. 텍스트 폴백
            applyByTextMatch(hl);
        });
    }

    function applyByTextMatch(hl) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const textNodes=[]; let node;
        while(node=walker.nextNode()){
            const p=node.parentNode;
            if(!p||['SCRIPT','STYLE','TEXTAREA','INPUT','NOSCRIPT'].includes(p.nodeName)) continue;
            if(p.closest('#elp-popup,#elp-selection-bar,#elp-edit-bar,#elp-context-menu,#elp-reset-overlay,#elp-custom-alert')) continue;
            if(node.nodeValue.trim()) textNodes.push(node);
        }
        const target=hl.text.replace(/\s+/g,'');
        if(!target) return;

        let globalText='', map=[];
        textNodes.forEach(n=>{ const clean=n.nodeValue.replace(/\s+/g,''); map.push({node:n,start:globalText.length,end:globalText.length+clean.length,originalText:n.nodeValue}); globalText+=clean; });

        const firstIdx = globalText.indexOf(target);
        if (firstIdx === -1) return;

        const getOrigIdx = (ci,orig,isEnd) => {
            let t=isEnd?ci-1:ci,cc=0;
            for(let i=0;i<orig.length;i++){ if(!/\s/.test(orig[i])){ if(cc===t)return isEnd?i+1:i; cc++; } }
            return orig.length;
        };

        const mi=firstIdx, me=firstIdx+target.length;
        map.filter(m=>m.end>mi&&m.start<me).reverse().forEach((m,i,arr)=>{
            const os=mi<m.start?0:getOrigIdx(mi-m.start,m.originalText,false);
            const oe=me>m.end?m.originalText.length:getOrigIdx(me-m.start,m.originalText,true);
            if(os<oe){
                const mark=document.createElement('mark');
                mark.className='elp-hl';
                mark.setAttribute('role','button');
                if(i===arr.length-1) mark.classList.add('elp-start');
                if(i===0)            mark.classList.add('elp-end');
                mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                mark.style.color=hl.color.text||'inherit';
                mark.dataset.elpId=hl.id;
                mark.textContent=m.originalText.substring(os,oe);
                mark.title=hl.note?`메모: ${hl.note}`:'우클릭 삭제 / 클릭 색상 변경';
                const s=m.node.splitText(os); s.nodeValue=s.nodeValue.substring(oe-os); s.parentNode.insertBefore(mark,s);
            }
        });
    }

    // ==========================================
    // 팝업 리스트
    // ==========================================
    function renderPopupList(q='') {
        const list=document.getElementById('elp-list');
        const countEl=document.getElementById('elp-header-count');
        if(!list) return;
        list.innerHTML='';
        const filtered=highlights.filter(h=>h.text.toLowerCase().includes(q)||(h.note&&h.note.toLowerCase().includes(q)));
        if(countEl) countEl.textContent = highlights.length;

        if(filtered.length===0){
            list.innerHTML=`<div class="elp-empty">${q?'검색 결과가 없습니다.':'텍스트를 드래그해서<br>색을 칠해보세요.'}</div>`;
            return;
        }

        const sorted = [...filtered].sort((a,b)=>b.timestamp-a.timestamp);
        const groups = {};
        sorted.forEach(hl => {
            const d = new Date(hl.timestamp), today = new Date();
            let label;
            if (d.toDateString()===today.toDateString()) label='오늘';
            else {
                const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
                label = d.toDateString()===yesterday.toDateString() ? '어제' : `${d.getMonth()+1}월 ${d.getDate()}일`;
            }
            if(!groups[label]) groups[label]=[];
            groups[label].push(hl);
        });

        Object.entries(groups).forEach(([label, items]) => {
            const divider = document.createElement('div');
            divider.className = 'elp-divider';
            divider.innerHTML = `<span class="elp-divider-label">${label}</span><span class="elp-divider-line"></span>`;
            list.appendChild(divider);
            items.forEach(hl => {
                const item = document.createElement('div');
                item.className = 'elp-item';
                const dot = hl.color.text ? `linear-gradient(135deg,${hl.color.bg} 50%,${hl.color.text} 50%)` : hl.color.bg;
                item.innerHTML = `
                    <div class="elp-item-top">
                        <div class="elp-item-dot" style="background:${dot};"></div>
                        <div class="elp-item-body"><div class="elp-item-text">${hl.text}</div></div>
                        <button class="elp-item-del" title="삭제">✕</button>
                    </div>
                    <input type="text" class="elp-note-input" placeholder="메모..." value="${hl.note||''}">`;
                item.querySelector('.elp-item-top').onclick = e => { if(e.target.tagName!=='BUTTON') scrollToHighlight(hl.id); };
                item.querySelector('.elp-item-del').onclick = e => { e.stopPropagation(); deleteHighlightData(hl.id); };
                item.querySelector('.elp-note-input').addEventListener('change', e => {
                    const t=highlights.find(h=>h.id===hl.id);
                    if(t){t.note=e.target.value.trim();localStorage.setItem(getStorageKey(),JSON.stringify(highlights));applyHighlightsToDOM();}
                });
                list.appendChild(item);
            });
        });
    }

    // ==========================================
    // 스크롤 이동 & 삭제
    // ==========================================
    function scrollToHighlight(id) {
        let tries=0;
        const toast=document.createElement('div');
        toast.id='elp-toast'; toast.textContent='탐색 중...';
        document.body.appendChild(toast);
        const loop=setInterval(()=>{
            applyHighlightsToDOM();
            const t=document.querySelector(`mark[data-elp-id="${id}"]`);
            if(t){ clearInterval(loop); toast.remove(); t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('flash'); setTimeout(()=>t.classList.remove('flash'),1400); }
            else if(++tries>15){ clearInterval(loop); toast.remove(); customAlert('너무 오래된 대화이거나 삭제된 텍스트일 수 있어요.'); }
            else { window.scrollTo(0,0); document.querySelectorAll('div').forEach(d=>{if(d.scrollHeight>d.clientHeight)d.scrollTop=0;}); }
        },800);
    }

    function deleteHighlightData(id) {
        highlights=highlights.filter(h=>h.id!==id); saveHighlights();
        document.querySelectorAll(`mark[data-elp-id="${id}"]`).forEach(m=>m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
    }

    let ctxPressTimer;
    document.addEventListener('touchstart', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('elp-hl')) ctxPressTimer=setTimeout(()=>openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.elpId)),800); });
    document.addEventListener('touchend',  ()=>clearTimeout(ctxPressTimer));
    document.addEventListener('touchmove', ()=>clearTimeout(ctxPressTimer));
    window.addEventListener('contextmenu', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('elp-hl')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.elpId)); } },true);

    // ==========================================
    // 초기화 & 감지
    // ==========================================
    renderSelectionBar(); renderEditBar(); renderPopupPalette(); loadHighlights();
    setTimeout(applyHighlightsToDOM, 1000);

    setInterval(()=>{
        injectToolbarButton();
        if(currentPath!==window.location.pathname){
            currentPath=window.location.pathname;
            loadHighlights(); renderPopupList(); applyHighlightsToDOM();
        }
        syncTheme();
    },500);

    const observer=new MutationObserver(mutations=>{
        let shouldApply=false;
        mutations.forEach(m=>{
            if(m.addedNodes.length>0) shouldApply=true;
            if(m.type==='attributes'&&(m.attributeName==='class')) syncTheme();
        });
        if(shouldApply){ clearTimeout(window.elpDebounce); window.elpDebounce=setTimeout(applyHighlightsToDOM,400); }
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});

})();

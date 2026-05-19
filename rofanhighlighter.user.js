// ==UserScript==
// @name         로판AI 형광펜
// @namespace    https://rofan.ai/
// @version      3.0.0
// @description  로판AI 형광펜 노트
// @author       레몬파이 
// @match        https://rofan.ai/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`#hl-tooltip{display:none!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;}`);

    // ==========================================
    // 로판AI 디자인 토큰
    // ==========================================
    const GOLD  = '#FFC200';

    // 다크모드 토큰
    const D_BG      = '#1f2327';  // 팝업 배경
    const D_BG2     = '#1b2228';  // 섹션/카드 배경
    const D_BG3     = '#343a40';  // inner card
    const D_BORDER  = '#2a2f35';
    const D_BORDER2 = '#4b5563';  // border-gray-600
    const D_TEXT    = '#ffffff';
    const D_TEXT2   = '#d1d5db';  // gray-300
    const D_TEXT3   = '#9ca3af';  // gray-400
    const D_TEXT4   = '#6b7280';  // gray-500

    // 라이트모드 토큰 (로판AI 라이트 UI 기반)
    const L_BG      = '#ffffff';
    const L_BG2     = '#f3f4f6';
    const L_BG3     = '#e9ecef';
    const L_BORDER  = '#e5e7eb';
    const L_BORDER2 = '#d1d5db';
    const L_TEXT    = '#111827';
    const L_TEXT2   = '#374151';
    const L_TEXT3   = '#6b7280';
    const L_TEXT4   = '#9ca3af';

    // ==========================================
    // 로판AI 분위기 기본 팔레트
    //   골드(강조) / 로즈(감성) / 슬레이트(차분) / 에메랄드(청량)
    // ==========================================
    const DEFAULT_COLORS = [
        { bg: '#FFC200', text: '#3d2e00' },   // 골드 — 로판AI 포인트
        { bg: '#ffe4e6', text: '#881337' },   // 로즈
        { bg: '#e0f2fe', text: '#0c4a6e' },   // 스카이
        { bg: '#d1fae5', text: '#064e3b' },   // 에메랄드
    ];
    const MAX_COLORS = 8;

    const getStorageKey = () => `RFHL_${window.location.pathname}`;
    const PALETTE_KEY   = 'RFHL_Palette';
    const POPUP_POS_KEY = 'RFHL_PopupPos';
    const OPACITY_KEY   = 'RFHL_Opacity';
    const BOLD_KEY      = 'RFHL_Bold';

    let currentPath = window.location.pathname;
    let highlights  = [];
    let savedSelectionRange = null;
    let savedSelectionText  = '';

    let paletteColors = JSON.parse(localStorage.getItem(PALETTE_KEY));
    if (!paletteColors) paletteColors = DEFAULT_COLORS;
    else paletteColors = paletteColors.map(c => typeof c === 'string' ? { bg: c, text: '' } : c);

    let highlightOpacity = parseFloat(localStorage.getItem(OPACITY_KEY) ?? '0.50');
    let highlightBold    = (localStorage.getItem(BOLD_KEY) ?? 'true') === 'true';
    document.documentElement.style.setProperty('--rfhl-fw', highlightBold ? 'bold' : 'normal');

    let currentEditingId = null;

    // ── 라이트모드 감지 ────────────────────────
    // 로판AI는 html/body class 변경 없이 내부 div className만 바뀜
    // → 첫 번째 불투명 배경 div의 밝기로 판단
    function isLight() {
        const divs = document.querySelectorAll('div');
        for (const d of divs) {
            const bg = window.getComputedStyle(d).backgroundColor;
            if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
            const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) {
                const [r, g, b] = [+m[1], +m[2], +m[3]];
                return r > 200 && g > 200 && b > 200;
            }
        }
        return false;
    }
    function syncTheme() {
        popup.classList.toggle('rfhl-light', isLight());
    }

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

    // ==========================================
    // CSS
    // ==========================================
    GM_addStyle(`
        /* ── 팝업 (다크 기본) ── */
        #rfhl-popup {
            position: fixed;
            width: 310px; max-height: 600px;
            border-radius: 12px;
            border: 1px solid ${D_BORDER};
            box-shadow: 0 20px 48px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3);
            background: ${D_BG}; color: ${D_TEXT};
            z-index: 2147483640 !important;
            display: none; flex-direction: column; overflow: hidden;
            font-family: 'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
            font-size: 13px;
        }
        /* 라이트 오버라이드 */
        #rfhl-popup.rfhl-light {
            background: ${L_BG}; color: ${L_TEXT};
            border-color: ${L_BORDER};
            box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.07);
        }

        /* ── 선택/편집 바 ── */
        #rfhl-selection-bar, #rfhl-edit-bar {
            position: absolute; display: none;
            background: ${D_BG2}; padding: 7px 10px; border-radius: 10px;
            border: 1px solid ${D_BORDER2};
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 2147483641 !important; gap: 7px; align-items: center;
        }
        @media (max-width: 640px) {
            #rfhl-selection-bar, #rfhl-edit-bar {
                position: fixed !important; left: 50% !important; top: auto !important;
                bottom: 80px !important; transform: translateX(-50%) !important;
                border-radius: 24px !important; padding: 10px 16px !important;
                gap: 10px !important; white-space: nowrap; touch-action: none;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
            }
            #rfhl-selection-bar .rfhl-color-btn,
            #rfhl-edit-bar .rfhl-color-btn { width: 34px !important; height: 34px !important; }
        }

        /* ── 오버레이/모달 ── */
        #rfhl-reset-overlay, #rfhl-custom-alert {
            position: fixed; inset: 0; background: rgba(0,0,0,0.65);
            z-index: 2147483642 !important; display: none;
            justify-content: center; align-items: center;
            font-family: 'Pretendard',sans-serif;
        }
        #rfhl-context-menu {
            position: absolute; display: none; background: ${D_BG2};
            padding: 12px 14px; border-radius: 10px; border: 1px solid ${D_BORDER2};
            box-shadow: 0 8px 28px rgba(0,0,0,0.55);
            z-index: 2147483644 !important; flex-direction: column; gap: 10px;
            font-family: 'Pretendard',sans-serif;
        }
        .rfhl-modal-box {
            background: ${D_BG}; padding: 24px 28px; border-radius: 12px;
            text-align: center; max-width: 300px; border: 1px solid ${D_BORDER};
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        }
        .rfhl-modal-box.danger { border-color: rgba(239,68,68,0.3); max-width: 320px; }

        /* ── 컬러 버튼 ── */
        .rfhl-color-btn {
            width: 20px; height: 20px; border-radius: 50%;
            border: 1.5px solid rgba(255,255,255,0.25);
            cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
            flex-shrink: 0; box-sizing: border-box;
        }
        .rfhl-color-btn:hover { transform: scale(1.3); box-shadow: 0 0 0 2.5px ${GOLD}99; }

        /* ── ctx 버튼 ── */
        .rfhl-ctx-text { color: ${D_TEXT3}; font-size: 12px; font-weight: 600; text-align: center; }
        .rfhl-ctx-actions { display: flex; gap: 8px; justify-content: center; }
        .rfhl-ctx-btn { padding: 7px 16px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s; }
        .rfhl-ctx-cancel { background: #2d2d2d; color: #fff; }
        .rfhl-ctx-cancel:hover { background: #3a3a3a; }
        .rfhl-ctx-delete { background: rgba(239,68,68,0.15); color: #f87171; }
        .rfhl-ctx-delete:hover { background: #ef4444; color: #fff; }

        /* ── 팝업 헤더 ── */
        .rfhl-header {
            padding: 13px 14px 11px;
            border-bottom: 1px solid ${D_BORDER};
            display: flex; justify-content: space-between; align-items: center;
            cursor: grab; user-select: none; flex-shrink: 0;
        }
        #rfhl-popup.rfhl-light .rfhl-header { border-bottom-color: ${L_BORDER}; }
        .rfhl-header:active { cursor: grabbing; }
        .rfhl-header-left { display: flex; align-items: center; gap: 8px; }
        .rfhl-title { font-size: 15px; font-weight: 700; color: ${D_TEXT}; }
        #rfhl-popup.rfhl-light .rfhl-title { color: ${L_TEXT}; }
        .rfhl-count-badge {
            font-size: 11px; font-weight: 600; color: ${GOLD};
            background: rgba(255,194,0,0.12); border-radius: 6px;
            padding: 2px 7px; border: 1px solid rgba(255,194,0,0.28);
        }
        .rfhl-header-actions { display: flex; gap: 2px; align-items: center; }

        /* ── 아이콘 버튼 ── */
        .rfhl-icon-btn {
            background: none; border: none; cursor: pointer; color: ${D_TEXT4};
            padding: 0; line-height: 1; display: flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 8px; transition: 0.15s; font-size: 13px;
        }
        #rfhl-popup.rfhl-light .rfhl-icon-btn { color: ${L_TEXT3}; }
        .rfhl-icon-btn:hover { color: ${GOLD}; background: rgba(255,194,0,0.1); }
        .rfhl-bold-active { background: rgba(255,194,0,0.12) !important; color: ${GOLD} !important; border: 1px solid rgba(255,194,0,0.25) !important; }

        /* ── 슬라이더 ── */
        #rfhl-opacity-slider {
            width: 50px; height: 3px; border-radius: 2px;
            appearance: none; background: #374151; outline: none; cursor: pointer;
        }
        #rfhl-popup.rfhl-light #rfhl-opacity-slider { background: ${L_BORDER2}; }
        #rfhl-opacity-slider::-webkit-slider-thumb {
            appearance: none; width: 12px; height: 12px; border-radius: 50%;
            background: ${GOLD}; cursor: pointer; transition: 0.15s;
        }
        #rfhl-opacity-slider::-webkit-slider-thumb:hover { transform: scale(1.25); }

        /* ── 팝업 바디 ── */
        .rfhl-body { display: flex; flex-direction: column; overflow: hidden; flex: 1; }

        /* ── 색상 팔레트 섹션 ── */
        .rfhl-palette-sec {
            padding: 10px 14px 11px;
            border-bottom: 1px solid ${D_BORDER};
        }
        #rfhl-popup.rfhl-light .rfhl-palette-sec { border-bottom-color: ${L_BORDER}; }
        .rfhl-sec-label {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.8px;
            text-transform: uppercase; color: ${D_TEXT4}; margin-bottom: 8px;
        }
        #rfhl-popup.rfhl-light .rfhl-sec-label { color: ${L_TEXT4}; }
        .rfhl-palette-wrap { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
        .rfhl-color-add {
            width: 20px; height: 20px; border-radius: 50%;
            background: rgba(255,255,255,0.05); border: 1.5px dashed ${D_BORDER2};
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: ${D_TEXT4}; font-size: 14px; line-height: 1;
            transition: 0.15s; box-sizing: border-box;
        }
        #rfhl-popup.rfhl-light .rfhl-color-add {
            background: rgba(0,0,0,0.03); border-color: ${L_BORDER2}; color: ${L_TEXT3};
        }
        .rfhl-color-add:hover { border-color: ${GOLD}; color: ${GOLD}; background: rgba(255,194,0,0.08); }

        /* ── 색상 피커 ── */
        .rfhl-picker-ui {
            display: none; flex-direction: column; gap: 9px;
            background: rgba(0,0,0,0.18); padding: 10px 12px;
            border-radius: 8px; border: 1px solid ${D_BORDER};
            margin-top: 9px; font-size: 12px;
        }
        #rfhl-popup.rfhl-light .rfhl-picker-ui { background: ${L_BG2}; border-color: ${L_BORDER}; }
        .rfhl-picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .rfhl-picker-label { display: flex; align-items: center; gap: 7px; cursor: pointer; color: ${D_TEXT3}; }
        #rfhl-popup.rfhl-light .rfhl-picker-label { color: ${L_TEXT3}; }
        .rfhl-picker-chk-label { display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:${D_TEXT3};flex:1; }
        #rfhl-popup.rfhl-light .rfhl-picker-chk-label { color: ${L_TEXT3}; }
        .rfhl-color-input { width: 22px; height: 22px; padding: 0; border: none; cursor: pointer; border-radius: 5px; }
        .rfhl-picker-preview { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #374151; flex-shrink: 0; }
        #rfhl-popup.rfhl-light .rfhl-picker-preview { border-color: ${L_BORDER2}; }
        .rfhl-add-btn {
            flex: 1; background: rgba(255,194,0,0.1); color: ${GOLD};
            border: 1px solid rgba(255,194,0,0.25); padding: 6px 12px; border-radius: 8px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .rfhl-add-btn:hover { background: ${GOLD}; color: #000; border-color: ${GOLD}; }

        /* ── 검색 ── */
        .rfhl-search-sec { padding: 8px 14px; border-bottom: 1px solid ${D_BORDER}; flex-shrink: 0; }
        #rfhl-popup.rfhl-light .rfhl-search-sec { border-bottom-color: ${L_BORDER}; }
        .rfhl-search-wrap {
            display: flex; align-items: center; gap: 7px;
            background: ${D_BG2}; border: 1px solid ${D_BORDER2};
            border-radius: 8px; padding: 0 10px; transition: border-color 0.15s;
        }
        #rfhl-popup.rfhl-light .rfhl-search-wrap { background: ${L_BG2}; border-color: ${L_BORDER2}; }
        .rfhl-search-wrap:focus-within { border-color: ${GOLD}88; }
        .rfhl-search-icon { color: ${D_TEXT4}; font-size: 14px; flex-shrink: 0; }
        #rfhl-popup.rfhl-light .rfhl-search-icon { color: ${L_TEXT4}; }
        .rfhl-search-input { flex: 1; padding: 8px 0; border: none; background: transparent; color: ${D_TEXT2}; font-size: 12.5px; outline: none; }
        #rfhl-popup.rfhl-light .rfhl-search-input { color: ${L_TEXT}; }
        .rfhl-search-input::placeholder { color: ${D_TEXT4}; }
        #rfhl-popup.rfhl-light .rfhl-search-input::placeholder { color: ${L_TEXT4}; }

        /* ── 리스트 ── */
        .rfhl-list-sec { flex: 1; overflow-y: auto; padding: 8px 10px 12px; }
        .rfhl-list-sec::-webkit-scrollbar { width: 3px; }
        .rfhl-list-sec::-webkit-scrollbar-thumb { background: #374151; border-radius: 2px; }
        #rfhl-popup.rfhl-light .rfhl-list-sec::-webkit-scrollbar-thumb { background: ${L_BORDER2}; }

        .rfhl-empty { text-align: center; color: ${D_TEXT4}; margin-top: 32px; font-size: 12.5px; line-height: 2; }
        #rfhl-popup.rfhl-light .rfhl-empty { color: ${L_TEXT4}; }

        /* ── 아이템 ── */
        .rfhl-item {
            display: flex; flex-direction: column; gap: 5px;
            padding: 8px 10px; border-radius: 8px; margin-bottom: 3px;
            cursor: pointer; transition: background 0.15s; background: transparent;
            border: 1px solid transparent;
        }
        .rfhl-item:hover { background: ${D_BG2}; border-color: ${D_BORDER}; }
        #rfhl-popup.rfhl-light .rfhl-item:hover { background: ${L_BG2}; border-color: ${L_BORDER}; }
        .rfhl-item-top { display: flex; align-items: flex-start; gap: 8px; }
        .rfhl-item-dot { width: 7px; height: 7px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
        .rfhl-item-body { flex: 1; min-width: 0; }
        .rfhl-item-text {
            font-size: 12.5px; font-weight: 600; line-height: 1.4; color: ${D_TEXT2};
            word-break: break-all;
            display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        #rfhl-popup.rfhl-light .rfhl-item-text { color: ${L_TEXT2}; }
        .rfhl-item-del {
            background: none; border: none; cursor: pointer; color: #4b5563;
            font-size: 11px; padding: 0; width: 18px; height: 18px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 5px; flex-shrink: 0; transition: 0.15s;
        }
        .rfhl-item-del:hover { color: #f87171; background: rgba(239,68,68,0.1); }
        .rfhl-note-input {
            width: 100%; padding: 4px 8px; border: 1px dashed #374151;
            border-radius: 6px; background: transparent; color: ${D_TEXT4};
            font-size: 11px; outline: none; box-sizing: border-box; transition: 0.15s; font-family: inherit;
        }
        #rfhl-popup.rfhl-light .rfhl-note-input { border-color: ${L_BORDER2}; color: ${L_TEXT4}; }
        .rfhl-note-input:focus { border-style: solid; border-color: ${GOLD}55; color: ${D_TEXT2}; background: rgba(255,194,0,0.04); }
        #rfhl-popup.rfhl-light .rfhl-note-input:focus { color: ${L_TEXT2}; }
        .rfhl-note-input:not(:placeholder-shown) { border-style: solid; border-color: #374151; color: ${D_TEXT3}; }
        #rfhl-popup.rfhl-light .rfhl-note-input:not(:placeholder-shown) { border-color: ${L_BORDER2}; color: ${L_TEXT3}; }

        /* ── 구분선 ── */
        .rfhl-divider { display: flex; align-items: center; gap: 8px; padding: 8px 2px 4px; }
        .rfhl-divider-label {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.7px;
            text-transform: uppercase; color: ${D_TEXT4}; white-space: nowrap;
        }
        #rfhl-popup.rfhl-light .rfhl-divider-label { color: ${L_TEXT4}; }
        .rfhl-divider-line { flex: 1; height: 1px; background: #1f2937; }
        #rfhl-popup.rfhl-light .rfhl-divider-line { background: ${L_BORDER}; }

        /* ── 하단 초기화 버튼 ── */
        .rfhl-footer { padding: 9px 14px; border-top: 1px solid ${D_BORDER}; display: flex; justify-content: flex-end; flex-shrink: 0; }
        #rfhl-popup.rfhl-light .rfhl-footer { border-top-color: ${L_BORDER}; }
        .rfhl-footer-btn {
            padding: 6px 14px; border-radius: 6px;
            background: #2d2d2d; color: #e5e7eb;
            border: none; font-size: 12px; font-weight: 500; cursor: pointer; transition: 0.15s;
        }
        .rfhl-footer-btn:hover { background: #3a3a3a; }
        #rfhl-popup.rfhl-light .rfhl-footer-btn { background: ${L_BG2}; color: ${L_TEXT2}; }
        #rfhl-popup.rfhl-light .rfhl-footer-btn:hover { background: ${L_BG3}; }

        /* ── 형광펜 mark ── */
        mark.custom-rfhl {
            font-weight: var(--rfhl-fw, bold); padding: 1px 0; cursor: pointer;
            -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: opacity 0.2s;
        }
        mark.custom-rfhl.rfhl-start { border-top-left-radius: 3px; border-bottom-left-radius: 3px; padding-left: 2px; }
        mark.custom-rfhl.rfhl-end   { border-top-right-radius: 3px; border-bottom-right-radius: 3px; padding-right: 2px; }
        mark.custom-rfhl:hover { opacity: 0.7; }
        mark.custom-rfhl.flash { animation: rfhlFlash 1.4s ease; }
        @keyframes rfhlFlash { 0%,100%{box-shadow:none;} 30%,70%{box-shadow:0 0 0 2px ${GOLD};} }

        /* ── 모바일 바텀시트 ── */
        #rfhl-overlay { display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2147483639!important; }
        #rfhl-overlay.show { display:block; }
        @media (max-width: 640px) {
            #rfhl-popup {
                position: fixed !important; left:0!important; right:0!important;
                bottom:0!important; top:auto!important;
                width:100%!important; max-width:100%!important; max-height:88vh!important;
                border-radius:16px 16px 0 0!important; border-bottom:none!important;
            }
            #rfhl-popup::before {
                content:''; display:block; width:36px; height:4px;
                background:rgba(255,255,255,0.12); border-radius:2px; margin:8px auto 0; flex-shrink:0;
            }
            #rfhl-popup.rfhl-light::before { background:rgba(0,0,0,0.1); }
            .rfhl-header { cursor:default!important; }
        }

        /* ── 토스트 ── */
        #rfhl-toast {
            position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
            background:${D_BG2}; color:rgba(255,255,255,0.9); padding:9px 18px;
            border-radius:8px; z-index:2147483647; font-size:12px; font-weight:600;
            border:1px solid ${D_BORDER2}; box-shadow:0 4px 20px rgba(0,0,0,0.4);
            font-family:'Pretendard',sans-serif;
        }
    `);

    // ==========================================
    // UI 요소 생성
    // ==========================================
    const selectionBar = document.createElement('div');
    selectionBar.id = 'rfhl-selection-bar';
    document.body.appendChild(selectionBar);

    const editBar = document.createElement('div');
    editBar.id = 'rfhl-edit-bar';
    document.body.appendChild(editBar);

    function preventDefaultTouch(e) { e.preventDefault(); }

    function renderSelectionBar() {
        selectionBar.innerHTML = '';
        selectionBar.addEventListener('mousedown', preventDefaultTouch);
        selectionBar.addEventListener('touchstart', preventDefaultTouch, { passive: false });
        paletteColors.forEach(colorObj => {
            const btn = document.createElement('div');
            btn.className = 'rfhl-color-btn';
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
            btn.className = 'rfhl-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.title = '이 색상으로 변경';
            btn.addEventListener('click', e => { e.stopPropagation(); changeHighlightColor(colorObj); });
            btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); changeHighlightColor(colorObj); });
            editBar.appendChild(btn);
        });
    }

    // 알림
    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'rfhl-custom-alert';
    alertOverlay.innerHTML = `<div class="rfhl-modal-box"><p id="rfhl-alert-msg" style="margin:0 0 18px;color:rgba(255,255,255,0.8);font-size:13px;line-height:1.6;word-break:keep-all;"></p><button id="rfhl-alert-ok" class="rfhl-ctx-btn rfhl-ctx-cancel" style="padding:7px 22px;">확인</button></div>`;
    document.body.appendChild(alertOverlay);
    function customAlert(msg) { document.getElementById('rfhl-alert-msg').innerHTML = msg; alertOverlay.style.display = 'flex'; }
    document.getElementById('rfhl-alert-ok').onclick = () => alertOverlay.style.display = 'none';

    // 컨텍스트 메뉴
    const ctxMenu = document.createElement('div');
    ctxMenu.id = 'rfhl-context-menu';
    ctxMenu.innerHTML = `<div class="rfhl-ctx-text" id="rfhl-ctx-text">삭제할까요?</div><div class="rfhl-ctx-actions"><button class="rfhl-ctx-btn rfhl-ctx-cancel" id="rfhl-ctx-cancel">취소</button><button class="rfhl-ctx-btn rfhl-ctx-delete" id="rfhl-ctx-delete">삭제</button></div>`;
    document.body.appendChild(ctxMenu);

    let ctxCallback = null;
    function openContextMenu(e, text, callback) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        document.getElementById('rfhl-ctx-text').innerText = text;
        ctxCallback = callback; ctxMenu.style.display = 'flex';
        const px = e.pageX || e.changedTouches?.[0]?.pageX || 0;
        const py = e.pageY || e.changedTouches?.[0]?.pageY || 0;
        ctxMenu.style.left = `${px+5}px`; ctxMenu.style.top = `${py+5}px`;
    }
    document.getElementById('rfhl-ctx-cancel').onclick = () => { ctxMenu.style.display='none'; ctxCallback=null; };
    document.getElementById('rfhl-ctx-delete').onclick = () => { ctxCallback?.(); ctxMenu.style.display='none'; ctxCallback=null; };
    document.addEventListener('click',      e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });
    document.addEventListener('touchstart', e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });

    // 초기화 모달
    const resetOverlay = document.createElement('div');
    resetOverlay.id = 'rfhl-reset-overlay';
    resetOverlay.innerHTML = `<div class="rfhl-modal-box danger"><div style="font-size:28px;margin-bottom:10px;">⚠️</div><p style="margin:0 0 6px;color:rgba(255,255,255,0.9);font-size:15px;font-weight:700;">모든 데이터를 초기화할까요?</p><p style="margin:0 0 20px;color:#6b7280;font-size:12px;line-height:1.6;">형광펜 노트와 커스텀 색상이<br>영구적으로 삭제됩니다.</p><div style="display:flex;justify-content:center;gap:10px;"><button id="rfhl-reset-cancel" class="rfhl-ctx-btn rfhl-ctx-cancel">취소</button><button id="rfhl-reset-confirm" class="rfhl-ctx-btn rfhl-ctx-delete">초기화</button></div></div>`;
    document.body.appendChild(resetOverlay);
    document.getElementById('rfhl-reset-cancel').onclick  = () => resetOverlay.style.display='none';
    document.getElementById('rfhl-reset-confirm').onclick = () => {
        Object.keys(localStorage).forEach(k => { if(k.startsWith('RFHL_')) localStorage.removeItem(k); });
        highlights=[]; paletteColors=[...DEFAULT_COLORS];
        document.querySelectorAll('mark.custom-rfhl').forEach(m => m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
        renderPopupPalette(); renderSelectionBar(); renderEditBar(); renderPopupList();
        resetOverlay.style.display='none';
    };

    // 모바일 딤
    const rfhlOverlay = document.createElement('div');
    rfhlOverlay.id = 'rfhl-overlay';
    rfhlOverlay.addEventListener('click', () => { popup.style.display='none'; rfhlOverlay.classList.remove('show'); });
    document.body.appendChild(rfhlOverlay);

    function rfhlIsMobile() { return window.innerWidth <= 640; }

    function rfhlOpenPopup() {
        syncTheme();
        if (rfhlIsMobile()) {
            rfhlOverlay.classList.add('show');
            popup.style.left=''; popup.style.top=''; popup.style.right='';
        } else {
            rfhlOverlay.classList.remove('show');
            const sp = JSON.parse(localStorage.getItem(POPUP_POS_KEY));
            if (sp) { popup.style.left=sp.left; popup.style.top=sp.top; popup.style.right='auto'; }
            else    { popup.style.right='20px'; popup.style.top='80px'; popup.style.left='auto'; }
        }
        popup.style.display='flex';
        renderPopupList();
    }
    function rfhlClosePopup() {
        popup.style.display='none';
        rfhlOverlay.classList.remove('show');
    }

    // ==========================================
    // 팝업 HTML — 기존 단순 구조 유지
    // ==========================================
    const popup = document.createElement('div');
    popup.id = 'rfhl-popup';
    popup.innerHTML = `
        <div class="rfhl-header">
            <div class="rfhl-header-left">
                <span class="rfhl-title">형광펜</span>
                <span class="rfhl-count-badge" id="rfhl-header-count">0</span>
            </div>
            <div class="rfhl-header-actions">
                <input type="range" id="rfhl-opacity-slider" min="0" max="1" step="0.05" value="${highlightOpacity}" title="투명도">
                <button class="rfhl-icon-btn ${highlightBold?'rfhl-bold-active':''}" id="rfhl-bold-btn" title="볼드체" style="font-weight:800;font-family:serif;font-size:13px;">B</button>
                <button class="rfhl-icon-btn" id="rfhl-reset-btn" title="초기화" style="font-size:14px;">↺</button>
                <button class="rfhl-icon-btn" id="rfhl-close-btn" title="닫기" style="font-size:14px;">✕</button>
            </div>
        </div>
        <div class="rfhl-body">
            <div class="rfhl-palette-sec">
                <div class="rfhl-sec-label">Colors</div>
                <div class="rfhl-palette-wrap" id="rfhl-palette-container"></div>
                <div class="rfhl-picker-ui" id="rfhl-color-picker-ui">
                    <div class="rfhl-picker-row">
                        <label class="rfhl-picker-label">BG <input type="color" class="rfhl-color-input" id="rfhl-new-bg" value="#FFC200"></label>
                        <label class="rfhl-picker-chk-label">
                            <input type="checkbox" id="rfhl-keep-text" checked style="accent-color:${GOLD};"> 원본 글자색
                        </label>
                        <div id="rfhl-new-preview" class="rfhl-picker-preview" style="background:#FFC200;"></div>
                    </div>
                    <div id="rfhl-text-color-label" style="display:none;">
                        <label class="rfhl-picker-label">Text <input type="color" class="rfhl-color-input" id="rfhl-new-text" value="#3d2e00"></label>
                    </div>
                    <button id="rfhl-confirm-add-color" class="rfhl-add-btn">추가</button>
                </div>
            </div>
            <div class="rfhl-search-sec">
                <div class="rfhl-search-wrap">
                    <span class="rfhl-search-icon">⌕</span>
                    <input type="text" id="rfhl-search" class="rfhl-search-input" placeholder="내용 또는 메모 검색">
                </div>
            </div>
            <div class="rfhl-list-sec" id="rfhl-list"></div>
        </div>
        <div class="rfhl-footer">
            <button class="rfhl-footer-btn" id="rfhl-footer-reset">추가 설정 초기화</button>
        </div>`;
    document.body.appendChild(popup);

    // ── 이벤트 바인딩 ────────────────────────────
    popup.querySelector('#rfhl-bold-btn').onclick = () => {
        highlightBold = !highlightBold;
        localStorage.setItem(BOLD_KEY, highlightBold);
        document.documentElement.style.setProperty('--rfhl-fw', highlightBold ? 'bold' : 'normal');
        popup.querySelector('#rfhl-bold-btn').classList.toggle('rfhl-bold-active', highlightBold);
    };
    popup.querySelector('#rfhl-close-btn').onclick = rfhlClosePopup;
    popup.querySelector('#rfhl-reset-btn').onclick = () => resetOverlay.style.display='flex';
    popup.querySelector('#rfhl-footer-reset').onclick = () => resetOverlay.style.display='flex';
    popup.querySelector('#rfhl-search').addEventListener('input', e => renderPopupList(e.target.value.trim().toLowerCase()));

    // 투명도
    const opSlider = popup.querySelector('#rfhl-opacity-slider');
    opSlider.addEventListener('input', e => {
        highlightOpacity = parseFloat(e.target.value);
        localStorage.setItem(OPACITY_KEY, highlightOpacity);
        document.querySelectorAll('mark.custom-rfhl').forEach(mark => {
            const h = highlights.find(x => x.id === mark.dataset.rfhlId);
            if (h) { mark.style.backgroundColor=hexToRgba(h.color.bg,highlightOpacity); mark.style.color=h.color.text||'inherit'; }
        });
    });

    // 색상 추가
    const bgInput = popup.querySelector('#rfhl-new-bg');
    const txInput = popup.querySelector('#rfhl-new-text');
    const keepCb  = popup.querySelector('#rfhl-keep-text');
    const txLabel = popup.querySelector('#rfhl-text-color-label');
    const preview = popup.querySelector('#rfhl-new-preview');
    const updatePreview = () => {
        const bg=bgInput.value, tx=keepCb.checked?'':txInput.value;
        preview.style.background = tx ? `linear-gradient(135deg,${bg} 50%,${tx} 50%)` : bg;
    };
    keepCb.onchange = () => { txLabel.style.display=keepCb.checked?'none':'block'; updatePreview(); };
    bgInput.addEventListener('input', updatePreview); txInput.addEventListener('input', updatePreview);
    popup.querySelector('#rfhl-confirm-add-color').onclick = () => {
        if (paletteColors.length >= MAX_COLORS) { customAlert('최대 8개까지 추가할 수 있어요.'); return; }
        paletteColors.push({ bg: bgInput.value, text: keepCb.checked?'':txInput.value });
        savePalette(); popup.querySelector('#rfhl-color-picker-ui').style.display='none';
    };

    // ── 드래그 (PC) ──────────────────────────────
    const header = popup.querySelector('.rfhl-header');
    let isDragging=false, dragSX, dragSY, initL, initT;
    header.addEventListener('mousedown', e => {
        if (e.target.closest('.rfhl-header-actions')||rfhlIsMobile()) return;
        isDragging=true;
        dragSX=e.clientX; dragSY=e.clientY;
        const r=popup.getBoundingClientRect(); initL=r.left; initT=r.top;
    });
    document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        popup.style.left=`${Math.max(0,Math.min(initL+(e.clientX-dragSX),window.innerWidth-popup.offsetWidth))}px`;
        popup.style.top =`${Math.max(0,Math.min(initT+(e.clientY-dragSY),window.innerHeight-popup.offsetHeight))}px`;
        popup.style.right='auto';
    });
    document.addEventListener('mouseup', () => {
        if(isDragging){isDragging=false;localStorage.setItem(POPUP_POS_KEY,JSON.stringify({left:popup.style.left,top:popup.style.top}));}
    });

    function renderPopupPalette() {
        const c = popup.querySelector('#rfhl-palette-container');
        c.innerHTML = '';
        paletteColors.forEach((colorObj, idx) => {
            const btn = document.createElement('div');
            btn.className = 'rfhl-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.title = '우클릭으로 삭제';
            let pt;
            btn.addEventListener('touchstart', e => { pt=setTimeout(()=>{if(paletteColors.length<=1){customAlert('최소 1개는 필요해요.');return;}openContextMenu(e,'이 색상을 삭제할까요?',()=>{paletteColors.splice(idx,1);savePalette();});},800); });
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
            add.className='rfhl-color-add'; add.innerHTML='+';
            add.onclick = () => { const ui=popup.querySelector('#rfhl-color-picker-ui'); ui.style.display=ui.style.display==='flex'?'none':'flex'; };
            c.appendChild(add);
        } else {
            popup.querySelector('#rfhl-color-picker-ui').style.display='none';
        }
    }

    // ==========================================
    // 툴바 버튼
    // ==========================================
    let rfhlLastIsMobile = null;
    function injectToolbarButton() {
        const mobile = rfhlIsMobile();
        if (rfhlLastIsMobile !== null && rfhlLastIsMobile !== mobile) document.getElementById('rfhl-toolbar-btn')?.remove();
        rfhlLastIsMobile = mobile;
        if (document.getElementById('rfhl-toolbar-btn')) return;

        const inputMenu = document.querySelector('div[data-input-menu="true"]');
        if (!inputMenu) return;

        const hlBtn = document.createElement('button');
        hlBtn.id = 'rfhl-toolbar-btn';
        hlBtn.type = 'button';
        hlBtn.title = '형광펜 노트 (Alt+H)';
        hlBtn.style.cssText = `cursor:pointer;background:none;border:none;padding:8px;display:flex;align-items:center;justify-content:center;transition:color 0.15s;flex-shrink:0;color:rgb(163,163,163);`;
        hlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        hlBtn.addEventListener('mouseenter', () => hlBtn.style.color = GOLD);
        hlBtn.addEventListener('mouseleave', () => hlBtn.style.color = 'rgb(163,163,163)');
        hlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); togglePopup(); });
        inputMenu.parentNode.insertBefore(hlBtn, inputMenu.nextSibling);
    }

    const togglePopup = () => { if(popup.style.display==='flex') rfhlClosePopup(); else rfhlOpenPopup(); };
    document.addEventListener('keydown', e => { if(e.altKey&&e.key==='h'){e.preventDefault();togglePopup();} });

    window.addEventListener('resize', () => {
        if (popup.style.display==='flex') {
            if(rfhlIsMobile()){popup.style.left='';popup.style.top='';popup.style.right='';rfhlOverlay.classList.add('show');}
            else{rfhlOverlay.classList.remove('show');const sp=JSON.parse(localStorage.getItem(POPUP_POS_KEY));if(sp){popup.style.left=sp.left;popup.style.top=sp.top;}}
        }
    });

    // ==========================================
    // 텍스트 선택
    // ==========================================
    let mobileSelectionTimer = null;
    document.addEventListener('selectionchange', () => {
        if (!rfhlIsMobile()) return;
        clearTimeout(mobileSelectionTimer);
        mobileSelectionTimer = setTimeout(() => {
            const sel = window.getSelection();
            const text = sel?.toString().trim();
            if (text && text.length > 0 && sel.rangeCount > 0) {
                const an = sel.anchorNode;
                if(selectionBar.contains(an)||editBar.contains(an)||popup.contains(an)||ctxMenu.contains(an)) return;
                savedSelectionText = text.includes('\n') ? text.split('\n')[0].trim() : text;
                savedSelectionRange = sel.getRangeAt(0).cloneRange();
                selectionBar.style.display='flex'; editBar.style.display='none'; currentEditingId=null;
            }
        }, 300);
    });

    document.addEventListener('mouseup', e => {
        if (rfhlIsMobile()) return;
        if (e.button !== 0) return;
        if ([selectionBar,editBar,popup,ctxMenu].some(el=>el.contains(e.target))) return;
        if (e.target.tagName==='MARK'&&e.target.classList.contains('custom-rfhl')) {
            window.getSelection().removeAllRanges(); selectionBar.style.display='none';
            currentEditingId=e.target.dataset.rfhlId; editBar.style.display='flex';
            positionBar(editBar, e, null); return;
        }
        setTimeout(() => {
            const sel=window.getSelection(); let text=sel?.toString().trim();
            if(text?.length>0&&sel.rangeCount>0){
                if(text.includes('\n')) text=text.split('\n')[0].trim();
                savedSelectionText=text; savedSelectionRange=sel.getRangeAt(0).cloneRange();
                selectionBar.style.display='flex'; positionBar(selectionBar, e, sel);
            } else { selectionBar.style.display='none'; savedSelectionText=''; savedSelectionRange=null; }
        }, 50);
    });

    document.addEventListener('mousedown', e => {
        if(rfhlIsMobile()) return;
        if(!selectionBar.contains(e.target)) selectionBar.style.display='none';
        if(!editBar.contains(e.target)&&e.target.tagName!=='MARK'){ editBar.style.display='none'; currentEditingId=null; }
    });

    document.addEventListener('touchend', e => {
        if(!rfhlIsMobile()) return;
        const target=e.target;
        if(selectionBar.contains(target)||editBar.contains(target)) return;
        if(target.tagName==='MARK'&&target.classList.contains('custom-rfhl')){
            const sel=window.getSelection();
            if(!sel||sel.toString().trim().length===0){
                window.getSelection().removeAllRanges(); selectionBar.style.display='none';
                savedSelectionText=''; savedSelectionRange=null;
                currentEditingId=target.dataset.rfhlId; editBar.style.display='flex'; return;
            }
        }
        const sel=window.getSelection();
        if(!sel||sel.toString().trim().length===0){
            setTimeout(()=>{
                const sel2=window.getSelection();
                if(!sel2||sel2.toString().trim().length===0){
                    if(!selectionBar.contains(document.activeElement)&&!editBar.contains(document.activeElement)){
                        selectionBar.style.display='none'; editBar.style.display='none'; currentEditingId=null;
                    }
                }
            },200);
        }
    });

    function positionBar(bar, e, sel) {
        let px=e.pageX||e.changedTouches?.[0]?.pageX;
        let py=e.pageY||e.changedTouches?.[0]?.pageY;
        if(!px&&sel?.rangeCount>0){const r=sel.getRangeAt(0).getBoundingClientRect();px=r.right+window.scrollX;py=r.bottom+window.scrollY;}
        bar.style.left=`${px+12}px`; bar.style.top=`${py+12}px`;
        const maxL=window.innerWidth-bar.offsetWidth-20;
        if(parseInt(bar.style.left)>maxL) bar.style.left=`${maxL+window.scrollX}px`;
    }

    // ==========================================
    // 형광펜 추가 / 색상 변경
    // ==========================================
    function addHighlight(colorObj) {
        if(!savedSelectionText||!savedSelectionRange) return;
        const range=savedSelectionRange;
        let anchor=null, focus=null;
        try {
            anchor={xpath:getXPath(range.startContainer),offset:range.startOffset};
            focus ={xpath:getXPath(range.endContainer),  offset:range.endOffset};
        } catch(e) {}
        highlights.push({id:Date.now().toString(),text:savedSelectionText,color:colorObj,timestamp:Date.now(),note:'',anchor,focus});
        saveHighlights();
        window.getSelection().removeAllRanges();
        selectionBar.style.display='none'; savedSelectionText=''; savedSelectionRange=null;
    }

    function changeHighlightColor(newColor) {
        if(!currentEditingId) return;
        const hl=highlights.find(h=>h.id===currentEditingId);
        if(hl){
            hl.color=newColor; saveHighlights();
            document.querySelectorAll(`mark[data-rfhl-id="${currentEditingId}"]`).forEach(m=>{
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
            if(document.querySelector(`mark[data-rfhl-id="${hl.id}"]`)) return;
            if(hl.anchor&&hl.focus){
                try {
                    const sNode=resolveXPath(hl.anchor.xpath), eNode=resolveXPath(hl.focus.xpath);
                    if(sNode&&eNode){
                        const range=document.createRange();
                        range.setStart(sNode,Math.min(hl.anchor.offset,sNode.nodeValue?.length??0));
                        range.setEnd(eNode,  Math.min(hl.focus.offset, eNode.nodeValue?.length??0));
                        if(!range.collapsed){
                            const mark=document.createElement('mark');
                            mark.className='custom-rfhl rfhl-start rfhl-end'; mark.setAttribute('role','button');
                            mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                            mark.style.color=hl.color.text||'inherit'; mark.dataset.rfhlId=hl.id;
                            mark.title=hl.note?`메모: ${hl.note}`:'우클릭 삭제 / 클릭 색상 변경';
                            range.surroundContents(mark); return;
                        }
                    }
                } catch(e) {}
            }
            applyByTextMatch(hl);
        });
    }

    function applyByTextMatch(hl) {
        const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null,false);
        const textNodes=[]; let node;
        while(node=walker.nextNode()){
            const p=node.parentNode;
            if(!p||['SCRIPT','STYLE','TEXTAREA','INPUT','NOSCRIPT'].includes(p.nodeName)) continue;
            if(p.closest('#rfhl-popup,#rfhl-selection-bar,#rfhl-edit-bar,#rfhl-context-menu,#rfhl-reset-overlay,#rfhl-custom-alert')) continue;
            if(node.nodeValue.trim()) textNodes.push(node);
        }
        const target=hl.text.replace(/\s+/g,''); if(!target) return;
        let globalText='', map=[];
        textNodes.forEach(n=>{const clean=n.nodeValue.replace(/\s+/g,'');map.push({node:n,start:globalText.length,end:globalText.length+clean.length,originalText:n.nodeValue});globalText+=clean;});
        const firstIdx=globalText.indexOf(target); if(firstIdx===-1) return;
        const getOrigIdx=(ci,orig,isEnd)=>{
            let t=isEnd?ci-1:ci,cc=0;
            for(let i=0;i<orig.length;i++){if(!/\s/.test(orig[i])){if(cc===t)return isEnd?i+1:i;cc++;}}
            return orig.length;
        };
        const mi=firstIdx, me=firstIdx+target.length;
        const nodes=map.filter(m=>m.end>mi&&m.start<me);
        nodes.reverse().forEach((m,i,arr)=>{
            const os=mi<m.start?0:getOrigIdx(mi-m.start,m.originalText,false);
            const oe=me>m.end?m.originalText.length:getOrigIdx(me-m.start,m.originalText,true);
            if(os<oe){
                const mark=document.createElement('mark'); mark.className='custom-rfhl'; mark.setAttribute('role','button');
                if(i===arr.length-1) mark.classList.add('rfhl-start');
                if(i===0)            mark.classList.add('rfhl-end');
                mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                mark.style.color=hl.color.text||'inherit'; mark.dataset.rfhlId=hl.id;
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
        const list=popup.querySelector('#rfhl-list');
        const countEl=popup.querySelector('#rfhl-header-count');
        if(!list) return; list.innerHTML='';
        const filtered=highlights.filter(h=>h.text.toLowerCase().includes(q)||(h.note&&h.note.toLowerCase().includes(q)));
        if(countEl) countEl.textContent=highlights.length;
        if(filtered.length===0){
            list.innerHTML=`<div class="rfhl-empty">${q?'검색 결과가 없습니다.':'텍스트를 드래그해서<br>형광펜을 칠해보세요.'}</div>`;
            return;
        }
        const sorted=[...filtered].sort((a,b)=>b.timestamp-a.timestamp);
        const groups={};
        sorted.forEach(hl=>{
            const d=new Date(hl.timestamp),today=new Date();
            let label;
            if(d.toDateString()===today.toDateString()) label='오늘';
            else{const y=new Date(today);y.setDate(today.getDate()-1);label=d.toDateString()===y.toDateString()?'어제':`${d.getMonth()+1}월 ${d.getDate()}일`;}
            if(!groups[label]) groups[label]=[];
            groups[label].push(hl);
        });
        Object.entries(groups).forEach(([label,items])=>{
            const divider=document.createElement('div'); divider.className='rfhl-divider';
            divider.innerHTML=`<span class="rfhl-divider-label">${label}</span><span class="rfhl-divider-line"></span>`;
            list.appendChild(divider);
            items.forEach(hl=>{
                const item=document.createElement('div'); item.className='rfhl-item';
                const dot=hl.color.text?`linear-gradient(135deg,${hl.color.bg} 50%,${hl.color.text} 50%)`:hl.color.bg;
                item.innerHTML=`
                    <div class="rfhl-item-top">
                        <div class="rfhl-item-dot" style="background:${dot};"></div>
                        <div class="rfhl-item-body"><div class="rfhl-item-text">${hl.text}</div></div>
                        <button class="rfhl-item-del" title="삭제">✕</button>
                    </div>
                    <input type="text" class="rfhl-note-input" placeholder="메모 추가..." value="${hl.note||''}">`;
                item.querySelector('.rfhl-item-top').onclick=e=>{if(e.target.tagName!=='BUTTON') scrollToHighlight(hl.id);};
                item.querySelector('.rfhl-item-del').onclick=e=>{e.stopPropagation();deleteHighlightData(hl.id);};
                item.querySelector('.rfhl-note-input').addEventListener('change',e=>{
                    const t=highlights.find(h=>h.id===hl.id);
                    if(t){t.note=e.target.value.trim();localStorage.setItem(getStorageKey(),JSON.stringify(highlights));applyHighlightsToDOM();}
                });
                list.appendChild(item);
            });
        });
    }

    function scrollToHighlight(id) {
        let tries=0;
        const toast=document.createElement('div'); toast.id='rfhl-toast'; toast.textContent='탐색 중...'; document.body.appendChild(toast);
        const loop=setInterval(()=>{
            applyHighlightsToDOM();
            const t=document.querySelector(`mark[data-rfhl-id="${id}"]`);
            if(t){clearInterval(loop);toast.remove();t.scrollIntoView({behavior:'smooth',block:'center'});t.classList.add('flash');setTimeout(()=>t.classList.remove('flash'),1400);}
            else if(++tries>15){clearInterval(loop);toast.remove();customAlert('너무 오래된 대화이거나 삭제된 텍스트일 수 있어요.');}
            else{window.scrollTo(0,0);document.querySelectorAll('div').forEach(d=>{if(d.scrollHeight>d.clientHeight)d.scrollTop=0;});}
        },800);
    }

    function deleteHighlightData(id) {
        highlights=highlights.filter(h=>h.id!==id); saveHighlights();
        document.querySelectorAll(`mark[data-rfhl-id="${id}"]`).forEach(m=>m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
    }

    let ctxPressTimer;
    document.addEventListener('touchstart',e=>{if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-rfhl'))ctxPressTimer=setTimeout(()=>openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.rfhlId)),800);});
    document.addEventListener('touchend',  ()=>clearTimeout(ctxPressTimer));
    document.addEventListener('touchmove', ()=>clearTimeout(ctxPressTimer));
    window.addEventListener('contextmenu',e=>{if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-rfhl')){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.rfhlId));}},true);

    // ==========================================
    // 초기화 & MutationObserver
    // ==========================================
    renderSelectionBar(); renderEditBar(); renderPopupPalette(); loadHighlights();
    setTimeout(applyHighlightsToDOM, 1000);
    syncTheme();

    setInterval(()=>{
        injectToolbarButton();
        if(currentPath!==window.location.pathname){currentPath=window.location.pathname;loadHighlights();renderPopupList();applyHighlightsToDOM();}
    },500);

    // DOM 변경 감지 (형광펜 재적용용)
    const domObserver = new MutationObserver(mutations => {
        let shouldApply = false;
        mutations.forEach(m => { if (m.addedNodes.length > 0) shouldApply = true; });
        if (shouldApply) { clearTimeout(window.rfhlDebounce); window.rfhlDebounce = setTimeout(applyHighlightsToDOM, 400); }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    // 테마 전용 감지 — body 하위 div class 변경 감시 (로판AI는 내부 div로 테마 전환)
    const themeObserver = new MutationObserver(() => syncTheme());
    themeObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

})();

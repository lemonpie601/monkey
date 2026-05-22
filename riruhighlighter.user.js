// ==UserScript==
// @name         리루AI 형광펜
// @namespace    https://riru.ai/
// @version      2.3.2
// @description  리루AI 형광펜 노트 (모바일 최적화)
// @author       레몬파이
// @match        https://riru.ai/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`#hl-tooltip{display:none!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;}`);

    const P1 = '#8b5cf6';
    const P2 = '#a78bfa';

    const DEFAULT_COLORS = [
        { bg: '#a78bfa', text: '' },
        { bg: '#f472b6', text: '' },
        { bg: '#b2f0e8', text: '' },
        { bg: '#fcd34d', text: '' },
    ];
    const MAX_COLORS = 8;

    const getStorageKey = () => `HLP2_${window.location.pathname}`;
    const PALETTE_KEY   = 'HLP2_Palette';
    const POPUP_POS_KEY = 'HLP2_PopupPos';
    const OPACITY_KEY   = 'HLP2_Opacity';
    const BOLD_KEY      = 'HLP2_Bold';

    let currentPath = window.location.pathname;
    let highlights  = [];
    let savedSelectionRange = null;
    let savedSelectionText  = '';

    let paletteColors = JSON.parse(localStorage.getItem(PALETTE_KEY));
    if (!paletteColors) paletteColors = DEFAULT_COLORS;
    else paletteColors = paletteColors.map(c => typeof c === 'string' ? { bg: c, text: '' } : c);

    let highlightOpacity = parseFloat(localStorage.getItem(OPACITY_KEY) ?? '0.45');
    let highlightBold    = (localStorage.getItem(BOLD_KEY) ?? 'true') === 'true';
    document.documentElement.style.setProperty('--hlp-fw', highlightBold ? 'bold' : 'normal');

    let currentEditingId = null;

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

    function getIsDark() {
        return !!document.querySelector('button[title="라이트 모드"]');
    }

    // ==========================================
    // CSS — riru.ai 모달 스타일
    // ==========================================
    GM_addStyle(`
        /* ── 팝업: riru.ai 모달 스타일 ── */
        #hlp-popup {
            position: fixed;
            width: 288px;
            max-height: 580px;
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.08);
            box-shadow: 0 8px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06);
            background: #ffffff;
            color: #1a1a1a;
            z-index: 2147483640 !important;
            display: none; flex-direction: column; overflow: hidden;
            font-family: 'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
            font-size: 13px;
        }
        .hlp-dark-mode#hlp-popup {
            background: #1e1e1e;
            color: rgba(255,255,255,0.87);
            border-color: rgba(255,255,255,0.07);
            box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
        }

        /* ── 선택/편집 바 ── */
        #hlp-selection-bar, #hlp-edit-bar {
            position: absolute; display: none;
            background: #ffffff;
            border: 1px solid rgba(0,0,0,0.08);
            padding: 8px 12px; border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.12);
            z-index: 2147483641 !important; gap: 8px; align-items: center;
        }

        @media (max-width: 640px) {
            #hlp-selection-bar, #hlp-edit-bar {
                position: fixed !important;
                left: 50% !important;
                top: auto !important;
                bottom: 90px !important;
                transform: translateX(-50%) !important;
                border-radius: 24px !important;
                padding: 10px 16px !important;
                gap: 12px !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
                white-space: nowrap;
                touch-action: none;
            }
            #hlp-selection-bar .hlp-color-btn,
            #hlp-edit-bar .hlp-color-btn {
                width: 36px !important;
                height: 36px !important;
                border-width: 2px !important;
            }
        }

        /* ── 오버레이 ── */
        #hlp-reset-overlay, #hlp-custom-alert {
            position: fixed; inset: 0; background: rgba(0,0,0,0.4);
            z-index: 2147483642 !important; display: none;
            justify-content: center; align-items: center;
            backdrop-filter: blur(4px); font-family: 'Pretendard',sans-serif;
        }

        /* ── 컨텍스트 메뉴 ── */
        #hlp-context-menu {
            position: absolute; display: none;
            background: #ffffff; border: 1px solid rgba(0,0,0,0.08);
            padding: 12px 14px; border-radius: 12px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.12);
            z-index: 2147483644 !important; flex-direction: column; gap: 10px;
            font-family: 'Pretendard',sans-serif;
        }

        /* ── 컬러 버튼 ── */
        .hlp-color-btn {
            width: 22px; height: 22px; border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.9);
            cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
            flex-shrink: 0; box-sizing: border-box;
            box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        }
        .hlp-color-btn:hover { transform: scale(1.25); box-shadow: 0 0 0 2.5px ${P1}55; }

        /* ── 공통 버튼 ── */
        .hlp-ctx-text  { color: rgba(0,0,0,0.6); font-size: 12px; font-weight: 600; text-align: center; }
        .hlp-dark-mode .hlp-ctx-text { color: rgba(255,255,255,0.6); }
        .hlp-ctx-actions { display: flex; gap: 8px; justify-content: center; }
        .hlp-ctx-btn {
            padding: 7px 16px; border: none; border-radius: 8px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .hlp-ctx-cancel { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.5); }
        .hlp-ctx-cancel:hover { background: rgba(0,0,0,0.1); }
        .hlp-ctx-delete { background: rgba(139,92,246,0.1); color: ${P1}; }
        .hlp-ctx-delete:hover { background: ${P1}; color: #fff; }

        /* ── 모달 박스 ── */
        .hlp-alert-box {
            background: #fff; border: 1px solid rgba(0,0,0,0.08);
            padding: 24px 28px; border-radius: 16px; text-align: center; max-width: 300px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15);
        }
        .hlp-reset-box {
            background: #fff; border: 1px solid rgba(139,92,246,0.2);
            padding: 28px; border-radius: 16px; text-align: center; max-width: 320px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.15);
        }

        /* ── 팝업 헤더 — riru.ai 모달 헤더 스타일 ── */
        .hlp-popup-header {
            padding: 12px 16px 10px;
            border-bottom: 1px solid rgba(0,0,0,0.06);
            display: flex; justify-content: space-between; align-items: center;
            cursor: grab; user-select: none;
        }
        .hlp-dark-mode .hlp-popup-header { border-bottom-color: rgba(255,255,255,0.06); }
        .hlp-popup-header:active { cursor: grabbing; }

        .hlp-header-title {
            display: flex; align-items: center; gap: 10px;
        }
        .hlp-header-main-title {
            font-size: 13px; font-weight: 700;
            color: #111; letter-spacing: -0.2px;
        }
        .hlp-dark-mode .hlp-header-main-title { color: rgba(255,255,255,0.9); }
        .hlp-header-count {
            font-size: 11px; font-weight: 600;
            color: ${P1}; background: rgba(139,92,246,0.1);
            border-radius: 20px; padding: 2px 8px;
            border: 1px solid rgba(139,92,246,0.18);
        }
        .hlp-header-actions { display: flex; gap: 2px; align-items: center; }

        /* ── 아이콘 버튼 ── */
        .hlp-icon-btn {
            background: none; border: none; font-size: 13px; cursor: pointer;
            color: rgba(0,0,0,0.35); padding: 0; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 8px; transition: 0.15s;
        }
        .hlp-dark-mode .hlp-icon-btn { color: rgba(255,255,255,0.35); }
        .hlp-icon-btn:hover { color: ${P1}; background: rgba(139,92,246,0.08); }
        .hlp-bold-active {
            background: rgba(139,92,246,0.1) !important;
            color: ${P1} !important;
        }

        /* ── 슬라이더 ── */
        #hlp-opacity-slider {
            width: 52px; height: 3px; border-radius: 2px;
            appearance: none; background: rgba(0,0,0,0.1); outline: none; cursor: pointer;
        }
        .hlp-dark-mode #hlp-opacity-slider { background: rgba(255,255,255,0.12); }
        #hlp-opacity-slider::-webkit-slider-thumb {
            appearance: none; width: 12px; height: 12px;
            border-radius: 50%; background: ${P1};
            box-shadow: 0 1px 4px rgba(139,92,246,0.4);
            cursor: pointer; transition: 0.15s;
        }
        #hlp-opacity-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }

        /* ── 바디 ── */
        .hlp-popup-body { display: flex; flex-direction: column; overflow: hidden; flex: 1; }

        /* ── 섹션 ── */
        .hlp-sec { padding: 8px 14px; border-bottom: 1px solid rgba(0,0,0,0.05); }
        .hlp-dark-mode .hlp-sec { border-bottom-color: rgba(255,255,255,0.05); }

        .hlp-sec-label {
            font-size: 10px; font-weight: 700; letter-spacing: 0.8px;
            text-transform: uppercase; color: rgba(0,0,0,0.35); margin-bottom: 8px;
        }
        .hlp-dark-mode .hlp-sec-label { color: rgba(255,255,255,0.3); }

        /* ── 팔레트 ── */
        .hlp-palette-wrap { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .hlp-color-add {
            width: 22px; height: 22px; border-radius: 50%;
            background: rgba(0,0,0,0.04); border: 1.5px dashed rgba(0,0,0,0.2);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: rgba(0,0,0,0.3); font-size: 14px; line-height: 1;
            transition: 0.15s; box-sizing: border-box;
        }
        .hlp-dark-mode .hlp-color-add { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.3); }
        .hlp-color-add:hover { border-color: ${P1}; color: ${P1}; background: rgba(139,92,246,0.06); }

        /* ── 색상 피커 ── */
        .hlp-picker-ui {
            display: none; flex-direction: column; gap: 9px;
            background: rgba(0,0,0,0.03); padding: 10px 12px;
            border-radius: 10px; border: 1px solid rgba(0,0,0,0.06);
            margin-top: 10px; font-size: 12px;
        }
        .hlp-dark-mode .hlp-picker-ui { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.07); }
        .hlp-picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .hlp-picker-label { display: flex; align-items: center; gap: 7px; cursor: pointer; color: rgba(0,0,0,0.65); }
        .hlp-dark-mode .hlp-picker-label { color: rgba(255,255,255,0.65); }
        .hlp-color-input { width: 22px; height: 22px; padding: 0; border: none; cursor: pointer; border-radius: 6px; }
        .hlp-picker-preview { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.08); flex-shrink: 0; }
        .hlp-add-btn {
            flex: 1; background: ${P1}; color: #fff;
            border: none; padding: 7px 12px; border-radius: 8px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .hlp-add-btn:hover { background: #7c3aed; }

        /* ── 검색 ── */
        .hlp-search-wrap {
            display: flex; align-items: center; gap: 7px;
            background: rgba(0,0,0,0.04); border: 1.5px solid transparent;
            border-radius: 10px; padding: 0 12px;
            transition: border-color 0.15s, background 0.15s;
        }
        .hlp-dark-mode .hlp-search-wrap { background: rgba(255,255,255,0.05); }
        .hlp-search-wrap:focus-within { border-color: ${P1}; background: rgba(139,92,246,0.04); }
        .hlp-search-icon { color: rgba(0,0,0,0.25); font-size: 14px; flex-shrink: 0; }
        .hlp-dark-mode .hlp-search-icon { color: rgba(255,255,255,0.25); }
        .hlp-search-input {
            flex: 1; padding: 6px 0; border: none; background: transparent;
            color: rgba(0,0,0,0.8); font-size: 12.5px; outline: none;
        }
        .hlp-dark-mode .hlp-search-input { color: rgba(255,255,255,0.8); }
        .hlp-search-input::placeholder { color: rgba(0,0,0,0.28); }
        .hlp-dark-mode .hlp-search-input::placeholder { color: rgba(255,255,255,0.28); }

        /* ── 리스트 ── */
        .hlp-list-sec { flex: 1; overflow-y: auto; padding:4px 10px 10px; }
        .hlp-list-sec::-webkit-scrollbar { width: 3px; }
        .hlp-list-sec::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }
        .hlp-dark-mode .hlp-list-sec::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); }

        .hlp-empty {
            text-align: center; color: rgba(0,0,0,0.3);
            margin-top: 32px; font-size: 12.5px; line-height: 2;
        }
        .hlp-dark-mode .hlp-empty { color: rgba(255,255,255,0.25); }

        /* ── 아이템 ── */
        .hlp-item {
            display: flex; flex-direction: column; gap: 6px;
            padding: 7px 8px;
            border-radius: 10px;
            margin-bottom: 1px;
            cursor: pointer;
            transition: background 0.12s;
            background: transparent;
        }
        .hlp-item:hover { background: rgba(139,92,246,0.05); }
        .hlp-dark-mode .hlp-item:hover { background: rgba(139,92,246,0.08); }

        .hlp-item-top { display: flex; align-items: flex-start; gap: 9px; }
        .hlp-item-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
        .hlp-item-body { flex: 1; min-width: 0; }
        .hlp-item-text {
            font-size: 13px; font-weight: 500; line-height: 1.45;
            color: rgba(0,0,0,0.8); word-break: break-all;
            display: -webkit-box; -webkit-line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden;
        }
        .hlp-dark-mode .hlp-item-text { color: rgba(255,255,255,0.82); }
        .hlp-item-del {
            background: none; border: none; cursor: pointer;
            color: rgba(0,0,0,0.2); font-size: 11px; padding: 0;
            width: 20px; height: 20px; display: flex;
            align-items: center; justify-content: center;
            border-radius: 6px; flex-shrink: 0; transition: 0.15s; margin-top: 1px;
        }
        .hlp-dark-mode .hlp-item-del { color: rgba(255,255,255,0.2); }
        .hlp-item-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }

        .hlp-note-input {
            width: 100%; padding: 5px 8px;
            border: 1px solid rgba(0,0,0,0.08);
            border-radius: 7px; background: rgba(0,0,0,0.02);
            color: rgba(0,0,0,0.4); font-size: 11.5px; outline: none;
            box-sizing: border-box; transition: 0.15s; font-family: inherit;
        }
        .hlp-dark-mode .hlp-note-input { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.35); }
        .hlp-note-input:focus {
            border-color: ${P1}88; background: rgba(139,92,246,0.03);
            color: rgba(0,0,0,0.75);
        }
        .hlp-dark-mode .hlp-note-input:focus { color: rgba(255,255,255,0.8); background: rgba(139,92,246,0.06); }
        .hlp-note-input:not(:placeholder-shown) { color: rgba(0,0,0,0.65); border-color: rgba(0,0,0,0.1); }
        .hlp-dark-mode .hlp-note-input:not(:placeholder-shown) { color: rgba(255,255,255,0.65); }

        /* ── 구분선 ── */
        .hlp-divider {
            display: flex; align-items: center; gap: 8px;
            padding: 4px 4px 2px;
        }
        .hlp-divider-label {
            font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
            text-transform: uppercase; color: rgba(0,0,0,0.3); white-space: nowrap;
        }
        .hlp-dark-mode .hlp-divider-label { color: rgba(255,255,255,0.25); }
        .hlp-divider-line { flex: 1; height: 1px; background: rgba(0,0,0,0.06); }
        .hlp-dark-mode .hlp-divider-line { background: rgba(255,255,255,0.07); }

        /* ── mark ── */
        mark.custom-hlp {
            font-weight: var(--hlp-fw, bold);
            padding: 1px 0; cursor: pointer;
            -webkit-box-decoration-break: clone; box-decoration-break: clone;
            transition: opacity 0.2s;
        }
        mark.custom-hlp.hlp-start { border-top-left-radius: 3px; border-bottom-left-radius: 3px; padding-left: 2px; }
        mark.custom-hlp.hlp-end   { border-top-right-radius: 3px; border-bottom-right-radius: 3px; padding-right: 2px; }
        mark.custom-hlp:hover     { opacity: 0.72; }
        mark.custom-hlp.flash     { animation: hlpFlash 1.4s ease; }
        @keyframes hlpFlash {
            0%,100% { box-shadow: none; }
            30%,70% { box-shadow: 0 0 0 2px ${P1}; }
        }

        /* ── 모바일 오버레이 ── */
        #hlp-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.3); z-index: 2147483639 !important;
        }
        #hlp-overlay.show { display: block; }

        @media (max-width: 640px) {
            #hlp-toolbar-btn .hlp-btn-label { display: none; }
            #hlp-popup {
                position: fixed !important;
                left: 0 !important; right: 0 !important;
                bottom: 0 !important; top: auto !important;
                width: 100% !important; max-width: 100% !important;
                max-height: 85vh !important;
                border-radius: 20px 20px 0 0 !important;
                border-bottom: none !important;
            }
            #hlp-popup::before {
                content: '';
                display: block;
                width: 36px; height: 4px;
                background: rgba(0,0,0,0.1);
                border-radius: 2px;
                margin: 10px auto 0;
                flex-shrink: 0;
            }
            .hlp-dark-mode#hlp-popup::before { background: rgba(255,255,255,0.15); }
            .hlp-popup-header { cursor: default !important; }
        }

        /* ── 토스트 ── */
        #hlp-toast {
            position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
            background: rgba(17,17,17,0.88); color: rgba(255,255,255,0.9);
            padding: 9px 18px; border-radius: 10px;
            z-index: 2147483647; font-size: 12px; font-weight: 600;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            font-family: 'Pretendard',sans-serif;
        }
    `);

    // ==========================================
    // UI 생성
    // ==========================================
    const selectionBar = document.createElement('div');
    selectionBar.id = 'hlp-selection-bar';
    document.body.appendChild(selectionBar);

    const editBar = document.createElement('div');
    editBar.id = 'hlp-edit-bar';
    document.body.appendChild(editBar);

    function preventDefaultTouch(e) { e.preventDefault(); }

    function renderSelectionBar() {
        selectionBar.innerHTML = '';
        selectionBar.addEventListener('mousedown', preventDefaultTouch);
        selectionBar.addEventListener('touchstart', preventDefaultTouch, { passive: false });
        paletteColors.forEach(colorObj => {
            const btn = document.createElement('div');
            btn.className = 'hlp-color-btn';
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
            btn.className = 'hlp-color-btn';
            btn.style.background = colorObj.text ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)` : colorObj.bg;
            btn.title = '이 색상으로 변경';
            btn.addEventListener('click', e => { e.stopPropagation(); changeHighlightColor(colorObj); });
            btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); changeHighlightColor(colorObj); });
            editBar.appendChild(btn);
        });
    }

    // 알림
    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'hlp-custom-alert';
    alertOverlay.innerHTML = `<div class="hlp-alert-box"><p id="hlp-alert-msg" style="margin:0 0 18px;color:rgba(0,0,0,0.7);font-size:13px;line-height:1.6;word-break:keep-all;"></p><button id="hlp-alert-ok" class="hlp-ctx-btn hlp-ctx-cancel" style="padding:7px 22px;">확인</button></div>`;
    document.body.appendChild(alertOverlay);
    function customAlert(msg) { document.getElementById('hlp-alert-msg').innerHTML = msg; alertOverlay.style.display = 'flex'; }
    document.getElementById('hlp-alert-ok').onclick = () => alertOverlay.style.display = 'none';

    // 컨텍스트 메뉴
    const ctxMenu = document.createElement('div');
    ctxMenu.id = 'hlp-context-menu';
    ctxMenu.innerHTML = `<div class="hlp-ctx-text" id="hlp-ctx-text">삭제할까요?</div><div class="hlp-ctx-actions"><button class="hlp-ctx-btn hlp-ctx-cancel" id="hlp-ctx-cancel">취소</button><button class="hlp-ctx-btn hlp-ctx-delete" id="hlp-ctx-delete">삭제</button></div>`;
    document.body.appendChild(ctxMenu);

    let ctxCallback = null;
    function openContextMenu(e, text, callback) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        document.getElementById('hlp-ctx-text').innerText = text;
        ctxCallback = callback; ctxMenu.style.display = 'flex';
        const px = e.pageX || e.changedTouches?.[0]?.pageX || 0;
        const py = e.pageY || e.changedTouches?.[0]?.pageY || 0;
        ctxMenu.style.left = `${px+5}px`; ctxMenu.style.top = `${py+5}px`;
    }
    document.getElementById('hlp-ctx-cancel').onclick = () => { ctxMenu.style.display='none'; ctxCallback=null; };
    document.getElementById('hlp-ctx-delete').onclick = () => { ctxCallback?.(); ctxMenu.style.display='none'; ctxCallback=null; };
    document.addEventListener('click',      e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });
    document.addEventListener('touchstart', e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });

    // 초기화 모달
    const resetOverlay = document.createElement('div');
    resetOverlay.id = 'hlp-reset-overlay';
    resetOverlay.innerHTML = `<div class="hlp-reset-box"><div style="font-size:28px;margin-bottom:10px;">⚠️</div><p style="margin:0 0 6px;color:rgba(0,0,0,0.85);font-size:15px;font-weight:700;">모든 데이터를 초기화할까요?</p><p style="margin:0 0 20px;color:rgba(0,0,0,0.4);font-size:12px;line-height:1.6;">형광펜 노트와 커스텀 색상이<br>영구적으로 삭제됩니다.</p><div style="display:flex;justify-content:center;gap:10px;"><button id="hlp-reset-cancel" class="hlp-ctx-btn hlp-ctx-cancel">취소</button><button id="hlp-reset-confirm" class="hlp-ctx-btn hlp-ctx-delete">초기화</button></div></div>`;
    document.body.appendChild(resetOverlay);
    document.getElementById('hlp-reset-cancel').onclick  = () => resetOverlay.style.display='none';
    document.getElementById('hlp-reset-confirm').onclick = () => {
        Object.keys(localStorage).forEach(k => { if(k.startsWith('HLP2_')) localStorage.removeItem(k); });
        highlights=[]; paletteColors=[...DEFAULT_COLORS];
        document.querySelectorAll('mark.custom-hlp').forEach(m => m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
        renderPopupPalette(); renderSelectionBar(); renderEditBar(); renderPopupList();
        resetOverlay.style.display='none';
    };

    // 모바일 오버레이
    const hlpOverlay = document.createElement('div');
    hlpOverlay.id = 'hlp-overlay';
    hlpOverlay.addEventListener('click', () => { popup.style.display = 'none'; hlpOverlay.classList.remove('show'); });
    document.body.appendChild(hlpOverlay);

    function hlpIsMobile() { return window.innerWidth <= 640; }

    function hlpOpenPopup() {
        if (hlpIsMobile()) {
            hlpOverlay.classList.add('show');
            popup.style.left = ''; popup.style.top = '';
        } else {
            hlpOverlay.classList.remove('show');
            const sp = JSON.parse(localStorage.getItem(POPUP_POS_KEY));
            if (sp) { popup.style.left=sp.left; popup.style.top=sp.top; }
            else { popup.style.left='20px'; popup.style.top='80px'; }
        }
        popup.style.display = 'flex';
        renderPopupList();
    }

    function hlpClosePopup() {
        popup.style.display = 'none';
        hlpOverlay.classList.remove('show');
    }

    // ── 메인 팝업 ────────────────────────────────
    const popup = document.createElement('div');
    popup.id = 'hlp-popup';
    popup.innerHTML = `
        <div class="hlp-popup-header">
            <div class="hlp-header-title">
                <span class="hlp-header-main-title">형광펜 노트</span>
                <span class="hlp-header-count" id="hlp-header-count">0</span>
            </div>
            <div class="hlp-header-actions">
                <input type="range" id="hlp-opacity-slider" min="0" max="1" step="0.05" value="0.45" title="투명도">
                <button class="hlp-icon-btn ${highlightBold?'hlp-bold-active':''}" id="hlp-bold-btn" title="볼드체" style="font-weight:800;font-family:serif;font-size:13px;">B</button>
                <button class="hlp-icon-btn" id="hlp-reset-btn" title="초기화" style="font-size:15px;">↺</button>
                <button class="hlp-icon-btn" id="hlp-close-btn" title="닫기" style="font-size:13px;">✕</button>
            </div>
        </div>
        <div class="hlp-popup-body">
            <div class="hlp-sec">
                <div class="hlp-sec-label">Colors</div>
                <div class="hlp-palette-wrap" id="hlp-palette-container"></div>
                <div class="hlp-picker-ui" id="hlp-color-picker-ui">
                    <div class="hlp-picker-row">
                        <label class="hlp-picker-label">BG <input type="color" class="hlp-color-input" id="hlp-new-bg" value="#a78bfa"></label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:inherit;flex:1;">
                            <input type="checkbox" id="hlp-keep-text" checked style="accent-color:${P1};"> 원본 글자색
                        </label>
                        <div id="hlp-new-preview" class="hlp-picker-preview" style="background:#a78bfa;"></div>
                    </div>
                    <div id="hlp-text-color-label" style="display:none;">
                        <label class="hlp-picker-label">Text <input type="color" class="hlp-color-input" id="hlp-new-text" value="#333333"></label>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button id="hlp-confirm-add-color" class="hlp-add-btn">추가</button>
                    </div>
                </div>
            </div>
            <div class="hlp-sec" style="padding-top:10px;padding-bottom:10px;">
                <div class="hlp-search-wrap">
                    <span class="hlp-search-icon">⌕</span>
                    <input type="text" id="hlp-search" class="hlp-search-input" placeholder="내용 또는 메모 검색">
                </div>
            </div>
            <div class="hlp-list-sec" id="hlp-list"></div>
        </div>`;
    document.body.appendChild(popup);

    popup.querySelector('#hlp-bold-btn').onclick = () => {
        highlightBold = !highlightBold;
        localStorage.setItem(BOLD_KEY, highlightBold);
        document.documentElement.style.setProperty('--hlp-fw', highlightBold ? 'bold' : 'normal');
        popup.querySelector('#hlp-bold-btn').classList.toggle('hlp-bold-active', highlightBold);
    };

    const bgInput = document.getElementById('hlp-new-bg');
    const txInput = document.getElementById('hlp-new-text');
    const keepCb  = document.getElementById('hlp-keep-text');
    const txLabel = document.getElementById('hlp-text-color-label');
    const preview = document.getElementById('hlp-new-preview');
    const updatePreview = () => {
        const bg = bgInput.value, tx = keepCb.checked ? '' : txInput.value;
        preview.style.background = tx ? `linear-gradient(135deg,${bg} 50%,${tx} 50%)` : bg;
    };
    keepCb.onchange = () => { txLabel.style.display = keepCb.checked ? 'none' : 'block'; updatePreview(); };
    bgInput.addEventListener('input', updatePreview); txInput.addEventListener('input', updatePreview);
    document.getElementById('hlp-confirm-add-color').onclick = () => {
        if (paletteColors.length >= MAX_COLORS) { customAlert('최대 8개까지 추가할 수 있어요.'); return; }
        paletteColors.push({ bg: bgInput.value, text: keepCb.checked ? '' : txInput.value });
        savePalette(); document.getElementById('hlp-color-picker-ui').style.display = 'none';
    };

    popup.querySelector('#hlp-close-btn').onclick = hlpClosePopup;
    popup.querySelector('#hlp-reset-btn').onclick = () => resetOverlay.style.display = 'flex';
    popup.querySelector('#hlp-search').addEventListener('input', e => renderPopupList(e.target.value.trim().toLowerCase()));

    const opSlider = popup.querySelector('#hlp-opacity-slider');
    opSlider.value = highlightOpacity;
    opSlider.addEventListener('input', e => {
        highlightOpacity = parseFloat(e.target.value);
        localStorage.setItem(OPACITY_KEY, highlightOpacity);
        document.querySelectorAll('mark.custom-hlp').forEach(mark => {
            const h = highlights.find(x => x.id === mark.dataset.hlpId);
            if (h) { mark.style.backgroundColor = hexToRgba(h.color.bg, highlightOpacity); mark.style.color = h.color.text || 'inherit'; }
        });
    });

    // 드래그
    const popupHeader = popup.querySelector('.hlp-popup-header');
    let isDragging=false, dragSX, dragSY, initL, initT;
    const dStart = e => {
        if (e.target.closest('.hlp-header-actions')) return;
        if (hlpIsMobile()) return;
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

    function renderPopupPalette() {
        const c = document.getElementById('hlp-palette-container');
        c.innerHTML = '';
        paletteColors.forEach((colorObj, idx) => {
            const btn = document.createElement('div');
            btn.className = 'hlp-color-btn';
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
            add.className='hlp-color-add'; add.innerHTML='+';
            add.onclick = () => { const ui=document.getElementById('hlp-color-picker-ui'); ui.style.display=ui.style.display==='flex'?'none':'flex'; };
            c.appendChild(add);
        } else {
            document.getElementById('hlp-color-picker-ui').style.display='none';
        }
    }

    // ==========================================
    // 툴바 버튼 주입 — riru.ai
    // ==========================================
    let hlpLastIsMobile = null;

    function applyToolbarBtnTheme() {
        const hlBtn = document.getElementById('hlp-toolbar-btn');
        if (!hlBtn) return;
        const isDark = getIsDark();
        const newBtn = hlBtn.cloneNode(true);
        hlBtn.parentNode.replaceChild(newBtn, hlBtn);
        newBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); togglePopup(); });
        if (isDark) {
            newBtn.style.background = '#252525';
            newBtn.style.color = 'rgba(255,255,255,0.6)';
            newBtn.addEventListener('mouseenter', () => { newBtn.style.color = P2; newBtn.style.background = '#2f2f2f'; });
            newBtn.addEventListener('mouseleave', () => { newBtn.style.color = 'rgba(255,255,255,0.6)'; newBtn.style.background = '#252525'; });
        } else {
            newBtn.style.background = '#eeebf2';
            newBtn.style.color = 'rgba(0,0,0,0.4)';
            newBtn.addEventListener('mouseenter', () => { newBtn.style.color = P1; newBtn.style.background = '#e4e0ea'; });
            newBtn.addEventListener('mouseleave', () => { newBtn.style.color = 'rgba(0,0,0,0.4)'; newBtn.style.background = '#eeebf2'; });
        }
    }

    function injectToolbarButton() {
        const mobile = hlpIsMobile();
        if (hlpLastIsMobile !== null && hlpLastIsMobile !== mobile) {
            document.getElementById('hlp-toolbar-btn')?.remove();
        }
        hlpLastIsMobile = mobile;
        if (document.getElementById('hlp-toolbar-btn')) return;

        // ── 위치 수정: 이미지/아이템/패키지/따옴표/별표 버튼이 있는 줄 찾기
        // "이미지 추가" 버튼이 포함된 flex 컨테이너를 타겟으로 함
        const imageBtn = document.querySelector('button[title="이미지 추가"]');
        if (!imageBtn) return;
        const btnGroup = imageBtn.parentElement;
        if (!btnGroup) return;

        const isDark = getIsDark();
        const hlBtn = document.createElement('button');
        hlBtn.id = 'hlp-toolbar-btn';
        hlBtn.type = 'button';
        hlBtn.title = '형광펜 노트 (Alt+H)';
        hlBtn.style.cssText = `
            cursor:pointer; border:none; padding:0;
            width:32px; height:32px; border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            transition:color 0.15s, background 0.15s;
            background:${isDark ? '#252525' : '#eeebf2'};
            color:${isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)'};
            flex-shrink:0;
        `;
        hlBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        hlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); togglePopup(); });
        if (isDark) {
            hlBtn.addEventListener('mouseenter', () => { hlBtn.style.color = P2; hlBtn.style.background = '#2f2f2f'; });
            hlBtn.addEventListener('mouseleave', () => { hlBtn.style.color = 'rgba(255,255,255,0.6)'; hlBtn.style.background = '#252525'; });
        } else {
            hlBtn.addEventListener('mouseenter', () => { hlBtn.style.color = P1; hlBtn.style.background = '#e4e0ea'; });
            hlBtn.addEventListener('mouseleave', () => { hlBtn.style.color = 'rgba(0,0,0,0.4)'; hlBtn.style.background = '#eeebf2'; });
        }

        // 이미지 추가 버튼 앞에 삽입
        btnGroup.insertBefore(hlBtn, imageBtn);
    }

    const togglePopup = () => {
        if (popup.style.display === 'flex') hlpClosePopup();
        else hlpOpenPopup();
    };
    document.addEventListener('keydown', e => { if(e.altKey&&e.key==='h'){e.preventDefault();togglePopup();} });

    // ==========================================
    // 테마 동기화
    // ==========================================
    function syncTheme() {
        const isDark = getIsDark();
        popup.classList.toggle('hlp-dark-mode', isDark);
        applyToolbarBtnTheme();
    }
    syncTheme();

    window.addEventListener('resize', () => {
        if (popup.style.display === 'flex') {
            if (hlpIsMobile()) {
                popup.style.left = ''; popup.style.top = '';
                hlpOverlay.classList.add('show');
            } else {
                hlpOverlay.classList.remove('show');
                const sp = JSON.parse(localStorage.getItem(POPUP_POS_KEY));
                if (sp) { popup.style.left=sp.left; popup.style.top=sp.top; }
            }
        }
    });

    // ==========================================
    // 텍스트 선택
    // ==========================================
    let mobileSelectionTimer = null;

    function onSelectionChange() {
        if (!hlpIsMobile()) return;
        clearTimeout(mobileSelectionTimer);
        mobileSelectionTimer = setTimeout(() => {
            const sel = window.getSelection();
            const text = sel?.toString().trim();
            if (text && text.length > 0 && sel.rangeCount > 0) {
                const anchorNode = sel.anchorNode;
                if (selectionBar.contains(anchorNode) || editBar.contains(anchorNode) ||
                    popup.contains(anchorNode) || ctxMenu.contains(anchorNode)) return;
                savedSelectionText = text.includes('\n') ? text.split('\n')[0].trim() : text;
                savedSelectionRange = sel.getRangeAt(0).cloneRange();
                selectionBar.style.display = 'flex';
                editBar.style.display = 'none';
                currentEditingId = null;
            }
        }, 300);
    }

    document.addEventListener('selectionchange', onSelectionChange);

    const handleSelectionEnd = e => {
        if (hlpIsMobile()) return;
        if (e.button !== 0) return;
        if ([selectionBar,editBar,popup,ctxMenu].some(el=>el.contains(e.target))) return;

        if (e.target.tagName==='MARK'&&e.target.classList.contains('custom-hlp')) {
            window.getSelection().removeAllRanges();
            selectionBar.style.display='none';
            currentEditingId = e.target.dataset.hlpId;
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
        if (hlpIsMobile()) return;
        if (!selectionBar.contains(e.target)) selectionBar.style.display='none';
        if (!editBar.contains(e.target)&&e.target.tagName!=='MARK') { editBar.style.display='none'; currentEditingId=null; }
    };

    document.addEventListener('touchend', e => {
        if (!hlpIsMobile()) return;
        const target = e.target;
        if (selectionBar.contains(target) || editBar.contains(target)) return;
        if (target.tagName === 'MARK' && target.classList.contains('custom-hlp')) {
            const sel = window.getSelection();
            if (!sel || sel.toString().trim().length === 0) {
                window.getSelection().removeAllRanges();
                selectionBar.style.display = 'none';
                savedSelectionText = ''; savedSelectionRange = null;
                currentEditingId = target.dataset.hlpId;
                editBar.style.display = 'flex';
                return;
            }
        }
        const sel = window.getSelection();
        if (!sel || sel.toString().trim().length === 0) {
            setTimeout(() => {
                const sel2 = window.getSelection();
                if (!sel2 || sel2.toString().trim().length === 0) {
                    if (!selectionBar.contains(document.activeElement) &&
                        !editBar.contains(document.activeElement)) {
                        selectionBar.style.display = 'none';
                        editBar.style.display = 'none';
                        currentEditingId = null;
                    }
                }
            }, 200);
        }
    });

    function positionBar(bar, e, sel) {
        let px = e.pageX || e.changedTouches?.[0]?.pageX;
        let py = e.pageY || e.changedTouches?.[0]?.pageY;
        if (!px&&sel?.rangeCount>0) { const r=sel.getRangeAt(0).getBoundingClientRect(); px=r.right+window.scrollX; py=r.bottom+window.scrollY; }
        bar.style.left=`${px+12}px`; bar.style.top=`${py+12}px`;
        const maxL=window.innerWidth-bar.offsetWidth-20;
        if(parseInt(bar.style.left)>maxL) bar.style.left=`${maxL+window.scrollX}px`;
    }

    document.addEventListener('mouseup',    handleSelectionEnd);
    document.addEventListener('mousedown',  handleSelectionStart);

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
            document.querySelectorAll(`mark[data-hlp-id="${currentEditingId}"]`).forEach(m=>{
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
            if (document.querySelector(`mark[data-hlp-id="${hl.id}"]`)) return;
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
                            mark.className='custom-hlp hlp-start hlp-end';
                            mark.setAttribute('role','button');
                            mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                            mark.style.color=hl.color.text||'inherit';
                            mark.dataset.hlpId=hl.id;
                            mark.title=hl.note?`메모: ${hl.note}`:'우클릭 삭제 / 클릭 색상 변경';
                            range.surroundContents(mark);
                            return;
                        }
                    }
                } catch(e) {}
            }
            applyByTextMatch(hl);
        });
    }

    function applyByTextMatch(hl) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        const textNodes=[]; let node;
        while(node=walker.nextNode()){
            const p=node.parentNode;
            if(!p||['SCRIPT','STYLE','TEXTAREA','INPUT','NOSCRIPT'].includes(p.nodeName)) continue;
            if(p.closest('#hlp-popup,#hlp-selection-bar,#hlp-edit-bar,#hlp-context-menu,#hlp-reset-overlay,#hlp-custom-alert')) continue;
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
        const nodes=map.filter(m=>m.end>mi&&m.start<me);
        nodes.reverse().forEach((m,i,arr)=>{
            const os=mi<m.start?0:getOrigIdx(mi-m.start,m.originalText,false);
            const oe=me>m.end?m.originalText.length:getOrigIdx(me-m.start,m.originalText,true);
            if(os<oe){
                const mark=document.createElement('mark');
                mark.className='custom-hlp';
                mark.setAttribute('role','button');
                if(i===arr.length-1) mark.classList.add('hlp-start');
                if(i===0)            mark.classList.add('hlp-end');
                mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                mark.style.color=hl.color.text||'inherit';
                mark.dataset.hlpId=hl.id;
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
        const list=document.getElementById('hlp-list');
        const countEl=document.getElementById('hlp-header-count');
        if(!list) return;
        list.innerHTML='';

        const filtered=highlights.filter(h=>h.text.toLowerCase().includes(q)||(h.note&&h.note.toLowerCase().includes(q)));
        if(countEl) countEl.textContent = highlights.length;

        if(filtered.length===0){
            list.innerHTML=`<div class="hlp-empty">${q?'검색 결과가 없습니다.':'텍스트를 드래그해서<br>색을 칠해보세요.'}</div>`;
            return;
        }

        const sorted = [...filtered].sort((a,b)=>b.timestamp-a.timestamp);
        const groups = {};
        sorted.forEach(hl => {
            const d = new Date(hl.timestamp);
            const today = new Date();
            let label;
            if (d.toDateString() === today.toDateString()) label = '오늘';
            else {
                const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
                label = d.toDateString()===yesterday.toDateString() ? '어제' : `${d.getMonth()+1}월 ${d.getDate()}일`;
            }
            if(!groups[label]) groups[label]=[];
            groups[label].push(hl);
        });

        Object.entries(groups).forEach(([label, items]) => {
            const divider = document.createElement('div');
            divider.className = 'hlp-divider';
            divider.innerHTML = `<span class="hlp-divider-label">${label}</span><span class="hlp-divider-line"></span>`;
            list.appendChild(divider);

            items.forEach(hl => {
                const item = document.createElement('div');
                item.className = 'hlp-item';
                const dot = hl.color.text ? `linear-gradient(135deg,${hl.color.bg} 50%,${hl.color.text} 50%)` : hl.color.bg;
                item.innerHTML = `
                    <div class="hlp-item-top">
                        <div class="hlp-item-dot" style="background:${dot};"></div>
                        <div class="hlp-item-body">
                            <div class="hlp-item-text">${hl.text}</div>
                        </div>
                        <button class="hlp-item-del" title="삭제">✕</button>
                    </div>
                    <input type="text" class="hlp-note-input" placeholder="메모..." value="${hl.note||''}">`;
                item.querySelector('.hlp-item-top').onclick = e => { if(e.target.tagName!=='BUTTON') scrollToHighlight(hl.id); };
                item.querySelector('.hlp-item-del').onclick = e => { e.stopPropagation(); deleteHighlightData(hl.id); };
                item.querySelector('.hlp-note-input').addEventListener('change', e => {
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
        toast.id='hlp-toast'; toast.textContent='탐색 중...';
        document.body.appendChild(toast);
        const loop=setInterval(()=>{
            applyHighlightsToDOM();
            const t=document.querySelector(`mark[data-hlp-id="${id}"]`);
            if(t){ clearInterval(loop); toast.remove(); t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('flash'); setTimeout(()=>t.classList.remove('flash'),1400); }
            else if(++tries>15){ clearInterval(loop); toast.remove(); customAlert('너무 오래된 대화이거나 삭제된 텍스트일 수 있어요.'); }
            else { window.scrollTo(0,0); document.querySelectorAll('div').forEach(d=>{if(d.scrollHeight>d.clientHeight)d.scrollTop=0;}); }
        },800);
    }

    function deleteHighlightData(id) {
        highlights=highlights.filter(h=>h.id!==id); saveHighlights();
        document.querySelectorAll(`mark[data-hlp-id="${id}"]`).forEach(m=>m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
    }

    let ctxPressTimer;
    document.addEventListener('touchstart', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-hlp')) ctxPressTimer=setTimeout(()=>openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.hlpId)),800); });
    document.addEventListener('touchend',  ()=>clearTimeout(ctxPressTimer));
    document.addEventListener('touchmove', ()=>clearTimeout(ctxPressTimer));
    window.addEventListener('contextmenu', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-hlp')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.hlpId)); } },true);

    // ==========================================
    // 초기화 & 감지
    // ==========================================
    renderSelectionBar(); renderEditBar(); renderPopupPalette(); loadHighlights();
    setTimeout(applyHighlightsToDOM, 1000);

    setInterval(()=>{
        injectToolbarButton();
        syncTheme();
        if(currentPath!==window.location.pathname){ currentPath=window.location.pathname; loadHighlights(); renderPopupList(); applyHighlightsToDOM(); }
    },500);

    const observer=new MutationObserver(mutations=>{
        let shouldApply=false;
        mutations.forEach(m=>{
            if(m.addedNodes.length>0) shouldApply=true;
            if(m.type==='attributes') syncTheme();
        });
        if(shouldApply){ clearTimeout(window.hlpDebounce); window.hlpDebounce=setTimeout(applyHighlightsToDOM,400); }
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','title']});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['class']});

})();

// ==UserScript==
// @name         케이브덕 형광펜
// @namespace    https://caveduck.io/
// @version      2.1.4
// @description  케이브덕 형광펜 노트
// @author       레몬파이
// @match        https://caveduck.io/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`#hl-tooltip{display:none!important;opacity:0!important;pointer-events:none!important;z-index:-9999!important;}`);

    // ==========================================
    // 케이브덕 포인트 컬러
    //   primary: #bc1e51 (빨강)
    //   sub:     #c9152f (진한 빨강)
    // ==========================================
    const P1 = '#bc1e51';
    const P2 = '#a61544';

    const DEFAULT_COLORS = [
        { bg: '#bc1e51' },
        { bg: '#f5a623' },
        { bg: '#5ac8fa' },
    ];
    const MAX_COLORS = 8;

    const getStorageKey = () => `CDHLP_${window.location.pathname}`;
    const PALETTE_KEY   = 'CDHLP_Palette';
    const POPUP_POS_KEY = 'CDHLP_PopupPos';
    const OPACITY_KEY   = 'CDHLP_Opacity';
    const BOLD_KEY      = 'CDHLP_Bold';

    let currentPath = window.location.pathname;
    let highlights  = [];
    let savedSelectionRange = null;
    let savedSelectionText  = '';

    let paletteColors = JSON.parse(localStorage.getItem(PALETTE_KEY));
    if (!paletteColors) paletteColors = DEFAULT_COLORS;
    else paletteColors = paletteColors.map(c => typeof c === 'string' ? { bg: c, text: '' } : c);

    let highlightOpacity = parseFloat(localStorage.getItem(OPACITY_KEY) ?? '0.45');
    let highlightBold    = (localStorage.getItem(BOLD_KEY) ?? 'true') === 'true';
    document.documentElement.style.setProperty('--cdhlp-fw', highlightBold ? 'bold' : 'normal');

    let currentEditingId = null;

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
    // CSS — 케이브덕 UI 스타일
    // 배경:   #1c1c1e (메인), #2a2a2d (서피스), #323235 (호버)
    // 포인트: #bc1e51 (red primary)
    // 텍스트: #ffffff, rgba(255,255,255,0.5) muted
    // 모양:   border-radius 6px~10px, 각진 느낌
    // ==========================================
    GM_addStyle(`
        /* ── 팝업 전체 ── */
        #cdhlp-popup {
            position: fixed;
            width: 360px;
            max-height: 640px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.06);
            box-shadow: 0 12px 40px rgba(0,0,0,0.6);
            background: #1c1c1e;
            color: #fff;
            z-index: 2147483640 !important;
            display: none; flex-direction: column; overflow: hidden;
            font-family: 'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
            font-size: 13px;
        }

        /* ── 선택/편집 바 ── */
        #cdhlp-selection-bar, #cdhlp-edit-bar {
            position: absolute; display: none;
            background: #2a2a2d;
            padding: 7px 10px; border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            z-index: 2147483641 !important; gap: 7px; align-items: center;
        }

        /* ── 오버레이 ── */
        #cdhlp-reset-overlay, #cdhlp-custom-alert {
            position: fixed; inset: 0; background: rgba(0,0,0,0.7);
            z-index: 2147483642 !important; display: none;
            justify-content: center; align-items: center;
            font-family: 'Pretendard',sans-serif;
        }

        /* ── 컨텍스트 메뉴 ── */
        #cdhlp-context-menu {
            position: absolute; display: none;
            background: #2a2a2d;
            padding: 12px 14px; border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 8px 28px rgba(0,0,0,0.6);
            z-index: 2147483644 !important; flex-direction: column; gap: 10px;
            font-family: 'Pretendard',sans-serif;
        }

        /* ── 컬러 버튼 ── */
        .cdhlp-color-btn {
            width: 22px; height: 22px; border-radius: 4px;
            border: 1.5px solid rgba(255,255,255,0.15);
            cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
            flex-shrink: 0; box-sizing: border-box;
        }
        .cdhlp-color-btn:hover { transform: scale(1.2); box-shadow: 0 0 0 2px rgba(229,25,58,0.5); }

        /* ── 공통 버튼 ── */
        .cdhlp-ctx-text  { color: rgba(255,255,255,0.6); font-size: 12px; font-weight: 600; text-align: center; }
        .cdhlp-ctx-actions { display: flex; gap: 8px; justify-content: center; }
        .cdhlp-ctx-btn {
            padding: 6px 16px; border: none; border-radius: 6px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .cdhlp-ctx-cancel { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
        .cdhlp-ctx-cancel:hover { background: rgba(255,255,255,0.14); color: #fff; }
        .cdhlp-ctx-delete { background: rgba(188,30,81,0.18); color: ${P1}; }
        .cdhlp-ctx-delete:hover { background: ${P1}; color: #fff; }

        /* ── 모달 박스 ── */
        .cdhlp-alert-box {
            background: #2a2a2d; border: 1px solid rgba(255,255,255,0.08);
            padding: 24px 28px; border-radius: 10px; text-align: center; max-width: 300px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
        }
        .cdhlp-reset-box {
            background: #2a2a2d; border: 1px solid rgba(188,30,81,0.25);
            padding: 28px; border-radius: 10px; text-align: center; max-width: 320px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
        }

        /* ── 팝업 헤더 ── */
        .cdhlp-popup-header {
            padding: 12px 14px 10px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            display: flex; justify-content: space-between; align-items: center;
            cursor: grab; user-select: none;
            background: #222224;
        }
        .cdhlp-popup-header:active { cursor: grabbing; }

        /* 헤더 타이틀 */
        .cdhlp-header-title { display: flex; align-items: center; gap: 8px; }
        .cdhlp-header-badge {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 13px; font-weight: 700; color: #fff;
        }
        .cdhlp-badge-dot {
            width: 7px; height: 7px; border-radius: 2px;
            background: ${P1};
            flex-shrink: 0;
        }
        .cdhlp-header-count {
            font-size: 11px; font-weight: 600;
            color: ${P1}; background: rgba(188,30,81,0.12);
            border-radius: 4px; padding: 2px 7px;
            border: 1px solid rgba(188,30,81,0.2);
        }
        .cdhlp-header-actions { display: flex; gap: 2px; align-items: center; }

        /* ── 아이콘 버튼 ── */
        .cdhlp-icon-btn {
            background: none; border: none; font-size: 13px; cursor: pointer;
            color: rgba(255,255,255,0.35); padding: 0; line-height: 1;
            display: flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 6px; transition: 0.15s;
        }
        .cdhlp-icon-btn:hover { color: #fff; background: rgba(255,255,255,0.08); }
        .cdhlp-bold-active {
            background: rgba(188,30,81,0.15) !important;
            color: ${P1} !important;
            border: 1px solid rgba(188,30,81,0.25) !important;
        }

        /* ── 슬라이더 ── */
        #cdhlp-opacity-slider {
            width: 52px; height: 3px; border-radius: 2px;
            appearance: none; background: rgba(255,255,255,0.12); outline: none; cursor: pointer;
        }
        #cdhlp-opacity-slider::-webkit-slider-thumb {
            appearance: none; width: 12px; height: 12px;
            border-radius: 50%; background: #fff;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
            cursor: pointer; transition: 0.15s;
        }
        #cdhlp-opacity-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }

        /* ── 바디 ── */
        .cdhlp-popup-body { display: flex; flex-direction: column; overflow: hidden; flex: 1; }

        /* ── 섹션 ── */
        .cdhlp-sec { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.05); }

        /* ── 섹션 레이블 ── */
        .cdhlp-sec-label {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.9px;
            text-transform: uppercase; color: rgba(255,255,255,0.3); margin-bottom: 9px;
        }

        /* ── 팔레트 ── */
        .cdhlp-palette-wrap { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
        .cdhlp-color-add {
            width: 22px; height: 22px; border-radius: 4px;
            background: rgba(255,255,255,0.05); border: 1.5px dashed rgba(255,255,255,0.2);
            display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: rgba(255,255,255,0.35); font-size: 14px; line-height: 1;
            transition: 0.15s; box-sizing: border-box;
        }
        .cdhlp-color-add:hover { border-color: ${P1}; color: ${P1}; background: rgba(188,30,81,0.08); }

        /* ── 색상 피커 UI ── */
        .cdhlp-picker-ui {
            display: none; flex-direction: column; gap: 9px;
            background: rgba(255,255,255,0.03); padding: 10px 12px;
            border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);
            margin-top: 9px; font-size: 12px;
        }
        .cdhlp-picker-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .cdhlp-picker-label { display: flex; align-items: center; gap: 7px; cursor: pointer; color: rgba(255,255,255,0.6); }
        .cdhlp-color-input { width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; border-radius: 4px; }
        .cdhlp-picker-preview { width: 28px; height: 28px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); flex-shrink: 0; }
        .cdhlp-add-btn {
            flex: 1; background: ${P1}; color: #fff;
            border: none;
            padding: 6px 12px; border-radius: 6px;
            font-size: 12px; font-weight: 600; cursor: pointer; transition: 0.15s;
        }
        .cdhlp-add-btn:hover { background: ${P2}; }

        /* ── 검색 ── */
        .cdhlp-search-wrap {
            display: flex; align-items: center; gap: 7px;
            background: #2a2a2d; border: 1px solid rgba(255,255,255,0.07);
            border-radius: 6px; padding: 0 10px;
            transition: border-color 0.15s;
        }
        .cdhlp-search-wrap:focus-within { border-color: rgba(229,25,58,0.5); }
        .cdhlp-search-icon { color: rgba(255,255,255,0.25); font-size: 14px; flex-shrink: 0; }
        .cdhlp-search-input {
            flex: 1; padding: 8px 0; border: none; background: transparent;
            color: #fff; font-size: 12.5px; outline: none;
        }
        .cdhlp-search-input::placeholder { color: rgba(255,255,255,0.25); }

        /* ── 리스트 ── */
        .cdhlp-list-sec { flex: 1; overflow-y: auto; padding: 8px 10px 12px; }
        .cdhlp-list-sec::-webkit-scrollbar { width: 3px; }
        .cdhlp-list-sec::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

        .cdhlp-empty {
            text-align: center; color: rgba(255,255,255,0.25);
            margin-top: 32px; font-size: 12px; line-height: 2;
        }

        /* ── 아이템 ── */
        .cdhlp-item {
            display: flex; flex-direction: column; gap: 5px;
            padding: 8px 10px;
            border-radius: 6px;
            margin-bottom: 3px;
            cursor: pointer;
            transition: background 0.12s;
            background: transparent;
        }
        .cdhlp-item:hover { background: #2a2a2d; }

        .cdhlp-item-top { display: flex; align-items: flex-start; gap: 8px; }
        .cdhlp-item-dot { width: 8px; height: 8px; border-radius: 2px; margin-top: 3.5px; flex-shrink: 0; }
        .cdhlp-item-body { flex: 1; min-width: 0; }
        .cdhlp-item-text {
            font-size: 12.5px; font-weight: 500; line-height: 1.4;
            color: rgba(255,255,255,0.85); word-break: break-all;
            display: -webkit-box; -webkit-line-clamp: 2;
            -webkit-box-orient: vertical; overflow: hidden;
        }
        .cdhlp-item-del {
            background: none; border: none; cursor: pointer;
            color: rgba(255,255,255,0.2); font-size: 11px; padding: 0;
            width: 18px; height: 18px; display: flex;
            align-items: center; justify-content: center;
            border-radius: 4px; flex-shrink: 0; transition: 0.15s; margin-top: 1px;
        }
        .cdhlp-item-del:hover { color: ${P1}; background: rgba(229,25,58,0.1); }

        .cdhlp-note-input {
            width: 100%; padding: 5px 8px;
            border: 1px dashed rgba(255,255,255,0.1);
            border-radius: 5px; background: transparent;
            color: rgba(255,255,255,0.4); font-size: 11px; outline: none;
            box-sizing: border-box; transition: 0.15s; font-family: inherit;
        }
        .cdhlp-note-input:focus {
            border-style: solid; border-color: rgba(229,25,58,0.4);
            color: rgba(255,255,255,0.85); background: rgba(229,25,58,0.04);
        }
        .cdhlp-note-input:not(:placeholder-shown) { border-style: solid; border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); }

        /* ── 구분선 ── */
        .cdhlp-divider {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 10px 4px;
        }
        .cdhlp-divider-label {
            font-size: 9.5px; font-weight: 700; letter-spacing: 0.7px;
            text-transform: uppercase; color: rgba(255,255,255,0.25); white-space: nowrap;
        }
        .cdhlp-divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.06); }

        /* ── 형광펜 mark ── */
        mark.custom-cdhlp {
            font-weight: var(--cdhlp-fw, bold);
            padding: 1px 0; cursor: pointer;
            -webkit-box-decoration-break: clone; box-decoration-break: clone;
            transition: opacity 0.2s;
        }
        mark.custom-cdhlp.cdhlp-start { border-top-left-radius: 2px; border-bottom-left-radius: 2px; padding-left: 2px; }
        mark.custom-cdhlp.cdhlp-end   { border-top-right-radius: 2px; border-bottom-right-radius: 2px; padding-right: 2px; }
        mark.custom-cdhlp:hover     { opacity: 0.72; }
        mark.custom-cdhlp.flash     { animation: cdhlpFlash 1.4s ease; }
        @keyframes cdhlpFlash {
            0%,100% { box-shadow: none; }
            30%,70% { box-shadow: 0 0 0 2px ${P1}; }
        }

        /* ── 모바일 오버레이 ── */
        #cdhlp-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.6); z-index: 2147483639 !important;
        }
        #cdhlp-overlay.show { display: block; }

        @media (max-width: 640px) {
            #cdhlp-popup {
                position: fixed !important;
                left: 0 !important; right: 0 !important;
                bottom: 0 !important; top: auto !important;
                width: 100% !important; max-width: 100% !important;
                max-height: 80vh !important;
                border-radius: 10px 10px 0 0 !important;
                border-bottom: none !important;
            }
            #cdhlp-popup::before {
                content: '';
                display: block;
                width: 36px; height: 4px;
                background: rgba(255,255,255,0.15);
                border-radius: 2px;
                margin: 8px auto 0;
                flex-shrink: 0;
            }
            .cdhlp-popup-header { cursor: default !important; }
        }

        /* ── 토스트 ── */
        #cdhlp-toast {
            position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
            background: #2a2a2d; color: rgba(255,255,255,0.85);
            padding: 9px 18px; border-radius: 6px;
            z-index: 2147483647; font-size: 12px; font-weight: 600;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            font-family: 'Pretendard',sans-serif;
        }

        /* ── 툴바 버튼 ── */
        #cdhlp-toolbar-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 36px; height: 36px; border-radius: 9999px;
            border: none; background: none; cursor: pointer;
            color: rgba(255,255,255,0.45); transition: 0.15s;
            flex-shrink: 0;
        }
        #cdhlp-toolbar-btn:hover {
            background: rgba(188,30,81,0.12);
            color: ${P1};
        }
        #cdhlp-toolbar-btn.active {
            background: rgba(188,30,81,0.18);
            color: ${P1};
        }
    `);

    // ==========================================
    // UI 생성
    // ==========================================
    const selectionBar = document.createElement('div');
    selectionBar.id = 'cdhlp-selection-bar';
    document.body.appendChild(selectionBar);

    const editBar = document.createElement('div');
    editBar.id = 'cdhlp-edit-bar';
    document.body.appendChild(editBar);

    function preventDefaultTouch(e) { e.preventDefault(); }

    function renderSelectionBar() {
        selectionBar.innerHTML = '';
        selectionBar.addEventListener('mousedown', preventDefaultTouch);
        selectionBar.addEventListener('touchstart', preventDefaultTouch, { passive: false });
        paletteColors.forEach(colorObj => {
            const btn = document.createElement('div');
            btn.className = 'cdhlp-color-btn';
            btn.style.background = colorObj.text
                ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)`
            : colorObj.bg;
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
            btn.className = 'cdhlp-color-btn';
            btn.style.background = colorObj.text
                ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)`
            : colorObj.bg;
            btn.title = '이 색상으로 변경';
            btn.addEventListener('click', e => { e.stopPropagation(); changeHighlightColor(colorObj); });
            btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); changeHighlightColor(colorObj); });
            editBar.appendChild(btn);
        });
    }

    // 알림 모달
    const alertOverlay = document.createElement('div');
    alertOverlay.id = 'cdhlp-custom-alert';
    alertOverlay.innerHTML = `<div class="cdhlp-alert-box"><p id="cdhlp-alert-msg" style="margin:0 0 18px;color:rgba(255,255,255,0.8);font-size:13px;line-height:1.6;word-break:keep-all;"></p><button id="cdhlp-alert-ok" class="cdhlp-ctx-btn cdhlp-ctx-cancel" style="padding:7px 22px;">확인</button></div>`;
    document.body.appendChild(alertOverlay);
    function customAlert(msg) { document.getElementById('cdhlp-alert-msg').innerHTML = msg; alertOverlay.style.display = 'flex'; }
    document.getElementById('cdhlp-alert-ok').onclick = () => alertOverlay.style.display = 'none';

    // 컨텍스트 메뉴
    const ctxMenu = document.createElement('div');
    ctxMenu.id = 'cdhlp-context-menu';
    ctxMenu.innerHTML = `<div class="cdhlp-ctx-text" id="cdhlp-ctx-text">삭제할까요?</div><div class="cdhlp-ctx-actions"><button class="cdhlp-ctx-btn cdhlp-ctx-cancel" id="cdhlp-ctx-cancel">취소</button><button class="cdhlp-ctx-btn cdhlp-ctx-delete" id="cdhlp-ctx-delete">삭제</button></div>`;
    document.body.appendChild(ctxMenu);

    let ctxCallback = null;
    function openContextMenu(e, text, callback) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        document.getElementById('cdhlp-ctx-text').innerText = text;
        ctxCallback = callback; ctxMenu.style.display = 'flex';
        const px = e.pageX || e.changedTouches?.[0]?.pageX || 0;
        const py = e.pageY || e.changedTouches?.[0]?.pageY || 0;
        ctxMenu.style.left = `${px+5}px`; ctxMenu.style.top = `${py+5}px`;
    }
    document.getElementById('cdhlp-ctx-cancel').onclick = () => { ctxMenu.style.display='none'; ctxCallback=null; };
    document.getElementById('cdhlp-ctx-delete').onclick = () => { ctxCallback?.(); ctxMenu.style.display='none'; ctxCallback=null; };
    document.addEventListener('click',      e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });
    document.addEventListener('touchstart', e => { if(!ctxMenu.contains(e.target)) ctxMenu.style.display='none'; });

    // 초기화 모달
    const resetOverlay = document.createElement('div');
    resetOverlay.id = 'cdhlp-reset-overlay';
    resetOverlay.innerHTML = `<div class="cdhlp-reset-box"><div style="font-size:26px;margin-bottom:10px;">⚠️</div><p style="margin:0 0 6px;color:#fff;font-size:15px;font-weight:700;">모든 데이터를 초기화할까요?</p><p style="margin:0 0 20px;color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;">형광펜 노트와 커스텀 색상이<br>영구적으로 삭제됩니다.</p><div style="display:flex;justify-content:center;gap:10px;"><button id="cdhlp-reset-cancel" class="cdhlp-ctx-btn cdhlp-ctx-cancel">취소</button><button id="cdhlp-reset-confirm" class="cdhlp-ctx-btn cdhlp-ctx-delete">초기화</button></div></div>`;
    document.body.appendChild(resetOverlay);
    document.getElementById('cdhlp-reset-cancel').onclick  = () => resetOverlay.style.display='none';
    document.getElementById('cdhlp-reset-confirm').onclick = () => {
        Object.keys(localStorage).forEach(k => { if(k.startsWith('CDHLP_')) localStorage.removeItem(k); });
        highlights=[]; paletteColors=[...DEFAULT_COLORS];
        document.querySelectorAll('mark.custom-cdhlp').forEach(m => m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
        renderPopupPalette(); renderSelectionBar(); renderEditBar(); renderPopupList();
        resetOverlay.style.display='none';
    };

    // 모바일 오버레이
    const hlpOverlay = document.createElement('div');
    hlpOverlay.id = 'cdhlp-overlay';
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
            else { popup.style.left='20px'; popup.style.top='100px'; }
        }
        popup.style.display = 'flex';
        document.getElementById('cdhlp-toolbar-btn')?.classList.add('active');
        renderPopupList();
    }

    function hlpClosePopup() {
        popup.style.display = 'none';
        hlpOverlay.classList.remove('show');
        document.getElementById('cdhlp-toolbar-btn')?.classList.remove('active');
    }

    // ── 메인 팝업 ────────────────────────────────
    const popup = document.createElement('div');
    popup.id = 'cdhlp-popup';
    popup.innerHTML = `
        <div class="cdhlp-popup-header">
            <div class="cdhlp-header-title">
                <div class="cdhlp-header-badge">
                    <span class="cdhlp-badge-dot"></span>
                    형광펜 노트
                </div>
                <span class="cdhlp-header-count" id="cdhlp-header-count">0</span>
            </div>
            <div class="cdhlp-header-actions">
                <input type="range" id="cdhlp-opacity-slider" min="0" max="1" step="0.05" value="0.45" title="형광펜 투명도">
                <button class="cdhlp-icon-btn ${highlightBold?'cdhlp-bold-active':''}" id="cdhlp-bold-btn" title="볼드체" style="font-weight:800;font-family:serif;font-size:12px;">B</button>
                <button class="cdhlp-icon-btn" id="cdhlp-reset-btn" title="초기화" style="font-size:15px;">↺</button>
                <button class="cdhlp-icon-btn" id="cdhlp-close-btn" title="닫기" style="font-size:13px;">✕</button>
            </div>
        </div>
        <div class="cdhlp-popup-body">
            <div class="cdhlp-sec">
                <div class="cdhlp-sec-label">Colors</div>
                <div class="cdhlp-palette-wrap" id="cdhlp-palette-container"></div>
                <div class="cdhlp-picker-ui" id="cdhlp-color-picker-ui">
                    <div class="cdhlp-picker-row">
                        <label class="cdhlp-picker-label">BG <input type="color" class="cdhlp-color-input" id="cdhlp-new-bg" value="#bc1e51"></label>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:rgba(255,255,255,0.55);flex:1;">
                            <input type="checkbox" id="cdhlp-keep-text" checked style="accent-color:${P1};"> 원본 글자색
                        </label>
                        <div id="cdhlp-new-preview" class="cdhlp-picker-preview" style="background:#e5193a;"></div>
                    </div>
                    <div id="cdhlp-text-color-label" style="display:none;">
                        <label class="cdhlp-picker-label">Text <input type="color" class="cdhlp-color-input" id="cdhlp-new-text" value="#ffffff"></label>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button id="cdhlp-confirm-add-color" class="cdhlp-add-btn">추가</button>
                    </div>
                </div>
            </div>
            <div class="cdhlp-sec" style="padding-top:8px;padding-bottom:8px;">
                <div class="cdhlp-search-wrap">
                    <span class="cdhlp-search-icon">⌕</span>
                    <input type="text" id="cdhlp-search" class="cdhlp-search-input" placeholder="내용 또는 메모 검색">
                </div>
            </div>
            <div class="cdhlp-list-sec" id="cdhlp-list"></div>
        </div>`;
    document.body.appendChild(popup);

    // 볼드 토글
    popup.querySelector('#cdhlp-bold-btn').onclick = () => {
        highlightBold = !highlightBold;
        localStorage.setItem(BOLD_KEY, highlightBold);
        document.documentElement.style.setProperty('--cdhlp-fw', highlightBold ? 'bold' : 'normal');
        popup.querySelector('#cdhlp-bold-btn').classList.toggle('cdhlp-bold-active', highlightBold);
    };

    // 색상 추가
    const bgInput = document.getElementById('cdhlp-new-bg');
    const txInput = document.getElementById('cdhlp-new-text');
    const keepCb  = document.getElementById('cdhlp-keep-text');
    const txLabel = document.getElementById('cdhlp-text-color-label');
    const preview = document.getElementById('cdhlp-new-preview');
    const updatePreview = () => {
        const bg = bgInput.value, tx = keepCb.checked ? '' : txInput.value;
        preview.style.background = tx ? `linear-gradient(135deg,${bg} 50%,${tx} 50%)` : bg;
    };
    keepCb.onchange = () => { txLabel.style.display = keepCb.checked ? 'none' : 'block'; updatePreview(); };
    bgInput.addEventListener('input', updatePreview);
    txInput.addEventListener('input', updatePreview);
    document.getElementById('cdhlp-confirm-add-color').onclick = () => {
        if (paletteColors.length >= MAX_COLORS) { customAlert('최대 8개까지 추가할 수 있어요.'); return; }
        paletteColors.push({ bg: bgInput.value, text: keepCb.checked ? '' : txInput.value });
        savePalette(); document.getElementById('cdhlp-color-picker-ui').style.display = 'none';
    };

    popup.querySelector('#cdhlp-close-btn').onclick = hlpClosePopup;
    popup.querySelector('#cdhlp-reset-btn').onclick = () => resetOverlay.style.display = 'flex';
    popup.querySelector('#cdhlp-search').addEventListener('input', e => renderPopupList(e.target.value.trim().toLowerCase()));

    // 투명도 슬라이더
    const opSlider = popup.querySelector('#cdhlp-opacity-slider');
    opSlider.value = highlightOpacity;
    opSlider.addEventListener('input', e => {
        highlightOpacity = parseFloat(e.target.value);
        localStorage.setItem(OPACITY_KEY, highlightOpacity);
        document.querySelectorAll('mark.custom-cdhlp').forEach(mark => {
            const h = highlights.find(x => x.id === mark.dataset.cdhlpId);
            if (h) { mark.style.backgroundColor = hexToRgba(h.color.bg, highlightOpacity); mark.style.color = h.color.text || 'inherit'; }
        });
    });

    // 드래그
    const popupHeader = popup.querySelector('.cdhlp-popup-header');
    let isDragging=false, dragSX, dragSY, initL, initT;
    const dStart = e => {
        if (e.target.closest('.cdhlp-header-actions')) return;
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
        const c = document.getElementById('cdhlp-palette-container');
        c.innerHTML = '';
        paletteColors.forEach((colorObj, idx) => {
            const btn = document.createElement('div');
            btn.className = 'cdhlp-color-btn';
            btn.style.background = colorObj.text
                ? `linear-gradient(135deg,${colorObj.bg} 50%,${colorObj.text} 50%)`
            : colorObj.bg;
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
            add.className='cdhlp-color-add'; add.innerHTML='+';
            add.onclick = () => {
                const ui = document.getElementById('cdhlp-color-picker-ui');
                const isOpen = ui.style.display === 'flex';
                ui.style.display = isOpen ? 'none' : 'flex';
                if (!isOpen) updatePreview();
            };
            c.appendChild(add);
        } else {
            document.getElementById('cdhlp-color-picker-ui').style.display='none';
        }
    }

    // ==========================================
    // 툴바 버튼 삽입 — 케이브덕 입력창 우측 버튼 그룹
    // ==========================================
    let hlpLastIsMobile = null;
    function injectToolbarButton() {
        const mobile = hlpIsMobile();
        if (hlpLastIsMobile !== null && hlpLastIsMobile !== mobile) {
            document.getElementById('cdhlp-toolbar-btn')?.remove();
        }
        hlpLastIsMobile = mobile;
        if (document.getElementById('cdhlp-toolbar-btn')) return;

        const btnGroup = document.querySelector('form[data-tour="chat-input"] .order-last');
        if (!btnGroup) return;

        const hlBtn = document.createElement('button');
        hlBtn.id = 'cdhlp-toolbar-btn';
        hlBtn.type = 'button';
        hlBtn.title = '형광펜 노트 (Alt+H)';
        hlBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
        hlBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); togglePopup(); });
        btnGroup.insertBefore(hlBtn, btnGroup.firstChild);
    }

    const togglePopup = () => {
        if (popup.style.display === 'flex') { hlpClosePopup(); }
        else { hlpOpenPopup(); }
    };
    document.addEventListener('keydown', e => { if(e.altKey&&e.key==='h'){e.preventDefault();togglePopup();} });

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
    const handleSelectionEnd = e => {
        if (e.type==='mouseup'&&e.button!==0) return;
        if ([selectionBar,editBar,popup,ctxMenu].some(el=>el.contains(e.target))) return;

        if (e.target.tagName==='MARK'&&e.target.classList.contains('custom-cdhlp')) {
            window.getSelection().removeAllRanges();
            selectionBar.style.display='none';
            currentEditingId = e.target.dataset.cdhlpId;
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
            document.querySelectorAll(`mark[data-cdhlp-id="${currentEditingId}"]`).forEach(m=>{
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
            if (document.querySelector(`mark[data-cdhlp-id="${hl.id}"]`)) return;
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
                            mark.className='custom-cdhlp cdhlp-start cdhlp-end';
                            mark.setAttribute('role','button');
                            mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                            mark.style.color=hl.color.text||'inherit';
                            mark.dataset.cdhlpId=hl.id;
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
            if(p.closest('#cdhlp-popup,#cdhlp-selection-bar,#cdhlp-edit-bar,#cdhlp-context-menu,#cdhlp-reset-overlay,#cdhlp-custom-alert')) continue;
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
                mark.className='custom-cdhlp';
                mark.setAttribute('role','button');
                if(i===arr.length-1) mark.classList.add('cdhlp-start');
                if(i===0)            mark.classList.add('cdhlp-end');
                mark.style.backgroundColor=hexToRgba(hl.color.bg,highlightOpacity);
                mark.style.color=hl.color.text||'inherit';
                mark.dataset.cdhlpId=hl.id;
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
        const list=document.getElementById('cdhlp-list');
        const countEl=document.getElementById('cdhlp-header-count');
        if(!list) return;
        list.innerHTML='';
        const filtered=highlights.filter(h=>h.text.toLowerCase().includes(q)||(h.note&&h.note.toLowerCase().includes(q)));
        if(countEl) countEl.textContent = highlights.length;
        if(filtered.length===0){
            list.innerHTML=`<div class="cdhlp-empty">${q?'검색 결과가 없습니다.':'텍스트를 드래그해서<br>색을 칠해보세요.'}</div>`;
            return;
        }
        const sorted = [...filtered].sort((a,b)=>b.timestamp-a.timestamp);
        const groups = {};
        sorted.forEach(hl => {
            const d = new Date(hl.timestamp), today = new Date();
            let label;
            if (d.toDateString() === today.toDateString()) label = '오늘';
            else { const y = new Date(today); y.setDate(today.getDate()-1); label = d.toDateString()===y.toDateString() ? '어제' : `${d.getMonth()+1}월 ${d.getDate()}일`; }
            if(!groups[label]) groups[label]=[];
            groups[label].push(hl);
        });
        Object.entries(groups).forEach(([label, items]) => {
            const divider = document.createElement('div');
            divider.className = 'cdhlp-divider';
            divider.innerHTML = `<span class="cdhlp-divider-label">${label}</span><span class="cdhlp-divider-line"></span>`;
            list.appendChild(divider);
            items.forEach(hl => {
                const item = document.createElement('div');
                item.className = 'cdhlp-item';
                item.innerHTML = `
                    <div class="cdhlp-item-top">
                        <div class="cdhlp-item-dot" style="background:${hl.color.bg};"></div>
                        <div class="cdhlp-item-body"><div class="cdhlp-item-text">${hl.text}</div></div>
                        <button class="cdhlp-item-del" title="삭제">✕</button>
                    </div>
                    <input type="text" class="cdhlp-note-input" placeholder="메모..." value="${hl.note||''}">`;
                item.querySelector('.cdhlp-item-top').onclick = e => { if(e.target.tagName!=='BUTTON') scrollToHighlight(hl.id); };
                item.querySelector('.cdhlp-item-del').onclick = e => { e.stopPropagation(); deleteHighlightData(hl.id); };
                item.querySelector('.cdhlp-note-input').addEventListener('change', e => {
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
        toast.id='cdhlp-toast'; toast.textContent='탐색 중...';
        document.body.appendChild(toast);
        const loop=setInterval(()=>{
            applyHighlightsToDOM();
            const t=document.querySelector(`mark[data-cdhlp-id="${id}"]`);
            if(t){ clearInterval(loop); toast.remove(); t.scrollIntoView({behavior:'smooth',block:'center'}); t.classList.add('flash'); setTimeout(()=>t.classList.remove('flash'),1400); }
            else if(++tries>15){ clearInterval(loop); toast.remove(); customAlert('너무 오래된 대화이거나 삭제된 텍스트일 수 있어요.'); }
            else { window.scrollTo(0,0); document.querySelectorAll('div').forEach(d=>{if(d.scrollHeight>d.clientHeight)d.scrollTop=0;}); }
        },800);
    }

    function deleteHighlightData(id) {
        highlights=highlights.filter(h=>h.id!==id); saveHighlights();
        document.querySelectorAll(`mark[data-cdhlp-id="${id}"]`).forEach(m=>m.parentNode.replaceChild(document.createTextNode(m.textContent),m));
    }

    let ctxPressTimer;
    document.addEventListener('touchstart', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-cdhlp')) ctxPressTimer=setTimeout(()=>openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.cdhlpId)),800); });
    document.addEventListener('touchend',  ()=>clearTimeout(ctxPressTimer));
    document.addEventListener('touchmove', ()=>clearTimeout(ctxPressTimer));
    window.addEventListener('contextmenu', e=>{ if(e.target.tagName==='MARK'&&e.target.classList.contains('custom-cdhlp')){ e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openContextMenu(e,'이 형광펜을 삭제하시겠습니까?',()=>deleteHighlightData(e.target.dataset.cdhlpId)); } },true);

    // ==========================================
    // 초기화 & 감지
    // ==========================================
    renderSelectionBar(); renderEditBar(); renderPopupPalette(); loadHighlights();
    setTimeout(applyHighlightsToDOM, 1000);

    setInterval(()=>{
        injectToolbarButton();
        if(currentPath!==window.location.pathname){ currentPath=window.location.pathname; loadHighlights(); renderPopupList(); applyHighlightsToDOM(); }
    },500);

    const observer=new MutationObserver(mutations=>{
        let shouldApply=false;
        mutations.forEach(m=>{ if(m.addedNodes.length>0) shouldApply=true; });
        if(shouldApply){ clearTimeout(window.cdhlpDebounce); window.cdhlpDebounce=setTimeout(applyHighlightsToDOM,400); }
    });
    observer.observe(document.body,{childList:true,subtree:true});

})();

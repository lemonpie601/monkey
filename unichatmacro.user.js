// ==UserScript==
// @name         유니챗 매크로
// @namespace    https://www.univers.chat/
// @version      3.1.4
// @description  턴 번호에 따라 자동으로 모델 전환 + 히스토리 표시
// @author       레몬파이 = 시범단계
// @match        https://www.univers.chat/*
// @grant        GM_addStyle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const P1 = '#FF4D77';
    const P2 = '#FFB300';

    // ==========================================
    // 저장 키
    // ==========================================
    const PRESETS_KEY = 'MCR_Presets';
    const ROOM_KEY    = () => `MCR_Room_${location.pathname}`;
    const ACTIVE_KEY  = () => `MCR_Active_${location.pathname}`;
    // TURN_KEY 제거 — 턴은 히스토리 length + 1 로 계산
    const HISTORY_KEY = () => `MCR_History_${location.pathname}`; // 채팅방별
    const POS_KEY     = 'MCR_PopupPos';

    let currentPath = location.pathname;
    let availableModels = [];

    // 매크로 전용 턴 카운터 (메모리, 끄면 초기화)
    let macroTurn = 1;
    const getMacroTurn  = () => macroTurn;
    const resetMacroTurn = () => { macroTurn = 1; };
    const incMacroTurn  = () => { macroTurn++; };

    const loadRoomConfig = () => { const d = localStorage.getItem(ROOM_KEY()); return d ? JSON.parse(d) : null; };
    const saveRoomConfig = v => localStorage.setItem(ROOM_KEY(), JSON.stringify(v));
    const isActive       = () => localStorage.getItem(ACTIVE_KEY()) === 'true';
    const setActive      = v => { localStorage.setItem(ACTIVE_KEY(), v ? 'true' : 'false'); updateTriggerBtn(); };
    const getTurn        = () => loadHistory().length + 1; // 히스토리 기반 (히스토리 표시용)
    const loadPresets    = () => { const d = localStorage.getItem(PRESETS_KEY); return d ? JSON.parse(d) : []; };
    const savePresets    = v => localStorage.setItem(PRESETS_KEY, JSON.stringify(v));
    const loadHistory    = () => { const d = localStorage.getItem(HISTORY_KEY()); return d ? JSON.parse(d) : []; };
    const saveHistory    = v => localStorage.setItem(HISTORY_KEY(), JSON.stringify(v));

    function addHistory(model) {
        const h = loadHistory();
        const turn = h.length + 1; // 항상 자동 계산
        h.push({ turn, model });
        // 최대 200개 유지 (오래된 것 제거)
        if (h.length > 200) h.shift();
        saveHistory(h);
    }

    // ==========================================
    // ⇄ 버튼 유틸
    // ==========================================
    function getSwitchBtn() {
        return document.querySelector('button[aria-label="모델 전환"]');
    }

    // 현재 선택된 모델명: 전환 버튼 왼쪽 버튼의 span.truncate
    function getCurrentModelName() {
        const switchBtn = getSwitchBtn();
        if (!switchBtn) return null;
        const group = switchBtn.closest('div');
        if (!group) return null;
        const span = group.querySelector('button span.truncate');
        return span ? span.textContent.trim() : null;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // 전환 버튼을 한 바퀴 돌며 모델 목록 수집
    async function collectModels() {
        const btn = getSwitchBtn();
        if (!btn) return [];
        const start = getCurrentModelName();
        if (!start) return [];
        const models = [start];
        for (let i = 0; i < 30; i++) {
            btn.click();
            await sleep(150);
            const cur = getCurrentModelName();
            if (!cur || cur === start) break;
            if (!models.includes(cur)) models.push(cur);
        }
        return models;
    }

    // 전환 버튼을 목표 모델이 나올 때까지 클릭
    async function switchToModel(modelName) {
        const btn = getSwitchBtn();
        if (!btn) return false;
        if (getCurrentModelName() === modelName) return true;
        for (let i = 0; i < 30; i++) {
            btn.click();
            await sleep(150);
            if (getCurrentModelName() === modelName) return true;
        }
        return false;
    }

    // ==========================================
    // 턴 → 모델 (순환)
    // ==========================================
    function getModelForTurn(steps, turn) {
        if (!steps?.length) return null;
        const total = steps.reduce((a, s) => a + s.turns, 0);
        const t = ((turn - 1) % total) + 1;
        let cum = 0;
        for (const s of steps) {
            cum += s.turns;
            if (t <= cum) return s.model;
        }
        return steps[steps.length - 1].model;
    }

    // ==========================================
    // 매크로 활성화 시 즉시 1턴 모델로 전환 + 카운터 리셋
    // ==========================================
    async function activateMacro() {
        const cfg = loadRoomConfig();
        if (!cfg?.steps?.length) return;
        resetMacroTurn(); // 1턴부터 시작
        const modelName = getModelForTurn(cfg.steps, getMacroTurn());
        if (!modelName) return;
        const ok = await switchToModel(modelName);
        if (ok) showToast(`⚡ 매크로 1턴 → ${modelName}`);
    }

    // ==========================================
    // 매크로 실행
    // ==========================================
    // 흐름:
    //   전송 직전(클릭/Enter) → 현재 모델 기억 + 다음 매크로 턴 모델로 미리 전환
    //   전송 완료 후          → 기억한 모델 히스토리 기록 + 매크로 턴 증가
    // ==========================================
    let macroRunning = false;
    let modelUsedThisTurn = null; // 전송 직전에 기억한 실제 사용 모델

    // 전송 직전 호출 — 현재 모델 기억 + 다음 매크로 턴 모델로 미리 전환
    async function onBeforeSend() {
        // 현재 모델을 기억 (이게 이번 턴에 실제로 사용되는 모델)
        modelUsedThisTurn = getCurrentModelName();

        // 매크로가 켜져있으면 다음 매크로 턴 모델로 미리 전환
        if (isActive() && !macroRunning) {
            const cfg = loadRoomConfig();
            if (cfg?.steps?.length) {
                const nextMacroTurn = getMacroTurn() + 1;
                const nextModel = getModelForTurn(cfg.steps, nextMacroTurn);
                if (nextModel && nextModel !== modelUsedThisTurn) {
                    macroRunning = true;
                    const ok = await switchToModel(nextModel);
                    macroRunning = false;
                    if (ok) showToast(`⚡ 다음 턴 → ${nextModel}`);
                }
            }
        }
    }

    // 전송 완료 후 호출 — 히스토리 기록 + 매크로 턴 증가
    function onAfterSend() {
        const usedModel = modelUsedThisTurn || getCurrentModelName();
        modelUsedThisTurn = null;
        addHistory(usedModel);
        if (isActive()) incMacroTurn(); // 매크로 켜진 동안만 카운트
        setTurn();
        renderPopupList();
    }

    function watchSendButton() {
        // 전송 직전 감지: 클릭 or Enter → onBeforeSend()
        // 전송 완료 감지: msg-assistant-* div가 새로 추가될 때 → onAfterSend()

        let lastMsgCount = 0;

        function getMsgCount() {
            // viewer-content = 어시스턴트 메시지만 해당
            return document.querySelectorAll('.viewer-content').length;
        }

        // 전송 의도 감지 (클릭 or Enter)
        function attachSendIntent(sendBtn) {
            if (sendBtn._mcrWatched) return;
            sendBtn._mcrWatched = true;
            sendBtn.addEventListener('click', () => {
                if (!sendBtn.disabled) onBeforeSend();
            }, true);
        }

        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                const ta = document.querySelector('textarea');
                if (ta && document.activeElement === ta && ta.value.trim().length > 0) {
                    onBeforeSend();
                }
            }
        }, true);

        // 전송 완료 감지: msg-assistant-* div 새로 추가됨
        new MutationObserver(() => {
            // 전송 버튼에 인텐트 리스너 붙이기
            const sendBtn = document.querySelector('button[aria-label="메시지 전송"]');
            if (sendBtn) attachSendIntent(sendBtn);

            // 새 메시지 등장 = 전송 완료 (유저+어시스턴트 쌍으로 추가되므로 1 이상 증가 시 처리)
            const cur = getMsgCount();
            if (cur > lastMsgCount) {
                lastMsgCount = cur;
                // 중복 방지: 짧은 시간 내 여러번 호출 방어
                clearTimeout(watchSendButton._afterSendTimer);
                watchSendButton._afterSendTimer = setTimeout(() => onAfterSend(), 100);
            }
        }).observe(document.body, { childList: true, subtree: true });

        lastMsgCount = getMsgCount();
    }

    // ==========================================
    // CSS
    // ==========================================
    GM_addStyle(`
        /* ── 트리거 버튼 ── */
        #mcr-trigger {
            display: flex; align-items: center; gap: 5px;
            height: 32px; padding: 0 10px; border-radius: 9999px;
            background: rgba(0,0,0,0.06); border: none; cursor: pointer;
            font-size: 11px; font-weight: 600; color: rgba(0,0,0,0.55);
            transition: background 0.15s, color 0.15s;
            font-family: 'Pretendard','Apple SD Gothic Neo',sans-serif;
            white-space: nowrap; flex-shrink: 0;
        }
        #mcr-trigger:hover { background: rgba(0,0,0,0.1); color: rgba(0,0,0,0.75); }
        #mcr-trigger.mcr-on {
            background: rgba(255,77,119,0.12); color: ${P1};
            border: 1px solid rgba(255,77,119,0.25);
        }
        #mcr-trigger.mcr-on:hover { background: rgba(255,77,119,0.2); }
        .mcr-dot {
            width: 6px; height: 6px; border-radius: 50%;
            background: currentColor; flex-shrink: 0; display: none;
        }
        #mcr-trigger.mcr-on .mcr-dot {
            display: block; background: ${P1};
            animation: mcrPulse 1.6s ease-in-out infinite;
        }
        @keyframes mcrPulse {
            0%,100%{opacity:1;transform:scale(1);}
            50%{opacity:0.4;transform:scale(0.7);}
        }

        /* ── 팝업 (형광펜처럼 고정 floating) ── */
        #mcr-popup {
            position: fixed;
            width: 300px; max-height: 540px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            background: rgba(255,255,255,0.88); color: #1a1a1a;
            z-index: 2147483640 !important;
            display: none; flex-direction: column; overflow: hidden;
            font-family: 'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif;
            font-size: 13px;
        }
        #mcr-popup.mcr-dark {
            background: rgba(20,20,20,0.92); color: #e8e8e8;
            border-color: rgba(255,255,255,0.08);
        }

        /* 헤더 */
        .mcr-popup-header {
            padding: 12px 14px 10px;
            border-bottom: 1px solid rgba(0,0,0,0.07);
            display: flex; justify-content: space-between; align-items: center;
            cursor: grab; user-select: none; flex-shrink: 0;
        }
        .mcr-popup-header:active { cursor: grabbing; }
        .mcr-dark .mcr-popup-header { border-bottom-color: rgba(255,255,255,0.07); }

        .mcr-header-left { display: flex; align-items: center; gap: 8px; }
        .mcr-badge {
            display: inline-flex; align-items: center; gap: 5px;
            background: rgba(0,0,0,0.05); border-radius: 8px;
            padding: 3px 9px 3px 7px; font-size: 12px; font-weight: 600;
            color: rgba(0,0,0,0.75); border: 1px solid rgba(0,0,0,0.07);
        }
        .mcr-dark .mcr-badge { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.1); }
        .mcr-badge-dot { width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg,${P1},${P2}); flex-shrink: 0; }

        .mcr-header-right { display: flex; align-items: center; gap: 6px; }
        .mcr-toggle-wrap { display: flex; align-items: center; gap: 6px; }
        .mcr-toggle-label { font-size: 11px; color: rgba(0,0,0,0.4); }
        .mcr-dark .mcr-toggle-label { color: rgba(255,255,255,0.35); }
        .mcr-toggle {
            position: relative; width: 30px; height: 17px;
            background: rgba(0,0,0,0.15); border-radius: 9px;
            cursor: pointer; transition: background 0.2s; border: none; padding: 0;
        }
        .mcr-toggle.on { background: ${P1}; }
        .mcr-toggle::after {
            content:''; position: absolute; top: 2px; left: 2px;
            width: 13px; height: 13px; border-radius: 50%;
            background: #fff; transition: transform 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .mcr-toggle.on::after { transform: translateX(13px); }
        .mcr-close-btn {
            background: none; border: none; cursor: pointer;
            color: rgba(0,0,0,0.3); font-size: 14px; padding: 0;
            width: 24px; height: 24px; display: flex; align-items: center;
            justify-content: center; border-radius: 6px; transition: 0.15s;
        }
        .mcr-dark .mcr-close-btn { color: rgba(255,255,255,0.3); }
        .mcr-close-btn:hover { color: ${P1}; background: rgba(255,77,119,0.1); }

        /* 탭 */
        .mcr-tabs {
            display: flex; padding: 7px 14px 0; gap: 2px;
            border-bottom: 1px solid rgba(0,0,0,0.07); flex-shrink: 0;
        }
        .mcr-dark .mcr-tabs { border-bottom-color: rgba(255,255,255,0.07); }
        .mcr-tab {
            flex: 1; padding: 5px 6px 7px; font-size: 11px; font-weight: 600;
            color: rgba(0,0,0,0.4); background: none; border: none; cursor: pointer;
            border-bottom: 2px solid transparent; transition: 0.15s;
            font-family: inherit; text-align: center; margin-bottom: -1px;
        }
        .mcr-dark .mcr-tab { color: rgba(255,255,255,0.35); }
        .mcr-tab.active { color: ${P1}; border-bottom-color: ${P1}; }
        .mcr-tab:hover:not(.active) { color: rgba(0,0,0,0.65); }
        .mcr-dark .mcr-tab:hover:not(.active) { color: rgba(255,255,255,0.6); }

        .mcr-tab-pane { display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        .mcr-tab-pane.active { display: flex; }

        /* 스크롤 */
        .mcr-scroll { flex: 1; overflow-y: auto; padding: 10px 12px 12px; min-height: 0; }
        .mcr-scroll::-webkit-scrollbar { width: 3px; }
        .mcr-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
        .mcr-dark .mcr-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); }

        /* 다음 예고 바 */
        .mcr-next-bar {
            margin-bottom: 10px; padding: 8px 10px; border-radius: 8px;
            background: rgba(255,179,0,0.08); border: 1px solid rgba(255,179,0,0.2);
            display: flex; align-items: center; gap: 7px;
        }
        .mcr-next-label { font-size: 10px; font-weight: 700; color: ${P2}; flex-shrink: 0; }
        .mcr-next-model { font-size: 12px; font-weight: 600; color: rgba(0,0,0,0.7); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mcr-dark .mcr-next-model { color: rgba(255,255,255,0.7); }
        .mcr-next-turn { font-size: 10px; color: rgba(0,0,0,0.35); flex-shrink: 0; }
        .mcr-dark .mcr-next-turn { color: rgba(255,255,255,0.3); }

        /* 히스토리 */
        .mcr-sec-label { font-size: 9.5px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; color: rgba(0,0,0,0.35); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; }
        .mcr-dark .mcr-sec-label { color: rgba(255,255,255,0.3); }
        .mcr-history-list { display: flex; flex-direction: column; gap: 2px; }
        .mcr-history-item {
            display: flex; align-items: center; gap: 8px;
            padding: 6px 8px; border-radius: 7px; transition: background 0.15s;
        }
        .mcr-history-item:hover { background: rgba(0,0,0,0.04); }
        .mcr-dark .mcr-history-item:hover { background: rgba(255,255,255,0.05); }
        .mcr-history-item.current { background: rgba(255,77,119,0.07); border: 1px solid rgba(255,77,119,0.15); }
        .mcr-h-turn { font-size: 10.5px; font-weight: 700; color: rgba(0,0,0,0.3); width: 32px; text-align: right; flex-shrink: 0; }
        .mcr-dark .mcr-h-turn { color: rgba(255,255,255,0.28); }
        .mcr-history-item.current .mcr-h-turn { color: ${P1}; }
        .mcr-h-arrow { font-size: 10px; color: rgba(0,0,0,0.18); flex-shrink: 0; }
        .mcr-dark .mcr-h-arrow { color: rgba(255,255,255,0.18); }
        .mcr-h-model { flex: 1; font-size: 12px; font-weight: 600; color: rgba(0,0,0,0.75); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mcr-dark .mcr-h-model { color: rgba(255,255,255,0.75); }
        .mcr-h-badge { font-size: 9px; font-weight: 700; color: ${P1}; background: rgba(255,77,119,0.12); border-radius: 4px; padding: 1px 5px; flex-shrink: 0; }
        .mcr-clear-btn { font-size: 10px; font-weight: 600; color: rgba(0,0,0,0.3); background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 5px; transition: 0.15s; font-family: inherit; }
        .mcr-dark .mcr-clear-btn { color: rgba(255,255,255,0.25); }
        .mcr-clear-btn:hover { color: ${P1}; background: rgba(255,77,119,0.08); }

        /* 스텝 */
        .mcr-step-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .mcr-step-row {
            display: flex; align-items: center; gap: 6px;
            padding: 7px 10px; border-radius: 9px;
            background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.06); transition: border-color 0.15s;
        }
        .mcr-dark .mcr-step-row { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.07); }
        .mcr-step-row:focus-within { border-color: ${P1}55; }
        .mcr-step-num { font-size: 10px; font-weight: 700; color: rgba(0,0,0,0.25); width: 12px; text-align: center; flex-shrink: 0; }
        .mcr-dark .mcr-step-num { color: rgba(255,255,255,0.22); }
        .mcr-turns-input {
            width: 34px; padding: 3px 5px; text-align: center;
            border: 1px solid rgba(0,0,0,0.12); border-radius: 6px;
            background: rgba(255,255,255,0.7); color: rgba(0,0,0,0.75);
            font-size: 12px; font-weight: 600; outline: none; font-family: inherit; flex-shrink: 0;
        }
        .mcr-dark .mcr-turns-input { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.12); }
        .mcr-turns-input:focus { border-color: ${P2}88; }
        .mcr-turns-label { font-size: 10px; color: rgba(0,0,0,0.32); flex-shrink: 0; }
        .mcr-dark .mcr-turns-label { color: rgba(255,255,255,0.28); }
        .mcr-model-select {
            flex: 1; padding: 4px 7px;
            border: 1px solid rgba(0,0,0,0.12); border-radius: 7px;
            background: rgba(255,255,255,0.7); color: rgba(0,0,0,0.8);
            font-size: 11.5px; font-weight: 500; outline: none;
            font-family: inherit; cursor: pointer; min-width: 0;
        }
        .mcr-dark .mcr-model-select { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.8); border-color: rgba(255,255,255,0.12); }
        .mcr-model-select:focus { border-color: ${P1}88; }
        .mcr-del-btn {
            background: none; border: none; cursor: pointer; color: rgba(0,0,0,0.18);
            font-size: 11px; padding: 0; width: 16px; height: 16px;
            display: flex; align-items: center; justify-content: center;
            border-radius: 4px; flex-shrink: 0; transition: 0.15s;
        }
        .mcr-dark .mcr-del-btn { color: rgba(255,255,255,0.18); }
        .mcr-del-btn:hover { color: ${P1}; background: rgba(255,77,119,0.1); }
        .mcr-add-step {
            width: 100%; padding: 7px; border-radius: 9px;
            background: transparent; border: 1px dashed rgba(0,0,0,0.14);
            color: rgba(0,0,0,0.38); font-size: 12px; font-weight: 600;
            cursor: pointer; transition: 0.15s; font-family: inherit;
            display: flex; align-items: center; justify-content: center; gap: 4px;
        }
        .mcr-dark .mcr-add-step { border-color: rgba(255,255,255,0.14); color: rgba(255,255,255,0.32); }
        .mcr-add-step:hover { border-color: ${P1}; color: ${P1}; background: rgba(255,77,119,0.05); }

        /* 하단 바 */
        .mcr-bottom-bar {
            padding: 9px 12px; border-top: 1px solid rgba(0,0,0,0.07);
            display: flex; gap: 7px; align-items: center; flex-shrink: 0;
        }
        .mcr-dark .mcr-bottom-bar { border-top-color: rgba(255,255,255,0.07); }
        .mcr-name-input {
            flex: 1; padding: 6px 9px;
            border: 1px solid rgba(0,0,0,0.12); border-radius: 8px;
            background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.8);
            font-size: 11.5px; outline: none; font-family: inherit;
            transition: border-color 0.15s; min-width: 0;
        }
        .mcr-dark .mcr-name-input { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); border-color: rgba(255,255,255,0.12); }
        .mcr-name-input:focus { border-color: ${P2}88; }
        .mcr-name-input::placeholder { color: rgba(0,0,0,0.28); font-size: 11px; }
        .mcr-dark .mcr-name-input::placeholder { color: rgba(255,255,255,0.22); }
        .mcr-save-btn {
            padding: 6px 10px; border-radius: 8px; border: none; cursor: pointer;
            font-size: 11.5px; font-weight: 600; transition: 0.15s; font-family: inherit;
            background: rgba(0,0,0,0.05); color: rgba(0,0,0,0.48); white-space: nowrap;
        }
        .mcr-dark .mcr-save-btn { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.42); }
        .mcr-save-btn:hover { background: rgba(0,0,0,0.1); color: rgba(0,0,0,0.72); }
        .mcr-apply-btn {
            padding: 6px 12px; border-radius: 8px; cursor: pointer;
            font-size: 12px; font-weight: 700; transition: 0.15s; font-family: inherit;
            background: ${P1}18; color: ${P1}; border: 1px solid ${P1}33; white-space: nowrap;
        }
        .mcr-apply-btn:hover { background: ${P1}; color: #fff; }

        /* 프리셋 */
        .mcr-preset-item {
            display: flex; align-items: center; gap: 7px;
            padding: 8px 9px; border-radius: 9px; margin-bottom: 4px;
            transition: background 0.15s; border: 1px solid transparent; cursor: default;
        }
        .mcr-preset-item:hover { background: rgba(0,0,0,0.04); }
        .mcr-dark .mcr-preset-item:hover { background: rgba(255,255,255,0.05); }
        .mcr-preset-item.applied { background: rgba(255,77,119,0.06); border-color: rgba(255,77,119,0.18); }
        .mcr-preset-body { flex: 1; min-width: 0; }
        .mcr-preset-name { font-size: 12px; font-weight: 600; color: rgba(0,0,0,0.82); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mcr-dark .mcr-preset-name { color: rgba(255,255,255,0.82); }
        .mcr-preset-desc { font-size: 10px; color: rgba(0,0,0,0.38); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .mcr-dark .mcr-preset-desc { color: rgba(255,255,255,0.32); }
        .mcr-preset-acts { display: flex; gap: 3px; }
        .mcr-p-btn { background: none; border: none; cursor: pointer; padding: 3px 6px; border-radius: 5px; font-size: 10.5px; font-weight: 600; transition: 0.15s; font-family: inherit; }
        .mcr-p-apply { color: ${P1}; }
        .mcr-p-apply:hover { background: rgba(255,77,119,0.1); }
        .mcr-p-edit { color: rgba(0,0,0,0.32); }
        .mcr-dark .mcr-p-edit { color: rgba(255,255,255,0.28); }
        .mcr-p-edit:hover { background: rgba(0,0,0,0.07); color: rgba(0,0,0,0.7); }
        .mcr-p-del { color: rgba(0,0,0,0.22); }
        .mcr-dark .mcr-p-del { color: rgba(255,255,255,0.22); }
        .mcr-p-del:hover { background: rgba(255,77,119,0.1); color: ${P1}; }

        .mcr-empty { text-align: center; color: rgba(0,0,0,0.28); padding: 18px 0; font-size: 12px; line-height: 1.8; }
        .mcr-dark .mcr-empty { color: rgba(255,255,255,0.22); }

        /* ── 모바일: 트리거 아이콘만 표시 ── */
        @media (max-width: 640px) {
            #mcr-trigger .mcr-label { display: none; }
            #mcr-trigger { padding: 0 8px; gap: 3px; height: 28px; }
        }

        /* ── 모바일: 바텀시트 ── */
        #mcr-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.4); z-index: 2147483639 !important;
            backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
        }
        #mcr-overlay.show { display: block; }

        #mcr-popup.mcr-sheet {
            position: fixed !important;
            left: 0 !important; right: 0 !important; bottom: 0 !important;
            top: auto !important;
            width: 100% !important; max-width: 100% !important;
            max-height: 80vh !important;
            border-radius: 16px 16px 0 0 !important;
            border-bottom: none !important;
        }
        #mcr-popup.mcr-sheet .mcr-popup-header {
            cursor: default !important;
        }
        /* 시트 핸들 */
        #mcr-popup.mcr-sheet::before {
            content: '';
            display: block;
            width: 36px; height: 4px;
            background: rgba(0,0,0,0.15);
            border-radius: 2px;
            margin: 8px auto 0;
            flex-shrink: 0;
        }
        .mcr-dark#mcr-popup.mcr-sheet::before { background: rgba(255,255,255,0.2); }

        /* 토스트 */
        #mcr-toast {
            position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%);
            backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            background: rgba(20,20,20,0.85); color: rgba(255,255,255,0.9);
            padding: 9px 18px; border-radius: 10px; z-index: 2147483647;
            font-size: 12px; font-weight: 600; border: 1px solid rgba(255,255,255,0.1);
            font-family: 'Pretendard',sans-serif; pointer-events: none;
            opacity: 0; transition: opacity 0.2s; white-space: nowrap;
        }
        #mcr-toast.show { opacity: 1; }
    `);

    // ==========================================
    // 토스트
    // ==========================================
    const toastEl = document.createElement('div');
    toastEl.id = 'mcr-toast';
    document.body.appendChild(toastEl);
    let toastTimer;
    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    // ==========================================
    // 팝업 생성
    // ==========================================
    // 모바일 오버레이
    const overlay = document.createElement('div');
    overlay.id = 'mcr-overlay';
    overlay.addEventListener('click', closePopup);
    document.body.appendChild(overlay);

    const popup = document.createElement('div');
    popup.id = 'mcr-popup';
    document.body.appendChild(popup);

    // 위치는 openPopup()에서 설정

    function isMobile() {
        return window.innerWidth <= 640;
    }

    function syncTheme() {
        const isDark = document.documentElement.classList.contains('dark') || document.body.classList.contains('dark');
        popup.classList.toggle('mcr-dark', isDark);
    }

    // ==========================================
    // 팝업 렌더링
    // ==========================================
    function buildPopup() {
        syncTheme();
        const cfg      = loadRoomConfig();
        const steps    = cfg?.steps || [];
        const presets  = loadPresets();
        const active   = isActive();
        const turn     = getTurn();
        const history  = loadHistory();
        const nextModel = steps.length ? getModelForTurn(steps, turn) : null;

        const stepsHTML = steps.map((s, i) => `
            <div class="mcr-step-row">
                <span class="mcr-step-num">${i+1}</span>
                <input class="mcr-turns-input" type="number" min="1" max="99" value="${s.turns}" data-field="turns" data-idx="${i}">
                <span class="mcr-turns-label">턴</span>
                <select class="mcr-model-select" data-field="model" data-idx="${i}">
                    ${availableModels.map(m => `<option value="${m}" ${m===s.model?'selected':''}>${m}</option>`).join('')}
                    ${!availableModels.includes(s.model) ? `<option value="${s.model}" selected>${s.model}</option>` : ''}
                </select>
                <button class="mcr-del-btn" data-del="${i}">✕</button>
            </div>`).join('');

        const recentHistory = [...history].reverse().slice(0, 100);
        const historyHTML = recentHistory.length
            ? recentHistory.map((h, i) => {
                const isCurrent = i === 0;
                const modelText = `<span class="mcr-h-model">${h.model || '알 수 없음'}</span>`;
                return `<div class="mcr-history-item ${isCurrent?'current':''}">
                    <span class="mcr-h-turn">턴 ${h.turn}</span>
                    <span class="mcr-h-arrow">›</span>
                    ${modelText}
                    ${isCurrent ? `<span class="mcr-h-badge">직전</span>` : ''}
                </div>`;
            }).join('')
            : `<div class="mcr-empty">아직 기록이 없어요.<br>전송하면 여기에 쌓여요!</div>`;

        const nextBarHTML = (active && nextModel) ? `
            <div class="mcr-next-bar">
                <span class="mcr-next-label">다음 →</span>
                <span class="mcr-next-model">${nextModel}</span>
                <span class="mcr-next-turn">턴 ${turn}</span>
            </div>` : '';

        const appliedName = cfg?.presetName || null;
        const presetsHTML = presets.length
            ? presets.map((p, i) => `
                <div class="mcr-preset-item ${appliedName===p.name?'applied':''}">
                    <div class="mcr-preset-body">
                        <div class="mcr-preset-name">${p.name}</div>
                        <div class="mcr-preset-desc">${p.steps.map(s=>`${s.turns}턴 ${s.model}`).join(' → ')}</div>
                    </div>
                    <div class="mcr-preset-acts">
                        <button class="mcr-p-btn mcr-p-apply" data-apply="${i}">적용</button>
                        <button class="mcr-p-btn mcr-p-edit" data-edit="${i}">편집</button>
                        <button class="mcr-p-btn mcr-p-del" data-pdel="${i}">✕</button>
                    </div>
                </div>`).join('')
            : `<div class="mcr-empty">저장된 프리셋이 없어요.</div>`;

        popup.innerHTML = `
            <div class="mcr-popup-header" id="mcr-drag-handle">
                <div class="mcr-header-left">
                    <div class="mcr-badge"><span class="mcr-badge-dot"></span>모델 매크로</div>
                </div>
                <div class="mcr-header-right">
                    <div class="mcr-toggle-wrap">
                        <span class="mcr-toggle-label">${active?'켜짐':'꺼짐'}</span>
                        <button class="mcr-toggle ${active?'on':''}" id="mcr-toggle"></button>
                    </div>
                    <button class="mcr-close-btn" id="mcr-close">✕</button>
                </div>
            </div>

            <div class="mcr-tabs">
                <button class="mcr-tab active" data-tab="history">히스토리</button>
                <button class="mcr-tab" data-tab="steps">스텝 설정</button>
                <button class="mcr-tab" data-tab="presets">프리셋</button>
            </div>

            <div class="mcr-tab-pane active" data-pane="history">
                <div class="mcr-scroll">
                    ${nextBarHTML}
                    <div class="mcr-sec-label">
                        <span>사용 기록</span>
                    </div>
                    <div class="mcr-history-list" id="mcr-history-list">${historyHTML}</div>
                </div>
            </div>

            <div class="mcr-tab-pane" data-pane="steps">
                <div class="mcr-scroll">
                    ${steps.length===0 ? `<div class="mcr-empty" style="padding:14px 0;">스텝을 추가해보세요!</div>` : ''}
                    <div class="mcr-step-list">${stepsHTML}</div>
                    <button class="mcr-add-step" id="mcr-add-step">＋ 스텝 추가</button>
                </div>
                <div class="mcr-bottom-bar">
                    <input class="mcr-name-input" id="mcr-preset-name" placeholder="프리셋 이름...">
                    <button class="mcr-save-btn" id="mcr-save">저장</button>
                    <button class="mcr-apply-btn" id="mcr-apply">적용</button>
                </div>
            </div>

            <div class="mcr-tab-pane" data-pane="presets">
                <div class="mcr-scroll">${presetsHTML}</div>
            </div>`;

        bindPopupEvents();
        initDrag();
    }

    // ==========================================
    // 히스토리 영역만 부분 업데이트 (탭 상태 유지)
    // ==========================================
    function renderPopupList() {
        if (popup.style.display !== 'flex') return;

        const cfg = loadRoomConfig();
        const steps = cfg?.steps || [];
        const history = loadHistory();
        const active = isActive();
        const turn = getTurn();
        const nextModel = steps.length ? getModelForTurn(steps, getMacroTurn()) : null;

        // 다음 예고 바 업데이트
        const nextBar = popup.querySelector('.mcr-next-bar');
        const historyScrollEl = popup.querySelector('[data-pane="history"] .mcr-scroll');
        if (historyScrollEl) {
            const nextBarHTML = (active && nextModel) ? `
                <div class="mcr-next-bar">
                    <span class="mcr-next-label">다음 →</span>
                    <span class="mcr-next-model">${nextModel}</span>
                    <span class="mcr-next-turn">턴 ${getMacroTurn()}</span>
                </div>` : '';

            const recentHistory = [...history].reverse().slice(0, 100);
            const historyHTML = recentHistory.length
                ? recentHistory.map((h, i) => {
                    const isCurrent = i === 0;
                    return `<div class="mcr-history-item ${isCurrent ? 'current' : ''}">
                        <span class="mcr-h-turn">턴 ${h.turn}</span>
                        <span class="mcr-h-arrow">›</span>
                        <span class="mcr-h-model">${h.model || '알 수 없음'}</span>
                        ${isCurrent ? `<span class="mcr-h-badge">직전</span>` : ''}
                    </div>`;
                }).join('')
                : `<div class="mcr-empty">아직 기록이 없어요.<br>전송하면 여기에 쌓여요!</div>`;

            historyScrollEl.innerHTML = `
                ${nextBarHTML}
                <div class="mcr-sec-label"><span>사용 기록</span></div>
                <div class="mcr-history-list">${historyHTML}</div>`;
        }

        // 트리거 버튼도 업데이트
        updateTriggerBtn();
    }

    // ==========================================
    // 이벤트 바인딩
    // ==========================================
    function bindPopupEvents() {
        // 닫기
        document.getElementById('mcr-close')?.addEventListener('click', closePopup);

        // 탭 전환
        popup.querySelectorAll('.mcr-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                popup.querySelectorAll('.mcr-tab').forEach(t => t.classList.remove('active'));
                popup.querySelectorAll('.mcr-tab-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                popup.querySelector(`[data-pane="${tab.dataset.tab}"]`).classList.add('active');
            });
        });

        // 토글
        document.getElementById('mcr-toggle')?.addEventListener('click', () => {
            const nowActive = !isActive();
            setActive(nowActive);
            if (nowActive) activateMacro();
            else resetMacroTurn(); // 끄면 카운터 초기화
            buildPopup();
        });

        // 스텝 삭제
        popup.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const cfg = loadRoomConfig() || { steps: [] };
                cfg.steps.splice(parseInt(btn.dataset.del), 1);
                saveRoomConfig(cfg); buildPopup();
                // 스텝 탭 유지
                switchTab('steps');
            });
        });

        // 스텝 필드 변경
        popup.querySelectorAll('[data-field]').forEach(el => {
            el.addEventListener('change', () => {
                const cfg = loadRoomConfig() || { steps: [] };
                const idx = parseInt(el.dataset.idx);
                if (el.dataset.field === 'turns') cfg.steps[idx].turns = Math.max(1, parseInt(el.value) || 1);
                else cfg.steps[idx].model = el.value;
                saveRoomConfig(cfg);
            });
        });

        // 스텝 추가
        document.getElementById('mcr-add-step')?.addEventListener('click', () => {
            const cfg = loadRoomConfig() || { steps: [] };
            cfg.steps.push({ turns: 2, model: availableModels[0] || '모델 선택' });
            saveRoomConfig(cfg); buildPopup(); switchTab('steps');
        });

        // 적용
        document.getElementById('mcr-apply')?.addEventListener('click', () => {
            const cfg = loadRoomConfig();
            if (!cfg?.steps?.length) { showToast('스텝을 먼저 추가해주세요'); return; }
            setActive(true);
            activateMacro();
            buildPopup(); showToast('⚡ 매크로 활성화!');
        });

        // 프리셋 저장
        document.getElementById('mcr-save')?.addEventListener('click', () => {
            const cfg = loadRoomConfig();
            if (!cfg?.steps?.length) { showToast('스텝을 먼저 추가해주세요'); return; }
            const nameEl = document.getElementById('mcr-preset-name');
            const name = nameEl?.value?.trim();
            if (!name) { nameEl?.focus(); showToast('이름을 입력해주세요'); return; }
            const presets = loadPresets();
            const idx = presets.findIndex(p => p.name === name);
            if (idx >= 0) presets[idx] = { name, steps: JSON.parse(JSON.stringify(cfg.steps)) };
            else presets.push({ name, steps: JSON.parse(JSON.stringify(cfg.steps)) });
            savePresets(presets);
            if (nameEl) nameEl.value = '';
            buildPopup(); showToast(`"${name}" 저장됐어요!`);
        });

        // 프리셋 적용
        popup.querySelectorAll('[data-apply]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = loadPresets()[parseInt(btn.dataset.apply)];
                saveRoomConfig({ steps: [...p.steps], presetName: p.name });
                setActive(true);
                buildPopup(); showToast(`⚡ "${p.name}" 적용됐어요!`);
            });
        });

        // 프리셋 편집
        popup.querySelectorAll('[data-edit]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = loadPresets()[parseInt(btn.dataset.edit)];
                saveRoomConfig({ steps: [...p.steps], presetName: p.name });
                buildPopup(); switchTab('steps');
            });
        });

        // 프리셋 삭제
        popup.querySelectorAll('[data-pdel]').forEach(btn => {
            btn.addEventListener('click', () => {
                const presets = loadPresets();
                presets.splice(parseInt(btn.dataset.pdel), 1);
                savePresets(presets); buildPopup(); switchTab('presets');
            });
        });
    }

    function switchTab(tabName) {
        popup.querySelectorAll('.mcr-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        popup.querySelectorAll('.mcr-tab-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tabName));
    }

    // ==========================================
    // 팝업 열기/닫기
    // ==========================================
    function openPopup() {
        buildPopup();
        if (isMobile()) {
            popup.classList.add('mcr-sheet');
            overlay.classList.add('show');
            // 저장 위치 무시하고 바텀시트로
            popup.style.left = '';
            popup.style.top = '';
        } else {
            popup.classList.remove('mcr-sheet');
            overlay.classList.remove('show');
            // 저장된 위치 복원
            const sp = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            popup.style.left = sp?.left || '20px';
            popup.style.top  = sp?.top  || '100px';
        }
        popup.style.display = 'flex';
        collectModels().then(models => {
            if (models.length) {
                availableModels = models;
                buildPopup();
            } else {
                showToast('⚠️ 모델 목록 수집 실패 — 모델 전환 버튼을 확인해주세요');
            }
        });
    }

    function closePopup() {
        popup.style.display = 'none';
        overlay.classList.remove('show');
    }

    // ==========================================
    // 드래그 (형광펜과 동일한 방식)
    // ==========================================
    function initDrag() {
        const handle = document.getElementById('mcr-drag-handle');
        if (!handle || isMobile()) return; // 모바일 바텀시트는 드래그 없음
        let dragging = false, sx, sy, il, it;

        handle.addEventListener('mousedown', e => {
            if (e.target.closest('.mcr-header-right')) return;
            dragging = true; sx = e.clientX; sy = e.clientY;
            const r = popup.getBoundingClientRect(); il = r.left; it = r.top;
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            popup.style.left = `${Math.max(0, Math.min(il+(e.clientX-sx), window.innerWidth-popup.offsetWidth))}px`;
            popup.style.top  = `${Math.max(0, Math.min(it+(e.clientY-sy), window.innerHeight-popup.offsetHeight))}px`;
        });
        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                localStorage.setItem(POS_KEY, JSON.stringify({ left: popup.style.left, top: popup.style.top }));
            }
        });
    }

    // ==========================================
    // 트리거 버튼
    // ==========================================
    function updateTriggerBtn() {
        const btn = document.getElementById('mcr-trigger');
        if (!btn) return;
        const active = isActive();
        btn.classList.toggle('mcr-on', active);
        const label = btn.querySelector('.mcr-label');
        // 히스토리 마지막 턴 기준으로 표시 (히스토리와 동일)
        if (label) label.textContent = `매크로 · ${getTurn()}턴`; // 히스토리 기반 자동 계산
    }

    let lastIsMobile = null;
    function injectTriggerButton() {
        const mobile = isMobile();
        // 모바일↔PC 전환 시 버튼 재삽입
        if (lastIsMobile !== null && lastIsMobile !== mobile) {
            document.getElementById('mcr-trigger')?.remove();
        }
        lastIsMobile = mobile;
        if (document.getElementById('mcr-trigger')) return;
        const switchBtn = document.querySelector('button[aria-label="모델 전환"]');
        if (!switchBtn) return;
        const group = switchBtn.closest('div.rounded-full');
        if (!group) return;

        const btn = document.createElement('button');
        btn.id = 'mcr-trigger';
        btn.type = 'button';
        btn.innerHTML = `
            <span class="mcr-dot"></span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m13 2-2 2.5h3L12 7"/><path d="M12 22v-3"/><path d="M10 20h4"/>
                <circle cx="12" cy="14" r="4"/><path d="M7 14H3"/><path d="M21 14h-4"/>
            </svg>
            <span class="mcr-label">매크로</span>`;

        btn.addEventListener('click', () => {
            if (popup.style.display === 'flex') {
                closePopup();
            } else {
                openPopup();
            }
        });

        if (isMobile()) {
            // 모바일: @ * " ✎ 그룹 바로 오른쪽에 삽입 (모델 그룹 왼쪽)
            const actionBtn = document.querySelector('button[aria-label="행동 묘사 삽입"]');
            const actionGroup = actionBtn?.closest('div.rounded-full');
            if (actionGroup && actionGroup.parentElement) {
                actionGroup.parentElement.insertBefore(btn, actionGroup.nextSibling);
            } else {
                group.parentElement.insertBefore(btn, group.nextSibling);
            }
        } else {
            // PC: 모델 그룹 오른쪽
            group.parentElement.insertBefore(btn, group.nextSibling);
        }
        updateTriggerBtn();
    }

    // ==========================================
    // 초기화
    // ==========================================
    // 화면 크기 바뀌면 팝업 모드 전환 (가로세로 회전 등)
    window.addEventListener('resize', () => {
        if (popup.style.display === 'flex') {
            if (isMobile()) {
                popup.classList.add('mcr-sheet');
                overlay.classList.add('show');
                popup.style.left = ''; popup.style.top = '';
            } else {
                popup.classList.remove('mcr-sheet');
                overlay.classList.remove('show');
                const sp = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
                popup.style.left = sp?.left || '20px';
                popup.style.top  = sp?.top  || '100px';
            }
        }
    });

    setInterval(() => {
        injectTriggerButton();
        if (currentPath !== location.pathname) {
            currentPath = location.pathname;
            availableModels = [];
            updateTriggerBtn();
            // 채팅방 바뀌면 해당 채팅방 히스토리/설정으로 팝업 갱신
            if (popup.style.display === 'flex') { buildPopup(); if (isMobile()) { /* 위치 유지 */ } }
        }
        syncTheme();
        updateTriggerBtn();
    }, 800);

    new MutationObserver(() => {
        injectTriggerButton();
        syncTheme();
    }).observe(document.body, { childList: true, subtree: true });

    watchSendButton();


    // ==========================================
    // 이어서 생성하기 버튼 감지 → onBeforeSend만 호출
    // (onAfterSend는 msg-assistant-* 추가로 자동 감지)
    // ==========================================
    function watchContinueButton() {
        document.addEventListener('click', e => {
            const btn = e.target.closest('button[aria-label="이어서 생성하기"]');
            if (btn && !btn.disabled) {
                onBeforeSend();
            }
        }, true);
    }

    watchContinueButton();

})();

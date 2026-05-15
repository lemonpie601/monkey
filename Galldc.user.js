// ==UserScript==
// @name         디시인사이드 단어 빈도 트래커
// @namespace    http://tampermonkey.net/
// @version      5.2.7
// @description  디시인사이드 갤러리에서 자주 나오는 단어를 시간대별로 분석해주는 확장 프로그램
// @author       레몬파이
// @match        https://gall.dcinside.com/*
// @match        https://m.dcinside.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    //  스타일
    // ─────────────────────────────────────────────
    GM_addStyle(`
        /* ── 트리거 버튼 ── */
        #dc-tracker-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 0 10px;
            margin-right: 4px;
            height: 26px;
            background: #fff;
            color: #3730a3;
            font-size: 11px;
            font-weight: 700;
            border: 1.5px solid #c7d2fe;
            border-radius: 5px;
            cursor: pointer;
            vertical-align: middle;
            letter-spacing: 0.1px;
            transition: background 0.12s, border-color 0.12s, color 0.12s;
            white-space: nowrap;
        }
        #dc-tracker-btn:hover {
            background: #eef2ff;
            border-color: #818cf8;
            color: #4338ca;
        }
        #dc-tracker-btn:active { background: #e0e7ff; }
        #dc-tracker-btn.loading { opacity: 0.5; cursor: wait; }
        #dc-tracker-btn svg { flex-shrink: 0; }

        /* ── 오버레이 ── */
        #dc-tracker-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            backdrop-filter: blur(3px);
            z-index: 999998;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: dc-fadein 0.18s ease;
        }
        @keyframes dc-fadein { from { opacity: 0 } to { opacity: 1 } }

        /* ── 패널 ── */
        #dc-tracker-panel {
            background: #13131a;
            color: #e2e4f0;
            width: 860px;
            max-width: 96vw;
            max-height: 88vh;
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.08);
            box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
            font-size: 13px;
            animation: dc-slidein 0.2s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes dc-slidein { from { transform: scale(0.94) translateY(10px); opacity:0 } to { transform: scale(1) translateY(0); opacity:1 } }

        /* ── 헤더 ── */
        #dc-tracker-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 14px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16162a 100%);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
        }
        #dc-tracker-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        #dc-tracker-header h2 {
            margin: 0;
            font-size: 15px;
            font-weight: 700;
            background: linear-gradient(90deg, #a78bfa, #60a5fa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: -0.3px;
        }
        #dc-tracker-header-sub {
            font-size: 11px;
            color: #4a4a6a;
            margin-top: 1px;
        }

        /* ── 컨트롤 바 ── */
        #dc-tracker-controls {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px 20px;
            background: #0f0f1a;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            flex-shrink: 0;
        }
        .dc-ctrl-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .dc-ctrl-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #dc-tracker-controls label {
            color: #6b6b9a;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }

        /* ── 공통 select ── */
        .dc-select {
            padding: 4px 8px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.10);
            background: #1e1e30;
            color: #c4c6e0;
            font-size: 12px;
            outline: none;
            cursor: pointer;
            transition: border-color 0.15s;
        }
        .dc-select:focus, .dc-select:hover { border-color: #6366f1; }
        .dc-select option { background: #1e1e30; }

        /* 새벽 비교 토글 체크 시 레이블 색 강조 */
        #dc-dawn-compare-chk:checked ~ .dc-toggle-label { color: #a78bfa; }
        #dc-blacklist-input {
            flex: 1;
            min-width: 140px;
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.08);
            background: #1e1e30;
            color: #e2e4f0;
            font-size: 12px;
            outline: none;
            transition: border-color 0.15s;
        }
        #dc-blacklist-input:focus { border-color: #6366f1; }
        #dc-blacklist-input::placeholder { color: #3a3a5a; }
        #dc-collect-btn {
            padding: 6px 16px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff;
            border: none;
            border-radius: 7px;
            cursor: pointer;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 0.2px;
            transition: opacity 0.15s, transform 0.1s;
            box-shadow: 0 2px 8px rgba(99,102,241,0.35);
            white-space: nowrap;
        }
        #dc-collect-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        #dc-collect-btn:active { transform: translateY(0); }
        #dc-collect-btn:disabled { background: #2a2a40; box-shadow: none; cursor: wait; color: #444; }

        /* ── 본문 포함 토글 ── */
        .dc-toggle-wrap {
            display: flex;
            align-items: center;
            gap: 7px;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
        }
        .dc-toggle-wrap input[type=checkbox] { display: none; }
        .dc-toggle-track {
            width: 30px;
            height: 16px;
            background: #2a2a40;
            border-radius: 20px;
            position: relative;
            transition: background 0.2s;
            flex-shrink: 0;
            border: 1px solid rgba(255,255,255,0.07);
        }
        .dc-toggle-thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 10px;
            height: 10px;
            background: #4a4a6a;
            border-radius: 50%;
            transition: transform 0.2s, background 0.2s;
        }
        .dc-toggle-wrap input:checked + .dc-toggle-track { background: #6366f1; border-color: #6366f1; }
        .dc-toggle-wrap input:checked + .dc-toggle-track .dc-toggle-thumb {
            transform: translateX(14px);
            background: #fff;
        }
        .dc-toggle-label {
            font-size: 11px;
            color: #6b6b9a;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .dc-toggle-warn {
            font-size: 10px;
            color: #f59e0b;
            display: none;
        }
        #dc-include-body:checked ~ .dc-toggle-warn { display: inline; }

        /* ── 프로그레스 바 ── */
        #dc-progress-bar-wrap {
            height: 2px;
            background: #1a1a2e;
            flex-shrink: 0;
        }
        #dc-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #a78bfa);
            width: 0%;
            transition: width 0.25s ease;
            border-radius: 0 2px 2px 0;
        }

        /* ── 상태 텍스트 ── */
        #dc-tracker-status {
            padding: 5px 20px;
            font-size: 11px;
            color: #4a4a6a;
            flex-shrink: 0;
            min-height: 22px;
            letter-spacing: 0.1px;
        }

        /* ── 바디 ── */
        #dc-tracker-body {
            display: flex;
            flex: 1;
            overflow: hidden;
        }

        /* ── 왼쪽: 단어 목록 ── */
        #dc-word-list-wrap {
            width: 200px;
            min-width: 160px;
            border-right: 1px solid rgba(255,255,255,0.05);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background: #0f0f1a;
        }
        #dc-word-list-header {
            padding: 10px 14px 8px;
            font-size: 10px;
            font-weight: 700;
            color: #3a3a5a;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            flex-shrink: 0;
        }
        #dc-word-search-wrap {
            padding: 7px 10px;
            border-bottom: 1px solid rgba(255,255,255,0.04);
            flex-shrink: 0;
        }
        #dc-word-search {
            width: 100%;
            box-sizing: border-box;
            padding: 5px 8px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 6px;
            color: #c4c6e0;
            font-size: 11px;
            outline: none;
            transition: border-color 0.15s;
        }
        #dc-word-search:focus { border-color: #6366f1; }
        #dc-word-search::placeholder { color: #2e2e4a; }
        #dc-word-list {
            overflow-y: auto;
            flex: 1;
            padding: 4px 0;
        }
        /* 커스텀 스크롤바 */
        #dc-word-list::-webkit-scrollbar,
        #dc-post-area::-webkit-scrollbar { width: 4px; }
        #dc-word-list::-webkit-scrollbar-track,
        #dc-post-area::-webkit-scrollbar-track { background: transparent; }
        #dc-word-list::-webkit-scrollbar-thumb,
        #dc-post-area::-webkit-scrollbar-thumb {
            background: #2a2a42;
            border-radius: 4px;
        }
        #dc-word-list::-webkit-scrollbar-thumb:hover,
        #dc-post-area::-webkit-scrollbar-thumb:hover { background: #6366f1; }

        .dc-word-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 14px;
            cursor: pointer;
            border-left: 2px solid transparent;
            transition: background 0.1s, border-color 0.1s;
            gap: 6px;
        }
        .dc-word-item:hover { background: rgba(99,102,241,0.08); }
        .dc-word-item.active {
            background: rgba(99,102,241,0.14);
            border-left-color: #a78bfa;
        }
        .dc-word-rank {
            font-size: 10px;
            color: #3a3a5a;
            width: 16px;
            flex-shrink: 0;
            text-align: right;
        }
        .dc-word-item.active .dc-word-rank { color: #7c7cb8; }
        .dc-word-name {
            font-weight: 600;
            color: #c4c6e0;
            font-size: 13px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .dc-word-item.active .dc-word-name { color: #e2e4f0; }
        .dc-word-count {
            font-size: 10px;
            font-weight: 700;
            color: #3a3a5a;
            background: rgba(255,255,255,0.04);
            padding: 2px 7px;
            border-radius: 20px;
            flex-shrink: 0;
        }
        .dc-word-item.active .dc-word-count {
            background: rgba(99,102,241,0.3);
            color: #a78bfa;
        }

        /* ── 오른쪽 ── */
        #dc-detail-wrap {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* ── 차트 ── */
        #dc-chart-area {
            padding: 16px 20px 12px;
            flex-shrink: 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        #dc-chart-title {
            font-size: 11px;
            color: #4a4a6a;
            margin-bottom: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #dc-chart-word-label {
            display: inline;
            color: #a78bfa;
            font-weight: 700;
            text-transform: none;
            letter-spacing: 0;
        }
        #dc-bar-chart {
            display: flex;
            align-items: flex-end;
            gap: 3px;
            height: 90px;
        }
        .dc-bar-col {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
            min-width: 0;
        }
        .dc-bar {
            width: 100%;
            background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
            border-radius: 4px 4px 0 0;
            min-height: 2px;
            transition: height 0.35s cubic-bezier(0.34,1.2,0.64,1);
            cursor: pointer;
        }
        .dc-bar:hover { filter: brightness(1.3); }
        .dc-bar.selected {
            background: linear-gradient(180deg, #f472b6 0%, #ec4899 100%);
            box-shadow: 0 0 10px rgba(236,72,153,0.4);
        }
        .dc-bar-label {
            font-size: 8px;
            color: #3a3a5a;
            margin-top: 4px;
            white-space: nowrap;
            font-weight: 600;
        }
        .dc-bar-val {
            font-size: 9px;
            color: #6366f1;
            margin-bottom: 2px;
            font-weight: 700;
            min-height: 12px;
        }
        .dc-bar.selected ~ .dc-bar-label,
        .dc-bar-col:has(.dc-bar.selected) .dc-bar-val { color: #f472b6; }

        /* ── 게시글 목록 ── */
        #dc-post-area {
            flex: 1;
            overflow-y: auto;
            padding: 10px 16px 16px;
        }
        #dc-post-area-title {
            font-size: 10px;
            font-weight: 700;
            color: #3a3a5a;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin: 8px 0 8px 2px;
        }
        #dc-post-list { display: flex; flex-direction: column; gap: 4px; }
        .dc-post-item {
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.04);
            border-radius: 8px;
            display: flex;
            align-items: baseline;
            gap: 10px;
            cursor: pointer;
            transition: background 0.12s, border-color 0.12s, transform 0.1s;
        }
        .dc-post-item:hover {
            background: rgba(99,102,241,0.1);
            border-color: rgba(99,102,241,0.25);
            transform: translateX(2px);
        }
        .dc-post-time {
            font-size: 10px;
            color: #4a4a6a;
            white-space: nowrap;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums;
            font-weight: 600;
        }
        .dc-post-title {
            font-size: 12px;
            color: #c4c6e0;
            line-height: 1.45;
        }
        .dc-post-title mark {
            background: rgba(167,139,250,0.25);
            color: #c4b5fd;
            border-radius: 3px;
            padding: 0 2px;
            font-weight: 700;
        }
        .dc-empty {
            color: #2e2e4a;
            font-size: 12px;
            padding: 20px 0;
            text-align: center;
        }

        /* ── 모바일 탭 UI ── */
        #dc-mob-tabs {
            display: none;
        }
        @media (max-width: 640px) {
            #dc-tracker-overlay {
                align-items: flex-end;
            }
            #dc-tracker-panel {
                width: 100vw;
                max-width: 100vw;
                height: 92vh;
                max-height: 92vh;
                border-radius: 16px 16px 0 0;
            }
            /* 컨트롤 바 한 줄로 압축 */
            #dc-tracker-controls {
                padding: 8px 12px;
                gap: 6px;
            }
            .dc-ctrl-row { gap: 6px; }
            #dc-tracker-controls label { font-size: 10px; }
            .dc-select { font-size: 11px; padding: 3px 6px; }
            #dc-blacklist-input { min-width: 80px; font-size: 11px; padding: 3px 6px; }
            #dc-collect-btn { padding: 4px 10px; font-size: 11px; }
            .dc-toggle-label { font-size: 10px; }

            /* 탭 버튼 표시 */
            #dc-mob-tabs {
                display: flex;
                border-bottom: 1px solid rgba(255,255,255,0.06);
                background: #0f0f1a;
                flex-shrink: 0;
            }
            .dc-mob-tab {
                flex: 1;
                padding: 9px 0;
                text-align: center;
                font-size: 12px;
                font-weight: 600;
                color: #3a3a5a;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                transition: color 0.15s, border-color 0.15s;
                letter-spacing: 0.2px;
            }
            .dc-mob-tab.active {
                color: #a78bfa;
                border-bottom-color: #a78bfa;
            }

            /* 바디를 탭 전환으로 */
            #dc-tracker-body {
                flex-direction: column;
                position: relative;
            }
            #dc-word-list-wrap {
                width: 100%;
                border-right: none;
                flex: 1;
                min-height: 0;
            }
            #dc-detail-wrap {
                width: 100%;
                position: absolute;
                inset: 0;
                background: #13131a;
            }
            /* 탭 숨김/표시 */
            #dc-word-list-wrap.dc-tab-hidden { display: none; }
            #dc-detail-wrap.dc-tab-hidden { display: none; }

            /* 차트 크기 줄임 */
            #dc-chart-area { padding: 10px 14px 8px; }
            #dc-bar-chart { height: 70px; }
            /* 많은 시간대면 라벨 생략 */
            .dc-bar-label { font-size: 7px; }

            /* 게시글 패딩 줄임 */
            #dc-post-area { padding: 6px 12px 12px; }
            .dc-post-item { padding: 7px 10px; }
            .dc-post-title { font-size: 13px; }

            /* 단어 목록 아이템 크게 */
            .dc-word-item { padding: 10px 14px; }
            .dc-word-name { font-size: 14px; }
            .dc-word-count { font-size: 11px; padding: 2px 8px; }
        }

        /* ── 닫기 버튼 ── */
        #dc-close-btn {
            width: 28px;
            height: 28px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 8px;
            color: #4a4a6a;
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.12s, color 0.12s;
            line-height: 1;
            flex-shrink: 0;
        }
        #dc-close-btn:hover { background: rgba(236,72,153,0.15); color: #f472b6; border-color: rgba(236,72,153,0.3); }
    `);

    // ─────────────────────────────────────────────
    //  불용어 목록 (조사/어미/짧은 단어 제외)
    // ─────────────────────────────────────────────
    const DEFAULT_STOPWORDS = new Set([
        '이','가','을','를','은','는','의','에','에서','로','으로','와','과','도','만','까지',
        '부터','한테','에게','이랑','랑','라고','이라고','라는','이라는','고','하고','이고',
        '하다','이다','있다','없다','되다','하다','이다','것','수','더','좀','그','이','저',
        '걸','거','건','게','뭐','왜','어떻게','어디','누가','언제','어떤','아','오','으',
        '음','응','예','네','아니','아니요','네네','그냥','진짜','정말','너무','다','좀',
        '근데','그리고','그러면','근머','긔','로이','같긔','좋긔',
        '내','내가','나','나는','우리','여기','저기','거기','지금','이제','그냥',
        '못','안','잘','더','제일','가장','많이','조금','약간','완전','엄청','되게',
        '하는','하면','하면서','하는데','하는게','해서','해도','하고','해요','합니다',
        '있어','없어','했어','했는데','됐어','인데','인지','인가','인거','임','인듯',
        '것도','것은','것을','것이','거야','거지','거든','거잖','거에','거임',
    ]);

    // ─────────────────────────────────────────────
    //  한국어 어절 → 어근 추출 (접미 조사/어미 제거)
    // ─────────────────────────────────────────────

    // 제거할 접미 패턴 (긴 것 우선 — 앞에서부터 매칭)
    const SUFFIXES = [
        // 어미 (긴 것 먼저)
        '하겠습니다','하겠어요','했습니다','합니다','해요','했어','하는데','하면서','하면','하니까','하니','하고','해서','해도','하자','하지','하네','하냐','하든',
        '이겠습니다','이겠어요','였습니다','입니다','이에요','이었어','인데','이면서','이면','이니까','이니','이고','이어서','이어도',
        '았습니다','었습니다','았어요','었어요','았어','었어','겠어','겠지','겠냐',
        '는데','는지','는가','는건','는게','는걸','는거','느냐','니까',
        '다고','다는','다면','다며','다가',
        '에서','한테','에게','이랑',
        '이라고','이라는','이라며','이라면','라고','라는','라며','라면',
        '으로서','으로써','으로','로서','로써',
        '까지도','까지','부터','마저','조차','이나마','나마',
        '이었다','이었는','였다','였는',
        '스럽','스러운','스러워','스럽게',
        // 조사 (2자)
        '이다','이야','이여','에도','에만','에는','에를',
        // 조사 (1자) — 마지막에
        '가','이','을','를','은','는','의','와','과','도','만','야','아','여','서','로','랑',
    ];

    function stemWord(word) {
        if (/[a-zA-Z0-9]/.test(word)) return word; // 영숫자 혼합이면 그대로
        for (const sfx of SUFFIXES) {
            if (word.endsWith(sfx) && word.length - sfx.length >= 2) {
                return word.slice(0, word.length - sfx.length);
            }
        }
        return word;
    }

    function tokenize(text) {
        const cleaned = text
            .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned.split(' ').flatMap(w => {
            if (!w) return [];
            const stem = stemWord(w);
            const isConsonantOnly = /^[ㄱ-ㅎ]+$/.test(stem);
            if (isConsonantOnly && stem.length < 2) return [];
            if (!isConsonantOnly && stem.length < 2) return [];
            if (/^\d+$/.test(stem)) return [];
            if (DEFAULT_STOPWORDS.has(stem)) return [];
            return [stem];
        });
    }

    // ─────────────────────────────────────────────
    //  PC / 모바일 판별
    // ─────────────────────────────────────────────
    const isMobile = location.hostname === 'm.dcinside.com';

    // ─────────────────────────────────────────────
    //  현재 갤러리 ID/타입 감지
    // ─────────────────────────────────────────────
    function getGalleryInfo() {
        if (isMobile) {
            // m.dcinside.com/{type}/{id}  예) /mini/coxldwpwkrwk
            const parts = location.pathname.split('/').filter(Boolean);
            // parts[0] = 'mini'|'mgallery'|'board' 등, parts[1] = id
            if (parts.length < 2) return null;
            const type = parts[0] === 'board' ? 'board' : parts[0]; // mini, mgallery, board
            const id   = parts[1];
            return { id, type, mobile: true };
        }
        const url = new URL(location.href);
        const id = url.searchParams.get('id');
        if (!id) return null;

        let type = 'board';
        if (location.pathname.includes('/mgallery/')) type = 'mgallery';
        else if (location.pathname.includes('/mini/')) type = 'mini';

        return { id, type, mobile: false };
    }

    function buildListUrl(gallInfo, page) {
        if (gallInfo.mobile) {
            // m.dcinside.com/{type}/{id}?page=N
            return `https://m.dcinside.com/${gallInfo.type}/${gallInfo.id}?page=${page}`;
        }
        const base = `https://gall.dcinside.com`;
        if (gallInfo.type === 'mgallery') {
            return `${base}/mgallery/board/lists/?id=${gallInfo.id}&page=${page}`;
        } else if (gallInfo.type === 'mini') {
            return `${base}/mini/board/lists/?id=${gallInfo.id}&page=${page}`;
        }
        return `${base}/board/lists/?id=${gallInfo.id}&page=${page}`;
    }

    // ─────────────────────────────────────────────
    //  페이지 파싱 (fetch)
    // ─────────────────────────────────────────────
    async function fetchPage(url) {
        const res = await fetch(url, {
            credentials: 'include',
            headers: { 'Accept': 'text/html' }
        });
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc;
    }

    // baseDate: HH:MM 만 있는 글을 어느 날 기준으로 파싱할지 (기본 오늘)
    function parseDate(dateStr, baseDate) {
        const ref = baseDate || new Date();
        const m1 = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/); // YYYY-MM-DD HH:MM
        const m2 = dateStr.match(/(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/); // YY.MM.DD HH:MM
        const m4 = dateStr.match(/^(\d{2})\.(\d{2})$/); // MM.DD (날짜만, 시간 없음)
        const m3 = dateStr.match(/^(\d{2}):(\d{2})$/);  // HH:MM (당일 글)
        if (m1) return new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:00`);
        if (m2) return new Date(`20${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}:00`);
        if (m4) return new Date(ref.getFullYear(), parseInt(m4[1]) - 1, parseInt(m4[2]), 0, 0, 0);
        if (m3) return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), parseInt(m3[1]), parseInt(m3[2]));
        return null;
    }

    // baseDate: HH:MM만 있는 글을 어느 날 기준으로 파싱할지.
    // 목록 페이지에서 날짜가 명시된 글(YY.MM.DD)이 나오면 그 날짜를 이후 HH:MM 글의 기준으로 씀.
    function parsePosts(doc, baseDate) {
        // ── 모바일 파서 ──
        if (isMobile) {
            const posts = [];
            const items = doc.querySelectorAll('li');
            let lastKnownDate = baseDate || null;
            items.forEach(li => {
                const a = li.querySelector('a.lt');
                if (!a) return;
                const titleEl = li.querySelector('.subjectin');
                if (!titleEl) return;
                const title = titleEl.textContent.trim();
                const href  = a.getAttribute('href') || '';

                const allLi = [...li.querySelectorAll('li')];
                const timeLi = allLi.find(l => /^\d{2}:\d{2}$/.test(l.textContent.trim()));
                const dateLi = allLi.find(l => /^\d{2}\.\d{2}$/.test(l.textContent.trim()));

                let dateStr = '';
                if (timeLi) {
                    dateStr = timeLi.textContent.trim();
                } else if (dateLi) {
                    const [mm, dd] = dateLi.textContent.trim().split('.');
                    const refYear = (baseDate || new Date()).getFullYear();
                    dateStr = `${refYear}.${mm}.${dd} 00:00`;
                    // 날짜 명시된 글이 나오면 lastKnownDate 갱신
                    lastKnownDate = new Date(refYear, parseInt(mm) - 1, parseInt(dd));
                }

                const dateObj = parseDate(dateStr, lastKnownDate);
                if (title && dateObj) {
                    posts.push({ title, date: dateObj, href, dateStr });
                }
            });
            return posts;
        }

        // ── PC 파서 ──
        const rows = doc.querySelectorAll('.gall_list tbody tr.ub-content');
        const posts = [];
        let lastKnownDate = baseDate || null;
        rows.forEach(row => {
            const titleEl = row.querySelector('.gall_tit a:not(.reply_num)');
            const dateEl  = row.querySelector('.gall_date');
            if (!titleEl || !dateEl) return;

            const title   = titleEl.textContent.trim();
            // title 속성에 전체 날짜(YYYY-MM-DD HH:MM:SS)가 있으면 우선 사용
            const dateStr = dateEl.getAttribute('title') || dateEl.textContent.trim();
            const href    = titleEl.getAttribute('href') || '';

            // 날짜가 명시된 경우 lastKnownDate 갱신 (이후 HH:MM 글들의 기준이 됨)
            const fullMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
            const shortMatch = dateStr.match(/^(\d{2})\.(\d{2})$/); // MM.DD
            if (fullMatch) {
                lastKnownDate = new Date(parseInt(fullMatch[1]), parseInt(fullMatch[2]) - 1, parseInt(fullMatch[3]));
            } else if (shortMatch) {
                const refYear = (baseDate || new Date()).getFullYear();
                lastKnownDate = new Date(refYear, parseInt(shortMatch[1]) - 1, parseInt(shortMatch[2]));
            }

            const dateObj = parseDate(dateStr, lastKnownDate);
            if (title && dateObj) {
                posts.push({ title, date: dateObj, href, dateStr });
            }
        });
        return posts;
    }

    // ─────────────────────────────────────────────
    //  본문 파싱
    // ─────────────────────────────────────────────
    async function fetchPostBody(post) {
        if (post.body !== undefined) return; // 이미 수집됨
        try {
            const url = post.href.startsWith('http')
                ? post.href
                : (isMobile ? 'https://m.dcinside.com' : 'https://gall.dcinside.com') + post.href;
            const doc = await fetchPage(url);
            // PC: .write_div / 모바일: .write-content, .thum_txt
            const bodyEl = doc.querySelector('.write_div') || doc.querySelector('.write-content') || doc.querySelector('.thum_txt') || doc.querySelector('.gall_content');
            post.body = bodyEl ? bodyEl.textContent.trim() : '';
        } catch (e) {
            post.body = '';
        }
    }

    // ─────────────────────────────────────────────
    //  단어 빈도 분석
    // ─────────────────────────────────────────────
    function buildWordMap(posts, extraStopwords) {
        const wm = new Map();
        const extraList = [...extraStopwords];
        posts.forEach(post => {
            const text = post.title + (post.body ? ' ' + post.body : '');
            [...new Set(tokenize(text))].forEach(word => {
                if (extraList.some(bl => bl && word.includes(bl))) return;
                if (!wm.has(word)) wm.set(word, []);
                wm.get(word).push(post);
            });
        });
        return wm;
    }

    function analyzeWords(posts, extraStopwords, limit) {
        const wordMap = buildWordMap(posts, extraStopwords);

        // 총 빈도 기준 정렬
        const sorted = [...wordMap.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, limit || 50);

        return sorted; // [[word, [posts]], ...]
    }

    function getHourlyStats(posts) {
        // 0~23시 각 시간대별 게시글 수
        const hours = Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }));
        posts.forEach(p => {
            const h = p.date.getHours();
            hours[h].count++;
        });
        return hours;
    }

    // ─────────────────────────────────────────────
    //  UI 렌더링
    // ─────────────────────────────────────────────
    let panelEl = null;
    let state = {
        words: [],       // [[word, posts[]], ...]
        selectedWord: null,
        selectedHour: null,
        allPosts: [],
        dtFrom: null,
        dtTo: null,
        compareMode: false,     // 새벽 비교 모드
        compareWords: [],       // [[word, todayPosts[], yesterdayPosts[]], ...]
        compareLabels: { today: '오늘 새벽', yesterday: '어제 새벽' },
    };

    function openPanel() {
        if (document.getElementById('dc-tracker-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'dc-tracker-overlay';
        overlay.innerHTML = `
            <div id="dc-tracker-panel">
                <div id="dc-tracker-header">
                    <div id="dc-tracker-header-left">
                        <h2>단어 빈도 트래커</h2>
                    </div>
                    <button id="dc-close-btn" title="닫기">✕</button>
                </div>
                <div id="dc-tracker-controls">
                    <div class="dc-ctrl-row">
                        <div class="dc-ctrl-group">
                            <label>날짜</label>
                            <select id="dc-day-select" class="dc-select">
                                <option value="today">오늘</option>
                                <option value="yesterday">어제</option>
                                <option value="2daysago">그저께</option>
                            </select>
                        </div>
                        <div class="dc-ctrl-group">
                            <label>시간대</label>
                            <select id="dc-time-select" class="dc-select">
                                <option value="all">전체</option>
                                <option value="dawn">새벽 0~5시</option>
                                <option value="morning">오전 6~12시</option>
                                <option value="afternoon">오후 13~18시</option>
                                <option value="night">저녁 19~23시</option>
                            </select>
                        </div>
                        <div class="dc-ctrl-group" style="margin-left:4px;">
                            <label class="dc-toggle-wrap" id="dc-dawn-compare-wrap" title="오늘 새벽 vs 어제 새벽 비교">
                                <input type="checkbox" id="dc-dawn-compare-chk" />
                                <span class="dc-toggle-track"><span class="dc-toggle-thumb"></span></span>
                                <span class="dc-toggle-label">🌙 새벽 비교</span>
                            </label>
                        </div>
                        <div style="flex:1"></div>
                        <div class="dc-ctrl-group">
                            <label>상위</label>
                            <select id="dc-top-n" class="dc-select">
                                <option value="30">30개</option>
                                <option value="50" selected>50개</option>
                                <option value="100">100개</option>
                                <option value="200">200개</option>
                            </select>
                        </div>
                    </div>
                    <div class="dc-ctrl-row">
                        <div class="dc-ctrl-group" style="flex:1">
                            <label>제외</label>
                            <input id="dc-blacklist-input" type="text" placeholder="쉼표로 구분  예) 긔, 띠니" />
                        </div>
                        <label class="dc-toggle-wrap" title="각 게시글 본문을 추가로 수집합니다.">
                            <input type="checkbox" id="dc-include-body" />
                            <span class="dc-toggle-track"><span class="dc-toggle-thumb"></span></span>
                            <span class="dc-toggle-label">본문</span>
                        </label>
                        <button id="dc-collect-btn">분석 시작</button>
                    </div>
                </div>
                <div id="dc-progress-bar-wrap"><div id="dc-progress-bar"></div></div>
                <div id="dc-tracker-status">수집 버튼을 눌러 분석을 시작하세요.</div>
                <div id="dc-mob-tabs">
                    <div class="dc-mob-tab active" data-tab="words">단어 목록</div>
                    <div class="dc-mob-tab" data-tab="detail">차트 &amp; 게시글</div>
                </div>
                <div id="dc-tracker-body">
                    <div id="dc-word-list-wrap">
                        <div id="dc-word-list-header">단어 목록</div>
                        <div id="dc-word-search-wrap">
                            <input id="dc-word-search" type="text" placeholder="단어 검색..." />
                        </div>
                        <div id="dc-word-list"></div>
                    </div>
                    <div id="dc-detail-wrap">
                        <div id="dc-chart-area">
                            <div id="dc-chart-title">단어를 선택하면 <span id="dc-chart-word-label">시간대별 차트</span>가 표시됩니다</div>
                            <div id="dc-bar-chart"></div>
                        </div>
                        <div id="dc-post-area">
                            <div id="dc-post-area-title">게시글</div>
                            <div id="dc-post-list"><p class="dc-empty">← 왼쪽에서 단어를 선택하세요</p></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        panelEl = overlay;

        // 블랙리스트 기존값 불러오기
        const savedBL = GM_getValue('blacklist', '');
        document.getElementById('dc-blacklist-input').value = savedBL;

        // 닫기
        document.getElementById('dc-close-btn').addEventListener('click', closePanel);
        overlay.addEventListener('click', e => { if (e.target === overlay) closePanel(); });

        // 수집 버튼
        document.getElementById('dc-collect-btn').addEventListener('click', startCollect);

        // 새벽 비교 체크 시 날짜/시간 select 흐리게
        const dawnChk = document.getElementById('dc-dawn-compare-chk');
        const daySelEl  = document.getElementById('dc-day-select');
        const timeSelEl = document.getElementById('dc-time-select');
        const toggleSelectState = () => {
            const on = dawnChk.checked;
            daySelEl.disabled  = on;
            timeSelEl.disabled = on;
            daySelEl.style.opacity  = on ? '0.35' : '';
            timeSelEl.style.opacity = on ? '0.35' : '';
        };
        dawnChk.addEventListener('change', toggleSelectState);

        // 단어 검색창
        document.getElementById('dc-word-search').addEventListener('input', e => {
            filterWordList(e.target.value.trim());
        });

        // 모바일 탭 전환
        document.querySelectorAll('.dc-mob-tab').forEach(tab => {
            tab.addEventListener('click', () => switchMobTab(tab.dataset.tab));
        });
    }

    // ─────────────────────────────────────────────
    //  새벽 비교 모드 (오늘 새벽 vs 어제 새벽)
    // ─────────────────────────────────────────────
    async function startDawnCompare(btn) {
        const blStr       = document.getElementById('dc-blacklist-input').value;
        const includeBody = document.getElementById('dc-include-body').checked;
        const MAX_PAGES   = 100;
        GM_setValue('blacklist', blStr);
        const extraStopwords = new Set(blStr.split(',').map(s => s.trim()).filter(Boolean));
        const topN = parseInt(document.getElementById('dc-top-n')?.value || '50', 10);

        const gallInfo = getGalleryInfo();
        if (!gallInfo) {
            setStatus('❌ 갤러리 페이지에서만 사용 가능합니다.');
            btn.disabled = false;
            return;
        }

        state.compareMode = true;
        state.words = [];
        state.allPosts = [];
        state.compareWords = [];

        const today      = getBaseDay('today');
        const yesterday  = getBaseDay('yesterday');

        // 오늘 새벽: 오늘 0시 ~ 오늘 5시
        const todayDawn = {
            dtFrom: new Date(today.getFullYear(),     today.getMonth(),     today.getDate(),     0, 0, 0),
            dtTo:   new Date(today.getFullYear(),     today.getMonth(),     today.getDate(),     5, 59, 59),
        };
        // 어제 새벽: 어제 0시 ~ 어제 5시
        const yesterdayDawn = {
            dtFrom: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0),
            dtTo:   new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 5, 59, 59),
        };

        // 날짜 표기 헬퍼: MM/DD
        const fmtDay = (d) => `${d.getMonth()+1}/${d.getDate()}`;
        // 각 새벽의 "주인 날짜"는 5시가 속한 날 (dtTo 기준)
        const todayDawnLabel     = `오늘 새벽 (${fmtDay(todayDawn.dtTo)})`;
        const yesterdayDawnLabel = `어제 새벽 (${fmtDay(yesterdayDawn.dtTo)})`;

        setProgress(0);

        const collectRange = async (range, progressBase, label, baseDate) => {
            const posts = [];
            let page = 1;
            while (page <= MAX_PAGES) {
                try {
                    const url = buildListUrl(gallInfo, page);
                    const doc = await fetchPage(url);
                    const pagePosts = parsePosts(doc, baseDate);
                    if (pagePosts.length === 0) break;
                    const oldest = pagePosts.reduce((m, p) => p.date < m ? p.date : m, pagePosts[0].date);
                    const newest = pagePosts.reduce((m, p) => p.date > m ? p.date : m, pagePosts[0].date);
                    const inRange = pagePosts.filter(p => p.date >= range.dtFrom && p.date <= range.dtTo);
                    posts.push(...inRange);
                    const prog = progressBase + Math.min(40, Math.round((page / (page + 3)) * 40));
                    setProgress(prog);
                    setStatus(`${label} ${page}p… ${posts.length}개`);
                    if (oldest < range.dtFrom && newest < range.dtFrom) break;
                    page++;
                    await sleep(250);
                } catch (e) { page++; await sleep(300); }
            }
            return posts;
        };

        const todayPosts     = await collectRange(todayDawn,     0,  `🌙 ${todayDawnLabel}`,     today);
        const yesterdayPosts = await collectRange(yesterdayDawn, 45, `🌙 ${yesterdayDawnLabel}`, yesterday);

        if (includeBody) {
            const allToFetch = [...todayPosts, ...yesterdayPosts];
            const CHUNK = 3;
            for (let i = 0; i < allToFetch.length; i += CHUNK) {
                await Promise.all(allToFetch.slice(i, i + CHUNK).map(p => fetchPostBody(p)));
                const done = Math.min(i + CHUNK, allToFetch.length);
                setProgress(90 + Math.round((done / allToFetch.length) * 8));
                setStatus(`본문 수집 중... (${done} / ${allToFetch.length})`);
                await sleep(400);
            }
        }

        setStatus('새벽 비교 분석 중...');
        setProgress(99);

        const todayMap     = buildWordMap(todayPosts, extraStopwords);
        const yesterdayMap = buildWordMap(yesterdayPosts, extraStopwords);
        const allWordSet   = new Set([...todayMap.keys(), ...yesterdayMap.keys()]);

        state.compareWords = [...allWordSet]
            .map(word => ({ word, today: todayMap.get(word) || [], yesterday: yesterdayMap.get(word) || [] }))
            .sort((a, b) => (b.today.length + b.yesterday.length) - (a.today.length + a.yesterday.length))
            .slice(0, topN);

        setProgress(100);
        state.compareLabels = { today: todayDawnLabel, yesterday: yesterdayDawnLabel };
        setStatus(`✅ 새벽 비교 완료 · ${todayDawnLabel} ${todayPosts.length}개 / ${yesterdayDawnLabel} ${yesterdayPosts.length}개`);
        renderCompareWordList();
        btn.disabled = false;
    }

    function renderCompareWordList() {
        const container = document.getElementById('dc-word-list');
        const header    = document.getElementById('dc-word-list-header');
        if (!container) return;
        if (header) header.textContent = `${state.compareLabels.today} ↔ ${state.compareLabels.yesterday}`;

        container.innerHTML = '';
        state.compareWords.forEach(({ word, today, yesterday }, idx) => {
            const tc   = today.length;
            const yc   = yesterday.length;
            const diff = tc - yc;
            let diffHtml = diff > 0
                ? `<span style="color:#34d399;font-size:10px;font-weight:700;">▲${diff}</span>`
                : diff < 0
                    ? `<span style="color:#f87171;font-size:10px;font-weight:700;">▼${Math.abs(diff)}</span>`
                    : `<span style="color:#4a4a6a;font-size:10px;">━</span>`;

            const item = document.createElement('div');
            item.className = 'dc-word-item';
            item.dataset.word = word;
            item.style.cssText = 'flex-wrap:wrap;row-gap:2px;';
            item.innerHTML = `
                <span class="dc-word-rank">${idx + 1}</span>
                <span class="dc-word-name">${escHtml(word)}</span>
                <span style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                    ${diffHtml}
                    <span style="font-size:10px;color:#a78bfa;font-weight:700;">${tc}</span>
                    <span style="font-size:9px;color:#3a3a5a;">/</span>
                    <span style="font-size:10px;color:#60a5fa;">${yc}</span>
                </span>
            `;
            item.title = `${state.compareLabels.today} ${tc}개 / ${state.compareLabels.yesterday} ${yc}개`;
            item.addEventListener('click', () => {
                state.selectedWord = word;
                state.selectedHour = null;
                document.querySelectorAll('.dc-word-item').forEach(el => el.classList.toggle('active', el.dataset.word === word));
                renderComparePosts(word, today, yesterday);
                if (window.innerWidth <= 640) switchMobTab('detail');
            });
            container.appendChild(item);
        });

        if (state.compareWords.length > 0) {
            const first = state.compareWords[0];
            state.selectedWord = first.word;
            container.querySelector('.dc-word-item')?.classList.add('active');
            renderComparePosts(first.word, first.today, first.yesterday);
        }
    }

    function renderComparePosts(word, todayPosts, yesterdayPosts) {
        const container = document.getElementById('dc-post-list');
        const titleEl   = document.getElementById('dc-post-area-title');
        const chartArea = document.getElementById('dc-bar-chart');
        const wordLabel = document.getElementById('dc-chart-word-label');

        if (wordLabel) wordLabel.textContent = `"${word}" ${state.compareLabels.today} ↔ ${state.compareLabels.yesterday}`;

        if (chartArea) {
            chartArea.innerHTML = '';
            chartArea.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:24px;height:80px;';
            const maxVal = Math.max(todayPosts.length, yesterdayPosts.length, 1);
            const makeBar = (count, label, color) => {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
                const barWrap = document.createElement('div');
                barWrap.style.cssText = 'display:flex;align-items:flex-end;height:50px;';
                const bar = document.createElement('div');
                bar.style.cssText = `width:56px;height:${Math.max((count/maxVal)*50, count>0?4:0)}px;background:${color};border-radius:4px 4px 0 0;`;
                barWrap.appendChild(bar);
                const countEl = document.createElement('div');
                countEl.style.cssText = `font-size:14px;font-weight:700;color:${color};`;
                countEl.textContent = count + '개';
                const labelEl = document.createElement('div');
                labelEl.style.cssText = 'font-size:10px;color:#6b6b9a;white-space:nowrap;';
                labelEl.textContent = label;
                wrap.appendChild(barWrap); wrap.appendChild(countEl); wrap.appendChild(labelEl);
                return wrap;
            };
            chartArea.appendChild(makeBar(todayPosts.length,     state.compareLabels.today,     '#a78bfa'));
            chartArea.appendChild(makeBar(yesterdayPosts.length, state.compareLabels.yesterday, '#60a5fa'));
        }

        if (!container) return;
        if (titleEl) titleEl.textContent = `${state.compareLabels.today} ${todayPosts.length}개 / ${state.compareLabels.yesterday} ${yesterdayPosts.length}개`;

        container.innerHTML = '';
        const makeSection = (posts, sectionLabel, color) => {
            if (!posts.length) return;
            const sec = document.createElement('div');
            sec.style.cssText = `font-size:11px;font-weight:700;color:${color};padding:6px 0 4px;`;
            sec.textContent = sectionLabel;
            container.appendChild(sec);
            [...posts].sort((a, b) => b.date - a.date).forEach(post => {
                const item = document.createElement('div');
                item.className = 'dc-post-item';
                item.innerHTML = `<span class="dc-post-time">${formatDate(post.date)}</span><span class="dc-post-title">${highlightWord(escHtml(post.title), word)}</span>`;
                if (post.href) {
                    item.addEventListener('click', () => {
                        const url = post.href.startsWith('http') ? post.href : 'https://gall.dcinside.com' + post.href;
                        window.open(url, '_blank');
                    });
                }
                container.appendChild(item);
            });
        };
        makeSection(todayPosts,     `🌙 ${state.compareLabels.today} (${todayPosts.length}건)`,     '#a78bfa');
        makeSection(yesterdayPosts, `🌙 ${state.compareLabels.yesterday} (${yesterdayPosts.length}건)`, '#60a5fa');
        if (!todayPosts.length && !yesterdayPosts.length) {
            container.innerHTML = '<p class="dc-empty">두 시간대 모두 게시글이 없습니다.</p>';
        }
    }

    function closePanel() {
        const el = document.getElementById('dc-tracker-overlay');
        if (el) el.remove();
        panelEl = null;
    }

    function setStatus(msg) {
        const el = document.getElementById('dc-tracker-status');
        if (el) el.textContent = msg;
    }

    function setProgress(pct) {
        const el = document.getElementById('dc-progress-bar');
        if (el) el.style.width = pct + '%';
    }

    // 날짜 키 → 해당 날 Date 객체 (자정 기준)
    function getBaseDay(dayKey) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (dayKey === 'today')     return today;
        if (dayKey === 'yesterday') return new Date(today.getTime() - 86400000);
        return new Date(today.getTime() - 86400000 * 2); // 그저께
    }

    // 시간대 키 + 기준일 → { dtFrom, dtTo }
    // 새벽(dawn)은 전날 21시 ~ 당일 5시 (날짜 넘김)
    function getTimeRange(timeKey, base) {
        const Y = base.getFullYear(), M = base.getMonth(), D = base.getDate();
        if (timeKey === 'dawn') {
            return {
                dtFrom: new Date(Y, M, D,  0, 0, 0),
                dtTo:   new Date(Y, M, D,  5, 59, 59),
                label:  '새벽',
            };
        }
        const ranges = {
            all:       { h1: 0,  h2: 23, label: '전체' },
            morning:   { h1: 6,  h2: 12, label: '오전' },
            afternoon: { h1: 13, h2: 18, label: '오후' },
            night:     { h1: 19, h2: 23, label: '저녁' },
        };
        const r = ranges[timeKey] || ranges.all;
        return {
            dtFrom: new Date(Y, M, D, r.h1, 0, 0),
            dtTo:   new Date(Y, M, D, r.h2, 59, 59),
            label:  r.label,
        };
    }

    async function startCollect() {
        const btn = document.getElementById('dc-collect-btn');
        btn.disabled = true;

        // 선택된 날짜/시간대 드롭다운 읽기
        const daySelect  = document.getElementById('dc-day-select');
        const timeSelect = document.getElementById('dc-time-select');
        const dawnCompareChk = document.getElementById('dc-dawn-compare-chk');
        const dayKey  = daySelect  ? daySelect.value  : 'today';
        const timeKey = timeSelect ? timeSelect.value : 'all';

        // ── 새벽 비교 모드 ──
        if (dawnCompareChk && dawnCompareChk.checked) {
            await startDawnCompare(btn);
            return;
        }

        state.compareMode = false;

        const base = getBaseDay(dayKey);
        const { dtFrom, dtTo, label: timeLabel } = getTimeRange(timeKey, base);

        const blStr     = document.getElementById('dc-blacklist-input').value;
        const includeBody = document.getElementById('dc-include-body').checked;
        const MAX_PAGES = 100;

        GM_setValue('blacklist', blStr);
        const extraStopwords = new Set(blStr.split(',').map(s => s.trim()).filter(Boolean));
        const topN = parseInt(document.getElementById('dc-top-n')?.value || '50', 10);

        const gallInfo = getGalleryInfo();
        if (!gallInfo) {
            setStatus('❌ 갤러리 페이지에서만 사용 가능합니다.');
            btn.disabled = false;
            return;
        }

        state.allPosts = [];
        state.words = [];
        state.selectedWord = null;
        state.selectedHour = null;
        state.dtFrom = dtFrom;
        state.dtTo   = dtTo;

        setProgress(0);

        const dayLabel  = daySelect ? daySelect.options[daySelect.selectedIndex].text : '오늘';
        setStatus(`${dayLabel} ${timeLabel} 수집 중...`);

        // 1단계: 페이지를 1부터 순서대로 수집, dtFrom 이전 글이 나오면 중단
        let page = 1;
        let stopped = false;

        while (!stopped && page <= MAX_PAGES) {
            try {
                const url = buildListUrl(gallInfo, page);
                const doc = await fetchPage(url);
                const posts = parsePosts(doc, base); // base = 해당 날짜(어제/그제 등)

                if (posts.length === 0) break;

                const oldest = posts.reduce((m, p) => p.date < m ? p.date : m, posts[0].date);
                const newest = posts.reduce((m, p) => p.date > m ? p.date : m, posts[0].date);

                const inRange = posts.filter(p => p.date >= dtFrom && p.date <= dtTo);
                state.allPosts.push(...inRange);

                const progressEst = Math.min(75, Math.round((page / (page + 3)) * 75));
                setProgress(progressEst);

                // ── 스트리밍: 페이지마다 단어 목록 실시간 갱신 ──
                if (state.allPosts.length > 0) {
                    const liveWords = analyzeWords(state.allPosts, extraStopwords, topN);
                    const prevTop = state.words.length > 0 ? state.words[0][0] : null;
                    state.words = liveWords;
                    renderWordListStreaming(prevTop);
                }

                setStatus(`📄 ${page}p 수집 중… 게시글 ${state.allPosts.length}개 · 단어 ${state.words.length}개`);

                // 이 페이지의 모든 글이 범위(dtFrom) 이전이면 더 뒤져도 없음 → 중단
                // (새벽처럼 dtFrom이 전날인 경우도 올바르게 처리)
                if (oldest < dtFrom && newest < dtFrom) { stopped = true; break; }

                page++;
                await sleep(250);
            } catch (e) {
                setStatus(`⚠️ ${page}페이지 수집 실패: ${e.message}`);
                page++;
                await sleep(300);
            }
        }

        if (state.allPosts.length === 0) {
            setStatus(`"${dayLabel} ${timeLabel}"에 게시글이 없습니다.`);
            setProgress(0);
            btn.disabled = false;
            return;
        }

        // 2단계: 본문 수집 (선택 시)
        if (includeBody) {
            setStatus(`본문 수집 중... (0 / ${state.allPosts.length})`);
            const CHUNK = 3;
            for (let i = 0; i < state.allPosts.length; i += CHUNK) {
                const chunk = state.allPosts.slice(i, i + CHUNK);
                await Promise.all(chunk.map(post => fetchPostBody(post)));
                const done = Math.min(i + CHUNK, state.allPosts.length);
                setProgress(75 + Math.round((done / state.allPosts.length) * 20));
                setStatus(`본문 수집 중... (${done} / ${state.allPosts.length})`);
                await sleep(400);
            }
        }

        setStatus('분석 중...');
        state.words = analyzeWords(state.allPosts, extraStopwords, topN);
        setProgress(100);

        const mode = includeBody ? '제목+본문' : '제목';
        setStatus(`✅ ${dayLabel} ${timeLabel} · ${state.allPosts.length}개 게시글 · ${state.words.length}개 단어 (${mode})`);

        const hdr = document.getElementById('dc-word-list-header');
        if (hdr) { const n = document.getElementById('dc-top-n')?.value || '50'; hdr.textContent = `단어 목록 (상위 ${n})`; }
        renderWordList();
        btn.disabled = false;

        if (state.words.length > 0) selectWord(state.words[0][0]);
    }

    function renderWordList() {
        const container = document.getElementById('dc-word-list');
        if (!container) return;
        container.innerHTML = '';
        state.words.forEach(([word, posts], idx) => {
            const item = document.createElement('div');
            item.className = 'dc-word-item';
            item.dataset.word = word;
            item.innerHTML = `
                <span class="dc-word-rank">${idx + 1}</span>
                <span class="dc-word-name">${escHtml(word)}</span>
                <span class="dc-word-count">${posts.length}</span>
            `;
            item.addEventListener('click', () => selectWord(word));
            container.appendChild(item);
        });
    }

    // 스트리밍 중 단어 목록 갱신 (순위/카운트 업데이트, 없어진 항목 제거, 새 항목 추가)
    function renderWordListStreaming(prevSelectedWord) {
        const container = document.getElementById('dc-word-list');
        if (!container) return;

        const existing = new Map(); // word -> element
        container.querySelectorAll('.dc-word-item').forEach(el => {
            existing.set(el.dataset.word, el);
        });

        const newWords = new Set(state.words.map(([w]) => w));

        // 사라진 단어 제거
        existing.forEach((el, word) => {
            if (!newWords.has(word)) el.remove();
        });

        // 순서대로 업데이트 / 추가
        state.words.forEach(([word, posts], idx) => {
            const rank  = idx + 1;
            const count = posts.length;

            if (existing.has(word)) {
                const el = existing.get(word);
                el.querySelector('.dc-word-rank').textContent  = rank;
                el.querySelector('.dc-word-count').textContent = count;
                el.classList.toggle('active', word === state.selectedWord);
                // 올바른 위치로 이동
                const children = [...container.children];
                const curIdx   = children.indexOf(el);
                if (curIdx !== idx) {
                    container.insertBefore(el, container.children[idx] || null);
                }
            } else {
                const item = document.createElement('div');
                item.className = 'dc-word-item' + (word === state.selectedWord ? ' active' : '');
                item.dataset.word = word;
                item.innerHTML = `
                    <span class="dc-word-rank">${rank}</span>
                    <span class="dc-word-name">${escHtml(word)}</span>
                    <span class="dc-word-count">${count}</span>
                `;
                item.addEventListener('click', () => selectWord(word));
                // 새 항목은 잠깐 하이라이트
                item.style.background = 'rgba(99,102,241,0.22)';
                setTimeout(() => { item.style.background = ''; }, 800);
                container.insertBefore(item, container.children[idx] || null);
            }
        });
    }

    function switchMobTab(tab) {
        const wordWrap   = document.getElementById('dc-word-list-wrap');
        const detailWrap = document.getElementById('dc-detail-wrap');
        if (!wordWrap || !detailWrap) return;
        document.querySelectorAll('.dc-mob-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        wordWrap.classList.toggle('dc-tab-hidden', tab !== 'words');
        detailWrap.classList.toggle('dc-tab-hidden', tab !== 'detail');
    }

    function filterWordList(query) {
        const items = document.querySelectorAll('.dc-word-item');
        const q = query.toLowerCase();
        items.forEach(item => {
            const word = (item.dataset.word || '').toLowerCase();
            const show = !q || word.includes(q);
            item.style.display = show ? '' : 'none';
            // 매칭 단어 하이라이트
            const nameEl = item.querySelector('.dc-word-name');
            if (nameEl) {
                const original = item.dataset.word || '';
                if (q && show) {
                    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    nameEl.innerHTML = original.replace(new RegExp(`(${esc})`, 'gi'), '<mark style="background:rgba(99,102,241,0.35);color:#a5b4fc;border-radius:2px;padding:0 1px;">$1</mark>');
                } else {
                    nameEl.textContent = original;
                }
            }
        });
    }

    function selectWord(word) {
        state.selectedWord = word;
        state.selectedHour = null;

        // active 처리
        document.querySelectorAll('.dc-word-item').forEach(el => {
            el.classList.toggle('active', el.dataset.word === word);
        });

        const entry = state.words.find(([w]) => w === word);
        if (!entry) return;
        const posts = entry[1];

        renderChart(word, posts);
        renderPosts(word, posts);
        // 모바일이면 차트+게시글 탭으로 자동 전환
        if (window.innerWidth <= 640) switchMobTab('detail');
    }

    function renderChart(word, posts) {
        const chartArea = document.getElementById('dc-bar-chart');
        const wordLabel = document.getElementById('dc-chart-word-label');
        if (!chartArea) return;

        if (wordLabel) wordLabel.textContent = `"${word}" 시간대별 분포`;

        const hourly = getHourlyStats(posts);
        // 해당 단어 게시글이 분포한 시간대만 표시 (0건도 포함해서 전체 24시간 보여줌)
        const visibleHourly = hourly;
        const maxCount = Math.max(...visibleHourly.map(h => h.count), 1);

        chartArea.innerHTML = '';
        visibleHourly.forEach(({ hour, count }) => {
            const col = document.createElement('div');
            col.className = 'dc-bar-col';

            const heightPct = Math.max((count / maxCount) * 70, count > 0 ? 4 : 0);
            const bar = document.createElement('div');
            bar.className = 'dc-bar' + (state.selectedHour === hour ? ' selected' : '');
            bar.style.height = heightPct + 'px';
            bar.dataset.hour = hour;
            bar.title = `${hour}시: ${count}건`;

            bar.addEventListener('click', () => {
                state.selectedHour = (state.selectedHour === hour) ? null : hour;
                // 막대 selected 갱신 (data-hour 기반)
                document.querySelectorAll('.dc-bar').forEach(b => {
                    b.classList.toggle('selected', parseInt(b.dataset.hour) === state.selectedHour);
                });
                renderPosts(state.selectedWord, posts);
            });

            const valLabel = document.createElement('div');
            valLabel.className = 'dc-bar-val';
            valLabel.textContent = count > 0 ? count : '';

            const label = document.createElement('div');
            label.className = 'dc-bar-label';
            label.textContent = hour + '시';

            col.appendChild(valLabel);
            col.appendChild(bar);
            col.appendChild(label);
            chartArea.appendChild(col);
        });
    }

    function renderPosts(word, posts) {
        const container = document.getElementById('dc-post-list');
        const titleEl   = document.getElementById('dc-post-area-title');
        if (!container) return;

        let filtered = posts;
        if (state.selectedHour !== null) {
            filtered = posts.filter(p => p.date.getHours() === state.selectedHour);
            titleEl.textContent = `${state.selectedHour}시 게시글 (${filtered.length}건)`;
        } else {
            titleEl.textContent = `전체 게시글 (${posts.length}건) — 막대 클릭 시 시간 필터`;
        }

        if (filtered.length === 0) {
            container.innerHTML = '<p class="dc-empty">해당 시간대 게시글이 없습니다.</p>';
            return;
        }

        // 최신순 정렬
        const sorted = [...filtered].sort((a, b) => b.date - a.date);

        container.innerHTML = '';
        sorted.forEach(post => {
            const item = document.createElement('div');
            item.className = 'dc-post-item';

            const timeStr = formatDate(post.date);
            const highlighted = highlightWord(escHtml(post.title), word);

            item.innerHTML = `
                <span class="dc-post-time">${timeStr}</span>
                <span class="dc-post-title">${highlighted}</span>
            `;

            if (post.href) {
                item.addEventListener('click', () => {
                    const url = post.href.startsWith('http')
                        ? post.href
                        : 'https://gall.dcinside.com' + post.href;
                    window.open(url, '_blank');
                });
            }

            container.appendChild(item);
        });
    }

    // ─────────────────────────────────────────────
    //  유틸
    // ─────────────────────────────────────────────
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // datetime-local input용 포맷 (YYYY-MM-DDTHH:MM)
    function toDatetimeLocal(d) {
        const yyyy = d.getFullYear();
        const mm   = String(d.getMonth() + 1).padStart(2, '0');
        const dd   = String(d.getDate()).padStart(2, '0');
        const hh   = String(d.getHours()).padStart(2, '0');
        const min  = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
    }

    function escHtml(str) {
        return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function highlightWord(html, word) {
        const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return html.replace(new RegExp(esc, 'g'), `<mark>${word}</mark>`);
    }

    function formatDate(d) {
        const now = new Date();
        const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
        if (sameDay) {
            return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
        return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    // ─────────────────────────────────────────────
    //  버튼 삽입
    // ─────────────────────────────────────────────
    function insertButton() {
        // 이미 삽입되어 있으면 스킵
        if (document.getElementById('dc-tracker-btn')) return;

        // 갤러리 목록 페이지인지 확인
        if (!getGalleryInfo()) return;

        const btn = document.createElement('button');
        btn.id = 'dc-tracker-btn';
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="10" width="4" height="12" rx="1"/><rect x="10" y="6" width="4" height="16" rx="1"/><rect x="18" y="2" width="4" height="20" rx="1"/></svg>단어 분석`;
        btn.title = '이 갤러리의 단어 빈도를 시간대별로 분석합니다';
        btn.addEventListener('click', openPanel);

        if (isMobile) {
            // 모바일: 하단 글쓰기 버튼 영역 앞 or 목록 상단
            const mWriteBtn = document.querySelector('.btn-write-wrap, .write-btn, a[href*="write"]');
            const mListWrap = document.querySelector('.gall-detail-lst, .listwrap, .list-wrap, ul.wr-list');
            if (mWriteBtn) {
                mWriteBtn.insertAdjacentElement('beforebegin', btn);
            } else if (mListWrap) {
                mListWrap.insertAdjacentElement('beforebegin', btn);
            } else {
                document.body.prepend(btn);
            }
            return;
        }

        // PC 1순위: 글쓰기 버튼 영역(.switch_btnbox) 맨 앞에 삽입
        const switchBox = document.querySelector('.switch_btnbox');
        if (switchBox) {
            switchBox.insertBefore(btn, switchBox.firstChild);
            return;
        }

        // PC 2순위: 글쓰기 링크 바로 앞
        const writeLink = document.querySelector('a.btn_write');
        if (writeLink) {
            writeLink.insertAdjacentElement('beforebegin', btn);
            return;
        }

        // PC 3순위: 검색창 영역 뒤
        const searchWrap = document.querySelector('.top_search') || document.querySelector('.inner_search');
        if (searchWrap) {
            searchWrap.insertAdjacentElement('afterend', btn);
            return;
        }

        // 최후 수단: 갤러리 목록 최상단
        const listWrap = document.querySelector('.gall_listwrap') || document.querySelector('.gall_list');
        if (listWrap) listWrap.prepend(btn);
    }

    // DOM 준비 후 버튼 삽입
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', insertButton);
    } else {
        insertButton();
    }

    // SPA 대응 (페이지 이동 감지)
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(insertButton, 500);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

})();



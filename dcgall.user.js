// ==UserScript==
// @name         디시인사이드 단어 빈도 트래커
// @namespace    http://tampermonkey.net/
// @version      5.1.5
// @description  디시인사이드 갤러리에서 자주 나오는 단어를 시간대별로 분석해주는 확장 프로그램
// @author       레몬파이
// @match        https://gall.dcinside.com/*
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
            gap: 10px;
            flex-wrap: wrap;
        }
        .dc-ctrl-group {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .dc-ctrl-sep {
            color: #3a3a5a;
            font-size: 12px;
            font-weight: 600;
        }
        #dc-tracker-controls label {
            color: #6b6b9a;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
        }
        .dc-range-input {
            width: 44px;
            padding: 4px 6px;
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.08);
            background: #1e1e30;
            color: #e2e4f0;
            font-size: 12px;
            text-align: center;
            outline: none;
            transition: border-color 0.15s;
        }
        .dc-range-input:focus { border-color: #6366f1; }
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
        '근데','그리고','그러면','근머','긔','윶캐','ㄴㅇ','ㄸㄴ','ㅂㄴㅇ','ㅈㄴ',
        '내','내가','나','나는','우리','여기','저기','거기','지금','이제','그냥',
        '못','안','잘','더','제일','가장','많이','조금','약간','완전','엄청','되게',
        '하는','하면','하면서','하는데','하는게','해서','해도','하고','해요','합니다',
        '있어','없어','했어','했는데','됐어','인데','인지','인가','인거','임','인듯',
        '것도','것은','것을','것이','거야','거지','거든','거잖','거에','거임',
    ]);

    // ─────────────────────────────────────────────
    //  한국어 형태소 분리 (간이)
    // ─────────────────────────────────────────────
    function tokenize(text) {
        // 특수문자, 이모지, 이모지 제거 후 단어 추출
        const cleaned = text
            .replace(/[^가-힣ᄀ-ᇿ㄰-㆏a-zA-Z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return cleaned.split(' ').filter(w => {
            if (w.length < 2) return false;  // 1글자 제외
            if (/^\d+$/.test(w)) return false; // 숫자만 제외
            if (DEFAULT_STOPWORDS.has(w)) return false;
            return true;
        });
    }

    // ─────────────────────────────────────────────
    //  현재 갤러리 ID/타입 감지
    // ─────────────────────────────────────────────
    function getGalleryInfo() {
        const url = new URL(location.href);
        const id = url.searchParams.get('id');
        if (!id) return null;

        let type = 'board';
        if (location.pathname.includes('/mgallery/')) type = 'mgallery';
        else if (location.pathname.includes('/mini/')) type = 'mini';

        return { id, type };
    }

    function buildListUrl(gallInfo, page) {
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

    function parsePosts(doc) {
        const rows = doc.querySelectorAll('.gall_list tbody tr.ub-content');
        const posts = [];
        rows.forEach(row => {
            const titleEl = row.querySelector('.gall_tit a:not(.reply_num)');
            const dateEl  = row.querySelector('.gall_date');
            if (!titleEl || !dateEl) return;

            const title    = titleEl.textContent.trim();
            const dateStr  = dateEl.getAttribute('title') || dateEl.textContent.trim();
            const href     = titleEl.getAttribute('href') || '';

            // 날짜 파싱: "2026-05-15 12:28:53" 또는 "26.05.15" 등
            let dateObj = null;
            const m1 = dateStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
            const m2 = dateStr.match(/(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
            const m3 = dateStr.match(/(\d{2}):(\d{2})/); // 오늘 글이면 시간만
            if (m1) {
                dateObj = new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:00`);
            } else if (m2) {
                dateObj = new Date(`20${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}:00`);
            } else if (m3) {
                const now = new Date();
                dateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parseInt(m3[1]), parseInt(m3[2]));
            }

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
                : 'https://gall.dcinside.com' + post.href;
            const doc = await fetchPage(url);
            // 본문 텍스트 추출 (.write_div 또는 .thum_txt)
            const bodyEl = doc.querySelector('.write_div') || doc.querySelector('.thum_txt') || doc.querySelector('.gall_content');
            post.body = bodyEl ? bodyEl.textContent.trim() : '';
        } catch (e) {
            post.body = '';
        }
    }

    // ─────────────────────────────────────────────
    //  단어 빈도 분석
    // ─────────────────────────────────────────────
    function analyzeWords(posts, extraStopwords) {
        const wordMap = new Map(); // word -> [post, ...]

        // 제외 단어: 완전 일치 + 포함 매칭 (예: '띠니' → '띠니는', '띠니가' 모두 제외)
        const extraList = [...extraStopwords];
        const isBlocked = (word) => extraList.some(bl => bl && word.includes(bl));

        posts.forEach(post => {
            // 제목 + 본문(있으면) 합쳐서 토크나이즈
            const text = post.title + (post.body ? ' ' + post.body : '');
            const words = tokenize(text);
            const wordSet = [...new Set(words)]; // 게시글당 1번만 카운트
            wordSet.forEach(word => {
                if (isBlocked(word)) return;
                if (!wordMap.has(word)) wordMap.set(word, []);
                wordMap.get(word).push(post);
            });
        });

        // 총 빈도 기준 정렬
        const sorted = [...wordMap.entries()]
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 50);

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
        hourFrom: 0,
        hourTo: 23,
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
                            <label>페이지</label>
                            <input class="dc-range-input" id="dc-page-from" type="number" min="1" max="999" value="1" title="시작 페이지" />
                            <span class="dc-ctrl-sep">~</span>
                            <input class="dc-range-input" id="dc-page-to" type="number" min="1" max="999" value="5" title="끝 페이지" />
                        </div>
                        <div class="dc-ctrl-group">
                            <label>시간</label>
                            <input class="dc-range-input" id="dc-hour-from" type="number" min="0" max="23" value="0" title="시작 시각 (0~23)" />
                            <span class="dc-ctrl-sep">~</span>
                            <input class="dc-range-input" id="dc-hour-to" type="number" min="0" max="23" value="23" title="끝 시각 (0~23)" />
                            <span style="font-size:10px;color:#3a3a5a;">시</span>
                        </div>
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
                <div id="dc-tracker-body">
                    <div id="dc-word-list-wrap">
                        <div id="dc-word-list-header">Top 50 단어</div>
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

        // 단어 검색창
        document.getElementById('dc-word-search').addEventListener('input', e => {
            filterWordList(e.target.value.trim());
        });
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

    async function startCollect() {
        const btn = document.getElementById('dc-collect-btn');
        btn.disabled = true;

        const pageFrom  = Math.max(1, parseInt(document.getElementById('dc-page-from').value) || 1);
        const pageTo    = Math.max(pageFrom, parseInt(document.getElementById('dc-page-to').value) || 5);
        const hourFrom  = Math.min(23, Math.max(0, parseInt(document.getElementById('dc-hour-from').value) ?? 0));
        const hourTo    = Math.min(23, Math.max(hourFrom, parseInt(document.getElementById('dc-hour-to').value) ?? 23));
        const blStr     = document.getElementById('dc-blacklist-input').value;
        const includeBody = document.getElementById('dc-include-body').checked;
        const totalPages  = pageTo - pageFrom + 1;

        GM_setValue('blacklist', blStr);
        const extraStopwords = new Set(blStr.split(',').map(s => s.trim()).filter(Boolean));

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
        state.hourFrom = hourFrom;
        state.hourTo   = hourTo;

        setProgress(0);
        setStatus(`${pageFrom} ~ ${pageTo} 페이지 수집 중...`);

        // 1단계: 목록 페이지 수집
        let collected = 0;
        for (let p = pageFrom; p <= pageTo; p++) {
            try {
                const url = buildListUrl(gallInfo, p);
                const doc = await fetchPage(url);
                const posts = parsePosts(doc);
                state.allPosts.push(...posts);
                collected++;
                setProgress(Math.round((collected / totalPages) * (includeBody ? 40 : 80)));
                setStatus(`${p} / ${pageTo} 페이지 수집 중... (누적 ${state.allPosts.length}개)`);
                await sleep(200);
            } catch (e) {
                setStatus(`⚠️ ${p}페이지 수집 실패: ${e.message}`);
            }
        }

        // 시간 필터 적용
        const hourFiltered = (hourFrom === 0 && hourTo === 23)
            ? state.allPosts
            : state.allPosts.filter(p => {
                const h = p.date.getHours();
                return h >= hourFrom && h <= hourTo;
            });

        // 2단계: 본문 수집 (선택 시, 시간 필터 적용 후 대상만)
        const targets = includeBody ? hourFiltered : [];
        if (targets.length > 0) {
            setStatus(`본문 수집 중... (0 / ${targets.length})`);
            const CHUNK = 3;
            for (let i = 0; i < targets.length; i += CHUNK) {
                const chunk = targets.slice(i, i + CHUNK);
                await Promise.all(chunk.map(post => fetchPostBody(post)));
                const done = Math.min(i + CHUNK, targets.length);
                setProgress(40 + Math.round((done / targets.length) * 40));
                setStatus(`본문 수집 중... (${done} / ${targets.length})`);
                await sleep(400);
            }
        }

        setStatus('분석 중...');
        state.words = analyzeWords(hourFiltered, extraStopwords);
        setProgress(100);

        const mode     = includeBody ? '제목+본문' : '제목';
        const timeNote = (hourFrom === 0 && hourTo === 23) ? '' : ` · ${hourFrom}~${hourTo}시`;
        setStatus(`✅ 완료! ${hourFiltered.length}개 게시글 / ${state.words.length}개 단어 (${mode}${timeNote})`);

        renderWordList();
        btn.disabled = false;

        // 첫 단어 자동 선택
        if (state.words.length > 0) {
            selectWord(state.words[0][0]);
        }
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
    }

    function renderChart(word, posts) {
        const chartArea = document.getElementById('dc-bar-chart');
        const wordLabel = document.getElementById('dc-chart-word-label');
        if (!chartArea) return;

        if (wordLabel) wordLabel.textContent = `"${word}" 시간대별 분포`;

        const hourly = getHourlyStats(posts);
        // 시간 필터 범위만 표시
        const visibleHourly = hourly.filter(h => h.hour >= state.hourFrom && h.hour <= state.hourTo);
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

        // 1순위: 글쓰기 버튼 영역(.switch_btnbox) 맨 앞에 삽입
        const switchBox = document.querySelector('.switch_btnbox');
        if (switchBox) {
            switchBox.insertBefore(btn, switchBox.firstChild);
            return;
        }

        // 2순위: 글쓰기 링크 바로 앞
        const writeLink = document.querySelector('a.btn_write');
        if (writeLink) {
            writeLink.insertAdjacentElement('beforebegin', btn);
            return;
        }

        // 3순위: 검색창 영역 뒤
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

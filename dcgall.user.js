// ==UserScript==
// @name         디시인사이드 단어 빈도 트래커
// @namespace    http://tampermonkey.net/
// @version      2026-05-15
// @description  디시인사이드 갤러리에서 자주 나오는 단어를 시간대별로 분석해주는 확장 프로그램
// @author       레몬파이
// @match        https://gall.dcinside.com/*
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
        #dc-tracker-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 0 10px;
            margin-right: 4px;
            height: 28px;
            background: #4a90d9;
            color: #fff;
            font-size: 12px;
            font-weight: bold;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            vertical-align: middle;
            transition: background 0.15s;
            white-space: nowrap;
            line-height: 28px;
        }
        #dc-tracker-btn:hover { background: #2f72c4; }
        #dc-tracker-btn.loading { background: #888; cursor: wait; }

        #dc-tracker-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.55);
            z-index: 999998;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        #dc-tracker-panel {
            background: #1e1e2e;
            color: #cdd6f4;
            width: 820px;
            max-width: 96vw;
            max-height: 90vh;
            border-radius: 12px;
            box-shadow: 0 8px 40px rgba(0,0,0,0.6);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Malgun Gothic', sans-serif;
            font-size: 13px;
        }

        #dc-tracker-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            background: #181825;
            border-bottom: 1px solid #313244;
            flex-shrink: 0;
        }
        #dc-tracker-header h2 {
            margin: 0;
            font-size: 15px;
            color: #89b4fa;
        }

        #dc-tracker-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 18px;
            background: #181825;
            border-bottom: 1px solid #313244;
            flex-wrap: wrap;
            flex-shrink: 0;
        }
        #dc-tracker-controls label { color: #a6adc8; font-size: 12px; }
        #dc-pages-input {
            width: 50px;
            padding: 3px 6px;
            border-radius: 4px;
            border: 1px solid #45475a;
            background: #313244;
            color: #cdd6f4;
            font-size: 12px;
            text-align: center;
        }
        #dc-blacklist-input {
            flex: 1;
            min-width: 160px;
            padding: 3px 8px;
            border-radius: 4px;
            border: 1px solid #45475a;
            background: #313244;
            color: #cdd6f4;
            font-size: 12px;
        }
        #dc-collect-btn {
            padding: 4px 14px;
            background: #89b4fa;
            color: #1e1e2e;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            font-size: 12px;
        }
        #dc-collect-btn:hover { background: #74c7ec; }
        #dc-collect-btn:disabled { background: #585b70; cursor: wait; color: #888; }

        #dc-tracker-status {
            padding: 4px 18px;
            font-size: 11px;
            color: #6c7086;
            flex-shrink: 0;
            min-height: 20px;
        }

        #dc-tracker-body {
            display: flex;
            flex: 1;
            overflow: hidden;
            gap: 0;
        }

        /* 왼쪽: 단어 목록 */
        #dc-word-list-wrap {
            width: 220px;
            min-width: 180px;
            border-right: 1px solid #313244;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #dc-word-list-header {
            padding: 8px 12px;
            background: #181825;
            font-size: 11px;
            color: #6c7086;
            border-bottom: 1px solid #313244;
            flex-shrink: 0;
        }
        #dc-word-list {
            overflow-y: auto;
            flex: 1;
            padding: 6px 0;
        }
        .dc-word-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 5px 12px;
            cursor: pointer;
            border-left: 3px solid transparent;
            transition: background 0.1s;
        }
        .dc-word-item:hover { background: #313244; }
        .dc-word-item.active {
            background: #313244;
            border-left-color: #89b4fa;
        }
        .dc-word-name {
            font-weight: bold;
            color: #cdd6f4;
            font-size: 13px;
        }
        .dc-word-count {
            font-size: 11px;
            color: #6c7086;
            background: #313244;
            padding: 1px 6px;
            border-radius: 10px;
        }
        .dc-word-item.active .dc-word-count {
            background: #89b4fa;
            color: #1e1e2e;
        }

        /* 오른쪽: 차트 + 게시글 */
        #dc-detail-wrap {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        #dc-chart-area {
            padding: 14px 18px 8px;
            flex-shrink: 0;
        }
        #dc-chart-title {
            font-size: 12px;
            color: #a6adc8;
            margin-bottom: 8px;
        }
        #dc-bar-chart {
            display: flex;
            align-items: flex-end;
            gap: 4px;
            height: 80px;
        }
        .dc-bar-col {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
        }
        .dc-bar {
            width: 100%;
            background: #89b4fa;
            border-radius: 3px 3px 0 0;
            min-height: 2px;
            transition: height 0.3s;
            cursor: pointer;
            position: relative;
        }
        .dc-bar:hover { background: #74c7ec; }
        .dc-bar.selected { background: #f38ba8; }
        .dc-bar-label {
            font-size: 9px;
            color: #6c7086;
            margin-top: 3px;
            white-space: nowrap;
        }
        .dc-bar-val {
            font-size: 9px;
            color: #a6adc8;
            margin-bottom: 1px;
        }

        #dc-post-area {
            flex: 1;
            overflow-y: auto;
            padding: 6px 18px 14px;
            border-top: 1px solid #313244;
        }
        #dc-post-area-title {
            font-size: 11px;
            color: #6c7086;
            margin: 8px 0 6px;
        }
        .dc-post-item {
            padding: 6px 10px;
            margin-bottom: 4px;
            background: #181825;
            border-radius: 6px;
            border-left: 3px solid #45475a;
            display: flex;
            align-items: baseline;
            gap: 8px;
            cursor: pointer;
            transition: background 0.1s;
        }
        .dc-post-item:hover { background: #313244; border-left-color: #89b4fa; }
        .dc-post-time {
            font-size: 10px;
            color: #6c7086;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .dc-post-title {
            font-size: 12px;
            color: #cdd6f4;
            line-height: 1.4;
        }
        .dc-post-title mark {
            background: #f9e2af;
            color: #1e1e2e;
            border-radius: 2px;
            padding: 0 1px;
        }
        .dc-empty { color: #585b70; font-size: 12px; padding: 12px 0; }

        #dc-close-btn {
            background: none;
            border: none;
            color: #6c7086;
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
        }
        #dc-close-btn:hover { color: #f38ba8; }

        #dc-progress-bar-wrap {
            height: 2px;
            background: #313244;
            flex-shrink: 0;
        }
        #dc-progress-bar {
            height: 100%;
            background: #89b4fa;
            width: 0%;
            transition: width 0.2s;
        }
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
    //  단어 빈도 분석
    // ─────────────────────────────────────────────
    function analyzeWords(posts, extraStopwords) {
        const wordMap = new Map(); // word -> [{post, count}]

        posts.forEach(post => {
            const words = tokenize(post.title);
            const wordSet = [...new Set(words)]; // 게시글당 1번만 카운트
            wordSet.forEach(word => {
                if (extraStopwords.has(word)) return;
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
    };

    function openPanel() {
        if (document.getElementById('dc-tracker-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'dc-tracker-overlay';
        overlay.innerHTML = `
            <div id="dc-tracker-panel">
                <div id="dc-tracker-header">
                    <h2>📊 단어 빈도 트래커</h2>
                    <button id="dc-close-btn" title="닫기">×</button>
                </div>
                <div id="dc-tracker-controls">
                    <label>페이지 수:</label>
                    <input id="dc-pages-input" type="number" min="1" max="30" value="5" />
                    <label>제외 단어 (쉼표 구분):</label>
                    <input id="dc-blacklist-input" type="text" placeholder="예: 긔, 띠니, 갤" />
                    <button id="dc-collect-btn">🔍 수집 시작</button>
                </div>
                <div id="dc-progress-bar-wrap"><div id="dc-progress-bar"></div></div>
                <div id="dc-tracker-status">수집 버튼을 눌러 분석을 시작하세요.</div>
                <div id="dc-tracker-body">
                    <div id="dc-word-list-wrap">
                        <div id="dc-word-list-header">상위 단어 (클릭하면 상세)</div>
                        <div id="dc-word-list"></div>
                    </div>
                    <div id="dc-detail-wrap">
                        <div id="dc-chart-area">
                            <div id="dc-chart-title">← 단어를 선택하면 시간대 차트가 표시됩니다</div>
                            <div id="dc-bar-chart"></div>
                        </div>
                        <div id="dc-post-area">
                            <div id="dc-post-area-title">게시글 목록</div>
                            <div id="dc-post-list"><p class="dc-empty">단어를 선택하세요.</p></div>
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

        const pages = parseInt(document.getElementById('dc-pages-input').value) || 5;
        const blStr = document.getElementById('dc-blacklist-input').value;
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

        setProgress(0);
        setStatus(`0 / ${pages} 페이지 수집 중...`);

        for (let p = 1; p <= pages; p++) {
            try {
                const url = buildListUrl(gallInfo, p);
                const doc = await fetchPage(url);
                const posts = parsePosts(doc);
                state.allPosts.push(...posts);
                setProgress(Math.round((p / pages) * 80));
                setStatus(`${p} / ${pages} 페이지 수집 중... (누적 ${state.allPosts.length}개)`);
                await sleep(300); // 서버 부하 방지
            } catch (e) {
                setStatus(`⚠️ ${p}페이지 수집 실패: ${e.message}`);
            }
        }

        setStatus('분석 중...');
        state.words = analyzeWords(state.allPosts, extraStopwords);
        setProgress(100);
        setStatus(`✅ 완료! 총 ${state.allPosts.length}개 게시글 / ${state.words.length}개 단어 분석`);

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
        state.words.forEach(([word, posts]) => {
            const item = document.createElement('div');
            item.className = 'dc-word-item';
            item.dataset.word = word;
            item.innerHTML = `<span class="dc-word-name">${escHtml(word)}</span><span class="dc-word-count">${posts.length}</span>`;
            item.addEventListener('click', () => selectWord(word));
            container.appendChild(item);
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
        const titleEl   = document.getElementById('dc-chart-title');
        if (!chartArea) return;

        titleEl.textContent = `"${word}" — 시간대별 등장 횟수 (막대 클릭 시 해당 시간대 게시글 필터)`;

        const hourly = getHourlyStats(posts);
        const maxCount = Math.max(...hourly.map(h => h.count), 1);

        chartArea.innerHTML = '';
        hourly.forEach(({ hour, count }) => {
            const col = document.createElement('div');
            col.className = 'dc-bar-col';

            const heightPct = Math.max((count / maxCount) * 70, count > 0 ? 4 : 0);
            const bar = document.createElement('div');
            bar.className = 'dc-bar' + (state.selectedHour === hour ? ' selected' : '');
            bar.style.height = heightPct + 'px';
            bar.title = `${hour}시: ${count}건`;

            bar.addEventListener('click', () => {
                if (state.selectedHour === hour) {
                    state.selectedHour = null;
                } else {
                    state.selectedHour = hour;
                }
                // 막대 selected 갱신
                document.querySelectorAll('.dc-bar').forEach((b, i) => {
                    b.classList.toggle('selected', i === (state.selectedHour));
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
        btn.innerHTML = '📊 단어 분석';
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

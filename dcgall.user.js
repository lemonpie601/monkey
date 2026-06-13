// ==UserScript==
// @name         디시인사이드 단어 빈도 트래커
// @namespace    http://tampermonkey.net/
// @version       5.1.2
// @description  디시인사이드 갤러리에서 자주 나오는 단어를 분석해주는 확장 프로그램
// @author       레몬파이
// @match        https://gall.dcinside.com/*/board/lists*
// @match        https://gall.dcinside.com/board/lists*
// @match        https://m.dcinside.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      gall.dcinside.com
// @connect      m.dcinside.com
// ==/UserScript==

(function () {
    'use strict';

    // ════════════════════════════════════════════════════════
    //  설정 (config)
    // ════════════════════════════════════════════════════════
    const config = {
        PANEL_ID:               'dc-wt-panel',
        TOGGLE_BTN_ID:          'dc-wt-toggle-btn',
        PANEL_POSITION_KEY:     'dc_wt_panel_pos',
        TOGGLE_BTN_POSITION_KEY:'dc_wt_toggle_pos',
        BLACKLIST_KEY:          'dc_wt_blacklist',
        MINI_OPEN_KEY:          'dc_wt_mini_open',
        FETCH_TIMEOUT:          12000,
        CHUNK_SIZE:             4,      // 병렬 페이지 수집 청크
        MAX_PAGES:              200,
        DEFAULT_PAGES:          5,
        AUTO_PAGES:             3,      // 미니 팝업 자동 수집 페이지 수
        MINI_WORDS:             8,      // 미니 팝업에 보여줄 단어 수
        MAX_WORDS:              50,

        // 갤슾에서 따온 딜레이 패턴
        DELAY: {
            PAGE_MIN:   500,
            PAGE_MAX:   1000,
            BODY_MIN:   700,
            BODY_MAX:   1400,
            RETRY_BASE: 3000,
        },
    };

    // ════════════════════════════════════════════════════════
    //  유틸 (갤슾 utils 패턴 차용)
    // ════════════════════════════════════════════════════════
    const utils = {
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        sleepRandom: (min, max) => utils.sleep(min + Math.random() * (max - min)),
        pad: n => String(n).padStart(2, '0'),
        escHtml: str => {
            const m = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#039;" };
            return str.replace(/[&<>"']/g, c => m[c]);
        },
        formatDate: d => {
            const now = new Date();
            const sameDay = d.toDateString() === now.toDateString();
            if (sameDay) return `${utils.pad(d.getHours())}:${utils.pad(d.getMinutes())}`;
            return `${d.getMonth()+1}/${d.getDate()} ${utils.pad(d.getHours())}:${utils.pad(d.getMinutes())}`;
        },
        isDarkMode: () => !!document.querySelector('#css-darkmode'),
    };

    // ════════════════════════════════════════════════════════
    //  불용어
    // ════════════════════════════════════════════════════════
    const STOPWORDS = new Set([
        // 1글자 조사/어미/감탄
        '이','가','을','를','은','는','의','에','도','만','와','과','로','고','며','나','든','면','서','야','아',
        '오','으','봐','봐','봄','봄','코','요','죠','죠','랑','뭐','왜','다','좀','더','안','잘','못',
        // 다음글자 포함 어미/불용어
        '에서','로','으로','까지','부터','한테','에게','이랑','라고','이라고','라는','이라는','하고','이고',
        '하다','이다','있다','없다','되다','것','수','그','이','저',
        '걸','거','건','게','어떻게','어디','누가','언제','어떤',
        '음','응','예','네','아니','아니요','네네','그냥','진짜','정말','너무',
        '근데','그리고','그러면','근머','긔',
        '내','내가','나','나는','우리','여기','저기','거기','지금','이제',
        '못','안','잘','더','제일','가장','많이','조금','약간','완전','엄청','되게',
        '하는','하면','하면서','하는데','하는게','해서','해도','하고','해요','합니다',
        '있어','없어','했어','했는데','됐어','인데','인지','인가','인거','임','인듯',
        '것도','것은','것을','것이','거야','거지','거든','거잖','거에','거임',
    ]);

    // ════════════════════════════════════════════════════════
    //  조사/어미 제거 (어근 추출)
    //  예) 띠니는→띠니, 좋아해→좋아, 먹으면→먹, 먹는데→먹
    // ════════════════════════════════════════════════════════
    // 긴 것부터 먼저 매칭 (짧은 접미사가 먼저 잘리는 걸 방지)
    const JOSA_SUFFIXES = [
        // ── 4글자+ ──
        '에서는','에서도','에서만','에서야','이라고','이라는','이라도','이라서',
        '으로서','으로도','으로만','이라며','이라면',
        '하는데','하는게','하는걸','하는지','하는가',
        '았었어','었었어','했었어',
        // ── 3글자 ──
        '에서','한테','에게','이랑','라고','라는','라도','라서','라며','라면',
        '에도','에만','에야','이고','이며','이나','이든','이면',
        '부터','까지','마다','조차','만큼','처럼','보다',
        '더러','보고',
        '으면','으며','으나','으니','으로',   // 으불규칙 어간 먼저 (면/며/나/니보다 앞)
        '는데','는지','는가','는걸','는게','니까','니깐',
        '들도','들은','들이','들을','들의','들만',
        '하고','하며','하여','하면','해도','해서','해야','하기','하지','하게',
        '이야','이에','이와',
        '은데','은지','은가','은걸','은게',
        '같이',
        '에는','에도','에만','에야','에의',
        // ── 2글자 ──
        '았어','었어','했어','겠어',
        '아서','어서',
        '아도','어도',
        '아야','어야',
        '아요','어요','해요',
        '하는',
        '들은','들이','들을','들의','들도','들만','들',
        '은','는','이','가','을','를','의','에','도','만','야','와','과',
        '랑','고','며','나','든','서','네',
        // ── 1글자 어미 ──
        '해','어','아',
        // 주의: '면'은 제거 — 으면/하면 형태로만 처리 (가면/쓰면 오탐 방지)
    ];

    // 어간 1글자까지 허용하는 어미 (먹+는데, 먹+으면 등 1글자 어간 가능)
    const ALLOW_SHORT_STEM = new Set([
        '는데','은데','는지','는가','는걸','는게',
        '으면','으며','으나','으니','으로',
    ]);

    function stemWord(word) {
        if (word.length <= 2) return word;
        for (const suf of JOSA_SUFFIXES) {
            if (!word.endsWith(suf)) continue;
            const stemLen = word.length - suf.length;
            const minLen  = ALLOW_SHORT_STEM.has(suf) ? 1 : 2;
            if (stemLen >= minLen) {
                return word.slice(0, stemLen);
            }
        }
        return word;
    }

    // ════════════════════════════════════════════════════════
    //  토크나이저
    // ════════════════════════════════════════════════════════
    // ㄱ-ㅎ (초성/종성 자음), ㅏ-ㅣ (모음)도 포함
    const JAMO_ONLY = /^[ㄱ-ㅎㅏ-ㅣ]+$/;  // 초성/모음만으로 이뤄진 토큰 → stemWord 스킵

    function tokenize(text) {
        const cleaned = text
            .replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-zA-Z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ').trim();
        return cleaned.split(' ').map(w => JAMO_ONLY.test(w) ? w : stemWord(w)).filter(w => {
            if (!w || /^\d+$/.test(w)) return false;
            if (STOPWORDS.has(w)) return false;
            // 초성/모음 단독 1글자는 버림 (ㄱ, ㄴ, ㅏ 등)
            if (w.length === 1 && JAMO_ONLY.test(w)) return false;
            // 완성형 한글 1글자는 허용 (짹, 헉, 앗 등 갤러리 특유 표현)
            return w.length >= 1;
        });
    }

    // ════════════════════════════════════════════════════════
    //  Levenshtein 거리 (오타/변형 클러스터링용)
    // ════════════════════════════════════════════════════════
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        // 길이 차이가 2 초과면 빠르게 포기
        if (Math.abs(m - n) > 2) return 99;
        const dp = Array.from({length: m+1}, (_, i) => [i, ...Array(n).fill(0)]);
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = a[i-1] === b[j-1]
                    ? dp[i-1][j-1]
                    : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
            }
        }
        return dp[m][n];
    }

    // 단어 목록을 클러스터로 묶기
    // 기준: 빈도 높은 단어를 대표로, 편집거리 1~2이면 같은 클러스터
    function clusterWords(wordMap) {
        // 빈도 내림차순 정렬
        const entries = [...wordMap.entries()].sort((a, b) => b[1].length - a[1].length);
        const clusters = [];   // [{rep, posts, members}]
        const assigned = new Set();

        for (const [word, posts] of entries) {
            if (assigned.has(word)) continue;

            // 새 클러스터 대표
            const cluster = { rep: word, posts: [...posts], members: [word] };
            assigned.add(word);

            // 아직 배정 안 된 단어 중 유사한 것 흡수
            const wordIsJamo = JAMO_ONLY.test(word);

            for (const [other, otherPosts] of entries) {
                if (assigned.has(other)) continue;

                const otherIsJamo = JAMO_ONLY.test(other);
                let match = false;

                if (wordIsJamo && otherIsJamo) {
                    // ── 초성어 클러스터링 ──
                    // 앞 N-1 글자가 같고 길이가 1 더 길면 흡수
                    // 예: ㄸㄴ(2) ← ㄸㄴㄷ/ㄸㄴㅁ/ㄸㄴㄴ(3)
                    //     ㄸㄴ(2) ← ㄸㄴ으로 시작하는 모든 변형
                    if (other.length === word.length + 1 && other.startsWith(word)) {
                        match = true;
                    } else if (word.length === other.length && word.length >= 3) {
                        // 같은 길이 3자+ 초성어: 앞 2글자 같으면 묶기
                        match = word.slice(0, 2) === other.slice(0, 2);
                    }
                } else if (!wordIsJamo && !otherIsJamo) {
                    // ── 일반 한글 단어 클러스터링 (기존 로직) ──
                    if (word.length <= 3 || other.length <= 3) continue;
                    if (Math.abs(word.length - other.length) > 1) continue;

                    const dist = levenshtein(word, other);
                    const sameFirst  = word[0] === other[0];
                    const sameSecond = word.length > 1 && word[1] === other[1];

                    match = word.length === 4
                        ? dist === 1 && sameFirst
                        : dist <= 2 && (sameFirst || sameSecond);
                }
                // 초성↔일반 혼합은 클러스터링 안 함

                if (match) {
                    const postSet = new Set(cluster.posts);
                    otherPosts.forEach(p => { if (!postSet.has(p)) cluster.posts.push(p); });
                    cluster.members.push(other);
                    assigned.add(other);
                }
            }

            clusters.push(cluster);
        }

        return clusters;
    }

    // ════════════════════════════════════════════════════════
    //  갤러리 정보 & URL
    // ════════════════════════════════════════════════════════
    const isMobile = location.hostname === 'm.dcinside.com';

    function getGalleryInfo() {
        if (isMobile) {
            const parts = location.pathname.split('/').filter(Boolean);
            if (parts.length < 2) return null;
            return { id: parts[1], type: parts[0], mobile: true };
        }
        const id = new URLSearchParams(location.search).get('id');
        if (!id) return null;
        let type = 'board';
        if (location.pathname.includes('/mgallery/')) type = 'mgallery';
        else if (location.pathname.includes('/mini/'))  type = 'mini';
        return { id, type, mobile: false };
    }

    function buildListUrl(gall, page) {
        if (gall.mobile) return `https://m.dcinside.com/${gall.type}/${gall.id}?page=${page}`;
        const base = 'https://gall.dcinside.com';
        if (gall.type === 'mgallery') return `${base}/mgallery/board/lists/?id=${gall.id}&page=${page}`;
        if (gall.type === 'mini')     return `${base}/mini/board/lists/?id=${gall.id}&page=${page}`;
        return `${base}/board/lists/?id=${gall.id}&page=${page}`;
    }

    // ════════════════════════════════════════════════════════
    //  네트워크 (갤슾 GM_xmlhttpRequest 패턴 그대로)
    // ════════════════════════════════════════════════════════
    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                timeout: config.FETCH_TIMEOUT,
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'ko-KR,ko;q=0.9',
                },
                onload:    res => resolve(res),
                onerror:   ()  => reject(new Error('네트워크 오류')),
                ontimeout: ()  => reject(new Error('요청 시간 초과')),
            });
        });
    }

    async function fetchPage(url, retry = 0) {
        const res = await gmFetch(url);
        if (res.status === 429 || res.status === 403 || res.status === 503) {
            if (retry < 3) {
                const wait = config.DELAY.RETRY_BASE * (retry + 1) + Math.random() * 2000;
                tracker.setStatus(`⏳ 서버 대기 중... (${Math.round(wait/1000)}초 후 재시도)`);
                await utils.sleep(wait);
                return fetchPage(url, retry + 1);
            }
            throw new Error(`서버 차단 (${res.status})`);
        }
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        return new DOMParser().parseFromString(res.responseText, 'text/html');
    }

    // ════════════════════════════════════════════════════════
    //  날짜 파싱
    // ════════════════════════════════════════════════════════
    function parseDate(str, refDate) {
        const m1 = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        const m2 = str.match(/(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
        const m3 = str.match(/^(\d{2}):(\d{2})$/);
        if (m1) return new Date(`${m1[1]}-${m1[2]}-${m1[3]}T${m1[4]}:${m1[5]}:00`);
        if (m2) return new Date(`20${m2[1]}-${m2[2]}-${m2[3]}T${m2[4]}:${m2[5]}:00`);
        if (m3) {
            const b = refDate || new Date();
            return new Date(b.getFullYear(), b.getMonth(), b.getDate(), +m3[1], +m3[2]);
        }
        return null;
    }

    // ════════════════════════════════════════════════════════
    //  포스트 파싱
    // ════════════════════════════════════════════════════════
    function parsePosts(doc) {
        const ref = new Date();
        if (isMobile) {
            return [...doc.querySelectorAll('li')].flatMap(li => {
                const a = li.querySelector('a.lt');
                const titleEl = li.querySelector('.subjectin');
                if (!a || !titleEl) return [];
                const title = titleEl.textContent.trim();
                const href  = a.getAttribute('href') || '';
                const allLi = [...li.querySelectorAll('li')];
                const timeLi = allLi.find(l => /^\d{2}:\d{2}$/.test(l.textContent.trim()));
                const dateLi = allLi.find(l => /^\d{2}\.\d{2}$/.test(l.textContent.trim()));
                let dateStr = '';
                if (timeLi) dateStr = timeLi.textContent.trim();
                else if (dateLi) {
                    const [mm, dd] = dateLi.textContent.trim().split('.');
                    dateStr = `${ref.getFullYear()}.${mm}.${dd} 00:00`;
                }
                const date = parseDate(dateStr, ref);
                return (title && date) ? [{ title, date, href }] : [];
            });
        }
        // PC
        return [...doc.querySelectorAll('.gall_list tbody tr.ub-content')].flatMap(row => {
            const titleEl = row.querySelector('.gall_tit a:not(.reply_num)');
            const dateEl  = row.querySelector('.gall_date');
            if (!titleEl || !dateEl) return [];
            const title   = titleEl.textContent.trim();
            const dateStr = dateEl.getAttribute('title') || dateEl.textContent.trim();
            const href    = titleEl.getAttribute('href') || '';
            const date    = parseDate(dateStr, ref);
            return (title && date) ? [{ title, date, href }] : [];
        });
    }

    // ════════════════════════════════════════════════════════
    //  본문 수집
    // ════════════════════════════════════════════════════════
    async function fetchPostBody(post) {
        if (post.body !== undefined) return;
        try {
            const url = post.href.startsWith('http')
                ? post.href
                : (isMobile ? 'https://m.dcinside.com' : 'https://gall.dcinside.com') + post.href;
            const doc = await fetchPage(url);
            const el = doc.querySelector('.write_div') || doc.querySelector('.write-content')
                     || doc.querySelector('.thum_txt') || doc.querySelector('.gall_content');
            post.body = el ? el.textContent.trim() : '';
        } catch {
            post.body = '';
        }
    }

    // ════════════════════════════════════════════════════════
    //  단어 분석
    //  반환: [{rep, posts, members}]  (클러스터 배열)
    // ════════════════════════════════════════════════════════
    function analyzeWords(posts, extraStop) {
        const wordMap = new Map();
        const isBlocked = w => [...extraStop].some(bl => bl && w.includes(bl));
        posts.forEach(post => {
            const text = post.title + (post.body ? ' ' + post.body : '');
            // stemWord 후 중복 제거 → 게시글당 같은 어근 1번 카운트
            [...new Set(tokenize(text))].forEach(word => {
                if (isBlocked(word)) return;
                if (!wordMap.has(word)) wordMap.set(word, []);
                wordMap.get(word).push(post);
            });
        });

        // 클러스터링 후 상위 MAX_WORDS
        return clusterWords(wordMap).slice(0, config.MAX_WORDS);
    }

    function getHourlyStats(posts) {
        const hours = Array.from({length:24}, (_,i) => ({hour:i, count:0}));
        posts.forEach(p => hours[p.date.getHours()].count++);
        return hours;
    }

    // ════════════════════════════════════════════════════════
    //  드래그 유틸 (갤슾 makeDraggable 패턴)
    // ════════════════════════════════════════════════════════
    function makeDraggable(handle, panel, posKey) {
        let startX, startY, origLeft, origTop, dragging = false;

        // 저장된 위치 복원 (GM_getValue는 동기)
        try {
            const saved = GM_getValue(posKey, null);
            if (saved) {
                const {top, left} = JSON.parse(saved);
                panel.style.top  = top;
                panel.style.left = left;
                panel.style.right  = 'auto';
                panel.style.bottom = 'auto';
            }
        } catch {}

        handle.style.cursor = 'grab';

        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left;
            origTop  = rect.top;
            panel.style.left   = origLeft + 'px';
            panel.style.top    = origTop  + 'px';
            panel.style.right  = 'auto';
            panel.style.bottom = 'auto';
            handle.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const newLeft = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  origLeft + dx));
            const newTop  = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, origTop  + dy));
            panel.style.left = newLeft + 'px';
            panel.style.top  = newTop  + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            handle.style.cursor = 'grab';
            GM_setValue(posKey, JSON.stringify({
                top:  panel.style.top,
                left: panel.style.left,
            }));
        });
    }

    // ════════════════════════════════════════════════════════
    //  테마 감지 (갤슾 updateTheme 패턴)
    // ════════════════════════════════════════════════════════
    function updateTheme(panel) {
        if (!panel) return;
        const dark = utils.isDarkMode();
        panel.classList.toggle('dc-wt-dark',  dark);
        panel.classList.toggle('dc-wt-light', !dark);
    }

    // ════════════════════════════════════════════════════════
    //  메인 컨트롤러 (tracker)
    // ════════════════════════════════════════════════════════
    const tracker = {
        panelEl:   null,   // 확장 패널
        miniEl:    null,   // 미니 팝업
        visible:   false,  // 확장 패널 표시 여부
        miniVisible: false,
        state: {
            words: [],
            selectedWord: null,
            selectedHour: null,
            allPosts: [],
            running: false,
        },

        // ── 토글: 미니 팝업 열기/닫기 ──
        togglePanel() {
            this.miniVisible ? this._hideMini() : this._showMini();
        },

        // ── 미니 팝업 ──
        _showMini() {
            if (!this.miniEl) this._buildMini();
            this.miniEl.style.display = 'flex';
            this.miniVisible = true;
            GM_setValue(config.MINI_OPEN_KEY, true);
            updateTheme(this.miniEl);
            this._updateToggleBtn(true);
            // 아직 수집 전이면 자동 수집
            if (this.state.words.length === 0 && !this.state.running) {
                setTimeout(() => this.startCollect(true), 150);
            } else if (this.state.words.length > 0) {
                this._renderMiniWords();
            }
        },
        _hideMini() {
            if (this.miniEl) this.miniEl.style.display = 'none';
            this.miniVisible = false;
            GM_setValue(config.MINI_OPEN_KEY, false);
            if (!this.visible) this._updateToggleBtn(false);
        },

        _buildMini() {
            const mini = document.createElement('div');
            mini.id = 'dc-wt-mini';
            mini.className = 'dc-wt-mini';
            mini.innerHTML = `
                <div class="dc-wt-mini-header">
                    <span class="dc-wt-mini-title">단어 분석</span>
                    <span class="dc-wt-mini-sub" id="dc-wt-mini-sub"></span>
                    <button class="dc-wt-mini-close" id="dc-wt-mini-close">✕</button>
                </div>
                <div class="dc-wt-mini-list" id="dc-wt-mini-list">
                    <div class="dc-wt-mini-loading" id="dc-wt-mini-loading">
                        <span class="dc-wt-mini-spinner"></span>
                        <span id="dc-wt-mini-status">수집 중...</span>
                    </div>
                </div>
                <div class="dc-wt-mini-bl-wrap">
                    <input id="dc-wt-mini-bl" class="dc-wt-mini-bl" type="text" placeholder="제외 단어 (쉼표 구분)" />
                </div>
                <div class="dc-wt-mini-footer">
                    <button class="dc-wt-mini-refresh" id="dc-wt-mini-refresh" title="다시 수집">↺</button>
                    <button class="dc-wt-mini-expand" id="dc-wt-mini-expand">확장 분석 →</button>
                </div>
            `;
            document.body.appendChild(mini);
            this.miniEl = mini;
            updateTheme(mini);

            // 미니 팝업 위치: 토글 버튼 왼쪽
            this._positionMini();

            // 저장된 블랙리스트 복원
            const miniBl = mini.querySelector('#dc-wt-mini-bl');
            miniBl.value = GM_getValue(config.BLACKLIST_KEY, '') || '';

            // 입력할 때마다 저장 (debounce)
            let blSaveTimer;
            miniBl.addEventListener('input', () => {
                clearTimeout(blSaveTimer);
                blSaveTimer = setTimeout(() => {
                    GM_setValue(config.BLACKLIST_KEY, miniBl.value);
                    // 확장 패널 블랙리스트 입력란도 동기화
                    const panelBl = document.getElementById('dc-wt-blacklist');
                    if (panelBl) panelBl.value = miniBl.value;
                }, 400);
            });

            mini.querySelector('#dc-wt-mini-close').addEventListener('click', () => this._hideMini());
            mini.querySelector('#dc-wt-mini-expand').addEventListener('click', () => {
                this._hideMini();
                this._showPanel();
            });
            mini.querySelector('#dc-wt-mini-refresh').addEventListener('click', () => {
                if (!this.state.running) this.startCollect(true);
            });

            // 토글 버튼 위치 변경 시 미니 팝업도 재배치
            const toggleBtn = document.getElementById(config.TOGGLE_BTN_ID);
            if (toggleBtn) {
                new MutationObserver(() => this._positionMini())
                    .observe(toggleBtn, { attributes: true, attributeFilter: ['style'] });
            }

            new MutationObserver(() => updateTheme(this.miniEl))
                .observe(document.head, { childList: true, subtree: true });
        },

        _positionMini() {
            if (!this.miniEl) return;
            const toggleBtn = document.getElementById(config.TOGGLE_BTN_ID);
            if (!toggleBtn) return;
            const r = toggleBtn.getBoundingClientRect();
            this.miniEl.style.top  = Math.max(8, r.top - 8) + 'px';
            this.miniEl.style.right = (window.innerWidth - r.left + 8) + 'px';
            this.miniEl.style.left  = 'auto';
        },

        _renderMiniWords() {
            const list   = document.getElementById('dc-wt-mini-list');
            const loading = document.getElementById('dc-wt-mini-loading');
            const sub    = document.getElementById('dc-wt-mini-sub');
            if (!list) return;
            if (loading) loading.style.display = 'none';
            if (sub) sub.textContent = `${config.AUTO_PAGES}p · ${this.state.allPosts.length}건`;

            const top = this.state.words.slice(0, config.MINI_WORDS);
            const max = top.length > 0 ? top[0].posts.length : 1;

            const existing = list.querySelectorAll('.dc-wt-mini-item');
            existing.forEach(e => e.remove());

            top.forEach((cluster, i) => {
                const item = document.createElement('div');
                item.className = 'dc-wt-mini-item';
                const pct = Math.round((cluster.posts.length / max) * 100);
                item.innerHTML = `
                    <span class="dc-wt-mini-rank">${i+1}</span>
                    <span class="dc-wt-mini-word">${utils.escHtml(cluster.rep)}</span>
                    <div class="dc-wt-mini-bar-wrap">
                        <div class="dc-wt-mini-bar" style="width:${pct}%"></div>
                    </div>
                    <span class="dc-wt-mini-count">${cluster.posts.length}</span>
                `;
                list.appendChild(item);
            });
        },

        setMiniStatus(msg) {
            const el = document.getElementById('dc-wt-mini-status');
            if (el) el.textContent = msg;
        },

        // ── 확장 패널 표시/숨기기 ──
        _showPanel() {
            if (!this.panelEl) this._buildPanel();
            this.panelEl.style.display = 'flex';
            this.visible = true;
            updateTheme(this.panelEl);
            this._updateToggleBtn(true);
            if (this.state.words.length > 0) {
                this._renderWordList();
                if (this.state.words.length > 0) this._selectWord(this.state.words[0].rep);
            } else if (!this.state.running) {
                setTimeout(() => this.startCollect(false), 300);
            }
        },
        hidePanel() {
            if (this.panelEl) this.panelEl.style.display = 'none';
            this.visible = false;
            this._updateToggleBtn(false);
        },
        _updateToggleBtn(active) {
            const btn = document.getElementById(config.TOGGLE_BTN_ID);
            if (btn) btn.classList.toggle('active', active);
        },

        // ── UI 빌드 ──
        _buildPanel() {
            const panel = document.createElement('div');
            panel.id = config.PANEL_ID;
            panel.className = 'dc-wt-panel';
            panel.innerHTML = `
                <div class="dc-wt-header" id="dc-wt-header">
                    <div class="dc-wt-header-left">
                        <span class="dc-wt-icon">▐▌</span>
                        <span class="dc-wt-title">단어 빈도 트래커</span>
                    </div>
                    <div class="dc-wt-header-right">
                        <button class="dc-wt-icon-btn" id="dc-wt-close-btn" title="닫기">✕</button>
                    </div>
                </div>
                <div class="dc-wt-controls">
                    <div class="dc-wt-ctrl-row">
                        <label class="dc-wt-label">페이지</label>
                        <input id="dc-wt-page-count" class="dc-wt-input dc-wt-num" type="number" min="1" max="200" value="${config.DEFAULT_PAGES}" />
                        <span class="dc-wt-unit">p</span>
                        <label class="dc-wt-label" style="margin-left:8px;">제외</label>
                        <input id="dc-wt-blacklist" class="dc-wt-input dc-wt-bl" type="text" placeholder="쉼표 구분  예) 긔, 띠니" />
                    </div>
                    <div class="dc-wt-ctrl-row">
                        <label class="dc-wt-toggle-wrap" title="각 게시글 본문을 추가 수집합니다 (속도 저하)">
                            <input type="checkbox" id="dc-wt-body-toggle" />
                            <span class="dc-wt-toggle-track"><span class="dc-wt-toggle-thumb"></span></span>
                            <span class="dc-wt-label">본문 포함</span>
                        </label>
                        <span class="dc-wt-body-warn">※ 페이지당 수집 시간 증가</span>
                        <button id="dc-wt-run-btn" class="dc-wt-run-btn">분석 시작</button>
                    </div>
                </div>
                <div class="dc-wt-progress-wrap"><div id="dc-wt-progress" class="dc-wt-progress-bar"></div></div>
                <div id="dc-wt-status" class="dc-wt-status">분석 시작 버튼을 눌러주세요.</div>
                <div class="dc-wt-mob-tabs" id="dc-wt-mob-tabs">
                    <div class="dc-wt-mob-tab active" data-tab="words">단어 목록</div>
                    <div class="dc-wt-mob-tab" data-tab="detail">차트 &amp; 게시글</div>
                </div>
                <div class="dc-wt-body">
                    <div class="dc-wt-word-panel" id="dc-wt-word-panel">
                        <div class="dc-wt-word-header">Top ${config.MAX_WORDS} 단어</div>
                        <div class="dc-wt-search-wrap">
                            <input id="dc-wt-word-search" class="dc-wt-search" type="text" placeholder="단어 검색..." />
                        </div>
                        <div id="dc-wt-word-list" class="dc-wt-word-list"></div>
                    </div>
                    <div class="dc-wt-detail-panel" id="dc-wt-detail-panel">
                        <div class="dc-wt-chart-area">
                            <div id="dc-wt-chart-title" class="dc-wt-chart-title">단어를 선택하면 <span id="dc-wt-chart-label" class="dc-wt-chart-label">시간대별 차트</span>가 표시됩니다</div>
                            <div id="dc-wt-bar-chart" class="dc-wt-bar-chart"></div>
                        </div>
                        <div id="dc-wt-post-area" class="dc-wt-post-area">
                            <div id="dc-wt-post-title" class="dc-wt-post-title">게시글</div>
                            <div id="dc-wt-post-list" class="dc-wt-post-list"><p class="dc-wt-empty">← 단어를 선택하세요</p></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);
            this.panelEl = panel;

            // 저장된 블랙리스트 (GM_getValue는 동기)
            const blInput = panel.querySelector('#dc-wt-blacklist');
            blInput.value = GM_getValue(config.BLACKLIST_KEY, '') || '';
            // 패널 입력 시 미니 팝업도 동기화
            blInput.addEventListener('input', () => {
                const miniBl = document.getElementById('dc-wt-mini-bl');
                if (miniBl) miniBl.value = blInput.value;
            });

            // 이벤트
            panel.querySelector('#dc-wt-close-btn').addEventListener('click', () => { this.hidePanel(); this._updateToggleBtn(false); });
            panel.querySelector('#dc-wt-run-btn').addEventListener('click', () => this.startCollect());
            panel.querySelector('#dc-wt-word-search').addEventListener('input', e => this._filterWords(e.target.value.trim()));
            panel.querySelector('#dc-wt-body-toggle').addEventListener('change', e => {
                panel.querySelector('.dc-wt-body-warn').style.display = e.target.checked ? 'inline' : 'none';
            });
            panel.querySelectorAll('.dc-wt-mob-tab').forEach(t =>
                t.addEventListener('click', () => this._switchMobTab(t.dataset.tab))
            );

            // 드래그 (갤슾 패턴)
            makeDraggable(panel.querySelector('#dc-wt-header'), panel, config.PANEL_POSITION_KEY);

            // 테마 변경 감지
            new MutationObserver(() => updateTheme(this.panelEl))
                .observe(document.head, { childList: true, subtree: true });
        },

        // ── 상태/진행 ──
        setStatus(msg) {
            const el = document.getElementById('dc-wt-status');
            if (el) el.textContent = msg;
        },
        setProgress(pct) {
            const el = document.getElementById('dc-wt-progress');
            if (el) el.style.width = pct + '%';
        },

        // ── 수집 & 분석 (갤슾 청크 패턴) ──
        // autoMode=true: AUTO_PAGES 페이지로 자동 수집 (패널 첫 오픈 시)
        async startCollect(autoMode = false) {
            if (this.state.running) return;
            this.state.running = true;

            const btn      = document.getElementById('dc-wt-run-btn');
            const blInput  = document.getElementById('dc-wt-blacklist');
            const bodyChk  = document.getElementById('dc-wt-body-toggle');
            const pageInp  = document.getElementById('dc-wt-page-count');

            if (btn) { btn.disabled = true; btn.textContent = '수집 중...'; }

            const pageCount = autoMode
                ? config.AUTO_PAGES
                : Math.max(1, Math.min(config.MAX_PAGES, parseInt(pageInp?.value) || config.DEFAULT_PAGES));
            // autoMode: 미니팝업 입력란 또는 저장된 값 우선 사용
            const miniBl  = document.getElementById('dc-wt-mini-bl');
            const blStr   = autoMode
                ? (miniBl?.value ?? GM_getValue(config.BLACKLIST_KEY, '') ?? '')
                : (blInput?.value || GM_getValue(config.BLACKLIST_KEY, '') || '');
            const includeBody = autoMode ? false : (bodyChk?.checked || false);
            const extraStop   = new Set(blStr.split(',').map(s => s.trim()).filter(Boolean));

            // 자동 모드면 페이지 입력란도 반영
            if (autoMode && pageInp) pageInp.value = pageCount;

            // 블랙리스트 저장 + 양쪽 입력란 동기화
            GM_setValue(config.BLACKLIST_KEY, blStr);
            if (miniBl && miniBl.value !== blStr) miniBl.value = blStr;
            if (blInput && blInput.value !== blStr) blInput.value = blStr;

            const gallInfo = getGalleryInfo();
            if (!gallInfo) {
                this.setStatus('❌ 갤러리 페이지에서만 사용 가능합니다.');
                if (btn) { btn.disabled = false; btn.textContent = '분석 시작'; }
                this.state.running = false;
                return;
            }

            this.state.allPosts   = [];
            this.state.words      = [];
            this.state.selectedWord = null;
            this.state.selectedHour = null;
            const wl = document.getElementById('dc-wt-word-list');
            const pl = document.getElementById('dc-wt-post-list');
            const bc = document.getElementById('dc-wt-bar-chart');
            if (wl) wl.innerHTML = '';
            if (pl) pl.innerHTML = '<p class="dc-wt-empty">← 단어를 선택하세요</p>';
            if (bc) bc.innerHTML = '';

            this.setProgress(0);
            const autoLabel = autoMode ? ` (자동 ${pageCount}p)` : '';
            this.setStatus(`페이지 수집 중... (1~${pageCount}p)${autoLabel}`);
            if (autoMode) this.setMiniStatus(`${pageCount}p 수집 중...`);

            // ── 페이지 수집: 청크 병렬 (갤슾 CHUNK_SIZE 패턴) ──
            const pages = Array.from({length: pageCount}, (_, i) => i + 1);
            let done = 0;

            for (let ci = 0; ci < pages.length; ci += config.CHUNK_SIZE) {
                const chunk = pages.slice(ci, ci + config.CHUNK_SIZE);
                const results = await Promise.all(
                    chunk.map(page =>
                        fetchPage(buildListUrl(gallInfo, page))
                            .then(doc => parsePosts(doc))
                            .catch(() => [])
                    )
                );
                results.forEach(posts => this.state.allPosts.push(...posts));
                done += chunk.length;
                const pct = Math.round((done / pageCount) * (includeBody ? 55 : 80));
                this.setProgress(pct);
                this.setStatus(`${Math.min(done, pageCount)} / ${pageCount}p 수집 완료 (${this.state.allPosts.length}개)`);

                if (ci + config.CHUNK_SIZE < pages.length) {
                    await utils.sleepRandom(config.DELAY.PAGE_MIN, config.DELAY.PAGE_MAX);
                }
            }

            if (this.state.allPosts.length === 0) {
                this.setStatus('❌ 게시글을 찾지 못했습니다.');
                this.setProgress(0);
                if (btn) { btn.disabled = false; btn.textContent = '분석 시작'; }
                this.state.running = false;
                return;
            }

            // ── 본문 수집 ──
            if (includeBody) {
                this.setStatus(`본문 수집 중... (0 / ${this.state.allPosts.length})`);
                const BCHUNK = 3;
                for (let i = 0; i < this.state.allPosts.length; i += BCHUNK) {
                    const c = this.state.allPosts.slice(i, i + BCHUNK);
                    await Promise.all(c.map(p => fetchPostBody(p)));
                    const bdone = Math.min(i + BCHUNK, this.state.allPosts.length);
                    this.setProgress(55 + Math.round((bdone / this.state.allPosts.length) * 25));
                    this.setStatus(`본문 수집 중... (${bdone} / ${this.state.allPosts.length})`);
                    await utils.sleepRandom(config.DELAY.BODY_MIN, config.DELAY.BODY_MAX);
                }
            }

            // ── 분석 ──
            this.setStatus('분석 중...');
            this.state.words = analyzeWords(this.state.allPosts, extraStop);
            this.setProgress(100);

            const mode = includeBody ? '제목+본문' : '제목';
            this.setStatus(`✅ ${pageCount}p · ${this.state.allPosts.length}개 게시글 · ${this.state.words.length}개 단어 (${mode})`);

            this._renderWordList();
            if (btn) { btn.disabled = false; btn.textContent = '분석 시작'; }
            this.state.running = false;

            // 미니 팝업도 업데이트
            if (autoMode && this.miniVisible) this._renderMiniWords();

            if (this.state.words.length > 0) this._selectWord(this.state.words[0].rep);
        },

        // ── 단어 목록 렌더 ──
        _renderWordList() {
            const container = document.getElementById('dc-wt-word-list');
            if (!container) return;
            container.innerHTML = '';
            this.state.words.forEach((cluster, idx) => {
                const {rep, posts, members} = cluster;
                const hasVariants = members.length > 1;
                const item = document.createElement('div');
                item.className = 'dc-wt-word-item';
                item.dataset.word = rep;
                // 변형어가 있으면 대표어 옆에 묶음 표시
                const variantHtml = hasVariants
                    ? `<span class="dc-wt-variant-badge" title="${members.map(utils.escHtml).join(', ')}">+${members.length - 1}</span>`
                    : '';
                item.innerHTML = `
                    <span class="dc-wt-rank">${idx+1}</span>
                    <span class="dc-wt-wname">${utils.escHtml(rep)}${variantHtml}</span>
                    <span class="dc-wt-wcount">${posts.length}</span>
                `;
                item.addEventListener('click', () => this._selectWord(rep));
                container.appendChild(item);
            });
        },

        _filterWords(q) {
            document.querySelectorAll('.dc-wt-word-item').forEach(item => {
                const word = item.dataset.word || '';
                const show = !q || word.toLowerCase().includes(q.toLowerCase());
                item.style.display = show ? '' : 'none';
                const nameEl = item.querySelector('.dc-wt-wname');
                if (nameEl) {
                    if (q && show) {
                        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        nameEl.innerHTML = utils.escHtml(word).replace(
                            new RegExp(`(${esc})`, 'gi'),
                            '<mark class="dc-wt-search-hl">$1</mark>'
                        );
                    } else {
                        nameEl.textContent = word;
                    }
                }
            });
        },

        _selectWord(rep) {
            this.state.selectedWord = rep;
            this.state.selectedHour = null;
            document.querySelectorAll('.dc-wt-word-item').forEach(el =>
                el.classList.toggle('active', el.dataset.word === rep)
            );
            const cluster = this.state.words.find(c => c.rep === rep);
            if (!cluster) return;
            this._renderChart(cluster);
            this._renderPosts(cluster);
            if (window.innerWidth <= 640) this._switchMobTab('detail');
        },

        _renderChart(cluster) {
            const {rep, posts, members} = cluster;
            const area  = document.getElementById('dc-wt-bar-chart');
            const label = document.getElementById('dc-wt-chart-label');
            if (!area) return;
            if (label) {
                const variantStr = members.length > 1
                    ? ` <span class="dc-wt-chart-variants">(${members.join(', ')})</span>`
                    : '';
                label.innerHTML = `"${utils.escHtml(rep)}" 시간대별 분포${variantStr}`;
            }

            const hourly = getHourlyStats(posts);
            const max = Math.max(...hourly.map(h => h.count), 1);
            area.innerHTML = '';

            hourly.forEach(({hour, count}) => {
                const col = document.createElement('div');
                col.className = 'dc-wt-bar-col';

                const val = document.createElement('div');
                val.className = 'dc-wt-bar-val';
                val.textContent = count > 0 ? count : '';

                const bar = document.createElement('div');
                bar.className = 'dc-wt-bar' + (this.state.selectedHour === hour ? ' selected' : '');
                bar.style.height = Math.max((count/max)*70, count > 0 ? 4 : 0) + 'px';
                bar.dataset.hour = hour;
                bar.title = `${hour}시: ${count}건`;
                bar.addEventListener('click', () => {
                    this.state.selectedHour = (this.state.selectedHour === hour) ? null : hour;
                    document.querySelectorAll('.dc-wt-bar').forEach(b =>
                        b.classList.toggle('selected', +b.dataset.hour === this.state.selectedHour)
                    );
                    const cur = this.state.words.find(c => c.rep === this.state.selectedWord);
                    if (cur) this._renderPosts(cur);
                });

                const lbl = document.createElement('div');
                lbl.className = 'dc-wt-bar-lbl';
                lbl.textContent = hour + '시';

                col.appendChild(val);
                col.appendChild(bar);
                col.appendChild(lbl);
                area.appendChild(col);
            });
        },

        _renderPosts(cluster) {
            const {rep, posts, members} = cluster;
            const container = document.getElementById('dc-wt-post-list');
            const titleEl   = document.getElementById('dc-wt-post-title');
            if (!container) return;

            let filtered = posts;
            if (this.state.selectedHour !== null) {
                filtered = posts.filter(p => p.date.getHours() === this.state.selectedHour);
                if (titleEl) titleEl.textContent = `${this.state.selectedHour}시 게시글 (${filtered.length}건)`;
            } else {
                if (titleEl) titleEl.textContent = `전체 게시글 (${posts.length}건) — 막대 클릭 시 필터`;
            }

            if (!filtered.length) {
                container.innerHTML = '<p class="dc-wt-empty">해당 시간대 게시글이 없습니다.</p>';
                return;
            }

            // 모든 변형어를 하이라이트할 수 있도록 패턴 생성
            const hlPattern = new RegExp(
                members.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
                'g'
            );

            const sorted = [...filtered].sort((a, b) => b.date - a.date);
            container.innerHTML = '';
            sorted.forEach(post => {
                const highlighted = utils.escHtml(post.title)
                    .replace(hlPattern, m => `<mark class="dc-wt-post-hl">${utils.escHtml(m)}</mark>`);

                const item = document.createElement('div');
                item.className = 'dc-wt-post-item';
                item.innerHTML = `
                    <span class="dc-wt-post-time">${utils.formatDate(post.date)}</span>
                    <span class="dc-wt-post-text">${highlighted}</span>
                `;
                if (post.href) {
                    item.addEventListener('click', () => {
                        const url = post.href.startsWith('http') ? post.href : 'https://gall.dcinside.com' + post.href;
                        window.open(url, '_blank');
                    });
                }
                container.appendChild(item);
            });
        },

        _switchMobTab(tab) {
            const wordPanel   = document.getElementById('dc-wt-word-panel');
            const detailPanel = document.getElementById('dc-wt-detail-panel');
            document.querySelectorAll('.dc-wt-mob-tab').forEach(t =>
                t.classList.toggle('active', t.dataset.tab === tab)
            );
            if (wordPanel)   wordPanel.classList.toggle('dc-wt-hidden', tab !== 'words');
            if (detailPanel) detailPanel.classList.toggle('dc-wt-hidden', tab !== 'detail');
        },
    };

    // ════════════════════════════════════════════════════════
    //  스타일 (갤슾처럼 다크/라이트 CSS 변수 분리)
    // ════════════════════════════════════════════════════════
    GM_addStyle(`
        /* ── 플로팅 토글 버튼 ── */
        #${config.TOGGLE_BTN_ID} {
            position: fixed;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            z-index: 999989;
            width: 40px;
            height: 40px;
            background: #6366f1;
            color: #fff;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            box-shadow: 0 2px 12px rgba(99,102,241,0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            transition: background 0.15s, box-shadow 0.15s, transform 0.15s;
            user-select: none;
            font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
            line-height: 1;
        }
        #${config.TOGGLE_BTN_ID}:hover {
            background: #4f46e5;
            box-shadow: 0 4px 18px rgba(99,102,241,0.65);
            transform: translateY(-50%) scale(1.08);
        }
        #${config.TOGGLE_BTN_ID}.active {
            background: #4f46e5;
            box-shadow: 0 0 0 3px rgba(99,102,241,0.35), 0 2px 12px rgba(99,102,241,0.4);
        }

        /* ── 패널 공통 ── */
        #${config.PANEL_ID} {
            position: fixed;
            top: 60px;
            right: 20px;
            width: 860px;
            max-width: 96vw;
            height: 560px;
            max-height: 88vh;
            border-radius: 14px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
            font-size: 13px;
            z-index: 999990;
            box-shadow: 0 16px 48px rgba(0,0,0,0.5);
            animation: dc-wt-in 0.18s ease;
            resize: both;
        }
        @keyframes dc-wt-in { from { opacity:0; transform: scale(0.97) } to { opacity:1; transform: scale(1) } }

        /* ── 다크 테마 (기본) ── */
        #${config.PANEL_ID}.dc-wt-dark {
            --bg:       #13131a;
            --bg2:      #0f0f1a;
            --bg3:      #1a1a2e;
            --border:   rgba(255,255,255,0.07);
            --text:     #e2e4f0;
            --text2:    #6b6b9a;
            --text3:    #3a3a5a;
            --accent:   #a78bfa;
            --accent2:  #6366f1;
            --item-bg:  rgba(255,255,255,0.03);
            --item-hover: rgba(99,102,241,0.1);
            --item-active: rgba(99,102,241,0.15);
            --word-bg:  rgba(255,255,255,0.04);
            --word-act: rgba(99,102,241,0.3);
            --input-bg: #1e1e30;
            --bar-col:  linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
            --bar-sel:  linear-gradient(180deg, #f472b6 0%, #ec4899 100%);
            border: 1px solid rgba(255,255,255,0.08);
            background: #13131a;
            color: #e2e4f0;
        }

        /* ── 라이트 테마 ── */
        #${config.PANEL_ID}.dc-wt-light {
            --bg:       #ffffff;
            --bg2:      #f5f5f7;
            --bg3:      #ebebf0;
            --border:   rgba(0,0,0,0.1);
            --text:     #1a1a2e;
            --text2:    #5a5a7a;
            --text3:    #9a9ab8;
            --accent:   #6366f1;
            --accent2:  #4f46e5;
            --item-bg:  rgba(0,0,0,0.02);
            --item-hover: rgba(99,102,241,0.07);
            --item-active: rgba(99,102,241,0.12);
            --word-bg:  rgba(0,0,0,0.05);
            --word-act: rgba(99,102,241,0.2);
            --input-bg: #f0f0f8;
            --bar-col:  linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
            --bar-sel:  linear-gradient(180deg, #f472b6 0%, #ec4899 100%);
            border: 1px solid rgba(0,0,0,0.12);
            background: #ffffff;
            color: #1a1a2e;
        }

        .dc-wt-panel { background: var(--bg); color: var(--text); }

        /* ── 헤더 ── */
        .dc-wt-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px 11px;
            background: var(--bg3);
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
            user-select: none;
        }
        .dc-wt-header-left { display: flex; align-items: center; gap: 8px; }
        .dc-wt-icon { font-size: 13px; color: var(--accent); font-weight: 900; letter-spacing: -2px; }
        .dc-wt-title { font-size: 14px; font-weight: 700; color: var(--accent); letter-spacing: -0.3px; }
        .dc-wt-header-right { display: flex; align-items: center; gap: 6px; }
        .dc-wt-icon-btn {
            width: 26px; height: 26px;
            background: var(--item-bg);
            border: 1px solid var(--border);
            border-radius: 7px;
            color: var(--text2);
            font-size: 14px;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: background 0.12s, color 0.12s;
            line-height: 1;
        }
        .dc-wt-icon-btn:hover { background: rgba(236,72,153,0.15); color: #f472b6; border-color: rgba(236,72,153,0.3); }

        /* ── 컨트롤 ── */
        .dc-wt-controls {
            display: flex; flex-direction: column; gap: 6px;
            padding: 9px 16px; background: var(--bg2);
            border-bottom: 1px solid var(--border);
            flex-shrink: 0;
        }
        .dc-wt-ctrl-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .dc-wt-label { color: var(--text2); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
        .dc-wt-input {
            padding: 4px 8px; border-radius: 6px;
            border: 1px solid var(--border);
            background: var(--input-bg); color: var(--text);
            font-size: 12px; outline: none;
            transition: border-color 0.15s;
        }
        .dc-wt-input:focus { border-color: var(--accent2); }
        .dc-wt-num  { width: 50px; text-align: center; }
        .dc-wt-bl   { flex: 1; min-width: 130px; }
        .dc-wt-bl::placeholder { color: var(--text3); }
        .dc-wt-unit { font-size: 10px; color: var(--text3); }

        /* ── 토글 스위치 ── */
        .dc-wt-toggle-wrap { display: flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; white-space: nowrap; }
        .dc-wt-toggle-wrap input { display: none; }
        .dc-wt-toggle-track {
            width: 28px; height: 15px;
            background: var(--bg3); border-radius: 20px;
            position: relative; transition: background 0.2s; flex-shrink: 0;
            border: 1px solid var(--border);
        }
        .dc-wt-toggle-thumb {
            position: absolute; top: 2px; left: 2px;
            width: 9px; height: 9px;
            background: var(--text3); border-radius: 50%;
            transition: transform 0.2s, background 0.2s;
        }
        .dc-wt-toggle-wrap input:checked + .dc-wt-toggle-track { background: var(--accent2); }
        .dc-wt-toggle-wrap input:checked + .dc-wt-toggle-track .dc-wt-toggle-thumb { transform: translateX(13px); background: #fff; }
        .dc-wt-body-warn { font-size: 10px; color: #f59e0b; display: none; }

        /* ── 실행 버튼 ── */
        .dc-wt-run-btn {
            padding: 5px 14px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            color: #fff; border: none; border-radius: 6px;
            cursor: pointer; font-weight: 700; font-size: 12px;
            letter-spacing: 0.2px;
            transition: opacity 0.15s, transform 0.1s;
            box-shadow: 0 2px 8px rgba(99,102,241,0.3);
            white-space: nowrap; margin-left: auto;
        }
        .dc-wt-run-btn:hover { opacity: 0.85; transform: translateY(-1px); }
        .dc-wt-run-btn:disabled { background: var(--bg3); box-shadow: none; cursor: wait; color: var(--text3); }

        /* ── 진행 바 ── */
        .dc-wt-progress-wrap { height: 2px; background: var(--bg2); flex-shrink: 0; }
        .dc-wt-progress-bar { height: 100%; background: linear-gradient(90deg, #6366f1, #a78bfa); width: 0%; transition: width 0.25s ease; border-radius: 0 2px 2px 0; }

        /* ── 상태 ── */
        .dc-wt-status { padding: 5px 16px; font-size: 11px; color: var(--text3); flex-shrink: 0; min-height: 22px; letter-spacing: 0.1px; }

        /* ── 바디 ── */
        .dc-wt-body { display: flex; flex: 1; overflow: hidden; }

        /* ── 단어 패널 ── */
        .dc-wt-word-panel {
            width: 195px; min-width: 150px;
            border-right: 1px solid var(--border);
            display: flex; flex-direction: column; overflow: hidden;
            background: var(--bg2);
        }
        .dc-wt-word-header { padding: 9px 12px 7px; font-size: 10px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.8px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .dc-wt-search-wrap { padding: 6px 9px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
        .dc-wt-search {
            width: 100%; box-sizing: border-box;
            padding: 4px 7px;
            background: var(--item-bg); border: 1px solid var(--border);
            border-radius: 5px; color: var(--text); font-size: 11px; outline: none;
            transition: border-color 0.15s;
        }
        .dc-wt-search:focus { border-color: var(--accent2); }
        .dc-wt-search::placeholder { color: var(--text3); }
        .dc-wt-word-list { overflow-y: auto; flex: 1; padding: 4px 0; }
        .dc-wt-word-list::-webkit-scrollbar { width: 4px; }
        .dc-wt-word-list::-webkit-scrollbar-track { background: transparent; }
        .dc-wt-word-list::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }
        .dc-wt-word-list::-webkit-scrollbar-thumb:hover { background: var(--accent2); }

        .dc-wt-word-item {
            display: flex; align-items: center; justify-content: space-between;
            padding: 7px 12px; cursor: pointer;
            border-left: 2px solid transparent;
            transition: background 0.1s, border-color 0.1s; gap: 5px;
        }
        .dc-wt-word-item:hover { background: var(--item-hover); }
        .dc-wt-word-item.active { background: var(--item-active); border-left-color: var(--accent); }
        .dc-wt-rank { font-size: 10px; color: var(--text3); width: 16px; flex-shrink: 0; text-align: right; }
        .dc-wt-word-item.active .dc-wt-rank { color: var(--text2); }
        .dc-wt-wname { font-weight: 600; color: var(--text2); font-size: 13px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-wt-word-item.active .dc-wt-wname { color: var(--text); }
        .dc-wt-wcount { font-size: 10px; font-weight: 700; color: var(--text3); background: var(--word-bg); padding: 2px 6px; border-radius: 20px; flex-shrink: 0; }
        .dc-wt-word-item.active .dc-wt-wcount { background: var(--word-act); color: var(--accent); }
        .dc-wt-search-hl { background: rgba(99,102,241,0.3); color: var(--accent); border-radius: 2px; padding: 0 1px; }

        /* ── 변형어 배지 ── */
        .dc-wt-variant-badge {
            display: inline-block;
            margin-left: 4px;
            font-size: 9px;
            font-weight: 700;
            color: var(--accent2);
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.3);
            border-radius: 10px;
            padding: 0 5px;
            vertical-align: middle;
            cursor: help;
            line-height: 16px;
        }
        .dc-wt-word-item.active .dc-wt-variant-badge {
            background: rgba(99,102,241,0.3);
            border-color: var(--accent);
            color: var(--accent);
        }
        /* 차트 제목 옆 변형어 목록 */
        .dc-wt-chart-variants {
            font-size: 10px;
            color: var(--text3);
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
        }

        /* ── 디테일 패널 ── */
        .dc-wt-detail-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

        /* ── 차트 ── */
        .dc-wt-chart-area { padding: 14px 18px 10px; flex-shrink: 0; border-bottom: 1px solid var(--border); }
        .dc-wt-chart-title { font-size: 11px; color: var(--text2); margin-bottom: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
        .dc-wt-chart-label { color: var(--accent); font-weight: 700; text-transform: none; letter-spacing: 0; }
        .dc-wt-bar-chart { display: flex; align-items: flex-end; gap: 3px; height: 86px; }
        .dc-wt-bar-col { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
        .dc-wt-bar {
            width: 100%; background: var(--bar-col);
            border-radius: 4px 4px 0 0; min-height: 2px;
            transition: height 0.3s cubic-bezier(0.34,1.2,0.64,1); cursor: pointer;
        }
        .dc-wt-bar:hover { filter: brightness(1.25); }
        .dc-wt-bar.selected { background: var(--bar-sel); box-shadow: 0 0 8px rgba(236,72,153,0.4); }
        .dc-wt-bar-val { font-size: 9px; color: var(--accent2); margin-bottom: 2px; font-weight: 700; min-height: 11px; }
        .dc-wt-bar-lbl { font-size: 8px; color: var(--text3); margin-top: 3px; white-space: nowrap; font-weight: 600; }
        .dc-wt-bar-col:has(.dc-wt-bar.selected) .dc-wt-bar-val { color: #f472b6; }

        /* ── 게시글 ── */
        .dc-wt-post-area { flex: 1; overflow-y: auto; padding: 8px 14px 14px; }
        .dc-wt-post-area::-webkit-scrollbar { width: 4px; }
        .dc-wt-post-area::-webkit-scrollbar-track { background: transparent; }
        .dc-wt-post-area::-webkit-scrollbar-thumb { background: var(--bg3); border-radius: 4px; }
        .dc-wt-post-area::-webkit-scrollbar-thumb:hover { background: var(--accent2); }
        .dc-wt-post-title { font-size: 10px; font-weight: 700; color: var(--text3); text-transform: uppercase; letter-spacing: 0.8px; margin: 6px 0 6px 2px; }
        .dc-wt-post-list { display: flex; flex-direction: column; gap: 4px; }
        .dc-wt-post-item {
            padding: 7px 11px; background: var(--item-bg);
            border: 1px solid var(--border); border-radius: 7px;
            display: flex; align-items: baseline; gap: 9px;
            cursor: pointer; transition: background 0.12s, border-color 0.12s, transform 0.1s;
        }
        .dc-wt-post-item:hover { background: var(--item-hover); border-color: rgba(99,102,241,0.25); transform: translateX(2px); }
        .dc-wt-post-time { font-size: 10px; color: var(--text3); white-space: nowrap; flex-shrink: 0; font-variant-numeric: tabular-nums; font-weight: 600; }
        .dc-wt-post-text { font-size: 12px; color: var(--text2); line-height: 1.45; }
        .dc-wt-post-hl { background: rgba(167,139,250,0.25); color: #c4b5fd; border-radius: 3px; padding: 0 2px; font-weight: 700; }
        .dc-wt-empty { color: var(--text3); font-size: 12px; padding: 20px 0; text-align: center; }
        .dc-wt-hidden { display: none !important; }

        /* ── 미니 팝업 ── */
        #dc-wt-mini {
            position: fixed;
            z-index: 999988;
            width: 220px;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
            font-size: 13px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.06);
            animation: dc-wt-mini-in 0.14s ease;
        }
        @keyframes dc-wt-mini-in { from { opacity:0; transform:scale(0.94) translateX(6px) } to { opacity:1; transform:scale(1) translateX(0) } }

        #dc-wt-mini.dc-wt-dark {
            --bg: #17172a; --bg2: #0f0f1a; --bg3: #1e1e32;
            --border: rgba(255,255,255,0.08); --text: #e2e4f0; --text2: #9090c0; --text3: #4a4a6a;
            --accent: #a78bfa; --accent2: #6366f1;
            --item-bg: rgba(255,255,255,0.03); --item-hover: rgba(99,102,241,0.1);
            background: #17172a; border: 1px solid rgba(255,255,255,0.08); color: #e2e4f0;
        }
        #dc-wt-mini.dc-wt-light {
            --bg: #fff; --bg2: #f5f5f7; --bg3: #eeeef3;
            --border: rgba(0,0,0,0.09); --text: #1a1a2e; --text2: #5a5a7a; --text3: #9090aa;
            --accent: #6366f1; --accent2: #4f46e5;
            --item-bg: rgba(0,0,0,0.02); --item-hover: rgba(99,102,241,0.07);
            background: #fff; border: 1px solid rgba(0,0,0,0.1); color: #1a1a2e;
        }

        .dc-wt-mini-header {
            display: flex; align-items: center; gap: 6px;
            padding: 9px 12px 8px;
            border-bottom: 1px solid var(--border);
            background: var(--bg3);
        }
        .dc-wt-mini-title { font-size: 12px; font-weight: 700; color: var(--accent); flex-shrink: 0; }
        .dc-wt-mini-sub   { font-size: 10px; color: var(--text3); flex: 1; }
        .dc-wt-mini-close {
            width: 20px; height: 20px; flex-shrink: 0;
            background: none; border: none;
            color: var(--text3); font-size: 12px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            border-radius: 4px; transition: background 0.1s, color 0.1s;
        }
        .dc-wt-mini-close:hover { background: rgba(236,72,153,0.15); color: #f472b6; }

        .dc-wt-mini-list { padding: 6px 0; min-height: 40px; }

        .dc-wt-mini-loading {
            display: flex; align-items: center; gap: 8px;
            padding: 12px 14px; color: var(--text3); font-size: 11px;
        }
        .dc-wt-mini-spinner {
            width: 12px; height: 12px; border-radius: 50%;
            border: 2px solid var(--bg3); border-top-color: var(--accent);
            animation: dc-wt-spin 0.7s linear infinite; flex-shrink: 0;
        }
        @keyframes dc-wt-spin { to { transform: rotate(360deg) } }

        .dc-wt-mini-item {
            display: flex; align-items: center; gap: 6px;
            padding: 5px 12px; cursor: default;
            transition: background 0.1s;
        }
        .dc-wt-mini-item:hover { background: var(--item-hover); }
        .dc-wt-mini-rank  { font-size: 9px; color: var(--text3); width: 12px; text-align: right; flex-shrink: 0; }
        .dc-wt-mini-word  { font-size: 12px; font-weight: 600; color: var(--text); width: 60px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dc-wt-mini-bar-wrap { flex: 1; height: 4px; background: var(--bg3); border-radius: 4px; overflow: hidden; }
        .dc-wt-mini-bar { height: 100%; background: var(--accent2); border-radius: 4px; transition: width 0.4s ease; }
        .dc-wt-mini-count { font-size: 10px; color: var(--text3); width: 22px; text-align: right; flex-shrink: 0; font-weight: 600; }

        .dc-wt-mini-bl-wrap {
            padding: 5px 10px 4px;
            border-top: 1px solid var(--border);
        }
        .dc-wt-mini-bl {
            width: 100%; box-sizing: border-box;
            padding: 4px 8px;
            background: var(--item-bg); border: 1px solid var(--border);
            border-radius: 5px; color: var(--text); font-size: 11px;
            font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
            outline: none; transition: border-color 0.15s;
        }
        .dc-wt-mini-bl:focus { border-color: var(--accent2); }
        .dc-wt-mini-bl::placeholder { color: var(--text3); }

        .dc-wt-mini-footer {
            display: flex; align-items: center; gap: 6px;
            padding: 7px 10px;
            border-top: 1px solid var(--border);
            background: var(--bg2);
        }
        .dc-wt-mini-refresh {
            width: 26px; height: 26px; flex-shrink: 0;
            background: var(--item-bg); border: 1px solid var(--border);
            border-radius: 6px; color: var(--text3); font-size: 14px;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background 0.1s, color 0.1s;
        }
        .dc-wt-mini-refresh:hover { background: var(--item-hover); color: var(--accent); border-color: rgba(99,102,241,0.3); }
        .dc-wt-mini-expand {
            flex: 1; padding: 5px 0; text-align: center;
            background: var(--accent2); color: #fff; border: none; border-radius: 6px;
            font-size: 11px; font-weight: 700; cursor: pointer; letter-spacing: 0.2px;
            transition: opacity 0.15s;
        }
        .dc-wt-mini-expand:hover { opacity: 0.85; }

        /* ── 모바일 탭 ── */
        .dc-wt-mob-tabs { display: none; }
        @media (max-width: 640px) {
            #${config.PANEL_ID} { top: auto; right: 0; bottom: 0; left: 0; width: 100vw; max-width: 100vw; height: 90vh; max-height: 90vh; border-radius: 14px 14px 0 0; resize: none; }
            .dc-wt-mob-tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; }
            .dc-wt-mob-tab { flex: 1; padding: 9px 0; text-align: center; font-size: 12px; font-weight: 600; color: var(--text3); cursor: pointer; border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s; }
            .dc-wt-mob-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
            .dc-wt-body { flex-direction: column; position: relative; }
            .dc-wt-word-panel { width: 100%; border-right: none; flex: 1; min-height: 0; }
            .dc-wt-detail-panel { width: 100%; position: absolute; inset: 0; background: var(--bg); }
        }
    `);

    // ════════════════════════════════════════════════════════
    //  플로팅 토글 버튼 삽입 (갤슾 패턴 — body에 직접 붙임)
    // ════════════════════════════════════════════════════════
    function insertToggleButton() {
        if (document.getElementById(config.TOGGLE_BTN_ID)) return;
        if (!getGalleryInfo()) return;

        const btn = document.createElement('button');
        btn.id = config.TOGGLE_BTN_ID;
        btn.title = '단어 분석';
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg>`;
        btn.addEventListener('click', () => tracker.togglePanel());

        // 저장된 위치 복원 (갤슾 토글 버튼 위치 저장 패턴)
        try {
            const saved = GM_getValue(config.TOGGLE_BTN_POSITION_KEY, null);
            if (saved) {
                const {top} = JSON.parse(saved);
                btn.style.top = top;
                btn.style.transform = 'none';
            }
        } catch {}

        // 드래그 (상하만)
        let dragging = false, startY, origTop;
        btn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragging = true;
            startY = e.clientY;
            origTop = btn.getBoundingClientRect().top;
            btn.style.transform = 'none';
            btn.style.top = origTop + 'px';
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            const newTop = Math.max(10, Math.min(window.innerHeight - btn.offsetHeight - 10, origTop + (e.clientY - startY)));
            btn.style.top = newTop + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            GM_setValue(config.TOGGLE_BTN_POSITION_KEY, JSON.stringify({top: btn.style.top}));
        });

        document.body.appendChild(btn);
    }

    function init() {
        if (!getGalleryInfo()) return;
        insertToggleButton();
        // 이전 세션에서 미니 팝업이 열려있었으면 자동으로 다시 열기
        if (GM_getValue(config.MINI_OPEN_KEY, false)) {
            setTimeout(() => tracker._showMini(), 300);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // SPA 대응
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(init, 500);
        }
    }).observe(document.body, { childList: true, subtree: true });

})();

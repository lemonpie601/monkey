// ==UserScript==
// @name         엘린 로그 저장
// @namespace    https://elyn.ai/
// @version      6.6.0
// @description  텍스트 드래그 → 심플 카드 PNG 저장
// @author       레몬파이
// @match        https://elyn.ai/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // DPR: 캔버스 해상도 선명도용 (UI 크기와 무관)
    const DPR = window.devicePixelRatio || 1;

    GM_addStyle(`
        #els-bar {
            position: fixed; bottom: 80px; left: 50%;
            transform: translateX(-50%);
            display: none; align-items: center; gap: 8px;
            padding: 7px 12px; border-radius: 9999px;
            background: hsl(var(--popover) / 0.97);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            border: 1px solid hsl(var(--border) / 0.4);
            box-shadow: 0 8px 32px rgba(0,0,0,0.22);
            z-index: 2147483641 !important;
            font-family: Pretendard, 'Apple SD Gothic Neo', sans-serif;
            white-space: nowrap;
        }
        #els-prev-txt {
            max-width: 180px; font-size: 12px;
            color: hsl(var(--muted-foreground));
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        #els-open-btn {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 5px 14px; border-radius: 9999px; border: none; cursor: pointer;
            background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
            font-size: 12px; font-weight: 600; font-family: Pretendard, sans-serif;
            transition: opacity 0.15s; white-space: nowrap;
        }
        #els-open-btn:hover { opacity: 0.82; }
        #els-bar-close {
            background: none; border: none; cursor: pointer;
            color: hsl(var(--muted-foreground)); padding: 2px 5px;
            font-size: 13px; border-radius: 5px; transition: 0.15s; line-height: 1;
        }
        #els-bar-close:hover { color: hsl(var(--foreground)); }

        #els-ov {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
            z-index: 2147483645 !important;
            justify-content: center; align-items: center;
        }
        #els-ov.on { display: flex; }

        /* 패널: 뷰포트에 맞게 유동 */
        #els-pn {
            background: hsl(var(--popover));
            border: 1px solid hsl(var(--border) / 0.3);
            border-radius: 24px;
            padding: 20px;
            width: min(600px, 94vw);
            height: 80vh;
            box-shadow: 0 20px 60px rgba(0,0,0,0.35);
            display: flex; flex-direction: column; gap: 14px;
            font-family: Pretendard, sans-serif;
            overflow: hidden;
            box-sizing: border-box;
        }

        #els-cvw {
            flex: 1 1 0;
            min-height: 0;
            border-radius: 14px;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
        }
        /* 캔버스 CSS 크기: 컨테이너 안에서 비율 유지하며 최대한 크게 (contain) */
        #els-cvw canvas {
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: auto;
            display: block;
            border-radius: 14px;
        }

        #els-opts {
            flex: 0 0 auto;
            display: flex; flex-direction: column; gap: 14px;
        }

        .els-sec { display: flex; flex-direction: column; gap: 7px; }
        .els-sl {
            font-size: 10.5px; font-weight: 600; letter-spacing: 0.4px;
            color: hsl(var(--muted-foreground));
        }

        .els-bg-g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
        .els-al-g { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .els-pl {
            font-size: 12px; font-weight: 600; height: 32px;
            border-radius: 9999px; border: 1px solid transparent;
            cursor: pointer; transition: all 0.16s;
            background: hsl(var(--muted) / 0.4);
            color: hsl(var(--muted-foreground));
            font-family: Pretendard, sans-serif;
        }
        .els-pl:hover:not(.on) { background: hsl(var(--muted) / 0.7); color: hsl(var(--foreground)); }
        .els-pl.on {
            background: hsl(var(--primary) / 0.15);
            color: hsl(var(--primary));
            border-color: hsl(var(--primary) / 0.3);
        }

        .els-acd {
            width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
            border: 2.5px solid transparent; transition: 0.15s;
            box-shadow: 0 1px 4px rgba(0,0,0,0.15);
        }
        .els-acd.on { border-color: hsl(var(--foreground) / 0.6); transform: scale(1.2); }
        .els-acd:hover:not(.on) { transform: scale(1.1); }

        #els-rpl { display: flex; flex-direction: column; gap: 6px; }
        .els-rrow { display: flex; align-items: center; gap: 6px; }
        .els-ri {
            flex: 1; height: 32px; padding: 0 10px; border-radius: 10px;
            border: 1px solid hsl(var(--border) / 0.4);
            background: hsl(var(--muted) / 0.25);
            color: hsl(var(--foreground)); font-size: 12px; outline: none;
            font-family: Pretendard, sans-serif; transition: border-color 0.15s;
        }
        .els-ri:focus { border-color: hsl(var(--primary) / 0.5); }
        .els-ri::placeholder { color: hsl(var(--muted-foreground)); opacity: 0.55; }
        .els-rsep { font-size: 12px; color: hsl(var(--muted-foreground)); flex-shrink:0; opacity:0.5; }
        .els-rdel {
            background: none; border: none; cursor: pointer;
            color: hsl(var(--muted-foreground)); font-size: 13px;
            padding: 2px 5px; border-radius: 5px; transition: 0.15s;
        }
        .els-rdel:hover { color: hsl(0 72% 55%); }
        #els-radd {
            align-self: flex-start; font-size: 11.5px; font-weight: 600;
            padding: 4px 10px; border-radius: 8px; border: none; cursor: pointer;
            background: hsl(var(--muted) / 0.4); color: hsl(var(--muted-foreground));
            font-family: Pretendard, sans-serif; transition: 0.15s;
        }
        #els-radd:hover { background: hsl(var(--muted) / 0.7); color: hsl(var(--foreground)); }

        .els-div { height: 1px; background: hsl(var(--border) / 0.18); flex-shrink: 0; }

        .els-ab {
            padding: 9px 22px; border-radius: 9999px; border: none;
            font-size: 13px; font-weight: 600; cursor: pointer;
            font-family: Pretendard, sans-serif; transition: 0.15s;
        }
        .els-cn { background: hsl(var(--muted) / 0.45); color: hsl(var(--muted-foreground)); }
        .els-cn:hover { background: hsl(var(--muted) / 0.7); }
        .els-sv { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
        .els-sv:hover { opacity: 0.85; }

        #els-ts {
            position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
            background: hsl(var(--popover) / 0.97); backdrop-filter: blur(12px);
            color: hsl(var(--popover-foreground));
            padding: 10px 22px; border-radius: 9999px;
            z-index: 2147483647; font-size: 12.5px; font-weight: 600;
            border: 1px solid hsl(var(--border) / 0.4);
            font-family: Pretendard, sans-serif;
            opacity: 0; transition: opacity 0.2s; pointer-events: none;
        }
        #els-ts.on { opacity: 1; }
    `);

    // ==========================================
    // 설정
    // ==========================================
    const BGS = [
        { n:'화이트',  a:'#ffffff' },
        { n:'크림',    a:'#fdf8f0' },
        { n:'연보라',  a:'#f3f0ff' },
        { n:'차콜',    a:'#1e1e1e' },
        { n:'딥 블루', a:'#0f1523' },
        { n:'딥 그린', a:'#0c1a10' },
    ];
    const ACS = [
        '#7c3aed','#db2777','#2563eb','#059669',
        '#d97706','#dc2626','#0891b2','#374151',
    ];
    const THOUGHT_ACS = [
        '#a78bfa','#f9a8d4','#93c5fd','#6ee7b7',
        '#fcd34d','#fca5a5','#67e8f9','#9ca3af',
    ];
    const FNS = [
        { l:'기본체', v:'Pretendard, "Apple SD Gothic Neo", sans-serif' },
        { l:'명조체', v:'"Noto Serif KR", Georgia, serif' },
        { l:'고딕체', v:'"Nanum Gothic", "Malgun Gothic", sans-serif' },
    ];
    const ALIGNS = [
        { l:'양끝',   v:'justify' },
        { l:'왼쪽',   v:'left'    },
        { l:'가운데', v:'center'  },
        { l:'오른쪽', v:'right'   },
    ];

    let rp = GM_getValue('els_rp', []);
    let st = { bg:0, ac:0, fn:0, al:1 };
    let savedText = '';

    // ==========================================
    // 하단 바
    // ==========================================
    const bar = document.createElement('div');
    bar.id = 'els-bar';
    bar.innerHTML = `
        <span id="els-prev-txt" style="display:none"></span>
        <button id="els-open-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
                <circle cx="12" cy="13" r="3"/>
            </svg>카드 저장
        </button>
        <button id="els-bar-close">✕</button>
    `;
    document.body.appendChild(bar);

    // ==========================================
    // 모달
    // ==========================================
    const ov = document.createElement('div');
    ov.id = 'els-ov';

    const bgH = BGS.map((b,i) =>
        `<button class="els-pl${i===0?' on':''}" data-bg="${i}">${b.n}</button>`).join('');
    const acH = ACS.map((c,i) =>
        `<div class="els-acd${i===0?' on':''}" data-ac="${i}" style="background:${c}"></div>`).join('');
    const fnH = FNS.map((f,i) =>
        `<button class="els-pl${i===0?' on':''}" data-fn="${i}">${f.l}</button>`).join('');
    const alH = ALIGNS.map((a,i) =>
        `<button class="els-pl${i===1?' on':''}" data-al="${i}">${a.l}</button>`).join('');

    ov.innerHTML = `
        <div id="els-pn">
            <div id="els-cvw"></div>

            <div class="els-div"></div>

            <div id="els-opts">
                <div class="els-sec">
                    <div class="els-sl">배경</div>
                    <div class="els-bg-g">${bgH}</div>
                </div>
                <div class="els-sec">
                    <div class="els-sl">폰트</div>
                    <div class="els-bg-g">${fnH}</div>
                </div>

                <div class="els-div"></div>

                <div class="els-sec">
                    <div class="els-sl">
                        텍스트 치환
                        <span style="font-weight:400;opacity:0.5;margin-left:4px">PNG 저장 시 자동 적용</span>
                    </div>
                    <div id="els-rpl"></div>
                    <button id="els-radd">+ 치환 추가</button>
                </div>

                <div class="els-div"></div>

                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button class="els-ab els-cn" id="els-cnbtn">취소</button>
                    <button class="els-ab els-sv" id="els-svbtn">↓ PNG 저장</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(ov);

    // ==========================================
    // 치환
    // ==========================================
    function renderRp() {
        const el = document.getElementById('els-rpl');
        el.innerHTML = '';
        rp.forEach((r, i) => {
            const row = document.createElement('div');
            row.className = 'els-rrow';
            row.innerHTML = `
                <input class="els-ri" placeholder="찾을 텍스트" value="${esc(r.f)}">
                <span class="els-rsep">→</span>
                <input class="els-ri" placeholder="바꿀 텍스트" value="${esc(r.t)}">
                <button class="els-rdel" data-i="${i}">✕</button>
            `;
            const [fi, ti] = row.querySelectorAll('.els-ri');
            fi.addEventListener('input', () => { rp[i].f = fi.value; saveRp(); redraw(); });
            ti.addEventListener('input', () => { rp[i].t = ti.value; saveRp(); redraw(); });
            row.querySelector('.els-rdel').addEventListener('click', e => {
                e.stopPropagation();
                rp.splice(i, 1); saveRp(); renderRp(); redraw();
            });
            el.appendChild(row);
        });
    }
    function saveRp() { GM_setValue('els_rp', rp); }
    function esc(s) {
        return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
                      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    document.getElementById('els-radd').addEventListener('click', e => {
        e.stopPropagation();
        rp.push({f:'',t:''}); saveRp(); renderRp();
    });
    renderRp();

    function applyRp(text) {
        let t = text;
        rp.forEach(r => { if (r.f) t = t.split(r.f).join(r.t); });
        return t;
    }

    // ==========================================
    // 텍스트 토큰 파싱
    // ==========================================
    function parseTokens(text) {
        const tokens = [];
        const RE = /"([^"]*)"|'([^']*)'|'([^']*)'|\*([^*]+)\*/g;
        let last = 0, m;
        while ((m = RE.exec(text)) !== null) {
            if (m.index > last) tokens.push({ type:'normal',   text: text.slice(last, m.index) });
            if      (m[1] !== undefined) tokens.push({ type:'dialogue', text: '“' + m[1] + '”' });
            else if (m[2] !== undefined) tokens.push({ type:'thought',  text: "'"  + m[2] + "'"  });
            else if (m[3] !== undefined) tokens.push({ type:'thought',  text: '‘' + m[3] + '’' });
            else if (m[4] !== undefined) tokens.push({ type:'italic',   text: m[4] });
            last = m.index + m[0].length;
        }
        if (last < text.length) tokens.push({ type:'normal', text: text.slice(last) });
        return tokens;
    }

    // ==========================================
    // 토큰 단위 줄바꿈
    // ==========================================
    function wrapTokenLines(tc, tokens, maxW, fs, font) {
        if (!tokens.length) return [[{ type:'normal', text:'' }]];
        const lines = [];
        let curLine = [], curW = 0;

        function msr(type, str) {
            tc.font = `${type === 'italic' ? 'italic' : '400'} ${fs}px ${font}`;
            return tc.measureText(str).width;
        }
        function pushLine() { lines.push(curLine); curLine = []; curW = 0; }

        for (const tok of tokens) {
            if (!tok.text) { curLine.push({ type: tok.type, text: '' }); continue; }
            let buf = '';
            for (const ch of tok.text) {
                const wBuf = msr(tok.type, buf);
                const wCh  = msr(tok.type, ch);
                if (buf && curW + wBuf + wCh > maxW) {
                    curLine.push({ type: tok.type, text: buf });
                    pushLine();
                    buf  = ch;
                    curW = 0;
                } else {
                    buf += ch;
                }
            }
            if (buf) {
                curLine.push({ type: tok.type, text: buf });
                curW += msr(tok.type, buf);
            }
        }
        if (curLine.length) pushLine();
        return lines.length ? lines : [[{ type:'normal', text:'' }]];
    }

    // ==========================================
    // 카드 렌더링
    // DPR 반영: 캔버스 실제 픽셀을 DPR배로 키우고 ctx를 scale → 선명한 고해상도 PNG
    // ==========================================
    function makeCard() {
        const bg        = BGS[st.bg];
        const ac        = ACS[st.ac];
        const thoughtAc = THOUGHT_ACS[st.ac];
        const font      = FNS[st.fn].v;
        const align     = ALIGNS[st.al].v;
        const txt       = applyRp(savedText || '');
        const dark      = isDark(bg.a);

        const acRgb       = hexToRgb(ac);
        const textC       = dark ? 'rgba(240,238,255,0.90)' : 'rgba(18,12,40,0.88)';
        const mutedC      = dark ? `rgba(${acRgb},0.55)` : `rgba(${acRgb},0.7)`;
        const sepC        = dark ? `rgba(${acRgb},0.2)`  : `rgba(${acRgb},0.25)`;
        const italicAlpha = dark ? 0.45 : 0.40;

        // 논리적 크기 (고정값 — 항상 동일)
        const W  = 920;
        const R  = 24;
        const PX = 52;
        const PT = 80;
        const PB = 40;
        const FS = 26;
        const LH = FS * 1.5;

        // DPR 반영: 실제 캔버스 픽셀은 W*DPR, 그리기는 scale(DPR)로 논리 좌표 유지
        const tmp   = document.createElement('canvas');
        const tc    = tmp.getContext('2d');
        const textW = W - PX * 2;

        const paras = txt.split('\n');
        const allLineTokens = [];
        paras.forEach(p => {
            const tokens  = parseTokens(p.trim());
            const wrapped = wrapTokenLines(tc, tokens, textW, FS, font);
            allLineTokens.push(...wrapped);
        });
        while (allLineTokens.length && allLineTokens[allLineTokens.length-1].every(t => !t.text.trim())) {
            allLineTokens.pop();
        }

        const FOOTER_H = 44;
        const textH    = Math.max(allLineTokens.length, 1) * LH;
        const H        = PT + textH + LH * 0.1 + 2 + FOOTER_H + PB;
        const logicalH = Math.max(H, 280);

        // 실제 캔버스 크기 = 논리 크기 × DPR (선명도)
        const cv  = document.createElement('canvas');
        cv.width  = W * DPR;
        cv.height = logicalH * DPR;
        // CSS 표시 크기는 지정하지 않음 → #els-cvw의 max-width/max-height: 100%가
        // 컨테이너 안에서 비율 유지하며 최대한 크게 contain (원래 6.4.0 동작)

        const ctx = cv.getContext('2d');
        ctx.scale(DPR, DPR);  // 이후 모든 좌표는 논리 픽셀 기준

        ctx.save();
        ctx.beginPath(); rrPath(ctx, 0, 0, W, logicalH, R); ctx.clip();
        ctx.fillStyle = bg.a;
        ctx.fillRect(0, 0, W, logicalH);
        ctx.fillStyle = ac;
        ctx.fillRect(0, 0, W, 3);

        // 본문 렌더링
        const totalLines = allLineTokens.length;
        allLineTokens.forEach((lineTokens, row) => {
            const y          = PT + row * LH;
            const isLastLine = row === totalLines - 1;

            let lineW = 0;
            lineTokens.forEach(tok => {
                ctx.font = `${tok.type === 'italic' ? 'italic' : '400'} ${FS}px ${font}`;
                lineW += ctx.measureText(tok.text).width;
            });

            let startX     = PX;
            let extraSpace = 0;

            if (align === 'right') {
                startX = PX + textW - lineW;
            } else if (align === 'center') {
                startX = PX + (textW - lineW) / 2;
            } else if (align === 'justify' && !isLastLine) {
                const fullText = lineTokens.map(t => t.text).join('');
                const spCount  = (fullText.match(/ /g) || []).length;
                if (spCount > 0) extraSpace = (textW - lineW) / spCount;
            }

            let x = startX;
            lineTokens.forEach(tok => {
                if (!tok.text) return;
                ctx.font = `${tok.type === 'italic' ? 'italic' : '400'} ${FS}px ${font}`;

                if      (tok.type === 'dialogue') { ctx.fillStyle = ac;        ctx.globalAlpha = 1; }
                else if (tok.type === 'thought')  { ctx.fillStyle = thoughtAc; ctx.globalAlpha = 1; }
                else if (tok.type === 'italic')   { ctx.fillStyle = textC;     ctx.globalAlpha = italicAlpha; }
                else                              { ctx.fillStyle = textC;     ctx.globalAlpha = 1; }

                if (align === 'justify' && extraSpace > 0 && !isLastLine) {
                    for (const ch of tok.text) {
                        ctx.fillText(ch, x, y);
                        x += ctx.measureText(ch).width + (ch === ' ' ? extraSpace : 0);
                    }
                } else {
                    ctx.fillText(tok.text, x, y);
                    x += ctx.measureText(tok.text).width;
                }
            });
            ctx.globalAlpha = 1;
        });

        // 하단 구분선
        const sepY = logicalH - PB - FOOTER_H + 8;
        ctx.strokeStyle = sepC; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PX, sepY); ctx.lineTo(W - PX, sepY); ctx.stroke();

        // 하단 좌
        const botY = logicalH - PB - 4;
        ctx.beginPath();
        ctx.arc(PX + 5, botY - 4, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = ac; ctx.globalAlpha = 1; ctx.fill();

        const room = (document.title.replace(/^엘린\s*[-|]\s*/, '').trim() || 'elyn.ai').slice(0, 36);
        ctx.font = `500 13px Pretendard, sans-serif`;
        ctx.fillStyle = mutedC;
        ctx.fillText(room, PX + 16, botY);

        // 하단 우
        const now     = new Date();
        const dateStr = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}`;
        ctx.font      = `400 12px Pretendard, sans-serif`;
        ctx.fillStyle = mutedC;
        const dw      = ctx.measureText(dateStr).width;
        ctx.fillText(dateStr, W - PX - dw, botY);

        ctx.restore();

        ctx.save();
        ctx.strokeStyle = dark ? `rgba(${acRgb},0.25)` : `rgba(${acRgb},0.3)`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); rrPath(ctx, 0, 0, W, logicalH, R); ctx.stroke();
        ctx.restore();

        return cv;
    }

    // ==========================================
    // 유틸
    // ==========================================
    function rrPath(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x+r, y);
        ctx.lineTo(x+w-r, y); ctx.quadraticCurveTo(x+w, y, x+w, y+r);
        ctx.lineTo(x+w, y+h-r); ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
        ctx.lineTo(x+r, y+h); ctx.quadraticCurveTo(x, y+h, x, y+h-r);
        ctx.lineTo(x, y+r); ctx.quadraticCurveTo(x, y, x+r, y);
        ctx.closePath();
    }
    function hexToRgb(hex) {
        const c = hex.replace('#','');
        return `${parseInt(c.slice(0,2),16)},${parseInt(c.slice(2,4),16)},${parseInt(c.slice(4,6),16)}`;
    }
    function isDark(hex) {
        const c = hex.replace('#','');
        const r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
        return (r*299+g*587+b*114)/1000 < 128;
    }
    function pad(n) { return String(n).padStart(2,'0'); }

    // ==========================================
    // 미리보기
    // ==========================================
    function redraw() {
        const cvw = document.getElementById('els-cvw');
        cvw.innerHTML = '';
        const cv = makeCard();
        cvw.appendChild(cv);
    }

    // ==========================================
    // 옵션 이벤트
    // ==========================================
    ov.querySelectorAll('.els-pl[data-bg]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        st.bg = +b.dataset.bg;
        ov.querySelectorAll('.els-pl[data-bg]').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); redraw();
    }));
    ov.querySelectorAll('.els-acd').forEach(d => d.addEventListener('click', e => {
        e.stopPropagation();
        st.ac = +d.dataset.ac;
        ov.querySelectorAll('.els-acd').forEach(x => x.classList.remove('on'));
        d.classList.add('on'); redraw();
    }));
    ov.querySelectorAll('.els-pl[data-fn]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        st.fn = +b.dataset.fn;
        ov.querySelectorAll('.els-pl[data-fn]').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); redraw();
    }));
    ov.querySelectorAll('.els-pl[data-al]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        st.al = +b.dataset.al;
        ov.querySelectorAll('.els-pl[data-al]').forEach(x => x.classList.remove('on'));
        b.classList.add('on'); redraw();
    }));

    // 모달 열기
    document.getElementById('els-open-btn').addEventListener('mousedown', e => e.stopPropagation());
    document.getElementById('els-open-btn').addEventListener('click', e => {
        e.stopPropagation();
        const t = window.getSelection()?.toString().trim();
        if (t) savedText = t;
        if (!savedText) return;
        ov.classList.add('on');
        requestAnimationFrame(() => requestAnimationFrame(redraw));
        barHide();
    });

    // 모달 닫기
    function closeOv() { ov.classList.remove('on'); }
    document.getElementById('els-cnbtn').addEventListener('click', e => { e.stopPropagation(); closeOv(); });
    ov.addEventListener('click', e => { if (e.target === ov) closeOv(); });
    document.getElementById('els-pn').addEventListener('click', e => e.stopPropagation());

    // PNG 저장
    document.getElementById('els-svbtn').addEventListener('click', e => {
        e.stopPropagation();
        const cv = makeCard();
        const charName = document.title.replace(/^엘린\s*[-|]\s*/, '').trim().replace(/\s+/g, '_') || 'elyn';
        const a = document.createElement('a');
        a.href = cv.toDataURL('image/png');
        a.download = `엘린_${charName}_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        closeOv();
        toast('📷 카드가 저장됐어요!');
    });

    document.getElementById('els-bar-close').addEventListener('click', e => {
        e.stopPropagation(); barHide();
    });
    function barHide() { bar.style.display = 'none'; }

    // ==========================================
    // 토스트
    // ==========================================
    let tsEl, tsT;
    function toast(msg) {
        if (!tsEl) { tsEl = document.createElement('div'); tsEl.id = 'els-ts'; document.body.appendChild(tsEl); }
        tsEl.textContent = msg; tsEl.classList.add('on');
        clearTimeout(tsT); tsT = setTimeout(() => tsEl.classList.remove('on'), 2200);
    }

    // ==========================================
    // 선택 감지
    // ==========================================
    let pendingSel = false;

    document.addEventListener('mousedown', e => {
        if (ov.contains(e.target) || bar.contains(e.target)) return;
        pendingSel = true; barHide();
    }, true);

    document.addEventListener('mouseup', e => {
        if (ov.contains(e.target) || bar.contains(e.target)) return;
        if (!pendingSel) return;
        pendingSel = false;
        if (e.button !== 0) return;
        setTimeout(() => {
            const t = window.getSelection()?.toString().trim();
            if (t && t.length > 1) {
                savedText = t;
                document.getElementById('els-prev-txt').textContent =
                    t.length > 26 ? t.slice(0,26) + '…' : t;
                bar.style.display = 'flex';
            }
        }, 60);
    }, true);

    document.addEventListener('touchend', e => {
        if (ov.contains(e.target) || bar.contains(e.target)) return;
        setTimeout(() => {
            const t = window.getSelection()?.toString().trim();
            if (t && t.length > 1) {
                savedText = t;
                document.getElementById('els-prev-txt').textContent =
                    t.length > 26 ? t.slice(0,26) + '…' : t;
                bar.style.display = 'flex';
            }
        }, 60);
    }, true);

})();

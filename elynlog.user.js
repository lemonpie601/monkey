// ==UserScript==
// @name         엘린 로그 저장 📷
// @namespace    https://elyn.ai/
// @version      6.0.0
// @description  텍스트 드래그 → 심플 카드 PNG 저장
// @author       custom
// @match        https://elyn.ai/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

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

        #els-pn {
            background: hsl(var(--popover));
            border: 1px solid hsl(var(--border) / 0.3);
            border-radius: 24px; padding: 20px;
            width: min(600px, 94vw);
            box-shadow: 0 20px 60px rgba(0,0,0,0.35);
            display: flex; flex-direction: column; gap: 14px;
            font-family: Pretendard, sans-serif;
            max-height: 92vh; overflow-y: auto;
        }
        .els-ph { display: flex; align-items: center; justify-content: space-between; }
        .els-pt { font-size: 14px; font-weight: 700; color: hsl(var(--foreground)); }
        #els-xbtn {
            background: hsl(var(--muted) / 0.4); border: none; cursor: pointer;
            color: hsl(var(--muted-foreground)); width: 28px; height: 28px;
            border-radius: 50%; font-size: 13px; display: flex;
            align-items: center; justify-content: center; transition: 0.15s;
        }
        #els-xbtn:hover { background: hsl(var(--muted)); color: hsl(var(--foreground)); }

        /* 카드 미리보기 */
        #els-cvw { border-radius: 14px; overflow: hidden; }
        #els-cvw canvas { width: 100%; height: auto; display: block; }

        /* 섹션 */
        .els-sec { display: flex; flex-direction: column; gap: 7px; }
        .els-sl {
            font-size: 10.5px; font-weight: 600; letter-spacing: 0.4px;
            color: hsl(var(--muted-foreground));
        }

        /* 배경 버튼 그룹 */
        .els-bg-g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
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

        /* 포인트 컬러 */
        .els-acr { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .els-acd {
            width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
            border: 2.5px solid transparent; transition: 0.15s;
            box-shadow: 0 1px 4px rgba(0,0,0,0.15);
        }
        .els-acd.on { border-color: hsl(var(--foreground) / 0.6); transform: scale(1.2); }
        .els-acd:hover:not(.on) { transform: scale(1.1); }

        /* 치환 */
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

        .els-div { height: 1px; background: hsl(var(--border) / 0.18); }

        /* 하단 버튼 */
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

    // 배경: 밝은/어두운 골고루
    const BGS = [
        { n:'화이트',   a:'#ffffff',   b:'#f7f7f7' },
        { n:'크림',     a:'#fdf8f0',   b:'#f5ede0' },
        { n:'연보라',   a:'#f3f0ff',   b:'#ede8ff' },
        { n:'차콜',     a:'#1e1e1e',   b:'#282828' },
        { n:'딥 블루',  a:'#0f1523',   b:'#151d2e' },
        { n:'딥 그린',  a:'#0c1a10',   b:'#122016' },
    ];

    // 포인트: 다양한 계열로
    const ACS = [
        '#7c3aed', // 퍼플 (기본)
        '#db2777', // 핑크
        '#2563eb', // 블루
        '#059669', // 그린
        '#d97706', // 앰버
        '#dc2626', // 레드
        '#0891b2', // 시안
        '#374151', // 다크 그레이
    ];

    const FNS = [
        { l:'기본체', v:'Pretendard, "Apple SD Gothic Neo", sans-serif' },
        { l:'명조체', v:'"Noto Serif KR", Georgia, serif' },
        { l:'고딕체', v:'"Nanum Gothic", "Malgun Gothic", sans-serif' },
    ];

    let rp = GM_getValue('els_rp', []);
    let st = { bg:0, ac:0, fn:0 };
    let savedText = '';

    // ==========================================
    // 하단 바
    // ==========================================
    const bar = document.createElement('div');
    bar.id = 'els-bar';
    bar.innerHTML = `
        <span id="els-prev-txt" style="display: none;"></span>
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

    ov.innerHTML = `
        <div id="els-pn">
            <div class="els-ph">
                <div class="els-pt">📷 로그 카드 저장</div>
                <button id="els-xbtn">✕</button>
            </div>

            <div id="els-cvw"></div>

            <div class="els-div"></div>

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
    // 카드 렌더링 — 심플 + 라운드 PNG
    // ==========================================
    function makeCard() {
        const bg   = BGS[st.bg];
        const ac   = ACS[st.ac];
        const font = FNS[st.fn].v;
        const txt  = applyRp(savedText || '');
        const dark = isDark(bg.a);

        // 색상 계산
        const acRgb  = hexToRgb(ac);
        const textC  = dark ? 'rgba(240,238,255,0.90)' : 'rgba(18,12,40,0.88)';
        const mutedC = dark ? `rgba(${acRgb},0.55)` : `rgba(${acRgb},0.7)`;
        const sepC   = dark ? `rgba(${acRgb},0.2)` : `rgba(${acRgb},0.25)`;
        const bgCard = bg.a;

        const W      = 920;
        const R      = 24;     // 카드 라운드
        const PX     = 52;
        const PT     = 80;
        const PB     = 40;
        const FS     = 26;
        const LH     = FS * 1.5;

        // 줄바꿈 계산
        const tmp = document.createElement('canvas');
        const tc  = tmp.getContext('2d');
        tc.font   = `400 ${FS}px ${font}`;
        const textW = W - PX * 2;

        const paras = txt.split('\n');
        const allLines = [];
        paras.forEach((p, pi) => {
            const ls = wrapLine(tc, p.trim(), textW);
            allLines.push(...ls);
        });
        while (allLines.length && allLines[allLines.length-1] === '') allLines.pop();

        const FOOTER_H = 44;
        const textH    = Math.max(allLines.length, 1) * LH;
        const H        = PT + textH + LH * 0.1 + 2 + FOOTER_H + PB;

        const cv  = document.createElement('canvas');
        cv.width  = W;
        cv.height = Math.max(H, 280);
        const ctx = cv.getContext('2d');

        // ── 라운드 클리핑
        ctx.save();
        ctx.beginPath(); rrPath(ctx, 0, 0, W, cv.height, R); ctx.clip();

        // ── 배경
        ctx.fillStyle = bgCard;
        ctx.fillRect(0, 0, W, cv.height);

        // 상단 포인트 컬러 얇은 띠
        ctx.fillStyle = ac;
        ctx.fillRect(0, 0, W, 3);

        // ── 본문 텍스트
        ctx.font      = `400 ${FS}px ${font}`;
        ctx.fillStyle = textC;
        allLines.forEach((l, i) => {
            if (l.trim()) ctx.fillText(l, PX, PT + i * LH);
        });

        // ── 하단 구분선
        const sepY = cv.height - PB - FOOTER_H + 8;
        ctx.strokeStyle = sepC; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PX, sepY); ctx.lineTo(W - PX, sepY); ctx.stroke();

        // ── 하단 좌: 포인트 컬러 dot + 채팅방명
        const botY   = cv.height - PB - 4;
        ctx.beginPath();
        ctx.arc(PX + 5, botY - 4, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = ac;
        ctx.fill();

        const room = (document.title.replace(/\s*[-|]\s*Elyn.*$/i,'').trim() || 'elyn.ai').slice(0, 36);
        ctx.font      = `500 13px Pretendard, sans-serif`;
        ctx.fillStyle = mutedC;
        ctx.fillText(room, PX + 16, botY);

        // ── 하단 우: 날짜
        const now     = new Date();
        const dateStr = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())}`;
        ctx.font      = `400 12px Pretendard, sans-serif`;
        ctx.fillStyle = mutedC;
        const dw = ctx.measureText(dateStr).width;
        ctx.fillText(dateStr, W - PX - dw, botY);

        ctx.restore(); // 클리핑 해제

        // ── 카드 테두리
        ctx.save();
        ctx.strokeStyle = dark ? `rgba(${acRgb},0.25)` : `rgba(${acRgb},0.3)`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); rrPath(ctx, 0, 0, W, cv.height, R); ctx.stroke();
        ctx.restore();

        return cv;
    }

    // ==========================================
    // 유틸
    // ==========================================
    function wrapLine(ctx, text, maxW) {
        if (!text) return [''];
        const lines = []; let line = '';
        for (const ch of text) {
            const t = line + ch;
            if (ctx.measureText(t).width > maxW) { if (line) lines.push(line); line = ch; }
            else line = t;
        }
        if (line) lines.push(line);
        return lines.length ? lines : [''];
    }

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
    // 미리보기 갱신
    // ==========================================
    function redraw() {
        const w = document.getElementById('els-cvw');
        w.innerHTML = '';
        w.appendChild(makeCard());
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

    // 모달 열기
    document.getElementById('els-open-btn').addEventListener('mousedown', e => e.stopPropagation());
    document.getElementById('els-open-btn').addEventListener('click', e => {
        e.stopPropagation();
        const t = window.getSelection()?.toString().trim();
        if (t) savedText = t;
        if (!savedText) return;
        ov.classList.add('on');
        redraw();
        barHide();
    });

    // 모달 닫기
    function closeOv() { ov.classList.remove('on'); }
    document.getElementById('els-xbtn').addEventListener('click',  e => { e.stopPropagation(); closeOv(); });
    document.getElementById('els-cnbtn').addEventListener('click', e => { e.stopPropagation(); closeOv(); });
    ov.addEventListener('click', e => { if (e.target === ov) closeOv(); });
    document.getElementById('els-pn').addEventListener('click', e => e.stopPropagation());

    // PNG 저장
    document.getElementById('els-svbtn').addEventListener('click', e => {
        e.stopPropagation();
        makeCard().toBlob(blob => {
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href = url; a.download = `elyn-log-${Date.now()}.png`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
        }, 'image/png');
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
        pendingSel = true;
        barHide();
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

// ==UserScript==
// @name         Univers Scene Painter Mobile
// @namespace    univers-scene-painter-mobile
// @version      0.1.6
// @description  Univers Scene Painter Mobile - NAI V4.5 Character Slots Full
// @match        https://www.univers.chat/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      api.openai.com
// @connect      api.anthropic.com
// @connect      open.bigmodel.cn
// @connect      openrouter.ai
// @connect      aiplatform.googleapis.com
// @connect      *.aiplatform.googleapis.com
// @connect      image.novelai.net
// @connect      api.novelai.net
// @connect      novelai.net
// @connect      *.novelai.net
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CSPM_IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '') || Math.min(screen.width || 9999, screen.height || 9999) <= 820;
    if (!CSPM_IS_MOBILE) {
        console.info('[Univers Scene Painter Mobile] 현재 환경에서는 모바일 UI를 실행하지 않습니다.');
        return;
    }

    const CSP_PREFIX = 'csp_scene_painter_mobile_univers';
    const GLOBAL_SETTINGS_KEY = `${CSP_PREFIX}_global_settings`;
    const ENABLED_KEY = `${CSP_PREFIX}_enabled`;
    const IMAGE_DB_NAME = `${CSP_PREFIX}_image_db`;
    const IMAGE_STORE_NAME = 'images';
    const IMAGE_DB_VERSION = 2;
    const PRECISE_REFERENCE_EXTRA_ANLAS = 5;
    let injectScheduled = false;
    let injectTimer = null;
    const CSPM_INJECT_DEBOUNCE_MS = 650;
    const CSPM_MAX_BUBBLES_PER_PASS = 18;
    let currentTaskHud = null;
    let imageDbPromise = null;
    let cspmBootStarted = false;

    // 다른 확프가 document-start에서 원격 모듈을 많이 불러오는 경우가 있어,
    // 모바일에서는 Scene Painter 감지를 살짝 늦춰 초기 로딩 충돌을 줄입니다.
    const CSPM_BOOT_DELAY_MS = 1600;
    const CSPM_LORE_READY_MAX_WAIT_MS = 6500;
    const CSPM_AFTER_LORE_READY_DELAY_MS = 300;

    function cspmSleep(ms) {
        return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    }

    function getPageWindowSafe() {
        try {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        } catch (_) {
            return window;
        }
    }

    async function waitForCoexistingLoreInjector() {
        const pageWindow = getPageWindowSafe();
        const loreReady = pageWindow?.__LoreInjReady;
        const loreDetected = !!(pageWindow?.__LoreInj || loreReady);

        await cspmSleep(CSPM_BOOT_DELAY_MS);
        if (!loreDetected) return;

        await Promise.race([
            Promise.resolve(loreReady).catch(() => null),
            cspmSleep(CSPM_LORE_READY_MAX_WAIT_MS)
        ]);
        await cspmSleep(CSPM_AFTER_LORE_READY_DELAY_MS);
    }

    const GEMINI_MODEL_OPTIONS = [
        'gemini-3-pro-preview',
        'gemini-3.5-flash',
        'gemini-3.1-pro',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite'
    ];

    function normalizeGeminiModelId(model) {
        const raw = String(model || 'gemini-2.5-flash').trim().replace(/^models\//, '');
        return GEMINI_MODEL_OPTIONS.includes(raw) ? raw : 'gemini-2.5-flash';
    }

    function getVertexAiplatformHost(locationId) {
        const location = String(locationId || 'us-central1').trim().toLowerCase() || 'us-central1';
        // Vertex AI의 global location은 global-aiplatform.googleapis.com이 아니라
        // 기본 global service endpoint인 aiplatform.googleapis.com을 사용해야 한다.
        if (location === 'global') return 'aiplatform.googleapis.com';
        return `${encodeURIComponent(location)}-aiplatform.googleapis.com`;
    }

    function buildVertexGeminiUrl({ projectId, locationId, model }) {
        const location = String(locationId || 'us-central1').trim().toLowerCase() || 'us-central1';
        const host = getVertexAiplatformHost(location);
        return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    }

    function parseFirebaseConfigInput(input) {
        const raw = String(input || '').trim();
        if (!raw) return null;

        let source = raw
            .replace(/^\s*const\s+firebaseConfig\s*=\s*/i, '')
            .replace(/^\s*let\s+firebaseConfig\s*=\s*/i, '')
            .replace(/^\s*var\s+firebaseConfig\s*=\s*/i, '')
            .replace(/;\s*$/g, '')
            .trim();

        const objectMatch = source.match(/\{[\s\S]*\}/);
        if (objectMatch) source = objectMatch[0];

        try {
            return JSON.parse(source);
        } catch (_) {}

        // Firebase 콘솔에서 복사한 JS 객체는 key에 따옴표가 없는 경우가 많아서
        // 사용자가 직접 입력한 설정값에 한해 JS object literal 파싱을 허용합니다.
        try {
            return Function(`"use strict"; return (${source});`)();
        } catch (err) {
            throw new Error('Firebase Config를 읽지 못했어요. Firebase 콘솔의 firebaseConfig 객체 전체를 붙여넣어줘.');
        }
    }

    function getFirebaseConfigSummary(config) {
        if (!config || typeof config !== 'object') return '';
        const projectId = String(config.projectId || '').trim();
        const appId = String(config.appId || '').trim();
        const apiKey = String(config.apiKey || '').trim();
        return [projectId, appId, apiKey].filter(Boolean).join('::') || JSON.stringify(config).slice(0, 80);
    }

    function hashTiny(text) {
        let hash = 0;
        const source = String(text || '');
        for (let i = 0; i < source.length; i++) {
            hash = ((hash << 5) - hash) + source.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    function extractTextFromGeminiResponseData(data) {
        return (data?.candidates || [])
            .flatMap(candidate => candidate.content?.parts || candidate.parts || [])
            .map(part => part.text || '')
            .join('\n')
            .trim();
    }

    async function loadFirebaseAiModules(version = '12.5.0') {
        const safeVersion = String(version || '12.5.0').trim() || '12.5.0';
        const appUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(safeVersion)}/firebase-app.js`;
        const aiUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(safeVersion)}/firebase-ai.js`;

        try {
            const [appModule, aiModule] = await Promise.all([
                import(appUrl),
                import(aiUrl)
            ]);

            if (!appModule?.initializeApp || !appModule?.getApps || !appModule?.getApp) {
                throw new Error('firebase-app.js 모듈에서 initializeApp/getApps/getApp을 찾지 못했어요.');
            }
            if (!aiModule?.getAI || !aiModule?.getGenerativeModel || !aiModule?.VertexAIBackend) {
                throw new Error('firebase-ai.js 모듈에서 getAI/getGenerativeModel/VertexAIBackend를 찾지 못했어요.');
            }

            return { ...appModule, ...aiModule };
        } catch (err) {
            throw new Error(`Firebase SDK 로드 실패: ${err.message || err}. SDK 버전(${safeVersion}) 또는 네트워크/CORS를 확인해줘.`);
        }
    }

    const GEMINI_SAFETY_SETTINGS = Object.freeze([
        Object.freeze({ category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' }),
        Object.freeze({ category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' }),
        Object.freeze({ category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }),
        Object.freeze({ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' })
    ]);

    function cloneGeminiSafetySettings() {
        return GEMINI_SAFETY_SETTINGS.map(item => ({
            category: item.category,
            threshold: item.threshold
        }));
    }

    function withGeminiSafetySettings(payload) {
        return {
            ...(payload || {}),
            safetySettings: cloneGeminiSafetySettings()
        };
    }

    function buildFirebaseModelOptions(geminiRequest, payload) {
        const systemText = String((payload?.systemInstruction?.parts || [])
            .map(part => part?.text || '')
            .filter(Boolean)
            .join('\n')).trim();

        const options = {
            model: geminiRequest.model
        };

        if (systemText) options.systemInstruction = systemText;
        if (payload?.generationConfig) options.generationConfig = payload.generationConfig;
        if (Array.isArray(payload?.safetySettings)) options.safetySettings = payload.safetySettings;

        return options;
    }

    // ── 재시도 래퍼 ──────────────────────────────────────────────────────
    async function withRetry(fn, { maxRetries = 3, baseDelayMs = 2000, label = '' } = {}) {
        const RETRYABLE = new Set([429, 500, 502, 503, 504]);
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try { return await fn(); }
            catch (err) {
                lastErr = err;
                const msg = String(err?.message || err || '');
                const status = err?.httpStatus || (() => { const m = msg.match(/\b(\d{3})\b/); return m ? Number(m[1]) : 0; })();
                if (status >= 400 && status < 500 && status !== 429) break;
                const isRetryable = RETRYABLE.has(status) ||
                    /rate.?limit|too many|overloaded|provider returned error|service unavailable|시간이 초과|timeout/i.test(msg);
                if (!isRetryable || attempt >= maxRetries) break;
                const serverRetryAfter = err?.retryAfterSec ? Number(err.retryAfterSec) : null;
                const delaySec = serverRetryAfter ? serverRetryAfter + 1
                    : Math.round((baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000) / 1000);
                console.warn(`[Univers Scene Painter Mobile] ${label} 재시도 ${attempt + 1}/${maxRetries} — ${delaySec}초 후 재시도. 원인: ${msg.slice(0, 120)}`);
                if (typeof updateTaskHud === 'function') {
                    updateTaskHud({ title: `재시도 중 (${attempt + 1}/${maxRetries})`, message: `${label} 오류로 ${delaySec}초 후 재시도해. 원인: ${msg.slice(0, 80)}` });
                }
                await new Promise(r => setTimeout(r, delaySec * 1000));
            }
        }
        throw lastErr;
    }

    /** OpenAI Chat Completions API 호출 */
    async function callOpenAiGenerateContent(request, systemText, userText) {
        const isReasoningModel = /^o\d/.test(String(request.model || ''));
        const payload = {
            model: request.model,
            messages: [
                ...(systemText ? [{ role: 'system', content: systemText }] : []),
                { role: 'user', content: userText }
            ],
            ...(isReasoningModel ? {} : { temperature: request.temperature ?? 0.18, top_p: request.topP ?? 0.75 }),
            response_format: request.responseFormat ?? undefined
        };
        const data = await gmRequestJson({
            method: 'POST', url: request.url,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${request.apiKey}` },
            data: payload
        });
        const text = (data?.choices || []).map(c => c.message?.content || '').join('\n').trim();
        return { _openaiRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }

    /** Anthropic Messages API 호출 */
    async function callAnthropicGenerateContent(request, systemText, userText) {
        const payload = {
            model: request.model, max_tokens: 4096,
            messages: [{ role: 'user', content: userText }],
            ...(systemText ? { system: systemText } : {}),
            temperature: request.temperature ?? 0.18
        };
        const data = await gmRequestJson({
            method: 'POST', url: 'https://api.anthropic.com/v1/messages',
            headers: { 'Content-Type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
            data: payload
        });
        const text = (data?.content || []).map(c => c.text || '').join('\n').trim();
        if (!text) console.warn('[Univers Scene Painter Mobile] Anthropic 응답 디버그:', JSON.stringify({ stop_reason: data?.stop_reason, error: data?.error }));
        return { _anthropicRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }

    /** Zhipu AI (GLM) API 호출 */
    async function callGlmGenerateContent(request, systemText, userText) {
        const MAX_SYS_CHARS = 6000;
        const MAX_USER_CHARS = 20000;
        const trimmedSys = systemText.length > MAX_SYS_CHARS ? systemText.slice(0, MAX_SYS_CHARS) + '\n...(생략)' : systemText;
        const trimmedUser = userText.length > MAX_USER_CHARS ? userText.slice(0, MAX_USER_CHARS) + '\n...(컨텍스트 길이 초과로 일부 생략)' : userText;
        const useJson = true;
        const finalUser = useJson ? trimmedUser + '\n\n[IMPORTANT] Respond with ONLY a valid JSON object. No explanation, no markdown, no code block. Start your response with { and end with }.' : trimmedUser;
        const payload = {
            model: request.model,
            messages: [
                ...(trimmedSys ? [{ role: 'system', content: trimmedSys }] : []),
                { role: 'user', content: finalUser }
            ],
            temperature: request.temperature ?? 0.18,
            top_p: request.topP ?? 0.75,
            max_tokens: 16384,
            stream: false
        };
        const data = await gmRequestJson({
            method: 'POST', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${request.apiKey}` },
            data: payload
        });
        const text = (data?.choices || []).map(c => c.message?.content || '').join('\n').trim();
        if (!text) console.warn('[Univers Scene Painter Mobile] GLM 응답 디버그:', JSON.stringify({ choices: (data?.choices || []).map(c => ({ finish_reason: c.finish_reason, content: c.message?.content })) }));
        return { _glmRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }

    /** 현재 provider 표시명 */
    function getProviderDisplayName(global) {
        const provider = String(global?.geminiProvider || 'ai-studio').trim();
        if (provider === 'openai') return `OpenAI (${String(global?.openaiModel || 'gpt-4o').trim()})`;
        if (provider === 'anthropic') return `Claude (${String(global?.claudeModel || 'claude-sonnet-4-5').trim()})`;
        if (provider === 'glm') return `GLM (${String(global?.glmModel || 'glm-4.5-flash').trim()})`;
        if (provider === 'openrouter') return `OpenRouter (${String(global?.openrouterModel || 'meta-llama/llama-3.3-70b-instruct').trim()})`;
        if (provider === 'vertex') return 'Vertex AI';
        if (['firebase', 'firebase-ai', 'firebase-ai-logic'].includes(provider)) return 'Firebase AI';
        return `Gemini (${String(global?.googleModel || 'gemini-2.5-flash').trim()})`;
    }

        async function callFirebaseAiLogicGenerateContent(geminiRequest, payload) {
        const firebaseConfig = parseFirebaseConfigInput(geminiRequest.firebaseConfigJson);
        if (!firebaseConfig || typeof firebaseConfig !== 'object') {
            throw new Error('Firebase Config가 비어 있어요.');
        }

        const location = String(geminiRequest.firebaseLocation || 'global').trim() || 'global';
        const sdkVersion = String(geminiRequest.firebaseSdkVersion || '12.5.0').trim() || '12.5.0';

        const firebase = await loadFirebaseAiModules(sdkVersion);
        const appName = `cspm-firebase-${hashTiny(getFirebaseConfigSummary(firebaseConfig))}`;
        const app = firebase.getApps().some(existing => existing.name === appName)
            ? firebase.getApp(appName)
            : firebase.initializeApp(firebaseConfig, appName);

        const ai = firebase.getAI(app, {
            backend: new firebase.VertexAIBackend(location)
        });

        const modelOptions = buildFirebaseModelOptions(geminiRequest, payload);
        const model = firebase.getGenerativeModel(ai, modelOptions);

        try {
            const request = {
                contents: Array.isArray(payload?.contents) ? payload.contents : []
            };

            const result = await model.generateContent(request);
            const responseText = await result?.response?.text?.();

            return {
                candidates: [
                    {
                        content: {
                            parts: [{ text: String(responseText || '').trim() }]
                        }
                    }
                ],
                _firebaseRaw: result
            };
        } catch (err) {
            const message = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
            throw new Error(`Firebase AI Logic 호출 실패: ${message || '알 수 없는 오류'}`);
        }
    }

    async function requestGeminiGenerateContent(geminiRequest, payload) {
        const provider = geminiRequest?.provider || 'ai-studio';

        const extractTexts = (p) => {
            const systemText = String((p?.systemInstruction?.parts || [])
                .map(pp => pp?.text || '').filter(Boolean).join('\n')).trim();
            const userText = String((p?.contents || [])
                .flatMap(c => c.parts || []).map(pp => pp?.text || '').join('\n')).trim();
            const genCfg = p?.generationConfig || {};
            const useJson = String(genCfg.responseMimeType || '').includes('json');
            return { systemText, userText, genCfg, useJson };
        };

        // ── OpenAI ──────────────────────────────────────────────────────
        if (provider === 'openai') {
            const { systemText, userText, genCfg, useJson } = extractTexts(payload);
            return await withRetry(() => callOpenAiGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP,
                  responseFormat: useJson ? { type: 'json_object' } : undefined },
                systemText, userText
            ), { label: 'OpenAI' });
        }

        // ── Anthropic Claude ─────────────────────────────────────────────
        if (provider === 'anthropic') {
            const { systemText, userText, genCfg } = extractTexts(payload);
            return await withRetry(() => callAnthropicGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature },
                systemText, userText
            ), { label: 'Anthropic' });
        }

        // ── Zhipu AI (GLM) ───────────────────────────────────────────────
        if (provider === 'glm') {
            const { systemText, userText, genCfg } = extractTexts(payload);
            return await withRetry(() => callGlmGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP },
                systemText, userText
            ), { label: 'GLM' });
        }

        // ── OpenRouter ───────────────────────────────────────────────────
        if (provider === 'openrouter') {
            const OR_MAX_SYS_CHARS = 6000;
            const OR_MAX_USER_CHARS = 20000;
            const { systemText: rawSys, userText: rawUser, genCfg, useJson } = extractTexts(payload);
            const systemText = rawSys.length > OR_MAX_SYS_CHARS ? rawSys.slice(0, OR_MAX_SYS_CHARS) + '\n...(생략)' : rawSys;
            const trimmedUser = rawUser.length > OR_MAX_USER_CHARS ? rawUser.slice(0, OR_MAX_USER_CHARS) + '\n...(컨텍스트 길이 초과로 일부 생략)' : rawUser;
            const userText = useJson ? trimmedUser + '\n\n[IMPORTANT] Respond with ONLY a valid JSON object. No explanation, no markdown, no code block. Start your response with { and end with }.' : trimmedUser;
            return await withRetry(() => callOpenAiGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP,
                  responseFormat: useJson ? { type: 'json_object' } : undefined },
                systemText, userText
            ), { label: 'OpenRouter' });
        }

        // ── Firebase / Vertex / AI Studio ────────────────────────────────
        const payloadWithSafetySettings = withGeminiSafetySettings(payload);
        if (provider === 'firebase') {
            return await callFirebaseAiLogicGenerateContent(geminiRequest, payloadWithSafetySettings);
        }
        return await withRetry(() => gmRequestJson({
            method: 'POST',
            url: geminiRequest.url,
            headers: geminiRequest.headers,
            data: payloadWithSafetySettings
        }), { label: 'Gemini' });
    }

    function getGeminiGenerateContentRequestConfig(global, options = {}) {
        const silent = !!options.silent;
        let provider = String(global?.geminiProvider || 'ai-studio').trim() || 'ai-studio';
        const hasFirebaseConfig = !!String(global?.firebaseConfigJson || '').trim();

        // Firebase AI Logic 모드가 저장값/버전에 따라 다른 이름으로 들어와도 Firebase 경유로 처리합니다.
        if (['firebase-ai', 'firebase-ai-logic', 'firebase-ailogic', 'Firebase AI Logic Beta'].includes(provider)) {
            provider = 'firebase';
        }

        // 사용자가 Firebase Config를 넣어둔 상태에서 provider가 Vertex로 남아 있으면
        // OAuth 직접 호출 대신 Firebase AI Logic 경유로 강제합니다.
        if (provider === 'vertex' && hasFirebaseConfig) {
            console.warn('[Univers Scene Painter Mobile] Vertex provider가 저장돼 있지만 Firebase Config가 있어서 Firebase AI Logic으로 강제 전환합니다.');
            provider = 'firebase';
        }

        const model = normalizeGeminiModelId(global?.googleModel);
        const headers = { 'Content-Type': 'application/json' };

        console.log('[Univers Scene Painter Mobile] Gemini request provider:', {
            provider,
            savedProvider: String(global?.geminiProvider || ''),
            model,
            hasFirebaseConfig,
            vertexProjectId: String(global?.vertexProjectId || '').trim() || '',
            hasVertexToken: !!String(global?.vertexAccessToken || '').trim()
        });

        // ── OpenAI ───────────────────────────────────────────────────────
        if (provider === 'openai') {
            const apiKey = String(global?.openaiApiKey || '').trim();
            const openaiModel = String(global?.openaiModel || 'gpt-4o').trim();
            if (!apiKey) { if (silent) return null; throw new Error('OpenAI API Key가 비어 있어요. 설정에서 입력해줘.'); }
            return { provider: 'openai', model: openaiModel, apiKey, url: 'https://api.openai.com/v1/chat/completions', headers: {} };
        }

        // ── Anthropic Claude ─────────────────────────────────────────────
        if (provider === 'anthropic') {
            const apiKey = String(global?.anthropicApiKey || '').trim();
            const claudeModel = String(global?.claudeModel || 'claude-sonnet-4-5').trim();
            if (!apiKey) { if (silent) return null; throw new Error('Anthropic API Key가 비어 있어요. 설정에서 입력해줘.'); }
            return { provider: 'anthropic', model: claudeModel, apiKey, headers: {} };
        }

        // ── Zhipu AI (GLM) ────────────────────────────────────────────────
        if (provider === 'glm') {
            const apiKey = String(global?.glmApiKey || '').trim();
            const glmModel = String(global?.glmModel || 'glm-4.5-flash').trim();
            if (!apiKey) { if (silent) return null; throw new Error('GLM API Key가 비어 있어요. 설정에서 입력해줘.'); }
            return { provider: 'glm', model: glmModel, apiKey, headers: {} };
        }

        // ── OpenRouter ────────────────────────────────────────────────────
        if (provider === 'openrouter') {
            const apiKey = String(global?.openrouterApiKey || '').trim();
            const orModel = String(global?.openrouterModel || 'meta-llama/llama-3.3-70b-instruct').trim();
            if (!apiKey) { if (silent) return null; throw new Error('OpenRouter API Key가 비어 있어요. 설정에서 입력해줘.'); }
            return { provider: 'openrouter', model: orModel, apiKey, url: 'https://openrouter.ai/api/v1/chat/completions', headers: {} };
        }

        if (provider === 'firebase') {
            const firebaseConfigJson = String(global?.firebaseConfigJson || '').trim();
            const firebaseLocation = String(global?.firebaseLocation || 'global').trim() || 'global';
            const firebaseSdkVersion = String(global?.firebaseSdkVersion || '12.5.0').trim() || '12.5.0';

            if (!firebaseConfigJson) {
                if (silent) return null;
                throw new Error('Firebase AI Logic 사용 시 Firebase Config가 필요해요.');
            }

            return {
                provider,
                model,
                firebaseConfigJson,
                firebaseLocation,
                firebaseSdkVersion,
                headers: {}
            };
        }

        if (provider === 'vertex') {
            const projectId = String(global?.vertexProjectId || '').trim();
            const locationId = String(global?.vertexLocation || 'us-central1').trim() || 'us-central1';
            const accessToken = String(global?.vertexAccessToken || '').trim();

            if (!projectId || !accessToken) {
                if (silent) return null;
                throw new Error('Vertex AI 사용 시 Project ID와 OAuth Access Token이 필요해요.');
            }

            headers.Authorization = `Bearer ${accessToken}`;
            return {
                provider,
                model,
                headers,
                url: buildVertexGeminiUrl({ projectId, locationId, model })
            };
        }

        const apiKey = String(global?.googleApiKey || '').trim();
        if (!apiKey) {
            if (silent) return null;
            throw new Error('Gemini API Key가 비어 있어요. 설정에서 Google Gemini API Key를 입력해줘.');
        }

        return {
            provider: 'ai-studio',
            model,
            headers,
            url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
        };
    }

    function getGeminiThinkingConfigForModel(model) {
        const normalized = normalizeGeminiModelId(model);

        // Gemini 3.x: thinkingLevel 권장. 태그 생성은 과한 추론보다 짧고 안정적인 분류가 중요해서 low 고정.
        if (/^gemini-3\./.test(normalized)) {
            return { thinkingLevel: 'low' };
        }

        // Gemini 2.5: thinkingBudget 사용.
        // scene/tag JSON 생성은 깊은 추론보다 속도와 일관성이 중요해서 Flash 계열은 thinking off.
        if (normalized === 'gemini-2.5-flash' || normalized === 'gemini-2.5-flash-lite') {
            return { thinkingBudget: 0 };
        }

        // 2.5 Pro는 thinking off 미지원이므로 dynamic thinking으로 둔다.
        if (normalized === 'gemini-2.5-pro') {
            return { thinkingBudget: -1 };
        }

        return {};
    }

    function buildGeminiGenerationConfig(model, baseConfig = {}) {
        const thinkingConfig = getGeminiThinkingConfigForModel(model);
        return {
            ...baseConfig,
            ...(Object.keys(thinkingConfig).length ? { thinkingConfig } : {})
        };
    }

    function getRoomId() {
        const match = location.pathname.match(/\/play\/([^/?#]+)/);
        if (match) return match[1];
        const match2 = location.pathname.match(/\/episodes\/([^/?#]+)/);
        if (match2) return match2[1];
        return 'global_room';
    }

    function getRoomSettingsKey() {
        return `${CSP_PREFIX}_room_settings_${getRoomId()}`;
    }

    function getSceneRecordsKey() {
        return `${CSP_PREFIX}_scene_records_${getRoomId()}`;
    }

    function safeJsonParse(value, fallback) {
        try {
            return value ? JSON.parse(value) : fallback;
        } catch {
            return fallback;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function normalizePrompt(text) {
        return String(text || '')
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
            .join(', ');
    }

    function buildCommaPrompt(parts) {
        return parts
            .map(part => normalizePrompt(part))
            .filter(Boolean)
            .join(', ')
            .replace(/,\s*,+/g, ', ')
            .trim()
            .replace(/^,\s*/, '')
            .replace(/,\s*$/, '');
    }

    function convertSdWeightToNai(tag) {
        const raw = String(tag || '').trim();
        const match = raw.match(/^\((.+?):\s*([0-9]*\.?[0-9]+)\)$/);
        if (match) {
            const inner = match[1].trim();
            const weight = match[2].trim();
            return `${weight}::${inner}::`;
        }
        return raw;
    }

    function normalizeNaiWeightSyntax(prompt) {
        return String(prompt || '')
            .split(',')
            .map(part => convertSdWeightToNai(part))
            .map(part => part.trim())
            .filter(Boolean)
            .join(', ');
    }


    function getCharacterSlotName(char) {
        if (!char || typeof char !== 'object') return '';
        const candidates = [
            char.name,
            char.characterName,
            char.charName,
            char.displayName,
            char.label,
            char.title,
            char.slotName
        ];
        for (const value of candidates) {
            const text = String(value || '').trim();
            if (text) return text;
        }
        return '';
    }

    function hasCharacterSlotContent(char) {
        if (!char || typeof char !== 'object') return false;
        return !!(
            getCharacterSlotName(char) ||
            String(char.appearanceTags || '').trim() ||
            String(char.outfitTags || '').trim() ||
            String(char.tags || '').trim() ||
            String(char.uc || '').trim() ||
            String(char.referenceAssetId || '').trim()
        );
    }


    function findRoomCharacterSlotByName(name, room = null) {
        const targetName = String(name || '').trim();
        if (!targetName) return null;
        const sourceRoom = room || getRoomSettings();
        return (sourceRoom.characters || []).find(char => getCharacterSlotName(char) === targetName) || null;
    }

    function getAppliedOutfitTags(plan = {}, char = null) {
        const useTemporaryOutfit = !!plan?.useTemporaryOutfit;
        const temporaryOutfitTags = normalizeNaiWeightSyntax(normalizePrompt(String(plan?.temporaryOutfitPrompt || '')));
        const defaultOutfitTags = getCharacterOutfitTags(char);
        return useTemporaryOutfit ? temporaryOutfitTags : defaultOutfitTags;
    }

    function getOutfitSourceLabel(plan = {}, char = null) {
        if (plan?.useTemporaryOutfit) {
            return plan?.temporaryOutfitPrompt ? '로그 의상 사용' : '로그 의상 없음';
        }
        return getCharacterOutfitTags(char) ? '캐릭터 슬롯 기본 의상 사용' : '기본 의상 없음';
    }

    function getCharacterAppearanceTags(char) {
        return normalizeNaiWeightSyntax(normalizePrompt(String(char?.appearanceTags || char?.tags || '')));
    }

    function getCharacterOutfitTags(char) {
        return normalizeNaiWeightSyntax(normalizePrompt(String(char?.outfitTags || '')));
    }

    function getCharacterPromptForPlan(char, plan = {}, options = {}) {
        const useTemporaryOutfit = options.useTemporaryOutfit !== undefined
            ? !!options.useTemporaryOutfit
            : !!plan?.useTemporaryOutfit;
        const appearanceTags = getCharacterAppearanceTags(char);
        const defaultOutfitTags = getCharacterOutfitTags(char);
        const temporaryOutfitTags = normalizeNaiWeightSyntax(normalizePrompt(String(plan?.temporaryOutfitPrompt || '')));
        return buildCommaPrompt([
            appearanceTags,
            useTemporaryOutfit ? '' : defaultOutfitTags,
            useTemporaryOutfit ? temporaryOutfitTags : ''
        ]);
    }

    function stripNonSceneNodes(root) {
        if (!root) return root;
        root.querySelectorAll('.cspm-generated-scene-image, pre, .not-prose, .csp-generated-scene-image').forEach(el => el.remove());
        return root;
    }

    function getEffectiveGeminiSystemInstruction(global) {
        const main = String(global?.geminiInstruction || getDefaultGeminiInstruction()).trim();
        const guide = String(global?.naiPromptGuide || getDefaultNaiPromptGuide()).trim();
        if (!guide) return main;
        return `${main}

[보조 장면 태그 지침]
${guide}`.trim();
    }

    function stripForbiddenSceneTags(text) {
        const forbiddenExact = new Set([
            'masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres',
            'highres', 'incredibly absurdres', 'ultra detailed', 'highly detailed', '4k',
            'best illustration', 'illustration', 'commission', 'perfect proportions',
            'year 2024', 'year 2025', 'novel illustration', 'clear lines'
        ]);

        return String(text || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .filter(tag => {
                const normalized = tag
                    .replace(/^\d+(?:\.\d+)?::\s*/, '')
                    .replace(/::\s*$/, '')
                    .trim()
                    .toLowerCase();
                if (forbiddenExact.has(normalized)) return false;
                if (/^artist\s*:/.test(normalized)) return false;
                if (/^artist\s/.test(normalized)) return false;
                if (/^year\s+\d{4}$/.test(normalized)) return false;
                return true;
            })
            .join(', ');
    }

    function getDefaultGeminiInstruction() {
        return `Gemini 장면 태그 생성 지침:

[장면 선택]
- 채팅 로그에서 삽화로 만들 핵심 순간 하나만 선택한다.
- 로그 전체 요약, 단체 장면, 모든 캐릭터 모음 장면을 만들지 않는다.
- visibleCharacters에는 화면 중심에 실제로 보일 저장 캐릭터 이름 1명만 넣는다.
- 단순 언급, 회상, 주변 반응, 멀리 있는 인물은 visibleCharacters에서 제외한다.
- 사용자의 캐릭터는 화면 밖 상호작용 대상으로 간주하고 visibleCharacters에 넣지 않는다.
- 코드블록, 상태창, info 박스, 시간/관계/소지품 같은 메타 정보는 장면 본문이 아니므로 핵심 장면 선택에서 제외한다.
- insertAfterParagraph는 실제 행동/표정/감정이 드러나는 본문 문단 뒤 index로 정한다.

[출력 필드]
- 출력은 반드시 JSON만 사용한다. 코드블록, 설명문, 주석은 출력하지 않는다.
- 모든 프롬프트 필드(composition, interactionPrompt, baseScenePrompt, temporaryOutfitPrompt)는 영어 Danbooru 태그만 쉼표로 구분한 단일 문자열이어야 한다.
- 캐릭터 이름, 고유명사, 호칭, 직책명, 한국어 문장, 설명문은 프롬프트 필드에 넣지 않는다.
- 외형 관련 태그 / 인물 주체 태그는 Gemini 프롬프트 필드에서 생성하지 않는다.
- 예: boy, girl, young man, young woman, man, woman, person, office worker, soldier, doctor
- 캐릭터 주체/외형은 저장된 캐릭터 슬롯이 담당한다. Gemini는 장면 태그만 만든다.
- 캐릭터 외형, 머리색, 눈색, 체형, 장신구, 작가 태그, 연도 태그, Negative/UC는 생성하지 않는다.
- 가중치가 필요하면 숫자::태그:: 형식만 사용한다.

[태그 수량 제한]
- composition은 2~3개 태그만 생성한다.
- interactionPrompt는 2~4개 태그만 생성한다.
- baseScenePrompt는 2~4개 태그만 생성한다.
- mood는 1~2개 태그만 생성한다.
- globalContext의 locationPrompt/timePrompt/atmospherePrompt도 각각 1~3개 태그만 생성한다.
- 전체 최종 태그 수는 대체로 8~12개를 목표로 한다.
- 중복 태그를 생성하지 않는다. office, indoors 같은 태그를 여러 필드에 반복하지 않는다.

[composition 규칙: 구도/시점/시선만]
- composition에는 카메라 거리 태그 1개를 반드시 넣는다.
  예: close-up, portrait, upper body, cowboy shot, medium shot, full body
- composition에는 시점/구도/시선 태그를 1~2개만 넣는다.
  예: front view, three-quarter view, from side, profile, dynamic angle, looking at viewer, looking away
- from side, profile, looking at viewer 조합은 허용한다.
- 다만 front view, profile, from side처럼 서로 반대되는 구도 태그를 과하게 겹치지 않는다.
- front view / profile / from side 중에서는 가장 맞는 1개를 고른다.
- close-up, portrait, upper body, medium shot, cowboy shot, full body 중 여러 개를 동시에 넣지 말고 가장 맞는 1개만 고른다.
- 감정, 위로, 돌봄, 긴장감이 핵심이면 close-up, portrait, upper body를 우선한다.
- 행동, 자세, 손짓, 물건 전달, 책상/문가/침대 같은 주변 구조가 중요하면 medium shot 또는 cowboy shot을 우선한다.
- 전신 실루엣과 의상 전체가 중요할 때만 full body를 사용한다.
- 특별한 이유가 없으면 pov는 사용하지 않는다.

[interactionPrompt 규칙: 행동 먼저, 표정 뒤]
- interactionPrompt에는 중심 인물의 행동 태그 1~2개를 먼저 넣고, 표정/감정 태그 1~2개를 뒤에 넣는다.
- 비슷한 감정 태그를 3개 이상 겹치지 않는다.
  예: worried expression, nervous, shy를 모두 넣지 말고 핵심 1~2개만 선택한다.
- 배경, 장소, 조명, 구도, 카메라 거리, 주체 태그는 interactionPrompt에 넣지 않는다.
- 화면 밖 사용자를 표현할 때는 사용자의 신체 일부를 그리지 않는다.
- viewer's hand, hand on viewer, pov hands, invisible viewer는 금지한다.
- 대신 중심 인물의 시선, 거리감, 행동으로만 표현한다.

[baseScenePrompt 규칙: 배경만]
- baseScenePrompt에는 장소, 배경 소품, 시간대, 조명, 분위기 태그만 넣는다.
- 행동, 표정, 구도, 카메라 거리, 주체, 외형, 의상 태그는 baseScenePrompt에 넣지 않는다.
- 같은 의미의 배경 태그를 반복하지 않는다.

[temporaryOutfitPrompt 규칙]
- 로그나 문맥에서 현재 장면의 옷차림이 분명할 때만 간결한 의상 태그를 넣는다.
- 확실하지 않으면 temporaryOutfitPrompt는 빈 문자열로 둔다.
- temporaryOutfitPrompt에는 외형, 머리색, 눈색, 체형, 장신구, 작가 태그, 연도 태그를 넣지 않는다.

[최종 조립 순서]
- 최종 프롬프트는 코드에서 composition → interactionPrompt → baseScenePrompt → globalContext 순서로 조립한다.
- 그러므로 각 필드는 자기 역할의 태그만 넣어야 한다.

{
  "sceneTitle": "한국어 장면 제목",
  "insertAfterParagraph": 0,
  "visibleCharacters": ["저장된 캐릭터 이름 1명"],
  "mood": "english mood tags",
  "globalContext": {
    "locationPrompt": "english place/background tags from the whole log",
    "timePrompt": "english time/weather tags from the whole log",
    "atmospherePrompt": "english mood/lighting tags from the whole log",
    "situationSummary": "전체 로그의 장소와 큰 상황을 한국어로 짧게"
  },
  "composition": "2-3 english camera/framing/view tags only",
  "baseScenePrompt": "2-4 english background/place/lighting tags only",
  "interactionPrompt": "2-4 english action/expression tags only",
  "temporaryOutfitPrompt": "english outfit tags only or empty string",
  "reason": "왜 이 순간을 골랐는지 한국어로 짧게"
}`;
    }

    function getDefaultNaiPromptGuide() {
        return `장면 태그 보조 지침:

- 핵심은 로그에 나온 모든 인물이 아니라 삽화로 만들 한 순간의 중심 인물 1명이다.
- visibleCharacters에는 저장 캐릭터 이름 1명만 넣는다.
- 프롬프트 필드에는 캐릭터 이름/호칭/고유명사/한국어 설명문을 넣지 않는다.
- 외형 관련 태그 / 인물 주체 태그는 Gemini 프롬프트 필드에서 생성하지 않는다.
- 예: boy, girl, young man, young woman, man, woman, person, office worker
- composition은 2~3개만: 카메라 거리 1개 + 시점/시선 1~2개.
- from side, profile, looking at viewer 조합은 허용하되, front view / profile / from side 같은 서로 반대되는 구도 태그는 과하게 겹치지 않는다.
- interactionPrompt는 2~4개만: 행동 1~2개 + 표정/감정 1~2개.
- baseScenePrompt는 2~4개만: 배경/장소/소품/조명/분위기만.
- temporaryOutfitPrompt는 현재 장면 의상이 분명할 때만 짧게 넣고, 애매하면 빈칸으로 둔다.
- 중복 태그를 만들지 않는다.
- 전체 최종 태그 수는 8~12개 안팎을 목표로 한다.
- 캐릭터 외형/작가태그/연도태그/Negative는 생성하지 않는다.`;
    }

    function getDefaultNaiSettings() {
        return {
            orientationPreset: 'portrait',
            width: 832,
            height: 1216,
            steps: 20,
            scale: 6.5,
            guidanceRescale: 0.3,
            sampler: 'k_euler',
            noiseSchedule: 'karras',
            seed: '',
            nSamples: 1,
            smea: false,
            dyn: false,
            ucPreset: 0,
        };
    }

    const NAI_UC_PRESET_TAGS_V45_FULL = Object.freeze({
        0: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        1: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
        2: '',
        3: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
        4: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic'
    });

    const NAI_UC_PRESET_TAGS_V45_CURATED = Object.freeze({
        0: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        1: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
        2: '',
        3: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
        // NovelAI 문서상 Furry Focus는 V4.5 Full 쪽에만 따로 공개되어 있어, Curated에서 선택해도 같은 태그 묶음을 수동 UC로 합쳐 보냅니다.
        4: NAI_UC_PRESET_TAGS_V45_FULL[4]
    });

    function normalizeNaiUcPresetValue(ucPreset) {
        const preset = Number(ucPreset);
        return [0, 1, 2, 3, 4].includes(preset) ? preset : 0;
    }

    function getNaiUcPresetTagsForModel(ucPreset, model) {
        const preset = normalizeNaiUcPresetValue(ucPreset);
        if (preset === 2) return '';
        const normalizedModel = String(model || '').toLowerCase();
        const presetMap = normalizedModel.includes('4-5-curated')
            ? NAI_UC_PRESET_TAGS_V45_CURATED
            : NAI_UC_PRESET_TAGS_V45_FULL;
        return presetMap[preset] || NAI_UC_PRESET_TAGS_V45_FULL[preset] || presetMap[0] || '';
    }

    function getNaiUcPresetLabel(ucPreset) {
        const preset = normalizeNaiUcPresetValue(ucPreset);
        if (preset === 1) return 'Light UC';
        if (preset === 2) return 'None';
        if (preset === 3) return 'Human Focus UC';
        if (preset === 4) return 'Furry Focus UC';
        return 'Heavy UC';
    }

    function buildNaiUcPresetOptionsHtml(selectedValue) {
        const selected = normalizeNaiUcPresetValue(selectedValue);
        return [
            { value: 0, label: 'Heavy UC' },
            { value: 1, label: 'Light UC' },
            { value: 3, label: 'Human Focus UC' },
            { value: 4, label: 'Furry Focus UC' },
            { value: 2, label: 'None' }
        ].map(option => `<option value="${option.value}" ${selected === option.value ? 'selected' : ''}>${option.label}</option>`).join('');
    }

    function mergeNaiUcPresetWithNegative(negativeText, settings = {}, model = '') {
        const presetTags = getNaiUcPresetTagsForModel(settings.ucPreset, model);
        return normalizeNaiWeightSyntax(buildCommaPrompt([
            presetTags,
            negativeText || ''
        ]));
    }


    function getDefaultGlobalSettings() {
        return {
            geminiProvider: 'ai-studio',
            googleApiKey: '',
            googleModel: 'gemini-2.5-flash',
            vertexProjectId: '',
            vertexLocation: 'us-central1',
            vertexAccessToken: '',
            firebaseConfigJson: '',
            firebaseLocation: 'global',
            firebaseSdkVersion: '12.5.0',
            openaiApiKey: '',
            openaiModel: 'gpt-4o',
            anthropicApiKey: '',
            claudeModel: 'claude-sonnet-4-5',
            glmApiKey: '',
            glmModel: 'glm-4.5-flash',
            openrouterApiKey: '',
            openrouterModel: 'meta-llama/llama-3.3-70b-instruct',
            naiApiKey: '',
            naiModel: 'nai-diffusion-4-5-full',
            folderSaveEnabled: false,
            geminiInstruction: getDefaultGeminiInstruction(),

            // 방과 무관하게 고정되는 공통 생성 설정
            basePositive: '',
            baseNegative: '',
            naiPromptGuide: getDefaultNaiPromptGuide(),
            naiSettings: getDefaultNaiSettings(),
            characterQuickSlots: []
        };
    }

    function getDefaultRoomSettings() {
        return {
            // 방별로 달라지는 것은 캐릭터 슬롯만 남깁니다.
            characters: [
                {
                    name: '',
                    appearanceTags: '',
                    outfitTags: '',
                    tags: '',
                    uc: '',
                    referenceEnabled: false,
                    referenceType: 'character',
                    referenceAssetId: '',
                    referenceImageName: '',
                    referenceStrength: 0.6,
                    referenceFidelity: 0.8
                }
            ]
        };
    }

    function normalizeGlobalSettings(settings, options = {}) {
        const defaults = getDefaultGlobalSettings();
        const legacyRoom = options.legacyRoom || {};
        const saved = settings || {};
        const merged = Object.assign({}, defaults, saved);

        merged.folderSaveEnabled = false;

        // v4.1 이하에서 방별로 저장하던 값을 전역값으로 부드럽게 승격합니다.
        if (!saved.basePositive && legacyRoom.basePositive) merged.basePositive = legacyRoom.basePositive;
        if (!saved.baseNegative && legacyRoom.baseNegative) merged.baseNegative = legacyRoom.baseNegative;
        if (!saved.naiPromptGuide && legacyRoom.naiPromptGuide) merged.naiPromptGuide = legacyRoom.naiPromptGuide;

        if (!merged.naiPromptGuide || /NovelAI에게 직접 보내는 프롬프트|NAI에게 직접 보내는 문장|NAI 프롬프트 생성 시/.test(String(merged.naiPromptGuide))) {
            merged.naiPromptGuide = defaults.naiPromptGuide;
        }

        merged.naiSettings = Object.assign(
            {},
            defaults.naiSettings,
            legacyRoom.naiSettings || {},
            saved.naiSettings || {}
        );

        // 공유용 안정화: SMEA/DYN과 다중 생성은 UI에서 제거하고 API에도 고정값만 보냅니다.
        // 예전 저장값이 true/2 이상으로 남아 있어도 여기서 강제로 꺼집니다.
        merged.naiSettings.nSamples = 1;
        merged.naiSettings.smea = false;
        merged.naiSettings.dyn = false;

        merged.characterQuickSlots = Array.isArray(merged.characterQuickSlots)
            ? merged.characterQuickSlots.map(slot => ({
                name: String(slot?.name || '').trim(),
                characters: Array.isArray(slot?.characters) ? normalizeRoomSettings({ characters: slot.characters }).characters : []
            })).filter(slot => slot.name && slot.characters.length)
            : [];

        return merged;
    }

    function normalizeRoomSettings(room) {
        const defaults = getDefaultRoomSettings();
        const merged = Object.assign({}, defaults, room || {});

        if (!Array.isArray(merged.characters)) {
            merged.characters = defaults.characters;
        }
        if (!merged.characters.length) {
            merged.characters = defaults.characters;
        }

        return {
            characters: merged.characters.map(char => {
                const appearanceTags = String(char.appearanceTags || char.tags || '').trim();
                const outfitTags = String(char.outfitTags || '').trim();
                return {
                    name: getCharacterSlotName(char),
                    appearanceTags,
                    outfitTags,
                    tags: buildCommaPrompt([appearanceTags, outfitTags]),
                    uc: char.uc || '',
                    referenceEnabled: !!char.referenceEnabled,
                    referenceType: normalizeReferenceType(char.referenceType || 'character'),
                    referenceAssetId: char.referenceAssetId || '',
                    referenceImageName: char.referenceImageName || '',
                    referenceStrength: clampNumber(char.referenceStrength, -1, 1, 0.6),
                    referenceFidelity: clampNumber(char.referenceFidelity, -1, 1, 0.8)
                };
            })
        };
    }

    function getGlobalSettings() {
        const saved = safeJsonParse(localStorage.getItem(GLOBAL_SETTINGS_KEY), {});
        const legacyRoom = safeJsonParse(localStorage.getItem(getRoomSettingsKey()), {});
        return normalizeGlobalSettings(saved, { legacyRoom });
    }

    function saveGlobalSettings(settings) {
        localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(normalizeGlobalSettings(settings)));
    }

    function forceFirebaseProviderIfConfigured() {
        const saved = safeJsonParse(localStorage.getItem(GLOBAL_SETTINGS_KEY), {});
        const hasFirebaseConfig = !!String(saved?.firebaseConfigJson || '').trim();
        if (!hasFirebaseConfig) return;

        const provider = String(saved?.geminiProvider || '').trim();
        if (provider === 'firebase') return;
        if (provider === 'ai-studio' && String(saved?.googleApiKey || '').trim()) return;

        saved.geminiProvider = 'firebase';
        saved.vertexAccessToken = '';
        localStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(normalizeGlobalSettings(saved)));
        console.warn('[Univers Scene Painter Mobile] Firebase Config가 있어서 Gemini provider를 firebase로 자동 보정했습니다.');
    }

    function getRoomSettings() {
        return normalizeRoomSettings(
            safeJsonParse(localStorage.getItem(getRoomSettingsKey()), {})
        );
    }

    function saveRoomSettings(settings) {
        localStorage.setItem(getRoomSettingsKey(), JSON.stringify(normalizeRoomSettings(settings)));
    }

    function getSceneRecords() {
        return safeJsonParse(localStorage.getItem(getSceneRecordsKey()), {});
    }

    function stripLargeImageFields(records) {
        const next = records || {};
        Object.keys(next).forEach(key => {
            const record = next[key];
            if (!record) return;
            normalizeSceneRecordHistory(record, key);
            if (Array.isArray(record.history)) {
                record.history.forEach(item => {
                    if (!item) return;
                    if (String(item.imageUrl || '').startsWith('data:')) {
                        item.imageId = item.imageId || makeHistoryImageId(key);
                        delete item.imageUrl;
                    }
                    if (String(item.imageUrl || '').startsWith('blob:')) {
                        delete item.imageUrl;
                    }
                });
                record.history = record.history.filter(item => item && (item.imageId || item.imageUrl)).slice(-CSP_MAX_IMAGE_HISTORY);
                record.currentIndex = clampHistoryIndex(record);
                syncCurrentImageFieldsFromHistory(record);
            }
            if (String(record.imageUrl || '').startsWith('data:')) {
                record.imageId = record.imageId || makeStoredImageId(key);
                delete record.imageUrl;
            }
            if (String(record.imageUrl || '').startsWith('blob:')) {
                delete record.imageUrl;
            }
        });
        return next;
    }

    function saveSceneRecords(records) {
        const compact = stripLargeImageFields(records || {});
        try {
            localStorage.setItem(getSceneRecordsKey(), JSON.stringify(compact));
        } catch (err) {
            console.warn('[Univers Scene Painter Mobile] localStorage save failed, pruning scene records:', err);
            const pruned = {};
            Object.entries(compact).slice(-20).forEach(([key, value]) => {
                pruned[key] = value;
            });
            localStorage.setItem(getSceneRecordsKey(), JSON.stringify(pruned));
        }
        updateGalleryRowCount();
    }

    function makeStoredImageId(messageKey) {
        return `${getRoomId()}::${messageKey}`;
    }

    const CSP_MAX_IMAGE_HISTORY = 3;

    function makeHistoryImageId(messageKey) {
        return `${makeStoredImageId(messageKey)}::${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function clampHistoryIndex(record) {
        const history = Array.isArray(record?.history) ? record.history : [];
        if (!history.length) return 0;
        const n = Number(record.currentIndex);
        if (!Number.isFinite(n)) return history.length - 1;
        return Math.max(0, Math.min(Math.trunc(n), history.length - 1));
    }

    function syncCurrentImageFieldsFromHistory(record) {
        if (!record || typeof record !== 'object') return record;
        const history = Array.isArray(record.history) ? record.history : [];
        if (!history.length) {
            delete record.imageId;
            delete record.imageUrl;
            delete record.folderFileName;
            record.currentIndex = 0;
            return record;
        }

        record.currentIndex = clampHistoryIndex(record);
        const current = history[record.currentIndex] || {};
        if (current.imageId) {
            record.imageId = current.imageId;
            delete record.imageUrl;
        } else if (current.imageUrl) {
            record.imageUrl = current.imageUrl;
            delete record.imageId;
        } else {
            delete record.imageId;
            delete record.imageUrl;
        }

        if (current.folderFileName) record.folderFileName = current.folderFileName;
        else delete record.folderFileName;

        return record;
    }

    function normalizeSceneRecordHistory(record, messageKey = '') {
        if (!record || typeof record !== 'object') return record;

        let history = Array.isArray(record.history)
            ? record.history.filter(item => item && (item.imageId || item.imageUrl))
            : [];

        if (!history.length) {
            const item = {
                createdAt: record.createdAt || Date.now()
            };
            if (record.imageId) item.imageId = record.imageId;
            if (record.imageUrl) item.imageUrl = record.imageUrl;
            if (record.folderFileName) item.folderFileName = record.folderFileName;
            if (item.imageId || item.imageUrl) history.push(item);
        }

        if (history.length > CSP_MAX_IMAGE_HISTORY) {
            history = history.slice(-CSP_MAX_IMAGE_HISTORY);
        }

        record.history = history;
        record.currentIndex = clampHistoryIndex(record);
        syncCurrentImageFieldsFromHistory(record);
        return record;
    }

    function getCurrentHistoryItem(record) {
        normalizeSceneRecordHistory(record);
        const history = Array.isArray(record?.history) ? record.history : [];
        if (!history.length) return null;
        return history[clampHistoryIndex(record)] || null;
    }

    function isSceneHistoryFull(record) {
        normalizeSceneRecordHistory(record);
        const history = Array.isArray(record?.history) ? record.history : [];
        return history.length >= CSP_MAX_IMAGE_HISTORY;
    }

    function getSceneHistoryCount(record) {
        normalizeSceneRecordHistory(record);
        return Array.isArray(record?.history) ? record.history.length : 0;
    }

    function refreshImageActionState(messageKey, box = null, record = null) {
        const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        if (!targetBox) return;

        const effectiveRecord = record || getSceneRecords()[messageKey];
        const full = !!effectiveRecord && isSceneHistoryFull(effectiveRecord);
        const count = effectiveRecord ? getSceneHistoryCount(effectiveRecord) : 0;

        const actionScope = messageKey
            ? document.querySelectorAll(`.cspm-image-reroll-btn[data-message-key="${CSS.escape(messageKey)}"], .cspm-image-edit-btn[data-message-key="${CSS.escape(messageKey)}"]`)
            : targetBox.querySelectorAll('.cspm-image-reroll-btn, .cspm-image-edit-btn');

        actionScope.forEach(btn => {
            btn.disabled = full;
            btn.classList.toggle('is-disabled', full);
            if (btn.classList.contains('cspm-image-edit-btn')) {
                btn.title = full
                    ? `리롤 기록이 ${CSP_MAX_IMAGE_HISTORY}장까지 찼어요. 휴지통으로 이미지를 지우면 리롤 설정을 다시 열 수 있어요.`
                    : '리롤 설정';
                btn.setAttribute('aria-label', full ? '리롤 설정 비활성화' : '리롤 설정');
            } else {
                btn.title = full
                    ? `리롤 기록이 ${CSP_MAX_IMAGE_HISTORY}장까지 찼어요. 휴지통으로 이미지를 지우면 다시 리롤할 수 있어요.`
                    : '리롤';
                btn.setAttribute('aria-label', full ? '리롤 비활성화' : '리롤');
            }
        });

        targetBox.setAttribute('data-cspm-history-count', String(count));
        targetBox.setAttribute('data-cspm-history-full', full ? 'true' : 'false');
    }

    async function getRecordImageSrc(record, index = null) {
        if (!record) return '';
        normalizeSceneRecordHistory(record);
        const history = Array.isArray(record.history) ? record.history : [];
        const idx = index === null || index === undefined
            ? clampHistoryIndex(record)
            : Math.max(0, Math.min(Number(index) || 0, Math.max(0, history.length - 1)));
        const item = history[idx] || null;
        if (!item) return '';
        if (item.imageUrl) return item.imageUrl;
        if (item.imageId) return await getStoredImage(item.imageId);
        return '';
    }

    async function appendSceneHistoryImage(messageKey, record, imageUrl) {
        normalizeSceneRecordHistory(record, messageKey);
        const item = { createdAt: Date.now() };

        if (String(imageUrl || '').startsWith('data:')) {
            item.imageId = makeHistoryImageId(messageKey);
            await putStoredImage(item.imageId, imageUrl);
        } else if (String(imageUrl || '').startsWith('blob:')) {
            // blob URL은 새로고침 후 깨지므로 기록하지 않습니다.
            item.imageUrl = imageUrl;
        } else if (imageUrl) {
            item.imageUrl = imageUrl;
        }

        if (!item.imageId && !item.imageUrl) return null;

        record.history = Array.isArray(record.history) ? record.history : [];
        if (record.history.length >= CSP_MAX_IMAGE_HISTORY) {
            if (item.imageId) {
                try {
                    await deleteStoredImage(item.imageId);
                } catch (err) {
                    console.warn('[Univers Scene Painter Mobile] blocked reroll image cleanup failed:', err);
                }
            }
            throw new Error(`리롤 기록은 최대 ${CSP_MAX_IMAGE_HISTORY}장까지 보관돼요. 휴지통으로 이미지를 지운 뒤 다시 리롤해줘.`);
        }

        record.history.push(item);
        record.currentIndex = record.history.length - 1;
        syncCurrentImageFieldsFromHistory(record);
        return item;
    }

    async function deleteAllHistoryImages(record, fallbackImageId = '') {
        const ids = new Set();
        if (Array.isArray(record?.history)) {
            record.history.forEach(item => {
                if (item?.imageId) ids.add(item.imageId);
            });
        }
        if (record?.imageId) ids.add(record.imageId);
        if (fallbackImageId) ids.add(fallbackImageId);

        for (const id of ids) {
            try {
                await deleteStoredImage(id);
            } catch (err) {
                console.warn('[Univers Scene Painter Mobile] stored image delete failed:', err);
            }
        }
    }


    function buildImageActionButtonsHtml(messageKey) {
        return `
            <button class="cspm-image-action-btn cspm-image-reroll-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="리롤" aria-label="리롤">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
            <button class="cspm-image-action-btn cspm-image-edit-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="리롤 설정" aria-label="리롤 설정">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
            </button>
            <button class="cspm-image-action-btn cspm-image-download-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="저장" aria-label="저장">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z"/></svg>
            </button>
            <button class="cspm-image-action-btn cspm-image-delete-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="삭제" aria-label="삭제" data-cspm-danger="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
        `;
    }

    function buildImageHistoryControls(messageKey, record) {
        normalizeSceneRecordHistory(record, messageKey);
        const history = Array.isArray(record?.history) ? record.history : [];
        const count = history.length;
        if (count <= 1) return '';
        const index = clampHistoryIndex(record);

        return `
            <button class="cspm-image-history-btn cspm-image-history-prev" data-message-key="${escapeHtml(messageKey)}" type="button" title="이전 이미지" aria-label="이전 이미지" ${index <= 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
            <span class="cspm-image-history-count">${index + 1} / ${count}</span>
            <button class="cspm-image-history-btn cspm-image-history-next" data-message-key="${escapeHtml(messageKey)}" type="button" title="다음 이미지" aria-label="다음 이미지" ${index >= count - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>
        `;
    }


    function buildImageFooterControls(messageKey, record) {
        return `
            <div class="cspm-image-action-row cspm-image-action-row-inline" aria-label="Scene Painter image actions">
                ${buildImageActionButtonsHtml(messageKey)}
            </div>
            <div class="cspm-image-history-controls">
                ${record ? buildImageHistoryControls(messageKey, record) : ''}
            </div>
        `;
    }

    function ensureImageHistoryRow(box) {
        if (!box) return null;
        const messageKey = box.getAttribute('data-message-key') || '';
        let row = messageKey
            ? document.querySelector(`.cspm-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
            : null;

        if (!row) {
            const next = box.nextElementSibling;
            if (next?.classList?.contains('cspm-image-history-row')) row = next;
        }

        if (!row) {
            row = document.createElement('div');
            row.className = 'cspm-image-history-row';
            if (messageKey) row.setAttribute('data-message-key', messageKey);
            box.insertAdjacentElement('afterend', row);
        }

        return row;
    }

    function refreshImageHistoryControls(messageKey, box = null, record = null) {
        const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const row = ensureImageHistoryRow(targetBox);
        if (!row) return;
        const effectiveRecord = record || getSceneRecords()[messageKey];
        row.innerHTML = effectiveRecord ? buildImageFooterControls(messageKey, effectiveRecord) : '';
        refreshImageActionState(messageKey, targetBox, effectiveRecord);
    }

    async function setCurrentSceneHistoryIndex(messageKey, index, box = null) {
        const records = getSceneRecords();
        const record = normalizeSceneRecordHistory(records[messageKey], messageKey);
        if (!record || !Array.isArray(record.history) || !record.history.length) return false;

        record.currentIndex = Math.max(0, Math.min(Number(index) || 0, record.history.length - 1));
        syncCurrentImageFieldsFromHistory(record);

        const src = await getRecordImageSrc(record);
        const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const img = targetBox?.querySelector('img');
        if (img && src) img.src = src;

        records[messageKey] = record;
        saveSceneRecords(records);
        refreshImageHistoryControls(messageKey, targetBox, record);
        return true;
    }

    async function deleteCurrentSceneHistoryImage(messageKey, box = null) {
        const records = getSceneRecords();
        const record = normalizeSceneRecordHistory(records[messageKey], messageKey);
        if (!record || !Array.isArray(record.history) || !record.history.length) {
            await clearSceneRecordForMessage(messageKey, { box });
            return { removedAll: true, remaining: 0 };
        }

        const index = clampHistoryIndex(record);
        const [removed] = record.history.splice(index, 1);
        if (removed?.imageId) {
            try {
                await deleteStoredImage(removed.imageId);
            } catch (err) {
                console.warn('[Univers Scene Painter Mobile] current history image delete failed:', err);
            }
        }

        if (!record.history.length) {
            delete records[messageKey];
            saveSceneRecords(records);
            const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
            const row = targetBox?.nextElementSibling?.classList?.contains('cspm-image-history-row')
                ? targetBox.nextElementSibling
                : document.querySelector(`.cspm-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`);
            row?.remove();
            targetBox?.remove();
            markSceneButtons(messageKey, false);
            return { removedAll: true, remaining: 0 };
        }

        record.currentIndex = Math.min(index, record.history.length - 1);
        syncCurrentImageFieldsFromHistory(record);
        records[messageKey] = record;
        saveSceneRecords(records);

        const src = await getRecordImageSrc(record);
        const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const img = targetBox?.querySelector('img');
        if (img && src) img.src = src;
        refreshImageHistoryControls(messageKey, targetBox, record);
        markSceneButtons(messageKey, true);

        return { removedAll: false, remaining: record.history.length };
    }

    function withTimeout(promise, ms = 5000, label = '작업') {
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error(`${label} 시간이 초과됐어요.`));
            }, Math.max(500, Number(ms) || 5000));

            Promise.resolve(promise)
                .then(value => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch(err => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    function openImageDb() {
        if (imageDbPromise) return imageDbPromise;
        imageDbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
                    db.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB를 열지 못했어요.'));
        });
        return imageDbPromise;
    }

    async function putStoredImage(id, dataUrl) {
        if (!id || !dataUrl) return;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
            tx.objectStore(IMAGE_STORE_NAME).put({ id, dataUrl, createdAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('이미지를 IndexedDB에 저장하지 못했어요.'));
        });
    }

    async function getStoredImage(id) {
        if (!id) return '';
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGE_STORE_NAME, 'readonly');
            const req = tx.objectStore(IMAGE_STORE_NAME).get(id);
            req.onsuccess = () => resolve(req.result?.dataUrl || '');
            req.onerror = () => reject(req.error || new Error('이미지를 IndexedDB에서 읽지 못했어요.'));
        });
    }

    async function deleteStoredImage(id) {
        if (!id) return;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IMAGE_STORE_NAME, 'readwrite');
            tx.objectStore(IMAGE_STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('이미지를 IndexedDB에서 삭제하지 못했어요.'));
        });
    }

    function makeReferenceAssetId() {
        return `ref_${getRoomId()}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function normalizeReferenceType(type) {
        const raw = String(type || '').trim().toLowerCase();
        if (raw === 'style') return 'style';
        if (raw === 'character_style' || raw === 'character&style' || raw === 'character-style') return 'character_style';
        return 'character';
    }

    function getReferenceTypeLabel(type) {
        const normalized = normalizeReferenceType(type);
        if (normalized === 'style') return 'Style Reference';
        if (normalized === 'character_style') return 'Character & Style Reference';
        return 'Character Reference';
    }

    function getReferenceTypeCaption(type) {
        const normalized = normalizeReferenceType(type);
        if (normalized === 'style') return 'style';
        if (normalized === 'character_style') return 'character&style';
        return 'character';
    }

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    }

    function dataUrlToBase64(dataUrl) {
        return String(dataUrl || '').replace(/^data:[^;]+;base64,/, '');
    }

    function loadImageElement(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Reference 이미지를 읽지 못했어요.'));
            img.src = dataUrl;
        });
    }

    async function resizeReferenceDataUrlToBase64(dataUrl) {
        const img = await loadImageElement(dataUrl);
        const targetSizes = [
            { width: 1024, height: 1536 },
            { width: 1472, height: 1472 },
            { width: 1536, height: 1024 }
        ];

        const ratio = img.width / Math.max(1, img.height);
        let best = targetSizes[0];
        let bestDiff = Infinity;
        targetSizes.forEach(size => {
            const diff = Math.abs((size.width / size.height) - ratio);
            if (diff < bestDiff) {
                best = size;
                bestDiff = diff;
            }
        });

        const scale = Math.min(best.width / img.width, best.height / img.height);
        const drawWidth = Math.max(1, Math.round(img.width * scale));
        const drawHeight = Math.max(1, Math.round(img.height * scale));
        const x = Math.floor((best.width - drawWidth) / 2);
        const y = Math.floor((best.height - drawHeight) / 2);

        const canvas = document.createElement('canvas');
        canvas.width = best.width;
        canvas.height = best.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, x, y, drawWidth, drawHeight);

        return dataUrlToBase64(canvas.toDataURL('image/png'));
    }

    function hasUsableReference(char) {
        return !!(char && char.referenceEnabled && char.referenceAssetId);
    }

    function getActiveReferenceChar(charPrompts) {
        return (Array.isArray(charPrompts) ? charPrompts : []).find(hasUsableReference) || null;
    }

    function getReferenceExtraAnlas(charPrompts) {
        return getActiveReferenceChar(charPrompts) ? PRECISE_REFERENCE_EXTRA_ANLAS : 0;
    }

    const NORMAL_STEP_ANLAS_COST_MAP = {
        29: 20,
        30: 21,
        31: 22,
        32: 22,
        33: 23,
        34: 23,
        35: 24,
        36: 24,
        37: 25,
        38: 26,
        39: 26,
        40: 27,
        41: 27,
        42: 28,
        43: 29,
        44: 29,
        45: 30,
        46: 30,
        47: 31,
        48: 31,
        49: 32,
        50: 33
    };

    function estimateBaseImageAnlasCost(settings = {}) {
        const width = Number(settings.width || 832);
        const height = Number(settings.height || 1216);
        const steps = Math.max(1, Math.min(50, Number(settings.steps || 28)));
        const pixels = Math.max(1, width * height);

        // Shared build only supports Normal resolutions.
        // 28 steps 이하 무료, 29~50은 사용자 제공 실측표를 우선 사용.
        const normalOrUnder = pixels <= 1024 * 1024;
        if (normalOrUnder) {
            if (steps <= 28) return 0;
            return Number(NORMAL_STEP_ANLAS_COST_MAP[steps] ?? 0);
        }

        // Fallback for unexpected future resolutions.
        return 0;
    }

    function estimateTotalAnlasCost(settings = {}, charPrompts = []) {
        return estimateBaseImageAnlasCost(settings) + getReferenceExtraAnlas(charPrompts);
    }

    function getModalNaiSettings(overlay) {
        return {
            width: Number(overlay?.querySelector('#cspm-nai-width')?.value || 832),
            height: Number(overlay?.querySelector('#cspm-nai-height')?.value || 1216),
            steps: Number(overlay?.querySelector('#cspm-nai-steps')?.value || 28)
        };
    }

    function getReferenceSummary(charPrompts) {
        const char = getActiveReferenceChar(charPrompts);
        if (!char) return null;
        return {
            enabled: true,
            name: getCharacterSlotName(char) || 'Character 1',
            type: normalizeReferenceType(char.referenceType),
            typeLabel: getReferenceTypeLabel(char.referenceType),
            strength: clampNumber(char.referenceStrength, -1, 1, 0.6),
            fidelity: clampNumber(char.referenceFidelity, -1, 1, 0.8),
            assetId: char.referenceAssetId || '',
            imageName: char.referenceImageName || '',
            extraAnlas: PRECISE_REFERENCE_EXTRA_ANLAS
        };
    }

    async function preparePreciseReference(charPrompts) {
        const summary = getReferenceSummary(charPrompts);
        if (!summary) return null;

        const dataUrl = await readReferenceFileAsDataUrl(summary.assetId);
        if (!dataUrl) {
            console.warn('[Univers Scene Painter Mobile] reference asset missing:', summary.assetId);
            return null;
        }

        return {
            ...summary,
            base64: await resizeReferenceDataUrlToBase64(dataUrl)
        };
    }

    async function fetchNaiAnlasBalance() {
        const global = getGlobalSettings();
        if (!global.naiApiKey) throw new Error('NAI API Key / Token이 비어 있어요.');

        const data = await gmRequestJson({
            method: 'GET',
            url: 'https://api.novelai.net/user/data',
            headers: {
                'Authorization': 'Bearer ' + global.naiApiKey,
                'Content-Type': 'application/json'
            }
        });

        const steps = data?.subscription?.trainingStepsLeft || {};
        const fixed = Number(steps.fixedTrainingStepsLeft || 0);
        const purchased = Number(steps.purchasedTrainingSteps || 0);
        const total = fixed + purchased;

        if (!Number.isFinite(total)) throw new Error('잔여 Anlas 값을 읽지 못했어요.');
        return { total, fixed, purchased, raw: data };
    }

    async function hydrateReferencePreview(card, assetId) {
        const img = card.querySelector('.cspm-reference-preview-img');
        const status = card.querySelector('.cspm-reference-status');
        const deleteBtn = card.querySelector('.cspm-reference-delete');
        const enabled = card.querySelector('.cspm-reference-enabled');

        if (!img || !status || !deleteBtn) return;

        if (!assetId) {
            img.removeAttribute('src');
            img.style.display = 'none';
            deleteBtn.style.display = 'none';
            status.textContent = 'Reference 파일 없음 · 파일 선택으로 추가';
            return;
        }

        try {
            const dataUrl = await readReferenceFileAsDataUrl(assetId);
            if (!dataUrl) throw new Error('저장된 Reference 파일을 찾지 못했어요.');
            img.src = dataUrl;
            img.style.display = 'block';
            deleteBtn.style.display = 'inline-flex';
            status.textContent = enabled?.checked
                ? `Reference 사용 중 · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성 · 내부 저장소`
                : 'Reference 저장됨 · 사용 OFF · 내부 저장소';
        } catch (err) {
            img.removeAttribute('src');
            img.style.display = 'none';
            deleteBtn.style.display = 'none';
            status.textContent = 'Reference 파일 로드 실패: ' + err.message;
        }
    }

    function markSceneButtons(messageKey, hasImage) {
        if (!messageKey) return;
        document.querySelectorAll(`.cspm-message-generate-btn[data-message-key="${CSS.escape(messageKey)}"], .cspm-message-speed-btn[data-message-key="${CSS.escape(messageKey)}"]`).forEach(btn => {
            if (hasImage) {
                btn.setAttribute('data-cspm-has-image', 'true');
            } else {
                btn.removeAttribute('data-cspm-has-image');
                btn.removeAttribute('data-cspm-loading');
                btn.disabled = false;
                btn.title = btn.classList.contains('cspm-message-speed-btn') ? '스피드 모드: 분석 후 바로 NAI 생성' : '이 AI 답변으로 이미지 생성';
            }
        });
    }

    async function clearSceneRecordForMessage(messageKey, options = {}) {
        if (!messageKey) return;

        const records = getSceneRecords();
        const record = records[messageKey];

        if (record) {
            await deleteAllHistoryImages(record, makeStoredImageId(messageKey));
            delete records[messageKey];
            saveSceneRecords(records);
        } else {
            try {
                await deleteStoredImage(makeStoredImageId(messageKey));
            } catch (_) {}
        }

        if (options.removeDom !== false) {
            if (options.box?.isConnected) {
                const row = options.box.nextElementSibling?.classList?.contains('cspm-image-history-row')
                    ? options.box.nextElementSibling
                    : document.querySelector(`.cspm-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`);
                row?.remove();
                options.box.remove();
            } else {
                document
                    .querySelectorAll(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"], .cspm-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
                    .forEach(el => el.remove());
            }
        }

        markSceneButtons(messageKey, false);
    }

    async function migrateSceneImagesToIndexedDb() {
        const keys = Object.keys(localStorage).filter(key => key.startsWith(`${CSP_PREFIX}_scene_records_`));
        for (const storageKey of keys) {
            const records = safeJsonParse(localStorage.getItem(storageKey), {});
            let changed = false;
            for (const [messageKey, record] of Object.entries(records)) {
                if (!record) continue;
                const rawUrl = String(record.imageUrl || '');
                normalizeSceneRecordHistory(record, messageKey);
                const roomPart = storageKey.replace(`${CSP_PREFIX}_scene_records_`, '') || getRoomId();
                if (Array.isArray(record.history)) {
                    for (const item of record.history) {
                        if (!item) continue;
                        const itemUrl = String(item.imageUrl || '');
                        if (itemUrl.startsWith('data:')) {
                            const imageId = item.imageId || `${roomPart}::${messageKey}::${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                            try {
                                await putStoredImage(imageId, itemUrl);
                                item.imageId = imageId;
                                delete item.imageUrl;
                                changed = true;
                            } catch (err) {
                                console.warn('[Univers Scene Painter Mobile] migration history image save failed:', err);
                            }
                        } else if (itemUrl.startsWith('blob:')) {
                            delete item.imageUrl;
                            changed = true;
                        }
                    }
                    record.history = record.history.filter(item => item && (item.imageId || item.imageUrl)).slice(-CSP_MAX_IMAGE_HISTORY);
                    record.currentIndex = clampHistoryIndex(record);
                    syncCurrentImageFieldsFromHistory(record);
                }
                if (rawUrl.startsWith('data:')) {
                    const imageId = record.imageId || `${roomPart}::${messageKey}`;
                    try {
                        await putStoredImage(imageId, rawUrl);
                        record.imageId = imageId;
                        delete record.imageUrl;
                        changed = true;
                    } catch (err) {
                        console.warn('[Univers Scene Painter Mobile] migration image save failed:', err);
                    }
                } else if (rawUrl.startsWith('blob:')) {
                    delete record.imageUrl;
                    changed = true;
                }
            }
            if (changed) {
                try {
                    localStorage.setItem(storageKey, JSON.stringify(stripLargeImageFields(records)));
                } catch (err) {
                    console.warn('[Univers Scene Painter Mobile] migration localStorage save failed, removing large records:', err);
                    const compact = stripLargeImageFields(records);
                    localStorage.setItem(storageKey, JSON.stringify(compact));
                }
            }
        }
    }

    function dataUrlToBlob(dataUrl) {
        const [header, base64] = String(dataUrl || '').split(',');
        const mimeMatch = header.match(/data:([^;]+);base64/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const binary = atob(base64 || '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function getFileExtension(name, fallback = 'png') {
        const raw = String(name || '');
        const match = raw.match(/\.([a-zA-Z0-9]+)$/);
        return (match?.[1] || fallback).toLowerCase();
    }

    function makeReferenceFileName(slotName, sourceName = '') {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const ext = getFileExtension(sourceName, 'png');
        return `Ref_${sanitizeFileName(getRoomId())}_${sanitizeFileName(slotName || 'character')}_${stamp}.${ext}`;
    }

    async function saveReferenceFileToLibrary(file, slotName = 'character') {
        if (!file) throw new Error('Reference 이미지 파일이 없어요.');
        const filename = makeReferenceFileName(slotName, file.name || 'reference.png');

        // 폴더 핸들 대신 IndexedDB에 직접 저장한다.
        const dataUrl = await blobToDataUrl(file);
        await putStoredImage(filename, dataUrl);
        return filename;
    }

    async function readReferenceFileAsDataUrl(filename) {
        if (!filename) return '';
        try {
            return await getStoredImage(filename);
        } catch (_) {
            return '';
        }
    }

    async function deleteReferenceFileFromLibrary(filename) {
        if (!filename) return;
        try { await deleteStoredImage(filename); } catch (_) {}
    }

    function isEnabled() {
        return localStorage.getItem(ENABLED_KEY) !== 'off';
    }

    function applySceneVisibilityState(enabled = isEnabled()) {
        document.body.classList.toggle('cspm-scene-hidden', !enabled);
    }

    function setEnabled(value) {
        localStorage.setItem(ENABLED_KEY, value ? 'on' : 'off');
    }

    function hashText(text) {
        let hash = 5381;
        const str = String(text || '');
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash >>> 0;
        }
        return hash.toString(36);
    }

    function cleanMarkdownText(markdown) {
        if (!markdown) return '';
        const clone = markdown.cloneNode(true);
        stripNonSceneNodes(clone);
        return clone.textContent.replace(/\s+/g, ' ').trim();
    }

    function getMessageKey(markdown) {
        if (!markdown) return hashText('');
        // [버그 2 수정] data-message-id가 있으면 텍스트 해시 대신 그걸 우선 키로 사용한다.
        // 본문이 리롤(재생성)되면 텍스트 해시가 바뀌어 저장된 기록을 못 찾는 문제를 방지한다.
        const group = markdown.closest?.('[data-message-id]');
        const msgId = group?.getAttribute('data-message-id') || markdown.getAttribute?.('data-message-id') || '';
        if (msgId) return 'mid_' + msgId;
        const text = cleanMarkdownText(markdown);
        return hashText(text.slice(0, 1500));
    }

    function getOrientationPresetDimensions(preset) {
        switch (String(preset || '').trim()) {
            case 'portrait':
                return { width: 832, height: 1216 };
            case 'landscape':
                return { width: 1216, height: 832 };
            case 'square':
                return { width: 1024, height: 1024 };
            default:
                return null;
        }
    }

    function detectOrientationPreset(width, height) {
        const w = Number(width);
        const h = Number(height);
        if (w === 1216 && h === 832) return 'landscape';
        if (w === 1024 && h === 1024) return 'square';
        return 'portrait';
    }

    function updateResolutionDisplay(widthInput, heightInput, widthViewEl, heightViewEl) {
        if (widthViewEl) widthViewEl.textContent = String(widthInput?.value || '');
        if (heightViewEl) heightViewEl.textContent = String(heightInput?.value || '');
    }

    function applyOrientationPreset(preset, widthInput, heightInput, widthViewEl = null, heightViewEl = null) {
        const dims = getOrientationPresetDimensions(preset);
        if (!dims) return;
        widthInput.value = String(dims.width);
        heightInput.value = String(dims.height);
        updateResolutionDisplay(widthInput, heightInput, widthViewEl, heightViewEl);
    }

    function swapOrientationPreset(selectEl, widthInput, heightInput, widthViewEl = null, heightViewEl = null) {
        if (!selectEl || !widthInput || !heightInput) return;
        const current = detectOrientationPreset(widthInput.value, heightInput.value);
        const next = current === 'portrait' ? 'landscape' : current === 'landscape' ? 'portrait' : 'square';
        selectEl.value = next;
        applyOrientationPreset(next, widthInput, heightInput, widthViewEl, heightViewEl);
    }

    function bindRangeNumberPair(rangeEl, numberEl, valueEl = null, opts = {}) {
        if (!rangeEl || !numberEl) return;
        const min = Number.isFinite(Number(opts.min)) ? Number(opts.min) : Number(rangeEl.min || numberEl.getAttribute('min') || 0);
        const max = Number.isFinite(Number(opts.max)) ? Number(opts.max) : Number(rangeEl.max || numberEl.getAttribute('max') || 100);
        const step = Number.isFinite(Number(opts.step)) ? Number(opts.step) : Number(rangeEl.step || numberEl.getAttribute('step') || 1);
        const decimals = Number.isFinite(Number(opts.decimals)) ? Number(opts.decimals) : (String(step).includes('.') ? String(step).split('.')[1].length : 0);
        const clamp = (v) => Math.min(max, Math.max(min, v));
        const normalize = (v) => {
            let num = Number(String(v ?? '').trim());
            if (!Number.isFinite(num)) num = min;
            num = clamp(num);
            if (step > 0) {
                num = Math.round(num / step) * step;
                num = clamp(num);
            }
            return Number(num.toFixed(decimals));
        };
        const format = (num) => decimals > 0 ? Number(num).toFixed(decimals) : String(Math.round(Number(num)));
        const render = (num) => {
            const normalized = normalize(num);
            const display = format(normalized);
            rangeEl.value = String(normalized);
            numberEl.value = display;
            if (valueEl) valueEl.textContent = display;
            if (typeof opts.onChange === 'function') opts.onChange(normalized);
        };
        const softSyncNumber = () => {
            const raw = String(numberEl.value || '').trim();
            // 입력 도중 빈칸/소수점/마이너스 같은 중간 상태는 건드리지 않는다.
            if (!raw || raw === '-' || raw === '.' || raw === '-.') return;
            const num = Number(raw);
            if (!Number.isFinite(num)) return;
            const clamped = clamp(num);
            rangeEl.value = String(clamped);
            if (valueEl) valueEl.textContent = raw;
            if (typeof opts.onChange === 'function') opts.onChange(normalize(clamped));
        };
        const commitNumber = () => render(numberEl.value);
        rangeEl.addEventListener('input', () => render(rangeEl.value));
        numberEl.addEventListener('input', softSyncNumber);
        numberEl.addEventListener('change', commitNumber);
        numberEl.addEventListener('blur', commitNumber);
        numberEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                commitNumber();
                numberEl.blur();
            }
        });
        numberEl.addEventListener('wheel', (e) => {
            // 브라우저 기본 number/spinner 계열 동작이나 트랙패드 휠로 값이 튀는 문제 방지.
            e.preventDefault();
        }, { passive: false });
        render(numberEl.value);
    }

    function sanitizeFileName(name) {
        return String(name || 'scene-image')
            .replace(/[\/:*?"<>|]+/g, '_')
            .replace(/\s+/g, '_')
            .slice(0, 80) || 'scene-image';
    }

    function showToast(message) {
        const old = document.getElementById('cspm-toast');
        if (old) old.remove();

        const toast = document.createElement('div');
        toast.id = 'cspm-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            left: 50%;
            bottom: 28px;
            transform: translateX(-50%);
            z-index: 1000000;
            background: rgba(20,20,20,0.92);
            color: #fff;
            padding: 11px 18px;
            border-radius: 999px;
            font-size: 13px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.35);
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
    }


    function showTaskHud(title, message, progress = 8) {
        hideTaskHud(true);

        const abortController = new AbortController();
        const backdrop = document.createElement('div');
        backdrop.className = 'cspm-task-hud-backdrop';
        backdrop.innerHTML = `
            <div class="cspm-task-hud">
                <div class="cspm-task-hud-header">
                    <div class="cspm-task-hud-spinner"></div>
                    <div class="cspm-task-hud-title"></div>
                    <button class="cspm-task-hud-cancel" type="button" title="작업 취소" aria-label="작업 취소">×</button>
                </div>
                <div class="cspm-task-hud-message"></div>
                <div class="cspm-task-hud-bar"><div class="cspm-task-hud-bar-fill"></div></div>
                <div class="cspm-task-hud-footer">
                    <span class="cspm-task-hud-progress-label"></span>
                    <span>오래 걸리면 콘솔 확인</span>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        currentTaskHud = {
            el: backdrop,
            abortController,
            titleEl: backdrop.querySelector('.cspm-task-hud-title'),
            messageEl: backdrop.querySelector('.cspm-task-hud-message'),
            barEl: backdrop.querySelector('.cspm-task-hud-bar-fill'),
            labelEl: backdrop.querySelector('.cspm-task-hud-progress-label'),
            startedAt: Date.now()
        };

        const cancelBtn = backdrop.querySelector('.cspm-task-hud-cancel');
        cancelBtn?.addEventListener('click', () => {
            if (!abortController.signal.aborted) {
                abortController.abort();
                updateTaskHud({
                    title: '작업 취소 중',
                    message: '진행 중인 API 요청을 중단하고 있어.',
                    progress: 100,
                    status: 'error'
                });
                cancelBtn.disabled = true;
            }
        });

        updateTaskHud({ title, message, progress });
        return currentTaskHud;
    }

    function updateTaskHud({ title, message, progress, status } = {}) {
        if (!currentTaskHud || !currentTaskHud.el?.isConnected) return;

        if (title !== undefined) currentTaskHud.titleEl.textContent = String(title || '작업 중');
        if (message !== undefined) currentTaskHud.messageEl.textContent = String(message || '');
        if (progress !== undefined) {
            const pct = Math.max(0, Math.min(100, Number(progress) || 0));
            currentTaskHud.barEl.style.width = `${pct}%`;
            currentTaskHud.labelEl.textContent = `${Math.round(pct)}%`;
        }

        const box = currentTaskHud.el.querySelector('.cspm-task-hud');
        box?.classList.remove('cspm-task-hud-status-success', 'cspm-task-hud-status-error');
        if (status === 'success') box?.classList.add('cspm-task-hud-status-success');
        if (status === 'error') box?.classList.add('cspm-task-hud-status-error');
    }

    function hideTaskHud(immediate = false) {
        if (!currentTaskHud || !currentTaskHud.el) return;
        const el = currentTaskHud.el;
        currentTaskHud = null;
        if (immediate) {
            el.remove();
            return;
        }
        setTimeout(() => el.remove(), 320);
    }

    function startTaskHudTicker(steps) {
        let i = 0;
        let stopped = false;
        const safeSteps = Array.isArray(steps) ? steps : [];

        function tick() {
            if (stopped || !currentTaskHud) return;
            if (i < safeSteps.length) {
                updateTaskHud(safeSteps[i]);
                i += 1;
            }
        }

        tick();
        const timer = setInterval(tick, 1600);

        return {
            stop() {
                stopped = true;
                clearInterval(timer);
            }
        };
    }

    function injectStyles() {
        if (document.getElementById('cspm-scene-painter-style')) return;

        const style = document.createElement('style');
        style.id = 'cspm-scene-painter-style';
        style.textContent = `
            .cspm-overlay {
                --cspm-surface: #242321;
                --cspm-surface-2: rgba(255,255,255,0.055);
                --cspm-surface-3: rgba(0,0,0,0.28);
                --cspm-text: #f5f5f5;
                --cspm-muted: #c9c9ce;
                --cspm-soft: #a9abb3;
                --cspm-border: rgba(255,255,255,0.16);
                --cspm-input: rgba(0,0,0,0.34);
                --cspm-input-text: #f5f5f5;
                --cspm-shadow: rgba(0,0,0,0.45);
                position: fixed;
                inset: 0;
                width: 100vw;
                max-width: 100vw;
                z-index: 999999;
                background: rgba(0, 0, 0, 0.58);
                display: flex;
                justify-content: center;
                align-items: center;
                overflow-x: hidden;
                overscroll-behavior-x: none;
            }
            body[data-theme="light"] .cspm-overlay {
                --cspm-surface: #ffffff;
                --cspm-surface-2: #f5f6f8;
                --cspm-surface-3: #eef0f3;
                --cspm-text: #1f2328;
                --cspm-muted: #4b5563;
                --cspm-soft: #6b7280;
                --cspm-border: rgba(31,35,40,0.18);
                --cspm-input: #ffffff;
                --cspm-input-text: #111827;
                --cspm-shadow: rgba(31,35,40,0.18);
            }
            body[data-theme="dark"] .cspm-overlay {
                --cspm-surface: #242321;
                --cspm-surface-2: rgba(255,255,255,0.055);
                --cspm-surface-3: rgba(0,0,0,0.28);
                --cspm-text: #f5f5f5;
                --cspm-muted: #c9c9ce;
                --cspm-soft: #a9abb3;
                --cspm-border: rgba(255,255,255,0.16);
                --cspm-input: rgba(0,0,0,0.34);
                --cspm-input-text: #f5f5f5;
                --cspm-shadow: rgba(0,0,0,0.45);
            }
            .cspm-modal {
                box-sizing: border-box;
                width: 820px;
                max-width: calc(100vw - 32px);
                max-height: calc(100vh - 40px);
                overflow-y: auto;
                overflow-x: hidden;
                overscroll-behavior-x: none;
                border-radius: 18px;
                background: var(--cspm-surface);
                color: var(--cspm-text);
                box-shadow: 0 18px 60px var(--cspm-shadow);
                padding: 22px;
                font-family: inherit;
            }
            .cspm-modal h2 { font-size: 18px; margin: 0 0 6px; font-weight: 800; color: var(--cspm-text); }
            .cspm-desc {
                font-size: 12px;
                line-height: 1.55;
                color: var(--cspm-muted);
                margin-bottom: 18px;
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .cspm-section {
                border: 1px solid var(--cspm-border);
                border-radius: 14px;
                padding: 14px;
                margin-top: 12px;
                background: var(--cspm-surface-2);
            }
            .cspm-section

// ==UserScript==
// @name         Univers Scene Painter
// @namespace    univers-scene-painter
// @version      3.7.2
// @description  Storage compact mode + scoped DOM rebuild for Crack Scene Painter
// @match        https://www.univers.chat/*
// @grant        GM_xmlhttpRequest
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

    const CSP_PREFIX = 'csp_scene_painter';
    const GLOBAL_SETTINGS_KEY = `${CSP_PREFIX}_global_settings`;
    const ENABLED_KEY = `${CSP_PREFIX}_enabled`;
    const IMAGE_DB_NAME = `${CSP_PREFIX}_image_db`;
    const IMAGE_STORE_NAME = 'images';
    const HANDLE_STORE_NAME = 'handles';
    const META_STORE_NAME = 'meta';
    const IMAGE_DB_VERSION = 3;
    const PRECISE_REFERENCE_EXTRA_ANLAS = 5;
    const REFERENCE_SUBDIR_NAME = 'CSP_References';
    let injectScheduled = false;
    let menuInjectScheduled = false;
    let messageInjectScheduled = false;
    let observerRefreshScheduled = false;
    let currentTaskHud = null;
    let imageDbPromise = null;

    const GEMINI_MODEL_OPTIONS = [
        'gemini-3-pro-preview',
        'gemini-3.5-flash',
        'gemini-3.1-pro',
        'gemini-3.1-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite'
    ];


    // ──────────────────────────────────────────────────────────────────
    // OpenAI / Anthropic Claude / OpenRouter 지원
    // ──────────────────────────────────────────────────────────────────

    const OPENAI_MODEL_OPTIONS = [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4.1',
        'gpt-4.1-mini',
        'gpt-4.1-nano',
        'o3-mini',
        'o4-mini'
    ];

    const CLAUDE_MODEL_OPTIONS = [
        'claude-opus-4-5',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
        'claude-opus-4',
        'claude-sonnet-4',
        'claude-3-7-sonnet-20250219',
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022'
    ];

    function normalizeOpenAiModelId(model) {
        const raw = String(model || 'gpt-4o').trim();
        return OPENAI_MODEL_OPTIONS.includes(raw) ? raw : 'gpt-4o';
    }

    function normalizeClaudeModelId(model) {
        const raw = String(model || 'claude-sonnet-4-5').trim();
        return CLAUDE_MODEL_OPTIONS.includes(raw) ? raw : 'claude-sonnet-4-5';
    }


    // ── 재시도 래퍼 (429 / 5xx 일시적 에러 자동 재시도) ──────────────────
    async function withRetry(fn, { maxRetries = 3, baseDelayMs = 2000, label = '' } = {}) {
        const RETRYABLE = new Set([429, 500, 502, 503, 504]);
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastErr = err;
                const msg = String(err?.message || err || '');
                // httpStatus가 직접 달려있으면 우선 사용, 없으면 메시지에서 추출
                const status = err?.httpStatus || (() => {
                    const m = msg.match(/\b(\d{3})\b/);
                    return m ? Number(m[1]) : 0;
                })();
                // 4xx 클라이언트 에러는 재시도해도 동일 — 즉시 실패 (429 rate limit은 제외)
                if (status >= 400 && status < 500 && status !== 429) break;

                const isRetryable = RETRYABLE.has(status) ||
                    /rate.?limit|too many|overloaded|provider returned error|service unavailable|시간이 초과|timeout/i.test(msg);

                if (!isRetryable || attempt >= maxRetries) break;

                // 서버가 Retry-After를 알려주면 그 시간을 우선 사용, 아니면 지수 백오프
                const serverRetryAfter = err?.retryAfterSec ? Number(err.retryAfterSec) : null;
                const delaySec = serverRetryAfter
                    ? serverRetryAfter + 1  // 서버 지정 시간 + 1초 여유
                    : Math.round((baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000) / 1000);
                const delay = delaySec * 1000;
                console.warn(`[Crack Scene Painter] ${label} 재시도 ${attempt + 1}/${maxRetries} — ${delaySec}초 후 재시도. 원인: ${msg.slice(0, 120)}`);
                // HUD에 재시도 상태 표시
                if (typeof updateTaskHud === 'function') {
                    updateTaskHud({ title: `재시도 중 (${attempt + 1}/${maxRetries})`, message: `${label} 오류로 ${delaySec}초 후 재시도해. 원인: ${msg.slice(0, 80)}` });
                }
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw lastErr;
    }






    /** Zhipu AI (GLM) API 호출 (OpenAI 호환) */
    async function callGlmGenerateContent(request, systemText, userText) {
        // GLM 무료 모델은 128K 컨텍스트 지원, 실제 안정적 요청 크기 기준으로 트리밍
        const MAX_SYS_CHARS = 6000;
        const MAX_USER_CHARS = 20000;
        const trimmedSys = systemText.length > MAX_SYS_CHARS
            ? systemText.slice(0, MAX_SYS_CHARS) + '\n...(생략)'
            : systemText;
        const trimmedUser = userText.length > MAX_USER_CHARS
            ? userText.slice(0, MAX_USER_CHARS) + '\n...(컨텍스트 길이 초과로 일부 생략)'
            : userText;
        const payload = {
            model: request.model,
            messages: [
                ...(trimmedSys ? [{ role: 'system', content: trimmedSys }] : []),
                { role: 'user', content: trimmedUser }
            ],
            temperature: request.temperature ?? 0.18,
            top_p: request.topP ?? 0.75,
            max_tokens: 16384,
            stream: false
        };
        const data = await gmRequestJson({
            method: 'POST',
            url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${request.apiKey}`
            },
            data: payload
        });
        const text = (data?.choices || []).map(c => c.message?.content || '').join('\n').trim();
        if (!text) {
            console.warn('[Crack Scene Painter] GLM 응답 디버그:', JSON.stringify({
                choices: (data?.choices || []).map(c => ({
                    finish_reason: c.finish_reason,
                    content: c.message?.content,
                    role: c.message?.role
                }))
            }));
        }
        return { _glmRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }

    /** OpenAI Chat Completions API 호출 */
    async function callOpenAiGenerateContent(request, systemText, userText) {
        // o1/o3/o4 추론 모델은 temperature/top_p 미지원 → 생략
        const isReasoningModel = /^o\d/.test(String(request.model || ''));
        const payload = {
            model: request.model,
            messages: [
                ...(systemText ? [{ role: 'system', content: systemText }] : []),
                { role: 'user', content: userText }
            ],
            ...(isReasoningModel ? {} : {
                temperature: request.temperature ?? 0.18,
                top_p: request.topP ?? 0.75
            }),
            response_format: request.responseFormat ?? undefined
        };
        const data = await gmRequestJson({
            method: 'POST',
            url: request.url,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${request.apiKey}` },
            data: payload
        });
        const text = (data?.choices || []).map(c => c.message?.content || '').join('\n').trim();
        return { _openaiRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }

    /** Anthropic Messages API 호출 */
    async function callAnthropicGenerateContent(request, systemText, userText) {
        const payload = {
            model: request.model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: userText }],
            ...(systemText ? { system: systemText } : {}),
            temperature: request.temperature ?? 0.18
        };
        const data = await gmRequestJson({
            method: 'POST',
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': request.apiKey,
                'anthropic-version': '2023-06-01'
            },
            data: payload
        });
        const text = (data?.content || []).map(c => c.text || '').join('\n').trim();
        if (!text) {
            console.warn('[Crack Scene Painter] Anthropic 응답 디버그:', JSON.stringify({
                stop_reason: data?.stop_reason,
                content: data?.content,
                error: data?.error
            }));
        }
        return { _anthropicRaw: data, candidates: [{ content: { parts: [{ text }] } }] };
    }


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

    async function callFirebaseAiLogicGenerateContent(geminiRequest, payload) {
        const firebaseConfig = parseFirebaseConfigInput(geminiRequest.firebaseConfigJson);
        if (!firebaseConfig || typeof firebaseConfig !== 'object') {
            throw new Error('Firebase Config가 비어 있어요.');
        }

        const location = String(geminiRequest.firebaseLocation || 'global').trim() || 'global';
        const sdkVersion = String(geminiRequest.firebaseSdkVersion || '12.5.0').trim() || '12.5.0';

        const firebase = await loadFirebaseAiModules(sdkVersion);
        const appName = `csp-firebase-${hashTiny(getFirebaseConfigSummary(firebaseConfig))}`;
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

        // ── OpenAI ──────────────────────────────────────────────────────
        if (provider === 'openai') {
            const systemText = String((payload?.systemInstruction?.parts || [])
                .map(p => p?.text || '').filter(Boolean).join('\n')).trim();
            const userText = String((payload?.contents || [])
                .flatMap(c => c.parts || []).map(p => p?.text || '').join('\n')).trim();
            const genCfg = payload?.generationConfig || {};
            const useJson = String(genCfg.responseMimeType || '').includes('json');
            return await withRetry(() => callOpenAiGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP,
                  responseFormat: useJson ? { type: 'json_object' } : undefined },
                systemText, userText
            ), { label: 'OpenAI' });
        }

        // ── Anthropic Claude ─────────────────────────────────────────────
        if (provider === 'anthropic') {
            const systemText = String((payload?.systemInstruction?.parts || [])
                .map(p => p?.text || '').filter(Boolean).join('\n')).trim();
            const userText = String((payload?.contents || [])
                .flatMap(c => c.parts || []).map(p => p?.text || '').join('\n')).trim();
            const genCfg = payload?.generationConfig || {};
            return await withRetry(() => callAnthropicGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature },
                systemText, userText
            ), { label: 'Anthropic' });
        }

        // ── Zhipu AI (GLM) ───────────────────────────────────────────────
        if (provider === 'glm') {
            const systemText = String((payload?.systemInstruction?.parts || [])
                .map(p => p?.text || '').filter(Boolean).join('\n')).trim();
            const rawUserGlm = String((payload?.contents || [])
                .flatMap(c => c.parts || []).map(p => p?.text || '').join('\n')).trim();
            const genCfg = payload?.generationConfig || {};
            const useJsonGlm = String(genCfg.responseMimeType || '').includes('json');
            const userText = useJsonGlm
                ? rawUserGlm + '\n\n[IMPORTANT] Respond with ONLY a valid JSON object. No explanation, no markdown, no code block. Start your response with { and end with }.'
                : rawUserGlm;
            return await withRetry(() => callGlmGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP },
                systemText, userText
            ), { label: 'GLM' });
        }

        // ── OpenRouter ───────────────────────────────────────────────────
        if (provider === 'openrouter') {
            const OR_MAX_SYS_CHARS = 6000;
            const OR_MAX_USER_CHARS = 20000;
            const rawSys = String((payload?.systemInstruction?.parts || [])
                .map(p => p?.text || '').filter(Boolean).join('\n')).trim();
            const rawUser = String((payload?.contents || [])
                .flatMap(c => c.parts || []).map(p => p?.text || '').join('\n')).trim();
            const systemText = rawSys.length > OR_MAX_SYS_CHARS
                ? rawSys.slice(0, OR_MAX_SYS_CHARS) + '\n...(생략)'
                : rawSys;
            const genCfg = payload?.generationConfig || {};
            const useJson = String(genCfg.responseMimeType || '').includes('json');
            const trimmedUser = rawUser.length > OR_MAX_USER_CHARS
                ? rawUser.slice(0, OR_MAX_USER_CHARS) + '\n...(컨텍스트 길이 초과로 일부 생략)'
                : rawUser;
            // JSON 응답 강제: 유저 메시지 끝에 명시적 지시 추가 (무료 모델 호환성)
            const userText = useJson
                ? trimmedUser + '\n\n[IMPORTANT] Respond with ONLY a valid JSON object. No explanation, no markdown, no code block. Start your response with { and end with }.'
                : trimmedUser;
            return await withRetry(() => callOpenAiGenerateContent(
                { ...geminiRequest, temperature: genCfg.temperature, topP: genCfg.topP,
                  responseFormat: useJson ? { type: 'json_object' } : undefined },
                systemText, userText
            ), { label: 'OpenRouter' });
        }

        // ── Firebase / Vertex / AI Studio (기존 Gemini 경로) ────────────
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

    /** 현재 설정된 provider의 UI 표시용 이름 반환 */
    function getProviderDisplayName(global) {
        const provider = String(global?.geminiProvider || 'ai-studio').trim();
        if (provider === 'openai') return `OpenAI (${String(global?.openaiModel || 'gpt-4o').trim()})`;
        if (provider === 'anthropic') return `Claude (${String(global?.claudeModel || 'claude-sonnet-4-5').trim()})`;
        if (provider === 'glm') return `GLM (${String(global?.glmModel || 'glm-4.5-flash').trim()})`;
        if (provider === 'openrouter') return `OpenRouter (${String(global?.openrouterModel || 'google/gemini-2.0-flash-exp:free').trim()})`;
        if (provider === 'vertex') return 'Vertex AI';
        if (['firebase', 'firebase-ai', 'firebase-ai-logic'].includes(provider)) return 'Firebase AI';
        return `Gemini (${String(global?.googleModel || 'gemini-2.5-flash').trim()})`;
    }

    function getGeminiGenerateContentRequestConfig(global, options = {}) {
        const silent = !!options.silent;
        let provider = String(global?.geminiProvider || 'ai-studio').trim() || 'ai-studio';
        const hasFirebaseConfig = !!String(global?.firebaseConfigJson || '').trim();

        // Firebase AI Logic 모드가 저장값/버전에 따라 다른 이름으로 들어와도 Firebase 경유로 처리합니다.
        if (['firebase-ai', 'firebase-ai-logic', 'firebase-ailogic', 'Firebase AI Logic Beta'].includes(provider)) {
            provider = 'firebase';
        }

        // ── OpenAI ───────────────────────────────────────────────────────
        if (provider === 'openai') {
            const apiKey = String(global?.openaiApiKey || '').trim();
            const openaiModel = String(global?.openaiModel || 'gpt-4o').trim();
            if (!apiKey) {
                if (silent) return null;
                throw new Error('OpenAI API Key가 비어 있어요. 설정에서 OpenAI API Key를 입력해줘.');
            }
            return { provider: 'openai', model: openaiModel, apiKey,
                     url: 'https://api.openai.com/v1/chat/completions', headers: {} };
        }

        // ── Anthropic Claude ─────────────────────────────────────────────
        if (provider === 'anthropic') {
            const apiKey = String(global?.anthropicApiKey || '').trim();
            const claudeModel = String(global?.claudeModel || 'claude-sonnet-4-5').trim();
            if (!apiKey) {
                if (silent) return null;
                throw new Error('Anthropic API Key가 비어 있어요. 설정에서 Anthropic Claude API Key를 입력해줘.');
            }
            return { provider: 'anthropic', model: claudeModel, apiKey, headers: {} };
        }

        // ── Zhipu AI (GLM) ────────────────────────────────────────────────
        if (provider === 'glm') {
            const apiKey = String(global?.glmApiKey || '').trim();
            const glmModel = String(global?.glmModel || 'glm-4.5-flash').trim();
            if (!apiKey) {
                if (silent) return null;
                throw new Error('GLM API Key가 비어 있어요. 설정에서 Zhipu AI API Key를 입력해줘.');
            }
            return { provider: 'glm', model: glmModel, apiKey, headers: {} };
        }

        // ── OpenRouter ────────────────────────────────────────────────────
        if (provider === 'openrouter') {
            const apiKey = String(global?.openrouterApiKey || '').trim();
            const orModel = String(global?.openrouterModel || 'google/gemini-2.0-flash-exp:free').trim();
            if (!apiKey) {
                if (silent) return null;
                throw new Error('OpenRouter API Key가 비어 있어요. 설정에서 OpenRouter API Key를 입력해줘.');
            }
            return { provider: 'openrouter', model: orModel, apiKey,
                     url: 'https://openrouter.ai/api/v1/chat/completions', headers: {} };
        }

        // 사용자가 Firebase Config를 넣어둔 상태에서 provider가 Vertex로 남아 있으면
        // OAuth 직접 호출 대신 Firebase AI Logic 경유로 강제합니다.
        if (provider === 'vertex' && hasFirebaseConfig) {
            console.warn('[Crack Scene Painter] Vertex provider가 저장돼 있지만 Firebase Config가 있어서 Firebase AI Logic으로 강제 전환합니다.');
            provider = 'firebase';
        }

        const model = normalizeGeminiModelId(global?.googleModel);
        const headers = { 'Content-Type': 'application/json' };

        console.log('[Crack Scene Painter] Gemini request provider:', {
            provider,
            savedProvider: String(global?.geminiProvider || ''),
            model,
            hasFirebaseConfig,
            vertexProjectId: String(global?.vertexProjectId || '').trim() || '',
            hasVertexToken: !!String(global?.vertexAccessToken || '').trim()
        });

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
        // univers.chat: /play/<uuid>
        const match = location.pathname.match(/\/play\/([^/?#]+)/);
        if (match) return match[1];
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

    const COMPRESSED_JSON_PREFIX = '__CSP_JSON_GZIP_V1__';

    function bytesToBase64(bytes) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToBytes(base64) {
        const binary = atob(String(base64 || ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    function encodeLocalJsonValue(value) {
        const json = JSON.stringify(value ?? {});
        try {
            if (window.fflate?.gzipSync && window.fflate?.strToU8) {
                const compressed = window.fflate.gzipSync(window.fflate.strToU8(json));
                const encoded = `${COMPRESSED_JSON_PREFIX}${bytesToBase64(compressed)}`;
                // 너무 작은 값은 압축 오버헤드가 더 클 수 있으므로 원본이 더 짧으면 원본 사용.
                return encoded.length < json.length ? encoded : json;
            }
        } catch (err) {
            console.warn('[Crack Scene Painter] JSON compression failed, saving raw JSON:', err);
        }
        return json;
    }

    function decodeLocalJsonValue(value, fallback = {}) {
        const raw = String(value || '');
        if (!raw) return fallback;

        if (raw.startsWith(COMPRESSED_JSON_PREFIX)) {
            try {
                const payload = raw.slice(COMPRESSED_JSON_PREFIX.length);
                if (window.fflate?.gunzipSync && window.fflate?.strFromU8) {
                    const json = window.fflate.strFromU8(window.fflate.gunzipSync(base64ToBytes(payload)));
                    return JSON.parse(json);
                }
            } catch (err) {
                console.warn('[Crack Scene Painter] compressed JSON decode failed:', err);
                return fallback;
            }
        }

        return safeJsonParse(raw, fallback);
    }

    function getLocalJsonStorage(key, fallback = {}) {
        return decodeLocalJsonValue(localStorage.getItem(key), fallback);
    }

    function setLocalJsonStorage(key, value) {
        const encoded = encodeLocalJsonValue(value);
        localStorage.setItem(key, encoded);
        return encoded;
    }

    function isQuotaExceededError(err) {
        return !!err && (
            err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            /quota|exceed|storage/i.test(String(err.message || err))
        );
    }

    function getStringSizeKb(text) {
        return Math.round(new Blob([String(text || '')]).size / 1024);
    }

    function getLocalStorageRows(filter = '') {
        return Object.keys(localStorage)
            .filter(key => !filter || key.includes(filter))
            .map(key => {
                const value = localStorage.getItem(key) || '';
                return {
                    key,
                    kb: getStringSizeKb(key + value),
                    compressed: String(value).startsWith(COMPRESSED_JSON_PREFIX)
                };
            })
            .sort((a, b) => b.kb - a.kb);
    }

    function getCspStorageReport() {
        const allRows = getLocalStorageRows('');
        const cspRows = allRows.filter(row => row.key.includes(CSP_PREFIX));
        return {
            totalKB: allRows.reduce((sum, row) => sum + row.kb, 0),
            cspKB: cspRows.reduce((sum, row) => sum + row.kb, 0),
            cspKeyCount: cspRows.length,
            topCspRows: cspRows.slice(0, 8)
        };
    }

    function migrateLocalJsonStorageToCompressed() {
        const keys = Object.keys(localStorage).filter(key =>
            key === GLOBAL_SETTINGS_KEY ||
            key.startsWith(`${CSP_PREFIX}_room_settings_`) ||
            key.startsWith(`${CSP_PREFIX}_scene_records_`)
        );

        let changed = 0;
        keys.forEach(key => {
            const raw = localStorage.getItem(key) || '';
            if (!raw || raw.startsWith(COMPRESSED_JSON_PREFIX)) return;
            const parsed = safeJsonParse(raw, null);
            if (!parsed || typeof parsed !== 'object') return;
            try {
                const beforeKb = getStringSizeKb(raw);
                const encoded = setLocalJsonStorage(key, parsed);
                const afterKb = getStringSizeKb(encoded);
                if (afterKb !== beforeKb) changed += 1;
            } catch (err) {
                console.warn('[Crack Scene Painter] local JSON compression migration failed:', key, err);
            }
        });

        if (changed) {
            console.log(`[Crack Scene Painter] localStorage JSON 압축 마이그레이션 완료: ${changed}개`);
        }
        return changed;
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
        // CSP 전용 노드 제거
        root.querySelectorAll('.csp-generated-scene-image, .csp-image-history-row').forEach(el => el.remove());
        // <details> 태그 제거 — 캐릭터 정보 접기 블록, AI 분석에 불필요
        root.querySelectorAll('details').forEach(el => el.remove());
        // style 속성이 있는 <div>/<span> 중 상태창 패턴 제거
        // (background/border/padding 조합 → 유니버스 채팅의 인라인 스타일 상태창)
        root.querySelectorAll('div[style], span[style]').forEach(el => {
            const s = el.getAttribute('style') || '';
            if (/background|border|padding/i.test(s)) el.remove();
        });
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
        return `You are a JSON-only response AI. You MUST output ONLY a single valid JSON object. No explanations, no markdown, no code blocks, no extra text before or after. Just the raw JSON object.

Gemini 장면 태그 생성 지침:

[장면 선택]
- 채팅 로그에서 삽화로 만들 핵심 순간 하나만 선택한다.
- 로그 전체 요약, 단체 장면, 모든 캐릭터 모음 장면을 만들지 않는다.
- visibleCharacters에는 화면 중심에 실제로 보일 저장 캐릭터 이름 1명만 넣는다.
- 단순 언급, 회상, 주변 반응, 멀리 있는 인물은 visibleCharacters에서 제외한다.
- 사용자의 캐릭터는 화면 밖 상호작용 대상으로 간주하고 visibleCharacters에 넣지 않는다.
- 코드블록, 상태창, info 박스, 시간/관계/소지품 같은 메타 정보는 장면 본문이 아니므로 핵심 장면 선택에서 제외한다.
- insertAfterParagraph는 실제 행동/표정/감정이 드러나는 본문 문단 뒤 index로 정한다.
- 같은 요청에서 여러 장면을 생성할 때는 각 장면의 insertAfterParagraph가 서로 다른 값이어야 한다. 각 장면은 이야기 흐름에서 가장 적합한 위치에 자연스럽게 배치해.

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

RESPOND WITH ONLY THIS JSON STRUCTURE (fill in real values, no placeholder text):
{
  "sceneTitle": "장면 제목 (한국어)",
  "insertAfterParagraph": 2,
  "visibleCharacters": ["캐릭터이름"],
  "mood": "tense, emotional",
  "globalContext": {
    "locationPrompt": "indoor, office",
    "timePrompt": "daytime",
    "atmospherePrompt": "dim lighting, quiet",
    "situationSummary": "상황 요약 (한국어)"
  },
  "composition": "upper body, looking at viewer",
  "baseScenePrompt": "office, desk, window, soft light",
  "interactionPrompt": "standing, worried expression",
  "temporaryOutfitPrompt": "",
  "reason": "이 순간을 고른 이유 (한국어)"
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
            steps: 28,
            scale: 6.5,
            guidanceRescale: 0.3,
            sampler: 'k_euler_ancestral',
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
            openrouterModel: 'google/gemini-2.0-flash-exp:free',
            naiApiKey: '',
            naiModel: 'nai-diffusion-4-5-full',
            folderSaveEnabled: false,
            multiSceneCount: 1,
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
        const saved = getLocalJsonStorage(GLOBAL_SETTINGS_KEY, {});
        const legacyRoom = getLocalJsonStorage(getRoomSettingsKey(), {});
        return normalizeGlobalSettings(saved, { legacyRoom });
    }

    function saveGlobalSettings(settings) {
        try {
            setLocalJsonStorage(GLOBAL_SETTINGS_KEY, normalizeGlobalSettings(settings));
        } catch (err) {
            console.error('[Crack Scene Painter] global settings save failed:', err);
            if (isQuotaExceededError(err)) {
                throw new Error('전역 설정 저장 실패: 브라우저 저장공간(localStorage)이 가득 찼어요. 삽화 기록을 정리하거나 저장소 관리에서 압축을 실행해줘.');
            }
            throw err;
        }
    }

    function forceFirebaseProviderIfConfigured() {
        const saved = getLocalJsonStorage(GLOBAL_SETTINGS_KEY, {});
        const hasFirebaseConfig = !!String(saved?.firebaseConfigJson || '').trim();
        if (!hasFirebaseConfig) return;

        const provider = String(saved?.geminiProvider || '').trim();
        if (provider === 'firebase') return;
        if (provider === 'ai-studio' && String(saved?.googleApiKey || '').trim()) return;

        saved.geminiProvider = 'firebase';
        saved.vertexAccessToken = '';
        setLocalJsonStorage(GLOBAL_SETTINGS_KEY, normalizeGlobalSettings(saved));
        console.warn('[Crack Scene Painter] Firebase Config가 있어서 Gemini provider를 firebase로 자동 보정했습니다.');
    }

    function getRoomSettings() {
        return normalizeRoomSettings(
            getLocalJsonStorage(getRoomSettingsKey(), {})
        );
    }

    function saveRoomSettings(settings) {
        try {
            setLocalJsonStorage(getRoomSettingsKey(), normalizeRoomSettings(settings));
        } catch (err) {
            console.error('[Crack Scene Painter] room settings save failed:', err);
            if (isQuotaExceededError(err)) {
                throw new Error('캐릭터 슬롯 저장 실패: 브라우저 저장공간(localStorage)이 가득 찼어요. 긴 태그/퀵슬롯/삽화 기록을 정리해줘.');
            }
            throw err;
        }
    }

    function getSceneRecords() {
        return getLocalJsonStorage(getSceneRecordsKey(), {});
    }

    function makePromptArchiveId(messageKey) {
        return `${getRoomId()}::prompt_detail::${messageKey}`;
    }

    function compactPlanForStorage(plan = {}) {
        if (!plan || typeof plan !== 'object') return {};
        const keepKeys = [
            'sceneTitle',
            'insertAfterParagraph',
            'visibleCharacters',
            'charactersInScene',
            'mood',
            'globalContext',
            'composition',
            'baseScenePrompt',
            'interactionPrompt',
            'scenePrompt',
            'temporaryOutfitPrompt',
            'useTemporaryOutfit',
            'reason'
        ];

        const compact = {};
        keepKeys.forEach(key => {
            if (plan[key] !== undefined && plan[key] !== null && plan[key] !== '') compact[key] = plan[key];
        });
        return compact;
    }

    function buildPromptArchivePayload(record = {}) {
        return {
            version: 1,
            roomId: getRoomId(),
            mode: record.mode || 'nai',
            plan: compactPlanForStorage(record.plan || {}),
            basePrompt: record.basePrompt || '',
            baseNegative: record.baseNegative || '',
            finalPrompt: record.finalPrompt || '',
            finalNegative: record.finalNegative || '',
            charPrompts: Array.isArray(record.charPrompts) ? record.charPrompts : [],
            referenceInfo: record.referenceInfo || null,
            naiSettings: record.naiSettings || null,
            createdAt: record.createdAt || Date.now(),
            archivedAt: Date.now()
        };
    }

    function hasPromptArchivePayload(record = {}) {
        return !!(
            record.basePrompt ||
            record.baseNegative ||
            record.finalPrompt ||
            record.finalNegative ||
            (Array.isArray(record.charPrompts) && record.charPrompts.length) ||
            record.referenceInfo ||
            record.naiSettings
        );
    }

    function fireAndForgetStorePromptArchive(messageKey, record = {}) {
        if (!messageKey || !hasPromptArchivePayload(record)) return '';
        const archiveId = record.promptArchiveId || makePromptArchiveId(messageKey);
        const payload = buildPromptArchivePayload(record);
        putStoredMeta(archiveId, payload).catch(err => {
            console.warn('[Crack Scene Painter] prompt archive save failed:', err);
        });
        return archiveId;
    }

    function compactHistoryItemForStorage(item = {}) {
        const compact = {};
        if (item.imageId) compact.imageId = item.imageId;
        if (item.imageUrl && !String(item.imageUrl).startsWith('data:') && !String(item.imageUrl).startsWith('blob:')) {
            compact.imageUrl = item.imageUrl;
        }
        if (item.folderFileName) compact.folderFileName = item.folderFileName;
        if (item.createdAt) compact.createdAt = item.createdAt;
        return compact;
    }

    function compactSceneRecordForStorage(messageKey, record) {
        if (!record || typeof record !== 'object') return null;

        normalizeSceneRecordHistory(record, messageKey);

        if (Array.isArray(record.history)) {
            record.history.forEach(item => {
                if (!item) return;
                // data/blob URL은 localStorage에 넣지 않는다. 새 이미지와 기존 이미지 마이그레이션은 IndexedDB가 담당한다.
                if (String(item.imageUrl || '').startsWith('data:')) {
                    item.imageId = item.imageId || makeHistoryImageId(messageKey);
                    delete item.imageUrl;
                }
                if (String(item.imageUrl || '').startsWith('blob:')) delete item.imageUrl;
            });
            record.history = record.history
                .filter(item => item && (item.imageId || item.imageUrl))
                .slice(-CSP_MAX_IMAGE_HISTORY);
            record.currentIndex = clampHistoryIndex(record);
            syncCurrentImageFieldsFromHistory(record);
        }

        if (String(record.imageUrl || '').startsWith('data:')) {
            record.imageId = record.imageId || makeStoredImageId(messageKey);
            delete record.imageUrl;
        }
        if (String(record.imageUrl || '').startsWith('blob:')) delete record.imageUrl;

        const archiveId = fireAndForgetStorePromptArchive(messageKey, record) || record.promptArchiveId || '';

        const compact = {
            paragraphIndex: Number.isFinite(Number(record.paragraphIndex)) ? Number(record.paragraphIndex) : Number(record.plan?.insertAfterParagraph || 0),
            mode: record.mode || 'nai',
            plan: compactPlanForStorage(record.plan || {}),
            history: Array.isArray(record.history)
                ? record.history.map(compactHistoryItemForStorage).filter(item => item.imageId || item.imageUrl)
                : [],
            currentIndex: clampHistoryIndex(record),
            createdAt: record.createdAt || Date.now()
        };

        if (archiveId) compact.promptArchiveId = archiveId;
        if (record.imageId) compact.imageId = record.imageId;
        if (record.imageUrl && !String(record.imageUrl).startsWith('data:') && !String(record.imageUrl).startsWith('blob:')) {
            compact.imageUrl = record.imageUrl;
        }
        if (record.folderFileName) compact.folderFileName = record.folderFileName;

        return compact;
    }

    function stripLargeImageFields(records) {
        const next = {};
        Object.entries(records || {}).forEach(([key, record]) => {
            const compact = compactSceneRecordForStorage(key, record);
            if (compact && ((Array.isArray(compact.history) && compact.history.length) || compact.imageId || compact.imageUrl)) {
                next[key] = compact;
            }
        });
        return next;
    }

    function saveSceneRecords(records) {
        const compact = stripLargeImageFields(records || {});
        try {
            setLocalJsonStorage(getSceneRecordsKey(), compact);
        } catch (err) {
            console.warn('[Crack Scene Painter] localStorage save failed, pruning scene records:', err);
            const entries = Object.entries(compact).sort(([, a], [, b]) => {
                const at = Number(a?.createdAt || 0);
                const bt = Number(b?.createdAt || 0);
                return at - bt;
            });

            let saved = false;
            for (const keepCount of [20, 12, 8, 5, 3, 1, 0]) {
                const pruned = Object.fromEntries(entries.slice(-keepCount));
                try {
                    setLocalJsonStorage(getSceneRecordsKey(), pruned);
                    saved = true;
                    showToast(`⚠️ 저장공간이 부족해서 이 방 삽화 기록을 최근 ${keepCount}개만 보관했어요.`);
                    break;
                } catch (retryErr) {
                    if (keepCount === 0 || !isQuotaExceededError(retryErr)) {
                        console.error('[Crack Scene Painter] scene records save retry failed:', retryErr);
                    }
                }
            }

            if (!saved) {
                try {
                    localStorage.removeItem(getSceneRecordsKey());
                } catch (_) {}
                showToast('⚠️ 삽화 기록 저장 실패: 브라우저 저장공간이 가득 찼어요. 저장소 관리를 실행해줘.');
            }
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
        const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        if (!targetBox) return;

        const effectiveRecord = record || getSceneRecords()[messageKey];
        const full = !!effectiveRecord && isSceneHistoryFull(effectiveRecord);
        const count = effectiveRecord ? getSceneHistoryCount(effectiveRecord) : 0;

        targetBox.querySelectorAll('.csp-image-reroll-btn, .csp-image-edit-btn').forEach(btn => {
            btn.disabled = full;
            btn.classList.toggle('is-disabled', full);
            if (btn.classList.contains('csp-image-edit-btn')) {
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

        targetBox.setAttribute('data-csp-history-count', String(count));
        targetBox.setAttribute('data-csp-history-full', full ? 'true' : 'false');
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
                    console.warn('[Crack Scene Painter] blocked reroll image cleanup failed:', err);
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
                console.warn('[Crack Scene Painter] stored image delete failed:', err);
            }
        }
    }

    function buildImageHistoryControls(messageKey, record) {
        normalizeSceneRecordHistory(record, messageKey);
        const history = Array.isArray(record?.history) ? record.history : [];
        const count = history.length;
        if (count <= 1) return '';
        const index = clampHistoryIndex(record);

        return `
            <button class="csp-image-history-btn csp-image-history-prev" data-message-key="${escapeHtml(messageKey)}" type="button" title="이전 이미지" aria-label="이전 이미지" ${index <= 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
            <span class="csp-image-history-count">${index + 1} / ${count}</span>
            <button class="csp-image-history-btn csp-image-history-next" data-message-key="${escapeHtml(messageKey)}" type="button" title="다음 이미지" aria-label="다음 이미지" ${index >= count - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>
        `;
    }

    function ensureImageHistoryRow(box) {
        if (!box) return null;
        const messageKey = box.getAttribute('data-message-key') || '';
        let row = messageKey
            ? document.querySelector(`.csp-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
            : null;

        if (!row) {
            const next = box.nextElementSibling;
            if (next?.classList?.contains('csp-image-history-row')) row = next;
        }

        if (!row) {
            row = document.createElement('div');
            row.className = 'csp-image-history-row';
            if (messageKey) row.setAttribute('data-message-key', messageKey);
            box.insertAdjacentElement('afterend', row);
        }

        return row;
    }

    function refreshImageHistoryControls(messageKey, box = null, record = null) {
        const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const row = ensureImageHistoryRow(targetBox);
        if (!row) return;
        const effectiveRecord = record || getSceneRecords()[messageKey];
        row.innerHTML = effectiveRecord ? buildImageHistoryControls(messageKey, effectiveRecord) : '';
        refreshImageActionState(messageKey, targetBox, effectiveRecord);
    }

    async function setCurrentSceneHistoryIndex(messageKey, index, box = null) {
        const records = getSceneRecords();
        const record = normalizeSceneRecordHistory(records[messageKey], messageKey);
        if (!record || !Array.isArray(record.history) || !record.history.length) return false;

        record.currentIndex = Math.max(0, Math.min(Number(index) || 0, record.history.length - 1));
        syncCurrentImageFieldsFromHistory(record);

        const src = await getRecordImageSrc(record);
        const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
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
                console.warn('[Crack Scene Painter] current history image delete failed:', err);
            }
        }

        if (!record.history.length) {
            if (record.promptArchiveId) {
                try { await deleteStoredMeta(record.promptArchiveId); } catch (_) {}
            }
            delete records[messageKey];
            saveSceneRecords(records);
            const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
            const row = targetBox?.nextElementSibling?.classList?.contains('csp-image-history-row')
                ? targetBox.nextElementSibling
                : document.querySelector(`.csp-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`);
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
        const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
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
                if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
                    db.createObjectStore(HANDLE_STORE_NAME, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(META_STORE_NAME)) {
                    db.createObjectStore(META_STORE_NAME, { keyPath: 'id' });
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

    async function putStoredMeta(id, value) {
        if (!id) return;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE_NAME, 'readwrite');
            tx.objectStore(META_STORE_NAME).put({ id, value, updatedAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('메타 정보를 IndexedDB에 저장하지 못했어요.'));
        });
    }

    async function getStoredMeta(id) {
        if (!id) return null;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE_NAME, 'readonly');
            const req = tx.objectStore(META_STORE_NAME).get(id);
            req.onsuccess = () => resolve(req.result?.value || null);
            req.onerror = () => reject(req.error || new Error('메타 정보를 IndexedDB에서 읽지 못했어요.'));
        });
    }

    async function deleteStoredMeta(id) {
        if (!id) return;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE_NAME, 'readwrite');
            tx.objectStore(META_STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('메타 정보를 IndexedDB에서 삭제하지 못했어요.'));
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
            width: Number(overlay?.querySelector('#csp-nai-width')?.value || 832),
            height: Number(overlay?.querySelector('#csp-nai-height')?.value || 1216),
            steps: Number(overlay?.querySelector('#csp-nai-steps')?.value || 28),
            ucPreset: Number(overlay?.querySelector('#csp-nai-uc-preset')?.value || 0)
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
            console.warn('[Crack Scene Painter] reference asset missing:', summary.assetId);
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
        const img = card.querySelector('.csp-reference-preview-img');
        const status = card.querySelector('.csp-reference-status');
        const deleteBtn = card.querySelector('.csp-reference-delete');
        const enabled = card.querySelector('.csp-reference-enabled');

        if (!img || !status || !deleteBtn) return;

        if (!assetId) {
            img.removeAttribute('src');
            img.style.display = 'none';
            deleteBtn.style.display = 'none';
            status.textContent = `Reference 파일 없음 (${REFERENCE_SUBDIR_NAME})`;
            return;
        }

        try {
            const dataUrl = await readReferenceFileAsDataUrl(assetId);
            if (!dataUrl) throw new Error('저장된 Reference 파일을 찾지 못했어요.');
            img.src = dataUrl;
            img.style.display = 'block';
            deleteBtn.style.display = 'inline-flex';
            status.textContent = enabled?.checked
                ? `Reference 사용 중 · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성 · ${REFERENCE_SUBDIR_NAME}`
                : `Reference 저장됨 · 사용 OFF · ${REFERENCE_SUBDIR_NAME}`;
        } catch (err) {
            img.removeAttribute('src');
            img.style.display = 'none';
            deleteBtn.style.display = 'none';
            status.textContent = 'Reference 파일 로드 실패: ' + err.message;
        }
    }

    function markSceneButtons(messageKey, hasImage) {
        if (!messageKey) return;
        document.querySelectorAll(`.csp-message-generate-btn[data-message-key="${CSS.escape(messageKey)}"], .csp-message-speed-btn[data-message-key="${CSS.escape(messageKey)}"]`).forEach(btn => {
            if (hasImage) {
                btn.setAttribute('data-csp-has-image', 'true');
            } else {
                btn.removeAttribute('data-csp-has-image');
                btn.removeAttribute('data-csp-loading');
                btn.disabled = false;
                btn.title = btn.classList.contains('csp-message-speed-btn') ? '스피드 모드: 분석 후 바로 NAI 생성' : '이 AI 답변으로 이미지 생성';
            }
        });
    }

    async function clearSceneRecordForMessage(messageKey, options = {}) {
        if (!messageKey) return;

        const records = getSceneRecords();
        const record = records[messageKey];

        if (record) {
            await deleteAllHistoryImages(record, makeStoredImageId(messageKey));
            if (record.promptArchiveId) {
                try { await deleteStoredMeta(record.promptArchiveId); } catch (_) {}
            }
            delete records[messageKey];
            saveSceneRecords(records);
        } else {
            try {
                await deleteStoredImage(makeStoredImageId(messageKey));
            } catch (_) {}
        }

        if (options.removeDom !== false) {
            if (options.box?.isConnected) {
                const row = options.box.nextElementSibling?.classList?.contains('csp-image-history-row')
                    ? options.box.nextElementSibling
                    : document.querySelector(`.csp-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`);
                row?.remove();
                options.box.remove();
            } else {
                document
                    .querySelectorAll(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"], .csp-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
                    .forEach(el => el.remove());
            }
        }

        markSceneButtons(messageKey, false);
    }

    async function migrateSceneImagesToIndexedDb() {
        const keys = Object.keys(localStorage).filter(key => key.startsWith(`${CSP_PREFIX}_scene_records_`));
        for (const storageKey of keys) {
            const records = getLocalJsonStorage(storageKey, {});
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
                                console.warn('[Crack Scene Painter] migration history image save failed:', err);
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
                        console.warn('[Crack Scene Painter] migration image save failed:', err);
                    }
                } else if (rawUrl.startsWith('blob:')) {
                    delete record.imageUrl;
                    changed = true;
                }
            }
            if (changed || !String(localStorage.getItem(storageKey) || '').startsWith(COMPRESSED_JSON_PREFIX)) {
                try {
                    setLocalJsonStorage(storageKey, stripLargeImageFields(records));
                } catch (err) {
                    console.warn('[Crack Scene Painter] migration localStorage save failed, pruning large records:', err);
                    const compact = stripLargeImageFields(records);
                    const entries = Object.entries(compact).sort(([, a], [, b]) => Number(a?.createdAt || 0) - Number(b?.createdAt || 0));
                    for (const keepCount of [20, 12, 8, 5, 3, 1, 0]) {
                        try {
                            setLocalJsonStorage(storageKey, Object.fromEntries(entries.slice(-keepCount)));
                            break;
                        } catch (_) {}
                    }
                }
            }
        }
    }

    async function putStoredDirectoryHandle(handle) {
        if (!handle) return;
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
            tx.objectStore(HANDLE_STORE_NAME).put({ id: 'imageDirectory', handle, createdAt: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('폴더 핸들을 저장하지 못했어요.'));
        });
    }

    async function getStoredDirectoryHandle() {
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
            const req = tx.objectStore(HANDLE_STORE_NAME).get('imageDirectory');
            req.onsuccess = () => resolve(req.result?.handle || null);
            req.onerror = () => reject(req.error || new Error('폴더 핸들을 읽지 못했어요.'));
        });
    }

    async function deleteStoredDirectoryHandle() {
        const db = await openImageDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
            tx.objectStore(HANDLE_STORE_NAME).delete('imageDirectory');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('폴더 핸들을 삭제하지 못했어요.'));
        });
    }

    async function ensureDirectoryPermission(handle, mode = 'readwrite', options = {}) {
        if (!handle) return false;
        const permissionOptions = { mode };
        const prompt = options.prompt !== false;
        const timeoutMs = Number(options.timeoutMs || 6000);

        const current = await withTimeout(
            handle.queryPermission(permissionOptions),
            Math.min(timeoutMs, 3000),
            '폴더 권한 확인'
        );
        if (current === 'granted') return true;

        // 생성/Reference 읽기처럼 사용자 클릭 흐름이 아닐 수 있는 곳에서는
        // requestPermission을 호출하지 않고 빠르게 실패시켜 fallback으로 넘긴다.
        if (!prompt) return false;

        const requested = await withTimeout(
            handle.requestPermission(permissionOptions),
            timeoutMs,
            '폴더 권한 요청'
        );
        return requested === 'granted';
    }

    async function chooseImageDirectory() {
        if (!window.showDirectoryPicker) {
            throw new Error('이 브라우저는 폴더 저장 기능을 지원하지 않아요. Chrome/Edge에서 사용해줘.');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const ok = await ensureDirectoryPermission(handle, 'readwrite', { prompt: true, timeoutMs: 9000 });
        if (!ok) throw new Error('폴더 쓰기 권한이 거부됐어요.');
        await withTimeout(putStoredDirectoryHandle(handle), 5000, '폴더 핸들 저장');
        return handle;
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

    function makeImageFileName(plan) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `CrackScene_${sanitizeFileName(getRoomId())}_${sanitizeFileName(plan?.sceneTitle || 'scene')}_${stamp}.png`;
    }

    async function saveImageToChosenFolder(dataUrl, plan) {
        if (!String(dataUrl || '').startsWith('data:')) {
            throw new Error('폴더에 저장할 이미지 데이터가 없어요.');
        }
        const handle = await withTimeout(getStoredDirectoryHandle(), 3500, '이미지 저장 폴더 읽기');
        if (!handle) throw new Error('이미지 저장 폴더가 선택되지 않았어요.');
        const ok = await ensureDirectoryPermission(handle, 'readwrite', { prompt: false, timeoutMs: 3000 });
        if (!ok) throw new Error('폴더 쓰기 권한이 없어요. 설정에서 폴더를 다시 선택해줘.');
        const filename = makeImageFileName(plan);
        const fileHandle = await handle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(dataUrlToBlob(dataUrl));
        await writable.close();
        return filename;
    }


    async function getReferenceDirectoryHandle(create = false, options = {}) {
        const rootHandle = await withTimeout(
            getStoredDirectoryHandle(),
            Number(options.handleTimeoutMs || 3500),
            '저장 폴더 읽기'
        );
        if (!rootHandle) throw new Error('이미지 저장 폴더가 선택되지 않았어요. 먼저 저장 폴더를 연결해줘.');
        const ok = await ensureDirectoryPermission(rootHandle, 'readwrite', {
            prompt: options.prompt !== false,
            timeoutMs: Number(options.permissionTimeoutMs || 6000)
        });
        if (!ok) throw new Error('폴더 쓰기 권한이 없어요.');
        return await withTimeout(
            rootHandle.getDirectoryHandle(REFERENCE_SUBDIR_NAME, { create }),
            Number(options.dirTimeoutMs || 3500),
            'Reference 폴더 열기'
        );
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

        // 1순위: 사용자가 선택한 CSP_References 폴더 저장.
        try {
            const dirHandle = await getReferenceDirectoryHandle(true, {
                prompt: true,
                permissionTimeoutMs: 9000,
                dirTimeoutMs: 5000
            });
            const fileHandle = await withTimeout(
                dirHandle.getFileHandle(filename, { create: true }),
                5000,
                'Reference 파일 생성'
            );
            const writable = await withTimeout(fileHandle.createWritable(), 5000, 'Reference 파일 열기');
            await withTimeout(writable.write(file), 10000, 'Reference 파일 쓰기');
            await withTimeout(writable.close(), 5000, 'Reference 파일 저장');
            return filename;
        } catch (folderErr) {
            // 2순위 fallback: 폴더 권한/핸들이 꼬여도 Reference 자체는 동작해야 하므로 IndexedDB에 저장.
            console.warn('[Crack Scene Painter] reference folder save failed, falling back to IndexedDB:', folderErr);
            const dataUrl = await blobToDataUrl(file);
            await putStoredImage(filename, dataUrl);
            return filename;
        }
    }

    async function readReferenceFileAsDataUrl(filename) {
        if (!filename) return '';

        // 폴더가 꼬였을 때도 빠르게 fallback할 수 있도록 timeout과 prompt=false 사용.
        try {
            const dirHandle = await getReferenceDirectoryHandle(false, {
                prompt: false,
                handleTimeoutMs: 2500,
                permissionTimeoutMs: 2500,
                dirTimeoutMs: 2500
            });
            const fileHandle = await withTimeout(
                dirHandle.getFileHandle(filename),
                3000,
                'Reference 파일 찾기'
            );
            const file = await withTimeout(fileHandle.getFile(), 3000, 'Reference 파일 읽기');
            return await blobToDataUrl(file);
        } catch (folderErr) {
            try {
                return await getStoredImage(filename);
            } catch (_) {
                return '';
            }
        }
    }

    async function deleteReferenceFileFromLibrary(filename) {
        if (!filename) return;
        try {
            const dirHandle = await getReferenceDirectoryHandle(false, {
                prompt: false,
                handleTimeoutMs: 2500,
                permissionTimeoutMs: 2500,
                dirTimeoutMs: 2500
            });
            await withTimeout(dirHandle.removeEntry(filename), 4000, 'Reference 파일 삭제');
        } catch (_) {
            // 폴더 삭제 실패는 무시하고 IndexedDB fallback도 같이 지운다.
        }
        try { await deleteStoredImage(filename); } catch (_) {}
    }

    function isEnabled() {
        return localStorage.getItem(ENABLED_KEY) !== 'off';
    }

    function applySceneVisibilityState(enabled = isEnabled()) {
        document.body.classList.toggle('csp-scene-hidden', !enabled);
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
        const old = document.getElementById('csp-toast');
        if (old) old.remove();

        const toast = document.createElement('div');
        toast.id = 'csp-toast';
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
        backdrop.className = 'csp-task-hud-backdrop';
        backdrop.innerHTML = `
            <div class="csp-task-hud">
                <div class="csp-task-hud-header">
                    <div class="csp-task-hud-spinner"></div>
                    <div class="csp-task-hud-title"></div>
                    <button class="csp-task-hud-cancel" type="button" title="작업 취소" aria-label="작업 취소">×</button>
                </div>
                <div class="csp-task-hud-message"></div>
                <div class="csp-task-hud-bar"><div class="csp-task-hud-bar-fill"></div></div>
                <div class="csp-task-hud-footer">
                    <span class="csp-task-hud-progress-label"></span>
                    <span>오래 걸리면 콘솔 확인</span>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);
        currentTaskHud = {
            el: backdrop,
            abortController,
            titleEl: backdrop.querySelector('.csp-task-hud-title'),
            messageEl: backdrop.querySelector('.csp-task-hud-message'),
            barEl: backdrop.querySelector('.csp-task-hud-bar-fill'),
            labelEl: backdrop.querySelector('.csp-task-hud-progress-label'),
            startedAt: Date.now()
        };

        const cancelBtn = backdrop.querySelector('.csp-task-hud-cancel');
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

        const box = currentTaskHud.el.querySelector('.csp-task-hud');
        box?.classList.remove('csp-task-hud-status-success', 'csp-task-hud-status-error');
        if (status === 'success') box?.classList.add('csp-task-hud-status-success');
        if (status === 'error') box?.classList.add('csp-task-hud-status-error');
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
        if (document.getElementById('csp-scene-painter-style')) return;

        const style = document.createElement('style');
        style.id = 'csp-scene-painter-style';
        style.textContent = `
            .csp-overlay {
                --csp-surface: #242321;
                --csp-surface-2: rgba(255,255,255,0.055);
                --csp-surface-3: rgba(0,0,0,0.28);
                --csp-text: #f5f5f5;
                --csp-muted: #c9c9ce;
                --csp-soft: #a9abb3;
                --csp-border: rgba(255,255,255,0.16);
                --csp-input: rgba(0,0,0,0.34);
                --csp-input-text: #f5f5f5;
                --csp-shadow: rgba(0,0,0,0.45);
                position: fixed;
                inset: 0;
                z-index: 999999;
                background: rgba(0, 0, 0, 0.58);
                display: flex;
                justify-content: center;
                align-items: center;
            }
            body[data-theme="light"] .csp-overlay {
                --csp-surface: #ffffff;
                --csp-surface-2: #f5f6f8;
                --csp-surface-3: #eef0f3;
                --csp-text: #1f2328;
                --csp-muted: #4b5563;
                --csp-soft: #6b7280;
                --csp-border: rgba(31,35,40,0.18);
                --csp-input: #ffffff;
                --csp-input-text: #111827;
                --csp-shadow: rgba(31,35,40,0.18);
            }
            body[data-theme="dark"] .csp-overlay {
                --csp-surface: #242321;
                --csp-surface-2: rgba(255,255,255,0.055);
                --csp-surface-3: rgba(0,0,0,0.28);
                --csp-text: #f5f5f5;
                --csp-muted: #c9c9ce;
                --csp-soft: #a9abb3;
                --csp-border: rgba(255,255,255,0.16);
                --csp-input: rgba(0,0,0,0.34);
                --csp-input-text: #f5f5f5;
                --csp-shadow: rgba(0,0,0,0.45);
            }
            .csp-modal {
                width: 820px;
                max-width: calc(100vw - 32px);
                max-height: calc(100vh - 40px);
                overflow-y: auto;
                border-radius: 18px;
                background: var(--csp-surface);
                color: var(--csp-text);
                box-shadow: 0 18px 60px var(--csp-shadow);
                padding: 22px;
                font-family: inherit;
            }
            .csp-modal h2 { font-size: 18px; margin: 0 0 6px; font-weight: 800; color: var(--csp-text); }
            .csp-desc {
                font-size: 12px;
                line-height: 1.55;
                color: var(--csp-muted);
                margin-bottom: 18px;
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .csp-section {
                border: 1px solid var(--csp-border);
                border-radius: 14px;
                padding: 14px;
                margin-top: 12px;
                background: var(--csp-surface-2);
            }
            .csp-section-title { font-size: 13px; font-weight: 800; margin-bottom: 10px; color: var(--csp-text); }
            .csp-section-subbox {
                margin-top: 12px;
                padding: 12px;
                border: 1px solid var(--csp-border);
                border-radius: 14px;
                background: color-mix(in srgb, var(--csp-surface) 86%, transparent);
            }
            .csp-section-toggle {
                width: 100%;
                border: 0;
                background: transparent;
                color: inherit;
                padding: 0;
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 13px;
                font-weight: 800;
                cursor: pointer;
                text-align: left;
            }
            .csp-section-arrow { width: 16px; color: var(--csp-muted); }
            .csp-section-body { margin-top: 12px; }
            .csp-size-hidden { display: none !important; }
            .csp-info-modal { width: 760px; }
            .csp-reroll-modal { width: min(960px, calc(100vw - 28px)); }
            .csp-info-pre {
                white-space: pre-wrap;
                word-break: break-word;
                max-height: 62vh;
                overflow: auto;
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-3);
                border-radius: 12px;
                padding: 12px;
                font-size: 12px;
                line-height: 1.55;
            }
            .csp-image-edit-character-card {
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-2);
                border-radius: 12px;
                padding: 12px;
                margin-bottom: 10px;
            }
            .csp-readonly-preview {
                min-height: 92px;
                max-height: 220px;
                overflow: auto;
                white-space: pre-wrap;
                word-break: break-word;
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-3);
                color: var(--csp-text);
                border-radius: 12px;
                padding: 12px;
                font-size: 12px;
                line-height: 1.5;
            }
            .csp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .csp-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
            .csp-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .csp-label-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .csp-value-chip {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 42px;
                padding: 3px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 800;
                color: var(--csp-text);
                background: var(--csp-surface-3);
                border: 1px solid var(--csp-border);
            }
            .csp-range-wrap {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .csp-range-wrap input[type="range"] {
                flex: 1;
                margin: 0;
            }
            .csp-range-number {
                width: 90px !important;
                flex: 0 0 auto;
            }
            .csp-res-row {
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
            }
            .csp-res-dims {
                display: flex;
                align-items: center;
                justify-content: flex-start;
                gap: 8px;
                flex-wrap: wrap;
            }
            .csp-dim-pill {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 72px;
                padding: 9px 12px;
                border-radius: 10px;
                border: 1px solid var(--csp-border);
                background: var(--csp-input);
                color: var(--csp-input-text);
                font-size: 13px;
                font-weight: 700;
            }
            .csp-dim-swap {
                width: 38px;
                height: 38px;
                border-radius: 10px;
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-3);
                color: var(--csp-text);
                cursor: pointer;
                font-size: 14px;
                font-weight: 800;
            }
            .csp-dim-swap:hover { filter: brightness(1.06); }
            .csp-section .csp-grid > .csp-field { margin-bottom: 0; }
            .csp-section .csp-grid { column-gap: 12px; row-gap: 12px; }
            .csp-range-wrap { gap: 8px; }
            .csp-range-number {
                width: 80px !important;
                font-variant-numeric: tabular-nums;
            }
            .csp-range-number::-webkit-outer-spin-button,
            .csp-range-number::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            .csp-range-number[type="number"] {
                -moz-appearance: textfield;
            }
            .csp-dim-pill { min-width: 64px; }
            @media (max-width: 720px) {
                .csp-grid, .csp-grid-3, .csp-grid-4 { grid-template-columns: 1fr !important; }
                .csp-actions-right { justify-content: flex-end; }
            }
            .csp-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
            .csp-field label {
                font-size: 12px;
                font-weight: 800;
                color: var(--csp-muted);
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .csp-field input,
            .csp-field textarea,
            .csp-field select {
                width: 100%;
                box-sizing: border-box;
                border-radius: 10px;
                border: 1px solid var(--csp-border);
                background: var(--csp-input);
                color: var(--csp-input-text);
                padding: 10px 11px;
                font-size: 13px;
                outline: none;
                font-family: inherit;
            }
            .csp-field textarea { min-height: 84px; resize: vertical; line-height: 1.45; }
            .csp-field textarea.csp-long { min-height: 180px; }
            .csp-field input::placeholder,
            .csp-field textarea::placeholder {
                color: var(--csp-soft);
                opacity: 1;
            }
            .csp-field input:focus,
            .csp-field textarea:focus,
            .csp-field select:focus {
                border-color: var(--primary, #ff4432);
                box-shadow: 0 0 0 3px rgba(255, 68, 50, 0.18);
            }
            .csp-actions {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                margin-top: 18px;
                flex-wrap: wrap;
            }
            .csp-actions-left, .csp-actions-right { display: flex; gap: 8px; flex-wrap: wrap; }
            .csp-quick-slot-grid { margin-top: 12px; }
            .csp-quick-slot-actions { margin-top: 10px; gap: 10px; }
            .csp-quick-slot-actions .csp-btn { min-width: 92px; }
            .csp-anlas-chip {
                border: 0;
                background: transparent;
                color: var(--csp-muted);
                padding: 2px 4px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 900;
                letter-spacing: 0.01em;
                cursor: pointer;
                min-width: 0;
                text-align: center;
            }
            .csp-anlas-chip:hover { background: var(--csp-surface-2); }
            .csp-anlas-chip.csp-anlas-cost,
            .csp-anlas-chip.is-active { color: #ef4444; }
            .csp-anlas-chip[hidden] { display: none !important; }
            .csp-btn {
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-2);
                color: inherit;
                padding: 10px 16px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
            }
            .csp-btn:hover { background: rgba(255,255,255,0.13); }
            .csp-btn-primary {
                background: var(--primary, #ff4432);
                color: var(--primary-foreground, #fff);
                border-color: var(--primary, #ff4432);
            }
            .csp-btn-danger {
                background: rgba(255, 80, 80, 0.16);
                border-color: rgba(255, 80, 80, 0.35);
            }
            .csp-btn-small { padding: 7px 10px; font-size: 12px; }
            .csp-mini-note {
                font-size: 11px;
                color: var(--csp-soft);
                line-height: 1.5;
                margin-top: 4px;
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .csp-storage-status {
                margin-top: 10px;
                padding: 10px 12px;
                border: 1px solid var(--csp-border);
                border-radius: 12px;
                background: var(--csp-surface-3);
                color: var(--csp-muted);
                font-size: 12px;
                line-height: 1.55;
                overflow-wrap: anywhere;
            }
            .csp-storage-top {
                margin-top: 4px;
                color: var(--csp-soft);
                font-size: 11px;
            }
            .csp-character-card {
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-2);
                border-radius: 12px;
                padding: 12px;
                margin-bottom: 10px;
            }
            .csp-character-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                font-size: 12px;
                font-weight: 800;
                color: var(--csp-muted);
            }
            .csp-reference-box {
                margin-top: 10px;
                border: 1px dashed var(--csp-border);
                border-radius: 12px;
                padding: 10px;
                background: var(--csp-surface-2);
            }
            .csp-reference-preview-row {
                display: flex;
                gap: 10px;
                align-items: flex-start;
                margin-top: 8px;
            }
            .csp-reference-preview-img {
                width: 72px;
                height: 96px;
                object-fit: cover;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.16);
                background: rgba(0,0,0,0.22);
            }
            .csp-reference-preview-actions {
                flex: 1;
                min-width: 0;
            }
            .csp-reference-file {
                font-size: 12px !important;
                padding: 8px !important;
            }
            .csp-generated-scene-image {
                width: 100%;
                margin: 0 !important;
                padding: 0 !important;
                border-radius: 14px;
                overflow: hidden;
                background: transparent;
                box-shadow: none;
                border: 0;
                position: relative;
                display: block;
                line-height: 0;
                font-size: 0;
                isolation: isolate;
            }
            [data-message-id] .csp-generated-scene-image,
            [data-message-id] .csp-generated-scene-image,
            .css-peb4p4 .csp-generated-scene-image {
                margin-top: 12px !important;
                margin-bottom: 12px !important;
            }
            [data-message-id] p:has(+ .csp-generated-scene-image),
            [data-message-id] p:has(+ .csp-generated-scene-image),
            .css-peb4p4 p:has(+ .csp-generated-scene-image) {
                margin-bottom: 14px !important;
            }
            .csp-generated-scene-image + p,
            .csp-generated-scene-image + div,
            .csp-generated-scene-image + blockquote {
                margin-top: 14px !important;
            }
            .csp-generated-scene-image img {
                display: block;
                width: 100%;
                height: auto;
                cursor: zoom-in;
                vertical-align: top;
            }
            .csp-generated-scene-caption {
                position: absolute;
                inset: 0;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent;
                line-height: 0;
                pointer-events: none;
                overflow: hidden;
            }
            .csp-generated-scene-caption .csp-image-info-row,
            .csp-generated-scene-caption .csp-image-action-row { pointer-events: auto; }
            .csp-image-history-row {
                display: flex;
                justify-content: flex-end;
                align-items: center;
                gap: 6px;
                min-height: 22px;
                margin: -6px 4px 10px 0;
                padding: 0 4px 0 0;
                line-height: 1;
                font-size: 12px;
                color: var(--csp-muted);
                opacity: 0.92;
                pointer-events: auto;
                user-select: none;
            }
            .csp-image-history-row:empty { display: none; }
            .csp-image-history-btn {
                width: 22px;
                height: 22px;
                border-radius: 999px;
                border: 1px solid var(--csp-border);
                background: var(--csp-surface-2);
                color: var(--csp-text);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 14px;
                font-weight: 900;
                line-height: 1;
                box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            }
            .csp-image-history-btn:disabled {
                opacity: 0.36;
                cursor: default;
                box-shadow: none;
            }
            .csp-image-history-count {
                min-width: 42px;
                text-align: center;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                color: var(--csp-muted);
                text-shadow: 0 1px 2px rgba(0,0,0,0.12);
            }
            .csp-message-generate-btn,
            .csp-message-speed-btn {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: none;
                border-radius: 999px;
                background: transparent;
                color: var(--muted-foreground, #888);
                cursor: pointer;
                transition: background 150ms ease, color 150ms ease;
                flex-shrink: 0;
            }
            .csp-message-generate-btn:hover,
            .csp-message-speed-btn:hover {
                background: var(--accent, rgba(0,0,0,0.08));
                color: var(--foreground, #111);
            }
            .csp-message-generate-btn:active,
            .csp-message-speed-btn:active {
                background: var(--accent, rgba(0,0,0,0.12));
            }
            .csp-message-generate-btn svg,
            .csp-message-speed-btn svg {
                pointer-events: none;
                flex-shrink: 0;
            }
            .csp-inline-action-footer {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 30px;
                margin: 6px 0 0;
                padding: 0;
            }
            body.csp-scene-hidden .csp-generated-scene-image {
                display: none !important;
            }
            body.csp-scene-hidden .csp-message-generate-btn,
            body.csp-scene-hidden .csp-message-speed-btn {
                display: none !important;
            }
            .csp-message-generate-btn[data-csp-has-image="true"]::after,
            .csp-message-speed-btn[data-csp-has-image="true"]::after {
                content: "";
                position: absolute;
                right: 3px;
                top: 3px;
                width: 6px;
                height: 6px;
                border-radius: 999px;
                background: var(--primary, #ff4432);
            }
            .csp-message-generate-btn[data-csp-loading="true"],
            .csp-message-speed-btn[data-csp-loading="true"] { opacity: 0.55; pointer-events: none; }
            .csp-check-row {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                font-size: 13px;
                font-weight: 700;
                opacity: 0.9;
                padding: 8px 0;
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
                line-height: 1.45;
            }
            .csp-check-row input { width: auto !important; flex: 0 0 auto; margin-top: 2px; }
            .csp-inline-note {
                display: inline-block;
                margin-left: 8px;
                font-size: 11px;
                opacity: 0.62;
            }
            .csp-slot-preview-wrap {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 8px;
            }
            .csp-slot-preview-card {
                border: 1px solid var(--csp-border);
                border-radius: 12px;
                padding: 12px;
                background: var(--csp-surface-3);
            }
            .csp-slot-preview-title {
                font-size: 12px;
                font-weight: 800;
                color: var(--csp-text);
                margin-bottom: 8px;
            }
            .csp-slot-preview-label {
                font-size: 11px;
                font-weight: 800;
                color: var(--csp-soft);
                margin: 8px 0 4px;
            }
            .csp-slot-preview-body {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: 12px;
                line-height: 1.45;
                color: var(--csp-text);
            }
            .csp-paragraph-preview {
                min-height: 70px;
                max-height: 150px;
                overflow: auto;
                white-space: pre-wrap;
                word-break: break-word;
                border: 1px solid var(--csp-border);
                border-radius: 12px;
                background: var(--csp-surface-3);
                padding: 12px;
                font-size: 12px;
                line-height: 1.55;
                color: var(--csp-text);
            }
            .csp-btn-small {
                min-height: 32px;
                padding: 7px 10px;
                font-size: 12px;
            }
            .csp-slot-preview-empty {
                font-size: 12px;
                color: var(--csp-soft);
            }
            .csp-hidden-raw {
                display: none !important;
            }
            .csp-message-generate-btn[data-csp-loading="true"],
            .csp-image-action-btn[data-csp-loading="true"] {
                opacity: 0.72;
                position: relative;
            }
            .csp-message-generate-btn[data-csp-loading="true"] svg,
            .csp-image-action-btn[data-csp-loading="true"] svg {
                animation: csp-spin 0.9s linear infinite;
            }
            .csp-task-hud-backdrop {
                position: fixed;
                left: 50%;
                bottom: 22px;
                transform: translateX(-50%);
                z-index: 2147483645;
                width: min(430px, calc(100vw - 28px));
                pointer-events: none;
            }
            .csp-task-hud {
                width: 100%;
                border-radius: 18px;
                background: rgba(22, 22, 26, 0.96);
                border: 1px solid rgba(255,255,255,0.10);
                box-shadow: 0 20px 80px rgba(0,0,0,0.35);
                padding: 15px 16px 14px;
                color: #f4f4f5;
                pointer-events: auto;
            }
            body[data-theme="light"] .csp-task-hud {
                background: rgba(255,255,255,0.98);
                color: #111827;
                border-color: rgba(31,35,40,0.15);
                box-shadow: 0 20px 80px rgba(31,35,40,0.18);
            }
            .csp-task-hud-header {
                display: grid;
                grid-template-columns: auto 1fr auto;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
            }
            .csp-task-hud-cancel {
                width: 26px;
                height: 26px;
                border-radius: 999px;
                border: 1px solid rgba(255,255,255,0.16);
                background: rgba(255,255,255,0.08);
                color: inherit;
                cursor: pointer;
                font-size: 16px;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            .csp-task-hud-cancel:hover { background: rgba(255, 68, 50, 0.18); }
            body[data-theme="light"] .csp-task-hud-cancel {
                border-color: rgba(31,35,40,0.16);
                background: rgba(31,35,40,0.04);
            }
            .csp-task-hud-spinner {
                width: 20px;
                height: 20px;
                border-radius: 999px;
                border: 2px solid rgba(255,255,255,0.22);
                border-top-color: rgba(255,255,255,0.92);
                animation: csp-spin 0.8s linear infinite;
                flex: 0 0 auto;
            }
            body[data-theme="light"] .csp-task-hud-spinner {
                border-color: rgba(31,35,40,0.18);
                border-top-color: rgba(31,35,40,0.76);
            }
            .csp-task-hud-title {
                font-size: 14px;
                font-weight: 700;
                line-height: 1.25;
            }
            .csp-task-hud-message {
                font-size: 12px;
                opacity: 0.72;
                margin-bottom: 12px;
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: keep-all;
            }
            .csp-task-hud-bar {
                width: 100%;
                height: 8px;
                border-radius: 999px;
                background: rgba(255,255,255,0.08);
                overflow: hidden;
            }
            .csp-task-hud-bar-fill {
                height: 100%;
                width: 0%;
                border-radius: inherit;
                background: linear-gradient(90deg, #ff6b35 0%, #ff9c63 100%);
                transition: width 220ms ease;
            }
            .csp-task-hud-footer {
                margin-top: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                font-size: 11px;
                opacity: 0.65;
            }
            .csp-task-hud-status-success .csp-task-hud-spinner {
                animation: none;
                border-color: rgba(34,197,94,0.28);
                background: rgba(34,197,94,0.9);
            }
            .csp-task-hud-status-error .csp-task-hud-spinner {
                animation: none;
                border-color: rgba(239,68,68,0.28);
                background: rgba(239,68,68,0.9);
            }
            .csp-generated-scene-image img {
                cursor: zoom-in;
            }
            .csp-gallery-count-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 24px;
                height: 20px;
                padding: 0 7px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 900;
                color: var(--primary-foreground, #fff);
                background: var(--primary, #ff4432);
                line-height: 1;
            }
            /* univers.chat 탭 행에 추가되는 🎨 삽화 탭 버튼 */
            .csp-tab-button {
                color: var(--muted-foreground);
                font-size: 12px;
                padding: 6px 8px;
                border-radius: 0;
                transition: color 0.15s;
                white-space: nowrap;
            }
            .csp-tab-button:hover {
                color: var(--foreground);
            }
            .csp-tab-button[data-active="true"] {
                color: var(--foreground);
                font-weight: 700;
            }
            .csp-tab-button[data-active="true"]::after {
                content: '';
                position: absolute;
                bottom: -1px;
                left: 0; right: 0;
                height: 2px;
                background: var(--foreground);
                border-radius: 1px;
            }
            /* CSP 탭 패널 내부 버튼 */
            #csp-tab-panel button:not([role="switch"]) {
                cursor: pointer;
                display: block;
            }
            #csp-tab-panel button:not([role="switch"]):hover {
                background: var(--muted);
            }
            .csp-gallery-modal { width: min(1080px, calc(100vw - 30px)); }
            .csp-gallery-summary {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                flex-wrap: wrap;
                margin-bottom: 12px;
            }
            .csp-gallery-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
                gap: 12px;
                min-height: 160px;
            }
            .csp-gallery-empty {
                border: 1px dashed var(--csp-border);
                border-radius: 14px;
                padding: 28px 16px;
                color: var(--csp-muted);
                font-size: 13px;
                text-align: center;
                background: var(--csp-surface-2);
            }
            .csp-gallery-card {
                border: 1px solid var(--csp-border);
                border-radius: 14px;
                background: var(--csp-surface-2);
                overflow: hidden;
                min-width: 0;
                box-shadow: 0 8px 22px rgba(0,0,0,0.10);
            }
            .csp-gallery-thumb {
                width: 100%;
                aspect-ratio: 1 / 1.25;
                border: 0;
                background: var(--csp-surface-3);
                padding: 0;
                cursor: zoom-in;
                display: block;
                overflow: hidden;
            }
            .csp-gallery-thumb img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .csp-gallery-thumb.is-missing {
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--csp-muted);
                font-size: 12px;
                line-height: 1.45;
                padding: 12px;
                text-align: center;
            }
            .csp-gallery-card-body { padding: 10px; }
            .csp-gallery-title {
                color: var(--csp-text);
                font-size: 12px;
                font-weight: 900;
                line-height: 1.35;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                min-height: 32px;
            }
            .csp-gallery-meta {
                margin-top: 5px;
                color: var(--csp-muted);
                font-size: 11px;
                line-height: 1.45;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .csp-gallery-actions {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 9px;
            }
            .csp-gallery-actions .csp-btn {
                padding: 6px 8px;
                font-size: 11px;
                min-width: 0;
                flex: 1 1 auto;
            }
            .csp-gallery-nav-btn {
                flex: 0 0 30px !important;
                width: 30px;
                padding-left: 0 !important;
                padding-right: 0 !important;
                font-size: 15px !important;
                font-weight: 900 !important;
            }
            .csp-gallery-actions .csp-btn:disabled {
                opacity: 0.42;
                cursor: default;
            }
            .csp-lightbox-backdrop {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                background: rgba(0,0,0,0.82);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 28px;
            }
            .csp-lightbox-panel {
                position: relative;
                max-width: min(96vw, 1280px);
                max-height: 92vh;
                display: flex;
                flex-direction: column;
                gap: 10px;
                align-items: center;
            }
            .csp-lightbox-panel img {
                max-width: 100%;
                max-height: calc(92vh - 54px);
                object-fit: contain;
                border-radius: 16px;
                box-shadow: 0 18px 80px rgba(0,0,0,0.48);
                background: rgba(0,0,0,0.2);
            }
            .csp-lightbox-topbar {
                width: 100%;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .csp-lightbox-btn {
                border: 1px solid rgba(255,255,255,0.18);
                background: rgba(20,20,20,0.76);
                color: #fff;
                border-radius: 999px;
                padding: 8px 12px;
                font-size: 12px;
                cursor: pointer;
            }
            @keyframes csp-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .csp-image-info-row,
            .csp-image-action-row {
                position: absolute;
                z-index: 2;
                display: flex;
                gap: 5px;
                flex-wrap: nowrap;
                margin: 0 !important;
                padding: 0 !important;
                max-width: calc(100% - 28px);
                opacity: 0;
                transform: translateY(0);
                pointer-events: none;
                transition: opacity 160ms ease;
                box-sizing: border-box;
            }
            .csp-image-info-row {
                left: 14px;
                top: 14px;
            }
            .csp-image-action-row {
                right: 14px;
                bottom: 14px;
            }
            .csp-generated-scene-image:hover .csp-image-info-row,
            .csp-generated-scene-image:hover .csp-image-action-row,
            .csp-image-info-row:focus-within,
            .csp-image-action-row:focus-within {
                opacity: 1;
                pointer-events: auto;
            }
            .csp-image-action-btn {
                width: 28px;
                height: 28px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid rgba(255,255,255,0.22);
                background: rgba(18,18,22,0.58);
                color: #fff;
                padding: 0;
                border-radius: 999px;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                font-weight: 800;
                box-shadow: 0 3px 10px rgba(0,0,0,0.24);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, opacity 140ms ease;
                box-sizing: border-box;
            }
            .csp-image-action-btn:hover {
                transform: translateY(-1px) scale(1.04);
                background: rgba(32,32,38,0.86);
                border-color: rgba(255,255,255,0.34);
            }
            .csp-image-action-btn:active {
                transform: scale(0.96);
            }
            .csp-image-action-btn[disabled] {
                opacity: 0.55;
                cursor: default;
                transform: none;
            }
            .csp-image-action-btn[data-csp-danger="true"]:hover {
                background: rgba(160, 36, 36, 0.86);
                border-color: rgba(255,120,120,0.40);
            }
            .csp-tab-shell { margin-top: 12px; }
            .csp-tab-list {
                display: flex;
                gap: 4px;
                border-bottom: 1px solid var(--csp-border);
                padding-bottom: 0;
                flex-wrap: wrap;
            }
            .csp-tab-btn {
                border: 1px solid transparent;
                background: transparent;
                color: var(--csp-muted);
                padding: 8px 14px;
                border-radius: 10px 10px 0 0;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
                border-bottom: none;
                margin-bottom: -1px;
            }
            .csp-tab-btn:hover { background: var(--csp-surface-2); }
            .csp-tab-btn.is-active {
                background: var(--csp-surface);
                color: var(--csp-text);
                border-color: var(--csp-border);
                border-bottom-color: var(--csp-surface);
            }
            .csp-tab-panels { margin-top: 12px; }
            .csp-tab-panel { display: none; }
            .csp-tab-panel.is-active { display: block; }

        `;
        document.head.appendChild(style);
    }

    function hasAllClasses(el, classes) {
        if (!el || !el.classList) return false;
        return classes.every(name => el.classList.contains(name));
    }

    function classSetHas(el, ...names) {
        return !!el?.classList && names.every(name => el.classList.contains(name));
    }

    function getMutationElement(node) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE) return node;
        return node.parentElement || null;
    }

    function closestByClassSet(node, ...names) {
        let cur = getMutationElement(node);
        let guard = 0;
        while (cur && cur !== document.body && guard < 16) {
            if (classSetHas(cur, ...names)) return cur;
            cur = cur.parentElement;
            guard++;
        }
        return null;
    }

    function isFooterLike(el) {
        // univers.chat: flex items-center justify-between pt-1
        return hasAllClasses(el, ['flex', 'items-center', 'justify-between', 'pt-1']);
    }

    function isScenePainterNode(node) {
        const el = getMutationElement(node);
        return !!el?.closest?.([
            '#csp-scene-painter-row',
            '#csp-scene-gallery-row',
            '#csp-tab-btn',
            '#csp-tab-panel',
            '.csp-tab-button',
            '.csp-toggle-row',
            '.csp-gallery-row',
            '.csp-overlay',
            '.csp-task-hud-backdrop',
            '.csp-lightbox-backdrop',
            '.csp-generated-scene-image',
            '.csp-image-history-row',
            '.csp-inline-action-footer',
            '.csp-message-generate-btn',
            '.csp-message-speed-btn',
            '#csp-toast'
        ].join(','));
    }

    function isSuggestionNode(node) {
        // univers.chat: 추천 답변 UI 없음
        return false;
    }
    function isComposerNode(node) {
        // univers.chat: .uni-rs-inline-host 또는 textarea[placeholder="메시지 입력..."]
        const el = getMutationElement(node);
        if (!el || !el.closest) return false;
        if (el.closest('.uni-rs-inline-host')) return true;
        if (el.tagName === 'TEXTAREA' && el.placeholder === '메시지 입력...') return true;
        if (el.closest('button[aria-label="메시지 전송"]')) return true;
        let cur = el; let guard = 0;
        while (cur && cur !== document.body && guard < 8) {
            if (cur.classList?.contains('uni-rs-inline-host')) return true;
            if (cur.classList?.contains('rounded-t-2xl') && cur.querySelector?.('textarea[placeholder="메시지 입력..."]')) return true;
            cur = cur.parentElement; guard++;
        }
        return false;
    }
    function isChatListNode(node) {
        // univers.chat: header/nav 또는 /play/ 외부
        const el = getMutationElement(node);
        if (!el || !el.closest) return false;
        if (el.closest('header') || el.closest('nav')) return true;
        if (!location.pathname.startsWith('/play/')) return true;
        return false;
    }
    function isMainMarkdown(el) {
        // univers.chat: [data-message-id] 내부 AI 콘텐츠 래퍼
        if (!el || !el.classList) return false;
        if (!el.closest('[data-message-id]')) return false;
        if (el.closest('.csp-generated-scene-image')) return false;
        if (el.closest('.uni-rs-inline-host')) return false;
        if (el.tagName === 'DIV' && el.classList.contains('space-y-3')) return true;
        if (el.tagName === 'P' && el.classList.contains('leading-relaxed')) return true;
        return false;
    }

    function findPreviousMarkdown(footer) {
        if (!footer) return null;
        let cur = footer.previousElementSibling;
        let guard = 0;

        while (cur && guard < 10) {
            if (isMainMarkdown(cur)) return cur;
            const found = Array.from(cur.querySelectorAll?.('[data-message-id] .space-y-3, [data-message-id] p.leading-relaxed') || []).find(isMainMarkdown);
            if (found) return found;
            cur = cur.previousElementSibling;
            guard++;
        }

        const group = getMessageGroupContainer(footer);
        if (group) return getDirectMarkdown(group);

        const parent = footer.parentElement;
        if (parent) {
            const candidates = Array.from(parent.querySelectorAll('[data-message-id] .space-y-3, [data-message-id] p.leading-relaxed')).filter(isMainMarkdown);
            const before = candidates.filter(md => md.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (before.length) return before[before.length - 1];
        }

        return null;
    }

    function findNextFooter(markdown) {
        if (!markdown) return null;
        const group = getMessageGroupContainer(markdown);
        if (group) return getFooter(group);
        let cur = markdown.nextElementSibling; let guard = 0;
        while (cur && guard < 10) {
            if (isFooterLike(cur)) return cur;
            const nested = Array.from(cur.querySelectorAll?.('div') || []).find(el => isFooterLike(el));
            if (nested) return nested;
            cur = cur.nextElementSibling; guard++;
        }
        return null;
    }
    function getMessageGroupContainer(node) {
        // univers.chat: [data-message-id]
        if (!node || !node.closest) return null;
        return node.closest('[data-message-id]');
    }

    function getMessageGroupCandidates(scope = document) {
        // univers.chat: [data-message-id]
        const set = new Set();
        const root = scope || document;
        if (root.matches?.('[data-message-id]')) set.add(root);
        root.querySelectorAll?.('[data-message-id]').forEach(group => set.add(group));
        return Array.from(set).sort(compareDocumentOrder);
    }

    function getBubbleFromMenuButton(menuBtn) {
        if (!menuBtn) return null;
        const messageGroup = getMessageGroupContainer(menuBtn);
        if (messageGroup) return messageGroup;

        const footer = menuBtn.closest('div.flex.items-center.justify-between.mt-2')
            || menuBtn.closest('[class*="justify-between"][class*="mt-2"]');
        if (footer) {
            const markdown = findPreviousMarkdown(footer);
            if (markdown) return getMessageGroupContainer(markdown) || markdown;
            return footer;
        }

        return null;
    }

    function getDirectMarkdown(bubble) {
        // univers.chat: [data-message-id] 내부 .space-y-3
        if (!bubble) return null;
        if (isMainMarkdown(bubble)) return bubble;
        const msgEl = bubble.closest?.('[data-message-id]') || (bubble.matches?.('[data-message-id]') ? bubble : null);
        const root = msgEl || bubble;
        const spaceY3 = root.querySelector?.('div.space-y-3');
        if (spaceY3 && isMainMarkdown(spaceY3)) return spaceY3;
        const candidates = Array.from(root.querySelectorAll?.('div, p') || []).filter(isMainMarkdown);
        return candidates[0] || null;
    }
    function getFooter(bubble) {
        // univers.chat: .flex.items-center.justify-between.pt-1
        if (!bubble) return null;
        if (isFooterLike(bubble)) return bubble;
        const msgEl = bubble.closest?.('[data-message-id]') || (bubble.matches?.('[data-message-id]') ? bubble : null);
        const root = msgEl || bubble;
        const direct = Array.from(root.children || []).find(el => isFooterLike(el));
        if (direct) return direct;
        const nested = root.querySelector?.('div.flex.items-center.justify-between.pt-1');
        if (nested && root.contains(nested)) return nested;
        return null;
    }
    function ensureCspInlineFooter(markdown) {
        if (!markdown || !markdown.parentElement) return null;

        const existing = markdown.parentElement.querySelector?.(':scope > .csp-inline-action-footer')
            || (markdown.nextElementSibling?.classList?.contains('csp-inline-action-footer') ? markdown.nextElementSibling : null);
        if (existing) return existing;

        const footer = document.createElement('div');
        footer.className = 'csp-inline-action-footer';
        footer.setAttribute('data-csp-inline-footer', 'true');

        const leftSlot = document.createElement('div');
        leftSlot.className = 'flex items-center space-x-3';
        footer.appendChild(leftSlot);

        markdown.insertAdjacentElement('afterend', footer);
        return footer;
    }

    function getButtonTargetFooter(bubble, markdown) {
        if (!isLikelyAssistantMarkdown(markdown) || isUserBubble(bubble) || isUserBubble(markdown)) return null;
        return getFooter(bubble) || ensureCspInlineFooter(markdown);
    }

    function isUserMarkdown(markdown) {
        // univers.chat: '응답 재생성' 버튼 없음 = 사용자 메시지
        if (!markdown) return false;
        const msgEl = markdown.closest?.('[data-message-id]') || (markdown.matches?.('[data-message-id]') ? markdown : null);
        if (!msgEl) return false;
        return !msgEl.querySelector('button[aria-label="응답 재생성"]');
    }
    function findNovelUserRow(node) {
        // univers.chat: 없음
        return null;
    }
    function getMessageSideRole(node) {
        // univers.chat: React fiber message.role 또는 버튼 폴백
        const el = getMutationElement(node);
        const msgEl = el?.closest?.('[data-message-id]') || (el?.matches?.('[data-message-id]') ? el : null);
        if (!msgEl) return '';
        const fk = Object.keys(msgEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternals'));
        if (fk) {
            let f = msgEl[fk];
            for (let i = 0; i < 30 && f; i++) {
                const p = f.memoizedProps;
                if (p?.message?.role) return p.message.role;
                if (typeof p?.message === 'string') {
                    const m = p.message.match(/"role":"(\\w+)"/);
                    if (m) return m[1];
                }
                f = f.return;
            }
        }
        return msgEl.querySelector('button[aria-label="응답 재생성"]') ? 'assistant' : 'user';
    }
    function isAssistantMessageGroup(group) {
        // univers.chat: [data-message-id] + '응답 재생성' 버튼 = AI 메시지
        const el = getMutationElement(group);
        const msgEl = el?.closest?.('[data-message-id]') || (el?.matches?.('[data-message-id]') ? el : null);
        if (!msgEl) return false;
        if (isComposerNode(group)) return false;
        if (!msgEl.querySelector('button[aria-label="응답 재생성"]')) return false;
        if (cleanMarkdownText(msgEl).length < 5) return false;
        return true;
    }
    function isLikelyAssistantMarkdown(markdown) {
        if (!isMainMarkdown(markdown)) return false;
        if (isUserMarkdown(markdown)) return false;
        const group = getMessageGroupContainer(markdown);
        if (group) return isAssistantMessageGroup(group);
        if (isSuggestionNode(markdown) || isComposerNode(markdown) || isChatListNode(markdown)) return false;
        const footer = findNextFooter(markdown);
        return !!!!footer;
    }

    function removeInjectedButtonsFromNode(root) {
        if (!root) return;
        root.querySelectorAll?.('.csp-message-generate-btn, .csp-message-speed-btn').forEach(btn => btn.remove());
        root.querySelectorAll?.('.csp-inline-action-footer').forEach(footer => {
            if (!footer.querySelector('.csp-message-generate-btn, .csp-message-speed-btn')) footer.remove();
        });
    }

    function cleanupNonAssistantMessageButtons() {
        document.querySelectorAll('.csp-inline-action-footer').forEach(footer => {
            const markdown = findPreviousMarkdown(footer)
                || footer.parentElement?.querySelector?.(':scope > .space-y-3, .space-y-3')
                || null;
            if (!markdown || !isLikelyAssistantMarkdown(markdown)) footer.remove();
        });

        document.querySelectorAll('.csp-message-generate-btn, .csp-message-speed-btn').forEach(btn => {
            const group = getMessageGroupContainer(btn);
            const markdown = group ? getDirectMarkdown(group) : (btn.closest('[data-message-id]') || findPreviousMarkdown(btn.closest('.csp-inline-action-footer')));
            if (!markdown || !isLikelyAssistantMarkdown(markdown) || (group && !isAssistantMessageGroup(group))) btn.remove();
        });
    }

    function isUserBubble(bubble) {
        if (!bubble) return false;
        if (isUserMarkdown(bubble)) return true;
        const group = (bubble.matches?.('[data-message-id]') ? bubble : null) || getMessageGroupContainer(bubble);
        if (group) {
            if (isAssistantMessageGroup(group)) return false;
            if (group.querySelector('.bg-surface_chat_secondary')) return true;
            if (findNovelUserRow(group)) return true;
        }
        if (bubble.classList?.contains('bg-surface_chat_secondary')) return true;
        return getMessageSideRole(bubble) === 'user';
    }

    function isAssistantBubble(bubble) {
        if (!bubble || isUserBubble(bubble)) return false;
        const group = (bubble.matches?.('[data-message-id]') ? bubble : null) || getMessageGroupContainer(bubble);
        if (group) return isAssistantMessageGroup(group);
        const markdown = getDirectMarkdown(bubble);
        const footer = getFooter(bubble);
        if (!markdown || !footer) return false;
        if (!isLikelyAssistantMarkdown(markdown)) return false;
        return cleanMarkdownText(markdown).length >= 5;
    }

    function getAssistantBubbles(scope = document) {
        // univers.chat: [data-message-id] + '응답 재생성' 버튼
        const set = new Set();
        getMessageGroupCandidates(scope || document).forEach(msgEl => {
            if (isAssistantMessageGroup(msgEl)) set.add(msgEl);
        });
        return Array.from(set).sort(compareDocumentOrder);
    }
    function compareDocumentOrder(a, b) {
        if (a === b) return 0;
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    }

    function getAllChatBubbles() {
        const set = new Set();

        getMessageGroupCandidates(document).forEach(group => {
            if (isComposerNode(group) || isSuggestionNode(group) || isChatListNode(group)) return;
            if (getDirectMarkdown(group)) set.add(group);
        });

        if (!set.size) {
            Array.from(document.querySelectorAll('[data-message-id]'))
                .filter(isMainMarkdown)
                .filter(markdown => cleanMarkdownText(markdown).length >= 1)
                .forEach(markdown => {
                    if (isSuggestionNode(markdown) || isComposerNode(markdown) || isChatListNode(markdown)) return;
                    set.add(getMessageGroupContainer(markdown) || markdown);
                });
        }

        return Array.from(set).sort(compareDocumentOrder);
    }

    function getBubbleRole(bubble) {
        return isUserBubble(bubble) ? 'user' : 'assistant';
    }

    function getInsertableContentBlocks(markdown) {
        if (!markdown) return [];

        const children = Array.from(markdown.children || []).filter(el => {
            if (!el) return false;
            // CSP 전용 노드 제외
            if (el.classList?.contains('csp-generated-scene-image')) return false;
            if (el.classList?.contains('csp-image-history-row')) return false;
            if (el.id?.startsWith('csp-')) return false;
            // <details> 제외 — 캐릭터 정보 블록, AI 분석/삽입 위치 카운트 모두 제외
            if (el.tagName === 'DETAILS') return false;
            // style 속성에 background/border/padding 조합 → 인라인 스타일 상태창 제외
            const style = el.getAttribute?.('style') || '';
            if (style && /background|border|padding/i.test(style)) return false;
            // 나머지는 모두 block으로 인정 — 커스텀 태그(<OceanStatus> 등) 포함
            // 단, 텍스트 내용이 전혀 없는 빈 요소는 제외
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            return text.length > 0;
        });

        return children;
    }

    function getParagraphs(markdown) {
        const blocks = getInsertableContentBlocks(markdown);
        if (!blocks.length) {
            const fallbackText = cleanMarkdownText(markdown);
            return fallbackText ? [{ index: 0, text: fallbackText }] : [];
        }

        return blocks
            .map((block, index) => {
                const clone = block.cloneNode(true);
                stripNonSceneNodes(clone);
                return { index, text: clone.textContent.replace(/\s+/g, ' ').trim() };
            })
            .filter(item => item.text);
    }

    function getSceneParagraphWindow(markdown, insertAfterParagraph, radius = 1) {
        const paragraphs = getParagraphs(markdown);
        if (!paragraphs.length) return [];

        let idx = Number(insertAfterParagraph);
        if (!Number.isFinite(idx)) idx = 0;
        idx = Math.max(0, Math.min(idx, paragraphs.length - 1));

        const start = Math.max(0, idx - radius);
        const end = Math.min(paragraphs.length - 1, idx + radius);

        return paragraphs.filter(item => item.index >= start && item.index <= end);
    }

    function getSceneWindowText(markdown, insertAfterParagraph, radius = 1) {
        return getSceneParagraphWindow(markdown, insertAfterParagraph, radius)
            .map(item => item.text)
            .join('\n');
    }

    function getRoomCharacterNames(room) {
        return (room.characters || [])
            .map(char => getCharacterSlotName(char))
            .filter(Boolean);
    }

    function findCharacterNamesInText(room, textValue) {
        const source = String(textValue || '').toLowerCase();
        const matched = [];

        getRoomCharacterNames(room).forEach(name => {
            const low = name.toLowerCase();
            if (low && source.includes(low)) matched.push(name);
        });

        return Array.from(new Set(matched));
    }

    function collectContextForBubble(targetBubble) {
        const all = getAllChatBubbles();
        const targetIndex = all.indexOf(targetBubble);
        const start = Math.max(0, targetIndex - 4);
        const end = Math.min(all.length, targetIndex + 1);
        return all.slice(start, end).map((bubble, index) => {
            const markdown = getDirectMarkdown(bubble);
            return {
                order: start + index,
                role: getBubbleRole(bubble),
                isTarget: bubble === targetBubble,
                text: cleanMarkdownText(markdown).slice(0, 2500)
            };
        });
    }

    function removeSceneImage(markdown) {
        if (!markdown) return;
        markdown.querySelectorAll('.csp-generated-scene-image, .csp-image-history-row').forEach(el => el.remove());
    }

    function removeAllSceneRecordsForMarkdown(markdown) {
        // 재생성 시 해당 말풍선의 모든 다중 장면 기록(_s0, _s1, _s2 등) 삭제
        const baseKey = getMessageKey(markdown);
        const records = getSceneRecords();
        let changed = false;
        [baseKey, ...Array.from({length: 5}, (_, i) => `${baseKey}_s${i+1}`)].forEach(k => {
            if (records[k]) { delete records[k]; changed = true; }
        });
        if (changed) saveSceneRecords(records);
    }

    function buildPromptDetailText(plan, paragraphIndex, mode, promptInfo) {
        const title = plan?.sceneTitle || '장면 삽화';
        const reason = plan?.reason || '';
        const label = mode === 'nai' ? 'NAI 생성' : (mode === 'gemini' ? 'Gemini 분석' : '복원');

        const info = (promptInfo && typeof promptInfo === 'object')
            ? promptInfo
            : { finalPrompt: String(promptInfo || '') };

        const basePrompt = String(info.basePrompt || '');
        const baseNegative = String(info.baseNegative || info.fixedNegative || '');
        const finalPrompt = String(info.finalPrompt || '');
        const finalNegative = String(info.finalNegative || '');
        const charPrompts = Array.isArray(info.charPrompts) ? info.charPrompts : [];
        const naiSettings = info.naiSettings || null;
        const referenceInfo = info.referenceInfo || getReferenceSummary(charPrompts);

        const detailChunks = [`${title} · ${label} · 문단 ${Number(paragraphIndex) + 1} 뒤`];
        if (reason) detailChunks.push(`Reason:\n${reason}`);
        if (basePrompt) detailChunks.push(`Base Prompt:\n${basePrompt}`);
        if (baseNegative) detailChunks.push(`Undesired Content:\n${baseNegative}`);
        charPrompts.forEach((char, index) => {
            detailChunks.push(`Character ${index + 1} Prompt:\n${String(char.prompt || '')}`);
            detailChunks.push(`Character ${index + 1} UC:\n${String(char.uc || '')}`);
        });
        if (referenceInfo) {
            detailChunks.push(`Precise Reference:\n${referenceInfo.typeLabel || getReferenceTypeLabel(referenceInfo.type)}\nslot: ${referenceInfo.name || 'Character 1'}\nstrength: ${referenceInfo.strength}\nfidelity: ${referenceInfo.fidelity}\nextra cost: +${referenceInfo.extraAnlas || PRECISE_REFERENCE_EXTRA_ANLAS} Anlas`);
        }
        if (naiSettings && naiSettings.width && naiSettings.height) {
            detailChunks.push(`Resolution:\n${Number(naiSettings.width)}x${Number(naiSettings.height)}`);
        }
        if (finalNegative) detailChunks.push(`Final Negative / UC:\n${finalNegative}`);
        if (finalPrompt) detailChunks.push(`Final Prompt (merged preview):\n${finalPrompt}`);
        return detailChunks.join('\n\n');
    }

    async function getRecordPromptArchive(record) {
        if (!record?.promptArchiveId) return null;
        try {
            return await getStoredMeta(record.promptArchiveId);
        } catch (err) {
            console.warn('[Crack Scene Painter] prompt archive read failed:', err);
            return null;
        }
    }

    async function showImageInfoModal(messageKey) {
        const records = getSceneRecords();
        const record = records[messageKey];
        if (!record) {
            showToast('⚠️ 표시할 이미지 정보가 없어요.');
            return;
        }

        const archive = await getRecordPromptArchive(record);
        const promptSource = Object.assign({}, record || {}, archive || {});
        const archiveMissing = record.promptArchiveId && !archive && !record.finalPrompt;

        const existing = document.getElementById('csp-image-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'csp-image-info-modal';
        overlay.className = 'csp-overlay';
        const detailText = buildPromptDetailText(
            promptSource.plan || record.plan || {},
            Number.isFinite(record.paragraphIndex) ? record.paragraphIndex : (record.plan?.insertAfterParagraph || 0),
            record.mode || promptSource.mode || 'nai',
            {
                basePrompt: promptSource.basePrompt || '',
                baseNegative: promptSource.baseNegative || '',
                finalPrompt: promptSource.finalPrompt || '',
                finalNegative: promptSource.finalNegative || '',
                charPrompts: promptSource.charPrompts || [],
                referenceInfo: promptSource.referenceInfo || getReferenceSummary(promptSource.charPrompts || []),
                naiSettings: promptSource.naiSettings || null,
                scenePrompt: promptSource.plan?.scenePrompt || '',
                temporaryOutfitPrompt: promptSource.plan?.temporaryOutfitPrompt || '',
                useTemporaryOutfit: !!promptSource.plan?.useTemporaryOutfit
            }
        ) + (archiveMissing ? '\n\n※ 용량 절약 모드 기록입니다. 상세 프롬프트 아카이브를 읽지 못했어요.' : '');

        overlay.innerHTML = `
            <div class="csp-modal csp-info-modal" role="dialog" aria-modal="true">
                <h2>ℹ️ 이미지 정보</h2>
                <div class="csp-desc">이 삽화 생성에 사용된 프롬프트와 설정이야.</div>
                <pre class="csp-info-pre">${escapeHtml(detailText)}</pre>
                <div class="csp-actions">
                    <div></div>
                    <div class="csp-actions-right">
                        <button class="csp-btn" id="csp-image-info-edit" type="button">리롤 설정</button>
                        <button class="csp-btn" id="csp-image-info-copy" type="button">복사</button>
                        <button class="csp-btn csp-btn-primary" id="csp-image-info-close" type="button">닫기</button>
                    </div>
                </div>
            </div>
        `;

        overlay.querySelector('#csp-image-info-close').onclick = () => overlay.remove();
        overlay.querySelector('#csp-image-info-edit').onclick = () => {
            overlay.remove();
            showImageRerollSettingsModal(messageKey);
        };
        overlay.querySelector('#csp-image-info-copy').onclick = async () => {
            try {
                await navigator.clipboard.writeText(detailText);
                showToast('📋 이미지 정보를 복사했어요.');
            } catch (err) {
                showToast('⚠️ 복사 실패: ' + err.message);
            }
        };
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    }

    function getImageEditNaiSettings(overlay) {
        return {
            orientationPreset: overlay.querySelector('#csp-edit-orientation')?.value || 'portrait',
            width: Number(overlay.querySelector('#csp-edit-width')?.value || 832),
            height: Number(overlay.querySelector('#csp-edit-height')?.value || 1216),
            steps: Number(overlay.querySelector('#csp-edit-steps')?.value || 28),
            scale: Number(overlay.querySelector('#csp-edit-scale')?.value || 6.5),
            guidanceRescale: Number(overlay.querySelector('#csp-edit-guidance-rescale')?.value || 0.3),
            seed: overlay.querySelector('#csp-edit-seed')?.value.trim() || '',
            sampler: overlay.querySelector('#csp-edit-sampler')?.value || 'k_euler_ancestral',
            noiseSchedule: overlay.querySelector('#csp-edit-noise-schedule')?.value || 'karras',
            nSamples: 1,
            smea: false,
            dyn: false,
            ucPreset: Number(overlay.querySelector('#csp-edit-uc-preset')?.value || 0)
        };
    }

    function showImageRerollSettingsModal(messageKey, box = null, img = null) {
        const records = getSceneRecords();
        const record = records[messageKey];
        if (!record) {
            showToast('⚠️ 수정할 이미지 기록이 없어요.');
            return;
        }

        const existing = document.getElementById('csp-image-reroll-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'csp-image-reroll-modal';
        overlay.className = 'csp-overlay';

        const room = getRoomSettings();
        const rebuiltPromptState = record.plan ? buildFinalPromptFromPlan(record.plan, room) : {};
        const settings = Object.assign({}, getDefaultGlobalSettings().naiSettings, getGlobalSettings().naiSettings || {}, record.naiSettings || {});
        const charPrompts = Array.isArray(record.charPrompts) && record.charPrompts.length
            ? record.charPrompts
            : (Array.isArray(rebuiltPromptState.charPrompts) && rebuiltPromptState.charPrompts.length
                ? rebuiltPromptState.charPrompts
                : [{ name: 'Character 1', prompt: '', uc: '' }]);
        const basePrompt = record.basePrompt || rebuiltPromptState.basePrompt || record.finalPrompt || rebuiltPromptState.finalPrompt || '';
        const baseNegative = record.baseNegative || rebuiltPromptState.baseNegative || record.finalNegative || rebuiltPromptState.finalNegative || '';
        const savedPlan = Object.assign({ useTemporaryOutfit: false, temporaryOutfitPrompt: '' }, record.plan || {});

        const charCardsHtml = charPrompts.map((char, index) => `
            <div class="csp-image-edit-character-card" data-index="${index}">
                <div class="csp-section-title">Character ${index + 1}${char.name ? ` · ${escapeHtml(char.name)}` : ''}</div>
                <div class="csp-field">
                    <label>Character ${index + 1} Prompt</label>
                    <textarea class="csp-edit-character-prompt csp-long">${escapeHtml(char.prompt || '')}</textarea>
                </div>
                <div class="csp-field">
                    <label>Character ${index + 1} UC</label>
                    <textarea class="csp-edit-character-uc">${escapeHtml(char.uc || '')}</textarea>
                </div>
                ${hasUsableReference(char) ? `<div class="csp-mini-note">Precise Reference: ${escapeHtml(getReferenceTypeLabel(char.referenceType))} · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성</div>` : ''}
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="csp-modal csp-reroll-modal" role="dialog" aria-modal="true">
                <h2>⚙️ 이 이미지 리롤 설정</h2>
                <div class="csp-desc">공통 설정과 캐릭터 슬롯 원본은 건드리지 않고, 이 이미지 기록만 수정해서 다시 생성해.</div>

                <div class="csp-section">
                    <div class="csp-section-title">Prompt</div>
                    <div class="csp-field">
                        <label>Base Prompt</label>
                        <textarea id="csp-edit-base-prompt" class="csp-long">${escapeHtml(basePrompt)}</textarea>
                    </div>
                    <div class="csp-field">
                        <div class="csp-label-row">
                            <label>Undesired Content</label>
                            <select id="csp-edit-uc-preset" title="NovelAI Undesired Content Preset" style="max-width: 180px;">
                                ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                            </select>
                        </div>
                        <textarea id="csp-edit-base-negative" class="csp-long">${escapeHtml(baseNegative)}</textarea>
                        <div class="csp-mini-note">선택한 UC 프리셋 태그도 실제 Negative에 합쳐서 전송돼.</div>
                    </div>
                    <div class="csp-field">
                        <label class="csp-check-row">
                            <input id="csp-edit-use-temp-outfit" type="checkbox" ${savedPlan.useTemporaryOutfit ? 'checked' : ''} ${savedPlan.temporaryOutfitPrompt ? '' : 'disabled'}>
                            로그 의상 사용
                        </label>
                        <div class="csp-mini-note" id="csp-edit-temp-outfit-note">${escapeHtml(savedPlan.temporaryOutfitPrompt || '(이 이미지에는 저장된 로그 기반 임시 의상이 없어요)')}</div>
                    </div>
                    ${charCardsHtml}
                </div>

                <div class="csp-section">
                    <div class="csp-section-title">NAI 생성 설정</div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Resolution</label>
                            <div class="csp-res-row">
                                <select id="csp-edit-orientation">
                                    <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                    <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                    <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                </select>
                                <div class="csp-res-dims">
                                    <input id="csp-edit-width" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                    <input id="csp-edit-height" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                    <span class="csp-dim-pill" id="csp-edit-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                    <button class="csp-dim-swap" id="csp-edit-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                    <span class="csp-dim-pill" id="csp-edit-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                </div>
                            </div>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Steps</label><span class="csp-value-chip" id="csp-edit-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-edit-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                <input id="csp-edit-steps" class="csp-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                            </div>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Prompt Guidance</label><span class="csp-value-chip" id="csp-edit-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-edit-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                <input id="csp-edit-scale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                            </div>
                        </div>
                        <div class="csp-field">
                            <label>Seed</label>
                            <input id="csp-edit-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                        </div>
                        <div class="csp-field">
                            <label>Sampler</label>
                            <select id="csp-edit-sampler">
                                <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                            </select>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Prompt Guidance Rescale</label><span class="csp-value-chip" id="csp-edit-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-edit-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                <input id="csp-edit-guidance-rescale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                            </div>
                        </div>
                        <div class="csp-field">
                            <label>Noise Schedule</label>
                            <select id="csp-edit-noise-schedule">
                                <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="csp-section">
                    <div class="csp-section-title">최종 미리보기</div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Final Prompt</label>
                            <div class="csp-readonly-preview" id="csp-edit-final-prompt-preview"></div>
                        </div>
                        <div class="csp-field">
                            <label>Final Negative / UC</label>
                            <div class="csp-readonly-preview" id="csp-edit-final-negative-preview"></div>
                        </div>
                    </div>
                    <div class="csp-field">
                        <label>의상 적용 상태</label>
                        <div class="csp-readonly-preview" id="csp-edit-outfit-preview"></div>
                    </div>
                </div>

                <div class="csp-actions">
                    <div class="csp-actions-left"></div>
                    <div class="csp-actions-right">
                        <button class="csp-anlas-chip" id="csp-edit-current-anlas" type="button" title="클릭해서 잔여 Anlas를 조회해">? Anlas</button>
                        <button class="csp-anlas-chip csp-anlas-cost" id="csp-edit-cost-chip" type="button" title="예상 소모 Anlas" hidden></button>
                        <button class="csp-btn" id="csp-edit-close" type="button">취소</button>
                        <button class="csp-btn csp-btn-primary" id="csp-edit-reroll" type="button">이 설정으로 리롤</button>
                    </div>
                </div>
            </div>
        `;

        const widthEl = overlay.querySelector('#csp-edit-width');
        const heightEl = overlay.querySelector('#csp-edit-height');
        const orientationEl = overlay.querySelector('#csp-edit-orientation');
        const widthViewEl = overlay.querySelector('#csp-edit-width-view');
        const heightViewEl = overlay.querySelector('#csp-edit-height-view');
        const costEl = overlay.querySelector('#csp-edit-cost-chip');
        const balanceEl = overlay.querySelector('#csp-edit-current-anlas');
        const useTempOutfitEl = overlay.querySelector('#csp-edit-use-temp-outfit');
        const tempOutfitNoteEl = overlay.querySelector('#csp-edit-temp-outfit-note');
        const outfitPreviewEl = overlay.querySelector('#csp-edit-outfit-preview');
        let latestAnlasBalance = null;

        function syncRerollCharacterPromptsFromOutfitSource() {
            const cards = Array.from(overlay.querySelectorAll('.csp-image-edit-character-card'));
            cards.forEach((card, index) => {
                const original = charPrompts[index] || {};
                const slot = findRoomCharacterSlotByName(original.name || savedPlan.visibleCharacters?.[0] || '', room);
                if (!slot) return;
                const promptEl = card.querySelector('.csp-edit-character-prompt');
                if (!promptEl) return;
                const previewPlan = Object.assign({}, savedPlan, { useTemporaryOutfit: !!useTempOutfitEl?.checked });
                const mergedPrompt = getCharacterPromptForPlan(slot, previewPlan);
                if (mergedPrompt) promptEl.value = mergedPrompt;
            });
        }

        function collectEditedChars() {
            return Array.from(overlay.querySelectorAll('.csp-image-edit-character-card')).map((card, index) => {
                const original = charPrompts[index] || {};
                return {
                    ...original,
                    name: original.name || `Character ${index + 1}`,
                    prompt: normalizeNaiWeightSyntax(normalizePrompt(card.querySelector('.csp-edit-character-prompt')?.value || '')),
                    uc: normalizeNaiWeightSyntax(normalizePrompt(card.querySelector('.csp-edit-character-uc')?.value || '')),
                    referenceEnabled: !!original.referenceEnabled,
                    referenceType: normalizeReferenceType(original.referenceType || 'character'),
                    referenceAssetId: original.referenceAssetId || '',
                    referenceImageName: original.referenceImageName || '',
                    referenceStrength: clampNumber(original.referenceStrength, -1, 1, 0.6),
                    referenceFidelity: clampNumber(original.referenceFidelity, -1, 1, 0.8)
                };
            }).filter(char => char.prompt || char.uc || char.referenceAssetId);
        }

        function buildEditedPromptState() {
            const editedChars = collectEditedChars();
            const editedBasePrompt = normalizeNaiWeightSyntax(normalizePrompt(overlay.querySelector('#csp-edit-base-prompt')?.value || ''));
            const editedBaseNegative = normalizeNaiWeightSyntax(normalizePrompt(overlay.querySelector('#csp-edit-base-negative')?.value || ''));
            const mergedCharacterPrompt = buildCommaPrompt(editedChars.map(char => stripSubjectCountTags(char.prompt || '')));
            const mergedCharacterUc = buildCommaPrompt(editedChars.map(char => char.uc || ''));
            return {
                basePrompt: editedBasePrompt,
                baseNegative: editedBaseNegative,
                charPrompts: editedChars,
                useTemporaryOutfit: !!useTempOutfitEl?.checked,
                temporaryOutfitPrompt: savedPlan.temporaryOutfitPrompt || '',
                finalPrompt: buildCommaPrompt([editedBasePrompt, mergedCharacterPrompt]),
                finalNegative: buildCommaPrompt([editedBaseNegative, mergedCharacterUc])
            };
        }

        function updateEditPreview() {
            const state = buildEditedPromptState();
            const editSettings = getImageEditNaiSettings(overlay);
            const editModel = getGlobalSettings().naiModel || 'nai-diffusion-4-5-full';
            const visibleFinalNegative = mergeNaiUcPresetWithNegative(state.finalNegative, editSettings, editModel);
            overlay.querySelector('#csp-edit-final-prompt-preview').textContent = state.finalPrompt || '(empty)';
            overlay.querySelector('#csp-edit-final-negative-preview').textContent = visibleFinalNegative || '(empty)';
            if (outfitPreviewEl) {
                const slot = findRoomCharacterSlotByName((state.charPrompts[0] || {}).name || savedPlan.visibleCharacters?.[0] || '', room);
                const appliedOutfit = state.useTemporaryOutfit ? (savedPlan.temporaryOutfitPrompt || '') : getCharacterOutfitTags(slot);
                const sourceLabel = state.useTemporaryOutfit ? '로그 의상 사용' : '캐릭터 슬롯 기본 의상 사용';
                outfitPreviewEl.textContent = `${sourceLabel}${appliedOutfit ? `\n${appliedOutfit}` : '\n(의상 태그 없음)'}`;
            }
            renderAnlasInlineUi(costEl, balanceEl, state.charPrompts, latestAnlasBalance, getImageEditNaiSettings(overlay));
        }

        async function refreshEditAnlasBalance(silent = false) {
            if (balanceEl) {
                balanceEl.disabled = true;
                balanceEl.textContent = '... Anlas';
            }
            try {
                latestAnlasBalance = await fetchNaiAnlasBalance();
                updateEditPreview();
                if (!silent) showToast(`잔여 Anlas: ${Number(latestAnlasBalance.total).toLocaleString()}`);
            } catch (err) {
                latestAnlasBalance = null;
                updateEditPreview();
                if (!silent) showToast('⚠️ 잔여 Anlas 조회 실패: ' + err.message);
            } finally {
                if (balanceEl) balanceEl.disabled = false;
            }
        }

        syncRerollCharacterPromptsFromOutfitSource();
        applyOrientationPreset(orientationEl.value, widthEl, heightEl, widthViewEl, heightViewEl);
        orientationEl.addEventListener('change', () => {
            applyOrientationPreset(orientationEl.value, widthEl, heightEl, widthViewEl, heightViewEl);
            updateEditPreview();
        });
        overlay.querySelector('#csp-edit-swap')?.addEventListener('click', () => {
            swapOrientationPreset(orientationEl, widthEl, heightEl, widthViewEl, heightViewEl);
            updateEditPreview();
        });
        bindRangeNumberPair(overlay.querySelector('#csp-edit-steps-range'), overlay.querySelector('#csp-edit-steps'), overlay.querySelector('#csp-edit-steps-value'), { min: 1, max: 50, step: 1, decimals: 0, onChange: updateEditPreview });
        bindRangeNumberPair(overlay.querySelector('#csp-edit-scale-range'), overlay.querySelector('#csp-edit-scale'), overlay.querySelector('#csp-edit-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#csp-edit-guidance-rescale-range'), overlay.querySelector('#csp-edit-guidance-rescale'), overlay.querySelector('#csp-edit-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });
        useTempOutfitEl?.addEventListener('change', () => {
            syncRerollCharacterPromptsFromOutfitSource();
            if (tempOutfitNoteEl) tempOutfitNoteEl.textContent = savedPlan.temporaryOutfitPrompt || '(이 이미지에는 저장된 로그 기반 임시 의상이 없어요)';
            updateEditPreview();
        });
        overlay.querySelectorAll('textarea, input, select').forEach(el => {
            el.addEventListener('input', updateEditPreview);
            el.addEventListener('change', updateEditPreview);
        });
        balanceEl?.addEventListener('click', () => refreshEditAnlasBalance(false));
        overlay.querySelector('#csp-edit-close').onclick = () => overlay.remove();

        const imageEditRerollBtn = overlay.querySelector('#csp-edit-reroll');
        if (imageEditRerollBtn && isSceneHistoryFull(record)) {
            imageEditRerollBtn.disabled = true;
            imageEditRerollBtn.title = `리롤 기록이 ${CSP_MAX_IMAGE_HISTORY}장까지 찼어요. 휴지통으로 이미지를 지우면 다시 리롤할 수 있어요.`;
        }

        overlay.querySelector('#csp-edit-reroll').onclick = async () => {
            const btn = overlay.querySelector('#csp-edit-reroll');
            const state = buildEditedPromptState();
            const settings = getImageEditNaiSettings(overlay);
            if (!state.finalPrompt) {
                showToast('⚠️ Final Prompt가 비어 있어요.');
                return;
            }
            try {
                const targetBox = box || document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
                if (isSceneHistoryFull(record)) {
                    refreshImageActionState(messageKey, targetBox, record);
                    showToast(`⚠️ 리롤 기록은 최대 ${CSP_MAX_IMAGE_HISTORY}장이에요. 휴지통으로 이미지를 지우면 다시 리롤할 수 있어요.`);
                    return;
                }

                btn.disabled = true;
                btn.textContent = '리롤 중...';
                const targetImg = img || targetBox?.querySelector('img');
                const nextImageUrl = await generateImageWithNai({
                    basePrompt: state.basePrompt,
                    baseNegative: state.baseNegative,
                    finalPrompt: state.finalPrompt,
                    finalNegative: state.finalNegative,
                    charPrompts: state.charPrompts,
                    settings
                });

                if (targetImg && nextImageUrl) targetImg.src = nextImageUrl;

                const caption = targetBox?.querySelector('.csp-generated-scene-caption');
                if (caption) {
                    caption.innerHTML = buildCaption(
                        record.plan || {},
                        Number.isFinite(record.paragraphIndex) ? record.paragraphIndex : (record.plan?.insertAfterParagraph || 0),
                        'nai',
                        {
                            basePrompt: state.basePrompt,
                            baseNegative: state.baseNegative,
                            finalPrompt: state.finalPrompt,
                            finalNegative: state.finalNegative,
                            charPrompts: state.charPrompts,
                            referenceInfo: getReferenceSummary(state.charPrompts),
                            naiSettings: settings,
                            scenePrompt: record.plan?.scenePrompt || '',
                            temporaryOutfitPrompt: savedPlan.temporaryOutfitPrompt || '',
                            useTemporaryOutfit: !!state.useTemporaryOutfit
                        },
                        messageKey
                    );
                }

                const currentHistoryItem = await appendSceneHistoryImage(messageKey, record, nextImageUrl);

                record.mode = 'nai';
                record.basePrompt = state.basePrompt;
                record.baseNegative = state.baseNegative;
                record.finalPrompt = state.finalPrompt;
                record.finalNegative = state.finalNegative;
                record.charPrompts = state.charPrompts;
                record.referenceInfo = getReferenceSummary(state.charPrompts);
                record.naiSettings = settings;
                record.plan = Object.assign({}, record.plan || {}, {
                    temporaryOutfitPrompt: savedPlan.temporaryOutfitPrompt || '',
                    useTemporaryOutfit: !!state.useTemporaryOutfit
                });
                record.createdAt = Date.now();

                if (currentHistoryItem && getGlobalSettings().folderSaveEnabled && String(nextImageUrl || '').startsWith('data:')) {
                    try {
                        currentHistoryItem.folderFileName = await saveImageToChosenFolder(nextImageUrl, record.plan || {});
                        syncCurrentImageFieldsFromHistory(record);
                    } catch (folderErr) {
                        console.warn('[Crack Scene Painter] auto folder save failed:', folderErr);
                    }
                }

                const nextRecords = getSceneRecords();
                nextRecords[messageKey] = record;
                saveSceneRecords(nextRecords);
                refreshImageHistoryControls(messageKey, targetBox, record);
                overlay.remove();
                showToast('⚙️ 수정 설정으로 리롤 완료');
            } catch (err) {
                console.error('[Crack Scene Painter] image-specific reroll failed:', err);
                showToast('⚠️ 리롤 실패: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '이 설정으로 리롤';
            }
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
        updateEditPreview();
        refreshEditAnlasBalance(true);
    }

    function buildCaption(plan, paragraphIndex, mode, promptInfo, messageKey) {
        if (!messageKey) return '';
        return `
            <div class="csp-image-info-row" aria-label="Scene Painter image info">
                <button class="csp-image-action-btn csp-image-info-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="정보" aria-label="정보">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                </button>
            </div>
            <div class="csp-image-action-row" aria-label="Scene Painter image actions">
                <button class="csp-image-action-btn csp-image-reroll-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="리롤" aria-label="리롤">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
                <button class="csp-image-action-btn csp-image-edit-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="리롤 설정" aria-label="리롤 설정">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96a7.02 7.02 0 0 0-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.37 1.04.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
                </button>
                <button class="csp-image-action-btn csp-image-download-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="저장" aria-label="저장">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z"/></svg>
                </button>
                <button class="csp-image-action-btn csp-image-delete-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="삭제" aria-label="삭제" data-csp-danger="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
            </div>
        `;
    }

    function insertSceneImageIntoMarkdown(markdown, imageUrl, paragraphIndex, options = {}) {
        if (!markdown) return { ok: false, reason: 'markdown-not-found' };

        const blocks = getInsertableContentBlocks(markdown);
        // keepExisting: 다중 장면 모드에서 기존 이미지 유지
        if (!options.keepExisting) {
            removeSceneImage(markdown);
        } else {
            // keepExisting 모드: 같은 messageKey 이미지가 이미 있으면 스킵
            if (options.messageKey) {
                const dup = markdown.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(options.messageKey)}"]`);
                if (dup && dup.isConnected) return { ok: false, reason: 'already-inserted' };
            }
        }
        // messageKey 기준 중복 체크 (keepExisting 여부 무관)
        if (options.messageKey) {
            const anyDup = markdown.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(options.messageKey)}"]`);
            if (anyDup && anyDup.isConnected) return { ok: false, reason: 'already-inserted' };
        }

        let index = 0;
        let target = null;

        if (blocks.length) {
            index = Math.max(0, Math.min(Number(paragraphIndex) || 0, blocks.length - 1));
            target = blocks[index];
        }

        const box = document.createElement('div');
        box.className = 'csp-generated-scene-image';
        box.setAttribute('data-csp-mode', options.mode || 'gemini');
        if (options.messageKey) box.setAttribute('data-message-key', options.messageKey);

        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = options.alt || 'Scene Painter Image';

        const caption = document.createElement('div');
        caption.className = 'csp-generated-scene-caption';
        if (options.captionHtml) caption.innerHTML = options.captionHtml;
        else caption.textContent = options.caption || `Scene Painter 삽입 · AI 답변 문단 ${index + 1} 뒤`;

        const historyRow = document.createElement('div');
        historyRow.className = 'csp-image-history-row';
        if (options.messageKey) historyRow.setAttribute('data-message-key', options.messageKey);
        if (options.historyHtml) historyRow.innerHTML = options.historyHtml;

        box.appendChild(img);
        box.appendChild(caption);

        if (target && target.parentElement === markdown) {
            target.insertAdjacentElement('afterend', box);
            box.insertAdjacentElement('afterend', historyRow);
            return { ok: true, index, target, box, historyRow };
        }

        markdown.appendChild(box);
        markdown.appendChild(historyRow);
        return { ok: true, index: Number(paragraphIndex) || 0, target: markdown, box, historyRow, fallback: true };
    }

    function openImageLightbox(src, title = 'Scene Painter Image') {
        if (!src) return;

        document.querySelectorAll('.csp-lightbox-backdrop').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'csp-lightbox-backdrop';
        overlay.innerHTML = `
            <div class="csp-lightbox-panel">
                <div class="csp-lightbox-topbar">
                    <button class="csp-lightbox-btn" data-csp-lightbox-download>다운로드</button>
                    <button class="csp-lightbox-btn" data-csp-lightbox-close>닫기</button>
                </div>
                <img src="${escapeHtml(src)}" alt="${escapeHtml(title)}">
            </div>
        `;

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-csp-lightbox-close]')) close();
            const downloadBtn = e.target.closest('[data-csp-lightbox-download]');
            if (downloadBtn) {
                const a = document.createElement('a');
                a.href = src;
                a.download = `${sanitizeFileName(title || 'scene-image')}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        });

        const onKey = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', onKey, true);
            }
        };
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(overlay);
    }

    function getRoomGalleryEntries(limit = 60) {
        const records = getSceneRecords();
        const entries = Object.entries(records || {})
            .map(([messageKey, record]) => {
                const normalized = normalizeSceneRecordHistory(record, messageKey);
                const history = Array.isArray(normalized?.history) ? normalized.history : [];
                if (!history.length) return null;
                return {
                    messageKey,
                    record: normalized,
                    historyCount: history.length,
                    currentIndex: clampHistoryIndex(normalized),
                    createdAt: Number(normalized.createdAt || history[history.length - 1]?.createdAt || 0)
                };
            })
            .filter(Boolean)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        return entries.slice(0, limit);
    }

    function getRoomGalleryStats() {
        const entries = getRoomGalleryEntries(9999);
        const imageCount = entries.reduce((sum, item) => sum + item.historyCount, 0);
        return { sceneCount: entries.length, imageCount };
    }

    function updateGalleryRowCount() {
        const stats = getRoomGalleryStats();
        const countText = String(stats.imageCount || 0);
        const titleText = `현재 방 삽화 ${stats.sceneCount}개 / 이미지 기록 ${stats.imageCount}장`;
        // 구형 갤러리 행 배지
        const row = document.getElementById('csp-scene-gallery-row');
        if (row) {
            const badge = row.querySelector('.csp-gallery-count-badge');
            if (badge) { badge.textContent = countText; badge.title = titleText; }
        }
        // 탭 패널 내 갤러리 버튼 배지
        const panelBadge = document.querySelector('#csp-tab-panel .csp-gallery-count-badge');
        if (panelBadge) { panelBadge.textContent = countText; panelBadge.title = titleText; }
    }

    function formatGalleryDate(ts) {
        const n = Number(ts || 0);
        if (!n) return '';
        try {
            const d = new Date(n);
            const pad = v => String(v).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch (_) {
            return '';
        }
    }

    function getGalleryIndexMap(overlay) {
        if (!overlay.__cspGalleryIndexMap || typeof overlay.__cspGalleryIndexMap !== 'object') {
            overlay.__cspGalleryIndexMap = {};
        }
        return overlay.__cspGalleryIndexMap;
    }

    function getGalleryViewIndex(overlay, messageKey, historyCount, fallbackIndex = 0) {
        const map = getGalleryIndexMap(overlay);
        const saved = Number(map[messageKey]);
        const fallback = Number(fallbackIndex);
        const raw = Number.isFinite(saved) ? saved : (Number.isFinite(fallback) ? fallback : 0);
        return Math.max(0, Math.min(Math.trunc(raw), Math.max(0, Number(historyCount || 0) - 1)));
    }

    function setGalleryViewIndex(overlay, messageKey, index, historyCount) {
        const map = getGalleryIndexMap(overlay);
        map[messageKey] = Math.max(0, Math.min(Math.trunc(Number(index) || 0), Math.max(0, Number(historyCount || 0) - 1)));
        return map[messageKey];
    }

    function updateGalleryCardMeta(card, record, galleryIndex, historyCount) {
        if (!card || !record) return;

        const safeIndex = Math.max(0, Math.min(Number(galleryIndex) || 0, Math.max(0, Number(historyCount || 0) - 1)));
        const safeCount = Math.max(1, Number(historyCount || 1));
        const title = record?.plan?.sceneTitle || '장면 삽화';
        const paragraph = Number(record?.paragraphIndex ?? record?.plan?.insertAfterParagraph ?? 0) + 1;
        const created = formatGalleryDate(record?.createdAt || record?.history?.[safeIndex]?.createdAt);

        card.setAttribute('data-gallery-index', String(safeIndex));

        const titleEl = card.querySelector('.csp-gallery-title');
        if (titleEl) {
            titleEl.textContent = title;
            titleEl.title = title;
        }

        const metaEl = card.querySelector('.csp-gallery-meta');
        if (metaEl) {
            metaEl.textContent = `문단 ${paragraph} · ${safeIndex + 1} / ${safeCount}${created ? ` · ${created}` : ''}`;
        }

        const prevBtn = card.querySelector('[data-csp-gallery-action="prev"]');
        const nextBtn = card.querySelector('[data-csp-gallery-action="next"]');
        if (prevBtn) prevBtn.disabled = safeIndex <= 0;
        if (nextBtn) nextBtn.disabled = safeIndex >= safeCount - 1;
    }

    function preloadImageSrc(src) {
        return new Promise((resolve, reject) => {
            if (!src) {
                reject(new Error('이미지 데이터가 비어 있어요.'));
                return;
            }
            const img = new Image();
            img.onload = () => resolve(src);
            img.onerror = () => reject(new Error('이미지를 미리 불러오지 못했어요.'));
            img.src = src;
        });
    }

    async function updateGalleryCardPreview(overlay, card, record = null, forcedIndex = null) {
        if (!overlay || !card) return false;

        const messageKey = card.getAttribute('data-message-key') || '';
        if (!messageKey) return false;

        const records = getSceneRecords();
        const effectiveRecord = normalizeSceneRecordHistory(record || records[messageKey], messageKey);
        if (!effectiveRecord || !Array.isArray(effectiveRecord.history) || !effectiveRecord.history.length) return false;

        const historyCount = effectiveRecord.history.length;
        const fallbackIndex = forcedIndex === null || forcedIndex === undefined
            ? Number(card.getAttribute('data-gallery-index') || clampHistoryIndex(effectiveRecord))
            : Number(forcedIndex);
        const galleryIndex = getGalleryViewIndex(overlay, messageKey, historyCount, fallbackIndex);

        const thumb = card.querySelector('.csp-gallery-thumb');
        if (!thumb) return false;

        updateGalleryCardMeta(card, effectiveRecord, galleryIndex, historyCount);

        try {
            const src = await getRecordImageSrc(effectiveRecord, galleryIndex);
            await preloadImageSrc(src);

            const existingImg = thumb.querySelector('img');
            thumb.classList.remove('is-missing');

            // 기존 img 노드를 최대한 유지해서 갤러리 전체가 반짝이는 느낌을 줄인다.
            if (existingImg) {
                if (existingImg.getAttribute('src') !== src) existingImg.src = src;
                existingImg.alt = effectiveRecord?.plan?.sceneTitle || 'scene-image';
            } else {
                thumb.textContent = '';
                const img = document.createElement('img');
                img.src = src;
                img.alt = effectiveRecord?.plan?.sceneTitle || 'scene-image';
                thumb.appendChild(img);
            }

            return true;
        } catch (err) {
            console.warn('[Crack Scene Painter] gallery single card preview update failed:', err);
            // 이전 이미지가 이미 떠 있으면 화면을 비우지 않는다. 아예 이미지가 없을 때만 실패 문구 표시.
            if (!thumb.querySelector('img')) {
                thumb.classList.add('is-missing');
                thumb.textContent = '이미지 로드 실패';
            }
            return false;
        }
    }

    async function deleteGalleryHistoryImage(messageKey, index) {
        const records = getSceneRecords();
        const record = normalizeSceneRecordHistory(records[messageKey], messageKey);
        if (!record || !Array.isArray(record.history) || !record.history.length) {
            await clearSceneRecordForMessage(messageKey);
            return { removedAll: true, remaining: 0 };
        }

        const deleteIndex = Math.max(0, Math.min(Math.trunc(Number(index) || 0), record.history.length - 1));
        const previousCurrent = clampHistoryIndex(record);
        const [removed] = record.history.splice(deleteIndex, 1);

        if (removed?.imageId) {
            try {
                await deleteStoredImage(removed.imageId);
            } catch (err) {
                console.warn('[Crack Scene Painter] gallery history image delete failed:', err);
            }
        }

        if (!record.history.length) {
            delete records[messageKey];
            saveSceneRecords(records);
            document
                .querySelectorAll(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"], .csp-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
                .forEach(el => el.remove());
            markSceneButtons(messageKey, false);
            return { removedAll: true, remaining: 0 };
        }

        if (deleteIndex < previousCurrent) {
            record.currentIndex = previousCurrent - 1;
        } else if (deleteIndex === previousCurrent) {
            record.currentIndex = Math.min(deleteIndex, record.history.length - 1);
        } else {
            record.currentIndex = previousCurrent;
        }

        syncCurrentImageFieldsFromHistory(record);
        records[messageKey] = record;
        saveSceneRecords(records);

        const targetBox = document.querySelector(`.csp-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const img = targetBox?.querySelector('img');
        const src = await getRecordImageSrc(record);
        if (img && src) img.src = src;
        refreshImageHistoryControls(messageKey, targetBox, record);
        markSceneButtons(messageKey, true);

        return { removedAll: false, remaining: record.history.length, currentIndex: clampHistoryIndex(record) };
    }

    async function renderGalleryGrid(overlay) {
        const grid = overlay?.querySelector?.('#csp-gallery-grid');
        const summary = overlay?.querySelector?.('#csp-gallery-summary-text');
        if (!grid) return;

        const entries = getRoomGalleryEntries(60);
        const stats = getRoomGalleryStats();
        if (summary) {
            const limited = stats.sceneCount > entries.length ? ` · 최근 ${entries.length}개 표시` : '';
            summary.textContent = `현재 채팅방 삽화 ${stats.sceneCount}개 / 이미지 기록 ${stats.imageCount}장${limited}`;
        }

        updateGalleryRowCount();

        if (!entries.length) {
            grid.innerHTML = `<div class="csp-gallery-empty">아직 이 채팅방에 저장된 삽화가 없어.<br>AI 답변 아래 이미지 버튼으로 먼저 한 장 뽑아줘.</div>`;
            return;
        }

        grid.innerHTML = entries.map(entry => {
            const record = entry.record;
            const title = record?.plan?.sceneTitle || '장면 삽화';
            const historyCount = entry.historyCount;
            const galleryIndex = getGalleryViewIndex(overlay, entry.messageKey, historyCount, entry.currentIndex);
            const paragraph = Number(record?.paragraphIndex ?? record?.plan?.insertAfterParagraph ?? 0) + 1;
            const created = formatGalleryDate(record?.createdAt || record?.history?.[galleryIndex]?.createdAt);
            return `
                <div class="csp-gallery-card" data-message-key="${escapeHtml(entry.messageKey)}" data-gallery-index="${galleryIndex}">
                    <button class="csp-gallery-thumb is-missing" type="button" data-csp-gallery-action="preview">이미지 로드 중...</button>
                    <div class="csp-gallery-card-body">
                        <div class="csp-gallery-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        <div class="csp-gallery-meta">문단 ${paragraph} · ${galleryIndex + 1} / ${historyCount}${created ? ` · ${escapeHtml(created)}` : ''}</div>
                        <div class="csp-gallery-actions">
                            <button class="csp-btn csp-gallery-nav-btn" type="button" data-csp-gallery-action="prev" ${galleryIndex <= 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
                            <button class="csp-btn csp-gallery-nav-btn" type="button" data-csp-gallery-action="next" ${galleryIndex >= historyCount - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></button>
                            <button class="csp-btn" type="button" data-csp-gallery-action="download">저장</button>
                            <button class="csp-btn csp-btn-danger" type="button" data-csp-gallery-action="delete">삭제</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        await Promise.all(entries.map(async entry => {
            const card = grid.querySelector(`.csp-gallery-card[data-message-key="${CSS.escape(entry.messageKey)}"]`);
            if (!card) return;
            await updateGalleryCardPreview(
                overlay,
                card,
                entry.record,
                Number(card.getAttribute('data-gallery-index') || entry.currentIndex || 0)
            );
        }));
    }

    function openGalleryModal() {
        injectStyles();
        document.querySelectorAll('#csp-gallery-modal').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'csp-gallery-modal';
        overlay.className = 'csp-overlay';
        overlay.innerHTML = `
            <div class="csp-modal csp-gallery-modal" role="dialog" aria-modal="true">
                <h2>🖼️ 현재 채팅방 삽화 갤러리</h2>
                <div class="csp-desc">이 채팅방에서 생성한 삽화와 리롤 기록을 모아 보여줘.<br>리롤 히스토리는 이미지 하나당 최대 ${CSP_MAX_IMAGE_HISTORY}장까지 저장돼.</div>
                <div class="csp-gallery-summary">
                    <div id="csp-gallery-summary-text" class="csp-mini-note">갤러리 읽는 중...</div>
                    <div class="csp-actions-left">
                        <button class="csp-btn csp-btn-small" id="csp-gallery-refresh" type="button">새로고침</button>
                        <button class="csp-btn csp-btn-small" id="csp-gallery-close" type="button">닫기</button>
                    </div>
                </div>
                <div id="csp-gallery-grid" class="csp-gallery-grid"></div>
            </div>
        `;

        const close = () => overlay.remove();
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#csp-gallery-close').onclick = close;
        overlay.querySelector('#csp-gallery-refresh').onclick = () => renderGalleryGrid(overlay);

        overlay.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-csp-gallery-action]');
            if (!actionEl) return;
            e.preventDefault();
            e.stopPropagation();

            const action = actionEl.getAttribute('data-csp-gallery-action');
            const card = actionEl.closest('.csp-gallery-card');
            const messageKey = card?.getAttribute('data-message-key') || '';
            if (!messageKey) return;

            const records = getSceneRecords();
            const record = normalizeSceneRecordHistory(records[messageKey], messageKey);
            if (!record || !Array.isArray(record.history) || !record.history.length) {
                showToast('⚠️ 갤러리 기록을 찾지 못했어요.');
                await renderGalleryGrid(overlay);
                return;
            }

            const historyCount = Array.isArray(record.history) ? record.history.length : 0;
            const galleryIndex = getGalleryViewIndex(overlay, messageKey, historyCount, Number(card?.getAttribute('data-gallery-index') || clampHistoryIndex(record)));
            try {
                if (action === 'prev' || action === 'next') {
                    const nextIndex = setGalleryViewIndex(
                        overlay,
                        messageKey,
                        galleryIndex + (action === 'prev' ? -1 : 1),
                        historyCount
                    );
                    await updateGalleryCardPreview(overlay, card, record, nextIndex);
                    return;
                }

                if (action === 'preview') {
                    const src = await getRecordImageSrc(record, galleryIndex);
                    if (!src) {
                        showToast('⚠️ 크게 볼 이미지가 없어요.');
                        return;
                    }
                    openImageLightbox(src, record?.plan?.sceneTitle || 'scene-image');
                    return;
                }

                if (action === 'download') {
                    const src = await getRecordImageSrc(record, galleryIndex);
                    if (!src) {
                        showToast('⚠️ 저장할 이미지가 없어요.');
                        return;
                    }
                    const a = document.createElement('a');
                    a.href = src;
                    a.download = `${sanitizeFileName(record?.plan?.sceneTitle || 'scene-image')}_${galleryIndex + 1}.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    showToast('⬇️ 다운로드를 시작했어요.');
                    return;
                }

                if (action === 'delete') {
                    const ok = confirm('현재 보고 있는 갤러리 이미지를 삭제할까요?\n채팅창에 삽입된 이미지도 같은 기록이면 함께 갱신돼요.');
                    if (!ok) return;
                    const result = await deleteGalleryHistoryImage(messageKey, galleryIndex);
                    if (!result?.removedAll) {
                        setGalleryViewIndex(overlay, messageKey, Math.min(galleryIndex, Math.max(0, result.remaining - 1)), result.remaining);
                    }
                    await renderGalleryGrid(overlay);
                    showToast('🗑️ 갤러리 이미지를 삭제했어요.');
                    return;
                }
            } catch (err) {
                console.error('[Crack Scene Painter] gallery action failed:', err);
                showToast('⚠️ 갤러리 작업 실패: ' + err.message);
            }
        });

        document.body.appendChild(overlay);
        renderGalleryGrid(overlay);
    }

    function extractJsonLoose(text) {
        const raw = String(text || '').trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```$/i, '')
            .trim();
        try {
            return JSON.parse(raw);
        } catch (_) {
            const start = raw.indexOf('{');
            const end = raw.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                return JSON.parse(raw.slice(start, end + 1));
            }
            throw new Error('Gemini 응답에서 JSON을 찾지 못했어요.');
        }
    }

    function stripHtmlErrorMessage(text) {
        const raw = String(text || '').trim();
        if (!raw) return '';
        if (!/^<!doctype html|^<html|<body[\s>]/i.test(raw)) return raw;

        const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
        const body = raw
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();

        return [title, body].filter(Boolean).join(' / ').slice(0, 800);
    }

    function getVertexErrorHint(url, status, responseText) {
        const source = String(url || '');
        if (!/aiplatform\.googleapis\.com\/v1\/projects\//.test(source)) return '';

        let model = '';
        let location = '';
        try {
            model = decodeURIComponent(source.match(/\/models\/([^:/?]+)/)?.[1] || '');
            location = decodeURIComponent(source.match(/\/locations\/([^/]+)/)?.[1] || '');
        } catch (_) {}

        if (status === 404) {
            const locationHint = location ? `location=${location}` : 'location 확인 필요';
            const modelHint = model ? `model=${model}` : 'model 확인 필요';
            const globalHint = location === 'global'
                ? 'global location은 aiplatform.googleapis.com 엔드포인트로 보정했어. 그래도 404면 해당 모델 ID가 Vertex 프로젝트/위치에서 아직 제공되지 않거나 이름이 다른 경우일 가능성이 커.'
                : 'Gemini 3.x 계열은 Vertex에서 global location이 필요한 경우가 있어. 설정의 Vertex Location을 global로 바꿔서도 확인해줘.';

            return `Vertex AI 404: 요청한 모델/위치 조합을 찾지 못했어요. (${modelHint}, ${locationHint}) ${globalHint}`;
        }

        if (status === 401 || status === 403) {
            return 'Vertex AI 인증/권한 오류예요. OAuth Access Token, Project ID, Vertex AI API 활성화, IAM 권한을 확인해줘.';
        }

        return '';
    }

    function buildHttpErrorMessage({ url, status, responseText }) {
        let message = responseText || `HTTP ${status}`;
        let rawDetail = '';

        try {
            const err = JSON.parse(responseText);
            const raw = err.error?.metadata?.raw || '';
            const base = err.error?.message || err.message || message;
            rawDetail = raw;
            message = raw ? `${base} — ${raw}` : base;
        } catch (_) {
            message = stripHtmlErrorMessage(message);
        }

        const vertexHint = getVertexErrorHint(url, status, responseText);
        if (vertexHint) {
            const compact = String(message || '').replace(/\s+/g, ' ').trim();
            return compact && !compact.includes(vertexHint)
                ? `${vertexHint}\n\n원문: ${compact.slice(0, 500)}`
                : vertexHint;
        }

        // HTTP 상태코드별 한국어 메시지
        const detail = String(rawDetail || message || '').toLowerCase();
        if (status === 408 || /timeout|시간이 초과/.test(detail)) return '⏱️ 타임아웃: 응답이 너무 오래 걸렸어. 다시 시도해봐.';
        if (status === 429) {
            const retryMatch = String(rawDetail).match(/retry\s*(?:after\s*)?(\d+)\s*sec/i);
            const sec = retryMatch ? retryMatch[1] : '';
            return `⚡ 요청이 너무 많아서 잠깐 막혔어.${sec ? ` ${sec}초 후 자동 재시도할게.` : ' 잠시 후 다시 시도해봐.'}`;
        }
        if (status === 400) {
            if (/embedding|embed/.test(detail)) return '❌ 이 모델은 임베딩 전용이라 채팅에 못 써. 다른 모델로 바꿔줘.';
            return '❌ 요청 형식이 잘못됐어. 모델 ID나 설정을 확인해줘.';
        }
        if (status === 401) return '🔑 API Key가 틀렸거나 만료됐어. 설정에서 다시 확인해줘.';
        if (status === 403) return '🚫 이 API Key로는 접근이 안 돼. 권한을 확인해줘.';
        if (status === 404) {
            if (/model not found|no endpoints/.test(detail)) return '❌ 없는 모델이야. openrouter.ai/models에서 정확한 모델 ID를 확인해줘.';
            return '❌ 요청한 주소를 찾을 수 없어. API 설정을 확인해줘.';
        }
        if (status === 402) return '💳 크레딧이 부족해. 충전하거나 무료 모델로 바꿔줘.';
        if (status >= 500 && status < 600) return `🔥 서버 에러 떴어 (${status}). 잠시 후 자동 재시도할게.`;

        return String(message || `HTTP ${status}`).replace(/\s+/g, ' ').trim();
    }

    function gmRequestJson({ method, url, headers, data, responseType, signal }) {
        return new Promise((resolve, reject) => {
            const activeSignal = signal || currentTaskHud?.abortController?.signal || null;
            if (activeSignal?.aborted) {
                reject(new Error('작업이 취소됐어요.'));
                return;
            }

            const requestPayload = data ? JSON.stringify(data) : undefined;
            let settled = false;
            let request = null;

            const cleanup = () => {
                if (activeSignal) activeSignal.removeEventListener('abort', onAbort);
            };

            const finishResolve = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            const finishReject = (error) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };

            const onAbort = () => {
                try {
                    request?.abort?.();
                } catch (_) {}
                console.warn('[Crack Scene Painter] GM request cancelled by user:', { method, url });
                finishReject(new Error('작업이 취소됐어요.'));
            };

            if (activeSignal) activeSignal.addEventListener('abort', onAbort, { once: true });

            request = GM_xmlhttpRequest({
                method,
                url,
                headers,
                responseType: responseType || 'text',
                data: requestPayload,
                timeout: 180000,
                onload: (response) => {
                    if (settled) return;
                    try {
                        if (response.status < 200 || response.status >= 300) {
                            const message = buildHttpErrorMessage({
                                url,
                                status: response.status,
                                responseText: response.responseText
                            });

                            console.error('[Crack Scene Painter] GM request failed:', {
                                method,
                                url,
                                status: response.status,
                                statusText: response.statusText,
                                responseText: response.responseText,
                                responseHeaders: response.responseHeaders
                            });
                            // 에러 원인 파악을 위해 응답 본문 전체를 별도 로그로 출력
                            // retry_after_seconds가 있으면 에러 객체에 실어서 withRetry가 활용
                            let retryAfterSec = null;
                            try {
                                const errBody = JSON.parse(response.responseText);
                                console.error('[Crack Scene Painter] API 에러 상세:', JSON.stringify(errBody, null, 2));
                                const ra = errBody?.error?.metadata?.retry_after_seconds;
                                if (ra && Number.isFinite(Number(ra))) retryAfterSec = Math.ceil(Number(ra));
                            } catch (_) {
                                console.error('[Crack Scene Painter] API 에러 원문:', response.responseText?.slice(0, 1000));
                            }

                            const httpErr = new Error(message);
                            httpErr.httpStatus = response.status; // withRetry에서 정확히 판단하기 위해
                            if (retryAfterSec) httpErr.retryAfterSec = retryAfterSec;
                            finishReject(httpErr);
                            return;
                        }

                        if (responseType === 'arraybuffer') {
                            finishResolve(response.response);
                            return;
                        }

                        finishResolve(JSON.parse(response.responseText));
                    } catch (e) {
                        console.error('[Crack Scene Painter] GM response parse failed:', { method, url, response, error: e });
                        finishReject(e);
                    }
                },
                onerror: (error) => {
                    if (settled) return;
                    console.error('[Crack Scene Painter] GM network error:', {
                        method,
                        url,
                        error,
                        payloadLength: requestPayload ? requestPayload.length : 0
                    });
                    finishReject(new Error('🌐 네트워크 오류: 인터넷 연결이나 API 주소를 확인해줘.'));
                },
                ontimeout: () => {
                    if (settled) return;
                    console.error('[Crack Scene Painter] GM request timeout:', { method, url });
                    const toErr = new Error('⏱️ 타임아웃: 응답이 너무 오래 걸렸어. 다시 시도해봐.');
                    toErr.httpStatus = 408;
                    finishReject(toErr);
                },
                onabort: () => {
                    if (settled) return;
                    console.log('[Crack Scene Painter] 생성 취소됨:', { method, url });
                    finishReject(new Error('작업이 취소됐어요.'));
                }
            });
        });
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Blob을 data URL로 변환하지 못했어요.'));
            reader.readAsDataURL(blob);
        });
    }


    function detectBinarySignature(bytes) {
        if (!bytes || !bytes.length) return 'empty';
        if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
        if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) return 'png';
        if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
        if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
        const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 240))).trim();
        if (head.startsWith('{') || head.startsWith('[')) return 'json';
        if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<')) return 'html';
        return 'unknown';
    }

    function extractErrorMessageFromBytes(bytes) {
        try {
            const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 4000))).trim();
            if (!text) return '';
            try {
                const parsed = JSON.parse(text);
                return parsed.error?.message || parsed.message || text;
            } catch (_) {}
            return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        } catch (_) {
            return '';
        }
    }

    function buildGeminiUserPrompt({ targetBubble, markdown, room, paragraphRange }) {
        const global = getGlobalSettings();
        let paragraphs = getParagraphs(markdown);
        // paragraphRange: { start, end } — 본문을 N등분한 구간만 전달
        if (paragraphRange && Number.isFinite(paragraphRange.start) && Number.isFinite(paragraphRange.end)) {
            paragraphs = paragraphs.filter(p => p.index >= paragraphRange.start && p.index <= paragraphRange.end);
        }
        const context = collectContextForBubble(targetBubble);

        const characterLines = (room.characters || [])
            .filter(hasCharacterSlotContent)
            .map((c, i) => `캐릭터 ${i + 1}\n이름: ${c.name || '(이름 없음)'}\n외형 태그: ${c.appearanceTags || c.tags || '(태그 없음)'}\n기본 의상 태그: ${c.outfitTags || '(없음)'}\nUC: ${c.uc || '(없음)'}\nReference: ${c.referenceEnabled && c.referenceAssetId ? getReferenceTypeLabel(c.referenceType) : '(없음)'}`)
            .join('\n\n');

        return `아래 Crack 채팅 로그를 분석해서, 현재 사용자가 누른 AI 답변 안에 삽화를 넣을 위치와 장면 태그를 결정해줘.

[현재 채팅방 Character Prompt 슬롯]
${characterLines || '(저장된 Character Prompt 슬롯 없음)'}

[공통 Gemini 장면 태그 보조 지침]
${global.naiPromptGuide || '(없음)'}

[최근 대화 맥락]
${JSON.stringify(context, null, 2)}

[대상 AI 답변 문단 목록]
${JSON.stringify(paragraphs, null, 2)}

[중요]
- 대상 AI 답변 전체를 복제하지 말고, 삽화로 만들 핵심 순간 하나만 고른다.
- insertAfterParagraph는 반드시 대상 AI 답변 문단 목록에 있는 index 중 하나여야 함.
- 상태창/시간 표시/코드블록/메타 정보가 아니라 실제 행동/표정/감정이 드러나는 본문 문단 뒤를 우선한다.
- visibleCharacters는 네가 고른 핵심 순간의 화면 중심 저장 캐릭터 1명만 넣는다.
- 같은 답변 안에 이름이 언급되어도, 선택한 순간의 중심 인물이 아니면 visibleCharacters에서 제외한다.
- 캐릭터 슬롯이 여러 개 있어도 모든 저장 캐릭터를 억지로 넣지 않는다.
- 전체 프롬프트를 만들지 말고 globalContext / baseScenePrompt / composition / interactionPrompt / temporaryOutfitPrompt / visibleCharacters만 생성해야 함.
- globalContext에는 전체 답변에서 파악한 장소/시간대/큰 상황/분위기를 저장한다.
- composition은 2~3개만 생성한다: 카메라 거리 1개 + 시점/시선 1~2개.
- composition에는 close-up, portrait, upper body, cowboy shot, medium shot, full body 중 가장 맞는 1개만 넣는다.
- from side, profile, looking at viewer 조합은 허용한다.
- 다만 front view / profile / from side 중에서는 가장 맞는 1개를 고른다.
- interactionPrompt는 2~4개만 생성한다: 행동 1~2개 + 표정/감정 1~2개.
- shy, nervous, worried expression처럼 비슷한 감정 태그를 3개 이상 겹치지 않는다.
- baseScenePrompt는 2~4개만 생성한다: 배경/장소/소품/조명/분위기만.
- temporaryOutfitPrompt에는 현재 장면 의상이 분명할 때만 간결한 영어 의상 태그를 넣고, 애매하면 빈 문자열로 둔다.
- 모든 프롬프트 필드는 영어 Danbooru 태그만 쉼표로 구분한 문자열이어야 한다. 배열/객체 금지.
- visibleCharacters 외의 프롬프트 필드에는 캐릭터 이름/고유명사/호칭/직책명/한국어 문장을 넣지 말 것.
- 외형 관련 태그 / 인물 주체 태그는 Gemini 프롬프트 필드에서 생성하지 말 것.
- 예: boy, girl, young man, young woman, man, woman, person, office worker
- 외형/머리색/눈색/체형은 생성하지 말 것.
- 의상은 temporaryOutfitPrompt에만 넣고, 다른 필드에는 넣지 말 것.
- artist태그/year태그/Negative는 넣지 말 것.
- 중복 태그를 만들지 말 것.
- JSON 외의 텍스트는 절대 출력하지 말 것.

{
  "sceneTitle": "장면 제목",
  "insertAfterParagraph": 0,
  "characterCount": 1,
  "visibleCharacters": ["저장된 캐릭터 이름 1명"],
  "mood": "english mood tags",
  "globalContext": {
    "locationPrompt": "english place/background tags from the whole log",
    "timePrompt": "english time/weather tags from the whole log",
    "atmospherePrompt": "english mood/lighting tags from the whole log",
    "situationSummary": "전체 로그의 장소와 큰 상황을 한국어로 짧게"
  },
  "composition": "english camera and framing tags",
  "baseScenePrompt": "common scene tags only",
  "interactionPrompt": "center character action/expression/interaction tags only",
  "temporaryOutfitPrompt": "english outfit tags only or empty string",
  "reason": "왜 이 순간을 골랐는지 짧게"
}`;
    }

    function getParagraphOptionLabel(item) {
        const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
        return `문단 ${Number(item?.index || 0) + 1} · ${text.slice(0, 44)}${text.length > 44 ? '…' : ''}`;
    }

    function getParagraphTextByIndex(markdown, index) {
        const paragraphs = getParagraphs(markdown);
        const found = paragraphs.find(item => Number(item.index) === Number(index));
        return found?.text || '';
    }

    function buildParagraphSelectOptions(markdown, selectedIndex) {
        const paragraphs = getParagraphs(markdown);
        return paragraphs.map(item => `
            <option value="${Number(item.index)}" ${Number(item.index) === Number(selectedIndex) ? 'selected' : ''}>
                ${escapeHtml(getParagraphOptionLabel(item))}
            </option>
        `).join('');
    }

    function buildCharacterSelectOptions(room, selectedName) {
        const names = getRoomCharacterNames(room);
        const selected = String(selectedName || '').trim();
        const options = [
            `<option value="" ${!selected ? 'selected' : ''}>자동 / 선택 안 함</option>`
        ];

        names.forEach(name => {
            options.push(`<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`);
        });

        return options.join('');
    }

    function buildFocusedGeminiUserPrompt({ targetBubble, markdown, room, focusIndex, initialGlobalContext }) {
        const global = getGlobalSettings();
        const paragraphs = getParagraphs(markdown);
        const context = collectContextForBubble(targetBubble);
        const focusWindow = getSceneParagraphWindow(markdown, focusIndex, 1);
        const focusText = getParagraphTextByIndex(markdown, focusIndex);
        const stableGlobalContext = normalizeGlobalSceneContext({ globalContext: initialGlobalContext || {} });

        const characterLines = (room.characters || [])
            .filter(hasCharacterSlotContent)
            .map((c, i) => `캐릭터 ${i + 1}\n이름: ${c.name || '(이름 없음)'}\n외형 태그: ${c.appearanceTags || c.tags || '(태그 없음)'}\n기본 의상 태그: ${c.outfitTags || '(없음)'}\nUC: ${c.uc || '(없음)'}\nReference: ${c.referenceEnabled && c.referenceAssetId ? getReferenceTypeLabel(c.referenceType) : '(없음)'}`)
            .join('\n\n');

        return `아래 채팅 로그에서 사용자가 직접 고른 기준 문단을 중심으로 삽화 장면을 다시 분석해줘.

[현재 채팅방 Character Prompt 슬롯]
${characterLines || '(저장된 Character Prompt 슬롯 없음)'}

[공통 Gemini 장면 태그 보조 지침]
${global.naiPromptGuide || '(없음)'}

[최근 대화 맥락]
${JSON.stringify(context, null, 2)}

[전체 문단 목록]
${JSON.stringify(paragraphs, null, 2)}

[전체 로그에서 이미 파악한 장소/상황 컨텍스트]
${JSON.stringify(stableGlobalContext, null, 2)}

[사용자가 선택한 기준 문단 index]
${Number(focusIndex)}

[선택 문단 원문]
${focusText}

[선택 문단 주변]
${JSON.stringify(focusWindow, null, 2)}

[중요]
- 이번 재분석은 전체 로그에서 다른 장면을 새로 고르는 것이 아니라, 사용자가 선택한 기준 문단을 중심으로 장면을 만든다.
- 장소, 시간대, 큰 상황, 분위기는 [전체 로그에서 이미 파악한 장소/상황 컨텍스트]를 우선 참고한다.
- 선택 문단 주변에 장소 정보가 없어도 기존 컨텍스트의 장소/상황을 유지한다.
- 선택 문단 주변 내용과 기존 컨텍스트가 충돌하면 선택 문단 주변 내용을 우선한다.
- insertAfterParagraph는 가능하면 ${Number(focusIndex)}로 둔다.
- 선택 문단과 앞뒤 1문단에 실제로 연결되는 장면만 분석한다.
- visibleCharacters는 선택 문단 주변의 화면 중심 저장 캐릭터 1명만 넣는다.
- 사용자의 캐릭터는 기본적으로 화면 밖 대상이므로 visibleCharacters에 넣지 않는다.
- composition은 2~3개만 생성한다: 카메라 거리 1개 + 시점/시선 1~2개.
- composition에는 close-up, portrait, upper body, cowboy shot, medium shot, full body 중 가장 맞는 1개만 넣는다.
- from side, profile, looking at viewer 조합은 허용한다.
- 다만 front view / profile / from side 중에서는 가장 맞는 1개를 고른다.
- interactionPrompt는 2~4개만 생성한다: 행동 1~2개 + 표정/감정 1~2개.
- shy, nervous, worried expression처럼 비슷한 감정 태그를 3개 이상 겹치지 않는다.
- baseScenePrompt는 2~4개만 생성한다: 배경/장소/소품/조명/분위기만.
- temporaryOutfitPrompt에는 현재 장면 의상이 분명할 때만 간결한 영어 의상 태그를 넣고, 애매하면 빈 문자열로 둔다.
- 모든 프롬프트 필드는 영어 Danbooru 태그만 쉼표로 구분한 문자열이어야 한다. 배열/객체 금지.
- visibleCharacters 외의 프롬프트 필드에는 캐릭터 이름/고유명사/호칭/직책명/한국어 문장을 넣지 말 것.
- 외형 관련 태그 / 인물 주체 태그는 Gemini 프롬프트 필드에서 생성하지 말 것.
- 예: boy, girl, young man, young woman, man, woman, person, office worker
- 외형/머리색/눈색/체형은 생성하지 말 것.
- 의상은 temporaryOutfitPrompt에만 넣고, 다른 필드에는 넣지 말 것.
- artist태그/year태그/Negative는 넣지 말 것.
- 중복 태그를 만들지 말 것.
- JSON 외의 텍스트는 절대 출력하지 말 것.

{
  "sceneTitle": "장면 제목",
  "insertAfterParagraph": ${Number(focusIndex)},
  "characterCount": 1,
  "visibleCharacters": ["저장된 캐릭터 이름 1명"],
  "mood": "english mood tags",
  "globalContext": {
    "locationPrompt": "english place/background tags, keep previous context unless contradicted",
    "timePrompt": "english time/weather tags, keep previous context unless contradicted",
    "atmospherePrompt": "english mood/lighting tags, keep previous context unless contradicted",
    "situationSummary": "선택 문단 기준 현재 장소와 큰 상황을 한국어로 짧게"
  },
  "composition": "english camera and framing tags",
  "baseScenePrompt": "common scene tags only",
  "interactionPrompt": "center character action/expression/interaction tags only",
  "temporaryOutfitPrompt": "english outfit tags only or empty string",
  "reason": "왜 이 문단 기준 장면이 좋은지 짧게"
}`;
    }

    function normalizeGlobalSceneContext(rawPlan, fallbackContext = null) {
        const fallback = fallbackContext || {};
        const source = rawPlan?.globalContext || rawPlan?.globalSceneContext || rawPlan?.contextSummary || rawPlan?.sceneContext || {};

        if (typeof source === 'string') {
            return {
                locationPrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(fallback.locationPrompt || ''))),
                timePrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(fallback.timePrompt || ''))),
                atmospherePrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(fallback.atmospherePrompt || rawPlan?.mood || ''))),
                situationSummary: source.trim() || String(fallback.situationSummary || '').trim()
            };
        }

        return {
            locationPrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(
                source.locationPrompt || source.location || source.place || source.backgroundPrompt || fallback.locationPrompt || ''
            ))),
            timePrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(
                source.timePrompt || source.time || source.timeOfDay || source.weatherPrompt || fallback.timePrompt || ''
            ))),
            atmospherePrompt: normalizeNaiWeightSyntax(stripForbiddenSceneTags(flattenPromptValue(
                source.atmospherePrompt || source.atmosphere || source.mood || source.lightingPrompt || fallback.atmospherePrompt || rawPlan?.mood || ''
            ))),
            situationSummary: String(
                source.situationSummary || source.situation || source.summary || source.sceneContinuity || fallback.situationSummary || ''
            ).trim()
        };
    }

    function buildGlobalContextPromptTags(globalContext) {
        if (!globalContext) return '';
        return stripForbiddenSceneTags(buildCommaPrompt([
            globalContext.locationPrompt,
            globalContext.timePrompt,
            globalContext.atmospherePrompt
        ]));
    }

    function formatGlobalContextForTextarea(globalContext) {
        const ctx = normalizeGlobalSceneContext({ globalContext: globalContext || {} });
        return JSON.stringify({
            locationPrompt: ctx.locationPrompt || '',
            timePrompt: ctx.timePrompt || '',
            atmospherePrompt: ctx.atmospherePrompt || '',
            situationSummary: ctx.situationSummary || ''
        }, null, 2);
    }

    function parseGlobalContextFromTextarea(textValue, fallbackContext = null) {
        const raw = String(textValue || '').trim();
        if (!raw) return normalizeGlobalSceneContext({ globalContext: fallbackContext || {} });

        try {
            const parsed = JSON.parse(raw);
            return normalizeGlobalSceneContext({ globalContext: parsed }, fallbackContext);
        } catch (_) {
            return normalizeGlobalSceneContext({
                globalContext: {
                    situationSummary: raw,
                    locationPrompt: fallbackContext?.locationPrompt || '',
                    timePrompt: fallbackContext?.timePrompt || '',
                    atmospherePrompt: fallbackContext?.atmospherePrompt || ''
                }
            }, fallbackContext);
        }
    }

    function normalizeGeminiScenePlan(rawPlan, room, markdown, forcedIndex = null, fallbackGlobalContext = null) {
        const paragraphCount = getParagraphs(markdown).length;
        let idx = forcedIndex === null || forcedIndex === undefined ? Number(rawPlan.insertAfterParagraph) : Number(forcedIndex);
        if (!Number.isFinite(idx)) idx = 0;
        idx = Math.max(0, Math.min(idx, Math.max(0, paragraphCount - 1)));

        const globalContext = normalizeGlobalSceneContext(rawPlan, fallbackGlobalContext);
        const globalContextPrompt = buildGlobalContextPromptTags(globalContext);

        let baseScenePrompt = limitCommaTags(sanitizeScenePrompt(extractBaseScenePromptCandidate(rawPlan)), 4);
        let interactionPrompt = limitCommaTags(sanitizeScenePrompt(extractInteractionPromptCandidate(rawPlan)), 4);
        let compositionPrompt = limitCommaTags(sanitizeScenePrompt(rawPlan?.composition || ''), 3);
        let scenePrompt = cleanScenePromptTags(buildCommaPrompt([compositionPrompt, interactionPrompt, baseScenePrompt, globalContextPrompt]));

        if (!scenePrompt) {
            scenePrompt = sanitizeScenePrompt(buildMinimalScenePromptFallback(getSceneWindowText(markdown, idx, 1) || cleanMarkdownText(markdown), 1));
            baseScenePrompt = scenePrompt;
            interactionPrompt = '';
            compositionPrompt = '';
        }

        baseScenePrompt = limitCommaTags(stripForbiddenSceneTags(baseScenePrompt || ''), 4);
        interactionPrompt = limitCommaTags(stripForbiddenSceneTags(interactionPrompt || ''), 4);
        compositionPrompt = limitCommaTags(stripForbiddenSceneTags(compositionPrompt || ''), 3);
        scenePrompt = cleanScenePromptTags(buildCommaPrompt([compositionPrompt, interactionPrompt, baseScenePrompt, globalContextPrompt]));

        const visibleCharacters = normalizeVisibleCharacters(rawPlan, room, markdown, idx);
        const temporaryOutfitPrompt = sanitizeScenePrompt(
            rawPlan?.temporaryOutfitPrompt || rawPlan?.temporary_outfit_prompt || rawPlan?.outfitPrompt || rawPlan?.sceneOutfitPrompt || rawPlan?.costumePrompt || ''
        );

        return {
            sceneTitle: String(rawPlan.sceneTitle || '장면 삽화'),
            insertAfterParagraph: idx,
            characterCount: Math.max(visibleCharacters.length || 0, 1),
            visibleCharacters,
            charactersInScene: visibleCharacters,
            mood: flattenPromptValue(rawPlan.mood || ''),
            globalContext,
            composition: compositionPrompt,
            baseScenePrompt,
            interactionPrompt,
            temporaryOutfitPrompt,
            useTemporaryOutfit: false,
            scenePrompt,
            reason: String(rawPlan.reason || '')
        };
    }

    async function generateScenePlanForParagraphWithGemini(targetBubble, markdown, focusIndex, initialGlobalContext = null) {
        const global = getGlobalSettings();
        const room = getRoomSettings();

        const geminiRequest = getGeminiGenerateContentRequestConfig(global);
        const url = geminiRequest.url;
        const userPrompt = buildFocusedGeminiUserPrompt({ targetBubble, markdown, room, focusIndex, initialGlobalContext });

        const payload = {
            systemInstruction: {
                parts: [{ text: getEffectiveGeminiSystemInstruction(global) }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: userPrompt }]
                }
            ],
            generationConfig: buildGeminiGenerationConfig(geminiRequest.model, {
                temperature: 0.18,
                topP: 0.75,
                responseMimeType: 'application/json'
            })
        };

        const data = await requestGeminiGenerateContent(geminiRequest, payload);

        const responseText = extractTextFromGeminiResponseData(data);

        if (!responseText) throw new Error('Gemini 응답이 비어 있어요.');

        const rawPlan = extractJsonLoose(responseText);
        return normalizeGeminiScenePlan(rawPlan, room, markdown, focusIndex, initialGlobalContext);
    }


    function buildRefineGeminiUserPrompt({ targetBubble, markdown, room, focusIndex, initialGlobalContext, selectedCharacterName, currentPlan, currentScenePrompt, additionalRequest }) {
        const global = getGlobalSettings();
        const paragraphs = getParagraphs(markdown);
        const context = collectContextForBubble(targetBubble);
        const focusWindow = getSceneParagraphWindow(markdown, focusIndex, 1);
        const focusText = getParagraphTextByIndex(markdown, focusIndex);
        const stableGlobalContext = normalizeGlobalSceneContext({ globalContext: initialGlobalContext || {} });
        const safePlan = currentPlan || {};

        const characterLines = (room.characters || [])
            .filter(hasCharacterSlotContent)
            .map((c, i) => `캐릭터 ${i + 1}\n이름: ${c.name || '(이름 없음)'}\n외형 태그: ${c.appearanceTags || c.tags || '(태그 없음)'}\n기본 의상 태그: ${c.outfitTags || '(없음)'}\nUC: ${c.uc || '(없음)'}\nReference: ${c.referenceEnabled && c.referenceAssetId ? getReferenceTypeLabel(c.referenceType) : '(없음)'}`)
            .join('\n\n');

        return `아래 채팅 로그에서 이미 고른 장면을 유지한 채, 사용자의 추가 요청만 반영해서 장면 태그를 다시 다듬어줘.

[현재 채팅방 Character Prompt 슬롯]
${characterLines || '(저장된 Character Prompt 슬롯 없음)'}

[공통 Gemini 장면 태그 보조 지침]
${global.naiPromptGuide || '(없음)'}

[최근 대화 맥락]
${JSON.stringify(context, null, 2)}

[전체 문단 목록]
${JSON.stringify(paragraphs, null, 2)}

[전체 로그에서 이미 파악한 장소/상황 컨텍스트]
${JSON.stringify(stableGlobalContext, null, 2)}

[현재 선택 문단 index]
${Number(focusIndex)}

[선택 문단 원문]
${focusText}

[선택 문단 주변]
${JSON.stringify(focusWindow, null, 2)}

[현재 장면 초안]
${JSON.stringify({
    sceneTitle: safePlan.sceneTitle || '',
    insertAfterParagraph: Number(focusIndex),
    visibleCharacters: selectedCharacterName ? [selectedCharacterName] : (safePlan.visibleCharacters || []),
    mood: safePlan.mood || '',
    globalContext: stableGlobalContext,
    composition: safePlan.composition || '',
    baseScenePrompt: safePlan.baseScenePrompt || '',
    interactionPrompt: safePlan.interactionPrompt || '',
    temporaryOutfitPrompt: safePlan.temporaryOutfitPrompt || '',
    scenePrompt: currentScenePrompt || safePlan.scenePrompt || '',
    reason: safePlan.reason || ''
}, null, 2)}

[사용자 추가 요청]
${String(additionalRequest || '').trim()}

[중요]
- 이번 작업은 새 장면을 고르는 것이 아니라, 현재 선택된 장면을 다듬는 작업이다.
- insertAfterParagraph는 ${Number(focusIndex)}로 유지한다.
- visibleCharacters는 기본적으로 현재 중심 캐릭터 1명만 유지한다.
- 현재 중심 캐릭터가 ${selectedCharacterName ? '"' + selectedCharacterName + '"' : '정해져 있지 않으면 문맥상 가장 자연스러운 저장 캐릭터 1명'} 이므로, 특별한 이유가 없으면 바꾸지 말 것.
- 사용자의 추가 요청은 우선 반영하되, 전체 로그 장소/시간대/큰 상황과 충돌하지 않는 선에서 다듬는다.
- 장소, 시간대, 큰 상황, 분위기는 [전체 로그에서 이미 파악한 장소/상황 컨텍스트]를 우선 참고한다.
- 선택 문단 주변 내용과 기존 컨텍스트가 충돌하면 선택 문단 주변 내용을 우선한다.
- composition은 2~3개만 생성한다: 카메라 거리 1개 + 시점/시선 1~2개.
- composition에는 close-up, portrait, upper body, cowboy shot, medium shot, full body 중 가장 맞는 1개만 넣는다.
- from side, profile, looking at viewer 조합은 허용한다.
- 다만 front view / profile / from side 중에서는 가장 맞는 1개를 고른다.
- interactionPrompt는 2~4개만 생성한다: 행동 1~2개 + 표정/감정 1~2개.
- baseScenePrompt는 2~4개만 생성한다: 배경/장소/소품/조명/분위기만.
- temporaryOutfitPrompt에는 사용자의 추가 요청이나 선택 문단에서 의상이 분명할 때만 간결한 영어 의상 태그를 넣고, 아니면 빈 문자열로 둔다.
- 모든 프롬프트 필드는 영어 Danbooru 태그만 쉼표로 구분한 문자열이어야 한다. 배열/객체 금지.
- visibleCharacters 외의 프롬프트 필드에는 캐릭터 이름/고유명사/호칭/직책명/한국어 문장을 넣지 말 것.
- 외형 관련 태그 / 인물 주체 태그는 Gemini 프롬프트 필드에서 생성하지 말 것.
- 예: boy, girl, young man, young woman, man, woman, person, office worker
- 의상은 temporaryOutfitPrompt에만 넣고, 다른 필드에는 넣지 말 것.
- artist태그/year태그/Negative는 넣지 말 것.
- 중복 태그를 만들지 말 것.
- JSON 외의 텍스트는 절대 출력하지 말 것.

{
  "sceneTitle": "장면 제목",
  "insertAfterParagraph": ${Number(focusIndex)},
  "characterCount": 1,
  "visibleCharacters": [${selectedCharacterName ? '"' + selectedCharacterName.replace(/"/g, '\\"') + '"' : '"저장된 캐릭터 이름 1명"'}],
  "mood": "english mood tags",
  "globalContext": {
    "locationPrompt": "english place/background tags, keep previous context unless contradicted",
    "timePrompt": "english time/weather tags, keep previous context unless contradicted",
    "atmospherePrompt": "english mood/lighting tags, keep previous context unless contradicted",
    "situationSummary": "선택 문단 기준 현재 장소와 큰 상황을 한국어로 짧게"
  },
  "composition": "english camera and framing tags",
  "baseScenePrompt": "common scene tags only",
  "interactionPrompt": "center character action/expression/interaction tags only",
  "temporaryOutfitPrompt": "english outfit tags only or empty string",
  "reason": "추가 요청을 어떻게 반영했는지 짧게"
}`;
    }

    async function generateRefinedScenePlanWithGemini(targetBubble, markdown, focusIndex, initialGlobalContext = null, currentPlan = null, selectedCharacterName = '', additionalRequest = '') {
        const global = getGlobalSettings();
        const room = getRoomSettings();
        const geminiRequest = getGeminiGenerateContentRequestConfig(global);
        const url = geminiRequest.url;
        const userPrompt = buildRefineGeminiUserPrompt({
            targetBubble,
            markdown,
            room,
            focusIndex,
            initialGlobalContext,
            selectedCharacterName,
            currentPlan,
            currentScenePrompt: currentPlan?.scenePrompt || buildCommaPrompt([currentPlan?.composition, currentPlan?.interactionPrompt, currentPlan?.baseScenePrompt]),
            additionalRequest
        });

        const payload = {
            systemInstruction: {
                parts: [{ text: getEffectiveGeminiSystemInstruction(global) }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: userPrompt }]
                }
            ],
            generationConfig: buildGeminiGenerationConfig(geminiRequest.model, {
                temperature: 0.15,
                topP: 0.72,
                responseMimeType: 'application/json'
            })
        };

        const data = await requestGeminiGenerateContent(geminiRequest, payload);

        const responseText = extractTextFromGeminiResponseData(data);

        if (!responseText) throw new Error('Gemini 응답이 비어 있어요.');

        const rawPlan = extractJsonLoose(responseText);
        const normalized = normalizeGeminiScenePlan(rawPlan, room, markdown, focusIndex, initialGlobalContext);
        if (selectedCharacterName) {
            normalized.visibleCharacters = [selectedCharacterName];
            normalized.charactersInScene = [selectedCharacterName];
            normalized.characterCount = 1;
        }
        return normalized;
    }

    function flattenPromptValue(value, depth = 0) {
        if (value === null || value === undefined) return '';
        if (depth > 4) return '';

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        if (Array.isArray(value)) {
            return value.map(item => flattenPromptValue(item, depth + 1)).filter(Boolean).join(', ');
        }

        if (typeof value === 'object') {
            const preferredKeys = [
                'tags', 'tagPrompt', 'prompt', 'caption', 'base_caption', 'baseCaption',
                'scenePrompt', 'baseScenePrompt', 'base_scene_prompt',
                'interactionPrompt', 'interaction_prompt', 'actionPrompt', 'action_prompt',
                'composition', 'background', 'mood', 'lighting', 'pose', 'expression', 'actions',
                'common', 'scene', 'camera', 'setting'
            ];

            const picked = [];
            preferredKeys.forEach(key => {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    const flattened = flattenPromptValue(value[key], depth + 1);
                    if (flattened) picked.push(flattened);
                }
            });

            if (picked.length) return picked.join(', ');

            return Object.values(value)
                .map(item => flattenPromptValue(item, depth + 1))
                .filter(Boolean)
                .join(', ');
        }

        return '';
    }

    function sanitizeScenePrompt(prompt) {
        const bannedExact = new Set([
            'masterpiece', 'best quality', 'amazing quality', 'very aesthetic', 'absurdres',
            'highres', 'ultra detailed', 'incredibly absurdres',
            'boyfriend and girlfriend'
        ]);

        const bannedSubjectExact = new Set([
            '1boy', '1girl', 'two boys', 'two girls', 'multiple boys', 'multiple girls',
            'full body viewer', 'viewer body', 'second person body', 'full viewer'
        ]);

        const flattened = flattenPromptValue(prompt);

        const cleaned = normalizeNaiWeightSyntax(flattened)
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .filter(tag => {
                const low = tag.toLowerCase();
                const bare = low.replace(/^[0-9]*\.?[0-9]+::/, '').replace(/::$/, '').trim();
                if (bare === '[object object]' || bare === 'object object') return false;
                if (bannedExact.has(low) || bannedExact.has(bare)) return false;
                if (bannedSubjectExact.has(bare)) return false;
                if (bare.startsWith('artist:')) return false;
                if (/^year\s*\d{4}$/.test(bare)) return false;
                if (/quality/.test(bare)) return false;
                return true;
            })
            .join(', ');
        return cleanScenePromptTags(cleaned);
    }


    function dedupeCommaTags(prompt) {
        const seen = new Set();
        return String(prompt || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .filter(tag => {
                const key = tag
                    .replace(/^\d+(?:\.\d+)?::\s*/, '')
                    .replace(/::\s*$/, '')
                    .trim()
                    .toLowerCase();
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .join(', ');
    }

    function cleanScenePromptTags(prompt) {
        const subjectTags = new Set([
            'boy', 'girl', 'young man', 'young woman', 'man', 'woman', 'person',
            'male', 'female', 'office worker', 'soldier', 'doctor', 'priest', 'demon',
            '1boy', '1girl', 'two boys', 'two girls', 'multiple boys', 'multiple girls',
            'full body viewer', 'viewer body', 'second person body', 'full viewer'
        ]);
        const cameraTags = new Set(['close-up', 'portrait', 'upper body', 'cowboy shot', 'medium shot', 'full body']);
        const viewTags = new Set(['front view', 'three-quarter view', 'from side', 'profile', 'dynamic angle', 'pov', 'from viewer perspective']);
        const povViewTags = new Set(['pov', 'from viewer perspective']);
        const gazeTags = new Set(['looking at viewer', 'eye contact', 'looking away']);
        let usedCamera = false;
        let usedGaze = false;
        let viewIndex = -1;
        let usedPovView = false;
        const keptTags = [];

        String(prompt || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .forEach(tag => {
                const bare = tag
                    .replace(/^\d+(?:\.\d+)?::\s*/, '')
                    .replace(/::\s*$/, '')
                    .trim()
                    .toLowerCase();

                if (!bare) return;
                if (subjectTags.has(bare)) return;
                if (bare === 'tense atmosphere' || bare === 'cold atmosphere') {
                    // keep atmosphere tags if present, but dedupe later
                    keptTags.push(tag);
                    return;
                }

                if (cameraTags.has(bare)) {
                    if (usedCamera) return;
                    usedCamera = true;
                    keptTags.push(tag);
                    return;
                }

                if (viewTags.has(bare)) {
                    const isPovView = povViewTags.has(bare);
                    if (viewIndex < 0) {
                        viewIndex = keptTags.length;
                        usedPovView = isPovView;
                        keptTags.push(tag);
                        return;
                    }
                    // POV 시점이 있으면 front/profile/from side보다 우선 보존한다.
                    if (!usedPovView && isPovView) {
                        keptTags[viewIndex] = tag;
                        usedPovView = true;
                    }
                    return;
                }

                if (gazeTags.has(bare)) {
                    if (usedGaze) return;
                    usedGaze = true;
                    keptTags.push(tag);
                    return;
                }

                keptTags.push(tag);
            });

        return dedupeCommaTags(keptTags.join(', '));
    }

    function limitCommaTags(prompt, maxCount) {
        const n = Number(maxCount);
        if (!Number.isFinite(n) || n <= 0) return dedupeCommaTags(prompt);
        return dedupeCommaTags(prompt).split(',').map(t => t.trim()).filter(Boolean).slice(0, n).join(', ');
    }

    function extractScenePromptCandidate(plan) {
        const candidates = [
            plan?.scenePrompt,
            plan?.scene_prompt,
            plan?.baseScenePrompt,
            plan?.base_scene_prompt,
            plan?.interactionPrompt,
            plan?.interaction_prompt,
            plan?.positivePrompt,
            plan?.prompt,
            plan?.tags,
            plan?.tagPrompt
        ];

        for (const candidate of candidates) {
            const normalized = sanitizeScenePrompt(candidate || '');
            if (normalized) return normalized;
        }
        return '';
    }

    function buildMinimalScenePromptFallback(text, characterCount) {
        const source = String(text || '').toLowerCase();
        const tags = [];
        tags.push('solo');

        if (/look|stare|gaze|watch/.test(source)) tags.push('looking at viewer', 'eye contact');
        if (/hug|embrace|hold|grasp|touch|stroke|caress/.test(source)) tags.push('reaching out');
        if (/feed|spoon|eat|meal|soup/.test(source)) tags.push('feeding', 'holding spoon');
        if (/cry|tear|sob/.test(source)) tags.push('crying', 'tear-stained face');
        if (/smile|laugh/.test(source)) tags.push('smile');
        if (/worried|anxious|concern/.test(source)) tags.push('worried expression');
        if (/bed|bedroom/.test(source)) tags.push('bedroom', 'indoors');
        else if (/room|inside|indoors/.test(source)) tags.push('indoors');
        if (/night|dark/.test(source)) tags.push('dim lighting');
        else tags.push('soft lighting');
        tags.push('close-up', 'upper body', 'emotional atmosphere');

        return buildCommaPrompt(tags);
    }

    async function repairScenePromptWithGemini(targetBubble, markdown, parsedPlan) {
        const global = getGlobalSettings();
        const geminiRequest = getGeminiGenerateContentRequestConfig(global, { silent: true });
        if (!geminiRequest) return '';

        const url = geminiRequest.url;
        const paragraphs = getParagraphs(markdown);
        const context = collectContextForBubble(targetBubble);

        const payload = {
            contents: [
                {
                    role: 'user',
                    parts: [{
                        text: `scenePrompt가 비어 있습니다. 아래 정보를 기반으로 장면 태그(scenePrompt)만 복구해 주세요.

[최근 대화 맥락]
${JSON.stringify(context, null, 2)}

[대상 AI 답변 문단 목록]
${JSON.stringify(paragraphs, null, 2)}

[이미 결정된 계획]
${JSON.stringify(parsedPlan, null, 2)}

[규칙]
- JSON만 출력
- 출력 형식: {"scenePrompt":"tag1, tag2, tag3"}
- 이름/고유명사/머리색/눈색/의상/체형 태그 금지
- scenePrompt는 절대 비우지 말 것`
                    }]
                }
            ],
            generationConfig: buildGeminiGenerationConfig(geminiRequest.model, {
                temperature: 0.2,
                topP: 0.8,
                responseMimeType: 'application/json'
            })
        };

        try {
            const data = await requestGeminiGenerateContent(geminiRequest, payload);
            const text = (data.candidates || [])
                .flatMap(candidate => candidate.content?.parts || [])
                .map(part => part.text || '')
                .join('\n')
                .trim();
            if (!text) return '';
            const repaired = extractJsonLoose(text);
            return extractScenePromptCandidate(repaired);
        } catch (err) {
            console.warn('[Crack Scene Painter] scenePrompt repair failed:', err);
            return '';
        }
    }

    function getPlanVisibleNames(plan) {
        const list = Array.isArray(plan.visibleCharacters) ? plan.visibleCharacters : (
            Array.isArray(plan.charactersInScene) ? plan.charactersInScene : []
        );
        return list.map(name => String(name || '').trim()).filter(Boolean);
    }

    function extractBaseScenePromptCandidate(plan) {
        return sanitizeScenePrompt(
            plan?.baseScenePrompt || plan?.base_scene_prompt || plan?.base || plan?.scene || plan?.scenePrompt || buildCommaPrompt([plan?.mood, plan?.composition]) || plan?.positivePrompt || plan?.prompt || ''
        );
    }

    function extractInteractionPromptCandidate(plan) {
        return sanitizeScenePrompt(
            plan?.interactionPrompt || plan?.interaction_prompt || plan?.interaction || plan?.actions || plan?.actionPrompt || plan?.action_prompt || ''
        );
    }

    function detectCharacterSubject(tags) {
        const low = String(tags || '').toLowerCase();
        if (/(^|,\s*)(1boy|boy|male|man|bishounen)(\s*,|$)/.test(low)) return 'boy';
        if (/(^|,\s*)(1girl|girl|female|woman)(\s*,|$)/.test(low)) return 'girl';
        return 'other';
    }

    function stripSubjectCountTags(tags) {
        return String(tags || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .map(tag => {
                const low = tag.toLowerCase();
                if (low === '1boy' || low === '2boys' || low === '3boys' || low === '4boys' || low === '5boys' || low === '6+boys') return 'boy';
                if (low === '1girl' || low === '2girls' || low === '3girls' || low === '4girls' || low === '5girls' || low === '6+girls') return 'girl';
                if (low === '1other' || low === '2others' || low === '3others') return 'other';
                if (low === 'solo' || low === 'multiple people' || low === '2people' || low === '3people') return '';
                return tag;
            })
            .filter(Boolean)
            .join(', ');
    }

    function makeDefaultCenter(index, total) {
        if (total <= 1) return { x: 0.5, y: 0.5 };
        const safeTotal = Math.max(2, Math.min(total || 2, 6));
        const x = 0.2 + (0.6 * index / Math.max(1, safeTotal - 1));
        return { x: Number(x.toFixed(3)), y: 0.5 };
    }

    function buildSubjectCountTag(selectedCharacters) {
        const subjects = selectedCharacters.map(char => detectCharacterSubject(char.tags));
        const boyCount = subjects.filter(x => x === 'boy').length;
        const girlCount = subjects.filter(x => x === 'girl').length;
        const otherCount = subjects.filter(x => x === 'other').length;
        const parts = [];

        if (boyCount === 1) parts.push('1boy');
        else if (boyCount > 1) parts.push(`${boyCount}boys`);

        if (girlCount === 1) parts.push('1girl');
        else if (girlCount > 1) parts.push(`${girlCount}girls`);

        if (otherCount === 1) parts.push('1other');
        else if (otherCount > 1) parts.push(`${otherCount}others`);

        if (!parts.length) return selectedCharacters.length <= 1 ? 'solo' : 'multiple people';
        return parts.join(', ');
    }

    function selectCharactersForPlan(room, plan) {
        const characters = (room.characters || []).filter(hasCharacterSlotContent);
        if (!characters.length) return [];

        const visibleNames = getPlanVisibleNames(plan).map(name => name.toLowerCase());
        let selected = [];

        if (visibleNames.length) {
            selected = characters.filter(c => {
                const cname = String(c.name || '').trim().toLowerCase();
                return cname && visibleNames.some(n => n === cname || n.includes(cname) || cname.includes(n));
            });
        }

        const count = Math.max(0, Math.min(Number(plan.characterCount || visibleNames.length || 0), characters.length));

        // visibleCharacters가 없는데 캐릭터 슬롯이 여러 개면 임의로 앞쪽 캐릭터를 끌어오지 않습니다.
        if (!selected.length && !visibleNames.length) {
            if (characters.length === 1) selected = characters.slice(0, 1);
            else selected = [];
        }

        if (visibleNames.length && selected.length > 6) {
            selected = selected.slice(0, 6);
        }

        return selected.slice(0, 1);
    }

    function buildCharacterPromptState(room, plan) {
        const selectedCharacters = selectCharactersForPlan(room, plan);
        const subjectCount = buildSubjectCountTag(selectedCharacters);

        const charPrompts = selectedCharacters.map((char, index) => {
            const prompt = normalizeNaiWeightSyntax(normalizePrompt(stripSubjectCountTags(getCharacterPromptForPlan(char, plan))));
            const uc = normalizeNaiWeightSyntax(normalizePrompt(char.uc || ''));
            return {
                name: getCharacterSlotName(char) || `Character ${index + 1}`,
                prompt,
                uc,
                center: makeDefaultCenter(index, selectedCharacters.length),
                referenceEnabled: !!char.referenceEnabled,
                referenceType: normalizeReferenceType(char.referenceType || 'character'),
                referenceAssetId: char.referenceAssetId || '',
                referenceImageName: char.referenceImageName || '',
                referenceStrength: clampNumber(char.referenceStrength, -1, 1, 0.6),
                referenceFidelity: clampNumber(char.referenceFidelity, -1, 1, 0.8)
            };
        }).filter(char => char.prompt);

        return {
            selectedCharacters,
            subjectCount,
            charPrompts
        };
    }

    function serializeCharacterPromptsForTextarea(charPrompts) {
        return (charPrompts || []).map((char, index) => {
            return `# SLOT ${index + 1}\n${char.prompt || ''}\nUC: ${char.uc || ''}`;
        }).join('\n\n');
    }

    function parseCharacterPromptsFromTextarea(textValue, fallbackCharPrompts) {
        const raw = String(textValue || '').trim();
        if (!raw) return [];

        const blocks = raw.split(/\n\s*\n/g).map(block => block.trim()).filter(Boolean);
        const result = [];

        blocks.forEach((block, index) => {
            const fallback = (fallbackCharPrompts || [])[index] || {};
            const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
            let name = fallback.name || `Character ${index + 1}`;
            let promptLines = [];
            let uc = fallback.uc || '';

            lines.forEach(line => {
                if (line.startsWith('#')) {
                    const header = line.replace(/^#+\s*/, '');
                    const cleanedHeader = header.replace(/^\d+\.\s*/, '').trim();
                    if (!/^SLOT\s+\d+$/i.test(cleanedHeader) && cleanedHeader) {
                        name = cleanedHeader;
                    }
                } else if (/^UC\s*:/i.test(line)) {
                    uc = line.replace(/^UC\s*:/i, '').trim();
                } else {
                    promptLines.push(line);
                }
            });

            result.push({
                name,
                prompt: normalizeNaiWeightSyntax(normalizePrompt(promptLines.join(', '))),
                uc: normalizeNaiWeightSyntax(normalizePrompt(uc)),
                center: fallback.center || makeDefaultCenter(index, blocks.length || 1),
                referenceEnabled: !!fallback.referenceEnabled,
                referenceType: normalizeReferenceType(fallback.referenceType || 'character'),
                referenceAssetId: fallback.referenceAssetId || '',
                referenceImageName: fallback.referenceImageName || '',
                referenceStrength: clampNumber(fallback.referenceStrength, -1, 1, 0.6),
                referenceFidelity: clampNumber(fallback.referenceFidelity, -1, 1, 0.8)
            });
        });

        return result;
    }

    function inferVisibleCharactersFromText(room, textValue) {
        return findCharacterNamesInText(room, textValue).slice(0, 6);
    }

    function getCanonicalCharacterName(room, nameValue) {
        const raw = String(nameValue || '').trim();
        if (!raw || raw === '[object Object]') return '';

        const low = raw.toLowerCase();
        const characters = (room.characters || []).filter(hasCharacterSlotContent);

        const exact = characters.find(c => String(c.name || '').trim().toLowerCase() === low);
        if (exact?.name) return String(exact.name).trim();

        const fuzzy = characters.find(c => {
            const cname = String(c.name || '').trim().toLowerCase();
            return cname && (low.includes(cname) || cname.includes(low));
        });
        return fuzzy?.name ? String(fuzzy.name).trim() : '';
    }

    function normalizeVisibleCharacters(plan, room, markdown, insertAfterParagraph) {
        const fromPlan = Array.isArray(plan.visibleCharacters) ? plan.visibleCharacters : (
            Array.isArray(plan.charactersInScene) ? plan.charactersInScene : []
        );

        const sceneWindowText = getSceneWindowText(markdown, insertAfterParagraph, 1);
        const namesInSceneWindow = inferVisibleCharactersFromText(room, sceneWindowText);
        const canonicalFromPlan = fromPlan
            .map(name => getCanonicalCharacterName(room, name))
            .filter(Boolean);

        let visible = Array.from(new Set(canonicalFromPlan));

        // Gemini가 전체 답변에 나온 캐릭터를 과하게 넣는 경우를 막기 위해,
        // 삽입 문단 주변에 실제 이름이 잡히면 그 주변 문단 기준으로 한 번 더 거릅니다.
        if (namesInSceneWindow.length) {
            const sceneSet = new Set(namesInSceneWindow.map(name => name.toLowerCase()));
            visible = visible.filter(name => sceneSet.has(name.toLowerCase()));

            if (!visible.length) {
                visible = namesInSceneWindow;
            }
        }

        // Gemini가 비웠을 때만 삽입 문단 주변 이름으로 보조 추론합니다.
        if (!visible.length) {
            visible = namesInSceneWindow;
        }

        // 캐릭터 슬롯이 1개뿐인 방에서만 안전하게 단일 캐릭터 fallback을 허용합니다.
        const roomCharacters = (room.characters || []).filter(hasCharacterSlotContent);
        if (!visible.length && roomCharacters.length === 1 && roomCharacters[0].name) {
            visible = [String(roomCharacters[0].name).trim()];
        }

        // 현재 안정형은 한 장면의 중심 캐릭터 1명만 사용합니다.
        return Array.from(new Set(visible)).slice(0, 1);
    }

    async function generateScenePlanWithGemini(targetBubble, markdown, options = {}) {
        const global = getGlobalSettings();
        const room = getRoomSettings();
        const sceneCount = options.sceneCount || Number(global.multiSceneCount || 1);

        const geminiRequest = getGeminiGenerateContentRequestConfig(global);
        const userPrompt = buildGeminiUserPrompt({ targetBubble, markdown, room, paragraphRange: options.paragraphRange });

        const systemInstruction = getEffectiveGeminiSystemInstruction(global);

        let finalUserPrompt = userPrompt;

        // 다중 장면 요청 시 유저 메시지 끝에 배열 지시 추가 (시스템보다 더 잘 따름)
        if (sceneCount > 1) {
            finalUserPrompt += `

[MULTI-SCENE REQUEST: ${sceneCount} scenes]
You MUST return a JSON ARRAY with exactly ${sceneCount} objects. Each object is a separate scene from different parts of the text.
- Use different insertAfterParagraph values for each scene (they must NOT be the same number)
- Each scene should depict a different moment or situation
- Format: [{ "sceneTitle": "...", "insertAfterParagraph": 0, ... }, { "sceneTitle": "...", "insertAfterParagraph": 3, ... }]
- Do NOT return a single object. Return an ARRAY of ${sceneCount} objects.`;
        }

        const payload = {
            systemInstruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: finalUserPrompt }] }],
            generationConfig: buildGeminiGenerationConfig(geminiRequest.model, {
                temperature: sceneCount > 1 ? 0.5 : 0.2,
                topP: 0.8,
                responseMimeType: 'application/json'
            })
        };

        const data = await requestGeminiGenerateContent(geminiRequest, payload);
        const responseText = extractTextFromGeminiResponseData(data);
        if (!responseText) throw new Error('Gemini 응답이 비어 있어요.');

        const rawParsed = extractJsonLoose(responseText);

        // 배열이면 다중 장면, 객체면 단일 plan으로 처리
        let rawPlans;
        if (Array.isArray(rawParsed)) {
            rawPlans = rawParsed.slice(0, sceneCount);
        } else {
            // 객체 하나만 왔을 때: sceneCount > 1이면 경고 후 1개만
            if (sceneCount > 1) {
                console.warn('[Crack Scene Painter] 다중 장면 요청했는데 AI가 객체 1개만 반환했어요. 1장면만 생성해요.');
            }
            rawPlans = [rawParsed];
        }

        // insertAfterParagraph 중복 제거 (같은 인덱스면 +1씩 밀어냄)
        const usedIndexes = new Set();
        rawPlans.forEach(raw => {
            let idx = Number(raw?.insertAfterParagraph ?? 0);
            while (usedIndexes.has(idx)) idx++;
            raw.insertAfterParagraph = idx;
            usedIndexes.add(idx);
        });

        const plans = rawPlans.map(raw => {
            const normalized = normalizeGeminiScenePlan(raw, room, markdown);
            if (!normalized.scenePrompt) {
                const fallback = sanitizeScenePrompt(buildMinimalScenePromptFallback(cleanMarkdownText(markdown), 1));
                normalized.baseScenePrompt = fallback;
                normalized.interactionPrompt = '';
                normalized.scenePrompt = fallback;
            }
            return normalized;
        });

        return sceneCount === 1 ? plans[0] : plans;
    }

    function removeVisibleNamesFromScenePrompt(prompt, visibleCharacters) {
        let output = String(prompt || '');
        (visibleCharacters || []).forEach(name => {
            const raw = String(name || '').trim();
            if (!raw) return;
            const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            output = output.replace(new RegExp(escaped, 'gi'), '');
        });
        return output
            .replace(/\s*,\s*,+/g, ', ')
            .replace(/^,\s*|,\s*$/g, '')
            .trim();
    }

    function buildFinalPromptFromPlan(plan, room) {
        const global = getGlobalSettings();
        const fixedPositive = normalizeNaiWeightSyntax(normalizePrompt(global.basePositive || ''));
        const fixedNegative = normalizeNaiWeightSyntax(normalizePrompt(global.baseNegative || ''));
        const charState = buildCharacterPromptState(room, plan);
        const temporaryOutfitPrompt = normalizeNaiWeightSyntax(normalizePrompt(plan?.temporaryOutfitPrompt || ''));
        const globalContextPrompt = buildGlobalContextPromptTags(plan.globalContext);
        const scenePromptSource = plan.scenePrompt || buildCommaPrompt([plan.composition, plan.interactionPrompt, plan.baseScenePrompt, globalContextPrompt]);
        const scenePrompt = cleanScenePromptTags(normalizeNaiWeightSyntax(normalizePrompt(removeVisibleNamesFromScenePrompt(stripForbiddenSceneTags(scenePromptSource), plan.visibleCharacters || plan.charactersInScene || []))));
        const subjectCount = charState.subjectCount || 'solo';

        const mergedCharacterPrompt = buildCommaPrompt((charState.charPrompts || []).map(char => stripSubjectCountTags(char.prompt || '')));
        const mergedCharacterUc = buildCommaPrompt((charState.charPrompts || []).map(char => char.uc || ''));

        const basePrompt = buildCommaPrompt([fixedPositive, subjectCount, scenePrompt]);
        const baseNegative = fixedNegative;
        const finalPrompt = buildCommaPrompt([basePrompt, mergedCharacterPrompt]);
        const finalNegative = buildCommaPrompt([baseNegative, mergedCharacterUc]);

        return {
            fixedPositive,
            fixedNegative,
            subjectCount,
            basePrompt,
            baseNegative,
            characterTags: serializeCharacterPromptsForTextarea(charState.charPrompts),
            charPrompts: charState.charPrompts,
            scenePrompt,
            temporaryOutfitPrompt,
            useTemporaryOutfit: !!plan?.useTemporaryOutfit,
            finalPrompt,
            finalNegative
        };
    }

    function normalizeNaiModel(model) {
        const raw = String(model || '').trim();

        const aliases = {
            'NovelAI Diffusion V4.5 Full': 'nai-diffusion-4-5-full',
            'NovelAI Diffusion V4.5 Curated': 'nai-diffusion-4-5-curated',
            'V4.5 Full': 'nai-diffusion-4-5-full',
            'V4.5 Curated': 'nai-diffusion-4-5-curated',
            'nai diffusion 4.5 full': 'nai-diffusion-4-5-full',
            'nai diffusion 4.5 curated': 'nai-diffusion-4-5-curated'
        };

        return aliases[raw] || raw || 'nai-diffusion-4-5-full';
    }

    // 1인 장면 전용: Base Prompt와 Character 1 Prompt를 분리해 NovelAI V4.5 char_captions 구조로 보냅니다.
    function buildNaiPayload({ basePrompt, baseNegative, finalPrompt, finalNegative, charPrompts, preciseReference, settings, model }) {
        const seedNumber = settings.seed !== '' && settings.seed !== null && settings.seed !== undefined
            ? Number(settings.seed)
            : Math.floor(Math.random() * 4294967295);

        const cleanBasePrompt = normalizeNaiWeightSyntax(normalizePrompt(basePrompt || finalPrompt));
        const cleanBaseNegative = normalizeNaiWeightSyntax(normalizePrompt(baseNegative || ''));
        const cleanPresetMergedNegative = mergeNaiUcPresetWithNegative(cleanBaseNegative, settings, model);
        const cleanFinalPrompt = normalizeNaiWeightSyntax(normalizePrompt(finalPrompt || ''));
        const cleanFinalNegative = normalizeNaiWeightSyntax(normalizePrompt(finalNegative || ''));

        const normalizedChars = (Array.isArray(charPrompts) ? charPrompts : []).map((char, index, arr) => {
            return {
                name: getCharacterSlotName(char) || `Character ${index + 1}`,
                prompt: normalizeNaiWeightSyntax(normalizePrompt(stripSubjectCountTags(char.prompt || ''))),
                uc: normalizeNaiWeightSyntax(normalizePrompt(char.uc || '')),
                center: char.center || makeDefaultCenter(index, arr.length || 1)
            };
        }).filter(char => char.prompt);

        const v4CharCaptions = normalizedChars.map(char => ({
            char_caption: char.prompt,
            centers: [char.center]
        }));

        const v4CharNegativeCaptions = normalizedChars.map(char => ({
            char_caption: char.uc || '',
            centers: [char.center]
        }));

        const preciseReferenceFields = preciseReference ? {
            director_reference_images: [preciseReference.base64],
            director_reference_descriptions: [{
                caption: {
                    base_caption: getReferenceTypeCaption(preciseReference.type),
                    char_captions: []
                },
                legacy_uc: false
            }],
            director_reference_strength_values: [preciseReference.strength],
            director_reference_secondary_strength_values: [1 - preciseReference.fidelity],
            director_reference_information_extracted: [1]
        } : {};

        return {
            input: cleanBasePrompt,
            model: normalizeNaiModel(model),
            action: 'generate',
            parameters: {
                params_version: 3,

                width: Number(settings.width || 832),
                height: Number(settings.height || 1216),
                scale: Number(settings.scale || 6.5),
                cfg_rescale: Number(settings.guidanceRescale ?? 0.3),
                sampler: settings.sampler || 'k_euler_ancestral',
                steps: Number(settings.steps || 28),
                n_samples: 1,
                seed: seedNumber,
                noise_schedule: settings.noiseSchedule || 'karras',

                negative_prompt: cleanPresetMergedNegative,
                uc: cleanPresetMergedNegative,
                ucPreset: Number(settings.ucPreset || 0),
                qualityToggle: false,

                sm: false,
                sm_dyn: false,
                dynamic_thresholding: false,

                controlnet_strength: 1,
                legacy: false,
                legacy_v3_extend: false,
                add_original_image: false,
                uncond_scale: 1,

                deliberate_euler_ancestral_bug: false,
                prefer_brownian: true,

                reference_information_extracted_multiple: [],
                reference_strength_multiple: [],

                v4_prompt: {
                    caption: {
                        base_caption: cleanBasePrompt,
                        char_captions: v4CharCaptions
                    },
                    use_coords: false,
                    use_order: true,
                    legacy_uc: false
                },

                v4_negative_prompt: {
                    caption: {
                        base_caption: cleanPresetMergedNegative,
                        char_captions: v4CharNegativeCaptions
                    },
                    use_coords: false,
                    use_order: true,
                    legacy_uc: false
                },

                ...preciseReferenceFields
            }
        };
    }

    async function generateImageWithNai({ basePrompt, baseNegative, finalPrompt, finalNegative, charPrompts, settings }) {
        const global = getGlobalSettings();
        if (!global.naiApiKey) {
            throw new Error('NAI API Key / Token이 비어 있어요.');
        }

        const model = global.naiModel || 'nai-diffusion-4-5-full';

        const preciseReference = await preparePreciseReference(charPrompts);

        const payload = buildNaiPayload({
            basePrompt,
            baseNegative,
            finalPrompt,
            finalNegative,
            charPrompts,
            preciseReference,
            settings,
            model
        });

        console.log('[Crack Scene Painter] base prompt raw:', basePrompt || '');
        console.log('[Crack Scene Painter] final negative raw:', finalNegative || '');
        console.log('[Crack Scene Painter] payload negative mirrors:', {
            negative_prompt: payload.parameters.negative_prompt,
            uc: payload.parameters.uc,
            v4_negative_prompt: payload.parameters.v4_negative_prompt?.caption?.base_caption,
            char_negative_slots: payload.parameters.v4_negative_prompt?.caption?.char_captions
        });
        console.log('[Crack Scene Painter] payload char slots:', payload.parameters.v4_prompt?.caption?.char_captions);
        console.log('[Crack Scene Painter] precise reference:', preciseReference ? {
            type: preciseReference.typeLabel,
            strength: preciseReference.strength,
            fidelity: preciseReference.fidelity,
            extraAnlas: preciseReference.extraAnlas
        } : null);
        console.log('[Crack Scene Painter] NAI payload preview (precise-reference-v4.7):', payload);

        const arrayBuffer = await gmRequestJson({
            method: 'POST',
            url: 'https://image.novelai.net/ai/generate-image',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + global.naiApiKey
            },
            data: payload,
            responseType: 'arraybuffer'
        });

        const bytes = new Uint8Array(arrayBuffer);
        let extractedBlob = null;
        const signature = detectBinarySignature(bytes);

        if (signature === 'zip') {
            try {
                const unzipped = window.fflate.unzipSync(bytes);
                const firstImageEntry = Object.entries(unzipped).find(([name]) => /\.(png|jpg|jpeg|webp)$/i.test(name));
                if (firstImageEntry) {
                    const [, fileBytes] = firstImageEntry;
                    const lower = firstImageEntry[0].toLowerCase();
                    const mime = lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
                    extractedBlob = new Blob([fileBytes], { type: mime });
                } else {
                    const textEntry = Object.entries(unzipped).find(([name]) => /\.(txt|json|html)$/i.test(name));
                    if (textEntry) {
                        const [, fileBytes] = textEntry;
                        const message = extractErrorMessageFromBytes(fileBytes) || 'NAI가 이미지 파일을 돌려주지 않았어요.';
                        throw new Error(message);
                    }
                }
            } catch (zipErr) {
                console.warn('[Crack Scene Painter] unzip failed, trying raw image fallback', zipErr);
                if (!extractedBlob && zipErr instanceof Error && zipErr.message) throw zipErr;
            }
        } else if (signature === 'png') {
            extractedBlob = new Blob([bytes], { type: 'image/png' });
        } else if (signature === 'jpeg') {
            extractedBlob = new Blob([bytes], { type: 'image/jpeg' });
        } else if (signature === 'webp') {
            extractedBlob = new Blob([bytes], { type: 'image/webp' });
        } else if (signature === 'json' || signature === 'html' || signature === 'unknown' || signature === 'empty') {
            const message = extractErrorMessageFromBytes(bytes) || 'NAI가 이미지 대신 오류 응답을 돌려줬어요.';
            throw new Error(message);
        }

        if (!extractedBlob) {
            throw new Error('NAI 응답에서 유효한 이미지 데이터를 찾지 못했어요.');
        }

        return await blobToDataUrl(extractedBlob);
    }

    async function insertFinalSceneImage({ markdown, imageUrl, plan, mode, basePrompt, baseNegative, finalPrompt, finalNegative, charPrompts, referenceInfo, naiSettings, keepExisting, sceneIndex }) {
        // 다중 장면 시 각 장면을 별도 키로 저장 (sceneIndex > 0이면 키에 인덱스 붙임)
        const baseKey = getMessageKey(markdown);
        const messageKey = (sceneIndex && sceneIndex > 0) ? `${baseKey}_s${sceneIndex}` : baseKey;
        // insertAfterParagraph 범위 초과 시 마지막 문단으로 clamp
        const _blocks = getInsertableContentBlocks(markdown);
        if (_blocks.length > 0) {
            plan = Object.assign({}, plan, {
                insertAfterParagraph: Math.min(Number(plan.insertAfterParagraph) || 0, _blocks.length - 1)
            });
        }
        const result = insertSceneImageIntoMarkdown(markdown, imageUrl, plan.insertAfterParagraph, {
            mode,
            messageKey,
            keepExisting: !!keepExisting,
            captionHtml: buildCaption(plan, plan.insertAfterParagraph, mode, {
                basePrompt,
                baseNegative,
                finalPrompt,
                charPrompts,
                referenceInfo,
                naiSettings
            }, messageKey)
        });

        if (!result.ok) throw new Error('AI 답변의 문단을 찾지 못했어요.');

        const record = {
            paragraphIndex: result.index,
            mode,
            plan,
            basePrompt: basePrompt || '',
            baseNegative: baseNegative || '',
            finalPrompt,
            finalNegative: finalNegative || '',
            charPrompts: charPrompts || [],
            referenceInfo: referenceInfo || getReferenceSummary(charPrompts || []),
            naiSettings: naiSettings || null,
            createdAt: Date.now()
        };

        const currentHistoryItem = await appendSceneHistoryImage(messageKey, record, imageUrl);
        if (currentHistoryItem && getGlobalSettings().folderSaveEnabled && mode === 'nai' && String(imageUrl || '').startsWith('data:')) {
            try {
                currentHistoryItem.folderFileName = await saveImageToChosenFolder(imageUrl, plan);
                syncCurrentImageFieldsFromHistory(record);
            } catch (folderErr) {
                console.warn('[Crack Scene Painter] auto folder save failed:', folderErr);
            }
        }

        const nextRecords = getSceneRecords();
        nextRecords[messageKey] = record;
        saveSceneRecords(nextRecords);
        refreshImageHistoryControls(messageKey, result.box, record);
        markSceneButtons(messageKey, true);
        showToast(`🖼️ 문단 ${result.index + 1} 뒤에 삽입 완료`);
    }

    async function handleImageAction(event) {
        const target = event.target;
        if (!target || !target.closest) return;

        const infoBtn = target.closest('.csp-image-info-btn');
        const editBtn = target.closest('.csp-image-edit-btn');
        const downloadBtn = target.closest('.csp-image-download-btn');
        const deleteBtn = target.closest('.csp-image-delete-btn');
        const folderSaveBtn = target.closest('.csp-image-folder-save-btn');
        const rerollBtn = target.closest('.csp-image-reroll-btn');
        const historyPrevBtn = target.closest('.csp-image-history-prev');
        const historyNextBtn = target.closest('.csp-image-history-next');
        const clickedImage = target.closest('.csp-generated-scene-image img');
        const actionBtn = infoBtn || editBtn || downloadBtn || deleteBtn || folderSaveBtn || rerollBtn || historyPrevBtn || historyNextBtn;

        if (!actionBtn && clickedImage) {
            event.preventDefault();
            event.stopPropagation();
            const box = clickedImage.closest('.csp-generated-scene-image');
            const key = box?.getAttribute('data-message-key') || '';
            const record = key ? getSceneRecords()[key] : null;
            openImageLightbox(clickedImage.src, record?.plan?.sceneTitle || clickedImage.alt || 'scene-image');
            return;
        }

        if (!actionBtn) return;

        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();

        const messageKey = actionBtn.getAttribute('data-message-key') || '';
        const records = getSceneRecords();
        const record = records[messageKey];
        const box = actionBtn.closest('.csp-generated-scene-image');
        const img = box?.querySelector('img');

        if (historyPrevBtn || historyNextBtn) {
            if (!record) return;
            normalizeSceneRecordHistory(record, messageKey);
            const delta = historyPrevBtn ? -1 : 1;
            const nextIndex = clampHistoryIndex(record) + delta;
            await setCurrentSceneHistoryIndex(messageKey, nextIndex, box);
            return;
        }

        if (infoBtn) {
            showImageInfoModal(messageKey);
            return;
        }

        if (editBtn) {
            if (record && isSceneHistoryFull(record)) {
                refreshImageActionState(messageKey, box, record);
                showToast(`⚠️ 리롤 기록은 최대 ${CSP_MAX_IMAGE_HISTORY}장이에요. 휴지통으로 이미지를 지우면 리롤 설정을 다시 열 수 있어요.`);
                return;
            }
            showImageRerollSettingsModal(messageKey, box, img);
            return;
        }

        if (downloadBtn) {
            let src = img?.src || '';
            if (!src && record) src = await getRecordImageSrc(record);
            if (!src) {
                showToast('⚠️ 다운로드할 이미지가 없어요.');
                return;
            }
            try {
                const a = document.createElement('a');
                a.href = src;
                a.download = `${sanitizeFileName(record?.plan?.sceneTitle || 'scene-image')}.png`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                showToast('⬇️ 다운로드를 시작했어요.');
            } catch (err) {
                console.error('[Crack Scene Painter] download failed:', err);
                showToast('⚠️ 다운로드 실패: ' + err.message);
            }
            return;
        }

        if (folderSaveBtn) {
            let src = img?.src || '';
            if (!src && record) src = await getRecordImageSrc(record);
            if (!src) {
                showToast('⚠️ 폴더에 저장할 이미지가 없어요.');
                return;
            }
            try {
                const filename = await saveImageToChosenFolder(src, record?.plan || {});
                showToast(`📁 폴더 저장 완료: ${filename}`);
            } catch (err) {
                console.error('[Crack Scene Painter] folder save failed:', err);
                showToast('⚠️ 폴더 저장 실패: ' + err.message);
            }
            return;
        }

        if (deleteBtn) {
            const result = await deleteCurrentSceneHistoryImage(messageKey, box);
            if (result?.removedAll) showToast('🗑️ 삽화를 삭제했어요. 설정은 유지했어요.');
            else showToast(`🗑️ 현재 이미지를 삭제했어요. 남은 이미지 ${result.remaining}장`);
            return;
        }

        if (rerollBtn) {
            if (!record || (!record.finalPrompt && !record.plan)) {
                showToast('⚠️ 리롤에 필요한 기록이 없어요.');
                return;
            }
            if (isSceneHistoryFull(record)) {
                refreshImageActionState(messageKey, box, record);
                showToast(`⚠️ 리롤 기록은 최대 ${CSP_MAX_IMAGE_HISTORY}장이에요. 휴지통으로 이미지를 지우면 다시 리롤할 수 있어요.`);
                return;
            }

            const oldText = rerollBtn.textContent;
            rerollBtn.disabled = true;
            rerollBtn.setAttribute('data-csp-loading', 'true');
            rerollBtn.textContent = '⏳';
            showToast('🎲 최신 설정으로 다시 생성 중...');

            try {
                const currentGlobal = getGlobalSettings();
                const currentRoom = getRoomSettings();
                const settings = Object.assign({}, getDefaultGlobalSettings().naiSettings, currentGlobal.naiSettings || {});

                let nextPromptState = {
                    basePrompt: record.basePrompt || '',
                    baseNegative: record.baseNegative || '',
                    finalPrompt: record.finalPrompt,
                    finalNegative: record.finalNegative || '',
                    charPrompts: record.charPrompts || []
                };

                if (record.plan) {
                    nextPromptState = buildFinalPromptFromPlan(record.plan, currentRoom);
                } else {
                    nextPromptState.basePrompt = normalizeNaiWeightSyntax(normalizePrompt(currentGlobal.basePositive || ''));
                    nextPromptState.baseNegative = normalizeNaiWeightSyntax(normalizePrompt(currentGlobal.baseNegative || ''));
                    nextPromptState.finalNegative = buildCommaPrompt([
                        nextPromptState.baseNegative,
                        buildCommaPrompt((currentRoom.characters || []).map(char => char.uc || ''))
                    ]);
                }

                console.log('[Crack Scene Painter] reroll negative:', nextPromptState.finalNegative);

                const nextImageUrl = await generateImageWithNai({
                    basePrompt: nextPromptState.basePrompt || '',
                    baseNegative: nextPromptState.baseNegative || '',
                    finalPrompt: nextPromptState.finalPrompt,
                    finalNegative: nextPromptState.finalNegative,
                    charPrompts: nextPromptState.charPrompts || [],
                    settings
                });

                if (img && nextImageUrl) img.src = nextImageUrl;

                const caption = box?.querySelector('.csp-generated-scene-caption');
                if (caption) {
                    caption.innerHTML = buildCaption(
                        record.plan || {},
                        Number.isFinite(record.paragraphIndex) ? record.paragraphIndex : (record.plan?.insertAfterParagraph || 0),
                        'nai',
                        {
                            basePrompt: nextPromptState.basePrompt || '',
                            baseNegative: nextPromptState.baseNegative || '',
                            finalPrompt: nextPromptState.finalPrompt,
                            charPrompts: nextPromptState.charPrompts || [],
                            referenceInfo: getReferenceSummary(nextPromptState.charPrompts || []),
                            naiSettings: settings
                        },
                        messageKey
                    );
                }

                const currentHistoryItem = await appendSceneHistoryImage(messageKey, record, nextImageUrl);

                record.mode = 'nai';
                record.basePrompt = nextPromptState.basePrompt || '';
                record.baseNegative = nextPromptState.baseNegative || '';
                record.finalPrompt = nextPromptState.finalPrompt;
                record.finalNegative = nextPromptState.finalNegative || '';
                record.charPrompts = nextPromptState.charPrompts || [];
                record.referenceInfo = getReferenceSummary(nextPromptState.charPrompts || []);
                record.naiSettings = settings;
                record.createdAt = Date.now();

                if (currentHistoryItem && getGlobalSettings().folderSaveEnabled && String(nextImageUrl || '').startsWith('data:')) {
                    try {
                        currentHistoryItem.folderFileName = await saveImageToChosenFolder(nextImageUrl, record.plan || {});
                        syncCurrentImageFieldsFromHistory(record);
                    } catch (folderErr) {
                        console.warn('[Crack Scene Painter] auto folder save failed:', folderErr);
                    }
                }

                records[messageKey] = record;
                saveSceneRecords(records);
                refreshImageHistoryControls(messageKey, box, record);
                showToast('🔄 리롤 완료');
            } catch (err) {
                console.error('[Crack Scene Painter] reroll failed:', err);
                showToast('⚠️ 리롤 실패: ' + err.message);
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.removeAttribute('data-csp-loading');
                rerollBtn.textContent = oldText;
            }
        }
    }

    function attachImageActionHandlers(box) {
        if (!box) return;
        box.querySelectorAll('.csp-image-action-btn').forEach(btn => {
            if (btn.dataset.cspActionBound === 'true') return;
            btn.dataset.cspActionBound = 'true';
            btn.addEventListener('click', handleImageAction, true);
        });
    }

    function renderCharacterSlotPreview(container, charPrompts) {
        if (!container) return;

        const list = Array.isArray(charPrompts) ? charPrompts : [];
        if (!list.length) {
            container.innerHTML = '<div class="csp-slot-preview-empty">선택된 Character Prompt 슬롯이 없어요.</div>';
            return;
        }

        container.innerHTML = `
            <div class="csp-slot-preview-wrap">
                ${list.map((char, index) => {
                    const title = `Character ${index + 1}`;
                    const prompt = escapeHtml(char.prompt || '');
                    const uc = escapeHtml(char.uc || '') || '<span class="csp-slot-preview-empty">(empty)</span>';
                    const ref = hasUsableReference(char)
                        ? `<div class="csp-slot-preview-label">PRECISE REFERENCE</div><div class="csp-slot-preview-body">${escapeHtml(getReferenceTypeLabel(char.referenceType))} · strength ${escapeHtml(String(char.referenceStrength ?? 0.6))} · fidelity ${escapeHtml(String(char.referenceFidelity ?? 0.8))} · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas</div>`
                        : '';
                    return `
                        <div class="csp-slot-preview-card">
                            <div class="csp-slot-preview-title">${title}</div>
                            <div class="csp-slot-preview-label">PROMPT</div>
                            <div class="csp-slot-preview-body">${prompt}</div>
                            <div class="csp-slot-preview-label">UC</div>
                            <div class="csp-slot-preview-body">${uc}</div>
                            ${ref}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderAnlasInlineUi(costEl, balanceEl, charPrompts, anlasBalance = null, settings = {}) {
        const cost = estimateTotalAnlasCost(settings, charPrompts || []);
        const referenceCost = getReferenceExtraAnlas(charPrompts || []);
        const baseCost = estimateBaseImageAnlasCost(settings);

        if (costEl) {
            costEl.textContent = cost > 0 ? `-${cost}` : '';
            costEl.hidden = cost <= 0;
            costEl.title = cost > 0
                ? `예상 소모: -${cost} Anlas (기본 ${baseCost} + Reference ${referenceCost})`
                : '';
            costEl.classList.toggle('is-active', cost > 0);
        }

        if (balanceEl) {
            if (anlasBalance && Number.isFinite(Number(anlasBalance.total))) {
                balanceEl.textContent = `${Number(anlasBalance.total).toLocaleString()} Anlas`;
                balanceEl.title = '클릭해서 잔여 Anlas를 다시 조회해.';
            } else {
                balanceEl.textContent = '? Anlas';
                balanceEl.title = '클릭해서 잔여 Anlas를 조회해.';
            }
        }
    }

    function makeSectionsCollapsible(root, openTitlePatterns = []) {
        if (!root) return;
        const patterns = (openTitlePatterns || []).map(item => item instanceof RegExp ? item : new RegExp(String(item), 'i'));
        root.querySelectorAll('.csp-section').forEach((section, index) => {
            if (section.dataset.cspCollapsible === 'true') return;
            const titleEl = section.querySelector(':scope > .csp-section-title');
            if (!titleEl) return;

            const title = titleEl.textContent.trim();
            const body = document.createElement('div');
            body.className = 'csp-section-body';
            Array.from(section.childNodes).forEach(node => {
                if (node !== titleEl) body.appendChild(node);
            });

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'csp-section-toggle';
            button.innerHTML = `<span class="csp-section-arrow">▶</span><span>${escapeHtml(title)}</span>`;
            section.insertBefore(button, section.firstChild);
            section.appendChild(body);
            titleEl.remove();
            section.dataset.cspCollapsible = 'true';

            const shouldOpen = patterns.length
                ? patterns.some(pattern => pattern.test(title))
                : index === 0;

            const setOpen = (open) => {
                section.classList.toggle('is-open', open);
                body.hidden = !open;
                const arrow = button.querySelector('.csp-section-arrow');
                if (arrow) arrow.textContent = open ? '▼' : '▶';
            };

            button.addEventListener('click', () => setOpen(!section.classList.contains('is-open')));
            setOpen(shouldOpen);
        });
    }


    function showSceneRefineRequestModal(options = {}) {
        return new Promise(resolve => {
            const existing = document.getElementById('csp-scene-refine-modal');
            if (existing) existing.remove();

            const title = String(options.title || '재분석 요청');
            const description = String(options.description || '현재 선택 장면을 유지한 채, 추가 요청만 반영해서 장면 태그를 다시 다듬어.');
            const placeholder = String(options.placeholder || '예: 상반신 위주로, 정면 시선, 조금 더 다정한 표정, 책상보다 복도 느낌');
            const maxLength = Math.max(50, Number(options.maxLength || 200));
            const initialValue = String(options.initialValue || '').slice(0, maxLength);

            const overlay = document.createElement('div');
            overlay.id = 'csp-scene-refine-modal';
            overlay.className = 'csp-overlay';
            overlay.innerHTML = `
                <div class="csp-modal csp-scene-refine-modal" role="dialog" aria-modal="true" aria-labelledby="csp-scene-refine-title">
                    <h2 id="csp-scene-refine-title">✨ ${escapeHtml(title)}</h2>
                    <div class="csp-desc">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
                    <div class="csp-field">
                        <label>리롤 지시사항</label>
                        <textarea id="csp-scene-refine-text" class="csp-long" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(initialValue)}</textarea>
                    </div>
                    <div class="csp-mini-note">캐릭터나 장면 자체를 완전히 갈아엎기보다, 현재 장면을 기준으로 구도/표정/분위기/배경을 미세조정할 때 좋아.</div>
                    <div class="csp-actions">
                        <div class="csp-actions-left"><span id="csp-scene-refine-count" class="csp-mini-note">0 / ${maxLength}</span></div>
                        <div class="csp-actions-right">
                            <button class="csp-btn" id="csp-scene-refine-cancel" type="button">취소</button>
                            <button class="csp-btn csp-btn-primary" id="csp-scene-refine-confirm" type="button">확인</button>
                        </div>
                    </div>
                </div>
            `;

            const textarea = overlay.querySelector('#csp-scene-refine-text');
            const counter = overlay.querySelector('#csp-scene-refine-count');
            const confirmBtn = overlay.querySelector('#csp-scene-refine-confirm');
            const cancelBtn = overlay.querySelector('#csp-scene-refine-cancel');

            function updateState() {
                const value = String(textarea?.value || '');
                if (counter) counter.textContent = `${value.length} / ${maxLength}`;
                if (confirmBtn) confirmBtn.disabled = !value.trim();
            }

            function close(value = null) {
                overlay.remove();
                resolve(value);
            }

            textarea?.addEventListener('input', updateState);
            textarea?.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    const value = String(textarea?.value || '').trim();
                    if (value) close(value);
                }
            });

            confirmBtn?.addEventListener('click', () => {
                const value = String(textarea?.value || '').trim();
                if (!value) return;
                close(value);
            });
            cancelBtn?.addEventListener('click', () => close(null));
            overlay.addEventListener('mousedown', (e) => {
                if (e.target === overlay) close(null);
            });

            document.body.appendChild(overlay);
            updateState();
            setTimeout(() => textarea?.focus(), 30);
        });
    }

    function showScenePlanModal({ targetBubble, markdown, plan, sceneIndex = 0 }) {
        return new Promise((resolveModal) => {
        const existing = document.getElementById('csp-plan-modal');
        if (existing) existing.remove();

        const global = getGlobalSettings();
        const room = getRoomSettings();
        const settings = global.naiSettings || getDefaultGlobalSettings().naiSettings;
        const paragraphs = getParagraphs(markdown);
        let currentPlan = Object.assign({}, plan);
        let promptState = buildFinalPromptFromPlan(currentPlan, room);
        const selectedParagraphIndex = Number(currentPlan.insertAfterParagraph) || 0;
        const selectedCharacterName = (currentPlan.visibleCharacters || currentPlan.charactersInScene || [])[0] || '';

        const overlay = document.createElement('div');
        overlay.id = 'csp-plan-modal';
        overlay.className = 'csp-overlay';

        overlay.innerHTML = `
            <div class="csp-modal" role="dialog" aria-modal="true">
                <h2>🖼️ NAI 생성 전 확인</h2>
                <div class="csp-desc">
                    Gemini가 장면과 삽입 위치를 골랐어.<br>프롬프트 확인/수정 후 NAI로 생성해.
                </div>

                <div class="csp-tab-shell">
                    <div class="csp-tab-list" role="tablist" aria-label="NAI 생성 전 확인 탭">
                        <button class="csp-tab-btn" type="button" data-csp-tab="scene" role="tab" aria-selected="false">🎬 장면</button>
                        <button class="csp-tab-btn is-active" type="button" data-csp-tab="prompt" role="tab" aria-selected="true">✍️ 프롬프트</button>
                        <button class="csp-tab-btn" type="button" data-csp-tab="detail" role="tab" aria-selected="false">📋 상세</button>
                        <button class="csp-tab-btn" type="button" data-csp-tab="generation" role="tab" aria-selected="false">⚙️ 생성 설정</button>
                    </div>

                    <div class="csp-tab-panels">
                        <div class="csp-tab-panel" data-csp-tab-panel="scene" role="tabpanel">
                            <div class="csp-section">
                                <div class="csp-section-title">장면 선택 / 재분석</div>
                                <div class="csp-grid">
                                    <div class="csp-field">
                                        <label>기준 문단</label>
                                        <select id="csp-focus-paragraph">${buildParagraphSelectOptions(markdown, selectedParagraphIndex)}</select>
                                    </div>
                                    <div class="csp-field">
                                        <label>중심 캐릭터</label>
                                        <select id="csp-focus-character">${buildCharacterSelectOptions(room, selectedCharacterName)}</select>
                                    </div>
                                </div>
                                <div class="csp-field">
                                    <label>선택 문단 미리보기</label>
                                    <div id="csp-focus-preview" class="csp-paragraph-preview">${escapeHtml(getParagraphTextByIndex(markdown, selectedParagraphIndex) || '(문단 없음)')}</div>
                                </div>
                                <div class="csp-actions-left">
                                    <button class="csp-btn csp-btn-small" id="csp-reanalyze-paragraph" type="button">이 문단 기준으로 다시 분석</button>
                                </div>
                                <div class="csp-mini-note">처음엔 전체 답변에서 자동 추천.<br>문단 선택 시 선택 문단±1만 다시 분석해.</div>
                            </div>
                        </div>

                        <div class="csp-tab-panel is-active" data-csp-tab-panel="prompt" role="tabpanel">
                            <div class="csp-section">
                                <div class="csp-section-title">프롬프트</div>
                                <div class="csp-field">
                                    <label>Gemini 장면 태그 (scenePrompt)</label>
                                    <textarea id="csp-scene-prompt" class="csp-long">${escapeHtml(promptState.scenePrompt)}</textarea>
                                </div>
                                <div class="csp-field">
                                    <label class="csp-check-row">
                                        <input id="csp-use-temp-outfit" type="checkbox" ${promptState.useTemporaryOutfit ? 'checked' : ''}>
                                        로그 의상 사용
                                    </label>
                                    <textarea id="csp-temp-outfit-prompt" rows="2" placeholder="Gemini가 분석한 로그 기반 임시 의상 태그를 여기서 직접 수정할 수 있어.">${escapeHtml(promptState.temporaryOutfitPrompt || '')}</textarea>
                                    <div class="csp-mini-note" id="csp-temp-outfit-note">${escapeHtml(promptState.temporaryOutfitPrompt ? '체크하면 위 의상 태그가 캐릭터 슬롯 기본 의상 대신 사용돼.' : '(로그 기반 임시 의상 없음 — 직접 입력 후 체크해서 사용할 수 있어)')}</div>
                                </div>
                                <div class="csp-field">
                                    <label>최종 NAI 프롬프트</label>
                                    <textarea id="csp-final-prompt" class="csp-long">${escapeHtml(promptState.finalPrompt)}</textarea>
                                    <div class="csp-mini-note">자동으로 조립되지만, 필요하면 직접 수정해도 돼.</div>
                                </div>
                                <div class="csp-field">
                                    <div class="csp-label-row">
                                        <label>Negative / UC</label>
                                        <select id="csp-nai-uc-preset" title="NovelAI Undesired Content Preset" style="max-width: 180px;">
                                            ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                                        </select>
                                    </div>
                                    <textarea id="csp-final-negative" class="csp-long">${escapeHtml(promptState.finalNegative || '')}</textarea>
                                    <div class="csp-mini-note">이 값이 NovelAI의 uc(undesired content)로 전송돼. 오른쪽 프리셋 태그도 Negative에 합쳐서 전송돼서 EXIF에서 확인 가능해.</div>
                                </div>
                            </div>
                        </div>

                        <div class="csp-tab-panel" data-csp-tab-panel="detail" role="tabpanel">
                            <div class="csp-section">
                                <div class="csp-section-title">장면 정보</div>
                                <div class="csp-field">
                                    <label>장면 제목</label>
                                    <input id="csp-plan-title" value="${escapeHtml(currentPlan.sceneTitle || '')}">
                                </div>
                                <div class="csp-grid">
                                    <div class="csp-field">
                                        <label>삽입 위치 (문단 index)</label>
                                        <input id="csp-plan-insert" type="number" min="0" value="${Number(currentPlan.insertAfterParagraph) || 0}">
                                    </div>
                                    <div class="csp-field">
                                        <label>등장 인원</label>
                                        <input id="csp-plan-count" type="number" min="1" value="${Number(currentPlan.characterCount) || 1}">
                                    </div>
                                </div>
                                <div class="csp-field">
                                    <label>선택 이유</label>
                                    <textarea id="csp-plan-reason">${escapeHtml(currentPlan.reason || '')}</textarea>
                                </div>
                                <div class="csp-field">
                                    <label>전체 로그 장소/상황 컨텍스트</label>
                                    <textarea id="csp-global-context" class="csp-long">${escapeHtml(formatGlobalContextForTextarea(currentPlan.globalContext || {}))}</textarea>
                                    <div class="csp-mini-note">문단 재분석 때 장소/시간대/큰 상황이 사라지지 않게 같이 다시 보냄. 필요하면 직접 수정 가능.</div>
                                </div>
                            </div>

                            <div class="csp-section">
                                <div class="csp-section-title">프롬프트 조립 상세</div>
                                <div class="csp-field">
                                    <label>고정 Positive / 작가태그</label>
                                    <textarea id="csp-fixed-positive" class="csp-long">${escapeHtml(promptState.fixedPositive)}</textarea>
                                </div>
                                <div class="csp-field">
                                    <label>고정 Negative / UC</label>
                                    <textarea id="csp-fixed-negative" class="csp-long">${escapeHtml(promptState.fixedNegative || '')}</textarea>
                                </div>
                                <div class="csp-field">
                                    <label>Character Prompt 슬롯</label>
                                    <div class="csp-mini-note">실제 API 전송은 각 슬롯의 영어 태그/UC 배열로 나뉘어 들어가고, 아래는 보기 편한 미리보기야.</div>
                                    <div id="csp-character-slot-preview"></div>
                                    <textarea id="csp-character-tags" class="csp-long csp-hidden-raw">${escapeHtml(promptState.characterTags)}</textarea>
                                </div>
                            </div>
                        </div>

                        <div class="csp-tab-panel" data-csp-tab-panel="generation" role="tabpanel">
                            <div class="csp-section">
                                <div class="csp-section-title">NAI 생성 설정</div>
                                <div class="csp-mini-note">SMEA/DYN과 다중 생성은 공유용 안정화를 위해 사용하지 않고, 항상 1장만 생성해.</div>
                                <div class="csp-grid">
                                    <div class="csp-field">
                                        <label>Resolution</label>
                                        <div class="csp-res-row">
                                            <select id="csp-nai-orientation">
                                                <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                                <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                                <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                            </select>
                                            <div class="csp-res-dims">
                                                <input id="csp-nai-width" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                                <input id="csp-nai-height" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                                <span class="csp-dim-pill" id="csp-nai-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                                <button class="csp-dim-swap" id="csp-nai-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                                <span class="csp-dim-pill" id="csp-nai-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="csp-field">
                                        <div class="csp-label-row"><label>Steps</label><span class="csp-value-chip" id="csp-nai-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                                        <div class="csp-range-wrap">
                                            <input id="csp-nai-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                            <input id="csp-nai-steps" class="csp-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                        </div>
                                        <div class="csp-mini-note">29 이상부터 추가 Anlas 소모.</div>
                                    </div>
                                    <div class="csp-field">
                                        <div class="csp-label-row"><label>Prompt Guidance</label><span class="csp-value-chip" id="csp-nai-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                                        <div class="csp-range-wrap">
                                            <input id="csp-nai-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                            <input id="csp-nai-scale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                        </div>
                                    </div>
                                    <div class="csp-field">
                                        <label>Seed</label>
                                        <input id="csp-nai-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                                    </div>
                                    <div class="csp-field">
                                        <label>Sampler</label>
                                        <select id="csp-nai-sampler">
                                            <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                            <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                            <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                            <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                            <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                            <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                                        </select>
                                    </div>
                                    <div class="csp-field">
                                        <div class="csp-label-row"><label>Prompt Guidance Rescale</label><span class="csp-value-chip" id="csp-nai-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                                        <div class="csp-range-wrap">
                                            <input id="csp-nai-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                            <input id="csp-nai-guidance-rescale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                        </div>
                                    </div>
                                    <div class="csp-field">
                                        <label>Noise Schedule</label>
                                        <select id="csp-nai-noise-schedule">
                                            <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                            <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                            <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="csp-actions">
                    <div class="csp-actions-left">
                        <button class="csp-btn" id="csp-refine-plan">재분석 요청</button>
                        <button class="csp-btn" id="csp-copy-final">최종 프롬프트 복사</button>
                    </div>
                    <div class="csp-actions-right">
                        <button class="csp-anlas-chip" id="csp-current-anlas" type="button" title="클릭해서 잔여 Anlas를 조회해">? Anlas</button>
                        <button class="csp-anlas-chip csp-anlas-cost" id="csp-reference-cost-chip" type="button" title="예상 소모 Anlas" hidden></button>
                        <button class="csp-btn" id="csp-plan-close">취소</button>
                        <button class="csp-btn csp-btn-primary" id="csp-generate-nai">NAI 생성</button>
                    </div>
                </div>
            </div>
        `;

        const planTabButtons = Array.from(overlay.querySelectorAll('.csp-tab-btn'));
        const planTabPanels = Array.from(overlay.querySelectorAll('.csp-tab-panel'));
        planTabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.cspTab;
                planTabButtons.forEach((item) => {
                    const active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                planTabPanels.forEach((panel) => {
                    panel.classList.toggle('is-active', panel.dataset.cspTabPanel === tabName);
                });
            });
        });

        const fixedPositiveEl = overlay.querySelector('#csp-fixed-positive');
        const fixedNegativeEl = overlay.querySelector('#csp-fixed-negative');
        const characterTagsEl = overlay.querySelector('#csp-character-tags');
        const scenePromptEl = overlay.querySelector('#csp-scene-prompt');
        const useTempOutfitEl = overlay.querySelector('#csp-use-temp-outfit');
        const tempOutfitPromptEl = overlay.querySelector('#csp-temp-outfit-prompt');
        const tempOutfitNoteEl = overlay.querySelector('#csp-temp-outfit-note');
        const finalPromptEl = overlay.querySelector('#csp-final-prompt');
        const finalNegativeEl = overlay.querySelector('#csp-final-negative');
        const paragraphSelectEl = overlay.querySelector('#csp-focus-paragraph');
        const characterSelectEl = overlay.querySelector('#csp-focus-character');
        const paragraphPreviewEl = overlay.querySelector('#csp-focus-preview');
        const reanalyzeBtn = overlay.querySelector('#csp-reanalyze-paragraph');
        const refinePlanBtn = overlay.querySelector('#csp-refine-plan');
        const globalContextEl = overlay.querySelector('#csp-global-context');
        const characterSlotPreviewEl = overlay.querySelector('#csp-character-slot-preview');
        const referenceCostChipEl = overlay.querySelector('#csp-reference-cost-chip');
        const currentAnlasChipEl = overlay.querySelector('#csp-current-anlas');
        let latestAnlasBalance = null;
        function updateAnlasUi() {
            const editedCharPrompts = parseCharacterPromptsFromTextarea(characterTagsEl.value, promptState.charPrompts);
            renderAnlasInlineUi(referenceCostChipEl, currentAnlasChipEl, editedCharPrompts, latestAnlasBalance, getModalNaiSettings(overlay));
        }
        renderCharacterSlotPreview(characterSlotPreviewEl, promptState.charPrompts || []);
        updateAnlasUi();
        const orientationEl = overlay.querySelector('#csp-nai-orientation');
        const widthEl = overlay.querySelector('#csp-nai-width');
        const heightEl = overlay.querySelector('#csp-nai-height');
        const widthViewEl = overlay.querySelector('#csp-nai-width-view');
        const heightViewEl = overlay.querySelector('#csp-nai-height-view');
        const swapOrientationBtn = overlay.querySelector('#csp-nai-swap');

        if (orientationEl && widthEl && heightEl) {
            applyOrientationPreset(orientationEl.value, widthEl, heightEl, widthViewEl, heightViewEl);
            orientationEl.addEventListener('change', () => {
                applyOrientationPreset(orientationEl.value, widthEl, heightEl, widthViewEl, heightViewEl);
                updateAnlasUi();
            });
            swapOrientationBtn?.addEventListener('click', () => {
                swapOrientationPreset(orientationEl, widthEl, heightEl, widthViewEl, heightViewEl);
                updateAnlasUi();
            });
        }
        bindRangeNumberPair(overlay.querySelector('#csp-nai-steps-range'), overlay.querySelector('#csp-nai-steps'), overlay.querySelector('#csp-nai-steps-value'), { min: 1, max: 50, step: 1, decimals: 0, onChange: updateAnlasUi });
        bindRangeNumberPair(overlay.querySelector('#csp-nai-scale-range'), overlay.querySelector('#csp-nai-scale'), overlay.querySelector('#csp-nai-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#csp-nai-guidance-rescale-range'), overlay.querySelector('#csp-nai-guidance-rescale'), overlay.querySelector('#csp-nai-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });

        async function refreshAnlasBalance(silent = false) {
            if (currentAnlasChipEl) {
                currentAnlasChipEl.disabled = true;
                currentAnlasChipEl.textContent = '... Anlas';
            }
            try {
                latestAnlasBalance = await fetchNaiAnlasBalance();
                updateAnlasUi();
                if (!silent) showToast(`잔여 Anlas: ${Number(latestAnlasBalance.total).toLocaleString()}`);
            } catch (err) {
                latestAnlasBalance = null;
                updateAnlasUi();
                if (!silent) showToast('⚠️ 잔여 Anlas 조회 실패: ' + err.message);
            } finally {
                if (currentAnlasChipEl) currentAnlasChipEl.disabled = false;
            }
        }

        currentAnlasChipEl?.addEventListener('click', () => {
            refreshAnlasBalance(false);
        });


        function recomputeFinalPrompt() {
            currentPlan.useTemporaryOutfit = !!useTempOutfitEl?.checked;
            currentPlan.temporaryOutfitPrompt = tempOutfitPromptEl ? tempOutfitPromptEl.value.trim() : (currentPlan.temporaryOutfitPrompt || '');
            const livePromptState = buildFinalPromptFromPlan(currentPlan, getRoomSettings());
            promptState.charPrompts = livePromptState.charPrompts;
            promptState.characterTags = livePromptState.characterTags;
            promptState.temporaryOutfitPrompt = currentPlan.temporaryOutfitPrompt;
            promptState.useTemporaryOutfit = livePromptState.useTemporaryOutfit;
            if (characterTagsEl) characterTagsEl.value = livePromptState.characterTags;
            const editedCharPrompts = parseCharacterPromptsFromTextarea(characterTagsEl.value, livePromptState.charPrompts);
            const subjectCount = buildSubjectCountTag(editedCharPrompts.map(char => ({ tags: char.prompt }))) || 'solo';
            const mergedCharacterPrompt = buildCommaPrompt(editedCharPrompts.map(char => stripSubjectCountTags(char.prompt || '')));
            const mergedCharacterUc = buildCommaPrompt(editedCharPrompts.map(char => char.uc || ''));
            finalPromptEl.value = buildCommaPrompt([
                fixedPositiveEl.value,
                subjectCount,
                mergedCharacterPrompt,
                scenePromptEl.value
            ]);
            finalNegativeEl.value = buildCommaPrompt([
                fixedNegativeEl.value,
                mergedCharacterUc
            ]);
            if (tempOutfitNoteEl) {
                tempOutfitNoteEl.textContent = currentPlan.temporaryOutfitPrompt
                    ? '체크하면 위 의상 태그가 캐릭터 슬롯 기본 의상 대신 사용돼.'
                    : '(로그 기반 임시 의상 없음 — 직접 입력 후 체크해서 사용할 수 있어)';
            }
            renderCharacterSlotPreview(characterSlotPreviewEl, editedCharPrompts);
            updateAnlasUi();
        }

        function applyPlanToModal(nextPlan, options = {}) {
            currentPlan = Object.assign({}, currentPlan, nextPlan || {});
            currentPlan.insertAfterParagraph = Number(currentPlan.insertAfterParagraph || 0);
            currentPlan.characterCount = Math.max(1, Number(currentPlan.characterCount || 1));

            if (options.keepManualCharacter) {
                const manualName = characterSelectEl.value;
                currentPlan.visibleCharacters = manualName ? [manualName] : [];
                currentPlan.charactersInScene = currentPlan.visibleCharacters;
                currentPlan.characterCount = Math.max(1, currentPlan.visibleCharacters.length || 1);
            }

            overlay.querySelector('#csp-plan-title').value = currentPlan.sceneTitle || '';
            overlay.querySelector('#csp-plan-insert').value = String(currentPlan.insertAfterParagraph || 0);
            overlay.querySelector('#csp-plan-count').value = String(currentPlan.characterCount || 1);
            overlay.querySelector('#csp-plan-reason').value = currentPlan.reason || '';
            globalContextEl.value = formatGlobalContextForTextarea(currentPlan.globalContext || {});

            paragraphSelectEl.value = String(currentPlan.insertAfterParagraph || 0);
            paragraphPreviewEl.textContent = getParagraphTextByIndex(markdown, currentPlan.insertAfterParagraph) || '(문단 없음)';

            const selectedName = (currentPlan.visibleCharacters || currentPlan.charactersInScene || [])[0] || '';
            characterSelectEl.innerHTML = buildCharacterSelectOptions(room, selectedName);

            promptState = buildFinalPromptFromPlan(currentPlan, getRoomSettings());
            characterTagsEl.value = promptState.characterTags;
            scenePromptEl.value = promptState.scenePrompt;
            if (tempOutfitPromptEl) tempOutfitPromptEl.value = promptState.temporaryOutfitPrompt || currentPlan.temporaryOutfitPrompt || '';
            if (useTempOutfitEl) useTempOutfitEl.checked = !!currentPlan.useTemporaryOutfit;
            if (tempOutfitNoteEl) {
                tempOutfitNoteEl.textContent = (tempOutfitPromptEl?.value || '').trim()
                    ? '체크하면 위 의상 태그가 캐릭터 슬롯 기본 의상 대신 사용돼.'
                    : '(로그 기반 임시 의상 없음 — 직접 입력 후 체크해서 사용할 수 있어)';
            }
            recomputeFinalPrompt();
        refreshAnlasBalance(true);
        }

        fixedPositiveEl.addEventListener('input', recomputeFinalPrompt);
        fixedNegativeEl.addEventListener('input', recomputeFinalPrompt);
        useTempOutfitEl?.addEventListener('change', recomputeFinalPrompt);
        tempOutfitPromptEl?.addEventListener('input', recomputeFinalPrompt);
        characterTagsEl.addEventListener('input', recomputeFinalPrompt);
        scenePromptEl.addEventListener('input', recomputeFinalPrompt);

        paragraphSelectEl.addEventListener('change', () => {
            const idx = Number(paragraphSelectEl.value || 0);
            paragraphPreviewEl.textContent = getParagraphTextByIndex(markdown, idx) || '(문단 없음)';
            overlay.querySelector('#csp-plan-insert').value = String(idx);
            currentPlan.insertAfterParagraph = idx;
        });

        characterSelectEl.addEventListener('change', () => {
            const name = characterSelectEl.value.trim();
            currentPlan.visibleCharacters = name ? [name] : [];
            currentPlan.charactersInScene = currentPlan.visibleCharacters;
            currentPlan.characterCount = Math.max(1, currentPlan.visibleCharacters.length || 1);
            overlay.querySelector('#csp-plan-count').value = String(currentPlan.characterCount);
            applyPlanToModal(currentPlan, { keepManualCharacter: true });
        });

        reanalyzeBtn.addEventListener('click', async () => {
            const idx = Number(paragraphSelectEl.value || 0);
            try {
                reanalyzeBtn.disabled = true;
                reanalyzeBtn.textContent = '재분석 중...';
                showTaskHud('문단 기준 재분석', '선택한 문단과 앞뒤 문단만 보고 장면 태그를 다시 만들고 있어.', 18);
                const ticker = startTaskHudTicker([
                    { title: '선택 문단 확인', message: '사용자가 고른 문단 주변만 추려내고 있어.', progress: 34 },
                    { title: 'Gemini 재분석 요청', message: '선택 문단 기준으로 중심 캐릭터와 구도를 다시 고르는 중이야.', progress: 62 },
                    { title: '확인창 갱신', message: '새 장면 태그와 프롬프트를 확인창에 반영하고 있어.', progress: 86 }
                ]);

                const stableContext = parseGlobalContextFromTextarea(globalContextEl.value, currentPlan.globalContext || {});
                const nextPlan = await generateScenePlanForParagraphWithGemini(targetBubble, markdown, idx, stableContext);
                ticker.stop();
                updateTaskHud({ title: '재분석 완료', message: '선택 문단 기준으로 장면을 다시 잡았어.', progress: 100, status: 'success' });
                applyPlanToModal(nextPlan);
                showToast('✅ 선택 문단 기준 재분석 완료');
                setTimeout(() => hideTaskHud(), 420);
            } catch (err) {
                console.error('[Crack Scene Painter] paragraph reanalysis failed:', err);
                updateTaskHud({ title: '재분석 실패', message: '선택 문단 기준 재분석에 실패했어.\n\n사유: ' + err.message, progress: 100, status: 'error' });
                showToast('⚠️ 재분석 실패: ' + err.message);
                setTimeout(() => hideTaskHud(), 1800);
            } finally {
                reanalyzeBtn.disabled = false;
                reanalyzeBtn.textContent = '이 문단 기준으로 다시 분석';
            }
        });


        refinePlanBtn?.addEventListener('click', async () => {
            const requestText = await showSceneRefineRequestModal({
                title: '재분석 요청',
                description: '현재 선택 장면은 유지하고, 추가 요청만 반영해서 장면 태그를 다시 다듬어.',
                placeholder: '예: 상반신 위주로, 정면 시선, 좀 더 다정한 표정, 책상보다 복도 느낌',
                maxLength: 200
            });
            if (!requestText) return;

            const idx = Number(paragraphSelectEl.value || currentPlan.insertAfterParagraph || 0);
            const selectedName = characterSelectEl.value.trim() || (currentPlan.visibleCharacters || currentPlan.charactersInScene || [])[0] || '';
            const stableContext = parseGlobalContextFromTextarea(globalContextEl.value, currentPlan.globalContext || {});
            const editedBeforeRefine = collectEditedPlan();
            editedBeforeRefine.scenePrompt = scenePromptEl.value.trim();
            editedBeforeRefine.baseScenePrompt = currentPlan.baseScenePrompt || '';
            editedBeforeRefine.interactionPrompt = currentPlan.interactionPrompt || '';
            editedBeforeRefine.composition = currentPlan.composition || '';
            editedBeforeRefine.temporaryOutfitPrompt = tempOutfitPromptEl ? tempOutfitPromptEl.value.trim() : (currentPlan.temporaryOutfitPrompt || '');

            try {
                refinePlanBtn.disabled = true;
                refinePlanBtn.textContent = '재분석 요청 중...';
                showTaskHud('장면 수정 요청', '추가 지시사항을 반영해서 현재 장면을 다시 다듬고 있어.', 16);
                const ticker = startTaskHudTicker([
                    { title: '요청 정리 중', message: '현재 장면과 추가 요청을 함께 정리하고 있어.', progress: 34 },
                    { title: 'Gemini 재분석 요청', message: '현재 장면을 유지한 채, 추가 요청이 반영된 새 태그를 만드는 중이야.', progress: 62 },
                    { title: '확인창 갱신', message: '수정된 장면 태그와 프롬프트를 확인창에 반영하고 있어.', progress: 86 }
                ]);

                const nextPlan = await generateRefinedScenePlanWithGemini(
                    targetBubble,
                    markdown,
                    idx,
                    stableContext,
                    editedBeforeRefine,
                    selectedName,
                    requestText
                );

                ticker.stop();
                nextPlan.insertAfterParagraph = idx;
                if (selectedName) {
                    nextPlan.visibleCharacters = [selectedName];
                    nextPlan.charactersInScene = [selectedName];
                    nextPlan.characterCount = 1;
                }
                updateTaskHud({ title: '장면 수정 완료', message: '추가 요청을 반영해서 장면 태그를 다시 다듬었어.', progress: 100, status: 'success' });
                applyPlanToModal(nextPlan, { keepManualCharacter: true });
                showToast('✅ 추가 요청 반영 완료');
                setTimeout(() => hideTaskHud(), 420);
            } catch (err) {
                console.error('[Crack Scene Painter] scene refine request failed:', err);
                updateTaskHud({ title: '장면 수정 실패', message: '추가 요청 반영에 실패했어.\n\n사유: ' + err.message, progress: 100, status: 'error' });
                showToast('⚠️ 재분석 요청 실패: ' + err.message);
                setTimeout(() => hideTaskHud(), 1800);
            } finally {
                refinePlanBtn.disabled = false;
                refinePlanBtn.textContent = '재분석 요청';
            }
        });

        function collectEditedPlan() {
            const manualName = characterSelectEl.value.trim();
            const visible = manualName ? [manualName] : (currentPlan.visibleCharacters || currentPlan.charactersInScene || []);
            return {
                sceneTitle: overlay.querySelector('#csp-plan-title').value.trim(),
                insertAfterParagraph: Number(overlay.querySelector('#csp-plan-insert').value || 0),
                characterCount: Math.max(1, visible.length || Number(overlay.querySelector('#csp-plan-count').value || 1)),
                visibleCharacters: visible.slice(0, 1),
                charactersInScene: visible.slice(0, 1),
                mood: currentPlan.mood || '',
                globalContext: parseGlobalContextFromTextarea(globalContextEl.value, currentPlan.globalContext || {}),
                composition: currentPlan.composition || '',
                baseScenePrompt: currentPlan.baseScenePrompt || scenePromptEl.value.trim(),
                interactionPrompt: currentPlan.interactionPrompt || '',
                scenePrompt: scenePromptEl.value.trim(),
                temporaryOutfitPrompt: tempOutfitPromptEl ? tempOutfitPromptEl.value.trim() : (currentPlan.temporaryOutfitPrompt || ''),
                useTemporaryOutfit: !!useTempOutfitEl?.checked,
                reason: overlay.querySelector('#csp-plan-reason').value.trim()
            };
        }

        function collectNaiSettings() {
            return {
                orientationPreset: overlay.querySelector('#csp-nai-orientation').value,
                width: Number(overlay.querySelector('#csp-nai-width').value || 832),
                height: Number(overlay.querySelector('#csp-nai-height').value || 1216),
                steps: Number(overlay.querySelector('#csp-nai-steps').value || 28),
                scale: Number(overlay.querySelector('#csp-nai-scale').value || 6.5),
                guidanceRescale: Number(overlay.querySelector('#csp-nai-guidance-rescale').value || 0.3),
                seed: overlay.querySelector('#csp-nai-seed').value.trim(),
                sampler: overlay.querySelector('#csp-nai-sampler').value,
                noiseSchedule: overlay.querySelector('#csp-nai-noise-schedule').value,
                nSamples: 1,
                smea: false,
                dyn: false,
                ucPreset: Number(overlay.querySelector('#csp-nai-uc-preset')?.value || 0)
            };
        }

        function saveGenerationGlobalEdits() {
            const nextGlobal = getGlobalSettings();
            nextGlobal.basePositive = fixedPositiveEl.value.trim();
            nextGlobal.baseNegative = fixedNegativeEl.value.trim();
            nextGlobal.naiSettings = collectNaiSettings();
            saveGlobalSettings(nextGlobal);
        }

        overlay.querySelector('#csp-plan-close').onclick = () => overlay.remove();

        overlay.querySelector('#csp-copy-final').onclick = async () => {
            await navigator.clipboard.writeText(finalPromptEl.value);
            showToast('✅ 최종 프롬프트 복사 완료');
        };
        overlay.querySelector('#csp-generate-nai').onclick = async () => {
            const btn = overlay.querySelector('#csp-generate-nai');
            const editedPlan = collectEditedPlan();
            const naiSettings = collectNaiSettings();
            recomputeFinalPrompt();
            const finalPrompt = finalPromptEl.value.trim();
            const charPrompts = parseCharacterPromptsFromTextarea(characterTagsEl.value, promptState.charPrompts);
            const subjectCount = buildSubjectCountTag(charPrompts.map(char => ({ tags: char.prompt }))) || 'solo';
            const basePromptForRequest = buildCommaPrompt([
                fixedPositiveEl.value,
                subjectCount,
                scenePromptEl.value
            ]);
            const baseNegativeForRequest = fixedNegativeEl.value.trim();

            try {
                const finalNegativeForRequest = finalNegativeEl.value.trim();
                if (!finalNegativeForRequest) {
                    const proceed = confirm('현재 Negative / UC가 비어 있어요. 그대로 생성할까요?');
                    if (!proceed) return;
                }

                btn.disabled = true;
                btn.textContent = 'NAI 생성 중...';
                saveGenerationGlobalEdits();
                const referenceInfoForRequest = getReferenceSummary(charPrompts);
                const generatedImageUrl = await generateImageWithNai({
                    basePrompt: basePromptForRequest,
                    baseNegative: baseNegativeForRequest,
                    finalPrompt,
                    finalNegative: finalNegativeForRequest,
                    charPrompts,
                    settings: naiSettings
                });
                await insertFinalSceneImage({
                    markdown,
                    imageUrl: generatedImageUrl,
                    plan: editedPlan,
                    mode: 'nai',
                    basePrompt: basePromptForRequest,
                    baseNegative: baseNegativeForRequest,
                    finalPrompt,
                    finalNegative: finalNegativeForRequest,
                    charPrompts,
                    referenceInfo: referenceInfoForRequest,
                    naiSettings,
                    sceneIndex,
                    keepExisting: sceneIndex > 0
                });
                _closeModal();
            } catch (err) {
                console.error('[Crack Scene Painter] NAI generation failed:', err);
                showToast('⚠️ NAI 생성 실패: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'NAI 생성';
            }
        };

        const _closeModal = () => { overlay.remove(); resolveModal(); };
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) _closeModal();
        });

        // 취소 버튼
        overlay.querySelector('#csp-cancel-plan')?.addEventListener('click', _closeModal);

        refreshAnlasBalance(true);
        document.body.appendChild(overlay);
        }); // end Promise
    }

    let cspImageActionsBound = false;

    function bindImageActionDelegates() {
        if (cspImageActionsBound) return;
        cspImageActionsBound = true;
        document.addEventListener('click', handleImageAction, true);
    }


    async function runSpeedModeGeneration({ bubble, markdown, button }) {
        if (!isEnabled()) {
            showToast('⏸️ AI 삽화 생성이 OFF 상태예요.');
            return;
        }

        const global = getGlobalSettings();
        const room = getRoomSettings();
        const naiSettings = Object.assign({}, getDefaultGlobalSettings().naiSettings, global.naiSettings || {});
        const messageKey = getMessageKey(markdown);

        try {
            if (button) {
                button.disabled = true;
                button.setAttribute('data-csp-loading', 'true');
                button.title = '스피드 모드 생성 중...';
            }

            const sceneCount = Number(global.multiSceneCount || 1);
            const _providerName = getProviderDisplayName(global);
            const roomCharacters = (room.characters || []).filter(hasCharacterSlotContent);
            // 재생성 시 기존 다중 장면 기록 전체 초기화
            removeAllSceneRecordsForMarkdown(markdown);
            removeSceneImage(markdown);
            const usedParagraphsSpeed = new Set(); // 중복 문단 방지용
            // 이미 DOM에 삽입된 이미지 위치도 피해야 함
            Array.from(markdown.querySelectorAll('.csp-generated-scene-image')).forEach(el => {
                const _existingKey = el.getAttribute('data-message-key');
                if (_existingKey) {
                    const _records = getSceneRecords();
                    const _rec = _records[_existingKey];
                    if (_rec && Number.isFinite(_rec.paragraphIndex)) {
                        usedParagraphsSpeed.add(_rec.paragraphIndex);
                    }
                }
            });

            showToast(`⚡ 스피드 모드 시작 (${sceneCount}장면)`);
            showTaskHud('스피드 모드', `${sceneCount}개 장면을 분석→생성→삽입 순서로 진행해.`, 5);

            for (let _si = 0; _si < sceneCount; _si++) {
                const _stepLabel = sceneCount > 1 ? ` (${_si + 1}/${sceneCount})` : '';
                const _pct = Math.round(_si / sceneCount * 100);

                // 2번째 장면부터 rate limit 방지 딜레이
                if (_si > 0) {
                    updateTaskHud({ title: `다음 장면 준비 중${_stepLabel}`, message: '잠깐 기다렸다가 다음 장면 분석을 시작할게.', progress: _pct });
                    await new Promise(r => setTimeout(r, 4000));
                }

                // 1. 분석 — 본문을 N등분해서 해당 구간만 전달
                updateTaskHud({ title: `AI 분석 중${_stepLabel}`, message: `${_providerName}에게 장면 분석 요청 중이야.`, progress: _pct + 5 });
                const _allParagraphs = getParagraphs(markdown);
                const _totalP = _allParagraphs.length;
                const _segSize = Math.ceil(_totalP / sceneCount);
                const _segStart = _si * _segSize;
                const _segEnd = Math.min(_segStart + _segSize - 1, _totalP - 1);
                const _pRange = sceneCount > 1 ? { start: _segStart, end: _segEnd } : null;
                let _plan = await generateScenePlanWithGemini(bubble, markdown, { sceneCount: 1, paragraphRange: _pRange });
                if (Array.isArray(_plan)) _plan = _plan[0];

                // 캐릭터 자동 처리
                const _matchedNames = findCharacterNamesInText(room, getSceneWindowText(markdown, _plan.insertAfterParagraph, 1) || cleanMarkdownText(markdown));
                const _fallback = (_plan.visibleCharacters || []).filter(Boolean);
                const _chosen = _fallback.find(n => findRoomCharacterSlotByName(n, room))
                    || _matchedNames.find(n => findRoomCharacterSlotByName(n, room))
                    || (roomCharacters[0]?.name || '');
                _plan.visibleCharacters = _chosen ? [_chosen] : [];
                _plan.charactersInScene = _plan.visibleCharacters.slice();
                _plan.characterCount = Math.max(1, _plan.visibleCharacters.length || 1);
                _plan.useTemporaryOutfit = !!_plan.temporaryOutfitPrompt;

                // 2. NAI 생성
                updateTaskHud({ title: `NAI 생성 중${_stepLabel}`, message: `"${_plan.sceneTitle || '장면'}" — Anlas 소모 중.`, progress: _pct + 25 });
                const _ps = buildFinalPromptFromPlan(_plan, room);
                const _charPrompts = _ps.charPrompts || [];
                const _imageUrl = await generateImageWithNai({
                    basePrompt: _ps.basePrompt, baseNegative: _ps.baseNegative,
                    finalPrompt: _ps.finalPrompt, finalNegative: _ps.finalNegative,
                    charPrompts: _charPrompts, settings: naiSettings
                });

                // 문단 중복만 피하기 — AI가 고른 위치 최대한 존중, 겹치면 +1씩만 밀기
                let _finalIdx = _plan.insertAfterParagraph;
                while (usedParagraphsSpeed.has(_finalIdx)) _finalIdx++;
                _plan.insertAfterParagraph = _finalIdx;
                usedParagraphsSpeed.add(_finalIdx);

                // 3. 삽입 (2번째 이후는 기존 이미지 유지)
                updateTaskHud({ title: `이미지 삽입 중${_stepLabel}`, message: `문단 ${_plan.insertAfterParagraph + 1} 뒤에 삽입 중.`, progress: _pct + 28 });
                await insertFinalSceneImage({
                    markdown, imageUrl: _imageUrl, plan: _plan, mode: 'nai',
                    basePrompt: _ps.basePrompt, baseNegative: _ps.baseNegative,
                    finalPrompt: _ps.finalPrompt, finalNegative: _ps.finalNegative,
                    charPrompts: _charPrompts, referenceInfo: getReferenceSummary(_charPrompts), naiSettings,
                    keepExisting: _si > 0,
                    sceneIndex: _si
                });

                showToast(`🖼️ ${_si + 1}/${sceneCount} 삽입 완료: ${_plan.sceneTitle || '장면'}`);
            }

            updateTaskHud({ title: '스피드 모드 완료 ✅', message: `${sceneCount}개 장면 모두 생성 완료!`, progress: 100, status: 'success' });
            showToast(`⚡ 스피드 모드 완료 (${sceneCount}장면)`);
            setTimeout(() => hideTaskHud(), 420);
            markSceneButtons(messageKey, true);
        } catch (err) {
            console.error('[Crack Scene Painter] speed mode failed:', err);
            showToast('⚠️ 생성 실패: ' + err.message);
            hideTaskHud(true);
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('data-csp-loading');
                button.title = '스피드 모드: 분석 후 바로 NAI 생성';
            }
        }
    }

    function makeMessageSpeedButton(bubble, markdown) {
        const btn = document.createElement('button');
        btn.className = 'csp-message-speed-btn';
        btn.type = 'button';
        btn.title = '스피드 모드: 분석 후 바로 NAI 생성';
        btn.setAttribute('aria-label', 'AI 삽화 스피드 생성');
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M13.25 2.75 5.3 13.1c-.5.65-.04 1.6.78 1.6h4.38l-1.7 6.1c-.18.66.65 1.08 1.1.56l8.1-9.46c.56-.65.1-1.66-.76-1.66h-4.05l1.8-6.3c.2-.68-.55-1.23-1.02-.69Z"/>
            </svg>
        `;
        const key = getMessageKey(markdown);
        btn.setAttribute('data-message-key', key);

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await runSpeedModeGeneration({ bubble, markdown, button: btn });
        });

        return btn;
    }

    async function reapplySavedScene(markdown) {
        const baseKey = getMessageKey(markdown);
        const records = getSceneRecords();

        // 다중 장면 복원: baseKey, baseKey_s1, baseKey_s2 순서로 복원
        const keysToRestore = [baseKey];
        for (let _si = 1; _si <= 5; _si++) {
            const _k = `${baseKey}_s${_si}`;
            if (records[_k]) keysToRestore.push(_k);
            else break;
        }

        for (const key of keysToRestore) {
        const record = records[key];
        if (!record) continue;
        // React 리렌더링으로 DOM이 교체된 경우를 감지:
        // 이미지 엘리먼트가 있어도 document에 연결돼 있지 않으면(detached) 재삽입 필요
        const existing = Array.from(markdown.querySelectorAll('.csp-generated-scene-image'))
            .find(el => el.getAttribute('data-message-key') === key && el.isConnected);
        if (existing) continue;

        normalizeSceneRecordHistory(record, key);

        let imageUrl = await getRecordImageSrc(record);
        if (String(imageUrl || '').startsWith('blob:')) {
            delete records[key];
            saveSceneRecords(records);
            continue;
        }

        if (!imageUrl) continue;

        // 예전 data URL 기록이 남아 있으면 IndexedDB로 옮기고 localStorage에서는 제거합니다.
        const currentItem = getCurrentHistoryItem(record);
        if (String(imageUrl || '').startsWith('data:') && currentItem && !currentItem.imageId) {
            const imageId = makeHistoryImageId(key);
            await putStoredImage(imageId, imageUrl);
            currentItem.imageId = imageId;
            delete currentItem.imageUrl;
            syncCurrentImageFieldsFromHistory(record);
        }

        records[key] = record;
        saveSceneRecords(records);

        insertSceneImageIntoMarkdown(markdown, imageUrl, record.paragraphIndex, {
            mode: record.mode || 'gemini',
            messageKey: key,
            keepExisting: key !== baseKey,
            captionHtml: buildCaption(record.plan || {}, record.paragraphIndex, 'restore', {
                basePrompt: record.basePrompt || '',
                baseNegative: record.baseNegative || '',
                finalPrompt: record.finalPrompt || '',
                charPrompts: record.charPrompts || [],
                referenceInfo: record.referenceInfo || getReferenceSummary(record.charPrompts || []),
                naiSettings: record.naiSettings || null
            }, key),
            historyHtml: buildImageHistoryControls(key, record)
        });
        markSceneButtons(key, true);
        } // end for keysToRestore
    }

    function makeMessageGenerateButton(bubble, markdown) {
        const btn = document.createElement('button');
        btn.className = 'csp-message-generate-btn';
        btn.type = 'button';
        btn.title = '이 AI 답변으로 이미지 생성';
        btn.setAttribute('aria-label', 'AI 삽화 생성');
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z"/>
                <path d="M19 14l1.12 3.38L23.5 18.5l-3.38 1.12L19 23l-1.12-3.38L14.5 18.5l3.38-1.12L19 14z" opacity="0.7"/>
                <path d="M5 14l.75 2.25L8 17l-2.25.75L5 20l-.75-2.25L2 17l2.25-.75L5 14z" opacity="0.5"/>
            </svg>
        `;

        const key = getMessageKey(markdown);
        const records = getSceneRecords();
        btn.setAttribute('data-message-key', key);
        if (records[key]) btn.setAttribute('data-csp-has-image', 'true');

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!isEnabled()) {
                showToast('⏸️ AI 삽화 생성이 OFF 상태예요.');
                return;
            }

            console.log('[Crack Scene Painter] image button clicked:', { key, markdown });
            btn.setAttribute('data-csp-loading', 'true');
            btn.disabled = true;
            const _providerName = getProviderDisplayName(getGlobalSettings());
            btn.title = 'AI가 장면을 분석 중...';
            showToast(`🔎 ${_providerName}이(가) 장면과 삽입 위치를 분석 중...`);
            showTaskHud('장면 분석 시작', '지금 선택한 AI 답변을 읽고, 어디에 어떤 장면을 넣을지 고르는 중이야.', 10);
            const ticker = startTaskHudTicker([
                { title: '로그 정리 중', message: '현재 AI 답변의 문단과 장면 흐름을 정리하고 있어.', progress: 24 },
                { title: 'AI 분석 요청 중', message: `${_providerName}에 장면 분석을 요청했어. 이 단계가 길어지면 API 응답 대기 중일 수 있어.`, progress: 46 },
                { title: '응답 해석 중', message: '받아온 JSON을 읽고, 삽입 위치와 장면 태그를 정리하고 있어.', progress: 68 },
                { title: '확인창 준비 중', message: '확인창과 프롬프트 초안을 만들고 있어.', progress: 84 }
            ]);

            try {
                const _global = getGlobalSettings();
                const _sceneCount = Number(_global.multiSceneCount || 1);
                // 재생성 시 기존 다중 장면 기록 전체 초기화
                removeAllSceneRecordsForMarkdown(markdown);
                removeSceneImage(markdown);
                const usedParagraphs = new Set();
                // 이미 DOM에 삽입된 이미지 위치도 피해야 함
                Array.from(markdown.querySelectorAll('.csp-generated-scene-image')).forEach(el => {
                    const _ek = el.getAttribute('data-message-key');
                    if (_ek) {
                        const _er = getSceneRecords()[_ek];
                        if (_er && Number.isFinite(_er.paragraphIndex)) usedParagraphs.add(_er.paragraphIndex);
                    }
                });

                hideTaskHud(true);

                for (let _i = 0; _i < _sceneCount; _i++) {
                    // 2번째부터 rate limit 방지 딜레이
                    if (_i > 0) {
                        await new Promise(r => setTimeout(r, 4000));
                    }
                    // 이미 사용된 문단 힌트를 유저 메시지에 추가
                    const _excludeHint = usedParagraphs.size > 0
                        ? `

[이미 선택된 문단 인덱스: ${[...usedParagraphs].join(', ')} — 이 인덱스는 사용하지 마.]`
                        : '';

                    // 본문 N등분해서 해당 구간만 전달
                    const _ap = getParagraphs(markdown);
                    const _tp = _ap.length;
                    const _ss = Math.ceil(_tp / _sceneCount);
                    const _pStart = _i * _ss;
                    const _pEnd = Math.min(_pStart + _ss - 1, _tp - 1);
                    const _pr = _sceneCount > 1 ? { start: _pStart, end: _pEnd } : null;

                    showTaskHud(`장면 분석 중 (${_i + 1}/${_sceneCount})`, `AI에게 ${_i + 1}번째 장면을 분석 요청 중이야.`, 20);
                    const _ticker = startTaskHudTicker([
                        { title: `AI 분석 중 (${_i + 1}/${_sceneCount})`, message: 'API에 분석 요청했어. 잠깐만 기다려줘.', progress: 50 },
                        { title: '응답 해석 중', message: '받아온 JSON을 정리하고 있어.', progress: 80 }
                    ]);

                    let _plan;
                    try {
                        _plan = await generateScenePlanWithGemini(bubble, markdown, { sceneCount: 1, paragraphRange: _pr });
                        if (Array.isArray(_plan)) _plan = _plan[0];
                    } finally {
                        _ticker.stop();
                    }

                    // 문단 중복만 피하기 — AI가 고른 위치 최대한 존중, 겹치면 +1씩만 밀기
                    let _adjIdx = _plan.insertAfterParagraph;
                    while (usedParagraphs.has(_adjIdx)) _adjIdx++;
                    _plan.insertAfterParagraph = _adjIdx;
                    usedParagraphs.add(_adjIdx);
                    console.log(`[Crack Scene Painter] AI scene plan ${_i + 1}/${_sceneCount}:`, _plan);

                    updateTaskHud({ title: `분석 완료 (${_i + 1}/${_sceneCount})`, message: '확인창을 열어줄게. 닫으면 다음 장면 분석을 시작해.', progress: 100, status: 'success' });
                    setTimeout(() => hideTaskHud(true), 300);

                    await showScenePlanModal({ targetBubble: bubble, markdown, plan: _plan, sceneIndex: _i });
                }

                showToast(`✅ ${_sceneCount}개 장면 분석/생성 완료`);
            } catch (err) {
                console.error('[Crack Scene Painter] AI 분석 실패:', err);
                showToast('⚠️ 분석 실패: ' + err.message);
                hideTaskHud(true);
            } finally {
                ticker.stop();
                btn.removeAttribute('data-csp-loading');
                btn.disabled = false;
                btn.title = '이 AI 답변으로 이미지 생성';
            }
        });

        return btn;
    }

    function injectMessageButtons() {
        cleanupNonAssistantMessageButtons();
        if (!isEnabled()) return;
        const bubbles = getAssistantBubbles();

        bubbles.forEach(bubble => {
            const markdown = getDirectMarkdown(bubble);
            if (!markdown || !isLikelyAssistantMarkdown(markdown) || isUserBubble(bubble)) return;

            const footer = getButtonTargetFooter(bubble, markdown);
            if (!footer) return;

            reapplySavedScene(markdown);

            let leftSlot = footer.children[0];
            if (!leftSlot) {
                leftSlot = document.createElement('div');
                leftSlot.className = 'flex items-center space-x-3';
                footer.insertBefore(leftSlot, footer.firstChild);
            }

            if (!footer.querySelector('.csp-message-generate-btn')) {
                const btn = makeMessageGenerateButton(bubble, markdown);
                leftSlot.prepend(btn);
            }
            if (!footer.querySelector('.csp-message-speed-btn')) {
                const speedBtn = makeMessageSpeedButton(bubble, markdown);
                const normalBtn = footer.querySelector('.csp-message-generate-btn');
                if (normalBtn && normalBtn.parentElement) normalBtn.insertAdjacentElement('afterend', speedBtn);
                else leftSlot.prepend(speedBtn);
            }
        });
    }


    function cloneCharacterSlots(characters) {
        return normalizeRoomSettings({ characters: characters || [] }).characters.map(char => ({ ...char }));
    }

    function buildQuickSlotOptions(slots = [], selectedName = '') {
        const list = Array.isArray(slots) ? slots : [];
        if (!list.length) return '<option value="">저장된 퀵 슬롯 없음</option>';
        return list.map(slot => {
            const name = String(slot.name || '').trim();
            return `<option value="${escapeHtml(name)}" ${name === selectedName ? 'selected' : ''}>${escapeHtml(name)}</option>`;
        }).join('');
    }

    function getQuickSlotByName(slots = [], name = '') {
        const target = String(name || '').trim();
        if (!target) return null;
        return (Array.isArray(slots) ? slots : []).find(slot => String(slot.name || '').trim() === target) || null;
    }

    function renderCharacterCards(container, characters) {
        container.innerHTML = '';
        characters.forEach((char, index) => {
            const card = document.createElement('div');
            card.className = 'csp-character-card';
            card.innerHTML = `
                <div class="csp-character-head" style="cursor:pointer;" data-csp-collapse-toggle>
                    <span>캐릭터 ${index + 1}${getCharacterSlotName(char) ? ` — ${escapeHtml(getCharacterSlotName(char))}` : ''}</span>
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button class="csp-btn csp-btn-small csp-character-collapse-btn" type="button" title="접기/펼치기">▲</button>
                        <button class="csp-btn csp-btn-small csp-remove-character" type="button">삭제</button>
                    </div>
                </div>
                <div class="csp-character-body">
                <div class="csp-field">
                    <label>이름</label>
                    <input class="csp-character-name" value="${escapeHtml(getCharacterSlotName(char))}" placeholder="예: 라자엘">
                </div>
                <div class="csp-field">
                    <label>외형 태그</label>
                    <textarea class="csp-character-appearance" placeholder="boy, black hair, glasses...">${escapeHtml(char.appearanceTags || char.tags || '')}</textarea>
                </div>
                <div class="csp-field">
                    <label>기본 의상 태그</label>
                    <textarea class="csp-character-outfit" placeholder="suit, lab coat, office uniform...">${escapeHtml(char.outfitTags || '')}</textarea>
                </div>
                <div class="csp-field">
                    <label>캐릭터별 Undesired Content</label>
                    <textarea class="csp-character-uc" placeholder="silver hair, blue eyes...">${escapeHtml(char.uc || '')}</textarea>
                </div>

                <div class="csp-reference-box">
                    <label class="csp-check-row">
                        <input class="csp-reference-enabled" type="checkbox" ${char.referenceEnabled ? 'checked' : ''}>
                        Precise Reference 사용 <span class="csp-inline-note">(+${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성)</span>
                    </label>
                    <div class="csp-grid-3">
                        <div class="csp-field">
                            <label>Reference Type</label>
                            <select class="csp-reference-type">
                                <option value="character" ${normalizeReferenceType(char.referenceType) === 'character' ? 'selected' : ''}>Character Reference</option>
                                <option value="style" ${normalizeReferenceType(char.referenceType) === 'style' ? 'selected' : ''}>Style Reference</option>
                                <option value="character_style" ${normalizeReferenceType(char.referenceType) === 'character_style' ? 'selected' : ''}>Character & Style Reference</option>
                            </select>
                        </div>
                        <div class="csp-field">
                            <label>Strength</label>
                            <input class="csp-reference-strength" type="number" min="-1" max="1" step="0.05" value="${escapeHtml(String(char.referenceStrength ?? 0.6))}">
                        </div>
                        <div class="csp-field">
                            <label>Fidelity</label>
                            <input class="csp-reference-fidelity" type="number" min="-1" max="1" step="0.05" value="${escapeHtml(String(char.referenceFidelity ?? 0.8))}">
                        </div>
                    </div>
                    <input class="csp-reference-asset-id" type="hidden" value="${escapeHtml(char.referenceAssetId || '')}">
                    <input class="csp-reference-image-name" type="hidden" value="${escapeHtml(char.referenceImageName || '')}">
                    <div class="csp-reference-preview-row">
                        <img class="csp-reference-preview-img" alt="Reference preview" style="display:none;">
                        <div class="csp-reference-preview-actions">
                            <input class="csp-reference-file" type="file" accept="image/png,image/jpeg,image/webp">
                            <button class="csp-btn csp-btn-small csp-reference-delete" type="button" style="display:none;">Reference 삭제</button>
                            <div class="csp-mini-note csp-reference-status">Reference 파일 없음</div>
                        </div>
                    </div>
                    <div class="csp-mini-note">권장: 전신 / 중립 포즈 / 단순 배경 / 얼굴이 잘 보이는 깨끗한 이미지. 업로드 시 선택된 저장 폴더의 <b>CSP_References</b> 하위 폴더에 저장돼.</div>
                </div>
                </div>
            `;

            // 접기/펼치기
            const collapseBtn = card.querySelector('.csp-character-collapse-btn');
            const body = card.querySelector('.csp-character-body');
            const head = card.querySelector('[data-csp-collapse-toggle]');
            let collapsed = false;
            const toggleCollapse = () => {
                collapsed = !collapsed;
                body.style.display = collapsed ? 'none' : '';
                collapseBtn.textContent = collapsed ? '▼' : '▲';
                collapseBtn.title = collapsed ? '펼치기' : '접기';
            };
            collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
            head.addEventListener('click', (e) => { if (e.target !== collapseBtn && !e.target.closest('.csp-remove-character')) toggleCollapse(); });

            // 이름 변경 시 헤더 텍스트 업데이트
            card.querySelector('.csp-character-name').addEventListener('input', (e) => {
                const nameSpan = head.querySelector('span');
                const idx = Array.from(container.querySelectorAll('.csp-character-card')).indexOf(card);
                nameSpan.textContent = `캐릭터 ${idx + 1}${e.target.value ? ' — ' + e.target.value : ''}`;
            });

            card.querySelector('.csp-remove-character').onclick = async () => {
                const cards = Array.from(container.querySelectorAll('.csp-character-card'));
                if (cards.length <= 1) {
                    showToast('⚠️ 캐릭터는 최소 1명은 남겨둬야 해요.');
                    return;
                }
                const assetId = card.querySelector('.csp-reference-asset-id')?.value || '';
                if (assetId) {
                    try { await deleteReferenceFileFromLibrary(assetId); } catch (_) {}
                }
                card.remove();
            };

            const fileInput = card.querySelector('.csp-reference-file');
            const assetIdInput = card.querySelector('.csp-reference-asset-id');
            const imageNameInput = card.querySelector('.csp-reference-image-name');
            const enabledInput = card.querySelector('.csp-reference-enabled');
            const deleteRefBtn = card.querySelector('.csp-reference-delete');

            fileInput?.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                try {
                    let folderHandle = await getStoredDirectoryHandle();
                    if (!folderHandle) {
                        folderHandle = await chooseImageDirectory();
                    } else {
                        const ok = await ensureDirectoryPermission(folderHandle, 'readwrite');
                        if (!ok) throw new Error('저장 폴더 권한이 없어요. 다시 폴더를 연결해줘.');
                    }

                    const oldAssetId = assetIdInput.value;
                    const slotName = card.querySelector('.csp-character-name')?.value.trim() || 'character';
                    const nextAssetId = await saveReferenceFileToLibrary(file, slotName);
                    if (oldAssetId && oldAssetId !== nextAssetId) {
                        try { await deleteReferenceFileFromLibrary(oldAssetId); } catch (_) {}
                    }
                    assetIdInput.value = nextAssetId;
                    imageNameInput.value = file.name || nextAssetId;
                    enabledInput.checked = true;
                    await hydrateReferencePreview(card, nextAssetId);
                    showToast('🖼️ Character Reference 이미지를 폴더에 저장했어요.');
                } catch (err) {
                    showToast('⚠️ Reference 파일 저장 실패: ' + err.message);
                } finally {
                    fileInput.value = '';
                }
            });

            enabledInput?.addEventListener('change', () => {
                hydrateReferencePreview(card, assetIdInput.value);
            });

            deleteRefBtn?.addEventListener('click', async () => {
                const assetId = assetIdInput.value;
                if (assetId) {
                    try { await deleteReferenceFileFromLibrary(assetId); } catch (_) {}
                }
                assetIdInput.value = '';
                imageNameInput.value = '';
                enabledInput.checked = false;
                await hydrateReferencePreview(card, '');
                showToast('🧹 Reference 이미지를 폴더에서 삭제했어요.');
            });

            container.appendChild(card);

            // 일부 브라우저/확장 조합에서 innerHTML의 value attribute만으로는
            // 한글 이름이 input property에 안정적으로 반영되지 않는 사례가 있어 한 번 더 주입한다.
            const nameInput = card.querySelector('.csp-character-name');
            if (nameInput) nameInput.value = getCharacterSlotName(char);

            hydrateReferencePreview(card, char.referenceAssetId || '');
        });
    }

    function collectCharacters(container) {
        return Array.from(container.querySelectorAll('.csp-character-card')).map(card => {
            const appearanceTags = card.querySelector('.csp-character-appearance')?.value.trim() || '';
            const outfitTags = card.querySelector('.csp-character-outfit')?.value.trim() || '';
            return {
                name: String(card.querySelector('.csp-character-name')?.value || '').trim(),
                appearanceTags,
                outfitTags,
                tags: buildCommaPrompt([appearanceTags, outfitTags]),
                uc: card.querySelector('.csp-character-uc')?.value.trim() || '',
                referenceEnabled: !!card.querySelector('.csp-reference-enabled')?.checked,
                referenceType: normalizeReferenceType(card.querySelector('.csp-reference-type')?.value || 'character'),
                referenceAssetId: card.querySelector('.csp-reference-asset-id')?.value.trim() || '',
                referenceImageName: card.querySelector('.csp-reference-image-name')?.value.trim() || '',
                referenceStrength: clampNumber(card.querySelector('.csp-reference-strength')?.value, -1, 1, 0.6),
                referenceFidelity: clampNumber(card.querySelector('.csp-reference-fidelity')?.value, -1, 1, 0.8)
            };
        }).filter(hasCharacterSlotContent);
    }

    function clearRoomSceneRecords() {
        const records = getSceneRecords();
        Object.values(records || {}).forEach(record => {
            if (record?.promptArchiveId) {
                deleteStoredMeta(record.promptArchiveId).catch(() => {});
            }
        });
        localStorage.removeItem(getSceneRecordsKey());
        document.querySelectorAll('.csp-generated-scene-image, .csp-image-history-row').forEach(el => el.remove());
        document.querySelectorAll('.csp-message-generate-btn, .csp-message-speed-btn').forEach(btn => btn.removeAttribute('data-csp-has-image'));
        updateGalleryRowCount();
    }

    function openSettingsModal() {
        injectStyles();
        const existing = document.getElementById('csp-settings-modal');
        if (existing) existing.remove();

        const global = getGlobalSettings();
        const room = getRoomSettings();
        const settings = global.naiSettings || getDefaultGlobalSettings().naiSettings;
        const roomId = getRoomId();

        const overlay = document.createElement('div');
        overlay.id = 'csp-settings-modal';
        overlay.className = 'csp-overlay';

        overlay.innerHTML = `
            <div class="csp-modal" role="dialog" aria-modal="true">
                <h2>🎨 Uni Scene Painter 설정</h2>
                <div class="csp-desc">
                    Gemini: 장면/삽입 위치 분석<br>NAI: 실제 이미지 생성<br>채팅방 ID: <b>${escapeHtml(roomId)}</b>
                </div>

                <div class="csp-tab-shell">
                    <div class="csp-tab-list" role="tablist" aria-label="Scene Painter 설정 탭">
                        <button class="csp-tab-btn is-active" type="button" data-csp-tab="api" role="tab" aria-selected="true">🔑 API</button>
                        <button class="csp-tab-btn" type="button" data-csp-tab="characters" role="tab" aria-selected="false">🎭 캐릭터</button>
                        <button class="csp-tab-btn" type="button" data-csp-tab="prompts" role="tab" aria-selected="false">✍️ 프롬프트</button>
                        <button class="csp-tab-btn" type="button" data-csp-tab="advanced" role="tab" aria-selected="false">⚙️ 고급</button>
                    </div>
                    <div class="csp-tab-panels">
                        <div class="csp-tab-panel is-active" data-csp-tab-panel="api" role="tabpanel">
                <div class="csp-section">
                    <div class="csp-section-title">API 설정</div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Gemini API 방식</label>
                            <select id="csp-gemini-provider">
                                <option value="ai-studio" ${(global.geminiProvider || 'ai-studio') === 'ai-studio' ? 'selected' : ''}>Google AI Studio API Key</option>
                                <option value="vertex" ${global.geminiProvider === 'vertex' ? 'selected' : ''}>Vertex AI OAuth</option>
                                <option value="firebase" ${global.geminiProvider === 'firebase' ? 'selected' : ''}>Firebase AI Logic Beta</option>
                                <option value="openai" ${global.geminiProvider === 'openai' ? 'selected' : ''}>OpenAI (GPT)</option>
                                <option value="anthropic" ${global.geminiProvider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
                                <option value="glm" ${global.geminiProvider === 'glm' ? 'selected' : ''}>Zhipu AI (GLM)</option>
                                <option value="openrouter" ${global.geminiProvider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
                            </select>
                        </div>
                        <div class="csp-field">
                            <label>Gemini 모델</label>
                            <select id="csp-google-model">
                                <option value="gemini-3-pro-preview" ${normalizeGeminiModelId(global.googleModel) === 'gemini-3-pro-preview' ? 'selected' : ''}>gemini-3-pro-preview</option>
                                <option value="gemini-3.5-flash" ${normalizeGeminiModelId(global.googleModel) === 'gemini-3.5-flash' ? 'selected' : ''}>gemini-3.5-flash</option>
                                <option value="gemini-3.1-pro" ${normalizeGeminiModelId(global.googleModel) === 'gemini-3.1-pro' ? 'selected' : ''}>gemini-3.1-pro</option>
                                <option value="gemini-3.1-flash-lite" ${normalizeGeminiModelId(global.googleModel) === 'gemini-3.1-flash-lite' ? 'selected' : ''}>gemini-3.1-flash-lite</option>
                                <option value="gemini-2.5-pro" ${normalizeGeminiModelId(global.googleModel) === 'gemini-2.5-pro' ? 'selected' : ''}>gemini-2.5-pro</option>
                                <option value="gemini-2.5-flash" ${normalizeGeminiModelId(global.googleModel) === 'gemini-2.5-flash' ? 'selected' : ''}>gemini-2.5-flash</option>
                                <option value="gemini-2.5-flash-lite" ${normalizeGeminiModelId(global.googleModel) === 'gemini-2.5-flash-lite' ? 'selected' : ''}>gemini-2.5-flash-lite</option>
                            </select>
                        </div>
                    </div>
                    <div class="csp-field">
                        <label>Google Gemini API Key</label>
                        <input id="csp-google-key" type="password" value="${escapeHtml(global.googleApiKey)}" placeholder="AI Studio API 키">
                    </div>
                    <div class="csp-section-subbox" id="csp-openai-section" style="display:none;">
                        <div class="csp-section-title">OpenAI 설정</div>
                        <div class="csp-grid">
                            <div class="csp-field">
                                <label>OpenAI 모델</label>
                                <select id="csp-openai-model">
                                    <option value="gpt-4o" ${(global.openaiModel||'gpt-4o')==='gpt-4o'?'selected':''}>gpt-4o</option>
                                    <option value="gpt-4o-mini" ${global.openaiModel==='gpt-4o-mini'?'selected':''}>gpt-4o-mini</option>
                                    <option value="gpt-4-turbo" ${global.openaiModel==='gpt-4-turbo'?'selected':''}>gpt-4-turbo</option>
                                    <option value="gpt-4.1" ${global.openaiModel==='gpt-4.1'?'selected':''}>gpt-4.1</option>
                                    <option value="gpt-4.1-mini" ${global.openaiModel==='gpt-4.1-mini'?'selected':''}>gpt-4.1-mini</option>
                                    <option value="gpt-4.1-nano" ${global.openaiModel==='gpt-4.1-nano'?'selected':''}>gpt-4.1-nano</option>
                                    <option value="o3-mini" ${global.openaiModel==='o3-mini'?'selected':''}>o3-mini</option>
                                    <option value="o4-mini" ${global.openaiModel==='o4-mini'?'selected':''}>o4-mini</option>
                                </select>
                            </div>
                            <div class="csp-field">
                                <label>OpenAI API Key</label>
                                <input id="csp-openai-key" type="password" value="${escapeHtml(global.openaiApiKey||'')}" placeholder="sk-...">
                            </div>
                        </div>
                    </div>
                    <div class="csp-section-subbox" id="csp-anthropic-section" style="display:none;">
                        <div class="csp-section-title">Anthropic Claude 설정</div>
                        <div class="csp-grid">
                            <div class="csp-field">
                                <label>Claude 모델</label>
                                <select id="csp-claude-model">
                                    <option value="claude-opus-4-5" ${(global.claudeModel||'claude-sonnet-4-5')==='claude-opus-4-5'?'selected':''}>claude-opus-4-5</option>
                                    <option value="claude-sonnet-4-5" ${(global.claudeModel||'claude-sonnet-4-5')==='claude-sonnet-4-5'?'selected':''}>claude-sonnet-4-5</option>
                                    <option value="claude-haiku-4-5" ${global.claudeModel==='claude-haiku-4-5'?'selected':''}>claude-haiku-4-5</option>
                                    <option value="claude-opus-4" ${global.claudeModel==='claude-opus-4'?'selected':''}>claude-opus-4</option>
                                    <option value="claude-sonnet-4" ${global.claudeModel==='claude-sonnet-4'?'selected':''}>claude-sonnet-4</option>
                                    <option value="claude-3-7-sonnet-20250219" ${global.claudeModel==='claude-3-7-sonnet-20250219'?'selected':''}>claude-3-7-sonnet-20250219</option>
                                    <option value="claude-3-5-sonnet-20241022" ${global.claudeModel==='claude-3-5-sonnet-20241022'?'selected':''}>claude-3-5-sonnet-20241022</option>
                                    <option value="claude-3-5-haiku-20241022" ${global.claudeModel==='claude-3-5-haiku-20241022'?'selected':''}>claude-3-5-haiku-20241022</option>
                                </select>
                            </div>
                            <div class="csp-field">
                                <label>Anthropic API Key</label>
                                <input id="csp-anthropic-key" type="password" value="${escapeHtml(global.anthropicApiKey||'')}" placeholder="sk-ant-...">
                            </div>
                        </div>
                    </div>
                    <div class="csp-section-subbox" id="csp-glm-section" style="display:none;">
                        <div class="csp-section-title">Zhipu AI (GLM) 설정</div>
                        <div class="csp-mini-note">bigmodel.cn에서 API Key 발급. 무료 모델은 속도가 느릴 수 있어.</div>
                        <div class="csp-grid">
                            <div class="csp-field">
                                <label>GLM 모델</label>
                                <select id="csp-glm-model">
                                    <option value="glm-4.5-flash" ${(global.glmModel||'glm-4.5-flash')==='glm-4.5-flash'?'selected':''}>GLM-4.5-Flash (무료)</option>
                                    <option value="glm-4.7-flash" ${global.glmModel==='glm-4.7-flash'?'selected':''}>GLM-4.7-Flash (무료)</option>
                                </select>
                            </div>
                            <div class="csp-field">
                                <label>Zhipu AI API Key</label>
                                <input id="csp-glm-key" type="password" value="${escapeHtml(global.glmApiKey||'')}" placeholder="Zhipu AI API Key">
                            </div>
                        </div>
                    </div>
                    <div class="csp-section-subbox" id="csp-openrouter-section" style="display:none;">
                        <div class="csp-section-title">OpenRouter 설정</div>
                        <div class="csp-mini-note">openrouter.ai에서 API Key 발급. 무료 모델은 :free 접미사가 붙어.</div>
                        <div class="csp-grid">
                            <div class="csp-field">
                                <label>OpenRouter 모델 ID</label>
                                <input id="csp-openrouter-model" value="${escapeHtml(global.openrouterModel||'google/gemini-2.0-flash-exp:free')}" placeholder="예: google/gemini-2.0-flash-exp:free">
                                <div class="csp-mini-note">openrouter.ai/models 에서 확인. 무료 모델은 뒤에 :free 붙여.</div>
                            </div>
                            <div class="csp-field">
                                <label>OpenRouter API Key</label>
                                <input id="csp-openrouter-key" type="password" value="${escapeHtml(global.openrouterApiKey||'')}" placeholder="sk-or-v1-...">
                            </div>
                        </div>
                    </div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Vertex Project ID</label>
                            <input id="csp-vertex-project" value="${escapeHtml(global.vertexProjectId || '')}" placeholder="my-gcp-project-id">
                        </div>
                        <div class="csp-field">
                            <label>Vertex Location</label>
                            <input id="csp-vertex-location" value="${escapeHtml(global.vertexLocation || 'us-central1')}" placeholder="us-central1 또는 global">
                        </div>
                    </div>
                    <div class="csp-field">
                        <label>Vertex OAuth Access Token</label>
                        <input id="csp-vertex-token" type="password" value="${escapeHtml(global.vertexAccessToken || '')}" placeholder="ya29...">
                        <div class="csp-mini-note">Vertex AI 사용 시 입력해.<br>Gemini 3.x에서 404가 나면 Vertex Location을 global로 바꿔봐.</div>
                    </div>
                    <div class="csp-field">
                        <label>Firebase Config JSON / JS 객체 <span class="csp-mini-note">(Beta)</span></label>
                        <textarea id="csp-firebase-config" placeholder='const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };'>${escapeHtml(global.firebaseConfigJson || '')}</textarea>
                        <div class="csp-mini-note">Firebase AI Logic Beta용이야.<br>Firebase 콘솔에서 복사한 firebaseConfig 객체를 그대로 붙여넣어.<br>이 모드에서는 Vertex OAuth Access Token을 쓰지 않아.</div>
                    </div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Firebase Location</label>
                            <input id="csp-firebase-location" value="${escapeHtml(global.firebaseLocation || 'global')}" placeholder="global">
                        </div>
                        <div class="csp-field">
                            <label>Firebase SDK Version</label>
                            <input id="csp-firebase-sdk-version" value="${escapeHtml(global.firebaseSdkVersion || '12.5.0')}" placeholder="12.5.0">
                        </div>
                    </div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>NAI 모델</label>
                            <input id="csp-nai-model" value="${escapeHtml(global.naiModel || 'nai-diffusion-4-5-full')}" placeholder="nai-diffusion-4-5-full">
                        </div>
                        <div class="csp-field">
                            <label>NAI API Key / Token</label>
                            <input id="csp-nai-key" type="password" value="${escapeHtml(global.naiApiKey)}" placeholder="NAI API 키 또는 토큰">
                        </div>
                    </div>
                </div>
                        </div>
                        <div class="csp-tab-panel" data-csp-tab-panel="characters" role="tabpanel">
                <div class="csp-section">
                    <div class="csp-section-title">현재 채팅방 Character Prompt 슬롯</div>
                    <div class="csp-mini-note">이 방에만 저장되는 캐릭터 슬롯이야. 여러 방에서 같은 캐릭터를 쓸 땐 아래 퀵 슬롯으로 저장/불러오기 가능.</div>
                    <div id="csp-character-list"></div>
                    <button class="csp-btn csp-btn-small" id="csp-add-character" type="button">+ 캐릭터 추가</button>

                    <div class="csp-section-subbox">
                        <div class="csp-section-title">퀵 슬롯</div>
                        <div class="csp-mini-note">현재 캐릭터 슬롯 묶음을 전역 저장해두고, 다른 채팅방에서 바로 불러올 수 있어.</div>
                        <div class="csp-grid csp-quick-slot-grid">
                            <div class="csp-field">
                                <label>저장 / 덮어쓰기 이름</label>
                                <input id="csp-quick-slot-name" placeholder="@뤼붕이, @뤼붕이1">
                            </div>
                            <div class="csp-field">
                                <label>불러올 퀵 슬롯</label>
                                <select id="csp-quick-slot-select">${buildQuickSlotOptions(global.characterQuickSlots || [])}</select>
                            </div>
                        </div>
                        <div class="csp-actions-left csp-quick-slot-actions">
                            <button class="csp-btn csp-btn-small" id="csp-quick-slot-save" type="button">저장 / 덮어쓰기</button>
                            <button class="csp-btn csp-btn-small" id="csp-quick-slot-load" type="button">불러오기</button>
                            <button class="csp-btn csp-btn-small csp-btn-danger" id="csp-quick-slot-delete" type="button">삭제</button>
                        </div>
                    </div>
                </div>
                        </div>
                        <div class="csp-tab-panel" data-csp-tab-panel="prompts" role="tabpanel">
                <div class="csp-section">
                    <div class="csp-section-title">공통 고정 프롬프트</div>
                    <div class="csp-field">
                        <label>고정 Positive / 작가태그</label>
                        <textarea id="csp-base-positive" class="csp-long" placeholder="artist tags, base style tags...">${escapeHtml(global.basePositive || '')}</textarea>
                    </div>
                    <div class="csp-field">
                        <div class="csp-label-row">
                            <label>고정 Negative / UC</label>
                            <select id="csp-default-uc-preset" title="NovelAI Undesired Content Preset" style="max-width: 180px;">
                                ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                            </select>
                        </div>
                        <textarea id="csp-base-negative" class="csp-long" placeholder="bad anatomy, blurry...">${escapeHtml(global.baseNegative || '')}</textarea>
                        <div class="csp-mini-note">기본 생성/리롤 설정에 사용할 NAI UC 프리셋. 실제 생성 시 직접 쓴 UC와 합쳐서 전송돼.</div>
                    </div>
                    <div class="csp-field">
                        <label>Gemini 장면 태그 지침</label>
                        <div class="csp-mini-note">장면 태그 생성용 보조 지침.<br>짧고 안정적인 태그를 만들 때 사용해.</div>
                        <textarea id="csp-nai-prompt-guide" class="csp-long">${escapeHtml(global.naiPromptGuide || getDefaultNaiPromptGuide())}</textarea>
                    </div>
                </div>
                <div class="csp-section">
                    <div class="csp-section-title">Gemini 분석 지침</div>
                    <div class="csp-field">
                        <label>Gemini 분석 지침<br><span class="csp-mini-note">로그를 읽고 장면 태그를 만들 때 사용</span></label>
                        <textarea id="csp-gemini-instruction" class="csp-long">${escapeHtml(global.geminiInstruction)}</textarea>
                    </div>
                </div>
                        </div>
                        <div class="csp-tab-panel" data-csp-tab-panel="advanced" role="tabpanel">
                <div class="csp-section">
                    <div class="csp-section-title">🎬 다중 장면 생성</div>
                    <div class="csp-mini-note">한 AI 답변에서 여러 장면을 골라 각각 이미지를 만들어. 장면 수가 많을수록 Anlas 소모가 늘어.</div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>장면 수 <span style="background:#f59e0b;color:#fff;font-size:10px;padding:1px 6px;border-radius:99px;font-weight:700;vertical-align:middle;margin-left:4px;">BETA</span></label>
                            <select id="csp-multi-scene-count">
                                <option value="1" ${(global.multiSceneCount||1) == 1 ? 'selected' : ''}>1장면 (기본)</option>
                                <option value="2" ${(global.multiSceneCount||1) == 2 ? 'selected' : ''}>2장면</option>
                                <option value="3" ${(global.multiSceneCount||1) == 3 ? 'selected' : ''}>3장면</option>
                            </select>
                            <div class="csp-mini-note">2장면 이상이면 분석→생성→삽입을 장면 수만큼 반복해. 스피드 모드도 동일.</div>
                        </div>
                    </div>
                </div>
                <div class="csp-section">
                    <div class="csp-section-title">공통 NAI 생성 설정</div>
                    <div class="csp-mini-note">SMEA/DYN·다중 생성은 비활성화.<br>항상 1장만 생성해.</div>
                    <div class="csp-grid">
                        <div class="csp-field">
                            <label>Resolution</label>
                            <div class="csp-res-row">
                                <select id="csp-default-orientation">
                                    <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                    <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                    <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                </select>
                                <div class="csp-res-dims">
                                    <input id="csp-default-width" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                    <input id="csp-default-height" class="csp-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                    <span class="csp-dim-pill" id="csp-default-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                    <button class="csp-dim-swap" id="csp-default-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                    <span class="csp-dim-pill" id="csp-default-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                </div>
                            </div>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Steps</label><span class="csp-value-chip" id="csp-default-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-default-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                <input id="csp-default-steps" class="csp-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                            </div>
                            <div class="csp-mini-note">29 이상부터 추가 Anlas 소모.</div>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Prompt Guidance</label><span class="csp-value-chip" id="csp-default-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-default-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                <input id="csp-default-scale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                            </div>
                        </div>
                        <div class="csp-field">
                            <label>Seed</label>
                            <input id="csp-default-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                        </div>
                        <div class="csp-field">
                            <label>Sampler</label>
                            <select id="csp-default-sampler">
                                <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                            </select>
                        </div>
                        <div class="csp-field">
                            <div class="csp-label-row"><label>Prompt Guidance Rescale</label><span class="csp-value-chip" id="csp-default-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                            <div class="csp-range-wrap">
                                <input id="csp-default-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                <input id="csp-default-guidance-rescale" class="csp-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                            </div>
                        </div>
                        <div class="csp-field">
                            <label>Noise Schedule</label>
                            <select id="csp-default-noise-schedule">
                                <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                            </select>
                        </div>
                    </div>
                </div>
                <div class="csp-section">
                    <div class="csp-section-title">이미지 저장</div>
                    <label class="csp-check-row">
                        <input id="csp-folder-save-enabled" type="checkbox" ${global.folderSaveEnabled ? 'checked' : ''}>
                        NAI 생성 이미지를 선택 폴더에도 자동 저장<br><span class="csp-mini-note">Reference 이미지는 CSP_References 폴더 사용</span>
                    </label>
                    <div class="csp-actions-left">
                        <button class="csp-btn csp-btn-small" id="csp-choose-image-folder" type="button">이미지 저장 폴더 선택</button>
                        <button class="csp-btn csp-btn-small" id="csp-clear-image-folder" type="button">폴더 연결 해제</button>
                    </div>
                    <div class="csp-mini-note" id="csp-folder-status">폴더 상태 확인 중...</div>
                </div>
                <div class="csp-section">
                    <div class="csp-section-title">저장소 관리</div>
                    <div class="csp-mini-note">
                        v4.23부터 설정/삽화 기록은 자동 압축 저장하고, 긴 프롬프트 상세는 IndexedDB 보조 저장소로 분리해 localStorage 용량 초과를 줄여.
                    </div>
                    <div class="csp-storage-status" id="csp-storage-status">저장소 상태 확인 중...</div>
                    <div class="csp-actions-left">
                        <button class="csp-btn csp-btn-small" id="csp-storage-refresh" type="button">저장소 진단</button>
                        <button class="csp-btn csp-btn-small" id="csp-storage-compress" type="button">기존 기록 압축</button>
                    </div>
                    <div class="csp-mini-note">
                        갤러리 이미지 파일은 기존처럼 IndexedDB/폴더에 저장되고, 여기서는 “어느 문단 뒤에 붙일지” 같은 목차 기록을 가볍게 관리해.
                    </div>
                </div>
                        </div>
                    </div>
                </div>
                <div class="csp-actions">
                    <div class="csp-actions-left">
                        <button class="csp-btn csp-btn-danger" id="csp-clear-room-images">이 방의 삽화 기록 삭제</button>
                    </div>
                    <div class="csp-actions-right">
                        <button class="csp-btn" id="csp-close">취소</button>
                        <button class="csp-btn csp-btn-primary" id="csp-save">저장</button>
                    </div>
                </div>
            </div>
        `;

        const tabButtons = Array.from(overlay.querySelectorAll('.csp-tab-btn'));
        const tabPanels = Array.from(overlay.querySelectorAll('.csp-tab-panel'));
        tabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const tabName = button.dataset.cspTab;
                tabButtons.forEach((item) => {
                    const active = item === button;
                    item.classList.toggle('is-active', active);
                    item.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                tabPanels.forEach((panel) => {
                    panel.classList.toggle('is-active', panel.dataset.cspTabPanel === tabName);
                });
            });
        });

        const characterList = overlay.querySelector('#csp-character-list');
        let quickCharacterSlots = Array.isArray(global.characterQuickSlots) ? global.characterQuickSlots.slice() : [];
        renderCharacterCards(characterList, room.characters);

        const quickSlotNameEl = overlay.querySelector('#csp-quick-slot-name');
        const quickSlotSelectEl = overlay.querySelector('#csp-quick-slot-select');

        function refreshQuickSlotSelect(selectedName = '') {
            if (!quickSlotSelectEl) return;
            quickSlotSelectEl.innerHTML = buildQuickSlotOptions(quickCharacterSlots, selectedName);
        }

        overlay.querySelector('#csp-add-character').onclick = () => {
            const current = collectCharacters(characterList);
            current.push({ name: '', appearanceTags: '', outfitTags: '', tags: '', uc: '', referenceEnabled: false, referenceType: 'character', referenceAssetId: '', referenceImageName: '', referenceStrength: 0.6, referenceFidelity: 0.8 });
            renderCharacterCards(characterList, current);
        };


        overlay.querySelector('#csp-quick-slot-save')?.addEventListener('click', () => {
            const name = String(quickSlotNameEl?.value || '').trim();
            if (!name) {
                showToast('⚠️ 퀵 슬롯 이름을 입력해줘.');
                quickSlotNameEl?.focus();
                return;
            }

            const characters = cloneCharacterSlots(collectCharacters(characterList));
            if (!characters.length || !characters.some(hasCharacterSlotContent)) {
                showToast('⚠️ 저장할 캐릭터 슬롯이 비어 있어요.');
                return;
            }

            const nextSlot = { name, characters, updatedAt: Date.now() };
            console.log('[Crack Scene Painter] Quick slot save:', {
                slotName: name,
                characterNames: characters.map(getCharacterSlotName)
            });
            const existingIndex = quickCharacterSlots.findIndex(slot => String(slot.name || '').trim() === name);
            if (existingIndex >= 0) quickCharacterSlots[existingIndex] = nextSlot;
            else quickCharacterSlots.push(nextSlot);

            refreshQuickSlotSelect(name);
            showToast(`✅ 퀵 슬롯 저장 완료: ${name}`);
        });

        overlay.querySelector('#csp-quick-slot-load')?.addEventListener('click', () => {
            const name = String(quickSlotSelectEl?.value || '').trim();
            const slot = getQuickSlotByName(quickCharacterSlots, name);
            if (!slot) {
                showToast('⚠️ 불러올 퀵 슬롯이 없어요.');
                return;
            }

            const characters = cloneCharacterSlots(slot.characters);
            console.log('[Crack Scene Painter] Quick slot load:', {
                slotName: slot.name,
                characterNames: characters.map(getCharacterSlotName)
            });
            renderCharacterCards(characterList, characters);
            if (quickSlotNameEl) quickSlotNameEl.value = slot.name;
            showToast(`📥 퀵 슬롯 불러옴: ${slot.name}`);
        });

        overlay.querySelector('#csp-quick-slot-delete')?.addEventListener('click', () => {
            const name = String(quickSlotSelectEl?.value || '').trim();
            if (!name) {
                showToast('⚠️ 삭제할 퀵 슬롯이 없어요.');
                return;
            }
            if (!confirm(`퀵 슬롯 "${name}"을 삭제할까요?`)) return;
            quickCharacterSlots = quickCharacterSlots.filter(slot => String(slot.name || '').trim() !== name);
            refreshQuickSlotSelect('');
            if (quickSlotNameEl?.value.trim() === name) quickSlotNameEl.value = '';
            showToast(`🗑️ 퀵 슬롯 삭제 완료: ${name}`);
        });

        const defaultOrientationEl = overlay.querySelector('#csp-default-orientation');
        const defaultWidthEl = overlay.querySelector('#csp-default-width');
        const defaultHeightEl = overlay.querySelector('#csp-default-height');
        const defaultWidthViewEl = overlay.querySelector('#csp-default-width-view');
        const defaultHeightViewEl = overlay.querySelector('#csp-default-height-view');
        const defaultSwapBtn = overlay.querySelector('#csp-default-swap');
        if (defaultOrientationEl && defaultWidthEl && defaultHeightEl) {
            applyOrientationPreset(defaultOrientationEl.value, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl);
            defaultOrientationEl.addEventListener('change', () => applyOrientationPreset(defaultOrientationEl.value, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl));
            defaultSwapBtn?.addEventListener('click', () => swapOrientationPreset(defaultOrientationEl, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl));
        }
        bindRangeNumberPair(overlay.querySelector('#csp-default-steps-range'), overlay.querySelector('#csp-default-steps'), overlay.querySelector('#csp-default-steps-value'), { min: 1, max: 50, step: 1, decimals: 0 });
        bindRangeNumberPair(overlay.querySelector('#csp-default-scale-range'), overlay.querySelector('#csp-default-scale'), overlay.querySelector('#csp-default-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#csp-default-guidance-rescale-range'), overlay.querySelector('#csp-default-guidance-rescale'), overlay.querySelector('#csp-default-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });

        const folderStatusEl = overlay.querySelector('#csp-folder-status');
        async function refreshFolderStatus() {
            if (!folderStatusEl) return;
            folderStatusEl.textContent = '폴더 상태 확인 중...';

            try {
                const handle = await withTimeout(getStoredDirectoryHandle(), 3500, '폴더 상태 확인');
                if (!handle) {
                    folderStatusEl.textContent = '선택된 폴더 없음 · Reference는 IndexedDB fallback으로도 저장 가능';
                    return;
                }
                const permission = await withTimeout(
                    handle.queryPermission({ mode: 'readwrite' }),
                    2500,
                    '폴더 권한 확인'
                );
                folderStatusEl.textContent = `선택됨: ${handle.name || '(폴더)'} / 권한: ${permission} / Ref 폴더: ${REFERENCE_SUBDIR_NAME}`;
            } catch (err) {
                folderStatusEl.textContent = `폴더 상태 확인 실패: ${err.message} · Reference는 IndexedDB fallback 사용 가능`;
            }
        }
        overlay.querySelector('#csp-choose-image-folder').onclick = async () => {
            try {
                folderStatusEl.textContent = '폴더 설정 중...';
                const handle = await chooseImageDirectory();
                folderStatusEl.textContent = `선택됨: ${handle.name || '(폴더)'} / 권한: granted / Ref 폴더: ${REFERENCE_SUBDIR_NAME}`;
                overlay.querySelector('#csp-folder-save-enabled').checked = true;
                showToast('📁 이미지 저장 폴더를 선택했어요.');
            } catch (err) {
                folderStatusEl.textContent = '폴더 설정 실패: ' + err.message;
                showToast('⚠️ 폴더 선택 실패: ' + err.message);
            }
        };
        overlay.querySelector('#csp-clear-image-folder').onclick = async () => {
            await deleteStoredDirectoryHandle();
            overlay.querySelector('#csp-folder-save-enabled').checked = false;
            await refreshFolderStatus();
            showToast('🧹 폴더 연결을 해제했어요.');
        };
        const storageStatusEl = overlay.querySelector('#csp-storage-status');
        function refreshStorageStatus() {
            if (!storageStatusEl) return;
            const report = getCspStorageReport();
            const topRows = report.topCspRows.map(row => `${row.key.replace(CSP_PREFIX + '_', '')}: ${row.kb}KB${row.compressed ? ' · 압축' : ''}`).join(' / ');
            storageStatusEl.innerHTML = `
                <div><b>CSP 저장량:</b> ${escapeHtml(String(report.cspKB))}KB · <b>전체 localStorage:</b> ${escapeHtml(String(report.totalKB))}KB · <b>CSP 키:</b> ${escapeHtml(String(report.cspKeyCount))}개</div>
                <div class="csp-storage-top">${escapeHtml(topRows || 'CSP 저장값 없음')}</div>
            `;
        }

        overlay.querySelector('#csp-storage-refresh')?.addEventListener('click', () => {
            refreshStorageStatus();
            showToast('📊 저장소 상태를 확인했어요.');
        });

        overlay.querySelector('#csp-storage-compress')?.addEventListener('click', () => {
            const changed = migrateLocalJsonStorageToCompressed();
            refreshStorageStatus();
            showToast(changed ? `🧹 기존 기록 ${changed}개를 압축했어요.` : '✅ 이미 압축되어 있거나 압축할 기록이 없어요.');
        });

        refreshStorageStatus();

        refreshFolderStatus();

        // ── 제공자별 설정 섹션 토글 ──────────────────────────────────────
        function updateProviderSections() {
            const provider = overlay.querySelector('#csp-gemini-provider').value;
            const isGemini = ['ai-studio', 'vertex', 'firebase'].includes(provider);

            // csp-google-model 필드만 숨김 (provider select와 같은 grid이므로 grid 전체는 건드리지 않음)
            const googleModelField = overlay.querySelector('#csp-google-model');
            if (googleModelField) {
                const wrap = googleModelField.closest('.csp-field');
                if (wrap) wrap.style.display = isGemini ? '' : 'none';
            }

            // 나머지 Gemini 전용 필드들 (각자 .csp-field 또는 .csp-section-subbox 단위로 숨김)
            const geminiOnlyIds = ['csp-google-key',
                'csp-vertex-project', 'csp-vertex-location', 'csp-vertex-token',
                'csp-firebase-config', 'csp-firebase-location', 'csp-firebase-sdk-version'];
            geminiOnlyIds.forEach(id => {
                const el = overlay.querySelector('#' + id);
                if (!el) return;
                const wrap = el.closest('.csp-field') || el.closest('.csp-section-subbox');
                if (wrap) wrap.style.display = isGemini ? '' : 'none';
            });

            // Vertex grid (Project ID + Location 묶음), Firebase sdk grid 숨김
            ['csp-vertex-project', 'csp-firebase-location'].forEach(id => {
                const el = overlay.querySelector('#' + id);
                if (!el) return;
                const grid = el.closest('.csp-grid');
                if (grid) grid.style.display = isGemini ? '' : 'none';
            });

            // 새 제공자 섹션 표시
            const openaiSection = overlay.querySelector('#csp-openai-section');
            const anthropicSection = overlay.querySelector('#csp-anthropic-section');
            const openrouterSection = overlay.querySelector('#csp-openrouter-section');
            if (openaiSection) openaiSection.style.display = provider === 'openai' ? '' : 'none';
            if (anthropicSection) anthropicSection.style.display = provider === 'anthropic' ? '' : 'none';
            if (openrouterSection) openrouterSection.style.display = provider === 'openrouter' ? '' : 'none';
            const glmSection = overlay.querySelector('#csp-glm-section');
            if (glmSection) glmSection.style.display = provider === 'glm' ? '' : 'none';
        }
        overlay.querySelector('#csp-gemini-provider').addEventListener('change', updateProviderSections);
        updateProviderSections(); // 초기 상태 적용

        function collectGlobal() {
            return {
                geminiProvider: overlay.querySelector('#csp-gemini-provider').value,
                googleApiKey: overlay.querySelector('#csp-google-key').value.trim(),
                googleModel: normalizeGeminiModelId(overlay.querySelector('#csp-google-model').value),
                openaiApiKey: overlay.querySelector('#csp-openai-key').value.trim(),
                openaiModel: overlay.querySelector('#csp-openai-model').value,
                anthropicApiKey: overlay.querySelector('#csp-anthropic-key').value.trim(),
                claudeModel: overlay.querySelector('#csp-claude-model').value,
                glmApiKey: overlay.querySelector('#csp-glm-key').value.trim(),
                glmModel: overlay.querySelector('#csp-glm-model').value,
                openrouterApiKey: overlay.querySelector('#csp-openrouter-key').value.trim(),
                openrouterModel: overlay.querySelector('#csp-openrouter-model').value.trim(),
                vertexProjectId: overlay.querySelector('#csp-vertex-project').value.trim(),
                vertexLocation: overlay.querySelector('#csp-vertex-location').value.trim() || 'us-central1',
                vertexAccessToken: overlay.querySelector('#csp-vertex-token').value.trim(),
                firebaseConfigJson: overlay.querySelector('#csp-firebase-config').value.trim(),
                firebaseLocation: overlay.querySelector('#csp-firebase-location').value.trim() || 'global',
                firebaseSdkVersion: overlay.querySelector('#csp-firebase-sdk-version').value.trim() || '12.5.0',
                naiApiKey: overlay.querySelector('#csp-nai-key').value.trim(),
                naiModel: overlay.querySelector('#csp-nai-model').value.trim() || 'nai-diffusion-4-5-full',
                folderSaveEnabled: overlay.querySelector('#csp-folder-save-enabled').checked,
                multiSceneCount: Number(overlay.querySelector('#csp-multi-scene-count')?.value || 1),
                geminiInstruction: overlay.querySelector('#csp-gemini-instruction').value.trim(),
                basePositive: overlay.querySelector('#csp-base-positive').value.trim(),
                baseNegative: overlay.querySelector('#csp-base-negative').value.trim(),
                naiPromptGuide: overlay.querySelector('#csp-nai-prompt-guide').value.trim(),
                naiSettings: {
                    orientationPreset: overlay.querySelector('#csp-default-orientation').value,
                    width: Number(overlay.querySelector('#csp-default-width').value || 832),
                    height: Number(overlay.querySelector('#csp-default-height').value || 1216),
                    steps: Number(overlay.querySelector('#csp-default-steps').value || 28),
                    scale: Number(overlay.querySelector('#csp-default-scale').value || 6.5),
                    guidanceRescale: Number(overlay.querySelector('#csp-default-guidance-rescale').value || 0.3),
                    seed: overlay.querySelector('#csp-default-seed').value.trim(),
                    sampler: overlay.querySelector('#csp-default-sampler').value,
                    noiseSchedule: overlay.querySelector('#csp-default-noise-schedule').value,
                    nSamples: 1,
                    smea: false,
                    dyn: false,
                    ucPreset: Number(overlay.querySelector('#csp-default-uc-preset')?.value || 0)
                },
                characterQuickSlots: quickCharacterSlots
            };
        }

        function collectRoom() {
            const characters = collectCharacters(characterList);
            return {
                characters: characters.length ? characters : [{ name: '', appearanceTags: '', outfitTags: '', tags: '', uc: '' }]
            };
        }

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        overlay.querySelector('#csp-close').onclick = () => overlay.remove();
        overlay.querySelector('#csp-save').onclick = () => {
            try {
                saveGlobalSettings(collectGlobal());
                saveRoomSettings(collectRoom());
                overlay.remove();
                showToast('✅ Scene Painter 설정 저장 완료');
                scheduleInject();
            } catch (err) {
                console.error('[Crack Scene Painter] settings save failed:', err);
                showToast('⚠️ 설정 저장 실패: ' + (err.message || err));
                refreshStorageStatus();
            }
        };

        overlay.querySelector('#csp-clear-room-images').onclick = () => {
            if (!confirm('현재 채팅방의 삽화 기록을 삭제할까요?')) return;
            clearRoomSceneRecords();
            showToast('🧹 이 방의 삽화 기록을 삭제했어요.');
        };

        document.body.appendChild(overlay);
    }

    function setSwitchVisual(switchBtn, thumb, value) {
        if (!switchBtn) return;
        switchBtn.setAttribute('aria-checked', value ? 'true' : 'false');
        switchBtn.setAttribute('data-state', value ? 'checked' : 'unchecked');
        if (thumb) thumb.setAttribute('data-state', value ? 'checked' : 'unchecked'); thumb.style.transform = value ? 'translateX(15px)' : 'translateX(-1px)';
    }

    function makeFallbackRow() {
        const row = document.createElement('div');
        row.className = 'px-2.5 h-4 box-content py-[18px] csp-toggle-row';
        row.innerHTML = `
            <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [&_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer">
                <span class="flex space-x-2 items-center">
                    <span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🎨</span>
                    <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">AI 삽화 생성</span>
                </span>
                <span>
                    <button type="button" role="switch" aria-checked="true" data-state="checked" value="on"
                        class="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors border data-[state=unchecked]:border-bg-input-80 data-[state=unchecked]:bg-bg-input-80 data-[state=checked]:border-primary data-[state=checked]:bg-primary focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
                        tabindex="-1">
                        <span data-state="checked" class="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[15px] data-[state=unchecked]:translate-x-[-1px]"></span>
                    </button>
                </span>
            </div>
        `;
        return row;
    }

    function makeGalleryRow() {
        const row = document.createElement('div');
        row.className = 'px-2.5 h-4 box-content py-[18px] csp-gallery-row';
        row.innerHTML = `
            <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [&_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer">
                <span class="flex space-x-2 items-center">
                    <span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🖼️</span>
                    <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">삽화 갤러리</span>
                </span>
                <span class="csp-gallery-count-badge" title="현재 방 삽화 기록">0</span>
            </div>
        `;
        return row;
    }

    function createSceneGalleryRow() {
        const row = makeGalleryRow();
        row.id = 'csp-scene-gallery-row';
        const rootButton = row.querySelector('[role="button"]');
        if (rootButton) {
            rootButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openGalleryModal();
            });
            rootButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openGalleryModal();
                }
            });
        }
        updateGalleryRowCount();
        return row;
    }

    function createScenePainterRow(originContainer) {
        let row;
        if (originContainer) {
            row = originContainer.cloneNode(true);
            row.classList.add('csp-toggle-row');
            const textSpan = row.querySelector('.typo-text-sm_leading-none_medium');
            if (textSpan) textSpan.textContent = 'AI 삽화 생성';
            const svg = row.querySelector('svg');
            if (svg) {
                svg.outerHTML = `<span style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;">🎨</span>`;
            }
        } else {
            row = makeFallbackRow();
        }

        row.id = 'csp-scene-painter-row';
        const rootButton = row.querySelector('[role="button"]');
        const switchBtn = row.querySelector('button[role="switch"]');
        const thumb = row.querySelector('.pointer-events-none');
        setSwitchVisual(switchBtn, thumb, isEnabled());

        function toggleEnabled(next) {
            setEnabled(next);
            setSwitchVisual(switchBtn, thumb, next);
            applySceneVisibilityState(next);
            if (!next) {
                document.querySelectorAll('.csp-message-generate-btn').forEach(btn => btn.remove());
            } else {
                scheduleInject();
            }
            showToast(next ? '🎨 AI 삽화 생성 ON' : '⏸️ AI 삽화 생성 OFF');
        }

        if (rootButton) {
            rootButton.addEventListener('click', (e) => {
                const clickedSwitch = e.target.closest('button[role="switch"]');
                if (clickedSwitch) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleEnabled(!isEnabled());
                    return;
                }
                openSettingsModal();
            });
        }

        if (switchBtn) {
            switchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleEnabled(!isEnabled());
            });
        }
        return row;
    }

    function findRightSettingsMenuRoot(fromNode) {
        let cur = fromNode;
        let guard = 0;
        while (cur && cur !== document.body && guard < 10) {
            const text = String(cur.textContent || '');
            if (text.includes('상황 이미지 보기')
                && (text.includes('전체 설정') || text.includes('채팅방 설정') || text.includes('이미지 보관함') || text.includes('나의 크래커'))) {
                return cur;
            }
            cur = cur.parentElement;
            guard++;
        }
        return null;
    }

    function findUniversSidebar() {
        // classList.contains로 슬래시 포함 클래스 직접 매칭
        return Array.from(document.querySelectorAll('div')).find(d =>
            d.classList?.contains('bg-background/95') && d.classList?.contains('backdrop-blur-2xl')
        ) || null;
    }

    function findUniversTabButtonRow() {
        // 정보/기억/문체/뷰어 버튼이 있는 탭 행을 직접 찾음 (사이드바 선택자 없이도 동작)
        const tabBtn = Array.from(document.querySelectorAll('button')).find(
            b => ['정보', '기억', '문체', '뷰어'].includes(b.textContent?.trim()) &&
                 b.className?.includes('font-medium')
        );
        return tabBtn ? tabBtn.parentElement : null; // div.border-b.border-border.flex.w-full
    }

    function findSituationImageContainer(root = document) {
        // univers.chat: 탭 버튼 행(.border-b.border-border.flex.w-full)의 부모(.mx-4.mt-3.shrink-0)를 반환
        // injectScenePainterRow가 이 기준점 다음에 CSP 패널을 삽입함
        const tabBtnRow = findUniversTabButtonRow();
        if (tabBtnRow) return tabBtnRow.parentElement || null;
        // fallback: 사이드바 직접 찾기
        const sidebar = findUniversSidebar();
        if (!sidebar) return null;
        return sidebar.querySelector('.mx-4.mt-3.shrink-0') || null;
    }
    function ensureGalleryAfterPainter(painterRow) {
        if (!painterRow || !painterRow.parentNode) return;
        let gallery = document.getElementById('csp-scene-gallery-row');
        if (!gallery) gallery = createSceneGalleryRow();
        if (gallery.parentNode !== painterRow.parentNode || gallery.previousElementSibling !== painterRow) {
            painterRow.parentNode.insertBefore(gallery, painterRow.nextSibling);
        }
        updateGalleryRowCount();
    }

    function isViewerTabActive() {
        // 뷰어 탭 버튼이 활성화 상태인지 확인
        // 비활성 탭은 항상 text-muted-foreground 클래스를 가짐
        // 활성 탭은 text-muted-foreground 클래스가 없음
        const viewerBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent?.trim() === '뷰어' && b.className?.includes('font-medium')
        );
        if (!viewerBtn) return false;
        return !viewerBtn.className.includes('text-muted-foreground');
    }

    function findViewerTabContent() {
        // 뷰어 탭 콘텐츠 공유 컨테이너(p-4.space-y-4) 반환
        const tabBtnRow = findUniversTabButtonRow();
        if (!tabBtnRow) return null;
        const sidebarRoot = tabBtnRow.parentElement?.parentElement;
        if (!sidebarRoot) return null;
        const contentWrapper = sidebarRoot.querySelector('.relative.overflow-hidden.flex-1');
        if (!contentWrapper) return null;
        const viewport = contentWrapper.querySelector('[data-radix-scroll-area-viewport]') || contentWrapper;
        return viewport.querySelector('.p-4.space-y-4') || viewport.firstElementChild || null;
    }

    function syncCspRowVisibility() {
        // 뷰어 탭 활성 여부에 따라 CSP 행 표시/숨김
        const painterRow = document.getElementById('csp-scene-painter-row');
        const galleryRow = document.getElementById('csp-scene-gallery-row');
        const viewerActive = isViewerTabActive();
        if (painterRow) painterRow.style.display = viewerActive ? '' : 'none';
        if (galleryRow) galleryRow.style.display = viewerActive ? '' : 'none';
        if (viewerActive) updateGalleryRowCount();
    }

    function injectScenePainterRow() {
        injectStyles();

        // 사이드바/탭 행이 없으면(사이드바 닫힘) 스킵
        const container = findViewerTabContent();
        if (!container) return;

        // 아직 주입 안 됐으면 삽입
        if (!document.getElementById('csp-scene-painter-row')) {
            const painterRow = createScenePainterRow(null);
            // 크랙과 동일한 스타일 (px-2.5 h-4 py-[18px] 형태)
            painterRow.style.removeProperty('padding');
            painterRow.style.removeProperty('border-bottom');

            const galleryRow = createSceneGalleryRow();
            galleryRow.style.removeProperty('padding');
            galleryRow.style.removeProperty('border-bottom');

            container.insertBefore(galleryRow, container.firstChild);
            container.insertBefore(painterRow, container.firstChild);
        }

        // 뷰어 탭 활성 여부에 따라 표시/숨김
        syncCspRowVisibility();
    }
    function injectAll() {
        injectStyles();
        injectScenePainterRow();
        injectMessageButtons();
    }

    function scheduleMenuInject() {
        if (menuInjectScheduled) return;
        menuInjectScheduled = true;
        requestAnimationFrame(() => {
            menuInjectScheduled = false;
            injectStyles();
            injectScenePainterRow();
        });
    }

    function scheduleMessageInject() {
        if (messageInjectScheduled) return;
        messageInjectScheduled = true;
        requestAnimationFrame(() => {
            messageInjectScheduled = false;
            injectStyles();
            injectMessageButtons();
        });
    }

    function scheduleInject() {
        if (injectScheduled) return;
        injectScheduled = true;
        requestAnimationFrame(() => {
            injectScheduled = false;
            injectAll();
        });
    }

    function mutationOwnsOnlyCspNodes(mutation) {
        const changed = [...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
            .map(getMutationElement)
            .filter(Boolean);
        return changed.length > 0 && changed.every(isScenePainterNode);
    }

    function mutationTouchesMenuArea(mutation) {
        // univers.chat: 탭 버튼 클래스 변경(탭 전환) 또는 사이드바 DOM 변화 감지
        const target = getMutationElement(mutation.target);

        // 탭 버튼의 class 속성 변경 (탭 전환 시 text-foreground ↔ text-muted-foreground)
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            if (target?.className?.includes('font-medium') &&
                ['정보','기억','문체','뷰어'].includes(target?.textContent?.trim())) return true;
        }

        const nodes = [mutation.target, ...Array.from(mutation.addedNodes || []), ...Array.from(mutation.removedNodes || [])]
            .map(getMutationElement)
            .filter(Boolean);
        return nodes.some(node => {
            if (!node) return false;
            if (node.closest?.('#csp-scene-painter-row, #csp-scene-gallery-row')) return true;
            if (node.classList?.contains('bg-background/95') && node.classList?.contains('backdrop-blur-2xl')) return true;
            if (node.classList?.contains('backdrop-blur-2xl')) return true;
            if (node.classList?.contains('border-b') && node.classList?.contains('border-border') && node.classList?.contains('flex')) return true;
            if (node.closest?.('.border-b.border-border.flex.w-full')) return true;
            const text = String(node.textContent || '');
            if (text.length < 30000 && (text.includes('AI 삽화 생성') || text.includes('삽화 갤러리') || (text.includes('정보') && text.includes('기억') && text.includes('뷰어')))) return true;
            return false;
        });
    }

    function mutationTouchesAssistantMessage(mutation) {
        const nodes = [mutation.target, ...Array.from(mutation.addedNodes || [])]
            .map(getMutationElement)
            .filter(Boolean);

        return nodes.some(node => {
            if (isScenePainterNode(node) || isComposerNode(node) || isChatListNode(node) || isSuggestionNode(node)) return false;

            const group = node.matches?.('[data-message-id]') ? node : node.closest?.('[data-message-id]');
            if (group && isAssistantMessageGroup(group)) return true;

            const nestedGroups = getMessageGroupCandidates(node);
            if (nestedGroups.some(isAssistantMessageGroup)) return true;

            const markdown = node.matches?.('[data-message-id]') ? node : (node.closest?.('[data-message-id]') || node.querySelector?.('[data-message-id] .space-y-3'));
            if (markdown && isLikelyAssistantMarkdown(markdown)) return true;

            return false;
        });
    }

    function handleObservedMutations(mutations) {
        let needMenu = false;
        let needMessages = false;

        for (const mutation of mutations) {
            if (mutationOwnsOnlyCspNodes(mutation)) continue;
            if (!needMenu && mutationTouchesMenuArea(mutation)) needMenu = true;
            if (!needMessages && mutationTouchesAssistantMessage(mutation)) needMessages = true;
            if (needMenu && needMessages) break;
        }

        if (needMenu) scheduleMenuInject();
        if (needMessages) scheduleMessageInject();
    }

    const cspScopedObserver = new MutationObserver(handleObservedMutations);

    function refreshScopedObservers() {
        if (observerRefreshScheduled) return;
        observerRefreshScheduled = true;
        requestAnimationFrame(() => {
            observerRefreshScheduled = false;
            scheduleInject();
        });
    }

    function start() {
        migrateLocalJsonStorageToCompressed();
        forceFirebaseProviderIfConfigured();
        injectStyles();
        applySceneVisibilityState(isEnabled());
        bindImageActionDelegates();
        migrateSceneImagesToIndexedDb().finally(scheduleInject);
        scheduleInject();

        cspScopedObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        // React SPA는 document-idle 시점에 탭 행이 아직 없을 수 있음
        // 탭 버튼이 나타날 때까지 폴링으로 재시도 (최대 10초)
        let retryCount = 0;
        const retryInject = setInterval(() => {
            retryCount++;
            const tabBtn = Array.from(document.querySelectorAll('button')).find(
                b => ['정보', '기억', '문체', '뷰어'].includes(b.textContent?.trim()) &&
                     b.className?.includes('font-medium')
            );
            if (tabBtn && !document.getElementById('csp-tab-btn')) {
                scheduleMenuInject();
            }
            if (retryCount >= 20) clearInterval(retryInject);
        }, 500);

        let lastUrl = location.href;
        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                refreshScopedObservers();
                // URL 변경 시 탭 버튼 재주입 폴링 재시작
                let rc2 = 0;
                const ri2 = setInterval(() => {
                    rc2++;
                    const tb = Array.from(document.querySelectorAll('button')).find(
                        b => ['정보', '기억', '문체', '뷰어'].includes(b.textContent?.trim()) &&
                             b.className?.includes('font-medium')
                    );
                    if (tb && !document.getElementById('csp-tab-btn')) scheduleMenuInject();
                    if (rc2 >= 20) clearInterval(ri2);
                }, 500);
            }
        }, 900);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

})();

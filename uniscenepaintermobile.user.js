// ==UserScript==
// @name         Univers Scene Painter Mobile
// @namespace    univers-scene-painter-mobile
// @version      0.1.2
// @description  Univers Scene Painter Mobile - NAI V4.5 Character Slots Full
// @match        https://www.univers.chat/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      generativelanguage.googleapis.com
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
        const payloadWithSafetySettings = withGeminiSafetySettings(payload);

        if (geminiRequest?.provider === 'firebase') {
            return await callFirebaseAiLogicGenerateContent(geminiRequest, payloadWithSafetySettings);
        }

        return await gmRequestJson({
            method: 'POST',
            url: geminiRequest.url,
            headers: geminiRequest.headers,
            data: payloadWithSafetySettings
        });
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
            .cspm-section-title { font-size: 13px; font-weight: 800; margin-bottom: 10px; color: var(--cspm-text); }
            .cspm-section-subbox {
                margin-top: 12px;
                padding: 12px;
                border: 1px solid var(--cspm-border);
                border-radius: 14px;
                background: color-mix(in srgb, var(--cspm-surface) 86%, transparent);
            }
            .cspm-section-toggle {
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
            .cspm-section-arrow { width: 16px; color: var(--cspm-muted); }
            .cspm-section-body { margin-top: 12px; }
            .cspm-tablist {
                display: flex;
                gap: 8px;
                margin: 0 0 14px;
                padding-bottom: 2px;
                overflow-x: auto;
                -webkit-overflow-scrolling: touch;
                scrollbar-width: none;
            }
            .cspm-tablist::-webkit-scrollbar { display: none; }
            .cspm-tab-btn {
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-2);
                color: var(--cspm-muted);
                padding: 9px 12px;
                border-radius: 999px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 800;
                white-space: nowrap;
                flex: 0 0 auto;
            }
            .cspm-tab-btn.is-active {
                background: color-mix(in srgb, var(--primary, #ff4432) 18%, var(--cspm-surface));
                color: var(--cspm-text);
                border-color: color-mix(in srgb, var(--primary, #ff4432) 54%, var(--cspm-border));
            }
            .cspm-tab-panel { margin-top: 0; }
            .cspm-tab-panel[hidden] { display: none !important; }
            .cspm-tab-panel > .cspm-section:first-child { margin-top: 0; }
            .cspm-compact-textarea { min-height: 84px !important; }
            .cspm-size-hidden { display: none !important; }
            .cspm-info-modal { width: 760px; }
            .cspm-reroll-modal { width: min(960px, calc(100vw - 28px)); }
            .cspm-info-pre {
                white-space: pre-wrap;
                word-break: break-word;
                max-height: 62vh;
                overflow: auto;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-3);
                border-radius: 12px;
                padding: 12px;
                font-size: 12px;
                line-height: 1.55;
            }
            .cspm-image-edit-character-card {
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-2);
                border-radius: 12px;
                padding: 12px;
                margin-bottom: 10px;
            }
            .cspm-readonly-preview {
                min-height: 92px;
                max-height: 220px;
                overflow: auto;
                white-space: pre-wrap;
                word-break: break-word;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-3);
                color: var(--cspm-text);
                border-radius: 12px;
                padding: 12px;
                font-size: 12px;
                line-height: 1.5;
            }
            .cspm-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .cspm-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
            .cspm-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
            .cspm-label-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
            }
            .cspm-value-chip {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 42px;
                padding: 3px 8px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 800;
                color: var(--cspm-text);
                background: var(--cspm-surface-3);
                border: 1px solid var(--cspm-border);
            }
            .cspm-range-wrap {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .cspm-range-wrap input[type="range"] {
                flex: 1;
                margin: 0;
            }
            .cspm-range-number {
                width: 90px !important;
                flex: 0 0 auto;
            }
            .cspm-res-row {
                display: grid;
                grid-template-columns: 1fr;
                gap: 8px;
            }
            .cspm-res-dims {
                display: flex;
                align-items: center;
                justify-content: flex-start;
                gap: 8px;
                flex-wrap: wrap;
            }
            .cspm-dim-pill {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 72px;
                padding: 9px 12px;
                border-radius: 10px;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-input);
                color: var(--cspm-input-text);
                font-size: 13px;
                font-weight: 700;
            }
            .cspm-dim-swap {
                width: 38px;
                height: 38px;
                border-radius: 10px;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-3);
                color: var(--cspm-text);
                cursor: pointer;
                font-size: 14px;
                font-weight: 800;
            }
            .cspm-dim-swap:hover { filter: brightness(1.06); }
            .cspm-section .cspm-grid > .cspm-field { margin-bottom: 0; }
            .cspm-section .cspm-grid { column-gap: 12px; row-gap: 12px; }
            .cspm-range-wrap { gap: 8px; }
            .cspm-range-number {
                width: 80px !important;
                font-variant-numeric: tabular-nums;
            }
            .cspm-range-number::-webkit-outer-spin-button,
            .cspm-range-number::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            .cspm-range-number[type="number"] {
                -moz-appearance: textfield;
            }
            .cspm-dim-pill { min-width: 64px; }
            @media (max-width: 720px) {
                .cspm-grid, .cspm-grid-3, .cspm-grid-4 { grid-template-columns: 1fr !important; }
                .cspm-actions-right { justify-content: flex-end; }
            }
            .cspm-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
            .cspm-field label {
                font-size: 12px;
                font-weight: 800;
                color: var(--cspm-muted);
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .cspm-field input,
            .cspm-field textarea,
            .cspm-field select {
                width: 100%;
                box-sizing: border-box;
                border-radius: 10px;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-input);
                color: var(--cspm-input-text);
                padding: 10px 11px;
                font-size: 13px;
                outline: none;
                font-family: inherit;
            }
            .cspm-field textarea { min-height: 84px; resize: vertical; line-height: 1.45; }
            .cspm-field textarea.cspm-long { min-height: 180px; }
            .cspm-field input::placeholder,
            .cspm-field textarea::placeholder {
                color: var(--cspm-soft);
                opacity: 1;
            }
            .cspm-field input:focus,
            .cspm-field textarea:focus,
            .cspm-field select:focus {
                border-color: var(--primary, #ff4432);
                box-shadow: 0 0 0 3px rgba(255, 68, 50, 0.18);
            }
            .cspm-actions {
                display: flex;
                justify-content: space-between;
                gap: 8px;
                margin-top: 18px;
                flex-wrap: wrap;
            }
            .cspm-actions-left, .cspm-actions-right { display: flex; gap: 8px; flex-wrap: wrap; }
            .cspm-quick-slot-grid { margin-top: 12px; }
            .cspm-quick-slot-actions { margin-top: 10px; gap: 10px; }
            .cspm-quick-slot-actions .cspm-btn { min-width: 92px; }
            .cspm-anlas-chip {
                border: 0;
                background: transparent;
                color: var(--cspm-muted);
                padding: 2px 4px;
                border-radius: 6px;
                font-size: 13px;
                font-weight: 900;
                letter-spacing: 0.01em;
                cursor: pointer;
                min-width: 0;
                text-align: center;
            }
            .cspm-anlas-chip:hover { background: var(--cspm-surface-2); }
            .cspm-anlas-chip.cspm-anlas-cost,
            .cspm-anlas-chip.is-active { color: #ef4444; }
            .cspm-anlas-chip[hidden] { display: none !important; }
            .cspm-btn {
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-2);
                color: inherit;
                padding: 10px 16px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 700;
            }
            .cspm-btn:hover { background: rgba(255,255,255,0.13); }
            .cspm-btn-primary {
                background: var(--primary, #ff4432);
                color: var(--primary-foreground, #fff);
                border-color: var(--primary, #ff4432);
            }
            .cspm-btn-danger {
                background: rgba(255, 80, 80, 0.16);
                border-color: rgba(255, 80, 80, 0.35);
            }
            .cspm-btn-small { padding: 7px 10px; font-size: 12px; }
            .cspm-mini-note {
                font-size: 11px;
                color: var(--cspm-soft);
                line-height: 1.5;
                margin-top: 4px;
                white-space: normal;
                word-break: keep-all;
                overflow-wrap: anywhere;
            }
            .cspm-character-card {
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-2);
                border-radius: 12px;
                padding: 12px;
                margin-bottom: 10px;
            }
            .cspm-character-head {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                font-size: 12px;
                font-weight: 800;
                color: var(--cspm-muted);
            }
            .cspm-reference-box {
                margin-top: 10px;
                border: 1px dashed var(--cspm-border);
                border-radius: 12px;
                padding: 10px;
                background: var(--cspm-surface-2);
            }
            .cspm-reference-preview-row {
                display: flex;
                gap: 10px;
                align-items: flex-start;
                margin-top: 8px;
            }
            .cspm-reference-preview-img {
                width: 72px;
                height: 96px;
                object-fit: cover;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.16);
                background: rgba(0,0,0,0.22);
            }
            .cspm-reference-preview-actions {
                flex: 1;
                min-width: 0;
            }
            .cspm-reference-file {
                font-size: 12px !important;
                padding: 8px !important;
            }
            .cspm-generated-scene-image {
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
            [data-message-id] .cspm-generated-scene-image,
            
            .bg-surface_chat_secondary .cspm-generated-scene-image {
                margin-top: 12px !important;
                margin-bottom: 12px !important;
            }
            [data-message-id] p:has(+ .cspm-generated-scene-image),
            
            .bg-surface_chat_secondary p:has(+ .cspm-generated-scene-image) {
                margin-bottom: 14px !important;
            }
            .cspm-generated-scene-image + p,
            .cspm-generated-scene-image + div,
            .cspm-generated-scene-image + blockquote {
                margin-top: 14px !important;
            }
            .cspm-generated-scene-image img {
                display: block;
                width: 100%;
                height: auto;
                cursor: zoom-in;
                vertical-align: top;
            }
            .cspm-generated-scene-caption {
                position: absolute;
                inset: 0;
                padding: 0 !important;
                margin: 0 !important;
                background: transparent;
                line-height: 0;
                pointer-events: none;
                overflow: hidden;
            }
            .cspm-generated-scene-caption .cspm-image-info-row,
            .cspm-generated-scene-caption .cspm-image-action-row { pointer-events: auto; }
            .cspm-image-history-row {
                display: flex;
                justify-content: flex-start;
                align-items: center;
                gap: 8px;
                width: 100%;
                max-width: 100%;
                min-height: 34px;
                margin: 8px 0 12px 0;
                padding: 0 2px;
                line-height: 1;
                font-size: 12px;
                color: var(--cspm-muted);
                opacity: 0.92;
                pointer-events: auto;
                user-select: none;
                box-sizing: border-box;
            }
            .cspm-image-history-controls {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 6px;
                order: 2;
                margin-left: auto;
                min-width: 0;
                flex: 0 0 auto;
            }
            .cspm-image-history-row:empty { display: none; }
            .cspm-image-history-btn {
                width: 22px;
                height: 22px;
                border-radius: 999px;
                border: 1px solid var(--cspm-border);
                background: var(--cspm-surface-2);
                color: var(--cspm-text);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 14px;
                font-weight: 900;
                line-height: 1;
                box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            }
            .cspm-image-history-btn:disabled {
                opacity: 0.36;
                cursor: default;
                box-shadow: none;
            }
            .cspm-image-history-count {
                min-width: 42px;
                text-align: center;
                font-size: 12px;
                font-weight: 800;
                line-height: 1;
                color: var(--cspm-muted);
                text-shadow: 0 1px 2px rgba(0,0,0,0.12);
            }
            .cspm-message-generate-btn,
            .cspm-message-speed-btn { position: relative; }

            .cspm-message-generate-btn,
            .cspm-message-speed-btn {
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
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            .cspm-message-generate-btn:hover,
            .cspm-message-speed-btn:hover,
            .cspm-message-generate-btn:active,
            .cspm-message-speed-btn:active {
                background: var(--accent, rgba(0,0,0,0.1));
                color: var(--foreground, #111);
            }
            .cspm-message-generate-btn svg,
            .cspm-message-speed-btn svg {
                pointer-events: none;
                flex-shrink: 0;
            }
            .cspm-inline-action-footer {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 30px;
                margin: 6px 0 0;
                padding: 0;
            }
            body.cspm-scene-hidden .cspm-generated-scene-image {
                display: none !important;
            }
            body.cspm-scene-hidden .cspm-message-generate-btn,
            body.cspm-scene-hidden .cspm-message-speed-btn {
                display: none !important;
            }
            .cspm-message-generate-btn[data-cspm-has-image="true"]::after,
            .cspm-message-speed-btn[data-cspm-has-image="true"]::after {
                content: "";
                position: absolute;
                right: 3px;
                top: 3px;
                width: 6px;
                height: 6px;
                border-radius: 999px;
                background: var(--primary, #ff4432);
            }
            .cspm-message-generate-btn[data-cspm-loading="true"],
            .cspm-message-speed-btn[data-cspm-loading="true"] { opacity: 0.55; pointer-events: none; }
            .cspm-check-row {
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
            .cspm-check-row input { width: auto !important; flex: 0 0 auto; margin-top: 2px; }
            .cspm-inline-note {
                display: inline-block;
                margin-left: 8px;
                font-size: 11px;
                opacity: 0.62;
            }
            .cspm-slot-preview-wrap {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 8px;
            }
            .cspm-slot-preview-card {
                border: 1px solid var(--cspm-border);
                border-radius: 12px;
                padding: 12px;
                background: var(--cspm-surface-3);
            }
            .cspm-slot-preview-title {
                font-size: 12px;
                font-weight: 800;
                color: var(--cspm-text);
                margin-bottom: 8px;
            }
            .cspm-slot-preview-label {
                font-size: 11px;
                font-weight: 800;
                color: var(--cspm-soft);
                margin: 8px 0 4px;
            }
            .cspm-slot-preview-body {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: 12px;
                line-height: 1.45;
                color: var(--cspm-text);
            }
            .cspm-paragraph-preview {
                min-height: 70px;
                max-height: 150px;
                overflow: auto;
                white-space: pre-wrap;
                word-break: break-word;
                border: 1px solid var(--cspm-border);
                border-radius: 12px;
                background: var(--cspm-surface-3);
                padding: 12px;
                font-size: 12px;
                line-height: 1.55;
                color: var(--cspm-text);
            }
            .cspm-btn-small {
                min-height: 32px;
                padding: 7px 10px;
                font-size: 12px;
            }
            .cspm-slot-preview-empty {
                font-size: 12px;
                color: var(--cspm-soft);
            }
            .cspm-hidden-raw {
                display: none !important;
            }
            .cspm-message-generate-btn[data-cspm-loading="true"],
            .cspm-image-action-btn[data-cspm-loading="true"] {
                opacity: 0.72;
                position: relative;
            }
            .cspm-message-generate-btn[data-cspm-loading="true"] svg,
            .cspm-image-action-btn[data-cspm-loading="true"] svg {
                animation: cspm-spin 0.9s linear infinite;
            }
            .cspm-task-hud-backdrop {
                position: fixed;
                left: 50%;
                bottom: 22px;
                transform: translateX(-50%);
                z-index: 2147483645;
                width: min(430px, calc(100vw - 28px));
                pointer-events: none;
            }
            .cspm-task-hud {
                width: 100%;
                border-radius: 18px;
                background: rgba(22, 22, 26, 0.96);
                border: 1px solid rgba(255,255,255,0.10);
                box-shadow: 0 20px 80px rgba(0,0,0,0.35);
                padding: 15px 16px 14px;
                color: #f4f4f5;
                pointer-events: auto;
            }
            body[data-theme="light"] .cspm-task-hud {
                background: rgba(255,255,255,0.98);
                color: #111827;
                border-color: rgba(31,35,40,0.15);
                box-shadow: 0 20px 80px rgba(31,35,40,0.18);
            }
            .cspm-task-hud-header {
                display: grid;
                grid-template-columns: auto 1fr auto;
                align-items: center;
                gap: 12px;
                margin-bottom: 12px;
            }
            .cspm-task-hud-cancel {
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
            .cspm-task-hud-cancel:hover { background: rgba(255, 68, 50, 0.18); }
            body[data-theme="light"] .cspm-task-hud-cancel {
                border-color: rgba(31,35,40,0.16);
                background: rgba(31,35,40,0.04);
            }
            .cspm-task-hud-spinner {
                width: 20px;
                height: 20px;
                border-radius: 999px;
                border: 2px solid rgba(255,255,255,0.22);
                border-top-color: rgba(255,255,255,0.92);
                animation: cspm-spin 0.8s linear infinite;
                flex: 0 0 auto;
            }
            body[data-theme="light"] .cspm-task-hud-spinner {
                border-color: rgba(31,35,40,0.18);
                border-top-color: rgba(31,35,40,0.76);
            }
            .cspm-task-hud-title {
                font-size: 14px;
                font-weight: 700;
                line-height: 1.25;
            }
            .cspm-task-hud-message {
                font-size: 12px;
                opacity: 0.72;
                margin-bottom: 12px;
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: keep-all;
            }
            .cspm-task-hud-bar {
                width: 100%;
                height: 8px;
                border-radius: 999px;
                background: rgba(255,255,255,0.08);
                overflow: hidden;
            }
            .cspm-task-hud-bar-fill {
                height: 100%;
                width: 0%;
                border-radius: inherit;
                background: linear-gradient(90deg, #ff6b35 0%, #ff9c63 100%);
                transition: width 220ms ease;
            }
            .cspm-task-hud-footer {
                margin-top: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 10px;
                font-size: 11px;
                opacity: 0.65;
            }
            .cspm-task-hud-status-success .cspm-task-hud-spinner {
                animation: none;
                border-color: rgba(34,197,94,0.28);
                background: rgba(34,197,94,0.9);
            }
            .cspm-task-hud-status-error .cspm-task-hud-spinner {
                animation: none;
                border-color: rgba(239,68,68,0.28);
                background: rgba(239,68,68,0.9);
            }
            .cspm-generated-scene-image img {
                cursor: zoom-in;
            }
            .cspm-gallery-count-badge {
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
            .cspm-gallery-modal { width: min(1080px, calc(100vw - 30px)); }
            .cspm-gallery-summary {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                flex-wrap: wrap;
                margin-bottom: 12px;
            }
            .cspm-gallery-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
                gap: 12px;
                min-height: 160px;
            }
            .cspm-gallery-empty {
                border: 1px dashed var(--cspm-border);
                border-radius: 14px;
                padding: 28px 16px;
                color: var(--cspm-muted);
                font-size: 13px;
                text-align: center;
                background: var(--cspm-surface-2);
            }
            .cspm-gallery-card {
                border: 1px solid var(--cspm-border);
                border-radius: 14px;
                background: var(--cspm-surface-2);
                overflow: hidden;
                min-width: 0;
                box-shadow: 0 8px 22px rgba(0,0,0,0.10);
            }
            .cspm-gallery-thumb {
                width: 100%;
                aspect-ratio: 1 / 1.25;
                border: 0;
                background: var(--cspm-surface-3);
                padding: 0;
                cursor: zoom-in;
                display: block;
                overflow: hidden;
            }
            .cspm-gallery-thumb img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .cspm-gallery-thumb.is-missing {
                display: flex;
                align-items: center;
                justify-content: center;
                color: var(--cspm-muted);
                font-size: 12px;
                line-height: 1.45;
                padding: 12px;
                text-align: center;
            }
            .cspm-gallery-card-body { padding: 10px; }
            .cspm-gallery-title {
                color: var(--cspm-text);
                font-size: 12px;
                font-weight: 900;
                line-height: 1.35;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                min-height: 32px;
            }
            .cspm-gallery-meta {
                margin-top: 5px;
                color: var(--cspm-muted);
                font-size: 11px;
                line-height: 1.45;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .cspm-gallery-actions {
                display: flex;
                gap: 6px;
                flex-wrap: wrap;
                margin-top: 9px;
            }
            .cspm-gallery-actions .cspm-btn {
                padding: 6px 8px;
                font-size: 11px;
                min-width: 0;
                flex: 1 1 auto;
            }
            .cspm-gallery-nav-btn {
                flex: 0 0 30px !important;
                width: 30px;
                padding-left: 0 !important;
                padding-right: 0 !important;
                font-size: 15px !important;
                font-weight: 900 !important;
            }
            .cspm-gallery-actions .cspm-btn:disabled {
                opacity: 0.42;
                cursor: default;
            }
            .cspm-lightbox-backdrop {
                position: fixed;
                inset: 0;
                z-index: 2147483646;
                background: rgba(0,0,0,0.82);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 28px;
            }
            .cspm-lightbox-panel {
                position: relative;
                max-width: min(96vw, 1280px);
                max-height: 92vh;
                display: flex;
                flex-direction: column;
                gap: 10px;
                align-items: center;
            }
            .cspm-lightbox-panel img {
                max-width: 100%;
                max-height: calc(92vh - 54px);
                object-fit: contain;
                border-radius: 16px;
                box-shadow: 0 18px 80px rgba(0,0,0,0.48);
                background: rgba(0,0,0,0.2);
            }
            .cspm-lightbox-topbar {
                width: 100%;
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }
            .cspm-lightbox-btn {
                border: 1px solid rgba(255,255,255,0.18);
                background: rgba(20,20,20,0.76);
                color: #fff;
                border-radius: 999px;
                padding: 8px 12px;
                font-size: 12px;
                cursor: pointer;
            }
            @keyframes cspm-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .cspm-image-info-row,
            .cspm-image-action-row {
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
            .cspm-image-info-row {
                left: 14px;
                top: 14px;
            }
            .cspm-image-action-row {
                left: 14px;
                right: auto;
                bottom: 14px;
            }
            .cspm-image-action-row.cspm-image-action-row-inline {
                position: static;
                z-index: auto;
                left: auto;
                right: auto;
                top: auto;
                bottom: auto;
                gap: 8px;
                max-width: none;
                opacity: 1;
                transform: none;
                pointer-events: auto;
                flex: 0 0 auto;
                margin-left: 0 !important;
                margin-right: auto !important;
                justify-content: flex-start;
            }
            .cspm-generated-scene-image:hover .cspm-image-info-row,
            .cspm-generated-scene-image:hover .cspm-image-action-row,
            .cspm-image-info-row:focus-within,
            .cspm-image-action-row:focus-within {
                opacity: 1;
                pointer-events: auto;
            }
            .cspm-image-action-btn {
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
            .cspm-image-action-btn:hover {
                transform: translateY(-1px) scale(1.04);
                background: rgba(32,32,38,0.86);
                border-color: rgba(255,255,255,0.34);
            }
            .cspm-image-action-btn:active {
                transform: scale(0.96);
            }
            .cspm-image-action-btn[disabled] {
                opacity: 0.55;
                cursor: default;
                transform: none;
            }
            .cspm-image-action-btn[data-cspm-danger="true"]:hover {
                background: rgba(160, 36, 36, 0.86);
                border-color: rgba(255,120,120,0.40);
            }

            /* Touch layout overrides */
            @media (max-width: 820px), (pointer: coarse) {
                .cspm-overlay {
                    align-items: flex-end !important;
                    justify-content: center !important;
                    background: rgba(0,0,0,0.66) !important;
                    padding: env(safe-area-inset-top, 0px) 0 0 !important;
                    overflow-x: hidden !important;
                    overscroll-behavior-x: none !important;
                    overscroll-behavior-y: contain;
                    touch-action: pan-y;
                }
                .cspm-modal {
                    box-sizing: border-box !important;
                    width: 100vw !important;
                    max-width: 100vw !important;
                    height: auto !important;
                    max-height: min(92dvh, calc(100vh - 10px)) !important;
                    border-radius: 20px 20px 0 0 !important;
                    padding: 14px 14px calc(16px + env(safe-area-inset-bottom, 0px)) !important;
                    overflow-y: auto !important;
                    overflow-x: hidden !important;
                    overscroll-behavior-x: none !important;
                    overscroll-behavior-y: contain;
                    touch-action: pan-y;
                    -webkit-overflow-scrolling: touch;
                    box-shadow: 0 -18px 50px rgba(0,0,0,0.42) !important;
                }
                .cspm-modal *,
                .cspm-section,
                .cspm-field,
                .cspm-actions,
                .cspm-gallery-summary,
                .cspm-gallery-grid {
                    box-sizing: border-box;
                    min-width: 0;
                    max-width: 100%;
                }
                .cspm-modal input,
                .cspm-modal textarea,
                .cspm-modal select,
                .cspm-modal pre {
                    max-width: 100% !important;
                }
                .cspm-modal textarea,
                .cspm-modal pre,
                .cspm-desc {
                    overflow-wrap: anywhere;
                }
                .cspm-modal::before {
                    content: '';
                    display: block;
                    width: 42px;
                    height: 4px;
                    margin: 0 auto 12px;
                    border-radius: 999px;
                    background: var(--cspm-border);
                }
                .cspm-modal h2 {
                    font-size: 17px !important;
                    line-height: 1.25 !important;
                    margin-bottom: 8px !important;
                }
                .cspm-desc {
                    font-size: 11px !important;
                    margin-bottom: 12px !important;
                }
                .cspm-section {
                    padding: 12px !important;
                    margin-top: 10px !important;
                    border-radius: 16px !important;
                }
                .cspm-section-title { font-size: 13px !important; }
                .cspm-grid,
                .cspm-grid-3,
                .cspm-grid-4,
                .cspm-quick-slot-grid {
                    grid-template-columns: 1fr !important;
                    gap: 8px !important;
                }
                .cspm-field { margin-bottom: 8px !important; gap: 5px !important; }
                .cspm-field input,
                .cspm-field textarea,
                .cspm-field select,
                .cspm-modal input,
                .cspm-modal textarea,
                .cspm-modal select {
                    font-size: 16px !important;
                    min-height: 42px !important;
                    padding: 10px 11px !important;
                }
                .cspm-field textarea { min-height: 92px !important; }
                .cspm-field textarea.cspm-long { min-height: 150px !important; }
                .cspm-range-wrap {
                    display: grid !important;
                    grid-template-columns: 1fr 74px !important;
                    gap: 8px !important;
                    align-items: center;
                }
                .cspm-range-number { width: 74px !important; }
                .cspm-actions {
                    position: sticky;
                    bottom: calc(-16px - env(safe-area-inset-bottom, 0px));
                    z-index: 5;
                    background: color-mix(in srgb, var(--cspm-surface) 92%, transparent);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border-top: 1px solid var(--cspm-border);
                    margin: 14px -14px calc(-16px - env(safe-area-inset-bottom, 0px)) !important;
                    padding: 10px 14px calc(12px + env(safe-area-inset-bottom, 0px)) !important;
                }
                .cspm-actions-left,
                .cspm-actions-right {
                    width: 100%;
                    display: grid !important;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 8px !important;
                }
                .cspm-actions-right:only-child { grid-template-columns: 1fr 1fr; }
                .cspm-btn,
                .cspm-btn-small,
                .cspm-message-generate-btn,
                .cspm-message-speed-btn {
                    min-height: 40px !important;
                    padding: 9px 12px !important;
                    font-size: 13px !important;
                    touch-action: manipulation;
                }
                .cspm-image-action-btn {
                    width: 34px !important;
                    height: 34px !important;
                    font-size: 15px !important;
                    touch-action: manipulation;
                }
                .cspm-image-action-row,
                .cspm-image-info-row {
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }
                .cspm-image-action-row {
                    left: 12px !important;
                    right: auto !important;
                    bottom: 12px !important;
                    max-width: calc(100% - 24px) !important;
                }
                .cspm-image-action-row.cspm-image-action-row-inline {
                    position: static !important;
                    left: auto !important;
                    right: auto !important;
                    bottom: auto !important;
                    max-width: none !important;
                    gap: 8px !important;
                    order: 1 !important;
                    margin-left: 0 !important;
                    margin-right: auto !important;
                    justify-content: flex-start !important;
                }
                .cspm-image-history-row {
                    width: 100% !important;
                    justify-content: flex-start !important;
                    gap: 8px !important;
                    padding: 0 2px !important;
                    margin: 8px 0 12px !important;
                }
                .cspm-image-history-controls {
                    order: 2 !important;
                    margin-left: auto !important;
                }
                .cspm-generated-scene-image {
                    max-width: 100% !important;
                    margin-left: 0 !important;
                    margin-right: 0 !important;
                    border-radius: 16px !important;
                }
                .cspm-generated-scene-image img {
                    max-height: 70dvh !important;
                    object-fit: contain !important;
                }
                .cspm-image-history-row { gap: 8px !important; }
                .cspm-image-history-btn {
                    min-width: 38px !important;
                    min-height: 34px !important;
                }
                .cspm-gallery-modal,
                .cspm-reroll-modal,
                .cspm-info-modal {
                    width: 100vw !important;
                    max-width: 100vw !important;
                }
                .cspm-gallery-summary {
                    align-items: stretch !important;
                    gap: 8px !important;
                }
                .cspm-gallery-summary .cspm-actions-left {
                    grid-template-columns: 1fr 1fr !important;
                }
                .cspm-gallery-grid {
                    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                    gap: 9px !important;
                }
                .cspm-gallery-card { border-radius: 14px !important; }
                .cspm-gallery-card-body { padding: 8px !important; }
                .cspm-gallery-actions {
                    display: grid !important;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 6px !important;
                }
                .cspm-gallery-actions .cspm-btn {
                    width: 100%;
                    min-height: 34px !important;
                    padding: 6px 4px !important;
                }
                .cspm-lightbox-backdrop {
                    padding: 12px !important;
                    align-items: center !important;
                }
                .cspm-lightbox-panel img {
                    max-height: calc(100dvh - 92px) !important;
                    border-radius: 14px !important;
                }
                .cspm-task-hud-backdrop {
                    bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
                    width: calc(100vw - 20px) !important;
                }
                #cspm-toast {
                    bottom: calc(18px + env(safe-area-inset-bottom, 0px)) !important;
                    max-width: calc(100vw - 24px);
                    text-align: center;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function hasAllClasses(el, classes) {
        if (!el || !el.classList) return false;
        return classes.every(name => el.classList.contains(name));
    }

    function isFooterLike(el) {
        return hasAllClasses(el, ['flex', 'items-center', 'justify-between', 'pt-1']);
    }

    function isMainMarkdown(el) {
        return !!el
            && el.classList
            && el.classList.contains('space-y-3')
            && !el.closest('.csp-generated-scene-image')
            && !el.closest('.cspm-generated-scene-image');
    }

    function findPreviousMarkdown(footer) {
        if (!footer) return null;
        let cur = footer.previousElementSibling;
        let guard = 0;

        while (cur && guard < 8) {
            if (isMainMarkdown(cur)) return cur;
            const found = cur.querySelector?.(':scope > .space-y-3, [data-message-id] .space-y-3');
            if (isMainMarkdown(found)) return found;
            cur = cur.previousElementSibling;
            guard++;
        }

        const parent = footer.parentElement;
        if (parent) {
            const candidates = Array.from(parent.querySelectorAll('[data-message-id] .space-y-3')).filter(isMainMarkdown);
            const before = candidates.filter(md => md.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (before.length) return before[before.length - 1];
        }

        return null;
    }

    function findNextFooter(markdown) {
        if (!markdown) return null;
        let cur = markdown.nextElementSibling;
        let guard = 0;

        while (cur && guard < 8) {
            if (isFooterLike(cur)) return cur;
            const nested = Array.from(cur.querySelectorAll?.('div') || []).find(isFooterLike);
            if (nested) return nested;
            cur = cur.nextElementSibling;
            guard++;
        }

        const group = getMessageGroupContainer(markdown);
        if (group) {
            const nested = group.querySelector?.('div.flex.items-center.justify-between.pt-1');
            if (nested && group.contains(nested)) return nested;
        }

        return null;
    }

    function getMessageGroupContainer(node) {
        if (!node || !node.closest) return null;
        return node.closest('[data-message-id]');
    }

    function getBubbleFromMenuButton(menuBtn) {
        // univers.chat: 버튼 → data-message-id 컨테이너
        if (!menuBtn) return null;
        return menuBtn.closest('[data-message-id]') || null;
    }

    function getDirectMarkdown(bubble) {
        if (!bubble) return null;
        if (isMainMarkdown(bubble)) return bubble;

        const group = (bubble.matches?.('[data-message-id]') ? bubble : null) || getMessageGroupContainer(bubble);
        if (group) {
            const aiMd = group.querySelector('[data-message-id] .space-y-3');
            if (isMainMarkdown(aiMd)) return aiMd;

            const candidates = Array.from(group.querySelectorAll('[data-message-id] .space-y-3')).filter(isMainMarkdown);
            const preferred = candidates.find(md => !md.closest('.bg-surface_chat_secondary') !== null || closest('.rounded-2xl') !== null);
            if (preferred) return preferred;
            if (candidates.length) return candidates[0];
        }

        const direct = Array.from(bubble.children || []).find(isMainMarkdown);
        if (direct) return direct;

        const scoped = bubble.querySelector?.(':scope > [data-message-id] .space-y-3');
        if (isMainMarkdown(scoped)) return scoped;

        const any = bubble.querySelector?.('[data-message-id] .space-y-3');
        return isMainMarkdown(any) ? any : null;
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

        const existing = markdown.parentElement.querySelector?.(':scope > .cspm-inline-action-footer')
            || (markdown.nextElementSibling?.classList?.contains('cspm-inline-action-footer') ? markdown.nextElementSibling : null);
        if (existing) return existing;

        const footer = document.createElement('div');
        footer.className = 'cspm-inline-action-footer';
        footer.setAttribute('data-cspm-inline-footer', 'true');

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

    function getMessageSideRole(node) {
        if (!node || !node.closest) return '';

        let cur = node;
        let guard = 0;

        while (cur && guard < 10) {
            const cls = cur.classList;
            if (cls?.contains('flex-col') && cls.contains('items-end')) return 'user';
            if (cls?.contains('flex-col') && cls.contains('items-start')) return 'assistant';

            // 소설형 UI 유저 줄: flex-row + items-end + justify-between + border-y 조합
            // 채팅형 AI에도 flex-row/items-end가 있을 수 있어서 border-y/justify-between까지 같이 본다.
            if (cls?.contains('flex-row') && cls.contains('items-end') && cls.contains('justify-between') && cls.contains('border-y')) return 'user';
            if (cls?.contains('flex-row') && cls.contains('items-start') && cls.contains('justify-between') && cls.contains('border-y')) return 'assistant';

            // 채팅형 UI의 유저 말풍선 배경 클래스
            if (cls?.contains('bg-surface_chat_secondary')) return 'user';

            if (cur.matches?.('[data-message-id]')) break;
            cur = cur.parentElement;
            guard++;
        }

        const group = getMessageGroupContainer(node);
        if (group && group !== node) {
            const wrappers = Array.from(group.querySelectorAll('div.flex.flex-col'));
            const userWrap = wrappers.find(el => el.classList.contains('items-end'));
            const assistantWrap = wrappers.find(el => el.classList.contains('items-start'));
            if (userWrap && !assistantWrap) return 'user';
            if (assistantWrap && !userWrap) return 'assistant';
        }

        return '';
    }

    function isLikelyAssistantMarkdown(markdown) {
        if (!isMainMarkdown(markdown)) return false;

        // 현재 채팅형/소설형 AI 답변에서 안정적으로 잡히는 markdown 클래스.
        if (markdown.classList.contains('space-y-3')) return true;

        // 소설형 유저 로그에서 확인된 유저 markdown 클래스 + 기존 채팅형 유저 클래스.
        if (markdown.classList.contains('css-1el105x')) return false;
        if (markdown.closest('.bg-surface_chat_secondary') !== null || markdown.closest('.rounded-2xl') !== null) return false;

        const sideRole = getMessageSideRole(markdown);
        if (sideRole === 'assistant') return true;
        if (sideRole === 'user') return false;

        const row = markdown.closest?.('div.flex.flex-row.gap-4.w-full.items-end.justify-between.border-y');
        if (row) return false;

        const userBubble = markdown.closest?.('.bg-surface_chat_secondary');
        if (userBubble) return false;

        return false;
    }

    function removeInjectedButtonsFromNode(root) {
        if (!root) return;
        root.querySelectorAll?.('.cspm-message-generate-btn, .cspm-message-speed-btn').forEach(btn => btn.remove());
        root.querySelectorAll?.('.cspm-inline-action-footer').forEach(footer => {
            if (!footer.querySelector('.cspm-message-generate-btn, .cspm-message-speed-btn')) footer.remove();
        });
    }

    function cleanupNonAssistantMessageButtons() {
        document.querySelectorAll('.cspm-inline-action-footer').forEach(footer => {
            const markdown = findPreviousMarkdown(footer)
                || footer.parentElement?.querySelector?.(':scope > .space-y-3, [data-message-id] .space-y-3')
                || null;

            const row = footer.closest?.('div.flex.flex-row.gap-4.w-full.items-end.justify-between.border-y')
                || footer.closest?.('.bg-surface_chat_secondary')
                || null;

            if ((markdown && !isLikelyAssistantMarkdown(markdown)) || row) {
                footer.remove();
            }
        });

        document.querySelectorAll('.cspm-message-generate-btn, .cspm-message-speed-btn').forEach(btn => {
            const footer = btn.closest('.cspm-inline-action-footer');
            const markdown = footer
                ? (findPreviousMarkdown(footer) || footer.parentElement?.querySelector?.(':scope > .space-y-3, [data-message-id] .space-y-3') || null)
                : (btn.closest('[data-message-id] .space-y-3') || null);

            const row = btn.closest?.('div.flex.flex-row.gap-4.w-full.items-end.justify-between.border-y')
                || btn.closest?.('.bg-surface_chat_secondary')
                || null;

            if ((markdown && !isLikelyAssistantMarkdown(markdown)) || row) {
                btn.remove();
            }
        });
    }

    function isUserBubble(bubble) {
        if (!bubble) return false;

        const sideRole = getMessageSideRole(bubble);
        if (sideRole === 'user') return true;
        if (sideRole === 'assistant') return false;

        const group = (bubble.matches?.('[data-message-id]') ? bubble : null) || getMessageGroupContainer(bubble);
        if (group) {
            const groupSideRole = getMessageSideRole(group);
            if (groupSideRole === 'user') return true;
            if (groupSideRole === 'assistant') return false;

            if (group.querySelector('.bg-surface_chat_secondary')) return true;
            if (group.querySelector('[data-message-id] .space-y-3')) return false;
        }

        if (bubble.classList?.contains('bg-surface_chat_secondary')) return true;

        const markdown = getDirectMarkdown(bubble);
        if (!markdown) return false;

        const markdownSideRole = getMessageSideRole(markdown);
        if (markdownSideRole === 'user') return true;
        if (markdownSideRole === 'assistant') return false;

        if (markdown.closest?.('.bg-surface_chat_secondary')) return true;

        if (markdown.classList.contains('css-1el105x')) return true;

        // univers: bg-surface_chat_secondary = 유저 메시지
        // 그래도 정렬/배경 힌트가 전혀 없는 경우에는 기존 채팅형 유저 메시지 호환을 위해 유저 쪽으로 둔다.
        if (markdown.closest('.bg-surface_chat_secondary') !== null || closest('.rounded-2xl') !== null) return true;

        return false;
    }

    function isAssistantBubble(bubble) {
        if (!bubble || isUserBubble(bubble)) return false;
        const msgEl = bubble.closest?.('[data-message-id]') || (bubble.matches?.('[data-message-id]') ? bubble : null) || bubble;
        if (msgEl.querySelector('button[aria-label="응답 재생성"]') || msgEl.closest?.('[data-message-id]')?.querySelector('button[aria-label="응답 재생성"]')) {
            const markdown = getDirectMarkdown(bubble);
            if (!markdown) return false;
            return cleanMarkdownText(markdown).length >= 5;
        }
        return false;
    }

    function getAssistantBubbles() {
        const set = new Set();

        // univers.chat: '응답 재생성' 버튼이 있는 메시지 = AI 응답
        const regenButtons = Array.from(document.querySelectorAll('button[aria-label="응답 재생성"]'));
        regenButtons.forEach(btn => {
            const msgEl = btn.closest('[data-message-id]');
            if (msgEl && isAssistantBubble(msgEl)) set.add(msgEl);
        });

        // 소설형 UI는 footer 구조가 바뀌면 메뉴 버튼 기준 탐색이 실패할 수 있어,
        // 메인 space-y-3 자체도 보조 후보로 한 번 더 잡는다.
        Array.from(document.querySelectorAll('div.space-y-3'))
            .filter(isMainMarkdown)
            .filter(markdown => cleanMarkdownText(markdown).length >= 5)
            .forEach(markdown => {
                if (!isLikelyAssistantMarkdown(markdown)) return;

                const group = getMessageGroupContainer(markdown);
                const candidate = group || markdown;
                if (isUserBubble(candidate)) return;

                const md = getDirectMarkdown(candidate);
                if (!md || !isLikelyAssistantMarkdown(md)) return;

                // footer를 못 찾아도 ensureCspInlineFooter가 버튼 영역을 만들 수 있으므로 후보에 넣는다.
                set.add(candidate);
            });

        return Array.from(set).sort(compareDocumentOrder);
    }

    function compareDocumentOrder(a, b) {
        if (a === b) return 0;
        return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    }

    function getAllChatBubbles() {
        const set = new Set();

        Array.from(document.querySelectorAll('div.flex.flex-col.gap-4.px-5.w-full.break-all'))
            .filter(bubble => getDirectMarkdown(bubble))
            .forEach(bubble => set.add(bubble));

        Array.from(document.querySelectorAll('div.space-y-3'))
            .filter(isMainMarkdown)
            .filter(markdown => cleanMarkdownText(markdown).length >= 1)
            .forEach(markdown => set.add(markdown));

        return Array.from(set).sort(compareDocumentOrder);
    }

    function getBubbleRole(bubble) {
        return isUserBubble(bubble) ? 'user' : 'assistant';
    }

    function getInsertableContentBlocks(markdown) {
        if (!markdown) return [];

        const children = Array.from(markdown.children || []).filter(el => {
            if (!el || el.classList?.contains('cspm-generated-scene-image')) return false;
            if (el.matches?.('pre, .not-prose, .csp-generated-scene-image')) return false;
            if (el.matches?.('p, blockquote, ul, ol, table')) return true;
            if (el.tagName === 'DIV') {
                const clone = el.cloneNode(true);
                stripNonSceneNodes(clone);
                const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
                return !!text;
            }
            return false;
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
        markdown.querySelectorAll('.cspm-generated-scene-image, .cspm-image-history-row').forEach(el => el.remove());
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

    function showImageInfoModal(messageKey) {
        const records = getSceneRecords();
        const record = records[messageKey];
        if (!record) {
            showToast('⚠️ 표시할 이미지 정보가 없어요.');
            return;
        }

        const existing = document.getElementById('cspm-image-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'cspm-image-info-modal';
        overlay.className = 'cspm-overlay';
        const detailText = buildPromptDetailText(
            record.plan || {},
            Number.isFinite(record.paragraphIndex) ? record.paragraphIndex : (record.plan?.insertAfterParagraph || 0),
            record.mode || 'nai',
            {
                basePrompt: record.basePrompt || '',
                baseNegative: record.baseNegative || '',
                finalPrompt: record.finalPrompt || '',
                finalNegative: record.finalNegative || '',
                charPrompts: record.charPrompts || [],
                referenceInfo: record.referenceInfo || getReferenceSummary(record.charPrompts || []),
                naiSettings: record.naiSettings || null,
                scenePrompt: record.plan?.scenePrompt || '',
                temporaryOutfitPrompt: record.plan?.temporaryOutfitPrompt || '',
                useTemporaryOutfit: !!record.plan?.useTemporaryOutfit
            }
        );

        overlay.innerHTML = `
            <div class="cspm-modal cspm-info-modal" role="dialog" aria-modal="true">
                <h2>ℹ️ 이미지 정보</h2>
                <div class="cspm-desc">이 삽화 생성에 사용된 프롬프트와 설정이야.</div>
                <pre class="cspm-info-pre">${escapeHtml(detailText)}</pre>
                <div class="cspm-actions">
                    <div></div>
                    <div class="cspm-actions-right">
                        <button class="cspm-btn" id="cspm-image-info-edit" type="button">리롤 설정</button>
                        <button class="cspm-btn" id="cspm-image-info-copy" type="button">복사</button>
                        <button class="cspm-btn cspm-btn-primary" id="cspm-image-info-close" type="button">닫기</button>
                    </div>
                </div>
            </div>
        `;

        overlay.querySelector('#cspm-image-info-close').onclick = () => overlay.remove();
        overlay.querySelector('#cspm-image-info-edit').onclick = () => {
            overlay.remove();
            showImageRerollSettingsModal(messageKey);
        };
        overlay.querySelector('#cspm-image-info-copy').onclick = async () => {
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
            orientationPreset: overlay.querySelector('#cspm-edit-orientation')?.value || 'portrait',
            width: Number(overlay.querySelector('#cspm-edit-width')?.value || 832),
            height: Number(overlay.querySelector('#cspm-edit-height')?.value || 1216),
            steps: Number(overlay.querySelector('#cspm-edit-steps')?.value || 28),
            scale: Number(overlay.querySelector('#cspm-edit-scale')?.value || 6.5),
            guidanceRescale: Number(overlay.querySelector('#cspm-edit-guidance-rescale')?.value || 0.3),
            seed: overlay.querySelector('#cspm-edit-seed')?.value.trim() || '',
            sampler: overlay.querySelector('#cspm-edit-sampler')?.value || 'k_euler_ancestral',
            noiseSchedule: overlay.querySelector('#cspm-edit-noise-schedule')?.value || 'karras',
            nSamples: 1,
            smea: false,
            dyn: false,
            ucPreset: Number(overlay.querySelector('#cspm-edit-uc-preset')?.value || 0)
        };
    }

    function showImageRerollSettingsModal(messageKey, box = null, img = null) {
        const records = getSceneRecords();
        const record = records[messageKey];
        if (!record) {
            showToast('⚠️ 수정할 이미지 기록이 없어요.');
            return;
        }

        const existing = document.getElementById('cspm-image-reroll-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'cspm-image-reroll-modal';
        overlay.className = 'cspm-overlay';

        const settings = Object.assign({}, getDefaultGlobalSettings().naiSettings, getGlobalSettings().naiSettings || {}, record.naiSettings || {});
        const room = getRoomSettings();
        const charPrompts = Array.isArray(record.charPrompts) && record.charPrompts.length
            ? record.charPrompts
            : [{ name: 'Character 1', prompt: '', uc: '' }];
        const basePrompt = record.basePrompt || record.finalPrompt || '';
        const baseNegative = record.baseNegative || record.finalNegative || '';
        const savedPlan = Object.assign({ useTemporaryOutfit: false, temporaryOutfitPrompt: '' }, record.plan || {});

        const charCardsHtml = charPrompts.map((char, index) => `
            <div class="cspm-image-edit-character-card" data-index="${index}">
                <div class="cspm-section-title">Character ${index + 1}${char.name ? ` · ${escapeHtml(char.name)}` : ''}</div>
                <div class="cspm-field">
                    <label>Character ${index + 1} Prompt</label>
                    <textarea class="cspm-edit-character-prompt cspm-long">${escapeHtml(char.prompt || '')}</textarea>
                </div>
                <div class="cspm-field">
                    <label>Character ${index + 1} UC</label>
                    <textarea class="cspm-edit-character-uc">${escapeHtml(char.uc || '')}</textarea>
                </div>
                ${hasUsableReference(char) ? `<div class="cspm-mini-note">Precise Reference: ${escapeHtml(getReferenceTypeLabel(char.referenceType))} · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성</div>` : ''}
            </div>
        `).join('');

        overlay.innerHTML = `
            <div class="cspm-modal cspm-reroll-modal" role="dialog" aria-modal="true">
                <h2>⚙️ 이 이미지 리롤 설정</h2>
                <div class="cspm-desc">공통 설정과 캐릭터 슬롯 원본은 건드리지 않고, 이 이미지 기록만 수정해서 다시 생성해.</div>

                <div class="cspm-section">
                    <div class="cspm-section-title">Prompt</div>
                    <div class="cspm-field">
                        <label>Base Prompt</label>
                        <textarea id="cspm-edit-base-prompt" class="cspm-long">${escapeHtml(basePrompt)}</textarea>
                    </div>
                    <div class="cspm-field">
                        <div class="cspm-label-row">
                            <label>Undesired Content</label>
                            <select id="cspm-edit-uc-preset" title="NovelAI Undesired Content Preset" style="max-width: 180px;">
                                ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                            </select>
                        </div>
                        <textarea id="cspm-edit-base-negative" class="cspm-long">${escapeHtml(baseNegative)}</textarea>
                        <div class="cspm-mini-note">선택한 UC 프리셋 태그도 실제 Negative에 합쳐서 전송돼.</div>
                    </div>
                    <div class="cspm-field">
                        <label class="cspm-check-row">
                            <input id="cspm-edit-use-temp-outfit" type="checkbox" ${savedPlan.useTemporaryOutfit ? 'checked' : ''} ${savedPlan.temporaryOutfitPrompt ? '' : 'disabled'}>
                            로그 의상 사용
                        </label>
                        <div class="cspm-mini-note" id="cspm-edit-temp-outfit-note">${escapeHtml(savedPlan.temporaryOutfitPrompt || '(이 이미지에는 저장된 로그 기반 임시 의상이 없어요)')}</div>
                    </div>
                    ${charCardsHtml}
                </div>

                <div class="cspm-section">
                    <div class="cspm-section-title">NAI 생성 설정</div>
                    <div class="cspm-grid">
                        <div class="cspm-field">
                            <label>Resolution</label>
                            <div class="cspm-res-row">
                                <select id="cspm-edit-orientation">
                                    <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                    <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                    <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                </select>
                                <div class="cspm-res-dims">
                                    <input id="cspm-edit-width" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                    <input id="cspm-edit-height" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                    <span class="cspm-dim-pill" id="cspm-edit-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                    <button class="cspm-dim-swap" id="cspm-edit-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                    <span class="cspm-dim-pill" id="cspm-edit-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                </div>
                            </div>
                        </div>
                        <div class="cspm-field">
                            <div class="cspm-label-row"><label>Steps</label><span class="cspm-value-chip" id="cspm-edit-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                            <div class="cspm-range-wrap">
                                <input id="cspm-edit-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                <input id="cspm-edit-steps" class="cspm-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                            </div>
                        </div>
                        <div class="cspm-field">
                            <div class="cspm-label-row"><label>Prompt Guidance</label><span class="cspm-value-chip" id="cspm-edit-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                            <div class="cspm-range-wrap">
                                <input id="cspm-edit-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                <input id="cspm-edit-scale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                            </div>
                        </div>
                        <div class="cspm-field">
                            <label>Seed</label>
                            <input id="cspm-edit-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                        </div>
                        <div class="cspm-field">
                            <label>Sampler</label>
                            <select id="cspm-edit-sampler">
                                <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                            </select>
                        </div>
                        <div class="cspm-field">
                            <div class="cspm-label-row"><label>Prompt Guidance Rescale</label><span class="cspm-value-chip" id="cspm-edit-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                            <div class="cspm-range-wrap">
                                <input id="cspm-edit-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                <input id="cspm-edit-guidance-rescale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                            </div>
                        </div>
                        <div class="cspm-field">
                            <label>Noise Schedule</label>
                            <select id="cspm-edit-noise-schedule">
                                <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="cspm-section">
                    <div class="cspm-section-title">최종 미리보기</div>
                    <div class="cspm-grid">
                        <div class="cspm-field">
                            <label>Final Prompt</label>
                            <div class="cspm-readonly-preview" id="cspm-edit-final-prompt-preview"></div>
                        </div>
                        <div class="cspm-field">
                            <label>Final Negative / UC</label>
                            <div class="cspm-readonly-preview" id="cspm-edit-final-negative-preview"></div>
                        </div>
                    </div>
                    <div class="cspm-field">
                        <label>의상 적용 상태</label>
                        <div class="cspm-readonly-preview" id="cspm-edit-outfit-preview"></div>
                    </div>
                </div>

                <div class="cspm-actions">
                    <div class="cspm-actions-left"></div>
                    <div class="cspm-actions-right">
                        <button class="cspm-anlas-chip" id="cspm-edit-current-anlas" type="button" title="클릭해서 잔여 Anlas를 조회해">? Anlas</button>
                        <button class="cspm-anlas-chip cspm-anlas-cost" id="cspm-edit-cost-chip" type="button" title="예상 소모 Anlas" hidden></button>
                        <button class="cspm-btn" id="cspm-edit-close" type="button">취소</button>
                        <button class="cspm-btn cspm-btn-primary" id="cspm-edit-reroll" type="button">이 설정으로 리롤</button>
                    </div>
                </div>
            </div>
        `;

        const widthEl = overlay.querySelector('#cspm-edit-width');
        const heightEl = overlay.querySelector('#cspm-edit-height');
        const orientationEl = overlay.querySelector('#cspm-edit-orientation');
        const widthViewEl = overlay.querySelector('#cspm-edit-width-view');
        const heightViewEl = overlay.querySelector('#cspm-edit-height-view');
        const costEl = overlay.querySelector('#cspm-edit-cost-chip');
        const balanceEl = overlay.querySelector('#cspm-edit-current-anlas');
        const useTempOutfitEl = overlay.querySelector('#cspm-edit-use-temp-outfit');
        const tempOutfitNoteEl = overlay.querySelector('#cspm-edit-temp-outfit-note');
        const outfitPreviewEl = overlay.querySelector('#cspm-edit-outfit-preview');
        let latestAnlasBalance = null;

        function syncRerollCharacterPromptsFromOutfitSource() {
            const cards = Array.from(overlay.querySelectorAll('.cspm-image-edit-character-card'));
            cards.forEach((card, index) => {
                const original = charPrompts[index] || {};
                const slot = findRoomCharacterSlotByName(original.name || savedPlan.visibleCharacters?.[0] || '', room);
                if (!slot) return;
                const promptEl = card.querySelector('.cspm-edit-character-prompt');
                if (!promptEl) return;
                const previewPlan = Object.assign({}, savedPlan, { useTemporaryOutfit: !!useTempOutfitEl?.checked });
                const mergedPrompt = getCharacterPromptForPlan(slot, previewPlan);
                if (mergedPrompt) promptEl.value = mergedPrompt;
            });
        }

        function collectEditedChars() {
            return Array.from(overlay.querySelectorAll('.cspm-image-edit-character-card')).map((card, index) => {
                const original = charPrompts[index] || {};
                return {
                    ...original,
                    name: original.name || `Character ${index + 1}`,
                    prompt: normalizeNaiWeightSyntax(normalizePrompt(card.querySelector('.cspm-edit-character-prompt')?.value || '')),
                    uc: normalizeNaiWeightSyntax(normalizePrompt(card.querySelector('.cspm-edit-character-uc')?.value || '')),
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
            const editedBasePrompt = normalizeNaiWeightSyntax(normalizePrompt(overlay.querySelector('#cspm-edit-base-prompt')?.value || ''));
            const editedBaseNegative = normalizeNaiWeightSyntax(normalizePrompt(overlay.querySelector('#cspm-edit-base-negative')?.value || ''));
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
            overlay.querySelector('#cspm-edit-final-prompt-preview').textContent = state.finalPrompt || '(empty)';
            overlay.querySelector('#cspm-edit-final-negative-preview').textContent = visibleFinalNegative || '(empty)';
            if (outfitPreviewEl) {
                const slot = findRoomCharacterSlotByName((state.charPrompts[0] || {}).name || savedPlan.visibleCharacters?.[0] || '', room);
                const appliedOutfit = state.useTemporaryOutfit ? (savedPlan.temporaryOutfitPrompt || '') : getCharacterOutfitTags(slot);
                const sourceLabel = state.useTemporaryOutfit ? '로그 의상 사용' : '캐릭터 슬롯 기본 의상 사용';
                outfitPreviewEl.textContent = `${sourceLabel}${appliedOutfit ? `\n${appliedOutfit}` : '\n(의상 태그 없음)'}`;
            }
            renderAnlasInlineUi(costEl, balanceEl, state.charPrompts, latestAnlasBalance, editSettings);
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
        overlay.querySelector('#cspm-edit-swap')?.addEventListener('click', () => {
            swapOrientationPreset(orientationEl, widthEl, heightEl, widthViewEl, heightViewEl);
            updateEditPreview();
        });
        bindRangeNumberPair(overlay.querySelector('#cspm-edit-steps-range'), overlay.querySelector('#cspm-edit-steps'), overlay.querySelector('#cspm-edit-steps-value'), { min: 1, max: 50, step: 1, decimals: 0, onChange: updateEditPreview });
        bindRangeNumberPair(overlay.querySelector('#cspm-edit-scale-range'), overlay.querySelector('#cspm-edit-scale'), overlay.querySelector('#cspm-edit-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#cspm-edit-guidance-rescale-range'), overlay.querySelector('#cspm-edit-guidance-rescale'), overlay.querySelector('#cspm-edit-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });
        overlay.querySelector('#cspm-edit-uc-preset')?.addEventListener('change', updateEditPreview);
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
        overlay.querySelector('#cspm-edit-close').onclick = () => overlay.remove();

        const imageEditRerollBtn = overlay.querySelector('#cspm-edit-reroll');
        if (imageEditRerollBtn && isSceneHistoryFull(record)) {
            imageEditRerollBtn.disabled = true;
            imageEditRerollBtn.title = `리롤 기록이 ${CSP_MAX_IMAGE_HISTORY}장까지 찼어요. 휴지통으로 이미지를 지우면 다시 리롤할 수 있어요.`;
        }

        overlay.querySelector('#cspm-edit-reroll').onclick = async () => {
            const btn = overlay.querySelector('#cspm-edit-reroll');
            const state = buildEditedPromptState();
            const settings = getImageEditNaiSettings(overlay);
            if (!state.finalPrompt) {
                showToast('⚠️ Final Prompt가 비어 있어요.');
                return;
            }
            try {
                const targetBox = box || document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
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

                const caption = targetBox?.querySelector('.cspm-generated-scene-caption');
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

                const nextRecords = getSceneRecords();
                nextRecords[messageKey] = record;
                saveSceneRecords(nextRecords);
                refreshImageHistoryControls(messageKey, targetBox, record);
                overlay.remove();
                showToast('⚙️ 수정 설정으로 리롤 완료');
            } catch (err) {
                console.error('[Univers Scene Painter Mobile] image-specific reroll failed:', err);
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
            <div class="cspm-image-info-row" aria-label="Scene Painter image info">
                <button class="cspm-image-action-btn cspm-image-info-btn" data-message-key="${escapeHtml(messageKey)}" type="button" title="정보" aria-label="정보"><svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="16px" height="16px" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m1 15h-2v-6h2zm0-8h-2V7h2z"/></svg></button>
            </div>
        `;
    }

    function insertSceneImageIntoMarkdown(markdown, imageUrl, paragraphIndex, options = {}) {
        if (!markdown) return { ok: false, reason: 'markdown-not-found' };

        const blocks = getInsertableContentBlocks(markdown);
        removeSceneImage(markdown);

        let index = 0;
        let target = null;

        if (blocks.length) {
            index = Math.max(0, Math.min(Number(paragraphIndex) || 0, blocks.length - 1));
            target = blocks[index];
        }

        const box = document.createElement('div');
        box.className = 'cspm-generated-scene-image';
        box.setAttribute('data-cspm-mode', options.mode || 'gemini');
        if (options.messageKey) box.setAttribute('data-message-key', options.messageKey);

        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = options.alt || 'Scene Painter Image';

        const caption = document.createElement('div');
        caption.className = 'cspm-generated-scene-caption';
        if (options.captionHtml) caption.innerHTML = options.captionHtml;
        else caption.textContent = options.caption || `Scene Painter 삽입 · AI 답변 문단 ${index + 1} 뒤`;

        const historyRow = document.createElement('div');
        historyRow.className = 'cspm-image-history-row';
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

        document.querySelectorAll('.cspm-lightbox-backdrop').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.className = 'cspm-lightbox-backdrop';
        overlay.innerHTML = `
            <div class="cspm-lightbox-panel">
                <div class="cspm-lightbox-topbar">
                    <button class="cspm-lightbox-btn" data-cspm-lightbox-download>다운로드</button>
                    <button class="cspm-lightbox-btn" data-cspm-lightbox-close>닫기</button>
                </div>
                <img src="${escapeHtml(src)}" alt="${escapeHtml(title)}">
            </div>
        `;

        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.closest('[data-cspm-lightbox-close]')) close();
            const downloadBtn = e.target.closest('[data-cspm-lightbox-download]');
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
        const row = document.getElementById('cspm-scene-gallery-row');
        if (!row) return;
        const badge = row.querySelector('.cspm-gallery-count-badge');
        if (!badge) return;
        const stats = getRoomGalleryStats();
        badge.textContent = String(stats.imageCount || 0);
        badge.title = `현재 방 삽화 ${stats.sceneCount}개 / 이미지 기록 ${stats.imageCount}장`;
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

        const titleEl = card.querySelector('.cspm-gallery-title');
        if (titleEl) {
            titleEl.textContent = title;
            titleEl.title = title;
        }

        const metaEl = card.querySelector('.cspm-gallery-meta');
        if (metaEl) {
            metaEl.textContent = `문단 ${paragraph} · ${safeIndex + 1} / ${safeCount}${created ? ` · ${created}` : ''}`;
        }

        const prevBtn = card.querySelector('[data-cspm-gallery-action="prev"]');
        const nextBtn = card.querySelector('[data-cspm-gallery-action="next"]');
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

        const thumb = card.querySelector('.cspm-gallery-thumb');
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
            console.warn('[Univers Scene Painter Mobile] gallery single card preview update failed:', err);
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
                console.warn('[Univers Scene Painter Mobile] gallery history image delete failed:', err);
            }
        }

        if (!record.history.length) {
            delete records[messageKey];
            saveSceneRecords(records);
            document
                .querySelectorAll(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"], .cspm-image-history-row[data-message-key="${CSS.escape(messageKey)}"]`)
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

        const targetBox = document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`);
        const img = targetBox?.querySelector('img');
        const src = await getRecordImageSrc(record);
        if (img && src) img.src = src;
        refreshImageHistoryControls(messageKey, targetBox, record);
        markSceneButtons(messageKey, true);

        return { removedAll: false, remaining: record.history.length, currentIndex: clampHistoryIndex(record) };
    }

    async function renderGalleryGrid(overlay) {
        const grid = overlay?.querySelector?.('#cspm-gallery-grid');
        const summary = overlay?.querySelector?.('#cspm-gallery-summary-text');
        if (!grid) return;

        const entries = getRoomGalleryEntries(60);
        const stats = getRoomGalleryStats();
        if (summary) {
            const limited = stats.sceneCount > entries.length ? ` · 최근 ${entries.length}개 표시` : '';
            summary.textContent = `현재 채팅방 삽화 ${stats.sceneCount}개 / 이미지 기록 ${stats.imageCount}장${limited}`;
        }

        updateGalleryRowCount();

        if (!entries.length) {
            grid.innerHTML = `<div class="cspm-gallery-empty">아직 이 채팅방에 저장된 삽화가 없어.<br>AI 답변 아래 이미지 버튼으로 먼저 한 장 뽑아줘.</div>`;
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
                <div class="cspm-gallery-card" data-message-key="${escapeHtml(entry.messageKey)}" data-gallery-index="${galleryIndex}">
                    <button class="cspm-gallery-thumb is-missing" type="button" data-cspm-gallery-action="preview">이미지 로드 중...</button>
                    <div class="cspm-gallery-card-body">
                        <div class="cspm-gallery-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        <div class="cspm-gallery-meta">문단 ${paragraph} · ${galleryIndex + 1} / ${historyCount}${created ? ` · ${escapeHtml(created)}` : ''}</div>
                        <div class="cspm-gallery-actions">
                            <button class="cspm-btn cspm-gallery-nav-btn" type="button" data-cspm-gallery-action="prev" ${galleryIndex <= 0 ? 'disabled' : ''}>‹</button>
                            <button class="cspm-btn cspm-gallery-nav-btn" type="button" data-cspm-gallery-action="next" ${galleryIndex >= historyCount - 1 ? 'disabled' : ''}>›</button>
                            <button class="cspm-btn" type="button" data-cspm-gallery-action="download">저장</button>
                            <button class="cspm-btn cspm-btn-danger" type="button" data-cspm-gallery-action="delete">삭제</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        await Promise.all(entries.map(async entry => {
            const card = grid.querySelector(`.cspm-gallery-card[data-message-key="${CSS.escape(entry.messageKey)}"]`);
            if (!card) return;
            await updateGalleryCardPreview(
                overlay,
                card,
                entry.record,
                Number(card.getAttribute('data-gallery-index') || entry.currentIndex || 0)
            );
        }));
    }


    async function downloadRoomGalleryZip() {
        const entries = getRoomGalleryEntries(9999);
        if (!entries.length) {
            showToast('⚠️ 다운로드할 갤러리 이미지가 없어요.');
            return;
        }
        if (!window.fflate?.zipSync) {
            showToast('⚠️ ZIP 모듈을 불러오지 못했어요.');
            return;
        }

        const files = {};
        let count = 0;
        for (const entry of entries) {
            const record = normalizeSceneRecordHistory(entry.record, entry.messageKey);
            const history = Array.isArray(record?.history) ? record.history : [];
            for (let i = 0; i < history.length; i++) {
                try {
                    const src = await getRecordImageSrc(record, i);
                    if (!src) continue;
                    let blob;
                    if (String(src).startsWith('data:')) blob = dataUrlToBlob(src);
                    else blob = await fetch(src).then(r => r.blob());
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    const title = sanitizeFileName(record?.plan?.sceneTitle || `scene_${count + 1}`);
                    const filename = `${String(count + 1).padStart(3, '0')}_${title}_${i + 1}.png`;
                    files[filename] = bytes;
                    count += 1;
                } catch (err) {
                    console.warn('[Univers Scene Painter Mobile] gallery zip item skipped:', err);
                }
            }
        }

        if (!count) {
            showToast('⚠️ ZIP으로 묶을 이미지 데이터를 찾지 못했어요.');
            return;
        }

        const zipped = window.fflate.zipSync(files, { level: 6 });
        const blob = new Blob([zipped], { type: 'application/zip' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `CrackScene_${sanitizeFileName(getRoomId())}_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(a.href);
            a.remove();
        }, 1000);
        showToast(`⬇️ 갤러리 ZIP 다운로드 준비 완료 (${count}장)`);
    }

    function openGalleryModal() {
        injectStyles();
        document.querySelectorAll('#cspm-gallery-modal').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'cspm-gallery-modal';
        overlay.className = 'cspm-overlay';
        overlay.innerHTML = `
            <div class="cspm-modal cspm-gallery-modal" role="dialog" aria-modal="true">
                <h2>🖼️ 현재 채팅방 삽화 갤러리</h2>
                <div class="cspm-desc">이 채팅방에서 생성한 삽화와 리롤 기록을 모아 보여줘.<br>리롤 히스토리는 이미지 하나당 최대 ${CSP_MAX_IMAGE_HISTORY}장까지 저장돼.</div>
                <div class="cspm-gallery-summary">
                    <div id="cspm-gallery-summary-text" class="cspm-mini-note">갤러리 읽는 중...</div>
                    <div class="cspm-actions-left">
                        <button class="cspm-btn cspm-btn-small" id="cspm-gallery-download-all" type="button">전체 ZIP 다운로드</button>
                        <button class="cspm-btn cspm-btn-small" id="cspm-gallery-refresh" type="button">새로고침</button>
                        <button class="cspm-btn cspm-btn-small" id="cspm-gallery-close" type="button">닫기</button>
                    </div>
                </div>
                <div id="cspm-gallery-grid" class="cspm-gallery-grid"></div>
            </div>
        `;

        const close = () => overlay.remove();
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#cspm-gallery-close').onclick = close;
        overlay.querySelector('#cspm-gallery-refresh').onclick = () => renderGalleryGrid(overlay);
        overlay.querySelector('#cspm-gallery-download-all').onclick = () => downloadRoomGalleryZip();

        overlay.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-cspm-gallery-action]');
            if (!actionEl) return;
            e.preventDefault();
            e.stopPropagation();

            const action = actionEl.getAttribute('data-cspm-gallery-action');
            const card = actionEl.closest('.cspm-gallery-card');
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
                console.error('[Univers Scene Painter Mobile] gallery action failed:', err);
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

        try {
            const err = JSON.parse(responseText);
            message = err.error?.message || err.message || message;
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

        return String(message || `HTTP ${status}`).replace(/\s+/g, ' ').trim();
    }


    function getCspmGmXmlHttpRequest() {
        try {
            if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
        } catch (_) {}

        try {
            if (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function') {
                return function cspmGmXmlHttpRequestCompat(details = {}) {
                    const result = GM.xmlHttpRequest(details);
                    if (result && typeof result.then === 'function') {
                        result.then(response => {
                            try { details.onload?.(response); } catch (_) {}
                        }).catch(error => {
                            try { details.onerror?.(error); } catch (_) {}
                        });
                    }
                    return result;
                };
            }
        } catch (_) {}

        try {
            const root = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            if (root && typeof root.GM_xmlhttpRequest === 'function') return root.GM_xmlhttpRequest;
        } catch (_) {}

        return null;
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
                console.warn('[Univers Scene Painter Mobile] GM request cancelled by user:', { method, url });
                finishReject(new Error('작업이 취소됐어요.'));
            };

            if (activeSignal) activeSignal.addEventListener('abort', onAbort, { once: true });

            const gmXhr = getCspmGmXmlHttpRequest();
            if (typeof gmXhr !== 'function') {
                finishReject(new Error('GM_xmlhttpRequest를 사용할 수 없어요. 모바일 유저스크립트 앱의 GM 권한/로더 버전을 확인해줘.'));
                return;
            }

            request = gmXhr({
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

                            console.error('[Univers Scene Painter Mobile] GM request failed:', {
                                method,
                                url,
                                status: response.status,
                                statusText: response.statusText,
                                responseText: response.responseText,
                                responseHeaders: response.responseHeaders
                            });

                            finishReject(new Error(message));
                            return;
                        }

                        if (responseType === 'arraybuffer') {
                            finishResolve(response.response);
                            return;
                        }

                        finishResolve(JSON.parse(response.responseText));
                    } catch (e) {
                        console.error('[Univers Scene Painter Mobile] GM response parse failed:', { method, url, response, error: e });
                        finishReject(e);
                    }
                },
                onerror: (error) => {
                    if (settled) return;
                    console.error('[Univers Scene Painter Mobile] GM network error:', {
                        method,
                        url,
                        error,
                        payloadLength: requestPayload ? requestPayload.length : 0
                    });
                    finishReject(new Error('네트워크 요청 실패: 콘솔의 [Univers Scene Painter Mobile] GM network error 로그를 확인해줘.'));
                },
                ontimeout: () => {
                    if (settled) return;
                    console.error('[Univers Scene Painter Mobile] GM request timeout:', { method, url });
                    finishReject(new Error('요청 시간이 초과됐어요.'));
                },
                onabort: () => {
                    if (settled) return;
                    console.error('[Univers Scene Painter Mobile] GM request aborted:', { method, url });
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

    function buildGeminiUserPrompt({ targetBubble, markdown, room }) {
        const global = getGlobalSettings();
        const paragraphs = getParagraphs(markdown);
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
            'pov', 'from viewer perspective', "viewer\\'s hand", 'hand on viewer', 'hands on viewer',
            'viewer hand', 'invisible viewer',
            'boyfriend and girlfriend'
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
                if (bare.startsWith('artist:')) return false;
                if (/^year\s*\d{4}$/.test(bare)) return false;
                if (/quality/.test(bare)) return false;
                if (/viewer.*hand|hand.*viewer/.test(bare)) return false;
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
            'male', 'female', 'office worker', 'soldier', 'doctor', 'priest', 'demon'
        ]);
        const cameraTags = new Set(['close-up', 'portrait', 'upper body', 'cowboy shot', 'medium shot', 'full body']);
        const viewTags = new Set(['front view', 'three-quarter view', 'from side', 'profile', 'dynamic angle']);
        const gazeTags = new Set(['looking at viewer', 'eye contact', 'looking away']);
        let usedCamera = false;
        let usedView = false;
        let usedGaze = false;

        const tags = String(prompt || '')
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean)
            .filter(tag => {
                const bare = tag
                    .replace(/^\d+(?:\.\d+)?::\s*/, '')
                    .replace(/::\s*$/, '')
                    .trim()
                    .toLowerCase();

                if (!bare) return false;
                if (subjectTags.has(bare)) return false;
                if (bare === 'tense atmosphere' || bare === 'cold atmosphere') {
                    // keep atmosphere tags if present, but dedupe later
                    return true;
                }

                if (cameraTags.has(bare)) {
                    if (usedCamera) return false;
                    usedCamera = true;
                    return true;
                }

                if (viewTags.has(bare)) {
                    if (usedView) return false;
                    usedView = true;
                    return true;
                }

                if (gazeTags.has(bare)) {
                    if (usedGaze) return false;
                    usedGaze = true;
                    return true;
                }

                return true;
            })
            .join(', ');

        return dedupeCommaTags(tags);
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
            console.warn('[Univers Scene Painter Mobile] scenePrompt repair failed:', err);
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

    async function generateScenePlanWithGemini(targetBubble, markdown) {
        const global = getGlobalSettings();
        const room = getRoomSettings();

        const geminiRequest = getGeminiGenerateContentRequestConfig(global);
        const url = geminiRequest.url;
        const userPrompt = buildGeminiUserPrompt({ targetBubble, markdown, room });

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
                temperature: 0.2,
                topP: 0.8,
                responseMimeType: 'application/json'
            })
        };

        const data = await requestGeminiGenerateContent(geminiRequest, payload);

        const responseText = extractTextFromGeminiResponseData(data);

        if (!responseText) throw new Error('Gemini 응답이 비어 있어요.');

        const rawPlan = extractJsonLoose(responseText);
        const normalized = normalizeGeminiScenePlan(rawPlan, room, markdown);

        if (!normalized.scenePrompt) {
            const repaired = sanitizeScenePrompt(await repairScenePromptWithGemini(targetBubble, markdown, rawPlan));
            if (repaired) {
                normalized.baseScenePrompt = repaired;
                normalized.interactionPrompt = '';
                normalized.scenePrompt = repaired;
            }
        }

        if (!normalized.scenePrompt) {
            const fallback = sanitizeScenePrompt(buildMinimalScenePromptFallback(cleanMarkdownText(markdown), 1));
            normalized.baseScenePrompt = fallback;
            normalized.interactionPrompt = '';
            normalized.scenePrompt = fallback;
            console.warn('[Univers Scene Painter Mobile] scenePrompt empty, using fallback scene tags:', fallback);
        }

        return normalized;
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

        console.log('[Univers Scene Painter Mobile] base prompt raw:', basePrompt || '');
        console.log('[Univers Scene Painter Mobile] final negative raw:', finalNegative || '');
        console.log('[Univers Scene Painter Mobile] payload negative mirrors:', {
            ucPreset: Number(settings.ucPreset || 0),
            ucPresetLabel: getNaiUcPresetLabel(settings.ucPreset),
            negative_prompt: payload.parameters.negative_prompt,
            uc: payload.parameters.uc,
            v4_negative_prompt: payload.parameters.v4_negative_prompt?.caption?.base_caption,
            char_negative_slots: payload.parameters.v4_negative_prompt?.caption?.char_captions
        });
        console.log('[Univers Scene Painter Mobile] payload char slots:', payload.parameters.v4_prompt?.caption?.char_captions);
        console.log('[Univers Scene Painter Mobile] precise reference:', preciseReference ? {
            type: preciseReference.typeLabel,
            strength: preciseReference.strength,
            fidelity: preciseReference.fidelity,
            extraAnlas: preciseReference.extraAnlas
        } : null);
        console.log('[Univers Scene Painter Mobile] NAI payload preview (precise-reference-v4.7):', payload);

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
                console.warn('[Univers Scene Painter Mobile] unzip failed, trying raw image fallback', zipErr);
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

    async function insertFinalSceneImage({ markdown, imageUrl, plan, mode, basePrompt, baseNegative, finalPrompt, finalNegative, charPrompts, referenceInfo, naiSettings }) {
        const messageKey = getMessageKey(markdown);
        const result = insertSceneImageIntoMarkdown(markdown, imageUrl, plan.insertAfterParagraph, {
            mode,
            messageKey,
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

        const infoBtn = target.closest('.cspm-image-info-btn');
        const editBtn = target.closest('.cspm-image-edit-btn');
        const downloadBtn = target.closest('.cspm-image-download-btn');
        const deleteBtn = target.closest('.cspm-image-delete-btn');
        const rerollBtn = target.closest('.cspm-image-reroll-btn');
        const historyPrevBtn = target.closest('.cspm-image-history-prev');
        const historyNextBtn = target.closest('.cspm-image-history-next');
        const clickedImage = target.closest('.cspm-generated-scene-image img');
        const actionBtn = infoBtn || editBtn || downloadBtn || deleteBtn || rerollBtn || historyPrevBtn || historyNextBtn;

        if (!actionBtn && clickedImage) {
            event.preventDefault();
            event.stopPropagation();
            const box = clickedImage.closest('.cspm-generated-scene-image');
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
        const box = actionBtn.closest('.cspm-generated-scene-image')
            || (messageKey ? document.querySelector(`.cspm-generated-scene-image[data-message-key="${CSS.escape(messageKey)}"]`) : null);
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
                console.error('[Univers Scene Painter Mobile] download failed:', err);
                showToast('⚠️ 다운로드 실패: ' + err.message);
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
            if (!record || !record.finalPrompt) {
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
            rerollBtn.setAttribute('data-cspm-loading', 'true');
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

                console.log('[Univers Scene Painter Mobile] reroll negative:', nextPromptState.finalNegative);

                const nextImageUrl = await generateImageWithNai({
                    basePrompt: nextPromptState.basePrompt || '',
                    baseNegative: nextPromptState.baseNegative || '',
                    finalPrompt: nextPromptState.finalPrompt,
                    finalNegative: nextPromptState.finalNegative,
                    charPrompts: nextPromptState.charPrompts || [],
                    settings
                });

                if (img && nextImageUrl) img.src = nextImageUrl;

                const caption = box?.querySelector('.cspm-generated-scene-caption');
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

                records[messageKey] = record;
                saveSceneRecords(records);
                refreshImageHistoryControls(messageKey, box, record);
                showToast('🔄 리롤 완료');
            } catch (err) {
                console.error('[Univers Scene Painter Mobile] reroll failed:', err);
                showToast('⚠️ 리롤 실패: ' + err.message);
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.removeAttribute('data-cspm-loading');
                rerollBtn.textContent = oldText;
            }
        }
    }

    function attachImageActionHandlers(box) {
        if (!box) return;
        box.querySelectorAll('.cspm-image-action-btn').forEach(btn => {
            if (btn.dataset.cspActionBound === 'true') return;
            btn.dataset.cspActionBound = 'true';
            btn.addEventListener('click', handleImageAction, true);
        });
    }

    function renderCharacterSlotPreview(container, charPrompts) {
        if (!container) return;

        const list = Array.isArray(charPrompts) ? charPrompts : [];
        if (!list.length) {
            container.innerHTML = '<div class="cspm-slot-preview-empty">선택된 Character Prompt 슬롯이 없어요.</div>';
            return;
        }

        container.innerHTML = `
            <div class="cspm-slot-preview-wrap">
                ${list.map((char, index) => {
                    const title = `Character ${index + 1}`;
                    const prompt = escapeHtml(char.prompt || '');
                    const uc = escapeHtml(char.uc || '') || '<span class="cspm-slot-preview-empty">(empty)</span>';
                    const ref = hasUsableReference(char)
                        ? `<div class="cspm-slot-preview-label">PRECISE REFERENCE</div><div class="cspm-slot-preview-body">${escapeHtml(getReferenceTypeLabel(char.referenceType))} · strength ${escapeHtml(String(char.referenceStrength ?? 0.6))} · fidelity ${escapeHtml(String(char.referenceFidelity ?? 0.8))} · +${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas</div>`
                        : '';
                    return `
                        <div class="cspm-slot-preview-card">
                            <div class="cspm-slot-preview-title">${title}</div>
                            <div class="cspm-slot-preview-label">PROMPT</div>
                            <div class="cspm-slot-preview-body">${prompt}</div>
                            <div class="cspm-slot-preview-label">UC</div>
                            <div class="cspm-slot-preview-body">${uc}</div>
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
        root.querySelectorAll('.cspm-section').forEach((section, index) => {
            if (section.dataset.cspCollapsible === 'true') return;
            const titleEl = section.querySelector(':scope > .cspm-section-title');
            if (!titleEl) return;

            const title = titleEl.textContent.trim();
            const body = document.createElement('div');
            body.className = 'cspm-section-body';
            Array.from(section.childNodes).forEach(node => {
                if (node !== titleEl) body.appendChild(node);
            });

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'cspm-section-toggle';
            button.innerHTML = `<span class="cspm-section-arrow">▶</span><span>${escapeHtml(title)}</span>`;
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
                const arrow = button.querySelector('.cspm-section-arrow');
                if (arrow) arrow.textContent = open ? '▼' : '▶';
            };

            button.addEventListener('click', () => setOpen(!section.classList.contains('is-open')));
            setOpen(shouldOpen);
        });
    }

    function bindTabInterface(root) {
        if (!root) return;
        root.querySelectorAll('.cspm-tablist').forEach(tablist => {
            if (tablist.dataset.cspTabsBound === 'true') return;
            tablist.dataset.cspTabsBound = 'true';
            const panelSelector = tablist.getAttribute('data-tab-panels') || '.cspm-tab-panel';
            const tabs = Array.from(tablist.querySelectorAll('.cspm-tab-btn[data-tab-target]'));
            const panels = Array.from(root.querySelectorAll(panelSelector));
            if (!tabs.length || !panels.length) return;

            const setActive = (tabId) => {
                tabs.forEach(btn => {
                    const active = btn.dataset.tabTarget === tabId;
                    btn.classList.toggle('is-active', active);
                    btn.setAttribute('aria-selected', active ? 'true' : 'false');
                    btn.setAttribute('tabindex', active ? '0' : '-1');
                });
                panels.forEach(panel => {
                    panel.hidden = panel.dataset.tabPanel !== tabId;
                });
            };

            tabs.forEach(btn => {
                btn.addEventListener('click', () => setActive(btn.dataset.tabTarget || ''));
            });

            const defaultTab = tablist.getAttribute('data-default-tab') || tabs[0].dataset.tabTarget || '';
            setActive(defaultTab);
        });
    }


    function showSceneRefineRequestModal(options = {}) {
        return new Promise(resolve => {
            const existing = document.getElementById('cspm-scene-refine-modal');
            if (existing) existing.remove();

            const title = String(options.title || '재분석 요청');
            const description = String(options.description || '현재 선택 장면을 유지한 채, 추가 요청만 반영해서 장면 태그를 다시 다듬어.');
            const placeholder = String(options.placeholder || '예: 상반신 위주로, 정면 시선, 조금 더 다정한 표정, 책상보다 복도 느낌');
            const maxLength = Math.max(50, Number(options.maxLength || 200));
            const initialValue = String(options.initialValue || '').slice(0, maxLength);

            const overlay = document.createElement('div');
            overlay.id = 'cspm-scene-refine-modal';
            overlay.className = 'cspm-overlay';
            overlay.innerHTML = `
                <div class="cspm-modal cspm-scene-refine-modal" role="dialog" aria-modal="true" aria-labelledby="cspm-scene-refine-title">
                    <h2 id="cspm-scene-refine-title">✨ ${escapeHtml(title)}</h2>
                    <div class="cspm-desc">${escapeHtml(description).replace(/\n/g, '<br>')}</div>
                    <div class="cspm-field">
                        <label>리롤 지시사항</label>
                        <textarea id="cspm-scene-refine-text" class="cspm-long" maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(initialValue)}</textarea>
                    </div>
                    <div class="cspm-mini-note">캐릭터나 장면 자체를 완전히 갈아엎기보다, 현재 장면을 기준으로 구도/표정/분위기/배경을 미세조정할 때 좋아.</div>
                    <div class="cspm-actions">
                        <div class="cspm-actions-left"><span id="cspm-scene-refine-count" class="cspm-mini-note">0 / ${maxLength}</span></div>
                        <div class="cspm-actions-right">
                            <button class="cspm-btn" id="cspm-scene-refine-cancel" type="button">취소</button>
                            <button class="cspm-btn cspm-btn-primary" id="cspm-scene-refine-confirm" type="button">확인</button>
                        </div>
                    </div>
                </div>
            `;

            const textarea = overlay.querySelector('#cspm-scene-refine-text');
            const counter = overlay.querySelector('#cspm-scene-refine-count');
            const confirmBtn = overlay.querySelector('#cspm-scene-refine-confirm');
            const cancelBtn = overlay.querySelector('#cspm-scene-refine-cancel');

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

    function showScenePlanModal({ targetBubble, markdown, plan }) {
        const existing = document.getElementById('cspm-plan-modal');
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
        overlay.id = 'cspm-plan-modal';
        overlay.className = 'cspm-overlay';

        overlay.innerHTML = `
            <div class="cspm-modal" role="dialog" aria-modal="true">
                <h2>🖼️ NAI 생성 전 확인</h2>
                <div class="cspm-desc">
                    Gemini가 장면과 삽입 위치를 골랐어.<br>프롬프트 확인/수정 후 NAI로 생성해.
                </div>

                <div class="cspm-tablist" data-default-tab="prompt" data-tab-panels=".cspm-plan-tab-panel" role="tablist" aria-label="NAI 생성 전 확인 탭">
                    <button class="cspm-tab-btn" type="button" data-tab-target="scene" role="tab" aria-selected="false">🎬 장면</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="prompt" role="tab" aria-selected="false">✍️ 프롬프트</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="detail" role="tab" aria-selected="false">📋 상세</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="generate" role="tab" aria-selected="false">⚙️ 생성</button>
                </div>

                <div class="cspm-plan-tab-panel" data-tab-panel="scene">
                    <div class="cspm-section">
                        <div class="cspm-section-title">장면 선택 / 재분석</div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>기준 문단</label>
                                <select id="cspm-focus-paragraph">${buildParagraphSelectOptions(markdown, selectedParagraphIndex)}</select>
                            </div>
                            <div class="cspm-field">
                                <label>중심 캐릭터</label>
                                <select id="cspm-focus-character">${buildCharacterSelectOptions(room, selectedCharacterName)}</select>
                            </div>
                        </div>
                        <div class="cspm-field">
                            <label>선택 문단 미리보기</label>
                            <div id="cspm-focus-preview" class="cspm-paragraph-preview">${escapeHtml(getParagraphTextByIndex(markdown, selectedParagraphIndex) || '(문단 없음)')}</div>
                        </div>
                        <div class="cspm-actions-left">
                            <button class="cspm-btn cspm-btn-small" id="cspm-reanalyze-paragraph" type="button">이 문단 기준으로 다시 분석</button>
                        </div>
                        <div class="cspm-mini-note">처음엔 전체 답변에서 자동 추천.<br>문단 선택 시 선택 문단±1만 다시 분석해.</div>
                    </div>
                </div>

                <div class="cspm-plan-tab-panel" data-tab-panel="prompt">
                    <div class="cspm-section">
                        <div class="cspm-section-title">프롬프트 조립</div>
                        <div class="cspm-field">
                            <label>고정 Positive / 작가태그</label>
                            <textarea id="cspm-fixed-positive" class="cspm-long">${escapeHtml(promptState.fixedPositive)}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>고정 Negative / UC</label>
                            <textarea id="cspm-fixed-negative" class="cspm-long">${escapeHtml(promptState.fixedNegative || '')}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>Character Prompt 슬롯</label>
                            <div class="cspm-mini-note">실제 API 전송은 각 슬롯의 영어 태그/UC 배열로 나뉘어 들어가고, 아래는 보기 편한 미리보기야.</div>
                            <div id="cspm-character-slot-preview"></div>
                            <textarea id="cspm-character-tags" class="cspm-long cspm-hidden-raw">${escapeHtml(promptState.characterTags)}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>Gemini 장면 태그 (scenePrompt)</label>
                            <textarea id="cspm-scene-prompt" class="cspm-long">${escapeHtml(promptState.scenePrompt)}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label class="cspm-check-row">
                                <input id="cspm-use-temp-outfit" type="checkbox" ${promptState.useTemporaryOutfit ? 'checked' : ''}>
                                로그 의상 사용
                            </label>
                            <textarea id="cspm-temp-outfit-prompt" class="cspm-compact-textarea">${escapeHtml(promptState.temporaryOutfitPrompt || '')}</textarea>
                            <div class="cspm-mini-note" id="cspm-temp-outfit-note">${escapeHtml(promptState.useTemporaryOutfit ? '현재 로그 의상 태그가 최종 프롬프트에 포함돼.' : '체크를 켜면 위 의상 태그를 최종 프롬프트에 포함해. 필요하면 직접 수정해도 돼.')}</div>
                        </div>
                        <div class="cspm-field">
                            <label>최종 NAI 프롬프트</label>
                            <textarea id="cspm-final-prompt" class="cspm-long">${escapeHtml(promptState.finalPrompt)}</textarea>
                            <div class="cspm-mini-note">자동으로 조립되지만, 필요하면 직접 수정해도 돼.</div>
                        </div>
                        <div class="cspm-field">
                            <label>Negative / UC</label>
                            <textarea id="cspm-final-negative" class="cspm-long">${escapeHtml(promptState.finalNegative || '')}</textarea>
                            <div class="cspm-mini-note">이 값이 NovelAI의 uc(undesired content)로 전송돼.</div>
                        </div>
                    </div>
                </div>

                <div class="cspm-plan-tab-panel" data-tab-panel="detail">
                    <div class="cspm-section">
                        <div class="cspm-section-title">장면 정보</div>
                        <div class="cspm-field">
                            <label>장면 제목</label>
                            <input id="cspm-plan-title" value="${escapeHtml(currentPlan.sceneTitle || '')}">
                        </div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>삽입 위치 (문단 index)</label>
                                <input id="cspm-plan-insert" type="number" min="0" value="${Number(currentPlan.insertAfterParagraph) || 0}">
                            </div>
                            <div class="cspm-field">
                                <label>등장 인원</label>
                                <input id="cspm-plan-count" type="number" min="1" value="${Number(currentPlan.characterCount) || 1}">
                            </div>
                        </div>
                        <div class="cspm-field">
                            <label>선택 이유</label>
                            <textarea id="cspm-plan-reason">${escapeHtml(currentPlan.reason || '')}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>전체 로그 장소/상황 컨텍스트</label>
                            <textarea id="cspm-global-context" class="cspm-long">${escapeHtml(formatGlobalContextForTextarea(currentPlan.globalContext || {}))}</textarea>
                            <div class="cspm-mini-note">문단 재분석 때 장소/시간대/큰 상황이 사라지지 않게 같이 다시 보냄. 필요하면 직접 수정 가능.</div>
                        </div>
                    </div>
                </div>

                <div class="cspm-plan-tab-panel" data-tab-panel="generate">
                    <div class="cspm-section">
                        <div class="cspm-section-title">NAI 생성 설정</div>
                        <div class="cspm-mini-note">SMEA/DYN과 다중 생성은 공유용 안정화를 위해 사용하지 않고, 항상 1장만 생성해.</div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>Resolution</label>
                                <div class="cspm-res-row">
                                    <select id="cspm-nai-orientation">
                                        <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                        <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                        <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                    </select>
                                    <div class="cspm-res-dims">
                                        <input id="cspm-nai-width" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                        <input id="cspm-nai-height" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                        <span class="cspm-dim-pill" id="cspm-nai-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                        <button class="cspm-dim-swap" id="cspm-nai-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                        <span class="cspm-dim-pill" id="cspm-nai-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Steps</label><span class="cspm-value-chip" id="cspm-nai-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-nai-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                    <input id="cspm-nai-steps" class="cspm-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                </div>
                                <div class="cspm-mini-note">29 이상부터 추가 Anlas 소모.</div>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Prompt Guidance</label><span class="cspm-value-chip" id="cspm-nai-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-nai-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                    <input id="cspm-nai-scale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                </div>
                            </div>
                            <div class="cspm-field">
                                <label>Seed</label>
                                <input id="cspm-nai-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                            </div>
                            <div class="cspm-field">
                                <label>Sampler</label>
                                <select id="cspm-nai-sampler">
                                    <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                    <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                    <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                    <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                    <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                    <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                                </select>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Prompt Guidance Rescale</label><span class="cspm-value-chip" id="cspm-nai-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-nai-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                    <input id="cspm-nai-guidance-rescale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                </div>
                            </div>
                            <div class="cspm-field">
                                <label>UC Preset</label>
                                <select id="cspm-nai-uc-preset" title="NovelAI Undesired Content Preset">
                                    ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                                </select>
                                <div class="cspm-mini-note">직접 쓴 Negative / UC와 합쳐서 전송돼.</div>
                            </div>
                            <div class="cspm-field">
                                <label>Noise Schedule</label>
                                <select id="cspm-nai-noise-schedule">
                                    <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                    <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                    <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cspm-actions">
                    <div class="cspm-actions-left">
                        <button class="cspm-btn" id="cspm-refine-plan">재분석 요청</button>
                        <button class="cspm-btn" id="cspm-copy-final">최종 프롬프트 복사</button>
                    </div>
                    <div class="cspm-actions-right">
                        <button class="cspm-anlas-chip" id="cspm-current-anlas" type="button" title="클릭해서 잔여 Anlas를 조회해">? Anlas</button>
                        <button class="cspm-anlas-chip cspm-anlas-cost" id="cspm-reference-cost-chip" type="button" title="예상 소모 Anlas" hidden></button>
                        <button class="cspm-btn" id="cspm-plan-close">취소</button>
                        <button class="cspm-btn cspm-btn-primary" id="cspm-generate-nai">NAI 생성</button>
                    </div>
                </div>
            </div>
        `;

        bindTabInterface(overlay);
        makeSectionsCollapsible(overlay, ['장면 선택 / 재분석']);

        const fixedPositiveEl = overlay.querySelector('#cspm-fixed-positive');
        const fixedNegativeEl = overlay.querySelector('#cspm-fixed-negative');
        const characterTagsEl = overlay.querySelector('#cspm-character-tags');
        const scenePromptEl = overlay.querySelector('#cspm-scene-prompt');
        const useTempOutfitEl = overlay.querySelector('#cspm-use-temp-outfit');
        const tempOutfitPromptEl = overlay.querySelector('#cspm-temp-outfit-prompt');
        const tempOutfitNoteEl = overlay.querySelector('#cspm-temp-outfit-note');
        const finalPromptEl = overlay.querySelector('#cspm-final-prompt');
        const finalNegativeEl = overlay.querySelector('#cspm-final-negative');
        const paragraphSelectEl = overlay.querySelector('#cspm-focus-paragraph');
        const characterSelectEl = overlay.querySelector('#cspm-focus-character');
        const paragraphPreviewEl = overlay.querySelector('#cspm-focus-preview');
        const reanalyzeBtn = overlay.querySelector('#cspm-reanalyze-paragraph');
        const refinePlanBtn = overlay.querySelector('#cspm-refine-plan');
        const globalContextEl = overlay.querySelector('#cspm-global-context');
        const characterSlotPreviewEl = overlay.querySelector('#cspm-character-slot-preview');
        const referenceCostChipEl = overlay.querySelector('#cspm-reference-cost-chip');
        const currentAnlasChipEl = overlay.querySelector('#cspm-current-anlas');
        let latestAnlasBalance = null;
        function updateAnlasUi() {
            const editedCharPrompts = parseCharacterPromptsFromTextarea(characterTagsEl.value, promptState.charPrompts);
            renderAnlasInlineUi(referenceCostChipEl, currentAnlasChipEl, editedCharPrompts, latestAnlasBalance, getModalNaiSettings(overlay));
        }
        renderCharacterSlotPreview(characterSlotPreviewEl, promptState.charPrompts || []);
        updateAnlasUi();
        const orientationEl = overlay.querySelector('#cspm-nai-orientation');
        const widthEl = overlay.querySelector('#cspm-nai-width');
        const heightEl = overlay.querySelector('#cspm-nai-height');
        const widthViewEl = overlay.querySelector('#cspm-nai-width-view');
        const heightViewEl = overlay.querySelector('#cspm-nai-height-view');
        const swapOrientationBtn = overlay.querySelector('#cspm-nai-swap');

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
        bindRangeNumberPair(overlay.querySelector('#cspm-nai-steps-range'), overlay.querySelector('#cspm-nai-steps'), overlay.querySelector('#cspm-nai-steps-value'), { min: 1, max: 50, step: 1, decimals: 0, onChange: updateAnlasUi });
        bindRangeNumberPair(overlay.querySelector('#cspm-nai-scale-range'), overlay.querySelector('#cspm-nai-scale'), overlay.querySelector('#cspm-nai-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#cspm-nai-guidance-rescale-range'), overlay.querySelector('#cspm-nai-guidance-rescale'), overlay.querySelector('#cspm-nai-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });

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
            currentPlan.temporaryOutfitPrompt = String(tempOutfitPromptEl?.value || '').trim();
            const livePromptState = buildFinalPromptFromPlan(currentPlan, getRoomSettings());
            promptState.charPrompts = livePromptState.charPrompts;
            promptState.characterTags = livePromptState.characterTags;
            promptState.temporaryOutfitPrompt = livePromptState.temporaryOutfitPrompt;
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
            if (tempOutfitNoteEl) tempOutfitNoteEl.textContent = currentPlan.useTemporaryOutfit
                ? '현재 로그 의상 태그가 최종 프롬프트에 포함돼.'
                : '체크를 켜면 위 의상 태그를 최종 프롬프트에 포함해.';
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

            overlay.querySelector('#cspm-plan-title').value = currentPlan.sceneTitle || '';
            overlay.querySelector('#cspm-plan-insert').value = String(currentPlan.insertAfterParagraph || 0);
            overlay.querySelector('#cspm-plan-count').value = String(currentPlan.characterCount || 1);
            overlay.querySelector('#cspm-plan-reason').value = currentPlan.reason || '';
            globalContextEl.value = formatGlobalContextForTextarea(currentPlan.globalContext || {});

            paragraphSelectEl.value = String(currentPlan.insertAfterParagraph || 0);
            paragraphPreviewEl.textContent = getParagraphTextByIndex(markdown, currentPlan.insertAfterParagraph) || '(문단 없음)';

            const selectedName = (currentPlan.visibleCharacters || currentPlan.charactersInScene || [])[0] || '';
            characterSelectEl.innerHTML = buildCharacterSelectOptions(room, selectedName);

            promptState = buildFinalPromptFromPlan(currentPlan, getRoomSettings());
            characterTagsEl.value = promptState.characterTags;
            scenePromptEl.value = promptState.scenePrompt;
            if (useTempOutfitEl) useTempOutfitEl.checked = !!currentPlan.useTemporaryOutfit;
            if (tempOutfitPromptEl) tempOutfitPromptEl.value = currentPlan.temporaryOutfitPrompt || promptState.temporaryOutfitPrompt || '';
            if (tempOutfitNoteEl) tempOutfitNoteEl.textContent = currentPlan.useTemporaryOutfit
                ? '현재 로그 의상 태그가 최종 프롬프트에 포함돼.'
                : '체크를 켜면 위 의상 태그를 최종 프롬프트에 포함해.';
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
            overlay.querySelector('#cspm-plan-insert').value = String(idx);
            currentPlan.insertAfterParagraph = idx;
        });

        characterSelectEl.addEventListener('change', () => {
            const name = characterSelectEl.value.trim();
            currentPlan.visibleCharacters = name ? [name] : [];
            currentPlan.charactersInScene = currentPlan.visibleCharacters;
            currentPlan.characterCount = Math.max(1, currentPlan.visibleCharacters.length || 1);
            overlay.querySelector('#cspm-plan-count').value = String(currentPlan.characterCount);
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
                console.error('[Univers Scene Painter Mobile] paragraph reanalysis failed:', err);
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
            editedBeforeRefine.temporaryOutfitPrompt = currentPlan.temporaryOutfitPrompt || '';

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
                console.error('[Univers Scene Painter Mobile] scene refine request failed:', err);
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
                sceneTitle: overlay.querySelector('#cspm-plan-title').value.trim(),
                insertAfterParagraph: Number(overlay.querySelector('#cspm-plan-insert').value || 0),
                characterCount: Math.max(1, visible.length || Number(overlay.querySelector('#cspm-plan-count').value || 1)),
                visibleCharacters: visible.slice(0, 1),
                charactersInScene: visible.slice(0, 1),
                mood: currentPlan.mood || '',
                globalContext: parseGlobalContextFromTextarea(globalContextEl.value, currentPlan.globalContext || {}),
                composition: currentPlan.composition || '',
                baseScenePrompt: currentPlan.baseScenePrompt || scenePromptEl.value.trim(),
                interactionPrompt: currentPlan.interactionPrompt || '',
                scenePrompt: scenePromptEl.value.trim(),
                temporaryOutfitPrompt: String(tempOutfitPromptEl?.value || currentPlan.temporaryOutfitPrompt || '').trim(),
                useTemporaryOutfit: !!useTempOutfitEl?.checked,
                reason: overlay.querySelector('#cspm-plan-reason').value.trim()
            };
        }

        function collectNaiSettings() {
            return {
                orientationPreset: overlay.querySelector('#cspm-nai-orientation').value,
                width: Number(overlay.querySelector('#cspm-nai-width').value || 832),
                height: Number(overlay.querySelector('#cspm-nai-height').value || 1216),
                steps: Number(overlay.querySelector('#cspm-nai-steps').value || 28),
                scale: Number(overlay.querySelector('#cspm-nai-scale').value || 6.5),
                guidanceRescale: Number(overlay.querySelector('#cspm-nai-guidance-rescale').value || 0.3),
                seed: overlay.querySelector('#cspm-nai-seed').value.trim(),
                sampler: overlay.querySelector('#cspm-nai-sampler').value,
                noiseSchedule: overlay.querySelector('#cspm-nai-noise-schedule').value,
                nSamples: 1,
                smea: false,
                dyn: false,
                ucPreset: Number(overlay.querySelector('#cspm-nai-uc-preset')?.value || 0)
            };
        }

        function saveGenerationGlobalEdits() {
            const nextGlobal = getGlobalSettings();
            nextGlobal.basePositive = fixedPositiveEl.value.trim();
            nextGlobal.baseNegative = fixedNegativeEl.value.trim();
            nextGlobal.naiSettings = collectNaiSettings();
            saveGlobalSettings(nextGlobal);
        }

        overlay.querySelector('#cspm-plan-close').onclick = () => overlay.remove();

        overlay.querySelector('#cspm-copy-final').onclick = async () => {
            await navigator.clipboard.writeText(finalPromptEl.value);
            showToast('✅ 최종 프롬프트 복사 완료');
        };
        overlay.querySelector('#cspm-generate-nai').onclick = async () => {
            const btn = overlay.querySelector('#cspm-generate-nai');
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
                    naiSettings
                });
                overlay.remove();
            } catch (err) {
                console.error('[Univers Scene Painter Mobile] NAI generation failed:', err);
                showToast('⚠️ NAI 생성 실패: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'NAI 생성';
            }
        };

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        refreshAnlasBalance(true);
        document.body.appendChild(overlay);
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
                button.setAttribute('data-cspm-loading', 'true');
                button.title = '스피드 모드 생성 중...';
            }

            showToast('⚡ 스피드 모드 시작: 분석 후 바로 생성해요.');
            showTaskHud('스피드 모드', 'Gemini 분석부터 NAI 생성까지 확인창 없이 바로 진행해.', 10);
            const ticker = startTaskHudTicker([
                { title: 'Gemini 분석 중', message: 'AI 답변에서 삽화로 만들 장면을 자동으로 고르는 중이야.', progress: 26 },
                { title: '프롬프트 조립 중', message: '캐릭터 슬롯과 장면 태그를 합쳐 NAI 프롬프트를 만들고 있어.', progress: 48 },
                { title: 'NAI 생성 중', message: '이미지를 생성하고 있어. 이 단계에서 Anlas가 소모될 수 있어.', progress: 72 },
                { title: '이미지 삽입 중', message: '생성된 이미지를 답변 문단 사이에 넣고 기록을 저장하고 있어.', progress: 90 }
            ]);

            const plan = await generateScenePlanWithGemini(bubble, markdown);
            const roomCharacters = (room.characters || []).filter(hasCharacterSlotContent);
            const matchedFocusNames = findCharacterNamesInText(room, getSceneWindowText(markdown, plan.insertAfterParagraph, 1) || cleanMarkdownText(markdown));
            const fallbackVisible = (plan.visibleCharacters || []).filter(Boolean);
            const chosenVisible = fallbackVisible.find(name => findRoomCharacterSlotByName(name, room))
                || matchedFocusNames.find(name => findRoomCharacterSlotByName(name, room))
                || (roomCharacters[0]?.name || '');
            plan.visibleCharacters = chosenVisible ? [chosenVisible] : [];
            plan.charactersInScene = plan.visibleCharacters.slice();
            plan.characterCount = Math.max(1, plan.visibleCharacters.length || 1);
            // 스피드 모드는 의상도 자동 처리: 로그 기반 임시 의상이 잡히면 그걸 우선 사용합니다.
            plan.useTemporaryOutfit = !!plan.temporaryOutfitPrompt;

            const promptState = buildFinalPromptFromPlan(plan, room);
            const charPrompts = promptState.charPrompts || [];
            const referenceInfoForRequest = getReferenceSummary(charPrompts);

            const generatedImageUrl = await generateImageWithNai({
                basePrompt: promptState.basePrompt,
                baseNegative: promptState.baseNegative,
                finalPrompt: promptState.finalPrompt,
                finalNegative: promptState.finalNegative,
                charPrompts,
                settings: naiSettings
            });

            await insertFinalSceneImage({
                markdown,
                imageUrl: generatedImageUrl,
                plan,
                mode: 'nai',
                basePrompt: promptState.basePrompt,
                baseNegative: promptState.baseNegative,
                finalPrompt: promptState.finalPrompt,
                finalNegative: promptState.finalNegative,
                charPrompts,
                referenceInfo: referenceInfoForRequest,
                naiSettings
            });

            updateTaskHud({ title: '스피드 모드 완료', message: '분석부터 이미지 삽입까지 끝났어.', progress: 100, status: 'success' });
            showToast('⚡ 스피드 모드 생성 완료');
            setTimeout(() => hideTaskHud(), 420);
            markSceneButtons(messageKey, true);
        } catch (err) {
            console.error('[Univers Scene Painter Mobile] speed mode failed:', err);
            updateTaskHud({ title: '스피드 모드 실패', message: '스피드 모드 생성에 실패했어.\n\n사유: ' + err.message, progress: 100, status: 'error' });
            showToast('⚠️ 스피드 모드 실패: ' + err.message);
            setTimeout(() => hideTaskHud(), 1800);
        } finally {
            if (button) {
                button.disabled = false;
                button.removeAttribute('data-cspm-loading');
                button.title = '스피드 모드: 분석 후 바로 NAI 생성';
            }
        }
    }

    function makeMessageSpeedButton(bubble, markdown) {
        const btn = document.createElement('button');
        btn.className = 'cspm-message-speed-btn';
        btn.type = 'button';
        btn.title = '스피드 모드: 분석 후 바로 NAI 생성';
        btn.setAttribute('aria-label', 'AI 삽화 스피드 생성');
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="22px" height="22px" aria-hidden="true">
                <path d="M13.25 2.75 5.3 13.1c-.5.65-.04 1.6.78 1.6h4.38l-1.7 6.1c-.18.66.65 1.08 1.1.56l8.1-9.46c.56-.65.1-1.66-.76-1.66h-4.05l1.8-6.3c.2-.68-.55-1.23-1.02-.69Z"></path>
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

    async function reapplySavedScene(markdown, cachedRecords = null, knownKey = '') {
        const key = knownKey || getMessageKey(markdown);
        const records = cachedRecords || getSceneRecords();
        const record = records[key];
        if (!record) {
            if (markdown?.dataset) markdown.dataset.cspmRestoreChecked = 'true';
            return;
        }
        if (markdown.querySelector('.cspm-generated-scene-image')) return;

        normalizeSceneRecordHistory(record, key);

        let imageUrl = await getRecordImageSrc(record);
        if (String(imageUrl || '').startsWith('blob:')) {
            delete records[key];
            saveSceneRecords(records);
            return;
        }

        if (!imageUrl) return;

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

        const result = insertSceneImageIntoMarkdown(markdown, imageUrl, record.paragraphIndex, {
            mode: record.mode || 'gemini',
            messageKey: key,
            captionHtml: buildCaption(record.plan || {}, record.paragraphIndex, 'restore', {
                basePrompt: record.basePrompt || '',
                baseNegative: record.baseNegative || '',
                finalPrompt: record.finalPrompt || '',
                charPrompts: record.charPrompts || [],
                referenceInfo: record.referenceInfo || getReferenceSummary(record.charPrompts || []),
                naiSettings: record.naiSettings || null
            }, key),
            historyHtml: buildImageFooterControls(key, record)
        });
        if (result?.box) refreshImageHistoryControls(key, result.box, record);
        if (markdown?.dataset) markdown.dataset.cspmRestoreChecked = 'true';
        markSceneButtons(key, true);
    }

    function makeMessageGenerateButton(bubble, markdown) {
        const btn = document.createElement('button');
        btn.className = 'cspm-message-generate-btn';
        btn.type = 'button';
        btn.title = '이 AI 답변으로 이미지 생성';
        btn.setAttribute('aria-label', 'AI 삽화 생성');
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="24px" height="24px">
                <path d="M19.5 3h-15A2.5 2.5 0 0 0 2 5.5v13A2.5 2.5 0 0 0 4.5 21h15a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 19.5 3M4 5.5c0-.28.22-.5.5-.5h15c.28 0 .5.22.5.5v9.08l-3.4-3.4a1.5 1.5 0 0 0-2.12 0l-2.1 2.1-3.13-3.13a1.5 1.5 0 0 0-2.12 0L4 13.29zm.5 13.5a.5.5 0 0 1-.5-.5v-2.38l4.18-4.18 6.06 6.06zm15.5-.5a.5.5 0 0 1-.5.5h-2.43l-3.28-3.28 1.75-1.75L20 18.43z"></path>
                <path d="M16.5 9.25a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5"></path>
            </svg>
        `;

        const key = getMessageKey(markdown);
        const records = getSceneRecords();
        btn.setAttribute('data-message-key', key);
        if (records[key]) btn.setAttribute('data-cspm-has-image', 'true');

        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!isEnabled()) {
                showToast('⏸️ AI 삽화 생성이 OFF 상태예요.');
                return;
            }

            console.log('[Univers Scene Painter Mobile] image button clicked:', { key, markdown });
            btn.setAttribute('data-cspm-loading', 'true');
            btn.disabled = true;
            btn.title = 'Gemini가 장면을 분석 중...';
            showToast('🔎 Gemini가 장면과 삽입 위치를 분석 중...');
            showTaskHud('장면 분석 시작', '지금 선택한 AI 답변을 읽고, 어디에 어떤 장면을 넣을지 고르는 중이야.', 10);
            const ticker = startTaskHudTicker([
                { title: '로그 정리 중', message: '현재 AI 답변의 문단과 장면 흐름을 정리하고 있어.', progress: 24 },
                { title: 'Gemini 분석 요청', message: 'Gemini API에 장면 분석을 요청했어. 이 단계가 길어지면 API 응답 대기 중일 수 있어.', progress: 46 },
                { title: '응답 해석 중', message: '받아온 JSON을 읽고, 삽입 위치와 장면 태그를 정리하고 있어.', progress: 68 },
                { title: '확인창 준비 중', message: '확인창과 프롬프트 초안을 만들고 있어.', progress: 84 }
            ]);

            try {
                const plan = await generateScenePlanWithGemini(bubble, markdown);
                console.log('[Univers Scene Painter Mobile] Gemini scene plan:', plan);
                updateTaskHud({ title: '분석 완료', message: 'Gemini 분석이 끝났어. 생성 전에 확인창을 열어줄게.', progress: 100, status: 'success' });
                showScenePlanModal({ targetBubble: bubble, markdown, plan });
                showToast('✅ Gemini 분석 완료. 생성 전 확인창을 열었어요.');
                setTimeout(() => hideTaskHud(), 360);
            } catch (err) {
                console.error('[Univers Scene Painter Mobile] Gemini 분석 실패:', err);
                updateTaskHud({ title: '분석 실패', message: '버튼을 눌렀는데 아무 창도 안 뜨면 보통 이 단계에서 실패한 거야.\n콘솔의 [Univers Scene Painter Mobile] 로그와 오류 메시지를 확인해줘.\n\n사유: ' + err.message, progress: 100, status: 'error' });
                showToast('⚠️ Gemini 분석 실패: ' + err.message);
                setTimeout(() => hideTaskHud(), 1800);
            } finally {
                ticker.stop();
                btn.removeAttribute('data-cspm-loading');
                btn.disabled = false;
                btn.title = '이 AI 답변으로 이미지 생성';
            }
        });

        return btn;
    }

    function injectMessageButtons() {
        cleanupNonAssistantMessageButtons();
        if (!isEnabled()) return;

        const records = getSceneRecords();
        const recordKeys = new Set(Object.keys(records || {}));
        const bubbles = getAssistantBubbles().slice(-CSPM_MAX_BUBBLES_PER_PASS);

        bubbles.forEach(bubble => {
            const markdown = getDirectMarkdown(bubble);
            if (!markdown || !isLikelyAssistantMarkdown(markdown) || isUserBubble(bubble)) return;

            const footer = getButtonTargetFooter(bubble, markdown);
            if (!footer) return;

            const key = getMessageKey(markdown);
            if (recordKeys.has(key)) {
                reapplySavedScene(markdown, records, key);
            } else if (markdown?.dataset && !markdown.dataset.cspmRestoreChecked) {
                markdown.dataset.cspmRestoreChecked = 'true';
            }

            let leftSlot = footer.children[0];
            if (!leftSlot) {
                leftSlot = document.createElement('div');
                leftSlot.className = 'flex items-center space-x-3';
                footer.insertBefore(leftSlot, footer.firstChild);
            }

            if (!footer.querySelector('.cspm-message-generate-btn')) {
                const btn = makeMessageGenerateButton(bubble, markdown);
                leftSlot.prepend(btn);
            }
            if (!footer.querySelector('.cspm-message-speed-btn')) {
                const speedBtn = makeMessageSpeedButton(bubble, markdown);
                const normalBtn = footer.querySelector('.cspm-message-generate-btn');
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
            card.className = 'cspm-character-card';
            card.innerHTML = `
                <div class="cspm-character-head">
                    <span>캐릭터 ${index + 1}</span>
                    <button class="cspm-btn cspm-btn-small cspm-remove-character" type="button">삭제</button>
                </div>
                <div class="cspm-field">
                    <label>이름</label>
                    <input class="cspm-character-name" value="${escapeHtml(getCharacterSlotName(char))}" placeholder="예: 라자엘">
                </div>
                <div class="cspm-field">
                    <label>외형 태그</label>
                    <textarea class="cspm-character-appearance" placeholder="boy, black hair, glasses...">${escapeHtml(char.appearanceTags || char.tags || '')}</textarea>
                </div>
                <div class="cspm-field">
                    <label>기본 의상 태그</label>
                    <textarea class="cspm-character-outfit" placeholder="suit, lab coat, office uniform...">${escapeHtml(char.outfitTags || '')}</textarea>
                </div>
                <div class="cspm-field">
                    <label>캐릭터별 Undesired Content</label>
                    <textarea class="cspm-character-uc" placeholder="silver hair, blue eyes...">${escapeHtml(char.uc || '')}</textarea>
                </div>

                <div class="cspm-reference-box">
                    <label class="cspm-check-row">
                        <input class="cspm-reference-enabled" type="checkbox" ${char.referenceEnabled ? 'checked' : ''}>
                        Precise Reference 사용 <span class="cspm-inline-note">(+${PRECISE_REFERENCE_EXTRA_ANLAS} Anlas / 생성)</span>
                    </label>
                    <div class="cspm-grid-3">
                        <div class="cspm-field">
                            <label>Reference Type</label>
                            <select class="cspm-reference-type">
                                <option value="character" ${normalizeReferenceType(char.referenceType) === 'character' ? 'selected' : ''}>Character Reference</option>
                                <option value="style" ${normalizeReferenceType(char.referenceType) === 'style' ? 'selected' : ''}>Style Reference</option>
                                <option value="character_style" ${normalizeReferenceType(char.referenceType) === 'character_style' ? 'selected' : ''}>Character & Style Reference</option>
                            </select>
                        </div>
                        <div class="cspm-field">
                            <label>Strength</label>
                            <input class="cspm-reference-strength" type="number" min="-1" max="1" step="0.05" value="${escapeHtml(String(char.referenceStrength ?? 0.6))}">
                        </div>
                        <div class="cspm-field">
                            <label>Fidelity</label>
                            <input class="cspm-reference-fidelity" type="number" min="-1" max="1" step="0.05" value="${escapeHtml(String(char.referenceFidelity ?? 0.8))}">
                        </div>
                    </div>
                    <input class="cspm-reference-asset-id" type="hidden" value="${escapeHtml(char.referenceAssetId || '')}">
                    <input class="cspm-reference-image-name" type="hidden" value="${escapeHtml(char.referenceImageName || '')}">
                    <div class="cspm-reference-preview-row">
                        <img class="cspm-reference-preview-img" alt="Reference preview" style="display:none;">
                        <div class="cspm-reference-preview-actions">
                            <input class="cspm-reference-file" type="file" accept="image/png,image/jpeg,image/webp">
                            <button class="cspm-btn cspm-btn-small cspm-reference-delete" type="button" style="display:none;">Reference 삭제</button>
                            <div class="cspm-mini-note cspm-reference-status">Reference 파일 없음</div>
                        </div>
                    </div>
                    <div class="cspm-mini-note">권장: 전신 / 중립 포즈 / 단순 배경 / 얼굴이 잘 보이는 깨끗한 이미지. 선택한 Reference 이미지는 내부 저장소에 보관돼.</div>
                </div>
            `;
            card.querySelector('.cspm-remove-character').onclick = async () => {
                const cards = Array.from(container.querySelectorAll('.cspm-character-card'));
                if (cards.length <= 1) {
                    showToast('⚠️ 캐릭터는 최소 1명은 남겨둬야 해요.');
                    return;
                }
                const assetId = card.querySelector('.cspm-reference-asset-id')?.value || '';
                if (assetId) {
                    try { await deleteReferenceFileFromLibrary(assetId); } catch (_) {}
                }
                card.remove();
            };

            const fileInput = card.querySelector('.cspm-reference-file');
            const assetIdInput = card.querySelector('.cspm-reference-asset-id');
            const imageNameInput = card.querySelector('.cspm-reference-image-name');
            const enabledInput = card.querySelector('.cspm-reference-enabled');
            const deleteRefBtn = card.querySelector('.cspm-reference-delete');

            fileInput?.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                if (!file) return;
                try {
                    const oldAssetId = assetIdInput.value;
                    const slotName = card.querySelector('.cspm-character-name')?.value.trim() || 'character';
                    const nextAssetId = await saveReferenceFileToLibrary(file, slotName);
                    if (oldAssetId && oldAssetId !== nextAssetId) {
                        try { await deleteReferenceFileFromLibrary(oldAssetId); } catch (_) {}
                    }
                    assetIdInput.value = nextAssetId;
                    imageNameInput.value = file.name || nextAssetId;
                    enabledInput.checked = true;
                    await hydrateReferencePreview(card, nextAssetId);
                    showToast('🖼️ Character Reference 이미지를 내부 저장소에 저장했어요.');
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
                showToast('🧹 Reference 이미지를 내부 저장소에서 삭제했어요.');
            });

            container.appendChild(card);

            // 일부 브라우저/확장 조합에서 innerHTML의 value attribute만으로는
            // 한글 이름이 input property에 안정적으로 반영되지 않는 사례가 있어 한 번 더 주입한다.
            const nameInput = card.querySelector('.cspm-character-name');
            if (nameInput) nameInput.value = getCharacterSlotName(char);

            hydrateReferencePreview(card, char.referenceAssetId || '');
        });
    }

    function collectCharacters(container) {
        return Array.from(container.querySelectorAll('.cspm-character-card')).map(card => {
            const appearanceTags = card.querySelector('.cspm-character-appearance')?.value.trim() || '';
            const outfitTags = card.querySelector('.cspm-character-outfit')?.value.trim() || '';
            return {
                name: String(card.querySelector('.cspm-character-name')?.value || '').trim(),
                appearanceTags,
                outfitTags,
                tags: buildCommaPrompt([appearanceTags, outfitTags]),
                uc: card.querySelector('.cspm-character-uc')?.value.trim() || '',
                referenceEnabled: !!card.querySelector('.cspm-reference-enabled')?.checked,
                referenceType: normalizeReferenceType(card.querySelector('.cspm-reference-type')?.value || 'character'),
                referenceAssetId: card.querySelector('.cspm-reference-asset-id')?.value.trim() || '',
                referenceImageName: card.querySelector('.cspm-reference-image-name')?.value.trim() || '',
                referenceStrength: clampNumber(card.querySelector('.cspm-reference-strength')?.value, -1, 1, 0.6),
                referenceFidelity: clampNumber(card.querySelector('.cspm-reference-fidelity')?.value, -1, 1, 0.8)
            };
        }).filter(hasCharacterSlotContent);
    }

    function clearRoomSceneRecords() {
        localStorage.removeItem(getSceneRecordsKey());
        document.querySelectorAll('.cspm-generated-scene-image, .cspm-image-history-row').forEach(el => el.remove());
        document.querySelectorAll('.cspm-message-generate-btn, .cspm-message-speed-btn').forEach(btn => btn.removeAttribute('data-cspm-has-image'));
        updateGalleryRowCount();
    }

    function openSettingsModal() {
        injectStyles();
        const existing = document.getElementById('cspm-settings-modal');
        if (existing) existing.remove();

        const global = getGlobalSettings();
        const room = getRoomSettings();
        const settings = global.naiSettings || getDefaultGlobalSettings().naiSettings;
        const roomId = getRoomId();

        const overlay = document.createElement('div');
        overlay.id = 'cspm-settings-modal';
        overlay.className = 'cspm-overlay';

        overlay.innerHTML = `
            <div class="cspm-modal" role="dialog" aria-modal="true">
                <h2>🎨 Crack Scene Painter 설정</h2>
                <div class="cspm-desc">
                    Gemini: 장면/삽입 위치 분석<br>NAI: 실제 이미지 생성<br>저장: 내부 갤러리 · 다운로드 · ZIP<br>채팅방 ID: <b>${escapeHtml(roomId)}</b>
                </div>

                <div class="cspm-tablist" data-default-tab="api" data-tab-panels=".cspm-settings-tab-panel" role="tablist" aria-label="Scene Painter 설정 탭">
                    <button class="cspm-tab-btn" type="button" data-tab-target="api" role="tab" aria-selected="false">🔑 API</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="character" role="tab" aria-selected="false">🎭 캐릭터</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="prompt" role="tab" aria-selected="false">✍️ 프롬프트</button>
                    <button class="cspm-tab-btn" type="button" data-tab-target="advanced" role="tab" aria-selected="false">⚙️ 고급</button>
                </div>

                <div class="cspm-settings-tab-panel" data-tab-panel="api">
                    <div class="cspm-section">
                        <div class="cspm-section-title">API 설정</div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>Gemini API 방식</label>
                                <select id="cspm-gemini-provider">
                                    <option value="ai-studio" ${(global.geminiProvider || 'ai-studio') === 'ai-studio' ? 'selected' : ''}>Google AI Studio API Key</option>
                                    <option value="vertex" ${global.geminiProvider === 'vertex' ? 'selected' : ''}>Vertex AI OAuth</option>
                                    <option value="firebase" ${global.geminiProvider === 'firebase' ? 'selected' : ''}>Firebase AI Logic Beta</option>
                                </select>
                            </div>
                            <div class="cspm-field">
                                <label>Gemini 모델</label>
                                <select id="cspm-google-model">
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
                        <div class="cspm-field">
                            <label>Google Gemini API Key</label>
                            <input id="cspm-google-key" type="password" value="${escapeHtml(global.googleApiKey)}" placeholder="AI Studio API 키">
                        </div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>Vertex Project ID</label>
                                <input id="cspm-vertex-project" value="${escapeHtml(global.vertexProjectId || '')}" placeholder="my-gcp-project-id">
                            </div>
                            <div class="cspm-field">
                                <label>Vertex Location</label>
                                <input id="cspm-vertex-location" value="${escapeHtml(global.vertexLocation || 'us-central1')}" placeholder="us-central1 또는 global">
                            </div>
                        </div>
                        <div class="cspm-field">
                            <label>Vertex OAuth Access Token</label>
                            <input id="cspm-vertex-token" type="password" value="${escapeHtml(global.vertexAccessToken || '')}" placeholder="ya29...">
                            <div class="cspm-mini-note">Vertex AI 사용 시 입력해.<br>Gemini 3.x에서 404가 나면 Vertex Location을 global로 바꿔봐.</div>
                        </div>
                        <div class="cspm-field">
                            <label>Firebase Config JSON / JS 객체 <span class="cspm-mini-note">(Beta)</span></label>
                            <textarea id="cspm-firebase-config" placeholder='const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", appId: "..." };'>${escapeHtml(global.firebaseConfigJson || '')}</textarea>
                            <div class="cspm-mini-note">Firebase 콘솔에서 복사한 firebaseConfig 객체를 그대로 붙여넣어.</div>
                        </div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>Firebase Location</label>
                                <input id="cspm-firebase-location" value="${escapeHtml(global.firebaseLocation || 'global')}" placeholder="global">
                            </div>
                            <div class="cspm-field">
                                <label>Firebase SDK Version</label>
                                <input id="cspm-firebase-sdk-version" value="${escapeHtml(global.firebaseSdkVersion || '12.5.0')}" placeholder="12.5.0">
                            </div>
                        </div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>NAI 모델</label>
                                <input id="cspm-nai-model" value="${escapeHtml(global.naiModel || 'nai-diffusion-4-5-full')}" placeholder="nai-diffusion-4-5-full">
                            </div>
                            <div class="cspm-field">
                                <label>NAI API Key / Token</label>
                                <input id="cspm-nai-key" type="password" value="${escapeHtml(global.naiApiKey)}" placeholder="NAI API 키 또는 토큰">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cspm-settings-tab-panel" data-tab-panel="character">
                    <div class="cspm-section">
                        <div class="cspm-section-title">현재 채팅방 Character Prompt 슬롯</div>
                        <div class="cspm-mini-note">이 방에만 저장되는 캐릭터 슬롯이야. 여러 방에서 같은 캐릭터를 쓸 땐 아래 퀵 슬롯으로 저장/불러오기 가능.</div>
                        <div id="cspm-character-list"></div>
                        <button class="cspm-btn cspm-btn-small" id="cspm-add-character" type="button">+ 캐릭터 추가</button>

                        <div class="cspm-section-subbox">
                            <div class="cspm-section-title">퀵 슬롯</div>
                            <div class="cspm-mini-note">현재 캐릭터 슬롯 묶음을 전역 저장해두고, 다른 채팅방에서 바로 불러올 수 있어.</div>
                            <div class="cspm-grid cspm-quick-slot-grid">
                                <div class="cspm-field">
                                    <label>저장 / 덮어쓰기 이름</label>
                                    <input id="cspm-quick-slot-name" placeholder="@뤼붕이, @뤼붕이1">
                                </div>
                                <div class="cspm-field">
                                    <label>불러올 퀵 슬롯</label>
                                    <select id="cspm-quick-slot-select">${buildQuickSlotOptions(global.characterQuickSlots || [])}</select>
                                </div>
                            </div>
                            <div class="cspm-actions-left cspm-quick-slot-actions">
                                <button class="cspm-btn cspm-btn-small" id="cspm-quick-slot-save" type="button">저장 / 덮어쓰기</button>
                                <button class="cspm-btn cspm-btn-small" id="cspm-quick-slot-load" type="button">불러오기</button>
                                <button class="cspm-btn cspm-btn-small cspm-btn-danger" id="cspm-quick-slot-delete" type="button">삭제</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cspm-settings-tab-panel" data-tab-panel="prompt">
                    <div class="cspm-section">
                        <div class="cspm-section-title">Gemini 분석 지침</div>
                        <div class="cspm-field">
                            <label>Gemini 분석 지침<br><span class="cspm-mini-note">로그를 읽고 장면 태그를 만들 때 사용</span></label>
                            <textarea id="cspm-gemini-instruction" class="cspm-long">${escapeHtml(global.geminiInstruction)}</textarea>
                        </div>
                    </div>

                    <div class="cspm-section">
                        <div class="cspm-section-title">공통 고정 프롬프트</div>
                        <div class="cspm-field">
                            <label>고정 Positive / 작가태그</label>
                            <textarea id="cspm-base-positive" class="cspm-long" placeholder="artist tags, base style tags...">${escapeHtml(global.basePositive || '')}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>고정 Negative / UC</label>
                            <textarea id="cspm-base-negative" class="cspm-long" placeholder="bad anatomy, blurry...">${escapeHtml(global.baseNegative || '')}</textarea>
                        </div>
                        <div class="cspm-field">
                            <label>Gemini 장면 태그 지침</label>
                            <div class="cspm-mini-note">장면 태그 생성용 보조 지침. 짧고 안정적인 태그를 만들 때 사용해.</div>
                            <textarea id="cspm-nai-prompt-guide" class="cspm-long">${escapeHtml(global.naiPromptGuide || getDefaultNaiPromptGuide())}</textarea>
                        </div>
                    </div>
                </div>

                <div class="cspm-settings-tab-panel" data-tab-panel="advanced">
                    <div class="cspm-section">
                        <div class="cspm-section-title">공통 NAI 생성 설정</div>
                        <div class="cspm-mini-note">SMEA/DYN·다중 생성은 비활성화. 항상 1장만 생성해.</div>
                        <div class="cspm-grid">
                            <div class="cspm-field">
                                <label>Resolution</label>
                                <div class="cspm-res-row">
                                    <select id="cspm-default-orientation">
                                        <option value="portrait" ${detectOrientationPreset(settings.width, settings.height) === 'portrait' ? 'selected' : ''}>Portrait (832x1216)</option>
                                        <option value="landscape" ${detectOrientationPreset(settings.width, settings.height) === 'landscape' ? 'selected' : ''}>Landscape (1216x832)</option>
                                        <option value="square" ${detectOrientationPreset(settings.width, settings.height) === 'square' ? 'selected' : ''}>Square (1024x1024)</option>
                                    </select>
                                    <div class="cspm-res-dims">
                                        <input id="cspm-default-width" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.width ?? 832))}">
                                        <input id="cspm-default-height" class="cspm-size-hidden" type="number" value="${escapeHtml(String(settings.height ?? 1216))}">
                                        <span class="cspm-dim-pill" id="cspm-default-width-view">${escapeHtml(String(settings.width ?? 832))}</span>
                                        <button class="cspm-dim-swap" id="cspm-default-swap" type="button" title="가로 / 세로 바꾸기" aria-label="가로 / 세로 바꾸기">×</button>
                                        <span class="cspm-dim-pill" id="cspm-default-height-view">${escapeHtml(String(settings.height ?? 1216))}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Steps</label><span class="cspm-value-chip" id="cspm-default-steps-value">${escapeHtml(String(settings.steps ?? 28))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-default-steps-range" type="range" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                    <input id="cspm-default-steps" class="cspm-range-number" type="text" inputmode="decimal" min="1" max="50" step="1" value="${escapeHtml(String(settings.steps ?? 28))}">
                                </div>
                                <div class="cspm-mini-note">29 이상부터 추가 Anlas 소모.</div>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Prompt Guidance</label><span class="cspm-value-chip" id="cspm-default-scale-value">${escapeHtml(Number(settings.scale ?? 6.5).toFixed(1))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-default-scale-range" type="range" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                    <input id="cspm-default-scale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="10" step="0.1" value="${escapeHtml(String(settings.scale ?? 6.5))}">
                                </div>
                            </div>
                            <div class="cspm-field">
                                <label>Seed</label>
                                <input id="cspm-default-seed" value="${escapeHtml(String(settings.seed ?? ''))}" placeholder="빈칸이면 랜덤">
                            </div>
                            <div class="cspm-field">
                                <label>Sampler</label>
                                <select id="cspm-default-sampler">
                                    <option value="k_euler_ancestral" ${settings.sampler === 'k_euler_ancestral' ? 'selected' : ''}>Euler Ancestral</option>
                                    <option value="k_euler" ${settings.sampler === 'k_euler' ? 'selected' : ''}>Euler</option>
                                    <option value="k_dpmpp_2s_ancestral" ${settings.sampler === 'k_dpmpp_2s_ancestral' ? 'selected' : ''}>DPM++ 2S Ancestral</option>
                                    <option value="k_dpmpp_2m_sde" ${settings.sampler === 'k_dpmpp_2m_sde' ? 'selected' : ''}>DPM++ 2M SDE</option>
                                    <option value="k_dpmpp_2m" ${settings.sampler === 'k_dpmpp_2m' ? 'selected' : ''}>DPM++ 2M</option>
                                    <option value="k_dpmpp_sde" ${settings.sampler === 'k_dpmpp_sde' ? 'selected' : ''}>DPM++ SDE</option>
                                </select>
                            </div>
                            <div class="cspm-field">
                                <div class="cspm-label-row"><label>Prompt Guidance Rescale</label><span class="cspm-value-chip" id="cspm-default-guidance-rescale-value">${escapeHtml(Number(settings.guidanceRescale ?? 0.3).toFixed(2))}</span></div>
                                <div class="cspm-range-wrap">
                                    <input id="cspm-default-guidance-rescale-range" type="range" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                    <input id="cspm-default-guidance-rescale" class="cspm-range-number" type="text" inputmode="decimal" min="0" max="1" step="0.01" value="${escapeHtml(String(settings.guidanceRescale ?? 0.3))}">
                                </div>
                            </div>
                            <div class="cspm-field">
                                <label>UC Preset</label>
                                <select id="cspm-default-uc-preset" title="NovelAI Undesired Content Preset">
                                    ${buildNaiUcPresetOptionsHtml(settings.ucPreset)}
                                </select>
                                <div class="cspm-mini-note">기본 생성/리롤 설정에 사용할 NAI UC 프리셋. 실제 생성 시 직접 쓴 UC와 합쳐서 전송돼.</div>
                            </div>
                            <div class="cspm-field">
                                <label>Noise Schedule</label>
                                <select id="cspm-default-noise-schedule">
                                    <option value="karras" ${settings.noiseSchedule === 'karras' ? 'selected' : ''}>karras</option>
                                    <option value="exponential" ${settings.noiseSchedule === 'exponential' ? 'selected' : ''}>exponential</option>
                                    <option value="polyexponential" ${settings.noiseSchedule === 'polyexponential' ? 'selected' : ''}>polyexponential</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="cspm-actions">
                    <div class="cspm-actions-left">
                        <button class="cspm-btn cspm-btn-danger" id="cspm-clear-room-images">이 방의 삽화 기록 삭제</button>
                    </div>
                    <div class="cspm-actions-right">
                        <button class="cspm-btn" id="cspm-close">취소</button>
                        <button class="cspm-btn cspm-btn-primary" id="cspm-save">저장</button>
                    </div>
                </div>
            </div>
        `;

        bindTabInterface(overlay);
        makeSectionsCollapsible(overlay, ['API 설정', '현재 채팅방 Character Prompt 슬롯']);

        const characterList = overlay.querySelector('#cspm-character-list');
        let quickCharacterSlots = Array.isArray(global.characterQuickSlots) ? global.characterQuickSlots.slice() : [];
        renderCharacterCards(characterList, room.characters);

        const quickSlotNameEl = overlay.querySelector('#cspm-quick-slot-name');
        const quickSlotSelectEl = overlay.querySelector('#cspm-quick-slot-select');

        function refreshQuickSlotSelect(selectedName = '') {
            if (!quickSlotSelectEl) return;
            quickSlotSelectEl.innerHTML = buildQuickSlotOptions(quickCharacterSlots, selectedName);
        }

        overlay.querySelector('#cspm-add-character').onclick = () => {
            const current = collectCharacters(characterList);
            current.push({ name: '', appearanceTags: '', outfitTags: '', tags: '', uc: '', referenceEnabled: false, referenceType: 'character', referenceAssetId: '', referenceImageName: '', referenceStrength: 0.6, referenceFidelity: 0.8 });
            renderCharacterCards(characterList, current);
        };


        overlay.querySelector('#cspm-quick-slot-save')?.addEventListener('click', () => {
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
            console.log('[Univers Scene Painter Mobile] Quick slot save:', {
                slotName: name,
                characterNames: characters.map(getCharacterSlotName)
            });
            const existingIndex = quickCharacterSlots.findIndex(slot => String(slot.name || '').trim() === name);
            if (existingIndex >= 0) quickCharacterSlots[existingIndex] = nextSlot;
            else quickCharacterSlots.push(nextSlot);

            refreshQuickSlotSelect(name);
            showToast(`✅ 퀵 슬롯 저장 완료: ${name}`);
        });

        overlay.querySelector('#cspm-quick-slot-load')?.addEventListener('click', () => {
            const name = String(quickSlotSelectEl?.value || '').trim();
            const slot = getQuickSlotByName(quickCharacterSlots, name);
            if (!slot) {
                showToast('⚠️ 불러올 퀵 슬롯이 없어요.');
                return;
            }

            const characters = cloneCharacterSlots(slot.characters);
            console.log('[Univers Scene Painter Mobile] Quick slot load:', {
                slotName: slot.name,
                characterNames: characters.map(getCharacterSlotName)
            });
            renderCharacterCards(characterList, characters);
            if (quickSlotNameEl) quickSlotNameEl.value = slot.name;
            showToast(`📥 퀵 슬롯 불러옴: ${slot.name}`);
        });

        overlay.querySelector('#cspm-quick-slot-delete')?.addEventListener('click', () => {
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

        const defaultOrientationEl = overlay.querySelector('#cspm-default-orientation');
        const defaultWidthEl = overlay.querySelector('#cspm-default-width');
        const defaultHeightEl = overlay.querySelector('#cspm-default-height');
        const defaultWidthViewEl = overlay.querySelector('#cspm-default-width-view');
        const defaultHeightViewEl = overlay.querySelector('#cspm-default-height-view');
        const defaultSwapBtn = overlay.querySelector('#cspm-default-swap');
        if (defaultOrientationEl && defaultWidthEl && defaultHeightEl) {
            applyOrientationPreset(defaultOrientationEl.value, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl);
            defaultOrientationEl.addEventListener('change', () => applyOrientationPreset(defaultOrientationEl.value, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl));
            defaultSwapBtn?.addEventListener('click', () => swapOrientationPreset(defaultOrientationEl, defaultWidthEl, defaultHeightEl, defaultWidthViewEl, defaultHeightViewEl));
        }
        bindRangeNumberPair(overlay.querySelector('#cspm-default-steps-range'), overlay.querySelector('#cspm-default-steps'), overlay.querySelector('#cspm-default-steps-value'), { min: 1, max: 50, step: 1, decimals: 0 });
        bindRangeNumberPair(overlay.querySelector('#cspm-default-scale-range'), overlay.querySelector('#cspm-default-scale'), overlay.querySelector('#cspm-default-scale-value'), { min: 0, max: 10, step: 0.1, decimals: 1 });
        bindRangeNumberPair(overlay.querySelector('#cspm-default-guidance-rescale-range'), overlay.querySelector('#cspm-default-guidance-rescale'), overlay.querySelector('#cspm-default-guidance-rescale-value'), { min: 0, max: 1, step: 0.01, decimals: 2 });

        function collectGlobal() {
            return {
                geminiProvider: overlay.querySelector('#cspm-gemini-provider').value,
                googleApiKey: overlay.querySelector('#cspm-google-key').value.trim(),
                googleModel: normalizeGeminiModelId(overlay.querySelector('#cspm-google-model').value),
                vertexProjectId: overlay.querySelector('#cspm-vertex-project').value.trim(),
                vertexLocation: overlay.querySelector('#cspm-vertex-location').value.trim() || 'us-central1',
                vertexAccessToken: overlay.querySelector('#cspm-vertex-token').value.trim(),
                firebaseConfigJson: overlay.querySelector('#cspm-firebase-config').value.trim(),
                firebaseLocation: overlay.querySelector('#cspm-firebase-location').value.trim() || 'global',
                firebaseSdkVersion: overlay.querySelector('#cspm-firebase-sdk-version').value.trim() || '12.5.0',
                naiApiKey: overlay.querySelector('#cspm-nai-key').value.trim(),
                naiModel: overlay.querySelector('#cspm-nai-model').value.trim() || 'nai-diffusion-4-5-full',
                folderSaveEnabled: false,
                geminiInstruction: overlay.querySelector('#cspm-gemini-instruction').value.trim(),
                basePositive: overlay.querySelector('#cspm-base-positive').value.trim(),
                baseNegative: overlay.querySelector('#cspm-base-negative').value.trim(),
                naiPromptGuide: overlay.querySelector('#cspm-nai-prompt-guide').value.trim(),
                naiSettings: {
                    orientationPreset: overlay.querySelector('#cspm-default-orientation').value,
                    width: Number(overlay.querySelector('#cspm-default-width').value || 832),
                    height: Number(overlay.querySelector('#cspm-default-height').value || 1216),
                    steps: Number(overlay.querySelector('#cspm-default-steps').value || 28),
                    scale: Number(overlay.querySelector('#cspm-default-scale').value || 6.5),
                    guidanceRescale: Number(overlay.querySelector('#cspm-default-guidance-rescale').value || 0.3),
                    seed: overlay.querySelector('#cspm-default-seed').value.trim(),
                    sampler: overlay.querySelector('#cspm-default-sampler').value,
                    noiseSchedule: overlay.querySelector('#cspm-default-noise-schedule').value,
                    nSamples: 1,
                    smea: false,
                    dyn: false,
                    ucPreset: Number(overlay.querySelector('#cspm-default-uc-preset')?.value || 0)
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

        overlay.querySelector('#cspm-close').onclick = () => overlay.remove();
        overlay.querySelector('#cspm-save').onclick = () => {
            saveGlobalSettings(collectGlobal());
            saveRoomSettings(collectRoom());
            overlay.remove();
            showToast('✅ Scene Painter 설정 저장 완료');
            scheduleInject();
        };

        overlay.querySelector('#cspm-clear-room-images').onclick = () => {
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
        if (thumb) thumb.setAttribute('data-state', value ? 'checked' : 'unchecked');
    }

    function makeFallbackRow() {
        const row = document.createElement('div');
        row.className = 'px-2.5 h-4 box-content py-[18px] cspm-toggle-row';
        row.innerHTML = `
            <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [&_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer">
                <span class="flex space-x-2 items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="20px" height="20px" aria-hidden="true" style="flex-shrink:0"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8m-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12m3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8m5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8m3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5"/></svg>
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
        row.className = 'px-2.5 h-4 box-content py-[18px] cspm-gallery-row';
        row.innerHTML = `
            <div role="button" tabindex="0" class="w-full flex h-4 items-center justify-between typo-text-base_leading-none_medium space-x-2 [&_svg]:fill-icon_tertiary ring-offset-4 ring-offset-sidebar cursor-pointer">
                <span class="flex space-x-2 items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="20px" height="20px" aria-hidden="true" style="flex-shrink:0"><path d="M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2m-11-4 2.03 2.71L16 11l4 5H8zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6z"/></svg>
                    <span class="whitespace-nowrap overflow-hidden text-ellipsis typo-text-sm_leading-none_medium">삽화 갤러리</span>
                </span>
                <span class="cspm-gallery-count-badge" title="현재 방 삽화 기록">0</span>
            </div>
        `;
        return row;
    }

    function createSceneGalleryRow() {
        const row = makeGalleryRow();
        row.id = 'cspm-scene-gallery-row';
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
            row.classList.add('cspm-toggle-row');
            const textSpan = row.querySelector('.typo-text-sm_leading-none_medium');
            if (textSpan) textSpan.textContent = 'AI 삽화 생성';
            const svg = row.querySelector('svg');
            if (svg) {
                svg.outerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="20px" height="20px" aria-hidden="true" style="flex-shrink:0"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8m-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12m3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8m5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8m3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5"/></svg>`;
            }
        } else {
            row = makeFallbackRow();
        }

        row.id = 'cspm-scene-painter-row';
        const rootButton = row.querySelector('[role="button"]');
        const switchBtn = row.querySelector('button[role="switch"]');
        const thumb = row.querySelector('.pointer-events-none');
        setSwitchVisual(switchBtn, thumb, isEnabled());

        function toggleEnabled(next) {
            setEnabled(next);
            setSwitchVisual(switchBtn, thumb, next);
            applySceneVisibilityState(next);
            if (!next) {
                document.querySelectorAll('.cspm-message-generate-btn').forEach(btn => btn.remove());
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

    function findUniversSidebar() {
        return Array.from(document.querySelectorAll('div')).find(d =>
            d.classList?.contains('bg-background/95') && d.classList?.contains('backdrop-blur-2xl')
        ) || null;
    }

    function findUniversTabButtonRow() {
        const tabBtn = Array.from(document.querySelectorAll('button')).find(
            b => ['정보', '기억', '문체', '뷰어'].includes(b.textContent?.trim()) &&
                 b.className?.includes('font-medium')
        );
        return tabBtn ? tabBtn.parentElement : null;
    }

    function isViewerTabActive() {
        const viewerBtn = Array.from(document.querySelectorAll('button')).find(
            b => b.textContent?.trim() === '뷰어' && b.className?.includes('font-medium')
        );
        if (!viewerBtn) return false;
        return !viewerBtn.className.includes('text-muted-foreground');
    }

    function findViewerTabContent() {
        const tabBtnRow = findUniversTabButtonRow();
        if (!tabBtnRow) return null;
        const sidebarRoot = tabBtnRow.parentElement?.parentElement;
        if (!sidebarRoot) return null;
        const contentWrapper = sidebarRoot.querySelector('.relative.overflow-hidden.flex-1');
        if (!contentWrapper) return null;
        const viewport = contentWrapper.querySelector('[data-radix-scroll-area-viewport]') || contentWrapper;
        return viewport.querySelector('.p-4.space-y-4') || viewport.firstElementChild || null;
    }

    function syncCspmRowVisibility() {
        const painterRow = document.getElementById('cspm-scene-painter-row');
        const galleryRow = document.getElementById('cspm-scene-gallery-row');
        const viewerActive = isViewerTabActive();
        if (painterRow) painterRow.style.display = viewerActive ? '' : 'none';
        if (galleryRow) galleryRow.style.display = viewerActive ? '' : 'none';
        if (viewerActive) updateGalleryRowCount();
    }

    function findSituationImageContainer() {
        // univers.chat: 뷰어탭 콘텐츠 컨테이너(p-4 space-y-4) 반환
        return findViewerTabContent();
    }

    function injectScenePainterRow() {
        injectStyles();
        const container = findSituationImageContainer();
        if (!container) return;

        if (!document.getElementById('cspm-scene-painter-row')) {
            const painterRow = createScenePainterRow(null);
            const galleryRow = createSceneGalleryRow();
            container.insertBefore(galleryRow, container.firstChild);
            container.insertBefore(painterRow, container.firstChild);
        }
        syncCspmRowVisibility();
    }

    function injectAll() {
        injectStyles();
        injectScenePainterRow();
        injectMessageButtons();
    }

    function scheduleInject(delayMs = CSPM_INJECT_DEBOUNCE_MS) {
        if (injectScheduled) return;
        injectScheduled = true;
        clearTimeout(injectTimer);
        injectTimer = setTimeout(() => {
            injectTimer = null;
            requestAnimationFrame(() => {
                injectScheduled = false;
                injectAll();
            });
        }, Math.max(0, Number(delayMs) || 0));
    }

    function isCspmOwnedNode(node) {
        if (!node) return false;
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!el || !el.closest) return false;
        return !!el.closest([
            '.cspm-overlay',
            '.cspm-generated-scene-image',
            '.cspm-image-history-row',
            '.cspm-toast',
            '.cspm-task-hud-overlay',
            '.cspm-lightbox-overlay',
            '#cspm-scene-painter-style',
            '#cspm-scene-painter-row',
            '#cspm-scene-gallery-row'
        ].join(','));
    }

    function shouldScheduleInjectFromMutations(mutations) {
        for (const mutation of mutations || []) {
            if (isCspmOwnedNode(mutation.target)) continue;

            const added = Array.from(mutation.addedNodes || []);
            const removed = Array.from(mutation.removedNodes || []);
            const changedNodes = added.concat(removed);
            if (!changedNodes.length) return true;

            if (changedNodes.some(node => !isCspmOwnedNode(node))) return true;
        }
        return false;
    }

    const observer = new MutationObserver((mutations) => {
        // 탭 버튼 class 변경 감지 (뷰어탭 활성화 여부)
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target?.className?.includes?.('font-medium') &&
                    ['정보','기억','문체','뷰어'].includes(target?.textContent?.trim())) {
                    syncCspmRowVisibility();
                    return;
                }
            }
        }
        if (shouldScheduleInjectFromMutations(mutations)) scheduleInject();
    });

    function start() {
        if (cspmBootStarted) return;
        cspmBootStarted = true;
        forceFirebaseProviderIfConfigured();
        injectStyles();
        applySceneVisibilityState(isEnabled());
        bindImageActionDelegates();
        migrateSceneImagesToIndexedDb().finally(() => scheduleInject(0));
        scheduleInject(0);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    async function delayedStart() {
        await waitForCoexistingLoreInjector();
        start();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', delayedStart, { once: true });
    } else {
        delayedStart();
    }
})();

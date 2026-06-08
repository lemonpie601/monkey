// ==UserScript==
// @name         유니챗용 펫 키우기 👾
// @namespace    unichat-info-game-hud-clean
// @version      1.2.8
// @description  유니챗 채팅의 INFO/정보 블록과 최신 답변을 읽어 게임식 로그, 관계도, 인벤토리, HUD 코멘트와 PET 탭/펫 대사를 표시합니다. 최신 로그 판별, HUD 한마디 반복 방지, 마스코트 반응/자아 연출, 설정 접기, 토큰 사용량/예상 비용 표시를 조정했습니다.
// @author       https://gall.dcinside.com/mini/board/view/?id=wrtnw&no=216540
// @match        https://www.univers.chat/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      aiplatform.googleapis.com
// @connect      *.aiplatform.googleapis.com
// @connect      www.gstatic.com
// @connect      openrouter.ai
// @connect      *
// ==/UserScript==


(() => {
  'use strict';

  if (window.__UCIGH_CLEAN_V1515_LOADED__) return;
  window.__UCIGH_CLEAN_V1515_LOADED__ = true;

  const VERSION = '1.5.15';
  const FAB_ID = 'cigh-clean-fab';
  const PANEL_ID = 'cigh-clean-panel';
  const POPUP_ID = 'cigh-clean-popup';
  const COMMENT_POPUP_ID = 'cigh-clean-comment-popup';
  const SETTINGS_ID = 'cigh-clean-settings';
  const STYLE_ID = 'cigh-clean-style';

  const STORE_KEY = 'cigh_clean_store_v5';
  const POS_KEY = 'cigh_clean_pos_v1';
  const PANEL_HEIGHT_KEY = 'cigh_clean_panel_height_v1';
  const FAB_POS_KEY = 'cigh_clean_fab_pos_v1';
  const MASCOT_ID = 'cigh-clean-mascot';
  const MASCOT_STORE = 'cigh_clean_mascot_on_v1';
  const MASCOT_POS_KEY = 'cigh_clean_mascot_pos_v1';
  const PET_NAME_STORE = 'cigh_clean_pet_name_v1';
  const MASCOT_ACCESSORY_STORE = 'cigh_clean_mascot_accessory_v1';
  const MASCOT_OUTLINE_STORE = 'cigh_clean_mascot_outline_v1';
  const API_KEY_STORE = 'cigh_clean_gemini_api_key_v1';
  const STYLE_PROMPT_STORE = 'cigh_clean_log_style_prompt_v1';
  const COMMENT_POPUP_STORE = 'cigh_clean_comment_popup_v1';
  const MODEL_STORE = 'cigh_clean_gemini_model_v1';
  const THINKING_STORE = 'cigh_clean_thinking_budget_v1';
  const AUTO_ANALYZE_STORE = 'cigh_clean_auto_analyze_v1';
  const UI_FONT_SIZE_STORE = 'cigh_clean_ui_font_size_v1';
  const SFX_STORE = 'cigh_clean_sfx_v1';
  const SETTINGS_FOLD_STORE = 'cigh_clean_settings_fold_v1';
  const USAGE_STORE = 'cigh_clean_usage_v1';
  const ACHV_STORE = 'cigh_clean_achv_v1';
  const ACHV_EQUIPPED_STORE = 'cigh_clean_achv_equipped_v1';

  const DECO_STORE = 'cigh_clean_deco_v1';
  const DECO_LOGS_PER_TICKET = 50; // 로그 조사 50회 = 꾸밈티켓 1장
  const PET_TOKEN_EXP_INPUT_UNIT = 1000;
  const PET_TOKEN_EXP_MAX = 30;
  const MASCOT_SIZE_STORE = 'cigh_clean_mascot_size_v1';
  const GEMINI_PROVIDER_STORE = 'cigh_clean_gemini_provider_v1';
  const FIREBASE_CONFIG_STORE = 'cigh_clean_firebase_config_v1';
  const FIREBASE_LOCATION_STORE = 'cigh_clean_firebase_location_v1';
  const FIREBASE_SDK_VERSION_STORE = 'cigh_clean_firebase_sdk_version_v1';
  const OPENROUTER_API_KEY_STORE = 'cigh_clean_openrouter_api_key_v1';
  const OPENROUTER_MODEL_STORE = 'cigh_clean_openrouter_model_v1';
  const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash';

  const GEMINI_MODEL_OPTIONS = [
    'gemini-3-pro-preview',
    'gemini-3.5-flash',
    'gemini-3.1-pro',
    'gemini-3.1-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];

  const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
  const DEFAULT_THINKING_BUDGET = 1024;
  const DEFAULT_FIREBASE_LOCATION = 'global';
  const DEFAULT_FIREBASE_SDK_VERSION = '12.5.0';
  const METER_UP_CAP = 8;
  const METER_DOWN_CAP = 12;

  // USD per 1M tokens. 단가 변동 시 이 표만 수정.
  // 2026-06-02 ai.google.dev Gemini Developer API pricing 기준.
  // ≤200k 표준 text 단가 기준. 컨텍스트 캐싱·무료티어·Batch/Flex/Priority 미반영.
  // 주의: 3.5 Flash는 2.5 Flash보다 비싸고, 3.1 Flash-Lite는 2.5 Flash-Lite보다 비쌈.
  const DEFAULT_TOKEN_PRICES = {
    'gemini-3-pro-preview': { in: 2.00, out: 12.00 },
    'gemini-3.5-flash': { in: 1.50, out: 9.00 },
    'gemini-3.1-pro': { in: 2.00, out: 12.00 },
    'gemini-3.1-flash-lite': { in: 0.25, out: 1.50 },
    'gemini-2.5-pro': { in: 1.25, out: 10.00 },
    'gemini-2.5-flash': { in: 0.30, out: 2.50 },
    'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  };

  const DEFAULT_STYLE_PROMPT = [
    '포켓몬/고전 RPG 전투 로그처럼 짧고 리듬감 있게 쓴다.',
    '각 줄은 반드시 ▶ 또는 ▷로 시작한다.',
    '은(는), (이)가, 을(를) 같은 포켓몬식 조사 표기를 사용할 수 있다.',
    '너무 딱딱한 요약문처럼 쓰지 말고, 장면을 게임 로그처럼 재해석한다.',
    '예: ▶김뤼붕(이)가 크게 흔들렸다!',
    '예: ▷뤼세영의 고백은 효과가 굉장했다!',
    '예: ▶김뤼붕은(는) 도망칠 곳을 잃었다!',
  ].join('\n');

  const TABS = [
    { id: 'log', label: 'LOG' },
    { id: 'info', label: 'INFO' },
    { id: 'hud', label: 'HUD' },
    { id: 'pet', label: 'PET' },
    { id: 'achv', label: 'ACHV' },
  ];

  let activeTab = 'log';
  let currentData = null;
  let lastDebugPayload = null;

  let logLines = [];
  let logQueue = [];
  let isLogTyping = false;

  let popupQueue = [];
  let popupTyping = false;
  let popupLines = [];
  let popupRemoveTimer = null;
  let popupHideTimer = null;

  let footerComments = [];
  let footerCommentIndex = 0;
  let footerTypingTimer = null;
  let footerLoopTimer = null;
  let footerLastText = '';
  let footerPopupRemaining = 0;
  let commentPopupTypingTimer = null;
  let commentPopupHideTimer = null;

  let dragState = null;
  let resizeState = null;
  let fabDragState = null;
  let lastSeenRoomKey = roomKey();
  let routeWatchTimer = null;

  let autoAnalyzeObserver = null;
  let autoAnalyzeTimer = null;
  let autoCandidateKey = '';
  let analyzeBusy = false;
  let audioContext = null;
  let decoEditMode = false;
  let decoEditTab = 'wallpaper';
  let decoDraft = null;
  let decoDragState = null;
  let decoPropUidSeq = 1;

  // ─────────────────────────────────────────────
  // Storage
  // ─────────────────────────────────────────────
  function roomKey() {
    const path = location.pathname;
    // 유니챗: /play/:uuid
    const m = path.match(/\/play\/([^/?#]+)/);
    if (m) return `play:${m[1]}`;
    return path || 'default';
  }

  function emptyRoom() {
    return {
      data: null,
      history: [],
      logLines: [],
      lastAnalyzedKey: '',
      lastAnalyzedContentKey: '',
      analyzedContentKeys: [],
      analyzeCount: 0,
      commentLog: [],
      pet: defaultPet(),
    };
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  function getRoom() {
    const store = readStore();
    return store[roomKey()] || emptyRoom();
  }

  function setRoom(room) {
    const store = readStore();
    store[roomKey()] = room;
    writeStore(store);
  }

  function updateRoom(fn) {
    const room = getRoom();
    fn(room);
    setRoom(room);
    return room;
  }

  function getRoomUserName(room = getRoom()) {
    return String(room?.userName || '').trim().slice(0, 20);
  }

  function setRoomUserName(value) {
    const userName = String(value || '').trim().slice(0, 20);
    updateRoom(room => {
      room.userName = userName;
    });
    return userName;
  }

  function commitRoomUserNameInput(input, options = {}) {
    if (!(input instanceof HTMLInputElement)) return false;
    const before = getRoomUserName();
    const after = setRoomUserName(input.value);
    input.value = after;

    if (!options.silent || before !== after) {
      setFooter(after ? `USER 저장: ${after}` : 'USER 이름 비움');
      playBeep('save');
    }

    if (currentData && after) {
      currentData = stripRoomUserFromData(currentData, after);
      updateRoom(room => {
        if (room.data) room.data = stripRoomUserFromData(room.data, after);
      });
    }

    if (activeTab === 'info' && !options.noRender) renderContent();
    return true;
  }


  function loadRoomData() {
    const room = getRoom();
    currentData = room.data ? stripRoomUserFromData(room.data, getRoomUserName(room)) : null;
    loadRoomLogLines(room);
    renderContent();
    refreshPetSurfaces(getPet(room), { resetVisual: true });
  }

  function resetInfoState() {
    updateRoom(room => {
      room.data = null;
      room.history = [];
      room.lastAnalyzedKey = '';
      room.lastAnalyzedContentKey = '';
      room.analyzedContentKeys = [];
    });
    currentData = null;
    activeTab = 'info';

    const panel = document.getElementById(PANEL_ID);
    panel?.querySelectorAll?.('.cigh-clean-tab')?.forEach(tab => tab.classList.toggle('on', tab.dataset.tab === activeTab));

    setFooter('INFO RESET');
    pushLog(['▷INFO 정보를 초기화했다!', '▷다음 분석은 처음 상태처럼 다시 읽는다!']);
    showPopup(['▶INFO 초기화 완료!', '▷다시 로그를 읽으면 새로 정리한다!']);
    renderContent();
    playBeep('save');
  }

  function openInfoResetConfirm() {
    document.getElementById('cigh-clean-info-reset-modal')?.remove();

    const panel = document.getElementById(PANEL_ID);
    const mountInsidePanel = panel instanceof HTMLElement && panel.classList.contains('open');
    const host = mountInsidePanel ? panel : document.body;

    const modal = document.createElement('div');
    modal.id = 'cigh-clean-info-reset-modal';
    modal.className = `cigh-clean-confirm-backdrop${mountInsidePanel ? ' in-panel' : ''}`;
    modal.setAttribute('data-cigh-theme', detectThemeMode());
    modal.setAttribute('data-cigh-font', getUiFontSize());
    modal.innerHTML = `
      <div class="cigh-clean-confirm-box rpg" role="dialog" aria-modal="true" aria-label="INFO 초기화 확인">
        <div class="cigh-clean-confirm-title"><span class="cigh-clean-confirm-title-dot">◆</span><span>INFO RESET</span></div>
        <div class="cigh-clean-confirm-panel">
          <div class="cigh-clean-confirm-text">INFO 정보를 초기화할까요?</div>
          <div class="cigh-clean-confirm-help">관계도 / 인벤토리 / 상태 정보와<br>분석 완료 표시가 비워져요.</div>
          <div class="cigh-clean-confirm-help sub">다음 로그 분석을 처음처럼 다시 받을 수 있어요.</div>
        </div>
        <div class="cigh-clean-confirm-actions">
          <button type="button" class="cigh-clean-confirm-btn yes" data-info-reset-answer="yes"><span>YES</span></button>
          <button type="button" class="cigh-clean-confirm-btn no" data-info-reset-answer="no"><span>NO</span></button>
        </div>
      </div>
    `;

    modal.addEventListener('click', event => {
      const answer = event.target?.closest?.('[data-info-reset-answer]')?.dataset?.infoResetAnswer;
      if (!answer && event.target !== modal) return;
      event.preventDefault();
      event.stopPropagation();
      const yes = answer === 'yes';
      modal.remove();
      if (yes) resetInfoState();
    });

    host.appendChild(modal);
  }

  function defaultRoomLogLines() {
    const provider = getGeminiProvider();
    const ready = provider === 'firebase'
      ? hasFirebaseConfig()
      : hasGeminiKey();

    return [
      `◆ UNICHAT INFO GAME HUD v${VERSION}`,
      '─'.repeat(22),
      ready
        ? `▶${provider === 'firebase' ? 'Firebase AI Logic' : 'Gemini API'} 준비 완료! (${getGeminiModel()})`
        : '▶상단 ⚙에서 API/Firebase 설정을 저장하자!',
      isAutoAnalyzeEnabled() ? '▷새 답변 자동 읽기 ON!' : '▷새 답변 자동 읽기 OFF!',
      '▷◆ 길게 누르기 또는 ↻로 읽는다!',
    ];
  }

  function loadRoomLogLines(room = getRoom()) {
    logQueue = [];
    isLogTyping = false;
    logLines = Array.isArray(room.logLines) && room.logLines.length
      ? room.logLines.slice(-90)
      : defaultRoomLogLines();

    flushLog();

    const roomLabel = document.getElementById('cigh-clean-room');
    if (roomLabel) roomLabel.textContent = roomKey().slice(-22);
    updateAnalyzeCountLabel();
  }

  function updateAnalyzeCountLabel() {
    const el = document.getElementById('cigh-clean-count');
    if (!el) return;
    el.textContent = `${getAnalyzeCount()}회`;
  }

  function getAnalyzeCount(room = getRoom()) {
    return Number(room?.analyzeCount || 0);
  }

  function saveRoomLogLines(keyAtSave = roomKey()) {
    const store = readStore();
    const room = store[keyAtSave] || emptyRoom();
    room.logLines = logLines.slice(-90);
    store[keyAtSave] = room;
    writeStore(store);
  }

  function getGeminiKey() {
    return String(
      localStorage.getItem(API_KEY_STORE) ||
      localStorage.getItem('cigh_gemini_api_key_v1') ||
      localStorage.getItem('cro_gemini_api_key_v1') ||
      ''
    ).trim();
  }

  function setGeminiKey(value) {
    const key = String(value || '').trim();
    [API_KEY_STORE, 'cigh_gemini_api_key_v1', 'cro_gemini_api_key_v1'].forEach(k => localStorage.removeItem(k));
    if (key) localStorage.setItem(API_KEY_STORE, key);
  }

  function hasGeminiKey() {
    return !!getGeminiKey();
  }

  function normalizeGeminiModelId(model) {
    const raw = String(model || DEFAULT_GEMINI_MODEL).trim().replace(/^models\//, '');
    return GEMINI_MODEL_OPTIONS.includes(raw) ? raw : DEFAULT_GEMINI_MODEL;
  }

  // ─────────────────────────────────────────────
  // OpenRouter
  // ─────────────────────────────────────────────
  function getOpenRouterKey() {
    return String(localStorage.getItem(OPENROUTER_API_KEY_STORE) || '').trim();
  }

  function setOpenRouterKey(value) {
    const key = String(value || '').trim();
    if (key) localStorage.setItem(OPENROUTER_API_KEY_STORE, key);
    else localStorage.removeItem(OPENROUTER_API_KEY_STORE);
  }

  function hasOpenRouterKey() {
    return !!getOpenRouterKey();
  }

  function getOpenRouterModel() {
    return String(localStorage.getItem(OPENROUTER_MODEL_STORE) || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL;
  }

  function setOpenRouterModel(value) {
    localStorage.setItem(OPENROUTER_MODEL_STORE, String(value || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL);
  }

  // ─────────────────────────────────────────────
  // Provider
  // ─────────────────────────────────────────────
  function getGeminiProvider() {
    let provider = String(localStorage.getItem(GEMINI_PROVIDER_STORE) || 'ai-studio').trim() || 'ai-studio';

    if (['firebase-ai', 'firebase-ai-logic', 'firebase-ailogic', 'Firebase AI Logic Beta'].includes(provider)) {
      provider = 'firebase';
    }

    if (provider === 'openrouter') return 'openrouter';

    const hasFirebase = hasFirebaseConfig();
    const hasAiStudioKey = hasGeminiKey();

    if (provider === 'ai-studio' && hasFirebase && !hasAiStudioKey) {
      provider = 'firebase';
    }

    return provider === 'firebase' ? 'firebase' : 'ai-studio';
  }

  function setGeminiProvider(provider) {
    const value = String(provider || 'ai-studio').trim();
    const valid = ['ai-studio', 'firebase', 'openrouter'].includes(value) ? value : 'ai-studio';
    localStorage.setItem(GEMINI_PROVIDER_STORE, valid);
  }

  function isAutoAnalyzeEnabled() {
    const value = localStorage.getItem(AUTO_ANALYZE_STORE);
    return value !== '0';
  }

  function setAutoAnalyzeEnabled(enabled) {
    localStorage.setItem(AUTO_ANALYZE_STORE, enabled ? '1' : '0');
  }

  function getUiFontSize() {
    const value = String(localStorage.getItem(UI_FONT_SIZE_STORE) || 'small').trim();
    return ['small', 'medium', 'large'].includes(value) ? value : 'small';
  }

  function setUiFontSize(value) {
    const raw = String(value || '').trim();
    const safe = ['small', 'medium', 'large'].includes(raw) ? raw : 'small';
    localStorage.setItem(UI_FONT_SIZE_STORE, safe);
  }

  function isSfxEnabled() {
    return localStorage.getItem(SFX_STORE) !== '0';
  }

  function setSfxEnabled(enabled) {
    localStorage.setItem(SFX_STORE, enabled ? '1' : '0');
  }

  function getAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContext) audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') audioContext.resume?.().catch?.(() => {});
    return audioContext;
  }

  function playTone(ctx, { start, duration, freq, freqTo, type = 'sine', volume = 0.060 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), start);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  function playBeep(type) {
    if (!isSfxEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime + 0.006;
    try {
      if (type === 'open') {
        playTone(ctx, { start: now, duration: 0.09, freq: 320, freqTo: 480 });
      } else if (type === 'close') {
        playTone(ctx, { start: now, duration: 0.09, freq: 480, freqTo: 320 });
      } else if (type === 'analyze') {
        playTone(ctx, { start: now, duration: 0.06, freq: 260 });
        playTone(ctx, { start: now + 0.075, duration: 0.06, freq: 300 });
      } else if (type === 'done') {
        playTone(ctx, { start: now, duration: 0.07, freq: 300 });
        playTone(ctx, { start: now + 0.085, duration: 0.07, freq: 420 });
        playTone(ctx, { start: now + 0.17, duration: 0.07, freq: 540 });
      } else if (type === 'error') {
        playTone(ctx, { start: now, duration: 0.22, freq: 120, type: 'square', volume: 0.035 });
      } else if (type === 'tab') {
        playTone(ctx, { start: now, duration: 0.04, freq: 400, volume: 0.035 });
      } else if (type === 'save') {
        playTone(ctx, { start: now, duration: 0.12, freq: 520 });
      } else if (type === 'levelup') {
        playTone(ctx, { start: now, duration: 0.08, freq: 660 });
        playTone(ctx, { start: now + 0.085, duration: 0.08, freq: 784 });
        playTone(ctx, { start: now + 0.17, duration: 0.14, freq: 1047 });
      } else if (type === 'evolve') {
        playTone(ctx, { start: now, duration: 0.07, freq: 523 });
        playTone(ctx, { start: now + 0.075, duration: 0.07, freq: 659 });
        playTone(ctx, { start: now + 0.15, duration: 0.07, freq: 784 });
        playTone(ctx, { start: now + 0.225, duration: 0.1, freq: 1047 });
        playTone(ctx, { start: now + 0.34, duration: 0.18, freq: 1319, freqTo: 1568, volume: 0.04 });
      }
    } catch (err) {
      console.debug('[UniChat INFO Game HUD] playBeep failed:', err);
    }
  }

  function getUiFontSizeLabel(value = getUiFontSize()) {
    return ({ small: '작게', medium: '보통', large: '크게' })[value] || '작게';
  }

  // ─────────────────────────────────────────────
  // Firebase AI Logic
  // ─────────────────────────────────────────────
  function getFirebaseConfigRaw() {
    return String(localStorage.getItem(FIREBASE_CONFIG_STORE) || '').trim();
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

    try {
      return Function(`"use strict"; return (${source});`)();
    } catch (err) {
      throw new Error('Firebase Config를 읽지 못했어요. Firebase 콘솔의 firebaseConfig 객체 전체를 붙여넣어줘.');
    }
  }

  function getFirebaseConfig() {
    try {
      return parseFirebaseConfigInput(getFirebaseConfigRaw());
    } catch {
      return null;
    }
  }

  function setFirebaseConfig(value) {
    const raw = String(value || '').trim();
    if (!raw) {
      localStorage.removeItem(FIREBASE_CONFIG_STORE);
      return;
    }

    const parsed = parseFirebaseConfigInput(raw);
    localStorage.setItem(FIREBASE_CONFIG_STORE, JSON.stringify(parsed, null, 2));
  }

  function hasFirebaseConfig() {
    return !!getFirebaseConfig();
  }

  function getFirebaseLocation() {
    return String(localStorage.getItem(FIREBASE_LOCATION_STORE) || DEFAULT_FIREBASE_LOCATION).trim() || DEFAULT_FIREBASE_LOCATION;
  }

  function setFirebaseLocation(value) {
    localStorage.setItem(FIREBASE_LOCATION_STORE, String(value || DEFAULT_FIREBASE_LOCATION).trim() || DEFAULT_FIREBASE_LOCATION);
  }

  function getFirebaseSdkVersion() {
    return String(localStorage.getItem(FIREBASE_SDK_VERSION_STORE) || DEFAULT_FIREBASE_SDK_VERSION).trim() || DEFAULT_FIREBASE_SDK_VERSION;
  }

  function setFirebaseSdkVersion(value) {
    localStorage.setItem(FIREBASE_SDK_VERSION_STORE, String(value || DEFAULT_FIREBASE_SDK_VERSION).trim() || DEFAULT_FIREBASE_SDK_VERSION);
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

  async function loadFirebaseAiModules(version = DEFAULT_FIREBASE_SDK_VERSION) {
    const safeVersion = String(version || DEFAULT_FIREBASE_SDK_VERSION).trim() || DEFAULT_FIREBASE_SDK_VERSION;
    const appUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(safeVersion)}/firebase-app.js`;
    const aiUrl = `https://www.gstatic.com/firebasejs/${encodeURIComponent(safeVersion)}/firebase-ai.js`;

    try {
      const [appModule, aiModule] = await Promise.all([
        import(appUrl),
        import(aiUrl),
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

  function extractTextFromGeminiResponseData(data) {
    return (data?.candidates || [])
      .flatMap(candidate => candidate.content?.parts || candidate.parts || [])
      .map(part => part.text || '')
      .join('\n')
      .trim();
  }

  function buildFirebaseModelOptions(geminiRequest, payload) {
    const systemText = String((payload?.systemInstruction?.parts || [])
      .map(part => part?.text || '')
      .filter(Boolean)
      .join('\n')).trim();

    const options = {
      model: geminiRequest.model,
    };

    if (systemText) options.systemInstruction = systemText;
    if (payload?.generationConfig) options.generationConfig = payload.generationConfig;
    if (payload?.safetySettings) options.safetySettings = payload.safetySettings;

    return options;
  }

  async function callFirebaseAiLogicGenerateContent(geminiRequest, payload) {
    const firebaseConfig = parseFirebaseConfigInput(geminiRequest.firebaseConfigJson);
    if (!firebaseConfig || typeof firebaseConfig !== 'object') {
      throw new Error('Firebase Config가 비어 있어요.');
    }

    const location = String(geminiRequest.firebaseLocation || DEFAULT_FIREBASE_LOCATION).trim() || DEFAULT_FIREBASE_LOCATION;
    const sdkVersion = String(geminiRequest.firebaseSdkVersion || DEFAULT_FIREBASE_SDK_VERSION).trim() || DEFAULT_FIREBASE_SDK_VERSION;

    const firebase = await loadFirebaseAiModules(sdkVersion);
    const appName = `cigh-firebase-${hashTiny(getFirebaseConfigSummary(firebaseConfig))}`;
    const app = firebase.getApps().some(existing => existing.name === appName)
      ? firebase.getApp(appName)
      : firebase.initializeApp(firebaseConfig, appName);

    const ai = firebase.getAI(app, {
      backend: new firebase.VertexAIBackend(location),
    });

    const modelOptions = buildFirebaseModelOptions(geminiRequest, payload);
    const model = firebase.getGenerativeModel(ai, modelOptions);

    try {
      const request = {
        contents: Array.isArray(payload?.contents) ? payload.contents : [],
      };

      const result = await model.generateContent(request);
      const response = result?.response;
      const responseText = await response?.text?.();

      return {
        usageMetadata: response?.usageMetadata || result?.usageMetadata || null,
        candidates: [
          {
            content: {
              parts: [{ text: String(responseText || '').trim() }],
            },
          },
        ],
        _firebaseRaw: result,
      };
    } catch (err) {
      const message = String(err?.message || err || '').replace(/\s+/g, ' ').trim();
      throw new Error(`Firebase AI Logic 호출 실패: ${message || '알 수 없는 오류'}`);
    }
  }

  function getGeminiThinkingConfigForModel(model) {
    const normalized = normalizeGeminiModelId(model);

    if (/^gemini-3\./.test(normalized)) {
      return { thinkingLevel: 'low' };
    }

    if (normalized === 'gemini-2.5-flash' || normalized === 'gemini-2.5-flash-lite') {
      return { thinkingBudget: getThinkingBudget() };
    }

    if (normalized === 'gemini-2.5-pro') {
      const budget = getThinkingBudget();
      return { thinkingBudget: budget === 0 ? -1 : budget };
    }

    return {};
  }

  function buildGeminiGenerationConfig(model, baseConfig = {}) {
    const thinkingConfig = getGeminiThinkingConfigForModel(model);
    return {
      ...baseConfig,
      ...(Object.keys(thinkingConfig).length ? { thinkingConfig } : {}),
    };
  }

  function getGeminiGenerateContentRequestConfig(options = {}) {
    const silent = !!options.silent;
    const provider = getGeminiProvider();
    const model = normalizeGeminiModelId(getGeminiModel());
    const headers = { 'Content-Type': 'application/json' };

    console.log('[UniChat INFO Game HUD] Gemini request provider:', {
      provider,
      model,
      hasGeminiKey: hasGeminiKey(),
      hasFirebaseConfig: hasFirebaseConfig(),
      firebaseLocation: getFirebaseLocation(),
      firebaseSdkVersion: getFirebaseSdkVersion(),
    });

    if (provider === 'openrouter') {
      const orKey = getOpenRouterKey();
      if (!orKey) {
        if (silent) return null;
        throw new Error('OpenRouter API Key가 비어 있어요. 설정에서 OpenRouter API Key를 입력해줘.');
      }
      return {
        provider: 'openrouter',
        model: getOpenRouterModel(),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${orKey}`,
          'HTTP-Referer': 'https://www.univers.chat',
          'X-Title': 'UniChat INFO Game HUD',
        },
        url: 'https://openrouter.ai/api/v1/chat/completions',
      };
    }

    if (provider === 'firebase') {
      const firebaseConfigJson = getFirebaseConfigRaw();
      if (!firebaseConfigJson) {
        if (silent) return null;
        throw new Error('Firebase AI Logic 사용 시 Firebase Config가 필요해요.');
      }

      return {
        provider,
        model,
        firebaseConfigJson,
        firebaseLocation: getFirebaseLocation(),
        firebaseSdkVersion: getFirebaseSdkVersion(),
        headers: {},
      };
    }

    const apiKey = getGeminiKey();
    if (!apiKey) {
      if (silent) return null;
      throw new Error('Gemini API Key가 비어 있어요. 설정에서 Google Gemini API Key를 입력해줘.');
    }

    return {
      provider: 'ai-studio',
      model,
      headers,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    };
  }

  // OpenRouter: OpenAI 호환 포맷 → Gemini 응답 포맷으로 변환
  async function callOpenRouterGenerateContent(geminiRequest, payload) {
    // Gemini payload → OpenAI chat/completions 포맷으로 변환
    const systemParts = (payload?.systemInstruction?.parts || []).map(p => p?.text || '').filter(Boolean);
    const messages = [];

    if (systemParts.length) {
      messages.push({ role: 'system', content: systemParts.join('\n') });
    }

    for (const item of (payload?.contents || [])) {
      const role = item.role === 'model' ? 'assistant' : 'user';
      const content = (item.parts || []).map(p => p?.text || '').join('');
      if (content) messages.push({ role, content });
    }

    const genConfig = payload?.generationConfig || {};
    const orPayload = {
      model: geminiRequest.model,
      messages,
      temperature: genConfig.temperature ?? 0.62,
      max_tokens: genConfig.maxOutputTokens ?? 4096,
      response_format: genConfig.responseMimeType === 'application/json' ? { type: 'json_object' } : undefined,
    };

    const res = await gmRequestJson({
      method: 'POST',
      url: geminiRequest.url,
      headers: geminiRequest.headers,
      data: orPayload,
      timeout: 30000,
    });

    // OpenAI 응답 → Gemini 응답 포맷으로 변환
    const text = res?.choices?.[0]?.message?.content || '';
    const usage = res?.usage;
    return {
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: usage ? {
        promptTokenCount: usage.prompt_tokens || 0,
        candidatesTokenCount: usage.completion_tokens || 0,
        totalTokenCount: usage.total_tokens || 0,
      } : null,
    };
  }

  async function requestGeminiGenerateContent(geminiRequest, payload) {
    if (geminiRequest?.provider === 'firebase') {
      return await callFirebaseAiLogicGenerateContent(geminiRequest, payload);
    }
    if (geminiRequest?.provider === 'openrouter') {
      return await callOpenRouterGenerateContent(geminiRequest, payload);
    }

    return await gmRequestJson({
      method: 'POST',
      url: geminiRequest.url,
      headers: geminiRequest.headers,
      data: payload,
      timeout: 25000,
    });
  }

  function gmRequestJson({ method, url, headers, data, timeout = 25000 }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers,
        timeout,
        data: data ? JSON.stringify(data) : undefined,
        onload: res => {
          if (res.status < 200 || res.status >= 300) {
            let message = res.responseText || `HTTP ${res.status}`;
            try {
              const parsed = JSON.parse(res.responseText || '{}');
              message = parsed.error?.message || parsed.message || message;
            } catch (_) {}
            reject(new Error(`API ${res.status} 오류: ${String(message).slice(0, 500)}`));
            return;
          }

          try {
            resolve(JSON.parse(res.responseText || '{}'));
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('API 네트워크 오류')),
        ontimeout: () => reject(new Error('API 응답 시간 초과')),
      });
    });
  }

  function getStylePrompt() {
    return String(
      localStorage.getItem(STYLE_PROMPT_STORE) ||
      localStorage.getItem('cigh_log_style_prompt_v1') ||
      DEFAULT_STYLE_PROMPT
    ).trim();
  }

  function setStylePrompt(value) {
    const prompt = String(value || '').trim();
    if (prompt) localStorage.setItem(STYLE_PROMPT_STORE, prompt);
    else localStorage.removeItem(STYLE_PROMPT_STORE);
  }

  function resetStylePrompt() {
    localStorage.removeItem(STYLE_PROMPT_STORE);
  }

  function isCommentPopupEnabled() {
    const value = localStorage.getItem(COMMENT_POPUP_STORE);
    if (value != null) return value !== '0';

    const oldValue = localStorage.getItem('cigh_comment_popup_enabled_v1');
    if (oldValue != null) return oldValue !== '0';

    return true;
  }

  function setCommentPopupEnabled(enabled) {
    localStorage.setItem(COMMENT_POPUP_STORE, enabled ? '1' : '0');
  }

  function getGeminiModel() {
    return normalizeGeminiModelId(localStorage.getItem(MODEL_STORE) || DEFAULT_GEMINI_MODEL);
  }

  function setGeminiModel(model) {
    localStorage.setItem(MODEL_STORE, normalizeGeminiModelId(model));
  }

  function getThinkingBudget() {
    const n = Number(localStorage.getItem(THINKING_STORE) || DEFAULT_THINKING_BUDGET);
    if (n === -1) return -1;
    if ([0, 512, 1024, 2048, 4096].includes(n)) return n;
    return DEFAULT_THINKING_BUDGET;
  }

  function setThinkingBudget(value) {
    const n = Number(value);
    const safe = (n === -1 || [0, 512, 1024, 2048, 4096].includes(n)) ? n : DEFAULT_THINKING_BUDGET;
    localStorage.setItem(THINKING_STORE, String(safe));
  }

  // ─────────────────────────────────────────────
  // Usage / settings fold state
  // ─────────────────────────────────────────────
  function defaultUsage() {
    return {
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 0,
      byModel: {},
    };
  }

  function usageModelKey(model) {
    const raw = String(model || '').trim().replace(/^models\//, '');
    return raw || DEFAULT_GEMINI_MODEL;
  }

  function normalizeUsage(raw) {
    const base = defaultUsage();
    const usage = raw && typeof raw === 'object' ? raw : {};
    const byModel = {};

    for (const [model, item] of Object.entries(usage.byModel || {})) {
      const key = usageModelKey(model);
      byModel[key] = {
        input: Math.max(0, Math.floor(Number(item?.input || 0))),
        output: Math.max(0, Math.floor(Number(item?.output || 0))),
        count: Math.max(0, Math.floor(Number(item?.count || 0))),
      };
    }

    return {
      ...base,
      inputTokens: Math.max(0, Math.floor(Number(usage.inputTokens || 0))),
      outputTokens: Math.max(0, Math.floor(Number(usage.outputTokens || 0))),
      requestCount: Math.max(0, Math.floor(Number(usage.requestCount || 0))),
      byModel,
    };
  }

  function getUsage() {
    try {
      return normalizeUsage(JSON.parse(localStorage.getItem(USAGE_STORE) || '{}'));
    } catch {
      return defaultUsage();
    }
  }

  function setUsage(usage) {
    localStorage.setItem(USAGE_STORE, JSON.stringify(normalizeUsage(usage)));
  }

  function addUsage(model, inputTokens, outputTokens) {
    const inTok = Math.max(0, Math.floor(Number(inputTokens || 0)));
    const outTok = Math.max(0, Math.floor(Number(outputTokens || 0)));
    if (!inTok && !outTok) return;

    const safeModel = usageModelKey(model);
    const usage = getUsage();
    const prev = usage.byModel[safeModel] || { input: 0, output: 0, count: 0 };

    usage.inputTokens += inTok;
    usage.outputTokens += outTok;
    usage.requestCount += 1;
    usage.byModel[safeModel] = {
      input: prev.input + inTok,
      output: prev.output + outTok,
      count: prev.count + 1,
    };

    setUsage(usage);
    updateUsageSettingsSummary();
  }

  function resetUsage() {
    localStorage.removeItem(USAGE_STORE);
    updateUsageSettingsSummary();
  }

  function getTokenPrices() {
    return { ...DEFAULT_TOKEN_PRICES };
  }

  function formatInt(value) {
    return Math.max(0, Math.floor(Number(value || 0))).toLocaleString('en-US');
  }

  function formatUsd(value) {
    const n = Math.max(0, Number(value || 0));
    if (n === 0) return '$0.0000';
    return `$${n < 0.0001 ? n.toFixed(6) : n.toFixed(4)}`;
  }

  function usageCostFor(model, inputTokens, outputTokens, prices = getTokenPrices()) {
    const price = prices[usageModelKey(model)];
    if (!price) return null;

    return (Number(inputTokens || 0) / 1_000_000) * Number(price.in || 0)
      + (Number(outputTokens || 0) / 1_000_000) * Number(price.out || 0);
  }

  function getUsageCostSummary() {
    const usage = getUsage();
    const prices = getTokenPrices();
    let totalCost = 0;
    const rows = [];

    for (const [model, item] of Object.entries(usage.byModel || {})) {
      const cost = usageCostFor(model, item.input, item.output, prices);
      if (typeof cost === 'number') totalCost += cost;
      rows.push({ model, ...item, cost });
    }

    rows.sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
    return { usage, prices, rows, totalCost };
  }

  function getSettingsFoldState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_FOLD_STORE) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function setSettingsFoldState(section, collapsed) {
    const state = getSettingsFoldState();
    state[String(section || '')] = !!collapsed;
    localStorage.setItem(SETTINGS_FOLD_STORE, JSON.stringify(state));
  }

  function isSettingsSectionCollapsed(section) {
    return !!getSettingsFoldState()[String(section || '')];
  }

  function settingsSection(section, title, bodyHtml, options = {}) {
    const collapsed = isSettingsSectionCollapsed(section);
    const extra = options.subtitle ? ' cigh-clean-settings-subtitle' : '';
    return `
      <div class="cigh-clean-settings-title${extra}" data-fold-section="${esc(section)}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}">
        <span class="cigh-clean-fold-arrow">${collapsed ? '▸' : '▾'}</span><span>${esc(title)}</span>
      </div>
      <div class="cigh-clean-fold-body${collapsed ? ' collapsed' : ''}" data-fold-body="${esc(section)}">
        ${bodyHtml}
      </div>
    `;
  }

  function extractUsageTokens(body) {
    const u = body?.usageMetadata || body?._firebaseRaw?.response?.usageMetadata || body?._firebaseRaw?.usageMetadata;
    if (!u || typeof u !== 'object') return null;

    const input = Number(u.promptTokenCount || 0);
    let output = Number(u.candidatesTokenCount || 0);
    const thought = Number(u.thoughtsTokenCount || u.thinkingTokenCount || 0);
    if (Number.isFinite(thought) && thought > 0) output += thought;

    const total = Number(u.totalTokenCount || 0);
    if ((!Number.isFinite(output) || output <= 0) && Number.isFinite(total) && total > input) {
      output = total - input;
    }

    if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
    return {
      input: Math.max(0, Math.floor(Number.isFinite(input) ? input : 0)),
      output: Math.max(0, Math.floor(Number.isFinite(output) ? output : 0)),
    };
  }

  function trackGeminiUsage(model, body) {
    const tokens = extractUsageTokens(body);
    if (!tokens) return;
    addUsage(model, tokens.input, tokens.output);
  }

  function getSettingsRoot(root = document) {
    if (root?.id === SETTINGS_ID) return root;
    return root?.querySelector?.(`#${SETTINGS_ID}`) || null;
  }

  function buildUsageSummaryHtml() {
    const { usage, rows, totalCost } = getUsageCostSummary();
    const modelRows = rows.length
      ? rows.map(row => `
          <div class="cigh-clean-usage-model-row">
            <span class="cigh-clean-usage-model-name">${esc(row.model)}</span>
            <b>${typeof row.cost === 'number' ? formatUsd(row.cost) : '$ -'}</b>
          </div>
        `).join('')
      : '<div class="cigh-clean-usage-empty">아직 집계된 사용량이 없어요.</div>';

    return `
      <div class="cigh-clean-usage-summary" data-usage-summary="1">
        <div class="cigh-clean-usage-line">
          요청 ${formatInt(usage.requestCount)} · 입력 ${formatInt(usage.inputTokens)} · 출력 ${formatInt(usage.outputTokens)} · 예상 ${formatUsd(totalCost)}
        </div>
        <div class="cigh-clean-usage-models">${modelRows}</div>
      </div>
    `;
  }

  function buildUsageSettingsHtml() {
    return `
      ${buildUsageSummaryHtml()}
      <div class="cigh-clean-settings-help cigh-clean-usage-note">
        실제 응답의 usageMetadata만 집계합니다. Firebase AI Logic은 usageMetadata가 없으면 미집계됩니다.<br>
        단가는 코드 내장 고정값(100만 토큰당 USD)이며, ≤200k 표준 text 단가 기준입니다. 컨텍스트 캐싱·무료티어는 미반영합니다.
      </div>
      <div class="cigh-clean-settings-row">
        <button type="button" class="cigh-clean-set-btn red" data-action="usage-reset">사용량 초기화</button>
      </div>
    `;
  }

  function updateUsageSettingsSummary(root = document) {
    const settingsRoot = getSettingsRoot(root);
    const summary = settingsRoot?.querySelector?.('[data-usage-summary="1"]');
    if (!summary) return;
    summary.outerHTML = buildUsageSummaryHtml();
  }

  function refreshUsageSettingsSection(root = document) {
    const settingsRoot = getSettingsRoot(root);
    const body = settingsRoot?.querySelector?.('[data-fold-body="usage"]');
    if (!body) return;
    body.innerHTML = buildUsageSettingsHtml();
  }



  // ─────────────────────────────────────────────
  // 방 꾸미기 (DECO) 시스템
  // ─────────────────────────────────────────────
  const DECO_ITEMS = [
    { id: 'wall_night_star', type: 'wallpaper', name: '밤하늘 별', icon: '✦', rank: 'R' },
    { id: 'wall_sky', type: 'wallpaper', name: '푸른 하늘', icon: '☁', rank: 'R' },
    { id: 'wall_plain_ivory', type: 'wallpaper', name: '단색벽지(아이보리)', icon: '□', rank: 'N' },
    { id: 'wall_plain_pink', type: 'wallpaper', name: '단색벽지(연분홍)', icon: '□', rank: 'N' },
    { id: 'wall_plain_plain_3', type: 'wallpaper', name: '단색벽지(3)', icon: '□', rank: 'N' },
    { id: 'wall_muted_sage', type: 'wallpaper', name: '단색벽지(뮤트 세이지)', icon: '□', rank: 'N' },
    { id: 'wall_muted_bluegrey', type: 'wallpaper', name: '단색벽지(뮤트 블루그레이)', icon: '□', rank: 'N' },
    { id: 'wall_muted_mauve', type: 'wallpaper', name: '단색벽지(뮤트 모브)', icon: '□', rank: 'N' },
    { id: 'wall_pastel_mint', type: 'wallpaper', name: '단색벽지(파스텔 민트)', icon: '□', rank: 'N' },
    { id: 'wall_pastel_peach', type: 'wallpaper', name: '단색벽지(파스텔 피치)', icon: '□', rank: 'N' },
    { id: 'wall_pastel_lilac', type: 'wallpaper', name: '단색벽지(파스텔 라일락)', icon: '□', rank: 'N' },
    { id: 'floor_wood', type: 'floor', name: '나무 바닥', icon: '▤', rank: 'N' },
    { id: 'floor_wood_piskel', type: 'floor', name: '나무바닥 도트', icon: '▥', rank: 'R' },
    { id: 'floor_ash_wood', type: 'floor', name: '애쉬 원목', icon: '▤', rank: 'N' },
    { id: 'floor_grass', type: 'floor', name: '잔디밭', icon: '✿', rank: 'R' },
    { id: 'floor_deep_grass', type: 'floor', name: '숲빛 잔디', icon: '❀', rank: 'SR' },
    { id: 'floor_star_grass', type: 'floor', name: '별밤 잔디', icon: '✦', rank: 'SR' },
    { id: 'floor_cloud_soft', type: 'floor', name: '구름 바닥', icon: '☁', rank: 'R' },
    { id: 'floor_muted_sand', type: 'floor', name: '단색바닥(뮤트 샌드)', icon: '▦', rank: 'N' },
    { id: 'floor_muted_sage', type: 'floor', name: '단색바닥(뮤트 세이지)', icon: '▦', rank: 'N' },
    { id: 'floor_muted_bluegrey', type: 'floor', name: '단색바닥(뮤트 블루그레이)', icon: '▦', rank: 'N' },
    { id: 'floor_pastel_cream', type: 'floor', name: '단색바닥(파스텔 크림)', icon: '▦', rank: 'N' },
    { id: 'floor_pastel_mint', type: 'floor', name: '단색바닥(파스텔 민트)', icon: '▦', rank: 'N' },
    { id: 'floor_pastel_lilac', type: 'floor', name: '단색바닥(파스텔 라일락)', icon: '▦', rank: 'N' },
    { id: 'prop_cushion', type: 'prop', name: '쿠션', icon: '▰', rank: 'N', x: 26, y: 80 },
    { id: 'prop_plant', type: 'prop', name: '화분', icon: '♧', rank: 'N', x: 78, y: 58 },
    { id: 'prop_flower_twin', type: 'prop', name: '겹꽃', icon: '✿', rank: 'R', x: 30, y: 74 },
    { id: 'prop_flower_bell', type: 'prop', name: '종꽃', icon: '❀', rank: 'R', x: 42, y: 73 },
    { id: 'prop_flower_blossom', type: 'prop', name: '들꽃', icon: '✾', rank: 'R', x: 54, y: 74 },
    { id: 'prop_flower_white', type: 'prop', name: '흰꽃', icon: '✥', rank: 'R', x: 34, y: 75 },
    { id: 'prop_flower_blue', type: 'prop', name: '파란꽃', icon: '✥', rank: 'R', x: 46, y: 75 },
    { id: 'prop_flower_sun', type: 'prop', name: '해바라기', icon: '✺', rank: 'SR', x: 58, y: 74 },
    { id: 'prop_bush_berry', type: 'prop', name: '열매덤불', icon: '❉', rank: 'SR', x: 68, y: 81 },
    { id: 'prop_fence_wood', type: 'prop', name: '나무 울타리', icon: '╬', rank: 'SR', x: 50, y: 88 },
    { id: 'prop_plush_bear', type: 'prop', name: '곰인형', icon: '🧸', rank: 'R', x: 32, y: 80 },
    { id: 'prop_plush_dino', type: 'prop', name: '공룡인형', icon: '🦕', rank: 'R', x: 50, y: 80 },
    { id: 'prop_plush_rabbit', type: 'prop', name: '토끼인형', icon: '🐇', rank: 'R', x: 68, y: 80 },
    { id: 'prop_tree_sakura', type: 'prop', name: '벚꽃나무', icon: '✿', rank: 'SR', x: 22, y: 68 },
    { id: 'prop_tree_willow', type: 'prop', name: '버드나무', icon: '♣', rank: 'SR', x: 78, y: 68 },
    { id: 'prop_tree_maple', type: 'prop', name: '단풍나무', icon: '❋', rank: 'SR', x: 22, y: 68 },
    { id: 'prop_tree_dream', type: 'prop', name: '몽환수', icon: '✦', rank: 'SR', x: 78, y: 68 },
    { id: 'prop_moon_full', type: 'prop', name: '보름달', icon: '●', rank: 'R', x: 78, y: 24 },
    { id: 'prop_books', type: 'prop', name: '책더미', icon: '▤', rank: 'N', x: 20, y: 88 },
    { id: 'prop_lamp', type: 'prop', name: '램프', icon: '◉', rank: 'R', x: 82, y: 35 },
    { id: 'prop_star', type: 'prop', name: '별장식', icon: '✦', rank: 'R', x: 24, y: 28 },
    { id: 'prop_table', type: 'prop', name: '미니테이블', icon: '▱', rank: 'R', x: 70, y: 84 },
    { id: 'prop_rug', type: 'prop', name: '러그', icon: '▭', rank: 'R', x: 50, y: 86 },
    { id: 'prop_clock', type: 'prop', name: '벽시계', icon: '◷', rank: 'R', x: 50, y: 24 },
    { id: 'prop_bed', type: 'prop', name: '침대', icon: '🛏', rank: 'SR', x: 50, y: 82 },
    { id: 'prop_door', type: 'prop', name: '문', icon: '🚪', rank: 'R', x: 84, y: 60 },
    { id: 'prop_frame_bouquet_iv', type: 'prop', name: '꽃다발 액자(아이보리)', icon: '🖼', rank: 'SR', x: 32, y: 30 },
    { id: 'prop_frame_single_iv', type: 'prop', name: '꽃 액자(아이보리)', icon: '🖼', rank: 'R', x: 50, y: 30 },
    { id: 'prop_frame_pot_iv', type: 'prop', name: '화분 액자(아이보리)', icon: '🖼', rank: 'R', x: 66, y: 30 },
    { id: 'prop_frame_pressed_iv', type: 'prop', name: '압화 액자(아이보리)', icon: '🖼', rank: 'R', x: 80, y: 30 },
    { id: 'prop_frame_bouquet_mt', type: 'prop', name: '꽃다발 액자(뮤트)', icon: '🖼', rank: 'SR', x: 32, y: 48 },
    { id: 'prop_frame_single_mt', type: 'prop', name: '꽃 액자(뮤트)', icon: '🖼', rank: 'R', x: 50, y: 48 },
    { id: 'prop_frame_pot_mt', type: 'prop', name: '화분 액자(뮤트)', icon: '🖼', rank: 'R', x: 66, y: 48 },
    { id: 'prop_frame_pressed_mt', type: 'prop', name: '압화 액자(뮤트)', icon: '🖼', rank: 'R', x: 80, y: 48 },
    { id: 'prop_swag', type: 'prop', name: '드라이플라워', icon: '💐', rank: 'SR', x: 50, y: 26 },
    { id: 'prop_window_large', type: 'prop', name: '큰 창문', icon: '🪟', rank: 'SR', x: 38, y: 30 },
    { id: 'prop_window_small', type: 'prop', name: '작은 창문', icon: '🪟', rank: 'R', x: 72, y: 30 },
    { id: 'prop_window_curtain', type: 'prop', name: '커튼 창문', icon: '🪟', rank: 'SR', x: 50, y: 30 },
  ];

  const DECO_TYPE_LABEL = { wallpaper: '벽지', floor: '바닥', prop: '소품' };
  const DECO_RANK_META = {
    N:  { label: 'N',  color: '#8a8f98' },
    R:  { label: 'R',  color: '#5a9be0' },
    SR: { label: 'SR', color: '#c08ae0' },
  };
  const DECO_MULTI_OWN_MAX = { prop_bush_berry: 2, prop_fence_wood: 2 };

  function getDecoOwnedMax(itemOrId) {
    const id = typeof itemOrId === 'string' ? itemOrId : String(itemOrId?.id || '').trim();
    return Math.max(1, Math.floor(Number(DECO_MULTI_OWN_MAX[id] || 1)));
  }

  function getDecoOwnedCount(state, itemOrId) {
    const id = typeof itemOrId === 'string' ? itemOrId : String(itemOrId?.id || '').trim();
    const raw = Number(state?.owned?.[id] || 0);
    return raw > 0 ? Math.max(1, Math.floor(raw)) : 0;
  }

  function nextDecoPropUid() {
    return `dp_${Date.now().toString(36)}_${(decoPropUidSeq++).toString(36)}`;
  }

  function defaultDecoState() {
    return {
      tickets: 0,
      logCredit: 0,
      owned: {},
      equipped: { wallpaper: '', floor: '', props: [] },
    };
  }

  function getDecoItem(id) {
    const key = String(id || '').trim();
    return DECO_ITEMS.find(item => item.id === key) || null;
  }

  function normalizeDecoState(source) {
    const equipped = (source && typeof source.equipped === 'object') ? source.equipped : {};
    const owned = {};

    for (const item of DECO_ITEMS) {
      const rawCount = Math.floor(Number(source?.owned?.[item.id] || 0));
      if (rawCount > 0) owned[item.id] = clamp(rawCount, 1, getDecoOwnedMax(item));
    }

    const seenUids = new Set();
    const propCounts = Object.create(null);
    const props = Array.isArray(equipped.props)
      ? equipped.props
          .map((p, index) => {
            const id = String(p?.id || '').trim();
            let uid = String(p?.uid || `${id || 'prop'}_${index}` || '').trim();
            if (!uid || seenUids.has(uid)) uid = nextDecoPropUid();
            seenUids.add(uid);
            return {
              uid,
              id,
              x: clamp(Number(p?.x ?? 50), 4, 96),
              y: clamp(Number(p?.y ?? 78), 4, 96),
            };
          })
          .filter(p => getDecoItem(p.id)?.type === 'prop')
          .filter(p => {
            const item = getDecoItem(p.id);
            const max = getDecoOwnedMax(item);
            const count = Number(propCounts[p.id] || 0);
            if (count >= max) return false;
            propCounts[p.id] = count + 1;
            return true;
          })
      : [];

    return {
      tickets: Math.max(0, Math.floor(Number(source?.tickets || 0))),
      logCredit: Math.max(0, Math.floor(Number(source?.logCredit || 0))),
      owned,
      equipped: {
        wallpaper: getDecoItem(equipped.wallpaper)?.type === 'wallpaper' ? String(equipped.wallpaper) : '',
        floor: getDecoItem(equipped.floor)?.type === 'floor' ? String(equipped.floor) : '',
        props,
      },
    };
  }

  function getDecoState() {
    try {
      return normalizeDecoState(JSON.parse(localStorage.getItem(DECO_STORE) || '{}'));
    } catch {
      return defaultDecoState();
    }
  }

  function setDecoState(state) {
    localStorage.setItem(DECO_STORE, JSON.stringify(normalizeDecoState(state)));
  }

  function cloneDecoState(state = getDecoState()) {
    return normalizeDecoState(JSON.parse(JSON.stringify(state || defaultDecoState())));
  }

  function getDecoDraft() {
    if (!decoDraft) decoDraft = cloneDecoState();
    return decoDraft;
  }

  function awardDecoLogCredit(logCount = DECO_LOGS_PER_TICKET) {
    const state = getDecoState();
    state.logCredit += Math.max(0, Math.floor(Number(logCount || 0)));
    const gain = Math.floor(state.logCredit / DECO_LOGS_PER_TICKET);
    if (gain > 0) {
      state.tickets += gain;
      state.logCredit = state.logCredit % DECO_LOGS_PER_TICKET;
      setDecoState(state);
      return gain;
    }
    setDecoState(state);
    return 0;
  }

  function rollDecoGacha() {
    const state = getDecoState();
    if (state.tickets <= 0) return { ok: false, reason: 'ticket' };

    const pool = DECO_ITEMS.filter(item => getDecoOwnedCount(state, item) < getDecoOwnedMax(item));
    if (!pool.length) return { ok: false, reason: 'complete' };

    const item = pool[Math.floor(Math.random() * pool.length)];
    state.tickets -= 1;
    state.owned[item.id] = getDecoOwnedCount(state, item) + 1;
    setDecoState(state);

    if (decoEditMode) decoDraft = cloneDecoState(state);
    return { ok: true, item, count: state.owned[item.id] };
  }

  function playDecoGachaAnimation(item, count) {
    document.getElementById('cigh-clean-gacha-modal')?.remove();
    const meta = DECO_RANK_META[item.rank] || DECO_RANK_META.N;
    const isNew = Number(count || 0) <= 1;
    const fancy = item.rank === 'SR';

    const modal = document.createElement('div');
    modal.id = 'cigh-clean-gacha-modal';
    modal.className = 'cigh-clean-gacha-backdrop';
    modal.setAttribute('data-cigh-theme', detectThemeMode());
    modal.innerHTML = `
      <div class="cigh-clean-gacha-stage rank-${esc(item.rank)}" style="--gacha-color:${esc(meta.color)};">
        <div class="cigh-clean-gacha-rays" aria-hidden="true"></div>
        <div class="cigh-clean-gacha-capsule" aria-hidden="true">
          <span class="cigh-clean-gacha-cap-top"></span>
          <span class="cigh-clean-gacha-cap-bot"></span>
          <span class="cigh-clean-gacha-cap-dot"></span>
        </div>
        <div class="cigh-clean-gacha-reveal">
          <span class="cigh-clean-gacha-rank">${esc(meta.label)} RANK</span>
          <span class="cigh-clean-gacha-icon">${esc(item.icon)}</span>
          <span class="cigh-clean-gacha-name">${esc(item.name)}</span>
          <span class="cigh-clean-gacha-tag">${isNew ? 'NEW!' : `보유 x${count}`}</span>
        </div>
        <div class="cigh-clean-gacha-hint">화면을 누르면 닫혀요</div>
      </div>
    `;

    const stage = modal.querySelector('.cigh-clean-gacha-stage');
    const panel = document.getElementById(PANEL_ID);
    const mountInsidePanel = panel instanceof HTMLElement && panel.classList.contains('open');
    const host = mountInsidePanel ? panel : document.body;
    if (mountInsidePanel) modal.classList.add('in-panel');

    let revealed = false;
    let closed = false;

    const reveal = () => {
      if (revealed) return;
      revealed = true;
      stage.classList.add('revealed');
      spawnPetParticles(stage, fancy ? 'evolve' : 'level');
      playBeep(fancy ? 'evolve' : 'levelup');
    };

    const close = () => {
      if (closed) return;
      closed = true;
      modal.classList.add('closing');
      setTimeout(() => {
        modal.remove();
        renderContent();
      }, 190);
    };

    modal.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!revealed) reveal();
      else close();
    });

    host.appendChild(modal);

    requestAnimationFrame(() => stage.classList.add('shake'));
    setTimeout(reveal, 760);
    setTimeout(close, 4600);
  }

  function decoClass(id) {
    return String(id || '').replace(/_/g, '-').replace(/[^a-z0-9-]/gi, '-');
  }

  function renderDecoBackdropHtml(state) {
    const safe = normalizeDecoState(state);
    const wall = getDecoItem(safe.equipped.wallpaper);
    const floor = getDecoItem(safe.equipped.floor);
    const wallClass = wall ? ` cigh-clean-deco-${esc(decoClass(wall.id))}` : '';
    const floorClass = floor ? ` cigh-clean-deco-${esc(decoClass(floor.id))}` : '';
    return `
      <div class="cigh-clean-room-wall${wallClass}"></div>
      <div class="cigh-clean-room-floor${floorClass}"></div>
      <div class="cigh-clean-room-props">${renderDecoPropsHtml(safe, decoEditMode)}</div>`;
  }

  function renderDecoPropsHtml(state, edit = false) {
    const props = normalizeDecoState(state).equipped.props || [];
    return props.map((prop, index) => {
      const item = getDecoItem(prop.id);
      if (!item) return '';
      const uid = String(prop.uid || `${item.id}_${index}`);
      return `
        <button type="button" class="cigh-clean-room-prop cigh-clean-deco-${esc(decoClass(item.id))}${edit ? ' editable' : ''}"
          data-deco-prop-id="${esc(item.id)}"
          data-deco-prop-uid="${esc(uid)}"
          title="${esc(item.name)}${edit ? ' · 드래그로 이동' : ''}"
          style="left:${clamp(prop.x, 4, 96)}%;top:${clamp(prop.y, 4, 96)}%;z-index:${2 + index};">
          <span>${esc(item.icon)}</span>
        </button>`;
    }).join('');
  }

  function renderDecoEditorHtml() {
    const state = getDecoDraft();
    const tab = ['wallpaper', 'floor', 'prop'].includes(decoEditTab) ? decoEditTab : 'wallpaper';
    const owned = DECO_ITEMS.filter(item => item.type === tab && getDecoOwnedCount(state, item) > 0);
    const propCount = Array.isArray(state.equipped.props) ? state.equipped.props.length : 0;
    const ticketLow = state.tickets <= 0;
    const tabIcon = { wallpaper: '🖼', floor: '▦', prop: '✦' };

    const tabs = ['wallpaper', 'floor', 'prop'].map(type => {
      const itemsInTab = DECO_ITEMS.filter(it => it.type === type);
      const ownedInTab = itemsInTab.filter(it => getDecoOwnedCount(state, it) > 0).length;
      const totalInTab = itemsInTab.length;
      return `
        <button type="button" class="cigh-clean-deco-tab${tab === type ? ' on' : ''}" data-deco-tab="${esc(type)}" title="${esc(DECO_TYPE_LABEL[type])} 수집률 ${ownedInTab}/${totalInTab}">
          <span class="cigh-clean-deco-tab-icon">${esc(tabIcon[type] || '')}</span>${esc(DECO_TYPE_LABEL[type])}
          <span class="cigh-clean-deco-tab-count">${ownedInTab}/${totalInTab}</span>
        </button>`;
    }).join('');

    const itemButtons = owned.length
      ? owned.map(item => {
        const ownedCount = getDecoOwnedCount(state, item);
        const placedCount = item.type === 'prop' ? state.equipped.props.filter(p => p.id === item.id).length : 0;
        const selected = tab === 'wallpaper'
          ? state.equipped.wallpaper === item.id
          : tab === 'floor'
            ? state.equipped.floor === item.id
            : placedCount > 0;
        const rankColor = (DECO_RANK_META[item.rank] || DECO_RANK_META.N).color;
        const qtyBadge = ownedCount > 1 ? `<span class="cigh-clean-deco-item-qty">x${ownedCount}</span>` : '';
        return `
          <button type="button" class="cigh-clean-deco-item rank-${esc(item.rank)}${selected ? ' on' : ''} cigh-clean-deco-${esc(decoClass(item.id))}"
            data-deco-item="${esc(item.id)}"
            style="--deco-rank-color:${esc(rankColor)};"
            title="${esc(item.name)} · ${esc(item.rank)}${item.type === 'prop' ? ` · 배치 ${placedCount}/${ownedCount}` : ''}">
            <span class="cigh-clean-deco-rank-dot" aria-hidden="true"></span>
            ${qtyBadge}
            <span class="cigh-clean-deco-icon">${esc(item.icon)}</span>
            <span class="cigh-clean-deco-name">${esc(item.name)}</span>
            ${selected ? '<span class="cigh-clean-deco-on-mark" aria-hidden="true">✓</span>' : ''}
          </button>`;
      }).join('')
      : `<div class="cigh-clean-deco-empty">보유한 ${esc(DECO_TYPE_LABEL[tab])}가 없어요 · 뽑기로 모아보자</div>`;

    const creditNow = clamp(Math.floor(Number(state.logCredit || 0)), 0, DECO_LOGS_PER_TICKET - 1);
    const creditRemain = Math.max(0, DECO_LOGS_PER_TICKET - creditNow);
    const ticketProgressTitle = creditNow > 0
      ? `다음 🎟️까지 로그 ${creditRemain}개 남음`
      : `다음 🎟️까지 로그 ${DECO_LOGS_PER_TICKET}개 남음`;

    const clearLabel = tab === 'prop' ? '소품 비우기' : `${DECO_TYPE_LABEL[tab]} 비우기`;
    return `
      <div class="cigh-clean-deco-editor">
        <div class="cigh-clean-deco-head">
          <span class="cigh-clean-deco-ticket" title="${esc(ticketProgressTitle)}"><b>🎟️</b>${state.tickets}<i>장</i><em>${creditNow}/${DECO_LOGS_PER_TICKET}</em></span>
          ${tab === 'prop' ? `<span class="cigh-clean-deco-count">소품 ${propCount}</span>` : ''}
          <button type="button" class="cigh-clean-deco-mini-btn ghost" data-deco-action="clear-current">${esc(clearLabel)}</button>
          <button type="button" class="cigh-clean-deco-mini-btn gacha${ticketLow ? ' off' : ''}" data-deco-action="gacha">🎲 뽑기</button>
        </div>
        <div class="cigh-clean-deco-tabs">${tabs}</div>
        <div class="cigh-clean-deco-shelf">${itemButtons}</div>
        <div class="cigh-clean-deco-help">소품 배치 제한 없음 · 수풀/울타리만 x2 · 최근 만진 소품이 위로</div>
      </div>`;
  }

  function toggleDecoItem(id) {
    const item = getDecoItem(id);
    if (!item) return false;
    const state = getDecoDraft();
    if (getDecoOwnedCount(state, item) <= 0) return false;

    if (item.type === 'wallpaper') {
      state.equipped.wallpaper = state.equipped.wallpaper === item.id ? '' : item.id;
    } else if (item.type === 'floor') {
      state.equipped.floor = state.equipped.floor === item.id ? '' : item.id;
    } else if (item.type === 'prop') {
      const ownedCount = getDecoOwnedCount(state, item);
      const placedCount = state.equipped.props.filter(p => p.id === item.id).length;
      if (ownedCount <= 1) {
        const index = state.equipped.props.findIndex(p => p.id === item.id);
        if (index >= 0) state.equipped.props.splice(index, 1);
        else {
          const placed = state.equipped.props.length;
          state.equipped.props.push({
            uid: nextDecoPropUid(),
            id: item.id,
            x: clamp(Number(item.x ?? (22 + placed * 14)), 8, 92),
            y: clamp(Number(item.y ?? 78), 8, 92),
          });
        }
      } else {
        if (placedCount < ownedCount) {
          const placed = state.equipped.props.length;
          state.equipped.props.push({
            uid: nextDecoPropUid(),
            id: item.id,
            x: clamp(Number(item.x ?? (22 + placed * 14)), 8, 92),
            y: clamp(Number(item.y ?? 78), 8, 92),
          });
        } else {
          state.equipped.props = state.equipped.props.filter(p => p.id !== item.id);
        }
      }
    }

    decoDraft = normalizeDecoState(state);
    return true;
  }

  function clearCurrentDecoTab() {
    const state = getDecoDraft();
    if (decoEditTab === 'wallpaper') state.equipped.wallpaper = '';
    else if (decoEditTab === 'floor') state.equipped.floor = '';
    else state.equipped.props = [];
    decoDraft = normalizeDecoState(state);
  }

  function bringDecoPropToFront(uid, room = null) {
    const draft = getDecoDraft();
    const index = draft.equipped.props.findIndex(p => p.uid === uid);
    if (index < 0) return false;

    const [prop] = draft.equipped.props.splice(index, 1);
    draft.equipped.props.push(prop);
    decoDraft = normalizeDecoState(draft);

    if (room) {
      const ordered = decoDraft.equipped.props || [];
      ordered.forEach((p, orderIndex) => {
        const el = room.querySelector(`[data-deco-prop-uid="${CSS.escape(p.uid)}"]`);
        if (el) el.style.zIndex = String(2 + orderIndex);
      });
    }
    return true;
  }

  function startDecoPropDrag(event, propEl) {
    if (!decoEditMode || !propEl) return false;
    const room = propEl.closest('.cigh-clean-pet-wrap');
    if (!room) return false;

    const uid = propEl.dataset.decoPropUid || '';
    const draft = getDecoDraft();
    if (!draft.equipped.props.find(p => p.uid === uid)) return false;

    bringDecoPropToFront(uid, room);

    decoDragState = { uid, room, pointerId: event.pointerId };
    propEl.classList.add('dragging');
    try { propEl.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function moveDecoPropDrag(event) {
    if (!decoDragState || decoDragState.pointerId !== event.pointerId) return;
    const rect = decoDragState.room.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 4, 96);
    const y = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100, 4, 96);
    const draft = getDecoDraft();
    const prop = draft.equipped.props.find(p => p.uid === decoDragState.uid);
    if (prop) {
      prop.x = Math.round(x);
      prop.y = Math.round(y);
    }

    const el = decoDragState.room.querySelector(`[data-deco-prop-uid="${CSS.escape(decoDragState.uid)}"]`);
    if (el) {
      el.style.left = `${Math.round(x)}%`;
      el.style.top = `${Math.round(y)}%`;
    }

    event.preventDefault();
  }

  function endDecoPropDrag(event) {
    if (!decoDragState || decoDragState.pointerId !== event.pointerId) return;
    const el = decoDragState.room.querySelector(`[data-deco-prop-uid="${CSS.escape(decoDragState.uid)}"]`);
    if (el) {
      el.classList.remove('dragging');
      try { el.releasePointerCapture(event.pointerId); } catch {}
    }
    decoDragState = null;
    event.preventDefault();
  }

  // ─────────────────────────────────────────────
  // 업적 (Achievement) 시스템
  // ─────────────────────────────────────────────
  const PET_PANEL_SPRITE_SIZE = 5;

  const ACHV_RANK_EXP_BONUS = { N: 0.002, R: 0.005, SR: 0.01, SSR: 0.015 };

  const ACHV_DEFS = [
    { id: 'first_step',   name: '첫 발자국',       icon: '📖', rank: 'N',   counter: 'analyzeTotal',    target: 1,     hidden: true,  desc: '첫 분석' },
    { id: 'story_collect',name: '이야기 수집가',   icon: '🔁', rank: 'N',   counter: 'analyzeTotal',    target: 100,   hidden: false, desc: '누적 분석 100회' },
    { id: 'story_keeper', name: '이야기 사서',     icon: '📚', rank: 'SR',  counter: 'analyzeTotal',    target: 1000,  hidden: false, desc: '누적 분석 1000회' },
    { id: 'story_chronicler',name:'이야기 사관',   icon: '🏛️', rank: 'SSR', counter: 'analyzeTotal',    target: 10000, hidden: false, desc: '누적 분석 10000회' },
    { id: 'night_butler', name: '밤샘 집사',       icon: '🌙', rank: 'R',   counter: 'hourDawn',        target: 100,   hidden: false, desc: '새벽(0~5시) 분석 100회' },
    { id: 'morning_butler',name:'아침형 집사',     icon: '🌅', rank: 'N',   counter: 'hourMorning',     target: 100,   hidden: false, desc: '아침(6~10시) 분석 100회' },
    { id: 'noon_butler',  name: '한낮 집사',       icon: '☀️', rank: 'N',   counter: 'hourNoon',        target: 100,   hidden: false, desc: '한낮(11~14시) 분석 100회' },
    { id: 'dusk_butler',  name: '황혼 집사',       icon: '🌇', rank: 'N',   counter: 'hourDusk',        target: 100,   hidden: false, desc: '황혼(17~20시) 분석 100회' },
    { id: 'nocturnal_butler',name:'야행성 집사',   icon: '🌃', rank: 'R',   counter: 'hourLateNight',   target: 100,   hidden: false, desc: '심야(21~23시) 분석 100회' },
    { id: 'first_love',   name: '첫 고백 목격자', icon: '💞', rank: 'R',   counter: 'bigPosDelta',     target: 1,     hidden: true,  desc: 'delta +6 이상 1회' },
    { id: 'conflict',     name: '갈등 수집가',     icon: '💔', rank: 'R',   counter: 'negDelta',        target: 50,    hidden: false, desc: 'delta -5 이하 누적 50회' },
    { id: 'hatched',      name: '부화 완료',       icon: '🐣', rank: 'N',   counter: 'petBaby',         target: 1,     hidden: false, desc: '펫 아기단계 도달' },
    { id: 'best_friend',  name: '단짝',           icon: '⭐', rank: 'SR',  counter: 'petBondMax',      target: 1,     hidden: false, desc: '펫 유대 최고단계' },
    { id: 'evo_witness',  name: '진화의 증인',     icon: '👑', rank: 'SR',  counter: 'petFinal',        target: 1,     hidden: false, desc: '펫 완전체 도달' },
    { id: 'dex_master',   name: '도감 마스터',     icon: '🌈', rank: 'SSR', counter: 'finalFormKinds',  target: 5,     hidden: false, desc: '완전체 5종 전부 키워봄' },
    { id: 'destined',     name: '운명의 상대',     icon: '💗', rank: 'SR',  counter: 'meterMax',        target: 1,     hidden: true,  desc: '한 인물 미터 100 도달' },
    { id: 'chatterbox',   name: '수다쟁이',       icon: '🗣️', rank: 'N',   counter: 'petTouch',        target: 300,   hidden: false, desc: '누적 쓰담+콕콕 300회' },
    { id: 'storm_focus',  name: '폭풍 몰입',       icon: '🔥', rank: 'R',   counter: 'storm10min',      target: 1,     hidden: false, desc: '10분 내 분석 5회' },
    { id: 'mood_heart',   name: '애정 연대기',     icon: '💗', rank: 'R',   counter: 'moodHeart',       target: 100,   hidden: false, desc: '애정형 로그 100회' },
    { id: 'mood_bloom',   name: '명랑 연대기',     icon: '🌼', rank: 'R',   counter: 'moodBloom',       target: 100,   hidden: false, desc: '명랑형 로그 100회' },
    { id: 'mood_peace',   name: '평온 연대기',     icon: '🍵', rank: 'R',   counter: 'moodPeace',       target: 100,   hidden: false, desc: '평온형 로그 100회' },
    { id: 'mood_tear',    name: '애상 연대기',     icon: '🌧️', rank: 'R',   counter: 'moodTear',        target: 100,   hidden: false, desc: '애상형 로그 100회' },
    { id: 'mood_blade',   name: '시련 연대기',     icon: '⚔️', rank: 'R',   counter: 'moodBlade',       target: 100,   hidden: false, desc: '시련형 로그 100회' },
    { id: 'kaleidoscope', name: '만화경',         icon: '🎭', rank: 'SSR', counter: 'moodAllFull',     target: 1,     hidden: false, desc: '5성향 전부 100회 달성' },
    { id: 'catastrophe',  name: '파국',           icon: '❄️', rank: 'SR',  counter: 'meterZero',       target: 1,     hidden: true,  desc: '한 인물 미터 0 도달' },
    { id: 'dawn_to_dusk', name: '하루의 시작과 끝',icon: '🌗', rank: 'R',   counter: 'dawnNightSameDay',target: 1,     hidden: false, desc: '같은 날 새벽+심야 분석' },
    { id: 'bond_collect', name: '인연 수집가',     icon: '🌈', rank: 'R',   counter: 'relations5',      target: 1,     hidden: false, desc: '동시에 관계 5명 이상' },
    { id: 'beloved',      name: '만인의 연인',     icon: '🌟', rank: 'SR',  counter: 'relations10',     target: 1,     hidden: false, desc: '동시에 관계 10명 이상' },
    { id: 'home_cook',    name: '집밥의 힘',       icon: '🍙', rank: 'SR',  counter: 'feedTotal',      target: 500, hidden: false, desc: '누적 분석(먹이기) 500회' },
    // ── 추가분 ──
    { id: 'single_bond', name: '외길 인생',     icon: '💟', rank: 'SR',  counter: 'singleBond',  target: 1,       hidden: false, desc: '한 인물 펫 애정도 60 이상' },
    { id: 'pet_named',   name: '이름을 불러줘', icon: '🏷️', rank: 'N',   counter: 'petNamed',    target: 1,       hidden: false, desc: '펫 이름 지정' },
    { id: 'token_glutton', name: '토큰 대식가', icon: '🪙', rank: 'SR',  counter: 'tokenK',      target: 1000000, hidden: false, desc: '누적 입력 토큰 100만' },
    { id: 'day_streak',  name: '꾸준한 집사',   icon: '📅', rank: 'SR',  counter: 'dayStreak',   target: 7,       hidden: false, desc: '7일 연속 분석' },
    { id: 'binge',       name: '몰아보기 장인', icon: '⚡', rank: 'R',   counter: 'comboStreak', target: 10,      hidden: false, desc: '60초 내 연속 10회 분석' },
    { id: 'packed',      name: '한 짐 챙긴 모험가', icon: '🎒', rank: 'R', counter: 'invRich',  target: 1,       hidden: false, desc: '한 장면 인벤토리 5개 이상' },
    { id: 'my_room',     name: '마이룸 입주',   icon: '🏠', rank: 'N',   counter: 'decoEdit',    target: 1,       hidden: false, desc: '방 꾸미기 EDIT 진입' },
    // ── 히든 ──
    { id: 'farewell',    name: '이별의 순간',   icon: '🥀', rank: 'R',   counter: 'bigNegDelta', target: 1,       hidden: true,  desc: 'delta -8 이하 1회' },
    { id: 'soulmate',    name: '천생연분',      icon: '💍', rank: 'SSR', counter: 'soulmate',    target: 1,       hidden: true,  desc: '유대 최고 + 완전체 + 미터 100' },
    { id: 'fickle',      name: '변심',          icon: '🔀', rank: 'R',   counter: 'favChange',   target: 1,       hidden: true,  desc: '최애가 바뀜' },
    { id: 'midnight',    name: '자정의 방문자', icon: '🕛', rank: 'R',   counter: 'midnight',    target: 1,       hidden: true,  desc: '0시대 분석' },
    { id: 'rename',      name: '개명',          icon: '✏️', rank: 'N',   counter: 'renameCount', target: 2,       hidden: true,  desc: '펫 이름 2번 변경' },
  ];

  function defaultAchvState() {
    return {
      counters: {},
      unlocked: {},
      finalFormsSeen: [],
      stormStamps: [],
      dayPhase: null,
      visitStreak: null,   // { date, streak }
      comboRun: 0,         // 60초 내 연속 분석 진행 수
    };
  }

  function readAchvState() {
    try {
      const raw = JSON.parse(localStorage.getItem(ACHV_STORE) || '{}');
      const base = defaultAchvState();
      return {
        counters: (raw && typeof raw.counters === 'object') ? raw.counters : base.counters,
        unlocked: (raw && typeof raw.unlocked === 'object') ? raw.unlocked : base.unlocked,
        finalFormsSeen: Array.isArray(raw?.finalFormsSeen) ? raw.finalFormsSeen.slice(0, 8) : base.finalFormsSeen,
        stormStamps: Array.isArray(raw?.stormStamps) ? raw.stormStamps.slice(-STORM_NEED) : [],
        dayPhase: (raw?.dayPhase && typeof raw.dayPhase === 'object') ? raw.dayPhase : base.dayPhase,
        visitStreak: (raw?.visitStreak && typeof raw.visitStreak === 'object') ? raw.visitStreak : base.visitStreak,
        comboRun: Number(raw?.comboRun || 0),
      };
    } catch { return defaultAchvState(); }
  }

  function writeAchvState(state) {
    localStorage.setItem(ACHV_STORE, JSON.stringify(state));
  }

  function bumpAchvCounter(counterKey, amount = 1, once = false) {
    if (!counterKey || !amount) return;
    const state = readAchvState();
    if (once) {
      if (Number(state.counters[counterKey] || 0) >= 1) return;
      state.counters[counterKey] = 1;
    } else {
      state.counters[counterKey] = Math.max(0, Number(state.counters[counterKey] || 0) + Number(amount));
    }
    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  const STORM_WINDOW_MS = 10 * 60 * 1000;
  const STORM_NEED = 5;
  function registerStormWindow() {
    const state = readAchvState();
    const now = Date.now();
    const list = Array.isArray(state.stormStamps) ? state.stormStamps : [];
    const next = [...list, now].filter(t => now - Number(t) <= STORM_WINDOW_MS).slice(-STORM_NEED);
    state.stormStamps = next;
    if (next.length >= STORM_NEED && !Number(state.counters.storm10min)) state.counters.storm10min = 1;
    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  function registerDayPhase() {
    const now = new Date();
    const h = now.getHours();
    const isDawn = h >= 0 && h <= 5;
    const isLate = h >= 21 && h <= 23;
    if (!isDawn && !isLate) return;
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const state = readAchvState();
    const dp = (state.dayPhase && state.dayPhase.date === today)
      ? state.dayPhase : { date: today, dawn: false, late: false };
    if (isDawn) dp.dawn = true;
    if (isLate) dp.late = true;
    state.dayPhase = dp;
    if (dp.dawn && dp.late && !Number(state.counters.dawnNightSameDay)) state.counters.dawnNightSameDay = 1;
    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  function registerVisitStreak() {
    const now = new Date();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const yd = new Date(now.getTime() - 86400000);
    const yesterday = `${yd.getFullYear()}-${yd.getMonth() + 1}-${yd.getDate()}`;

    const state = readAchvState();
    const prev = (state.visitStreak && typeof state.visitStreak === 'object') ? state.visitStreak : null;
    if (prev?.date === today) return;

    const streak = prev?.date === yesterday ? Number(prev.streak || 0) + 1 : 1;
    state.visitStreak = { date: today, streak };
    state.counters.dayStreak = Math.max(Number(state.counters.dayStreak || 0), streak);

    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  // 직전 분석과 60초 이내면 연속 누적, 아니면 1로 리셋. 최고 연속을 카운터로.
  function registerComboStreak(prevFedAt) {
    const gap = prevFedAt ? Date.now() - Number(prevFedAt) : Infinity;
    const state = readAchvState();
    const run = gap < 60 * 1000 ? Number(state.comboRun || 0) + 1 : 1;
    state.comboRun = run;
    state.counters.comboStreak = Math.max(Number(state.counters.comboStreak || 0), run);
    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  function bumpAchvFinalForm(finalType) {
    const key = String(finalType || '').trim();
    if (!key) return;
    const state = readAchvState();
    if (!state.finalFormsSeen.includes(key)) {
      state.finalFormsSeen.push(key);
      state.finalFormsSeen = state.finalFormsSeen.slice(0, 8);
    }
    state.counters.finalFormKinds = state.finalFormsSeen.length;
    evaluateAchvUnlocks(state);
    writeAchvState(state);
  }

  function evaluateAchvUnlocks(state) {
    if (!Number(state.counters.moodAllFull)
        && ['moodHeart','moodBloom','moodPeace','moodTear','moodBlade'].every(k => Number(state.counters[k] || 0) >= 100)) {
      state.counters.moodAllFull = 1;
    }
    if (!Number(state.counters.soulmate)
        && ['petBondMax','petFinal','meterMax'].every(k => Number(state.counters[k] || 0) >= 1)) {
      state.counters.soulmate = 1;
    }
    for (const def of ACHV_DEFS) {
      if (state.unlocked[def.id]) continue;
      const cur = Number(state.counters[def.counter] || 0);
      if (cur >= def.target) {
        state.unlocked[def.id] = Date.now();
        achvUnlockQueue.push(def);
        console.log(`[유니챗 HUD] 🏆 업적 달성: ${def.icon} ${def.name} (${def.rank}) — ${def.desc}`);
      }
    }
  }

  function hourBucketCounter(d = new Date()) {
    const h = d.getHours();
    if (h >= 0 && h <= 5) return 'hourDawn';
    if (h >= 6 && h <= 10) return 'hourMorning';
    if (h >= 11 && h <= 14) return 'hourNoon';
    if (h >= 17 && h <= 20) return 'hourDusk';
    if (h >= 21 && h <= 23) return 'hourLateNight';
    return null;
  }

  function achvDebugDump() {
    const state = readAchvState();
    const rows = ACHV_DEFS.map(def => ({
      업적: `${def.icon} ${def.name}`, 등급: def.rank,
      진행도: `${Number(state.counters[def.counter] || 0)}/${def.target}`,
      달성: state.unlocked[def.id] ? 'O' : '-', 히든: def.hidden ? 'H' : '',
    }));
    console.table(rows);
    return state;
  }
  window.__cighAchvDebug = achvDebugDump;

  let pendingAchvCelebrate = null;
  const achvUnlockQueue = [];

  const ACHV_RANK_META = {
    N:   { label: 'N',   color: '#8a8f98', bonus: ACHV_RANK_EXP_BONUS.N },
    R:   { label: 'R',   color: '#5a9be0', bonus: ACHV_RANK_EXP_BONUS.R },
    SR:  { label: 'SR',  color: '#c08ae0', bonus: ACHV_RANK_EXP_BONUS.SR },
    SSR: { label: 'SSR', color: '#e0b24b', bonus: ACHV_RANK_EXP_BONUS.SSR },
  };
  const ACHV_RANK_ORDER = { N: 0, R: 1, SR: 2, SSR: 3 };

  function getAchvProgress(def, state = readAchvState()) {
    const cur = Math.max(0, Number(state.counters[def.counter] || 0));
    return { cur: Math.min(cur, def.target), target: def.target, unlocked: !!state.unlocked[def.id] };
  }

  function getAchvExpBonusMultiplier(state = readAchvState()) {
    let bonus = 0;
    for (const def of ACHV_DEFS) {
      if (state.unlocked[def.id]) bonus += Number(ACHV_RANK_EXP_BONUS[def.rank] || 0);
    }
    return 1 + bonus;
  }

  function readEquippedAchvId() {
    return String(localStorage.getItem(ACHV_EQUIPPED_STORE) || '').trim();
  }

  function getEquippedAchvDef() {
    const id = readEquippedAchvId();
    if (!id) return null;
    const state = readAchvState();
    if (!state.unlocked[id]) return null;
    return ACHV_DEFS.find(def => def.id === id) || null;
  }

  function setEquippedAchv(id) {
    const value = String(id || '').trim();
    if (value) localStorage.setItem(ACHV_EQUIPPED_STORE, value);
    else localStorage.removeItem(ACHV_EQUIPPED_STORE);
  }

  function toggleEquippedAchv(id) {
    const target = String(id || '').trim();
    if (!target) return false;
    const state = readAchvState();
    if (!state.unlocked[target]) return false;
    if (readEquippedAchvId() === target) setEquippedAchv('');
    else setEquippedAchv(target);
    return true;
  }

  function announceAchvUnlocks() {
    if (!achvUnlockQueue.length) return;
    const unlocked = achvUnlockQueue.splice(0, achvUnlockQueue.length);
    for (const def of unlocked) {
      const meta = ACHV_RANK_META[def.rank] || ACHV_RANK_META.N;
      pushLog([`▶업적 달성! ${def.icon} ${def.name} (${meta.label})`]);
      showPopup([`▶업적 달성! ${def.icon} ${def.name}`, `▷${def.desc}`]);
    }
    const topRank = unlocked.reduce((best, def) => (ACHV_RANK_ORDER[def.rank] > ACHV_RANK_ORDER[best] ? def.rank : best), 'N');
    playBeep(ACHV_RANK_ORDER[topRank] >= 2 ? 'evolve' : 'levelup');
    pendingAchvCelebrate = unlocked[unlocked.length - 1];
    if (isMascotEnabled()) {
      const first = unlocked[0];
      mascotSay(`${first.icon} ${first.name} 달성!`, 95, { allowEgg: true, allowSleeping: true });
    }
    if (activeTab === 'achv') renderContent();
  }


  // ─────────────────────────────────────────────
  // Utils
  // ─────────────────────────────────────────────
  function normalize(value) {
    return String(value ?? '')
      .replace(/\r/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function clamp(value, min, max) {
    const n = Number(value);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function shortText(value, max = 60) {
    const text = normalize(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function isBlankLike(value) {
    const t = normalize(value);
    if (!t) return true;
    if (/^[-—–_·ㆍ.]+$/.test(t)) return true;
    if (/^(없음|없다|없어|미상|정보 없음|해당 없음|해당없음|unknown|null|none|n\/a)$/i.test(t)) return true;
    return false;
  }

  function cleanOptionalValue(value) {
    return isBlankLike(value) ? '' : normalize(value);
  }

  function hasSourceText(raw) {
    return !!cleanOptionalValue(raw?.sourceText || raw?.source || raw?.evidence || '');
  }

  function nowTime() {
    return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  function hasBatchim(word) {
    const ch = String(word || '').trim().slice(-1);
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return false;
    return ((code - 0xac00) % 28) !== 0;
  }

  function fixParticlePlaceholders(value) {
    return String(value || '').replace(
      /([가-힣a-zA-Z0-9]+)\s*(?:은\(는\)|\(은\)는|이\(가\)|\(이\)가|을\(를\)|\(을\)를|과\(와\)|\(과\)와)/g,
      (match, word) => {
        const b = hasBatchim(word);
        if (match.includes('은') || match.includes('는')) return word + (b ? '은' : '는');
        if (match.includes('이') || match.includes('가')) return word + (b ? '이' : '가');
        if (match.includes('을') || match.includes('를')) return word + (b ? '을' : '를');
        if (match.includes('과') || match.includes('와')) return word + (b ? '과' : '와');
        return word;
      }
    );
  }

  const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?/gu;
  const BLOCKED_MOOD_EMOJI = new Set([
    '▶', '▶️', '▷', '▷️', '◀', '◀️', '■', '□', '◆', '◇',
    '⌛', '⏳', '☀', '☀️', '🌙', '⭐', '✧', '✦', '✔', '✅',
  ]);

  function cleanMoodEmoji(value) {
    const found = String(value || '').match(EMOJI_RE);
    if (!found) return '';
    for (const emoji of found) {
      if (!BLOCKED_MOOD_EMOJI.has(emoji)) return emoji;
    }
    return '';
  }

  function stripEmojis(value) {
    return String(value || '').replace(EMOJI_RE, '').trim();
  }

  function relationKey(name) {
    const key = stripEmojis(name)
      .replace(/^[#▸>\-•*└]+\s*/g, '')
      .replace(/[｜|:：].*$/g, '')
      .replace(/\b(관계|호감|신뢰|친밀|긴장|경계|유대)\b/g, '')
      .replace(/[()\[\]{}<>《》〔〕]/g, ' ')
      .replace(/[^\w가-힣\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return key || '';
  }

  function isValidRelationName(name) {
    const key = relationKey(name);
    if (!key) return false;
    if (/^\d+$/.test(key)) return false;
    if (/^\d{1,4}\s*(년|월|일|시|분|초)?$/.test(key)) return false;
    if (/^(AM|PM|오전|오후|낮|밤|저녁|아침|봄|여름|가을|겨울|맑음|흐림|비|눈)$/i.test(key)) return false;
    if (/^(Site|SITE|정보|보안부|위치|상황|목표|소속|능력|상태|관계|개체|가방|아이템|퀘스트)$/i.test(key)) return false;
    if (key.length > 30) return false;
    return true;
  }

  function isPossiblePlayerName(name) {
    const key = relationKey(name);

    if (!isValidRelationName(key)) return false;
    if (/^(남성|여성|여자|남자|수컷|암컷|인간|요괴|신부|수녀|요원|직원|팀|관리|소속|보안등급)$/i.test(key)) return false;
    if (/(팀|요원|직원|소속|관리|보안등급|부서|재단|학교|회사|능력|목표|상황)/.test(key)) return false;
    if (/\d/.test(key)) return false;

    return key.length >= 2 && key.length <= 12;
  }

  function extractPossiblePlayerNames(text) {
    const out = [];
    const seen = new Set();
    const src = normalize(text);
    const lines = src.split('\n').slice(0, 24);

    const add = value => {
      const name = relationKey(value);
      if (!isPossiblePlayerName(name)) return;
      if (seen.has(name)) return;
      seen.add(name);
      out.push(name);
    };

    for (const line of lines) {
      for (const m of line.matchAll(/\[([^\]]{1,28})\]/g)) add(m[1]);

      const named = line.match(/^《(.{1,20}?)》\s*[ː:：]?/);
      if (named) add(named[1]);

      const speaker = line.match(/^([^\n｜|:：]{2,12})[｜|:：]\s*["“]/);
      if (speaker) add(speaker[1]);
    }

    return out.slice(0, 8);
  }

  function parsePercent(value, fallback = 50) {
    const m = String(value ?? '').match(/(-?\d+(?:\.\d+)?)\s*%?/);
    if (!m) return fallback;
    return clamp(Number(m[1]), 0, 100);
  }

  // ─────────────────────────────────────────────
  // Data shape
  // ─────────────────────────────────────────────
  function makeEmptyData() {
    return {
      time: '',
      location: '',
      character: '',
      situation: '',
      goal: '',
      clothing: '',
      relations: [],
      relationshipMeters: [],
      relationshipDeltas: [],
      affection: [],
      inferredPlayerName: '',
      possiblePlayerNames: [],
      inventory: [],
      stats: [],
      quests: [],
      narrativeLogs: [],
      pokemonLogs: [],
      hudComments: [],
      _inferredStatus: false,
      _infoFound: false,
      _fromGeminiInfo: false,
      _seen: {
        relations: false,
        inventory: false,
        status: false,
      },
    };
  }

  function normalizeRelation(raw) {
    if (!raw || typeof raw !== 'object') {
      const text = normalize(raw);
      const moodEmoji = cleanMoodEmoji(text);
      const name = relationKey(text);
      return { name, moodEmoji, type: '관계', detail: '', value: '' };
    }

    const joined = normalize([raw.name, raw.detail, raw.memo, raw.type].filter(Boolean).join(' '));
    const name = relationKey(raw.name || joined);
    const moodEmoji = cleanMoodEmoji(raw.moodEmoji) || cleanMoodEmoji(joined);

    return {
      name,
      moodEmoji,
      type: cleanOptionalValue(raw.type) || '관계',
      detail: cleanOptionalValue(raw.detail || raw.memo),
      value: cleanOptionalValue(raw.value),
    };
  }

  function normalizeMeter(raw, fallbackValue = 50) {
    if (!raw || typeof raw !== 'object') {
      const rel = normalizeRelation(raw);
      return {
        name: rel.name,
        moodEmoji: rel.moodEmoji,
        label: '관계',
        value: fallbackValue,
        memo: rel.detail,
      };
    }

    const joined = normalize([raw.name, raw.memo, raw.label].filter(Boolean).join(' '));
    const name = relationKey(raw.name || joined);
    const moodEmoji = cleanMoodEmoji(raw.moodEmoji) || cleanMoodEmoji(joined);
    const rawValue = Number(raw.value);
    const value = Number.isNaN(rawValue) ? fallbackValue : clamp(rawValue, 0, 100);

    return {
      name,
      moodEmoji,
      label: cleanOptionalValue(raw.label) || '관계',
      value,
      memo: cleanOptionalValue(raw.memo),
    };
  }

  function normalizeDelta(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const name = relationKey(raw.name || '');
    if (!isValidRelationName(name)) return null;

    const rawDelta = Number(raw.delta);
    if (Number.isNaN(rawDelta)) return null;

    return {
      name,
      delta: rawDelta,
      label: cleanOptionalValue(raw.label) || '관계',
      memo: cleanOptionalValue(raw.memo || raw.reason || raw.detail),
    };
  }


  function isRoomUserRelationName(name, userName = getRoomUserName()) {
    const userKey = relationKey(userName);
    const key = relationKey(name);
    if (!userKey || !key) return false;
    return key === userKey
      || key.startsWith(`${userKey} `)
      || key.endsWith(` ${userKey}`)
      || key.includes(` ${userKey} `);
  }

  function stripRoomUserFromData(data, userName = getRoomUserName()) {
    const d = sanitizeData(data || makeEmptyData());
    const user = String(userName || '').trim().slice(0, 20);
    if (!user) return d;

    const keepRelation = rel => !isRoomUserRelationName(normalizeRelation(rel).name, user);
    const keepMeter = meter => !isRoomUserRelationName(normalizeMeter(meter, 50).name, user);
    const keepDelta = delta => !isRoomUserRelationName(delta?.name || '', user);

    d.character = user;
    d.inferredPlayerName = user;
    d.possiblePlayerNames = [];
    d.relations = (d.relations || []).filter(keepRelation);
    d.affection = (d.affection || []).filter(keepMeter);
    d.relationshipMeters = d.affection;
    d.relationshipDeltas = (d.relationshipDeltas || []).filter(keepDelta);

    return d;
  }

  function sanitizeData(data) {
    const d = { ...makeEmptyData(), ...(data || {}) };

    for (const key of ['time', 'location', 'character', 'situation', 'goal', 'clothing']) {
      d[key] = cleanOptionalValue(d[key]);
    }

    d.relations = Array.isArray(d.relations)
      ? d.relations.map(normalizeRelation).filter(r => isValidRelationName(r.name))
      : [];

    const meters = Array.isArray(d.affection) && d.affection.length
      ? d.affection
      : (Array.isArray(d.relationshipMeters) ? d.relationshipMeters : []);

    d.affection = meters.map(m => normalizeMeter(m, 50)).filter(m => isValidRelationName(m.name));
    d.relationshipMeters = d.affection;

    d.relationshipDeltas = Array.isArray(d.relationshipDeltas)
      ? d.relationshipDeltas.map(normalizeDelta).filter(Boolean)
      : [];

    d.inferredPlayerName = cleanOptionalValue(d.inferredPlayerName);
    d.possiblePlayerNames = Array.isArray(d.possiblePlayerNames)
      ? d.possiblePlayerNames.map(relationKey).filter(isPossiblePlayerName).slice(0, 8)
      : [];

    d.inventory = Array.isArray(d.inventory)
      ? d.inventory.map(item => normalizeInventoryItem(item)).filter(item => item.name)
      : [];

    d.stats = Array.isArray(d.stats)
      ? d.stats.map(s => ({
          name: cleanOptionalValue(s?.name || s?.label || ''),
          value: cleanOptionalValue(s?.value || ''),
        })).filter(s => s.name || s.value)
      : [];

    d.quests = Array.isArray(d.quests)
      ? d.quests.map(q => shortText(q, 80)).filter(Boolean)
      : [];

    d.narrativeLogs = Array.isArray(d.narrativeLogs)
      ? d.narrativeLogs.map(normalizeGameLine).filter(Boolean).slice(0, 8)
      : [];

    d.pokemonLogs = d.narrativeLogs;

    d.hudComments = Array.isArray(d.hudComments)
      ? d.hudComments.map(x => shortText(x, 42)).filter(Boolean).slice(0, 3)
      : [];

    d._inferredStatus = !!d._inferredStatus;
    d._infoFound = !!d._infoFound;
    d._fromGeminiInfo = !!d._fromGeminiInfo;

    d._seen = {
      relations: !!d._seen?.relations,
      inventory: !!d._seen?.inventory,
      status: !!d._seen?.status,
    };

    return d;
  }

  function mergeStatusField(baseValue, infoValue, aiValue, useAiStatus = false) {
    const info = cleanOptionalValue(infoValue);
    if (isExplicitClearValue(infoValue)) return '';
    if (info) return info;
    if (useAiStatus) {
      const ai = cleanOptionalValue(aiValue);
      if (isExplicitClearValue(aiValue)) return '';
      if (ai) return ai;
    }
    return cleanOptionalValue(baseValue);
  }

  function mergeRelationsPartial(baseRelations, infoRelations, options = {}) {
    const removeForcedUserRelation = options.removeForcedUserRelation || (() => true);
    const map = new Map();

    for (const raw of baseRelations || []) {
      const rel = normalizeRelation(raw);
      const key = relationKey(rel.name);
      if (!isValidRelationName(key) || !removeForcedUserRelation(rel)) continue;
      map.set(key, rel);
    }

    for (const raw of infoRelations || []) {
      const rel = normalizeRelation(raw);
      const key = relationKey(rel.name);
      if (!isValidRelationName(key) || !removeForcedUserRelation(rel)) continue;

      if (isExplicitRemovalItem(rel) || isExplicitRemovalItem(raw)) {
        map.delete(key);
        continue;
      }

      const prev = map.get(key);
      map.set(key, {
        ...prev,
        ...rel,
        name: rel.name || prev?.name || key,
        moodEmoji: rel.moodEmoji || prev?.moodEmoji || '',
        type: rel.type || prev?.type || '관계',
        detail: rel.detail || prev?.detail || '',
        value: rel.value || prev?.value || '',
        sourceText: rel.sourceText || prev?.sourceText || '',
      });
    }

    return Array.from(map.values());
  }

  function mergeInventoryPartial(baseItems, infoItems) {
    const map = new Map();

    for (const raw of baseItems || []) {
      const item = normalizeInventoryItem(raw);
      const key = relationKey(item.name);
      if (!key) continue;
      map.set(key, item);
    }

    for (const raw of infoItems || []) {
      const item = normalizeInventoryItem(raw);
      const key = relationKey(item.name);
      if (!key) continue;

      if (isExplicitRemovalItem(item) || isExplicitRemovalItem(raw)) {
        map.delete(key);
        continue;
      }

      const prev = map.get(key);
      map.set(key, {
        ...prev,
        ...item,
        name: item.name || prev?.name || key,
        icon: normalizeIcon(item.icon || prev?.icon, item.name || prev?.name || key),
        detail: item.detail || prev?.detail || '',
        sourceText: item.sourceText || prev?.sourceText || '',
      });
    }

    return Array.from(map.values()).slice(0, 24);
  }

  function mergeStatsPartial(baseStats, infoStats) {
    const map = new Map();

    for (const raw of baseStats || []) {
      const stat = {
        name: cleanOptionalValue(raw?.name || raw?.label || ''),
        value: cleanOptionalValue(raw?.value || ''),
      };
      const key = relationKey(stat.name || stat.value);
      if (!key) continue;
      map.set(key, stat);
    }

    for (const raw of infoStats || []) {
      const stat = {
        name: cleanOptionalValue(raw?.name || raw?.label || ''),
        value: cleanOptionalValue(raw?.value || ''),
      };
      const key = relationKey(stat.name || stat.value);
      if (!key) continue;

      if (isExplicitRemovalItem(raw) || isExplicitClearValue(stat.value)) {
        map.delete(key);
        continue;
      }

      const prev = map.get(key);
      map.set(key, {
        name: stat.name || prev?.name || '',
        value: stat.value || prev?.value || '',
      });
    }

    return Array.from(map.values());
  }

  function questKey(value) {
    return normalize(value).replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 36);
  }

  function mergeQuestsPartial(baseQuests, infoQuests) {
    const map = new Map();

    for (const raw of baseQuests || []) {
      const q = shortText(raw, 80);
      const key = questKey(q);
      if (key) map.set(key, q);
    }

    for (const raw of infoQuests || []) {
      const q = shortText(raw, 80);
      const key = questKey(q);
      if (!key) continue;

      if (isExplicitRemovalText(q)) {
        for (const prevKey of Array.from(map.keys())) {
          if (key.includes(prevKey) || prevKey.includes(key)) map.delete(prevKey);
        }
        continue;
      }

      map.set(key, q);
    }

    return Array.from(map.values());
  }

  function mergeMeters(baseMeters, deltas, currentRelations) {
    const relationKeys = new Set();
    const relationMap = new Map();

    for (const rel of currentRelations || []) {
      const r = normalizeRelation(rel);
      const key = relationKey(r.name);
      if (!isValidRelationName(key)) continue;

      relationKeys.add(key);
      relationMap.set(key, r);
    }

    const map = new Map();

    for (const item of baseMeters || []) {
      const m = normalizeMeter(item, 50);
      const key = relationKey(m.name);

      if (!relationKeys.has(key)) continue;

      const rel = relationMap.get(key);
      map.set(key, {
        name: rel?.name || m.name,
        moodEmoji: rel?.moodEmoji || m.moodEmoji || '',
        label: m.label || '관계',
        value: clamp(m.value, 0, 100),
        memo: rel?.detail || m.memo || '',
      });
    }

    for (const [key, rel] of relationMap.entries()) {
      if (!map.has(key)) {
        map.set(key, {
          name: rel.name,
          moodEmoji: rel.moodEmoji || '',
          label: '관계',
          value: 50,
          memo: rel.detail || '',
        });
      }
    }

    for (const rawDelta of deltas || []) {
      const d = normalizeDelta(rawDelta);
      if (!d) continue;

      const key = relationKey(d.name);
      if (!relationKeys.has(key)) continue;

      const prev = map.get(key);
      if (!prev) continue;

      const raw = Number(d.delta);
      const capped = raw >= 0
        ? Math.min(raw, METER_UP_CAP)
        : Math.max(raw, -METER_DOWN_CAP);

      map.set(key, {
        ...prev,
        label: d.label || prev.label || '관계',
        value: clamp(prev.value + capped, 0, 100),
        memo: d.memo || prev.memo || '',
      });
    }

    return Array.from(map.values());
  }

  function mergeData(baseRaw, infoRaw, aiRaw) {
    const base = sanitizeData(baseRaw || makeEmptyData());
    const info = sanitizeData(infoRaw || makeEmptyData());
    const ai = sanitizeData(aiRaw || makeEmptyData());
    const forcedUserName = getRoomUserName();
    const forcedUserKey = relationKey(forcedUserName);

    const removeForcedUserRelation = item => !forcedUserKey || !isRoomUserRelationName(normalizeRelation(item).name, forcedUserName);
    const removeForcedUserMeter = item => !forcedUserKey || !isRoomUserRelationName(normalizeMeter(item, 50).name, forcedUserName);
    const removeForcedUserDelta = item => !forcedUserKey || !isRoomUserRelationName(item?.name || '', forcedUserName);

    const infoHasAny =
      !!(info.time || info.location || info.character || info.situation || info.goal || info.clothing ||
         info._seen.relations || info._seen.inventory || info.stats.length || info.quests.length);

    const currentRelations = mergeRelationsPartial(base.relations, info._seen.relations ? info.relations : [], { removeForcedUserRelation });
    const filteredDeltas = (ai.relationshipDeltas || []).filter(removeForcedUserDelta);
    const baseMeters = (base.affection || base.relationshipMeters || []).filter(removeForcedUserMeter);
    const mergedMeters = mergeMeters(baseMeters, filteredDeltas, currentRelations).filter(removeForcedUserMeter);

    const inferredPlayerName =
      forcedUserName ||
      ai.inferredPlayerName ||
      info.character ||
      base.inferredPlayerName ||
      '';

    const possiblePlayerNames = forcedUserName
      ? []
      : [
        ...new Set([
          ...(info.possiblePlayerNames || []),
          ...(base.possiblePlayerNames || []),
        ])
      ].filter(isPossiblePlayerName).slice(0, 8);

    const useAiStatus = !infoHasAny && ai._inferredStatus;

    const merged = sanitizeData({
      ...base,
      time: mergeStatusField(base.time, info.time, ai.time, useAiStatus),
      location: mergeStatusField(base.location, info.location, ai.location, useAiStatus),
      character: forcedUserName || mergeStatusField(base.character, info.character, ai.character, useAiStatus) || inferredPlayerName || '',
      inferredPlayerName,
      possiblePlayerNames,
      situation: mergeStatusField(base.situation, info.situation, ai.situation, useAiStatus),
      goal: mergeStatusField(base.goal, info.goal, ai.goal, useAiStatus),
      clothing: mergeStatusField(base.clothing, info.clothing, '', false),
      relations: currentRelations,
      relationshipMeters: mergedMeters,
      affection: mergedMeters,
      relationshipDeltas: filteredDeltas,
      inventory: mergeInventoryPartial(base.inventory, info._seen.inventory ? info.inventory : []),
      stats: mergeStatsPartial(base.stats, info.stats),
      quests: mergeQuestsPartial(base.quests, info.quests),
      narrativeLogs: ai.narrativeLogs.length ? ai.narrativeLogs : base.narrativeLogs,
      pokemonLogs: ai.narrativeLogs.length ? ai.narrativeLogs : base.narrativeLogs,
      hudComments: ai.hudComments.length ? ai.hudComments : [],
      _inferredStatus: useAiStatus,
      _seen: {
        relations: !!(base._seen?.relations || info._seen?.relations),
        inventory: !!(base._seen?.inventory || info._seen?.inventory),
        status: !!(base._seen?.status || info._seen?.status),
      },
    });

    return forcedUserName ? stripRoomUserFromData(merged, forcedUserName) : merged;
  }

  // ─────────────────────────────────────────────
  // Inventory
  // ─────────────────────────────────────────────
  function guessIcon(name) {
    const t = String(name || '');

    if (/스마트폰|휴대폰|핸드폰|폰|모바일|태블릿/.test(t)) return '📱';
    if (/열쇠|키|카드키/.test(t)) return '🔑';
    if (/문서|노트|책|파일|서류|기록/.test(t)) return '📖';
    if (/돈|크레딧|동전|지폐|골드|G\b|DP/.test(t)) return '💰';
    if (/약|치료|포션|붕대|주사/.test(t)) return '💊';
    if (/가방|배낭|파우치/.test(t)) return '🎒';
    if (/검|칼|총|무기|탄/.test(t)) return '⚔️';
    if (/지도|맵/.test(t)) return '🗺️';
    if (/반지|목걸이|귀걸이|보석/.test(t)) return '💍';
    if (/음식|도시락|빵|밥|물|음료/.test(t)) return '🍲';

    return '◇';
  }

  function normalizeIcon(icon, name) {
    const raw = String(icon || '').trim();
    if (!raw || raw === '◇' || raw === '◆' || raw === '?' || /^unknown$/i.test(raw)) {
      return guessIcon(name);
    }
    return raw;
  }

  function normalizeInventoryItem(raw) {
    if (!raw || typeof raw !== 'object') {
      const name = cleanOptionalValue(String(raw || '').replace(/^[▸>\-•*└]+\s*/, ''));
      return { name, icon: guessIcon(name), detail: '' };
    }

    const name = cleanOptionalValue(raw.name || raw.item || raw.title);
    const detail = cleanOptionalValue(raw.detail || raw.memo || raw.desc);
    return {
      name,
      icon: normalizeIcon(raw.icon, name),
      detail,
    };
  }

  function splitItems(text) {
    return normalize(text)
      .split(/\n|,|，|、|;|；|<|>/)
      .map(x => cleanOptionalValue(x.replace(/^[▸>\-•*└]+\s*/, '')))
      .filter(Boolean)
      .filter(x => !/^[-—]$/.test(x))
      .map(normalizeInventoryItem);
  }

  // ─────────────────────────────────────────────
  // INFO deterministic parser
  // ─────────────────────────────────────────────
  const SECTION_ALIASES = {
    관계: 'relations',
    관계도: 'relations',
    상태: 'status',
    상황: 'status',
    목표: 'status',
    가방: 'inventory',
    아이템: 'inventory',
    소지품: 'inventory',
    인벤토리: 'inventory',
    퀘스트: 'quests',
    임무: 'quests',
    의상: 'clothing',
    복장: 'clothing',
    위치: 'location',
    장소: 'location',
    능력: 'ignore',
    소속: 'ignore',
    개체: 'ignore',
    자산: 'ignore',
  };

  function normalizeSectionName(name) {
    const key = normalize(name).replace(/[《》\[\]【】]/g, '').split(/[｜|:：]/)[0].trim();
    return SECTION_ALIASES[key] || '';
  }

  function parseBracketLine(line) {
    const t = normalize(line);
    const m = t.match(/^[\[【](.+?)[\]】]$/);
    if (!m) return null;

    const inner = normalize(m[1]);
    const [rawLabel, ...rest] = inner.split(/[｜|]/);
    const label = normalize(rawLabel);
    const value = normalize(rest.join('｜'));

    return { label, value };
  }

  function bracketContent(bracket) {
    if (!bracket) return '';
    return normalize([bracket.label, bracket.value].filter(Boolean).join('｜'));
  }

  function parseHeaderLine(line, data) {
    const t = normalize(line);
    if (!/^〔.*〕$/.test(t)) return;

    const inner = t.replace(/^〔|〕$/g, '');
    const parts = inner.split('｜').map(x => normalize(x)).filter(Boolean);
    if (!parts.length) return;

    const datePart = parts.find(p => /\d{4}년|\d{1,2}월|\d{1,2}일/.test(p)) || '';
    const timePart = parts.find(p => /\d{1,2}:\d{2}/.test(p)) || '';
    const locationPart = [...parts].reverse().find(p =>
      !/^[▶▷]️?$/.test(p) &&
      !/^[☀🌙⭐⛅🌧❄️]+$/.test(p) &&
      !/\d{4}년|\d{1,2}월|\d{1,2}일|\d{1,2}:\d{2}/.test(p) &&
      !/^⌛/.test(p) &&
      !/^(봄|여름|가을|겨울|낮|밤|아침|저녁)$/.test(p)
    );

    if (datePart || timePart) data.time = cleanOptionalValue([datePart, timePart].filter(Boolean).join(' '));
    if (locationPart) data.location = cleanOptionalValue(locationPart);
  }

  function parseRelationLine(line, options = {}) {
    let raw = normalize(line)
      .replace(/^[▸>\-•*└]+\s*/, '')
      .trim();

    if (!raw || /^[-—]$/.test(raw)) return [];

    const out = [];

    if (options.inlineList) {
      const tokens = raw.split(/\s+/).map(x => x.trim()).filter(Boolean);
      const hasListSignal = tokens.some(token => EMOJI_RE.test(token) || /^#/.test(token));
      EMOJI_RE.lastIndex = 0;

      if (hasListSignal) {
        for (const token of tokens) {
          EMOJI_RE.lastIndex = 0;
          const hasAnyEmoji = EMOJI_RE.test(token);
          EMOJI_RE.lastIndex = 0;

          const moodEmoji = cleanMoodEmoji(token);
          const name = relationKey(token.replace(/^#/, ''));

          if (!hasAnyEmoji && !/^#/.test(token)) continue;
          if (!isValidRelationName(name)) continue;

          out.push({ name, moodEmoji, type: '관계', detail: '', value: '' });
        }

        if (out.length) return out;
      }
    }

    const sep = raw.match(/^(.{1,40})[｜|:：]\s*(.+)$/);
    if (sep) {
      const name = relationKey(sep[1]);
      const rest = normalize(sep[2]);
      if (!isValidRelationName(name)) return [];

      out.push({
        name,
        moodEmoji: cleanMoodEmoji(rest),
        type: '관계',
        detail: stripEmojis(rest).replace(/^[·ㆍ,，\s]+/, '').trim(),
        value: '',
      });
      return out;
    }

    return out;
  }

  function parseStatusLine(line, data) {
    const raw = normalize(line).replace(/^[▸>\-•*└]+\s*/, '');
    const sep = raw.match(/^(.{1,24})[｜|:：]\s*(.+)$/);
    if (!sep) return;

    const label = normalize(sep[1]);
    const value = cleanOptionalValue(sep[2]);
    if (!value) return;

    if (/목표/.test(label)) data.goal = value;
    else if (/상황/.test(label)) data.situation = value;
    else if (/위치|장소/.test(label)) data.location = value;
    else if (/의상|복장/.test(label)) data.clothing = value;
    else data.stats.push({ name: label, value });
  }

  function parseInfoDeterministic(infoText) {
    const data = makeEmptyData();
    data.possiblePlayerNames = extractPossiblePlayerNames(infoText);

    const lines = normalize(infoText).split('\n').map(x => x.trim()).filter(Boolean);
    let section = '';

    for (const line of lines) {
      if (!line || /^info$/i.test(line) || /^✧/.test(line)) continue;

      parseHeaderLine(line, data);

      const named = line.match(/^《(.+?)》\s*[ː:：]?\s*(.*)$/);
      if (named) {
        const sectionName = normalizeSectionName(named[1]);
        if (sectionName) {
          section = sectionName;
          data._seen[sectionName] = true;
          if (sectionName === 'status' && named[2]) parseStatusLine(named[2], data);
          continue;
        }

        if (!data.character && !SECTION_ALIASES[named[1]]) {
          data.character = cleanOptionalValue(named[1]);
          continue;
        }
      }

      const bracket = parseBracketLine(line);
      if (bracket) {
        const kind = normalizeSectionName(bracket.label);

        if (kind) {
          section = kind;
          if (kind in data._seen) data._seen[kind] = true;

          const hasInlineValue = !!cleanOptionalValue(bracket.value);

          if (kind === 'relations' && hasInlineValue) {
            data.relations.push(...parseRelationLine(bracket.value, { inlineList: true }));
          } else if (kind === 'inventory') {
            data._seen.inventory = true;
            if (hasInlineValue) data.inventory.push(...splitItems(bracket.value));
          } else if (kind === 'status') {
            data._seen.status = true;
            if (hasInlineValue) parseStatusLine(`${bracket.label}｜${bracket.value}`, data);
          } else if (kind === 'location') {
            data.location = cleanOptionalValue(bracket.value);
          } else if (kind === 'clothing') {
            data.clothing = cleanOptionalValue(bracket.value);
          } else if (kind === 'quests') {
            if (hasInlineValue) data.quests.push(bracket.value);
          }

          if (hasInlineValue && ['relations', 'inventory', 'status', 'location', 'clothing', 'quests', 'ignore'].includes(kind)) {
            section = '';
          }

          continue;
        }

        const content = bracketContent(bracket);

        if (section === 'relations') {
          data._seen.relations = true;
          data.relations.push(...parseRelationLine(content));
        } else if (section === 'inventory') {
          data._seen.inventory = true;
          data.inventory.push(...splitItems(content));
        } else if (section === 'status') {
          data._seen.status = true;
          parseStatusLine(content, data);
        } else if (section === 'quests') {
          const q = cleanOptionalValue(content.replace(/^[▸>\-•*└]+\s*/, ''));
          if (q) data.quests.push(q);
        }

        continue;
      }

      if (section === 'relations') {
        data._seen.relations = true;
        data.relations.push(...parseRelationLine(line));
      } else if (section === 'inventory') {
        data._seen.inventory = true;
        data.inventory.push(...splitItems(line));
      } else if (section === 'status') {
        data._seen.status = true;
        parseStatusLine(line, data);
      } else if (section === 'quests') {
        const q = cleanOptionalValue(line.replace(/^[▸>\-•*└]+\s*/, ''));
        if (q) data.quests.push(q);
      }
    }

    if (!data.character && data.possiblePlayerNames.length) {
      data.character = data.possiblePlayerNames[0];
    }

    const relMap = new Map();
    for (const rel of data.relations) {
      const r = normalizeRelation(rel);
      const key = relationKey(r.name);
      if (!isValidRelationName(key)) continue;
      const old = relMap.get(key);
      relMap.set(key, {
        ...(old || {}),
        name: r.name,
        moodEmoji: r.moodEmoji || old?.moodEmoji || '',
        type: '관계',
        detail: r.detail || old?.detail || '',
        value: r.value || old?.value || '',
      });
    }
    data.relations = Array.from(relMap.values());

    const itemMap = new Map();
    for (const item of data.inventory) {
      const it = normalizeInventoryItem(item);
      if (!it.name) continue;
      itemMap.set(it.name, {
        ...it,
        icon: normalizeIcon(it.icon, it.name),
      });
    }
    data.inventory = Array.from(itemMap.values());

    return sanitizeData(data);
  }

  function stripUiLines(rawText) {
    return normalize(rawText)
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
      // 크랙 UI 버튼
      .filter(line => !/^답변\s*비교\s*\d+\s*\/\s*\d+$/i.test(line))
      .filter(line => !/^(믹스|리롤|다시 생성|보내기|복사|수정|삭제)$/i.test(line))
      // 유니챗 UI 버튼/메타 텍스트
      .filter(line => !/^\d+\s*\/\s*\d+$/.test(line))
      .filter(line => !/^(선택됨|다시\s*생성|생성|전송|복사|수정|삭제|북마크|공유|신고)$/.test(line))
      .join('\n');
  }

  function scoreInfoLikeBlock(text) {
    const t = normalize(text);
    if (!t) return 0;

    let score = 0;
    const lines = t.split('\n').map(x => x.trim()).filter(Boolean);
    const bracketLines = lines.filter(line => /^[\[【《〔「].*[\]】》〕」]$/.test(line)).length;
    const sepLines = lines.filter(line => /[｜|:：]|\s[-–—]\s/.test(line)).length;
    const bulletLines = lines.filter(line => /^[▸>\-•*└◆■●☆▶#]/.test(line)).length;
    const tableLines = lines.filter(line => /^\|.*\|$/.test(line) || /\|\s*[-:]+\s*\|/.test(line)).length;
    const dividerLines = lines.filter(line => /^(?:[-─━=]{3,}|[◆■●☆▶]{2,})$/.test(line.replace(/\s+/g, ''))).length;

    const relationLines = lines.filter(line => /(관계|인연|감정선|호감도|호감|유대|동료|적|주변\s*인물|NPC|등장\s*인물|연인|대상)/i.test(line)).length;
    const inventoryLines = lines.filter(line => /(가방|소지품|소지|보유|장비|인벤토리|아이템|지갑|주머니|착용|무기)/i.test(line)).length;
    const statusLines = lines.filter(line => /(시간|날짜|장소|위치|현황|상황|장면|목표|목적|복장|의상|상태|HP|MP|스탯|체력|기분)/i.test(line)).length;
    const valueLines = lines.filter(line => /[｜|:：]|\s[-–—]\s|\d+\s*%|[■□▰▱▮▯]{2,}|HP\s*\d|MP\s*\d/i.test(line)).length;
    const compactRelationList = lines.filter(line => {
      const tokens = line.split(/\s+/).filter(Boolean);
      if (tokens.length < 2) return false;
      return tokens.filter(token => /^#?[가-힣A-Za-z0-9_]{1,16}[\p{Emoji_Presentation}\p{Extended_Pictographic}]?$/u.test(token)).length >= 2
        && /[\p{Emoji_Presentation}\p{Extended_Pictographic}#]/u.test(line);
    }).length;

    if (bracketLines >= 2) score += 1;
    if (sepLines >= 2) score += 2;
    if (bulletLines >= 2) score += 1;
    if (tableLines >= 1) score += 2;
    if (dividerLines >= 1) score += 1;
    if (relationLines) score += Math.min(4, relationLines * 2);
    if (inventoryLines) score += Math.min(4, inventoryLines * 2);
    if (statusLines) score += Math.min(5, statusLines * 2);
    if (valueLines >= 2) score += 2;
    if (compactRelationList) score += 3;
    if (lines.length >= 3 && lines.length <= 100) score += 1;
    if (/^(info|정보|인포)$/i.test(t)) score = 0;

    return score;
  }

  function extractFencedInfoBlock(text) {
    const src = String(text || '');
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    const candidates = [];
    let match;

    while ((match = re.exec(src))) {
      const label = normalize(match[1] || '');
      const body = normalize(match[2] || '');
      if (!body) continue;

      const labelledInfo = /^(info|정보|인포|status|hud)\b/i.test(label);
      const score = scoreInfoLikeBlock(body);

      if (labelledInfo || score >= 4) {
        candidates.push({
          start: match.index,
          end: re.lastIndex,
          info: body,
          score: score + (labelledInfo ? 10 : 0),
        });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score || a.start - b.start);
    return candidates[candidates.length - 1];
  }

  function extractLooseInfoBlock(text) {
    const lines = normalize(text).split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) return null;

    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^(info|정보|인포)$/i.test(lines[i])) {
        const info = normalize(lines.slice(i + 1).join('\n'));
        if (scoreInfoLikeBlock(info) >= 2) {
          return {
            lineStart: i,
            info,
          };
        }
      }
    }

    for (let i = Math.max(0, lines.length - 90); i < lines.length; i++) {
      const block = normalize(lines.slice(i).join('\n'));
      const score = scoreInfoLikeBlock(block);
      if (score >= 6 && block.length <= 6000) {
        return {
          lineStart: i,
          info: block,
        };
      }
    }

    return null;
  }

  function splitReplyAndInfo(rawText) {
    const text = stripUiLines(rawText);

    const fenced = extractFencedInfoBlock(text);
    if (fenced) {
      return {
        reply: normalize((text.slice(0, fenced.start) + '\n' + text.slice(fenced.end)).trim()),
        info: fenced.info,
      };
    }

    const loose = extractLooseInfoBlock(text);
    if (loose) {
      const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
      return {
        reply: normalize(lines.slice(0, loose.lineStart).join('\n')),
        info: loose.info,
      };
    }

    return {
      reply: normalize(text),
      info: '',
    };
  }

  // ─────────────────────────────────────────────
  // Latest message collection (유니챗 전용)
  // ─────────────────────────────────────────────

  // 유니챗 메시지 selector: id="msg-..." + viewer-content 클래스
  const UNICHAT_MSG_SELECTOR = '[id^="msg-"]';

  function isOwnNode(el) {
    return !!el?.closest?.(`#${PANEL_ID}, #${FAB_ID}, #${POPUP_ID}, #${COMMENT_POPUP_ID}, #${SETTINGS_ID}, #${MASCOT_ID}`);
  }

  // 유니챗 채팅방 경로: /play/:uuid
  function isEpisodePath(pathname = location.pathname) {
    return /\/play\/[^/?#]+/.test(pathname);
  }

  function isVisibleRect(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
  }

  // 유니챗 스크롤 컨테이너
  function findCrackMessageScope() {
    return document.querySelector('.flex-1.overflow-y-auto')
      || document.querySelector('[class*="overflow-y-auto"]')
      || document.body;
  }

  // 유니챗 메시지 element에서 텍스트 추출
  // details 태그(INFO 블록)는 별도 보존, 나머지 UI 요소 제거
  function getUniChatMsgText(msgEl, options = {}) {
    if (!(msgEl instanceof HTMLElement) || isOwnNode(msgEl)) return '';

    const clone = msgEl.cloneNode(true);

    // HUD 자체 노드 제거
    clone.querySelectorAll('[id^="cigh-clean-"], [class*="cigh-clean-"], script, style, button, [role="button"], svg, textarea, input, select').forEach(el => el.remove());

    return normalize(clone.innerText || clone.textContent || '');
  }

  // 유니챗 details 태그에서 INFO 블록 텍스트만 추출
  function getUniChatInfoText(msgEl) {
    if (!(msgEl instanceof HTMLElement)) return '';
    const details = Array.from(msgEl.querySelectorAll('details'));
    if (!details.length) return '';
    return details.map(d => {
      const clone = d.cloneNode(true);
      // summary 태그는 간단한 이모지 라벨이므로 포함
      return normalize(clone.innerText || clone.textContent || '');
    }).join('\n');
  }

  // 유니챗 details를 제외한 본문 텍스트
  function getUniChatBodyText(msgEl) {
    if (!(msgEl instanceof HTMLElement)) return '';
    const clone = msgEl.cloneNode(true);
    clone.querySelectorAll('[id^="cigh-clean-"], [class*="cigh-clean-"], script, style, button, [role="button"], svg, textarea, input, select, details').forEach(el => el.remove());
    return normalize(clone.innerText || clone.textContent || '');
  }

  function getLatestCrackLogEntries(options = {}) {
    if (!isEpisodePath()) return [];

    const msgEls = Array.from(document.querySelectorAll(UNICHAT_MSG_SELECTOR));
    if (!msgEls.length) return [];

    return msgEls.map((msgEl, domIndex) => {
      if (!(msgEl instanceof HTMLElement) || isOwnNode(msgEl)) return null;
      if (msgEl.closest('[role="dialog"]')) return null;

      // 전체 텍스트 (body + details 포함)
      const text = getUniChatMsgText(msgEl);
      if (text.length < 2) return null;

      // DOM 순서 기반 sort key
      const key = {
        domIndex,
        id: msgEl.id || '',
        top: msgEl.getBoundingClientRect?.()?.top || 0,
      };

      return { group: msgEl, text, key };
    }).filter(Boolean).sort((a, b) => a.key.domIndex - b.key.domIndex);
  }

  function getLatestCrackLogEntry(options = {}) {
    const entries = getLatestCrackLogEntries(options);
    return entries.length ? entries[entries.length - 1] : null;
  }

  function getLatestCrackLogText(options = {}) {
    return getLatestCrackLogEntry(options)?.text || '';
  }

  function getMessageDomKey(el) {
    if (!(el instanceof Element)) return '';
    const msgEl = el.matches?.(UNICHAT_MSG_SELECTOR) ? el : el.closest?.(UNICHAT_MSG_SELECTOR);
    if (!msgEl) return '';
    const id = String(msgEl.id || '').trim();
    return id ? `dom:uid:${id}` : '';
  }

  function makeMessageKey(text, el = null) {
    const t = normalize(text);
    const textKey = `${t.length}:${hashTiny(t)}:${t.slice(-80)}`;
    const domKey = getMessageDomKey(el);
    return domKey ? `${domKey}|${textKey}` : textKey;
  }

  function makeContentKey(reply, info = '') {
    const t = normalize(`${reply}\n${info}`);
    return `${t.length}:${hashTiny(t)}:${t.slice(-80)}`;
  }

  function findLatestContext() {
    const entries = getLatestCrackLogEntries();
    const picked = entries[entries.length - 1];
    if (!picked) return null;

    const msgEl = picked.group;

    // 유니챗: details 태그 = INFO 블록, 나머지 = 본문
    const infoText = getUniChatInfoText(msgEl);
    const reply = getUniChatBodyText(msgEl);

    if (reply.length < 10 && !infoText) return null;

    const pickedIndex = entries.indexOf(picked);
    const context = entries
      .slice(Math.max(0, pickedIndex - 3), pickedIndex)
      .map(entry => getUniChatBodyText(entry.group))
      .filter(Boolean)
      .join('\n\n---\n\n')
      .slice(-3600);

    const raw = picked.text;

    return {
      latestReply: reply,
      infoText,
      context,
      key: makeMessageKey(raw, msgEl),
      contentKey: makeContentKey(reply, infoText),
      raw,
    };
  }

  // ─────────────────────────────────────────────
  // Gemini
  // ─────────────────────────────────────────────
  const GEMINI_PROMPT = `너는 유니챗 AI 캐릭터 채팅용 작은 게임 HUD의 INFO 정규화 파서이자 로그 연출가다.
최신 답변과 RAW_INFO_BLOCK을 보고 JSON만 반환한다. 마크다운, 백틱, 설명문 금지.

출력 JSON:
{
  "infoFound": false,
  "inferredPlayerName": "",
  "character": {"name":"","role":"","sourceText":""},
  "status": {"time":"","location":"","situation":"","goal":"","clothing":"","sourceText":""},
  "relations": [{"name":"","detail":"","sourceText":""}],
  "inventory": [{"name":"","detail":"","sourceText":""}],
  "inferredStatus": {"character":"","location":"","situation":"","goal":""},
  "narrativeLogs": ["", ""],
  "relationshipDeltas": [{"name":"","delta":0,"label":"관계","memo":"이번 변화 근거"}],
  "hudComments": ["", "", ""],
  "petLine": ""
}

LOG 문체 지침:
{{STYLE_PROMPT}}

INFO 정규화 규칙:
- INFO 판별은 코드블록 여부나 라벨(INFO/정보/인포)로 하지 않는다. 형식이 아니라 내용으로 판단한다.
- 인물/관계, 소지품, 상태/목표/위치/시간 같은 "캐릭터·장면의 상태 정보"를 정리해 나열한 블록이면, 표·괄호·구분선·불릿·키:값 등 형식이 무엇이든 infoFound=true.
- 단순 서술/대사/내레이션만 있고 상태 정리가 아니면 infoFound=false.
- RAW_INFO_BLOCK이 비었으면 infoFound=false.
- 형식은 방마다 다르다. 구획 표시(【】 《》 [] 〔〕 「」, ▶ ◆ ■ ● ☆, ━━ ── === 구분선, # 머리말, 굵게 표시 등), 항목 표시(키: 값, 키｜값, 키 - 값, 표, 불릿, 줄바꿈 나열 등), 값 표시(텍스트, 숫자, %, 게이지, HP/스탯, 이모지 상태표시 등)를 모두 같은 정보 형식으로 읽는다.
- 라벨 이름을 외우지 말고 뜻으로 분류한다.
- relations(관계): 다른 인물에 대한 정보. 라벨 예: 관계/인연/감정선/호감도/유대/동료/적/주변인물/NPC/등장인물/연인. 인물명 + 관계·감정·호감 서술이면 넣는다.
- inventory(소지품): 실제로 지니거나 보유한 물건. 라벨 예: 가방/소지품/보유/장비/인벤토리/아이템/지갑/주머니.
- status(상태): 장면이나 본인의 현재 상태. time/location/situation/goal/clothing으로 정리한다. 라벨 예: 시간/날짜/장소/위치/현황/상황/장면/목표/목적/복장/의상.
- character: 시점 인물(주인공/플레이어 캐릭터)의 이름·신분. 칭호나 소속 같은 짧은 수식은 role에 넣어도 된다.
- 어느 칸에 넣을지 애매하면 relations에 억지로 넣지 않는다. 인물 정보가 확실할 때만 relations.
- 값이 숫자·%·게이지여도 새로 지어내지 말고 있는 그대로 detail 또는 해당 필드에 보존한다.
- 원문에 없는 항목은 만들지 않는다. character/status/relations/inventory의 모든 항목에는 sourceText에 근거 원문 한 줄을 넣고, sourceText가 없으면 그 항목을 만들지 않는다.
- 관계 인물은 반드시 한 명씩 분리한다. 한 줄에 여러 명이면 각각 별도 relation으로 나눈다.
- 예: "박뤼붕☀ #김뤼붕☀ 이뤼붕🙂 최뤼붕🙂" → 박뤼붕 / 김뤼붕 / 이뤼붕 / 최뤼붕 4명으로 분리한다.
- 여러 이름을 합쳐 하나의 name으로 만들지 않는다.
- 사람(또는 의인화된 개체) 이름만 relations에 넣는다. 장소명/소속명/능력명/아이템명/상태값은 relations에 넣지 않는다.
- INFO가 없거나 비어 있어도 inferredStatus에는 최신 답변에서 추론 가능한 character/location/situation/goal을 짧게 넣는다.
- inferredStatus는 추론 표시용이다. relations/inventory 생성 근거로 쓰지 않는다.
- infoFound=false면 relations/inventory는 반드시 비운다.

관계도 delta 규칙:
- relationshipDeltas는 하트 미터를 누적 변화시키는 용도다. value/percent를 새로 만들지 말고 delta만 작성한다.
- relationshipDeltas.name은 반드시 relations에 있는 name 중 하나만 사용한다.
- relations에 없는 이름은 relationshipDeltas에 넣지 않는다.
- 최신 답변에서 relations의 인물이 직접 등장하거나, 그 인물의 대사/행동/감정/관계 반응이 보이면 가능한 한 delta를 작성한다.
- 아주 작은 호감/흥미/안심/부드러움은 +1~+2.
- 설렘/포옹/키스/고백/구원/강한 집착/큰 감정 동요는 +3~+8.
- 거절/불신/두려움/위협/상처/갈등은 -1~-8.
- 변화가 애매하지만 장면에 직접 관련된 인물이라면 0 대신 +1, -1, +2, -2 같은 작은 delta를 우선 고려한다.
- 정말로 해당 인물이 최신 장면과 무관하거나 근거가 전혀 없을 때만 비운다.
- 모든 인물에게 억지로 delta를 주지 말고, 최신 장면과 관련 있는 1~4명만 고른다.
- CURRENT_METERS의 기존 value가 52처럼 고정되어 보여도, 이번 장면의 감정 변화가 있으면 반드시 0이 아닌 delta를 준다.
- delta는 -12~8 사이 정수만 사용한다.

LOG 규칙:
- narrativeLogs는 최신 답변을 포켓몬/고전 RPG식으로 3~7줄 작성한다.
- 각 줄은 ▶ 또는 ▷로 시작한다.
- 원문 복사가 아니라 사건을 게임 로그처럼 재해석한다.
- possiblePlayerNames는 사용자/PC 후보일 뿐이다. 가장 그럴듯한 이름을 inferredPlayerName에 적되, 확실하지 않으면 빈 문자열로 둔다.

HUD 코멘트:
- hudComments는 2~3개 작성한다.
- HUD가 옆에서 과몰입하며 주접떠는 느낌으로 짧게 쓴다.
- 장면 감정에 맞춰 설렘/긴장/충격/귀여움/위험 신호를 반응하되, 매번 같은 템플릿처럼 쓰지 않는다.
- 너무 길게 설명하지 말고, 한 줄당 18~34자 정도로 톡 쏘게 쓴다.
- 말투는 게임 HUD + 옆자리 오타쿠 해설자 느낌이다.
- RECENT_HUD_COMMENTS와 같거나 비슷한 문장은 피한다.
- "심장 게이지", "치명타", "숨 참고 봄", "전투 BGM" 같은 고정 멘트를 반복하지 않는다.
- 2~3개 중 최소 1개는 최신 답변의 구체 행동/대사/사물/감정어를 반영한다.
- 예시는 톤 참고용이며 그대로 복사하지 않는다. 장면마다 새 문장을 만든다.

펫 대사(petLine):
- petLine은 다마고치 펫이 주인에게 거는 한마디다.
- 최신 장면을 본 펫의 반응을 20자 이내, 반말, 귀여운 말투로 쓴다.
- PET_CONTEXT의 성향(♥애정/⚔시련/☺평화)과 단계, 장면 감정에 맞춰 말투를 바꾼다.
- HUD 코멘트와 달리 펫이 직접 말하는 1인칭이다.
- 예: 두근두근... 나 어떡해
- 예: 으, 무서워... 붙어있을래
- 예: 헤헤 평화롭다

RECENT_HUD_COMMENTS:
{{RECENT_HUD_COMMENTS}}

PET_CONTEXT:
{{PET_CONTEXT}}

POSSIBLE_PLAYER_NAMES:
{{POSSIBLE_PLAYER_NAMES}}

CURRENT_METERS:
{{CURRENT_METERS}}

주의:
- CURRENT_METERS는 이전 누적값이다.
- 이번 응답에서는 CURRENT_METERS를 그대로 반복하지 말고, 최신 답변으로 인해 변한 만큼만 relationshipDeltas에 적는다.

RAW_INFO_BLOCK:
{{RAW_INFO_BLOCK}}

LATEST_REPLY:
{{LATEST_REPLY}}

RECENT_CONTEXT:
{{RECENT_CONTEXT}}
`;

  function stripJsonFence(raw) {
    return String(raw || '').trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  function parseGeminiJson(raw) {
    const text = stripJsonFence(raw);
    try {
      return JSON.parse(text);
    } catch (err) {
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first >= 0 && last > first) {
        try {
          return JSON.parse(text.slice(first, last + 1));
        } catch (_) {}
      }
      throw err instanceof Error ? err : new Error('JSON parse failed');
    }
  }

  const GEMINI_LAST_RAW_STORE = 'cigh_clean_last_gemini_raw_v1';

  function saveLastGeminiRaw(raw, meta = {}) {
    try {
      localStorage.setItem(GEMINI_LAST_RAW_STORE, JSON.stringify({
        at: Date.now(),
        version: VERSION,
        meta,
        raw: String(raw || '').slice(0, 16000),
      }));
    } catch (_) {}
  }

  function buildGeminiJsonRepairPrompt(brokenJson) {
    return `아래 텍스트는 JSON 문법이 깨진 응답이다.
내용을 새로 쓰거나 요약하지 말고, 문법만 고쳐서 유효한 JSON 객체 하나만 출력해라.
설명, 마크다운, 코드블록 금지. JSON 외의 글자 금지.
누락된 쉼표/괄호/따옴표만 보정하고, 확실하지 않은 깨진 마지막 항목은 안전하게 제거해도 된다.

BROKEN_JSON:
\${String(brokenJson || '').slice(0, 14000)}`;
  }

  function buildGeminiJsonRepairGenerationConfig(model) {
    const normalized = normalizeGeminiModelId(model);
    const config = {
      temperature: 0,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    };
    // 2.5 Flash 계열은 thinking을 꺼서 형식 안정성 우선
    if (normalized === 'gemini-2.5-flash' || normalized === 'gemini-2.5-flash-lite') {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
    return config;
  }

  async function repairGeminiJsonResponse(geminiRequest, rawText, parseError) {
    saveLastGeminiRaw(rawText, {
      phase: 'parse_failed_before_repair',
      message: String(parseError?.message || parseError || ''),
    });

    const repairPayload = {
      contents: [{ role: 'user', parts: [{ text: buildGeminiJsonRepairPrompt(rawText) }] }],
      generationConfig: buildGeminiJsonRepairGenerationConfig(geminiRequest.model),
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    const repairBody = await requestGeminiGenerateContent(geminiRequest, repairPayload);
    const repairUsageTokens = extractUsageTokens(repairBody);
    if (repairUsageTokens) addUsage(geminiRequest.model, repairUsageTokens.input, repairUsageTokens.output);

    const repairText = extractTextFromGeminiResponseData(repairBody);
    if (!repairText) throw new Error(`JSON 복구 실패: \${repairBody?.candidates?.[0]?.finishReason || 'EMPTY'}`);

    try {
      const parsed = parseGeminiJson(repairText);
      saveLastGeminiRaw(repairText, { phase: 'repair_success' });
      return parsed;
    } catch (repairErr) {
      saveLastGeminiRaw(repairText, {
        phase: 'repair_failed',
        originalError: String(parseError?.message || parseError || ''),
        repairError: String(repairErr?.message || repairErr || ''),
      });
      throw new Error(`JSON 파싱 실패: \${String(parseError?.message || parseError || '응답 JSON이 깨졌어요.')}`);
    }
  }

  async function callGemini(latestReply, context, rawInfoBlock, fallbackInfoData, beforeData) {
    try {
      const geminiRequest = getGeminiGenerateContentRequestConfig();
      if (!geminiRequest) throw new Error('Gemini/Firebase 설정을 찾지 못했어요.');

      const currentMeters = (beforeData?.affection || beforeData?.relationshipMeters || [])
        .map(m => normalizeMeter(m, 50))
        .filter(m => isValidRelationName(m.name))
        .map(m => ({ name: m.name, value: m.value, label: m.label, memo: m.memo }));

      const possiblePlayerNames = [
        ...new Set([
          ...(fallbackInfoData?.possiblePlayerNames || []),
          ...extractPossiblePlayerNames(rawInfoBlock || ''),
          ...extractPossiblePlayerNames(latestReply || ''),
        ])
      ].filter(isPossiblePlayerName).slice(0, 8);

      const petNow = getPet(getRoom());
      const petContext = JSON.stringify({
        성향: PET_TENDENCY_LABEL[petNow.finalType] || PET_TENDENCY_LABEL.peace,
        단계: petStageFromLevel(petNow.level).name,
        기분: petNow.mood,
        레벨: petNow.level,
      });

      const recentHudComments = getRecentHudCommentTexts(18);

      const prompt = GEMINI_PROMPT
        .replace('{{STYLE_PROMPT}}', getStylePrompt().slice(0, 1800))
        .replace('{{RECENT_HUD_COMMENTS}}', JSON.stringify(recentHudComments).slice(0, 1200))
        .replace('{{PET_CONTEXT}}', petContext.slice(0, 400))
        .replace('{{POSSIBLE_PLAYER_NAMES}}', JSON.stringify(possiblePlayerNames).slice(0, 1200))
        .replace('{{CURRENT_METERS}}', JSON.stringify(currentMeters).slice(0, 2400))
        .replace('{{RAW_INFO_BLOCK}}', String(rawInfoBlock || '').slice(-9000))
        .replace('{{LATEST_REPLY}}', latestReply.slice(-12000))
        .replace('{{RECENT_CONTEXT}}', context.slice(-3600));

      const payload = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: buildGeminiGenerationConfig(geminiRequest.model, {
          temperature: 0.62,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        }),
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      };

      const body = await requestGeminiGenerateContent(geminiRequest, payload);
      trackGeminiUsage(geminiRequest.model, body);
      const rawText = extractTextFromGeminiResponseData(body);
      if (!rawText) throw new Error(body?.candidates?.[0]?.finishReason || 'EMPTY');

      let parsedRaw;
      try {
        parsedRaw = parseGeminiJson(rawText);
      } catch (parseErr) {
        console.warn('[UniChat INFO Game HUD] Gemini JSON parse failed. Trying one-shot repair.', parseErr);
        parsedRaw = await repairGeminiJsonResponse(geminiRequest, rawText, parseErr);
      }
      const parsed = sanitizeAi(parsedRaw);
      parsed._usageTokens = extractUsageTokens(body) || null;
      return parsed;
    } catch (err) {
      const message = String(err?.message || err || '알 수 없는 오류').replace(/\s+/g, ' ').trim();
      console.warn('[UniChat INFO Game HUD] Gemini/Firebase call failed:', err);
      throw new Error(`Gemini/Firebase 호출 실패: ${message || '응답을 읽지 못했어요.'}`);
    }
  }

  function sanitizeAi(raw) {
    const d = makeEmptyData();
    const infoFound = !!raw?.infoFound;

    d._fromGeminiInfo = true;
    d._infoFound = infoFound;

    d.narrativeLogs = Array.isArray(raw?.narrativeLogs)
      ? raw.narrativeLogs.map(normalizeGameLine).filter(Boolean).slice(0, 8)
      : [];

    d.inferredPlayerName = isPossiblePlayerName(raw?.inferredPlayerName) ? relationKey(raw.inferredPlayerName) : '';

    if (infoFound) {
      const character = raw?.character || {};
      const status = raw?.status || {};

      if (hasSourceText(character)) {
        d.character = cleanOptionalValue(character.name);
        if (character.role) d.stats.push({ name: 'ROLE', value: cleanOptionalValue(character.role) });
      }

      if (hasSourceText(status)) {
        d.time = cleanOptionalValue(status.time);
        d.location = cleanOptionalValue(status.location);
        d.situation = cleanOptionalValue(status.situation);
        d.goal = cleanOptionalValue(status.goal);
        d.clothing = cleanOptionalValue(status.clothing);
        d._seen.status = !!(d.time || d.location || d.situation || d.goal || d.clothing);
      }

      d.relations = Array.isArray(raw?.relations)
        ? raw.relations
            .filter(hasSourceText)
            .map(r => normalizeRelation({
              name: r.name,
              detail: r.detail,
              moodEmoji: r.moodEmoji,
              type: '관계',
            }))
            .filter(r => isValidRelationName(r.name))
            .slice(0, 16)
        : [];

      d.inventory = Array.isArray(raw?.inventory)
        ? raw.inventory
            .filter(hasSourceText)
            .map(item => normalizeInventoryItem({
              name: item.name,
              detail: item.detail,
              icon: item.icon,
            }))
            .filter(item => item.name)
            .slice(0, 24)
        : [];

      d._seen.relations = d.relations.length > 0;
      d._seen.inventory = d.inventory.length > 0;
    }

    const inferred = raw?.inferredStatus || {};
    if (!infoFound) {
      d.character = cleanOptionalValue(inferred.character || d.inferredPlayerName);
      d.location = cleanOptionalValue(inferred.location);
      d.situation = cleanOptionalValue(inferred.situation);
      d.goal = cleanOptionalValue(inferred.goal);
      d._inferredStatus = !!(d.character || d.location || d.situation || d.goal);
    }

    d.relationshipDeltas = Array.isArray(raw?.relationshipDeltas)
      ? raw.relationshipDeltas.map(normalizeDelta).filter(Boolean).slice(0, 12)
      : [];

    d.relationshipMeters = [];
    d.affection = [];

    d.hudComments = Array.isArray(raw?.hudComments)
      ? raw.hudComments.map(x => shortText(x, 42)).filter(Boolean).slice(0, 3)
      : [];
    d.petLine = shortText(raw?.petLine, 40);

    return sanitizeData(d);
  }

  function getRecentHudCommentTexts(limit = 18) {
    const room = getRoom();
    const fromLog = (room.commentLog || []).map(c => c?.text || c);
    const fromHistory = (room.history || []).slice(-12).flatMap(h => Array.isArray(h?.comments) ? h.comments : []);
    return [...fromLog, ...fromHistory].map(x => shortText(x, 42)).filter(Boolean).slice(-limit);
  }

  function hudCommentKey(value) {
    return normalize(value).replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 30);
  }

  function pickHudComments(pool, text, limit = 3) {
    const recent = new Set(getRecentHudCommentTexts(18).map(hudCommentKey).filter(Boolean));
    const seed = parseInt(hashTiny(`${text}:${Date.now()}`), 36) || 0;
    const out = [];

    for (let pass = 0; pass < 2 && out.length < limit; pass++) {
      for (let i = 0; i < pool.length && out.length < limit; i++) {
        const line = pool[(seed + i) % pool.length];
        const key = hudCommentKey(line);
        if (!key || out.some(x => hudCommentKey(x) === key)) continue;
        if (pass === 0 && recent.has(key)) continue;
        out.push(line);
      }
    }

    return out.slice(0, limit);
  }

  function makeFallbackHudComments(text) {
    const t = normalize(text);
    let pool;

    if (/고백|좋아해|사랑|키스|입맞|포옹|안아|끌어안|설렘|두근|심장/.test(t)) {
      pool = [
        '방금 감정선 너무 가까운데?', '이건 호감도 창 흔들렸다.', '대사 온도 갑자기 올라감.',
        '지금 거리감 위험 수치임.', '아니 분위기 왜 이렇게 진해?', 'HUD도 괜히 눈치 봄.',
        '이 장면 로맨스 경보 떴다.', '방금 말투 완전 반칙임.', '둘 사이 공기 바뀌었다.',
      ];
    } else if (/눈물|울|흐느|상처|아파|버림|외로|무너|슬픔|비참/.test(t)) {
      pool = [
        '아니 마음에 금 갔는데?', '이건 멘탈 방어 실패다.', '장면 온도가 너무 차다.',
        'HUD도 조용히 숙연해짐.', '상처 로그가 깊게 찍힘.', '방금 감정 데미지 큼.',
        '이건 회복 이벤트 필요함.', '공기부터 축축해졌다.', '마음 한쪽이 푹 꺼짐.',
      ];
    } else if (/분노|화났|소리|외쳤|위협|죽|피|공포|두려|긴장|위험/.test(t)) {
      pool = [
        '위험 수치가 훅 뛰었다.', '지금 선택지 잘못 누르면 큰일.', '공기가 바로 살벌해짐.',
        'HUD 경고등 깜빡이는 중.', '방금 장면 압박감 뭐임.', '긴장 게이지가 꽉 찼다.',
        '이건 안전거리 필요함.', '상황판 빨간불 들어옴.', '말 한마디가 날카롭다.',
      ];
    } else if (/웃|미소|다정|부드럽|귀엽|장난|간질|놀리|안심/.test(t)) {
      pool = [
        '아니 이건 좀 귀엽다.', '공기가 말랑해졌다.', '방금 분위기 너무 순함.',
        'HUD 입꼬리 관리 실패.', '이 장면 힐링 수치 높다.', '장난기가 귀엽게 튀었다.',
        '말투가 꽤 부드러운데?', '잠깐 평화 이벤트 떴다.', '긴장이 살짝 녹았다.',
      ];
    } else {
      pool = [
        '장면이 조용히 방향 튼다.', '다음 선택지 냄새 난다.', 'HUD가 일단 표시해둠.',
        '상황이 한 칸 진행됐다.', '이 흐름 기억해둬야 함.', '분위기가 미묘하게 움직임.',
        '로그에 변화 감지됨.', '다음 대사가 중요해 보임.', '판이 살짝 깔렸다.',
      ];
    }

    return pickHudComments(pool, t);
  }

  function diversifyHudComments(comments, latestReply) {
    const recent = new Set(getRecentHudCommentTexts(18).map(hudCommentKey).filter(Boolean));
    const out = [];

    for (const raw of Array.isArray(comments) ? comments : []) {
      const line = shortText(raw, 42);
      const key = hudCommentKey(line);
      if (!line || !key || recent.has(key) || out.some(x => hudCommentKey(x) === key)) continue;
      out.push(line);
      if (out.length >= 3) break;
    }

    for (const line of makeFallbackHudComments(latestReply)) {
      if (out.length >= 3) break;
      const key = hudCommentKey(line);
      if (!key || out.some(x => hudCommentKey(x) === key)) continue;
      out.push(line);
    }

    return out.slice(0, 3);
  }

  function fallbackAi(latestReply) {
    const d = makeEmptyData();
    const text = normalize(latestReply);

    const logs = [];
    if (/다가|가까|붙잡|안아|기댔|바라|시선/.test(text)) logs.push('▶거리감이 한 칸 줄었다!');
    if (/말했|속삭|대답|물었|외쳤|요구|부탁/.test(text)) logs.push('▶대화 이벤트가 발생했다!');
    if (/거절|피했|물러|침묵|망설/.test(text)) logs.push('▷상대는 바로 넘어오지 않았다!');
    if (/흔들|떨|당황|불안|긴장/.test(text)) logs.push('▷분위기가 살짝 흔들렸다!');
    if (/웃|미소|안심|다정|부드럽/.test(text)) logs.push('▷긴장이 조금 풀린 것 같다!');
    if (!logs.length) logs.push('▶장면이 조용히 움직였다!', '▷다음 선택지가 반짝인다!');

    d.narrativeLogs = logs.slice(0, 5);
    d.situation = shortText(text.split('\n').find(Boolean) || '장면이 진행 중이다.', 80);
    d._inferredStatus = true;
    d.hudComments = makeFallbackHudComments(text);
    return sanitizeData(d);
  }

  function normalizeGameLine(line) {
    let text = normalize(fixParticlePlaceholders(line));
    if (!text) return '';
    text = text.replace(/^[▸>\-•*└]+\s*/, '');
    if (!/^[▶▷◇]/.test(text)) text = `▶${text}`;
    return shortText(text, 86);
  }

  // ─────────────────────────────────────────────
  // Analysis
  // ─────────────────────────────────────────────
  async function analyzeLatest(force = false) {
    if (analyzeBusy) return;
    analyzeBusy = true;
    playBeep('analyze');
    mascotAnimAnalyzing();

    try {
      const found = findLatestContext();

      if (!found) {
        pushLog(['▶읽을 채팅을 찾지 못했다!']);
        showPopup(['▶읽을 채팅을 찾지 못했다!']);
        return;
      }

      const room = getRoom();
      const previousPetLastFedAt = Number(getPet(room).lastFedAt || 0);

      const analyzedContentKeys = Array.isArray(room.analyzedContentKeys) ? room.analyzedContentKeys : [];
      const alreadyAnalyzed = room.lastAnalyzedKey === found.key ||
        room.lastAnalyzedContentKey === found.contentKey ||
        analyzedContentKeys.includes(found.contentKey);

      if (!force && alreadyAnalyzed) {
        pushLog(['▷이미 읽은 로그다!']);
        showPopup(['▷이미 읽은 로그다!']);
        return;
      }

      lastDebugPayload = {
        latestReply: found.latestReply,
        infoText: found.infoText,
        context: found.context,
        raw: found.raw,
      };

      stopFooterComments();

      const provider = getGeminiProvider();
      const ready = provider === 'firebase' ? hasFirebaseConfig() : hasGeminiKey();
      setFooter(ready ? '로그 정리 중…' : 'API 설정 필요');

      const before = currentData || room.data || null;
      const fallbackInfoData = parseInfoDeterministic(found.infoText);
      const aiData = await callGemini(found.latestReply, found.context, found.infoText, fallbackInfoData, before);
      const infoData = aiData._fromGeminiInfo ? aiData : fallbackInfoData;
      const merged = mergeData(before, infoData, aiData);
      merged.hudComments = diversifyHudComments(merged.hudComments, found.latestReply);

      if ((infoData.relations || []).length && !(aiData.relationshipDeltas || []).length) {
        console.debug('[UniChat INFO Game HUD] Gemini returned no relationshipDeltas for current relations.', {
          relations: infoData.relations,
          currentMeters: before?.affection || before?.relationshipMeters || [],
        });
      }

      currentData = merged;

      let petEvent = null;
      let petLineForMascot = '';
      let petMilestoneLineForMascot = '';
      let favChangedForAchv = false;
      updateRoom(next => {
        next.data = merged;
        next.lastAnalyzedKey = found.key;
        next.lastAnalyzedContentKey = found.contentKey;
        next.analyzedContentKeys = [
          ...(Array.isArray(next.analyzedContentKeys) ? next.analyzedContentKeys : []).filter(k => k && k !== found.contentKey),
          found.contentKey,
        ].slice(-8);
        next.analyzeCount = Number(next.analyzeCount || 0) + 1;
        if (merged.hudComments?.length) {
          next.commentLog = next.commentLog || [];
          const t = nowTime();
          // 모든 hudComments(최대 3개)를 각각 저장
          for (const comment of merged.hudComments) {
            if (comment) next.commentLog.push({ text: comment, time: t });
          }
          next.commentLog = next.commentLog.slice(-90);
        }
        next.history.push({
          at: Date.now(),
          time: nowTime(),
          logs: merged.narrativeLogs,
          comments: merged.hudComments,
        });
        next.history = next.history.slice(-80);
        const prevFavForAchv = getFavoriteCharacter(getPet(next));
        petEvent = growPet(next, merged, found.latestReply);
        const newFavForAchv = getFavoriteCharacter(next.pet);
        favChangedForAchv = !!(prevFavForAchv && newFavForAchv && prevFavForAchv !== newFavForAchv);
        petMilestoneLineForMascot = milestoneMascotLine(next.pet);
        const line = String(aiData.petLine || '').trim() || petSpeakLocal(next.pet);
        if (line) {
          next.pet.lastLine = line;
          next.pet.lastLineAt = Date.now();
          petLineForMascot = line;
        }
      });

      // [업적] 분석/시간대/델타/폭풍몰입 카운터
      bumpAchvCounter('analyzeTotal', 1);
      const hourCounter = hourBucketCounter();
      if (hourCounter) bumpAchvCounter(hourCounter, 1);
      {
        const deltas = merged.relationshipDeltas || [];
        const bigPos = deltas.filter(d => Number(d.delta) >= 6).length;
        const neg = deltas.filter(d => Number(d.delta) <= -5).length;
        const bigNeg = deltas.filter(d => Number(d.delta) <= -8).length;
        if (bigPos) bumpAchvCounter('bigPosDelta', bigPos);
        if (neg) bumpAchvCounter('negDelta', neg);
        if (bigNeg) bumpAchvCounter('bigNegDelta', 1, true);
        const meterMaxHit = (merged.affection || []).some(m => clamp(normalizeMeter(m, 50).value, 0, 100) >= 100);
        if (meterMaxHit) bumpAchvCounter('meterMax', 1);
      }
      registerStormWindow();
      const decoTicketGain = awardDecoLogCredit(1);
      if (decoTicketGain) pushLog([`▷꾸밈티켓 +${decoTicketGain}!`]);
      bumpAchvCounter('feedTotal', 1);
      {
        const moodCounterKey = {
          love: 'moodHeart', happy: 'moodBloom', normal: 'moodPeace', sad: 'moodTear', scared: 'moodBlade',
        }[getPet().mood];
        if (moodCounterKey) bumpAchvCounter(moodCounterKey, 1);
      }
      {
        const relCount = (merged.affection || []).filter(m => isValidRelationName(normalizeMeter(m, 50).name)).length;
        if (relCount >= 5) bumpAchvCounter('relations5', 1, true);
        if (relCount >= 10) bumpAchvCounter('relations10', 1, true);
      }
      {
        const meterZeroHit = (merged.affection || []).some(m => clamp(normalizeMeter(m, 50).value, 0, 100) <= 0);
        if (meterZeroHit) bumpAchvCounter('meterZero', 1, true);
      }
      registerDayPhase();
      // [업적 추가] 자정/인벤/외길/변심/streak
      if (new Date().getHours() === 0) bumpAchvCounter('midnight', 1, true);
      if ((merged.inventory || []).length >= 5) bumpAchvCounter('invRich', 1, true);
      {
        const maxAff = Math.max(0, ...Object.values(getPet().charAffinity || {}).map(v => Number(v) || 0));
        if (maxAff >= 60) bumpAchvCounter('singleBond', 1, true);
      }
      if (favChangedForAchv) bumpAchvCounter('favChange', 1, true);
      registerVisitStreak();
      registerComboStreak(previousPetLastFedAt);
      announceAchvUnlocks();

      announcePetEvent(petEvent);
      if (isMascotEnabled()) {
        const petNow = getPet();
        const deltaSumForMascot = (merged.relationshipDeltas || []).reduce((sum, d) => sum + Math.abs(Number(d.delta) || 0), 0);
        updateMascotSprite();
        triggerMascotMood(petNow.mood, deltaSumForMascot);
        const relationLine = relationMascotLine(merged.relationshipDeltas || [], petNow);
        if (relationLine) mascotSay(relationLine, 70);
        if (petMilestoneLineForMascot) mascotSay(petMilestoneLineForMascot, 60);
        const comboLine = comboMascotLine(previousPetLastFedAt, petNow);
        if (comboLine) mascotSay(comboLine, 45);
        if (petLineForMascot) mascotSay(petLineForMascot, 45);
      }

      const eventLines = (merged.narrativeLogs || []).map(normalizeGameLine).filter(Boolean).slice(0, 8);
      const entries = ['─'.repeat(22), `[${nowTime()}]`, ...eventLines];

      pushLog(entries);
      showPopup(eventLines);
      startFooterComments(merged.hudComments, { popup: true });
      if (!merged.hudComments.length) setFooter(`LOG ${nowTime()}`);

      updateAnalyzeCountLabel();
      playBeep('done');
      mascotAnimDone();
      renderContent();
    } catch (err) {
      playBeep('error');
      const message = String(err?.message || err || '알 수 없는 오류').replace(/\s+/g, ' ').trim();
      console.error('[UniChat INFO Game HUD] analyzeLatest failed:', err);
      setFooter('API ERROR');
      pushLog([
        '▶API 호출/분석에 실패했다!',
        `▷${shortText(message || '설정 또는 콘솔을 확인해줘.', 150)}`,
      ]);
      showPopup([
        '▶API 호출 실패!',
        '▷설정값이나 콘솔 로그를 확인해줘.',
      ]);
    } finally {
      analyzeBusy = false;
    }
  }

  function scheduleAutoAnalyze() {
    if (!isAutoAnalyzeEnabled() || !isEpisodePath()) return;

    clearTimeout(autoAnalyzeTimer);
    autoAnalyzeTimer = setTimeout(checkStableAutoAnalyzeTarget, 900);
  }

  function checkStableAutoAnalyzeTarget() {
    if (!isAutoAnalyzeEnabled() || !isEpisodePath()) return;
    if (analyzeBusy) {
      scheduleAutoAnalyze();
      return;
    }

    const found = findLatestContext();
    if (!found) return;

    const room = getRoom();
    const analyzedContentKeys = Array.isArray(room.analyzedContentKeys) ? room.analyzedContentKeys : [];
    if (room.lastAnalyzedKey === found.key || room.lastAnalyzedContentKey === found.contentKey || analyzedContentKeys.includes(found.contentKey)) {
      autoCandidateKey = '';
      return;
    }

    if (autoCandidateKey === found.key) {
      autoCandidateKey = '';
      pushLog(['▷새 답변 감지! 자동으로 읽는다!']);
      analyzeLatest(false);
      return;
    }

    autoCandidateKey = found.key;
    clearTimeout(autoAnalyzeTimer);
    autoAnalyzeTimer = setTimeout(checkStableAutoAnalyzeTarget, 1500);
  }

  function isMessageRelatedNode(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!(el instanceof Element) || isOwnNode(el)) return false;
    // 유니챗: id^="msg-" 또는 그 하위
    return !!(
      el.matches?.(UNICHAT_MSG_SELECTOR) ||
      el.closest?.(UNICHAT_MSG_SELECTOR) ||
      el.querySelector?.(UNICHAT_MSG_SELECTOR)
    );
  }

  function isMessageRelatedMutation(mutation) {
    if (isMessageRelatedNode(mutation.target)) return true;
    for (const node of Array.from(mutation.addedNodes || [])) {
      if (isMessageRelatedNode(node)) return true;
    }
    return false;
  }

  function watchAutoAnalyze() {
    if (autoAnalyzeObserver) autoAnalyzeObserver.disconnect();
    if (!isEpisodePath()) return;

    const scope = findCrackMessageScope();
    if (!(scope instanceof HTMLElement)) {
      clearTimeout(autoAnalyzeTimer);
      autoAnalyzeTimer = setTimeout(watchAutoAnalyze, 900);
      return;
    }

    autoAnalyzeObserver = new MutationObserver(mutations => {
      if (!mutations.some(isMessageRelatedMutation)) return;
      scheduleAutoAnalyze();
    });

    // 유니챗: id 속성 변화 감지 (msg-... 추가)
    autoAnalyzeObserver.observe(scope, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['id', 'class'],
    });
  }

  // ─────────────────────────────────────────────
  // Log / popup / footer comments
  // ─────────────────────────────────────────────
  function pushLog(lines) {
    const normalized = (lines || []).filter(Boolean).map(String);
    if (!normalized.length) return;

    logQueue = [];
    isLogTyping = false;

    logLines.push(...normalized);
    if (logLines.length > 90) logLines = logLines.slice(-90);

    flushLog();
    saveRoomLogLines();
  }

  function flushLog() {
    const el = document.getElementById('cigh-clean-log-inner');
    if (!el) return;

    const recent = logLines.slice(-18);
    el.innerHTML = recent.map((line, index) => {
      const opacity = Math.max(0.32, (index + 1) / Math.max(1, recent.length));
      return `<div style="opacity:${opacity.toFixed(2)}">${esc(normalizeGameLine(line))}</div>`;
    }).join('');

    el.scrollTop = el.scrollHeight;
  }

  function ensurePopup() {
    let el = document.getElementById(POPUP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = POPUP_ID;
      document.body.appendChild(el);
      applyThemeMode();
    }
    return el;
  }

  function ensureCommentPopup() {
    let el = document.getElementById(COMMENT_POPUP_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = COMMENT_POPUP_ID;
      el.innerHTML = '<div class="cigh-clean-comment-prefix">◇ HUD</div><div class="cigh-clean-comment-text"></div>';
      document.body.appendChild(el);
      applyThemeMode();
    }
    return el;
  }

  function getFabRect() {
    const fab = document.getElementById(FAB_ID);
    return fab?.getBoundingClientRect?.() || { left: 16, top: innerHeight - 120, right: 50, bottom: innerHeight - 86, width: 34, height: 34 };
  }

  function positionPopupNearFab(el, kind = 'log') {
    if (!el) return;

    const rect = getFabRect();
    const gap = 8;
    const width = Math.min(218, Math.max(180, innerWidth - 24));

    el.style.width = `${width}px`;

    let left = rect.left;
    if (left + width > innerWidth - 8) left = innerWidth - width - 8;
    left = Math.max(8, left);

    const visibleComment = document.getElementById(COMMENT_POPUP_ID);
    const commentHeight = visibleComment?.classList.contains('show')
      ? Math.max(48, visibleComment.offsetHeight || 58)
      : 0;

    const height = Math.max(
      kind === 'comment' ? 48 : 72,
      Math.min(el.offsetHeight || (kind === 'comment' ? 58 : 150), kind === 'comment' ? 92 : 220)
    );

    let bottom = Math.max(8, innerHeight - rect.top + gap);

    if (kind === 'log' && commentHeight) {
      bottom += commentHeight + 6;
    }

    el.style.left = `${left}px`;
    el.style.right = 'auto';

    if (bottom + height > innerHeight - 8) {
      let top = rect.bottom + gap;
      if (kind === 'log' && commentHeight) top += commentHeight + 6;
      if (top + height > innerHeight - 8) top = Math.max(8, innerHeight - height - 8);

      el.style.top = `${top}px`;
      el.style.bottom = 'auto';
    } else {
      el.style.top = 'auto';
      el.style.bottom = `${bottom}px`;
    }
  }

  function updateFloatingPopupPositions() {
    const popup = document.getElementById(POPUP_ID);
    const comment = document.getElementById(COMMENT_POPUP_ID);

    if (popup) positionPopupNearFab(popup, 'log');
    if (comment) positionPopupNearFab(comment, 'comment');
  }

  function showCommentPopup(comment) {
    if (!isCommentPopupEnabled()) return;

    const text = shortText(comment, 42);
    if (!text) return;

    const el = ensureCommentPopup();
    const body = el.querySelector('.cigh-clean-comment-text');
    if (!body) return;

    clearTimeout(commentPopupTypingTimer);
    clearTimeout(commentPopupHideTimer);

    const startTyping = () => {
      positionPopupNearFab(el, 'comment');
      el.classList.add('show');
      body.textContent = '';
      requestAnimationFrame(updateFloatingPopupPositions);

      let pos = 0;
      const tick = () => {
        pos += 1;
        body.textContent = text.slice(0, pos);
        if (pos === 1 || pos >= text.length) requestAnimationFrame(updateFloatingPopupPositions);

        if (pos < text.length) {
          commentPopupTypingTimer = setTimeout(tick, 48);
        } else {
          commentPopupHideTimer = setTimeout(() => {
            el.classList.remove('show');
            requestAnimationFrame(updateFloatingPopupPositions);
          }, 3900);
        }
      };
      tick();
    };

    // 이전 팝업이 표시 중이면 transition(260ms) 완료 후 새 텍스트 시작
    if (el.classList.contains('show')) {
      el.classList.remove('show');
      commentPopupTypingTimer = setTimeout(startTyping, 280);
    } else {
      startTyping();
    }
  }

  function showPopup(lines) {
    const normalized = (lines || []).map(normalizeGameLine).filter(Boolean);
    if (!normalized.length) return;

    const el = ensurePopup();
    positionPopupNearFab(el, 'log');
    el.classList.add('show');
    requestAnimationFrame(updateFloatingPopupPositions);

    clearTimeout(popupRemoveTimer);
    clearTimeout(popupHideTimer);

    popupQueue.push(...normalized);
    if (!popupTyping) typePopupNext();
  }

  function typePopupNext() {
    const el = ensurePopup();

    if (!popupQueue.length) {
      popupTyping = false;
      schedulePopupRemoval();
      return;
    }

    popupTyping = true;
    el.classList.add('show');

    const line = popupQueue.shift();
    const row = document.createElement('div');
    row.className = 'cigh-clean-popup-line entering';
    row.textContent = '';
    el.appendChild(row);
    popupLines.push(row);

    requestAnimationFrame(() => {
      row.classList.remove('entering');
      updateFloatingPopupPositions();
    });

    while (popupLines.length > 8) {
      const old = popupLines.shift();
      old?.classList.add('leaving');
      setTimeout(() => {
        old?.remove();
        updateFloatingPopupPositions();
      }, 260);
    }

    let pos = 0;
    const tick = () => {
      pos += 2;
      row.textContent = line.slice(0, pos);
      if (pos === 2 || pos >= line.length) requestAnimationFrame(updateFloatingPopupPositions);

      if (pos < line.length) setTimeout(tick, 26);
      else setTimeout(typePopupNext, 520);
    };

    tick();
  }

  function schedulePopupRemoval() {
    clearTimeout(popupRemoveTimer);
    // 줄 수가 많을수록 제거 시작을 앞당김
    const delay = popupLines.length >= 4 ? 400 : popupLines.length >= 2 ? 650 : 800;
    popupRemoveTimer = setTimeout(removeOldestPopupLine, delay);
  }

  function removeOldestPopupLine() {
    const el = ensurePopup();

    if (popupTyping || popupQueue.length) return;

    const row = popupLines.shift();
    if (!row) {
      popupHideTimer = setTimeout(() => el.classList.remove('show'), 500);
      return;
    }

    row.classList.add('leaving');
    setTimeout(() => {
      row.remove();
      updateFloatingPopupPositions();
    }, 220);

    // 줄이 많이 남아있으면 더 빠르게 제거
    const nextDelay = popupLines.length >= 3 ? 260 : popupLines.length >= 1 ? 340 : 0;
    if (popupLines.length) popupRemoveTimer = setTimeout(removeOldestPopupLine, nextDelay);
    else popupHideTimer = setTimeout(() => el.classList.remove('show'), 500);
  }

  function setFooter(text) {
    const el = document.getElementById('cigh-clean-ft');
    if (el) el.textContent = text;
  }

  function stopFooterComments() {
    clearTimeout(footerTypingTimer);
    clearTimeout(footerLoopTimer);
    clearTimeout(commentPopupTypingTimer);
    clearTimeout(commentPopupHideTimer);
    footerTypingTimer = null;
    footerLoopTimer = null;
    commentPopupTypingTimer = null;
    commentPopupHideTimer = null;
    footerPopupRemaining = 0;
  }

  function clearTransientUi() {
    clearTimeout(popupRemoveTimer);
    clearTimeout(popupHideTimer);
    clearTimeout(commentPopupTypingTimer);
    clearTimeout(commentPopupHideTimer);
    clearTimeout(autoAnalyzeTimer);

    stopFooterComments();

    logQueue = [];
    isLogTyping = false;
    popupQueue = [];
    popupTyping = false;
    popupLines = [];
    autoCandidateKey = '';

    const popup = document.getElementById(POPUP_ID);
    if (popup) {
      popup.classList.remove('show');
      popup.innerHTML = '';
    }

    const comment = document.getElementById(COMMENT_POPUP_ID);
    if (comment) {
      comment.classList.remove('show');
      const body = comment.querySelector('.cigh-clean-comment-text');
      if (body) body.textContent = '';
    }
  }

  function startFooterComments(comments, options = {}) {
    footerComments = Array.isArray(comments)
      ? comments.map(x => shortText(x, 42)).filter(Boolean).slice(0, 3)
      : [];

    footerCommentIndex = 0;
    stopFooterComments();

    footerPopupRemaining = (options.popup !== false && isCommentPopupEnabled()) ? footerComments.length : 0;

    if (!footerComments.length) return;

    typeFooterComment();
  }

  function typeFooterComment() {
    if (!footerComments.length) return;

    const comment = footerComments[footerCommentIndex % footerComments.length];
    footerCommentIndex += 1;
    footerLastText = comment;

    if (footerPopupRemaining > 0) {
      showCommentPopup(comment);
      footerPopupRemaining -= 1;
    }

    let pos = 0;
    const tick = () => {
      pos += 2;
      footerLastText = comment.slice(0, pos);

      const el = document.getElementById('cigh-clean-ft');
      if (el) el.textContent = footerLastText;

      if (pos < comment.length) footerTypingTimer = setTimeout(tick, 60);
      else footerLoopTimer = setTimeout(typeFooterComment, 6400);
    };

    tick();
  }

  // ─────────────────────────────────────────────
  // UI rendering
  // ─────────────────────────────────────────────
  function section(title, body) {
    if (!body) return '';
    return `<div class="cigh-clean-sec"><div class="cigh-clean-sh">${esc(title)}</div>${body}</div>`;
  }

  function empty(message) {
    return `<div class="cigh-clean-empty">── ${esc(message)} ──</div>`;
  }

  function pixelHeartSVG(value) {
    const color = heartColor(value);
    const pixels = [
      '01100110',
      '11111111',
      '11111111',
      '11111111',
      '01111110',
      '00111100',
      '00011000',
      '00000000',
    ];

    const size = 2;
    const rects = [];

    pixels.forEach((row, y) => {
      [...row].forEach((cell, x) => {
        if (cell === '1') rects.push(`<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}" fill="${color}"/>`);
      });
    });

    return `<svg class="cigh-clean-heart" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${rects.join('')}</svg>`;
  }


  // ─────────────────────────────────────────────
  // Pet
  // ─────────────────────────────────────────────
  const PET_STAGES = [
    { stage: 0, minLevel: 1,  name: '알',     color: '#f0e0b0' },
    { stage: 1, minLevel: 3,  name: '아기',   color: '#a8e0b0' },
    { stage: 2, minLevel: 10, name: '성장기', color: '#9ecbf0' },
    { stage: 3, minLevel: 15, name: '성숙기', color: '#d9b3ec' },
    { stage: 4, minLevel: 20, name: '완전체', color: '#ffd166' },
  ];

  const PET_MOOD_COLORS = { love: '#e46576', happy: '#e0b24b', normal: '', sad: '#6f8bb0', scared: '#9b7fc0' };
  const PET_MOOD_LABEL = { love: '♥ 두근두근', happy: '☺ 기분 좋음', normal: '· 평온', sad: '… 시무룩', scared: '! 긴장' };

  const PET_SPRITES = {
    0: ['00000000000000','00000111100000','00001111110000','00011111111000','00111111111100','00111111111100','01111111111110','01111111111110','01111111111110','01111111111110','00111111111100','00111111111100','00011111111000','00001111110000'],
    1: ['00000000000000','00000000000000','00011111111000','00111111111100','01111111111110','01110111101110','01111111111110','01111111111110','00111111111100','00011111111000','00001111110000','00000000000000','00000000000000','00000000000000'],
    2: ['00000000000000','00011111111000','00111111111100','01111111111110','01100111100110','01100111100110','01111111111110','01111111111110','01111111111110','00111111111100','00011111111000','00011000110000','00000000000000','00000000000000'],
    3: ['00000110000000','00000110000000','00011111111000','00111111111100','01111111111110','01100111100110','01100111100110','01111111111110','01111100111110','01111111111110','00111111111100','00011111111000','00011000110000','00000000000000'],
  };

  // 완전체 분기 5종 (♥ / ✿ / ☺ / ☂ / ⚔) — 큰 눈 공통, 머리 장식만 차이.
  const PET_FINAL_BODY = [
    '00011111111000','00111111111100','01111111111110',
    '01100111100110','01100111100110','01111111111110',
    '01111100111110','01111111111110','00111111111100',
    '00011111111000','00000000000000',
  ];

  const PET_FINAL_FORMS = {
    heart: { name: '완전체·♥형', color: '#ff9ec4', sprite: ['00000010100000','00000111110000','00000011100000', ...PET_FINAL_BODY] },
    bloom: { name: '완전체·✿형', color: '#ffd9a8', sprite: ['00001000010000','00010100101000','00001011010000', ...PET_FINAL_BODY] },
    peace: { name: '완전체·☺형', color: '#ffd166', sprite: ['00001100110000','00000111100000','00000011000000', ...PET_FINAL_BODY] },
    tear: { name: '완전체·☂형', color: '#8fb4e0', sprite: ['00000011000000','00000111100000','00001111110000', ...PET_FINAL_BODY] },
    blade: { name: '완전체·⚔형', color: '#b6a3e0', sprite: ['00100000010000','00110000011000','00011000110000', ...PET_FINAL_BODY] },
  };
  const PET_TENDENCY_LABEL = {
    heart: '♥ 애정형',
    bloom: '✿ 명랑형',
    peace: '☺ 평화형',
    tear: '☂ 애상형',
    blade: '⚔ 시련형',
  };
  const TENDENCY_KEYS = Object.keys(PET_FINAL_FORMS);
  const MOOD_WINDOW = 3 * 60 * 1000;
  const MASCOT_IDLE_MS = 10 * 60 * 1000;
  const BOND_LEVELS = [0, 10, 30, 60, 100];

  function zeroTally() {
    return Object.fromEntries(TENDENCY_KEYS.map(key => [key, 0]));
  }

  function petMoodBucket(mood) {
    if (mood === 'love') return 'heart';
    if (mood === 'happy') return 'bloom';
    if (mood === 'sad') return 'tear';
    if (mood === 'scared') return 'blade';
    return 'peace';
  }

  function petFinalType(tally) {
    const t = { ...zeroTally(), ...(tally || {}) };
    return TENDENCY_KEYS.reduce((best, key) => Number(t[key] || 0) > Number(t[best] || 0) ? key : best, 'peace');
  }

  function defaultPet() {
    return {
      exp: 0,
      level: 1,
      stage: 0,
      mood: 'normal',
      feedCount: 0,
      bornAt: Date.now(),
      lastFedAt: 0,
      tally: zeroTally(),
      finalType: 'peace',
      lastLine: '',
      lastLineAt: 0,
      bondLevel: 0,
      charAffinity: {},
      shownMilestones: [],
    };
  }

  function normalizePet(raw = {}) {
    const base = defaultPet();
    const pet = { ...base, ...(raw || {}) };
    pet.tally = { ...zeroTally(), ...(raw?.tally || {}) };
    pet.finalType = TENDENCY_KEYS.includes(String(pet.finalType || '')) ? pet.finalType : petFinalType(pet.tally);
    pet.bondLevel = Number.isFinite(Number(pet.bondLevel)) ? Number(pet.bondLevel) : 0;
    pet.charAffinity = raw?.charAffinity && typeof raw.charAffinity === 'object' && !Array.isArray(raw.charAffinity)
      ? { ...raw.charAffinity }
      : {};
    pet.shownMilestones = Array.isArray(raw?.shownMilestones) ? raw.shownMilestones.slice() : [];
    return pet;
  }

  function getPet(room = getRoom()) {
    return normalizePet(room?.pet || {});
  }

  function petExpForLevel(level) {
    let total = 0;
    for (let l = 1; l < level; l++) total += 50 + (l - 1) * 25;
    return total;
  }

  function petLevelFromExp(exp) {
    let level = 1;
    while (exp >= petExpForLevel(level + 1)) level++;
    return level;
  }

  function petStageFromLevel(level) {
    let picked = PET_STAGES[0];
    for (const st of PET_STAGES) if (level >= st.minLevel) picked = st;
    return picked;
  }

  function detectPetMood(text, deltaSum) {
    const t = normalize(text);
    if (/고백|사랑|키스|입맞|포옹|안아|끌어안|설렘|두근|심장|좋아해/.test(t)) return 'love';
    if (/눈물|울|흐느|상처|버림|외로|무너|슬픔|비참|아파/.test(t)) return 'sad';
    if (/분노|화났|소리|외쳤|위협|죽|피|공포|두려|위험|긴장/.test(t)) return 'scared';
    if (/웃|미소|다정|부드럽|귀엽|장난|간질|놀리|안심/.test(t)) return 'happy';
    if (deltaSum > 0) return 'happy';
    if (deltaSum < 0) return 'sad';
    return 'normal';
  }

  function petExpGain(deltaSum) {
    return 10 + Math.min(Math.round(deltaSum), 20);
  }

  function petTokenExpGain(tokens) {
    const input = Math.max(0, Math.floor(Number(tokens?.input || 0)));
    if (!input) return 0;
    return clamp(Math.floor(input / PET_TOKEN_EXP_INPUT_UNIT), 0, PET_TOKEN_EXP_MAX);
  }

  function weightedPetFinalType(tally = {}) {
    const entries = TENDENCY_KEYS.map(key => [key, Math.max(0, Number(tally?.[key] || 0))]).filter(([, value]) => value > 0);
    const total = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return 'peace';
    let roll = Math.random() * total;
    for (const [key, value] of entries) {
      roll -= value;
      if (roll < 0) return key;
    }
    return entries[entries.length - 1]?.[0] || 'peace';
  }

  function getPetDisplayFinalType(pet = getPet()) {
    const fixed = String(pet?.fixedFinalType || '');
    if (petStageFromLevel(Number(pet?.level || 1)).stage >= 3 && TENDENCY_KEYS.includes(fixed)) return fixed;
    const live = String(pet?.finalType || 'peace');
    return TENDENCY_KEYS.includes(live) ? live : 'peace';
  }

  // ─────────────────────────────────────────────
  // Mascot Accessories (액세서리 꾸미기)
  // ─────────────────────────────────────────────

  // head: 머리 위 장식 픽셀맵 (14px wide, 3~4px tall)
  // neck: 목 장식 (14px wide, 2px)
  // face: 얼굴 페이스페인팅 (양 볼)
  const MASCOT_ACCESSORIES = {
    head: {
      none:   { label: '없음', pixels: [], color: 'transparent' },
      ribbon: {
        label: '🎀 리본',
        color: '#ff9ec4',
        // 리본 모양: 양쪽 루프 + 가운데 매듭
        pixels: [
          { x:2,y:0 },{ x:3,y:0 },{ x:5,y:0 },{ x:6,y:0 },{ x:7,y:0 },{ x:9,y:0 },{ x:10,y:0 },
          { x:3,y:1 },{ x:4,y:1 },{ x:6,y:1,c:'#e46576' },{ x:7,y:1,c:'#e46576' },{ x:8,y:1 },{ x:9,y:1 },
          { x:2,y:2 },{ x:4,y:2 },{ x:9,y:2 },{ x:11,y:2 },
        ],
      },
      crown: {
        label: '👑 왕관',
        color: '#ffd166',
        pixels: [
          { x:2,y:0 },{ x:6,y:0 },{ x:10,y:0 },
          { x:2,y:1 },{ x:3,y:1 },{ x:5,y:1 },{ x:6,y:1 },{ x:7,y:1 },{ x:9,y:1 },{ x:10,y:1 },{ x:11,y:1 },
          { x:2,y:2 },{ x:3,y:2 },{ x:4,y:2 },{ x:5,y:2 },{ x:6,y:2 },{ x:7,y:2 },{ x:8,y:2 },{ x:9,y:2 },{ x:10,y:2 },{ x:11,y:2 },
        ],
      },
      horn: {
        label: '🦄 뿔',
        color: '#d9b3ec',
        pixels: [
          { x:6,y:0 },
          { x:5,y:1 },{ x:6,y:1,c:'#c490e4' },{ x:7,y:1 },
          { x:5,y:2 },{ x:6,y:2 },{ x:7,y:2 },
        ],
      },
      star: {
        label: '⭐ 별',
        color: '#ffd166',
        pixels: [
          { x:6,y:0 },
          { x:4,y:1 },{ x:5,y:1 },{ x:6,y:1 },{ x:7,y:1 },{ x:8,y:1 },
          { x:5,y:2 },{ x:6,y:2 },{ x:7,y:2 },
          { x:4,y:3 },{ x:8,y:3 },
        ],
      },
      flower: {
        label: '🌸 꽃',
        color: '#ffb3c6',
        pixels: [
          { x:5,y:0 },{ x:6,y:0 },{ x:7,y:0 },
          { x:4,y:1 },{ x:5,y:1,c:'#fff' },{ x:6,y:1,c:'#ffec6e' },{ x:7,y:1,c:'#fff' },{ x:8,y:1 },
          { x:5,y:2 },{ x:6,y:2 },{ x:7,y:2 },
        ],
      },
    },
    neck: {
      none:   { label: '없음', pixels: [] },
      ribbon: {
        label: '🎀 리본 넥타이',
        color: '#ff9ec4',
        // 목 중앙 4px짜리 리본 묶음
        pixels: [
          { x:4,y:0 },{ x:5,y:0 },{ x:6,y:0 },{ x:7,y:0 },{ x:8,y:0 },{ x:9,y:0 },
          { x:5,y:1,c:'#e46576' },{ x:6,y:1,c:'#e46576' },{ x:7,y:1,c:'#e46576' },{ x:8,y:1,c:'#e46576' },
        ],
      },
      scarf: {
        label: '🧣 스카프',
        color: '#9ecbf0',
        pixels: [
          { x:3,y:0 },{ x:4,y:0 },{ x:5,y:0 },{ x:6,y:0 },{ x:7,y:0 },{ x:8,y:0 },{ x:9,y:0 },{ x:10,y:0 },
          { x:3,y:1,c:'#7fb9f0' },{ x:4,y:1,c:'#7fb9f0' },{ x:10,y:1 },{ x:11,y:1 },
        ],
      },
    },
    face: {
      none:   { label: '없음' },
      heart:  { label: '♥ 하트볼', color: '#ff9ec4', shape: 'heart' },
      star:   { label: '★ 별볼',   color: '#ffd166', shape: 'star' },
      freckle:{ label: '· 주근깨', color: '#d4956a', shape: 'freckle' },
    },
  };

  // localStorage 저장 형식:
  // {
  //   head: 'ribbon' | 'none' | 'custom_head',
  //   neck: ...,
  //   face: ...,
  //   customPixels: {            ← 커스텀 픽셀 데이터 (새로고침 후 복원용)
  //     head: [{x,y,c}, ...],
  //     neck: [...],
  //     face: [...],
  //   }
  // }

  function getMascotAccessory() {
    try {
      const raw = JSON.parse(localStorage.getItem(MASCOT_ACCESSORY_STORE) || '{}');
      const acc = {
        head: raw.head || 'none',
        neck: raw.neck || 'none',
        face: raw.face || 'none',
      };
      // 커스텀 픽셀 데이터가 있으면 MASCOT_ACCESSORIES에 복원
      const cp = raw.customPixels || {};
      ['head', 'neck', 'face'].forEach(slot => {
        const pixels = cp[slot];
        if (Array.isArray(pixels) && pixels.length) {
          const key = `custom_${slot}`;
          MASCOT_ACCESSORIES[slot][key] = {
            label: '✏ 커스텀',
            color: pixels[0]?.c || '#ff9ec4',
            pixels,
          };
          // 저장된 키가 custom_*인데 pixels 없으면 강제 복원
          if (acc[slot] === key) acc[slot] = key;
        }
      });
      return acc;
    } catch { return { head: 'none', neck: 'none', face: 'none' }; }
  }

  function setMascotAccessory(value) {
    // customPixels를 함께 저장
    const toSave = { ...(value || {}) };
    const cp = {};
    ['head', 'neck', 'face'].forEach(slot => {
      const key = `custom_${slot}`;
      const def = MASCOT_ACCESSORIES[slot]?.[key];
      if (def?.pixels?.length) cp[slot] = def.pixels;
    });
    if (Object.keys(cp).length) toSave.customPixels = cp;
    localStorage.setItem(MASCOT_ACCESSORY_STORE, JSON.stringify(toSave));
  }

  // mascot size: 2 | 3 | 4 (픽셀당 px)
  function getMascotSize() {
    const n = Number(localStorage.getItem(MASCOT_SIZE_STORE) || 4);
    return [2, 3, 4].includes(n) ? n : 4;
  }
  function setMascotSize(v) {
    const n = Number(v);
    localStorage.setItem(MASCOT_SIZE_STORE, String([2, 3, 4].includes(n) ? n : 4));
  }

  // outline: 'outline' | 'shadow' | 'none'
  function getMascotOutline() {
    const v = String(localStorage.getItem(MASCOT_OUTLINE_STORE) || 'outline').trim();
    return ['outline', 'shadow', 'none'].includes(v) ? v : 'outline';
  }
  function setMascotOutline(v) {
    localStorage.setItem(MASCOT_OUTLINE_STORE, ['outline','shadow','none'].includes(v) ? v : 'outline');
  }

  // 액세서리 SVG 레이어를 기존 sprite SVG에 합성
  // 액세서리 픽셀을 SVG rect 문자열로 변환
  // 에디터 그리드(14×14)에서 그린 좌표를 그대로 사용
  // offsetY: 에디터 그리드 y=0이 SVG상 몇 px 아래인지 (머리장식은 음수, 나머지는 0)
  function _accPixelsToRects(accDef, size, offsetY = 0) {
    if (!accDef || !accDef.pixels?.length) return '';
    const colorMap = accDef.colors || {};
    return accDef.pixels.map(p => {
      const fill = p.c || colorMap[`${p.x},${p.y}`] || accDef.color || '#ff9ec4';
      const sy = (p.y + offsetY) * size;
      return `<rect x="${p.x * size}" y="${sy}" width="${size}" height="${size}" fill="${fill}"/>`;
    }).join('');
  }

  // 픽셀 맵 기준으로 외곽선(outline) rect 생성 — 인접 빈 칸 방향에 1px 테두리
  // filled: Set of "x,y" strings representing all filled pixel positions
  // offsetY: y좌표 오프셋 (머리장식은 -3)
  function _buildOutlineFromSet(filled, size, outlineColor = 'rgba(0,0,0,0.55)') {
    const seen = new Set();
    const rects = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const key of filled) {
      const [x, y] = key.split(',').map(Number);
      for (const [dy, dx] of dirs) {
        const nx = x + dx, ny = y + dy;
        const nk = `${nx},${ny}`;
        if (!filled.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          rects.push(`<rect x="${nx * size}" y="${ny * size}" width="${size}" height="${size}" fill="${outlineColor}"/>`);
        }
      }
    }
    return rects.join('');
  }

  function _buildOutlineRects(map, size, outlineColor = 'rgba(0,0,0,0.55)') {
    const filled = new Set();
    for (let y = 0; y < map.length; y++)
      for (let x = 0; x < map[0].length; x++)
        if (map[y][x] === '1') filled.add(`${x},${y}`);
    return _buildOutlineFromSet(filled, size, outlineColor);
  }


  // ─────────────────────────────────────────────
  // 펫 이미지 프레임 (완전체 stage>=3용)
  // ─────────────────────────────────────────────
  const PET_IMAGE_FRAME_KEYS = ['normal', 'smile1', 'smile2', 'half', 'sleep1', 'sleep2', 'drag1', 'drag2'];
  const PET_IMAGE_FRAMES = {
    // ♥ 애정형: 고양이
    heart: {
      normal: 'https://i.postimg.cc/brh5wnNW/heart-cat-normal.png',
      smile1: 'https://i.postimg.cc/0js4yS2T/heart-cat-smile.png',
      smile2: 'https://i.postimg.cc/SRhPx9x4/heart-cat-smile-(1).png',
      half:   'https://i.postimg.cc/L5pW8P6r/heart-cat-half.png',
      sleep1: 'https://i.postimg.cc/4yg0xcNj/heart-cat-sleep-(1).png',
      sleep2: 'https://i.postimg.cc/vTsKZnZR/heart-cat-sleep-(2).png',
      drag1:  'https://i.postimg.cc/90hkQ9QH/heart-cat-drag-(1).png',
      drag2:  'https://i.postimg.cc/hvBYtmtq/heart-cat-drag-(2).png',
    },
    // ✿ 명랑형: 햄스터
    bloom: {
      normal: 'https://i.postimg.cc/Mpc19bBL/cheerful-hamster-normal.png',
      smile1: 'https://i.postimg.cc/6p7CMLZF/cheerful-hamster-smile.png',
      smile2: 'https://i.postimg.cc/sgB5T9Wt/cheerful-hamster-smile-(1).png',
      half:   'https://i.postimg.cc/SxXcg795/cheerful-hamster-half.png',
      sleep1: 'https://i.postimg.cc/rFZSGYdT/cheerful-hamster-sleep-(1).png',
      sleep2: 'https://i.postimg.cc/NfC18PyY/cheerful-hamster-sleep-(2).png',
      drag1:  'https://i.postimg.cc/7ZCSKMzW/cheerful-hamster-drag-(1).png',
      drag2:  'https://i.postimg.cc/y8J0LXRt/cheerful-hamster-drag-(2).png',
    },
    // ☺ 평화형: 곰
    peace: {
      normal: 'https://i.postimg.cc/Jn8J7fFM/peace-bear-normal.png',
      smile1: 'https://i.postimg.cc/sXzSfkL5/peace-bear-smile.png',
      smile2: 'https://i.postimg.cc/V6wMsxhn/peace-bear-smile-(1).png',
      half:   'https://i.postimg.cc/PxHZfg7D/peace-bear-half.png',
      sleep1: 'https://i.postimg.cc/gJpRcC70/peace-bear-sleep-(1).png',
      sleep2: 'https://i.postimg.cc/nzx7VyWh/peace-bear-sleep-(2).png',
      drag1:  'https://i.postimg.cc/KzbLc6Wk/peace-bear-drag-(1).png',
      drag2:  'https://i.postimg.cc/wvzJxCrT/peace-bear-drag-(2).png',
    },
    // ☂ 애상형: 양
    tear: {
      normal: 'https://i.postimg.cc/qvCCsBVd/sorrow-lamb-normal.png',
      smile1: 'https://i.postimg.cc/Dwbbrfkm/sorrow-lamb-smile.png',
      smile2: 'https://i.postimg.cc/kgttQM3G/sorrow-lamb-smile-(1).png',
      half:   'https://i.postimg.cc/T3WWV2Mw/sorrow-lamb-half.png',
      sleep1: 'https://i.postimg.cc/GmssF3wn/sorrow-lamb-sleep-(1).png',
      sleep2: 'https://i.postimg.cc/7YR2JGcY/sorrow-lamb-sleep-(2).png',
      drag1:  'https://i.postimg.cc/VkbbqsQk/sorrow-lamb-drag-(1).png',
      drag2:  'https://i.postimg.cc/g266VcFd/sorrow-lamb-drag-(2).png',
    },
    // ⚔ 시련형: 용
    blade: {
      normal: 'https://i.postimg.cc/T27yB5Tp/trial-dragon-normal.png',
      smile1: 'https://i.postimg.cc/bNZGPYv2/trial-dragon-smile.png',
      smile2: 'https://i.postimg.cc/7Y5C4PLG/trial-dragon-smile-(1).png',
      half:   'https://i.postimg.cc/Yqv472S4/trial-dragon-half.png',
      sleep1: 'https://i.postimg.cc/jqgWBnRJ/trial-dragon-sleep-(1).png',
      sleep2: 'https://i.postimg.cc/BZY8RPJF/trial-dragon-sleep-(2).png',
      drag1:  'https://i.postimg.cc/WpWDxqsD/trial-dragon-drag-(1).png',
      drag2:  'https://i.postimg.cc/tRS18n9t/trial-dragon-drag-(2).png',
    },
  };

  function getPetImageFrames(finalType) {
    const key = TENDENCY_KEYS.includes(String(finalType || '')) ? String(finalType) : 'peace';
    return PET_IMAGE_FRAMES[key] || null;
  }

  function hasPetImageFrames(finalType) {
    const frames = getPetImageFrames(finalType);
    return !!(frames && frames.normal);
  }

  function preloadPetImageFrames() {
    try {
      const urls = new Set();
      Object.values(PET_IMAGE_FRAMES || {}).forEach(frames => {
        PET_IMAGE_FRAME_KEYS.forEach(key => {
          const src = String(frames?.[key] || '').trim();
          if (src) urls.add(src);
        });
      });
      urls.forEach(src => { const img = new Image(); img.referrerPolicy = 'no-referrer'; img.src = src; });
    } catch (err) { console.debug('[유니챗 HUD] pet image preload failed:', err); }
  }

  function pickAnimatedPair(a, b, period, now = Date.now()) {
    const first = String(a || '').trim();
    const second = String(b || '').trim();
    if (!first && !second) return '';
    if (!first) return second;
    if (!second) return first;
    return Math.floor(now / Math.max(120, Number(period) || 1)) % 2 === 0 ? first : second;
  }

  let petVisualTickTimer = null;
  const PET_VISUAL_IDLE_SLEEP_MS = 80000;
  const PET_VISUAL_POST_DRAG_MS = 1200;
  const PET_VISUAL_SMILE_MS = 2200;
  const PET_VISUAL_HALF_MS = 1800;
  const PET_VISUAL_STATE = {
    mode: 'normal',
    until: 0,
    lastActiveAt: Date.now(),
    dragActive: false,
  };

  function getPetVisualMode(pet = getPet()) {
    const now = Date.now();
    if (PET_VISUAL_STATE.dragActive) return 'drag';
    if (PET_VISUAL_STATE.until && now < PET_VISUAL_STATE.until) return PET_VISUAL_STATE.mode || 'normal';
    if (PET_VISUAL_STATE.until && now >= PET_VISUAL_STATE.until) {
      PET_VISUAL_STATE.mode = 'normal';
      PET_VISUAL_STATE.until = 0;
    }
    const idleMs = now - Number(PET_VISUAL_STATE.lastActiveAt || now);
    if (idleMs >= PET_VISUAL_IDLE_SLEEP_MS) return 'sleep';
    const mood = String(getEffectiveMood(pet) || pet?.mood || 'normal');
    if (mood === 'love' || mood === 'happy') return 'smile';
    if (mood === 'sad' || mood === 'scared') return 'half';
    return 'normal';
  }

  function pickPetImageFrame(frames, mode, pet = getPet(), now = Date.now()) {
    if (!frames || !frames.normal) return '';
    const currentMode = String(mode || getPetVisualMode(pet) || 'normal');
    if (currentMode === 'drag') return pickAnimatedPair(frames.drag1 || frames.normal, frames.drag2 || frames.drag1 || frames.normal, 240, now) || frames.normal;
    if (currentMode === 'sleep') return pickAnimatedPair(frames.sleep1 || frames.normal, frames.sleep2 || frames.sleep1 || frames.normal, 1400, now) || frames.normal;
    if (currentMode === 'smile') return pickAnimatedPair(frames.smile1 || frames.normal, frames.smile2 || frames.smile1 || frames.normal, 360, now) || frames.normal;
    if (currentMode === 'half') return String(frames.half || frames.normal || '').trim();
    return String(frames.normal || '').trim();
  }

  function schedulePetVisualTick(delay = 900) {
    clearTimeout(petVisualTickTimer);
    petVisualTickTimer = setTimeout(petVisualTick, Math.max(120, Number(delay) || 900));
  }

  function petVisualTick() {
    petVisualTickTimer = null;
    const pet = getPet();
    const mode = getPetVisualMode(pet);
    const hasImage = petStageFromLevel(Number(pet?.level || 1)).stage >= 3 && hasPetImageFrames(getPetDisplayFinalType(pet));
    const shouldAnimate = hasImage && (mode === 'sleep' || mode === 'smile' || mode === 'drag');
    if (isMascotEnabled()) updateMascotSprite();
    if (mode === 'sleep') triggerMascotSleepFx();
    if (activeTab === 'pet') updatePetPanelSprite();
    schedulePetVisualTick(shouldAnimate ? (mode === 'sleep' ? 900 : mode === 'drag' ? 180 : 360) : 1600);
  }

  function touchPetVisual(mode = '', duration = 0) {
    const now = Date.now();
    PET_VISUAL_STATE.lastActiveAt = now;
    PET_VISUAL_STATE.dragActive = false;
    if (mode) {
      PET_VISUAL_STATE.mode = String(mode);
      PET_VISUAL_STATE.until = duration > 0 ? now + duration : 0;
    } else {
      PET_VISUAL_STATE.mode = 'normal';
      PET_VISUAL_STATE.until = 0;
    }
    if (isMascotEnabled()) updateMascotSprite();
    updatePetPanelSprite();
    schedulePetVisualTick(mode === 'smile' ? 300 : mode === 'half' ? 520 : 1200);
  }

  function beginPetDragVisual() {
    PET_VISUAL_STATE.dragActive = true;
    PET_VISUAL_STATE.mode = 'drag';
    PET_VISUAL_STATE.until = 0;
    PET_VISUAL_STATE.lastActiveAt = Date.now();
    if (isMascotEnabled()) updateMascotSprite();
    updatePetPanelSprite();
    schedulePetVisualTick(180);
  }

  function endPetDragVisual(afterMode = 'smile', duration = PET_VISUAL_POST_DRAG_MS) {
    PET_VISUAL_STATE.dragActive = false;
    touchPetVisual(afterMode, duration);
  }

  function petImageHTML(src, mode = 'normal', size = 8) {
    const displaySize = Number(size) <= 2 ? 52 : 112;
    return `<span class="cigh-clean-pet-img-wrap cigh-clean-pet-img-${esc(mode)}" data-cigh-pet-mode="${esc(mode)}" style="--cigh-pet-img-size:${displaySize}px;" aria-hidden="true">
      <img class="cigh-clean-pet-img" src="${esc(src)}" data-cigh-pet-src="${esc(src)}" alt="" draggable="false" referrerpolicy="no-referrer">
    </span>`;
  }

  function renderPetSpriteHTML(pet = getPet(), size = PET_PANEL_SPRITE_SIZE) {
    const stageObj = petStageFromLevel(pet.level);
    const mood = getEffectiveMood(pet);
    const finalType = getPetDisplayFinalType(pet);

    // 성숙기/완전체 이미지 펫은 실제 표시 시점에 해당 성향 프레임만 지연 선로딩한다.
    if (stageObj.stage >= 3 && hasPetImageFrames(finalType)) {
      preloadPetImageFrames(finalType);
    }

    return petSpriteSVG(stageObj, mood, finalType, size, pet);
  }

  function renderPetSpriteInto(container, size = PET_PANEL_SPRITE_SIZE, pet = getPet()) {
    if (!container) return;
    const mode = getPetVisualMode(pet);
    const html = renderPetSpriteHTML(pet, size);
    const signature = `${mode}|${size}|${html}`;
    container.dataset.cighPetMode = mode;
    container.classList.toggle('is-sleep', mode === 'sleep');
    if (container.dataset.cighPetRenderSig === signature) return;
    container.dataset.cighPetRenderSig = signature;
    container.innerHTML = html;
  }

  function updatePetPanelSprite(pet = getPet()) {
    if (activeTab !== 'pet') return;
    const sprite = document.querySelector(`#${PANEL_ID} .cigh-clean-pet-sprite`);
    renderPetSpriteInto(sprite, PET_PANEL_SPRITE_SIZE, pet);
  }

  function updatePetPanelSpeech(pet = getPet()) {
    if (activeTab !== 'pet') return;
    const speech = document.querySelector(`#${PANEL_ID} .cigh-clean-pet-speech`);
    if (!speech) return;
    speech.textContent = isEggStagePet(pet) ? (pet?.lastLine || '') : (pet?.lastLine || '쓰다듬어줘!');
  }

  function updatePetPanelMoodLabel(pet = getPet()) {
    if (activeTab !== 'pet') return;
    const mood = document.querySelector(`#${PANEL_ID} .cigh-clean-pet-mood`);
    if (!mood) return;
    const label = PET_MOOD_LABEL[getEffectiveMood(pet)] || PET_MOOD_LABEL.normal;
    mood.textContent = label;
  }

  function resetPetVisualState() {
    PET_VISUAL_STATE.mode = 'normal';
    PET_VISUAL_STATE.until = 0;
    PET_VISUAL_STATE.dragActive = false;
    PET_VISUAL_STATE.lastActiveAt = Date.now();
  }

  function refreshPetSurfaces(pet = getPet(), options = {}) {
    if (options.resetVisual) resetPetVisualState();
    if (activeTab === 'pet') {
      updatePetPanelSpeech(pet);
      updatePetPanelMoodLabel(pet);
      updatePetPanelSprite(pet);
    }
    if (isMascotEnabled()) updateMascotSprite(pet);
  }

  function petSpriteSVGWithAccessory(stageObj, mood, finalType, size = 8, accessory = null) {
    const form = stageObj.stage >= 4 ? (PET_FINAL_FORMS[finalType] || PET_FINAL_FORMS.peace) : null;
    const map = form?.sprite || PET_SPRITES[stageObj.stage] || PET_SPRITES[0];
    const color = PET_MOOD_COLORS[mood] || form?.color || stageObj.color;
    const w = map[0].length;
    const h = map.length;
    const acc = accessory || getMascotAccessory();

    const headAcc = MASCOT_ACCESSORIES.head[acc.head];
    const neckAcc = MASCOT_ACCESSORIES.neck[acc.neck];
    const faceAcc = MASCOT_ACCESSORIES.face[acc.face];

    // 머리장식이 있으면 viewBox 위쪽 3행 확장
    // 에디터에서 머리장식은 y=0~2행에 그리고, SVG에서는 body y=0 위쪽으로 올려야 함
    // → offsetY = -3 (에디터 y좌표 기준 SVG 오프셋)
    const hasHead = headAcc?.pixels?.length > 0;
    const outlineMode = getMascotOutline();
    // 아웃라인 모드면 외곽 1픽셀 자리 확보 (잘림 방지)
    const outlinePad = outlineMode === 'outline' ? size : 0;
    const extraTop = (hasHead ? 3 * size : 0) + outlinePad;
    const totalH = h * size + extraTop + outlinePad;
    const totalW = w * size + outlinePad * 2;
    const viewBox = `${-outlinePad} ${-extraTop} ${totalW} ${totalH}`;

    // 레이어 순서:
    // 1. 머리장식 (body 위 공간, extraTop 만큼 위로)
    // 2. 몸통
    // 3. 목 장식 (몸통 위에 그려져야 함 → 몸통 뒤)  ← 수정: 몸통 다음에 렌더
    // 4. 얼굴 페이스페인팅 (몸통 위에 반투명으로)

    // 머리장식: 에디터 y=0~2 → SVG y = (-3 + y)*size + extraTop 보정
    // viewBox가 -extraTop부터 시작하므로, 에디터 y=0 → SVG y = -extraTop = -3*size
    // _accPixelsToRects offsetY = -3 적용하면 SVG y = (p.y - 3)*size → viewBox 내 위쪽 공간에 표시
    const headRects = _accPixelsToRects(headAcc, size, -3);

    // 몸통
    const bodyRects = map.map((row, y) =>
      [...row].map((cell, x) =>
        cell === '1' ? `<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}" fill="${color}"/>` : ''
      ).join('')
    ).join('');

    // 목 장식: 에디터 좌표 그대로 (y=6~8 정도) → 몸통과 겹치는 위치라 몸통 위에 렌더
    const neckRects = _accPixelsToRects(neckAcc, size, 0);

    // 얼굴 페이스페인팅: 에디터 좌표 그대로 (y=4~6 정도) → 반투명으로 볼 위에
    let faceRects = '';
    if (faceAcc) {
      if (faceAcc.pixels?.length) {
        // 커스텀 or 픽셀 기반 프리셋
        faceRects = _accPixelsToRects(faceAcc, size, 0);
      } else if (faceAcc.shape) {
        // 기존 shape 기반 프리셋 (하트/별/주근깨)
        const faceY = Math.floor(h * 0.42);
        const fc = faceAcc.color;
        if (faceAcc.shape === 'heart') {
          faceRects = [
            `<rect x="${2*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.85"/>`,
            `<rect x="${3*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.85"/>`,
            `<rect x="${2*size}" y="${(faceY+1)*size}" width="${size*2}" height="${size}" fill="${fc}" opacity="0.75"/>`,
            `<rect x="${(w-4)*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.85"/>`,
            `<rect x="${(w-3)*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.85"/>`,
            `<rect x="${(w-4)*size}" y="${(faceY+1)*size}" width="${size*2}" height="${size}" fill="${fc}" opacity="0.75"/>`,
          ].join('');
        } else if (faceAcc.shape === 'star') {
          faceRects = [
            `<rect x="${2*size}" y="${faceY*size}" width="${size*3}" height="${size}" fill="${fc}" opacity="0.8"/>`,
            `<rect x="${3*size}" y="${(faceY-1)*size}" width="${size}" height="${size*3}" fill="${fc}" opacity="0.8"/>`,
            `<rect x="${(w-5)*size}" y="${faceY*size}" width="${size*3}" height="${size}" fill="${fc}" opacity="0.8"/>`,
            `<rect x="${(w-4)*size}" y="${(faceY-1)*size}" width="${size}" height="${size*3}" fill="${fc}" opacity="0.8"/>`,
          ].join('');
        } else if (faceAcc.shape === 'freckle') {
          faceRects = [
            `<rect x="${2*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.72"/>`,
            `<rect x="${4*size}" y="${(faceY+1)*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.58"/>`,
            `<rect x="${3*size}" y="${(faceY+1)*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.52"/>`,
            `<rect x="${(w-3)*size}" y="${faceY*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.72"/>`,
            `<rect x="${(w-5)*size}" y="${(faceY+1)*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.58"/>`,
            `<rect x="${(w-4)*size}" y="${(faceY+1)*size}" width="${size}" height="${size}" fill="${fc}" opacity="0.52"/>`,
          ].join('');
        }
      }
    }

    // outline 모드에 따라 효과 적용 (outlineMode는 위에서 이미 선언됨)
    let outlineRects = '';
    if (outlineMode === 'outline') {
      // 몸통 + 모든 액세서리 픽셀을 통합한 Set으로 아웃라인 생성
      const filled = new Set();
      // 몸통
      for (let y = 0; y < h; y++)
        for (let x = 0; x < map[y].length; x++)
          if (map[y][x] === '1') filled.add(`${x},${y}`);
      // 머리장식 (y offset -3)
      if (headAcc?.pixels?.length)
        headAcc.pixels.forEach(p => filled.add(`${p.x},${p.y - 3}`));
      // 목 장식 (offset 0)
      if (neckAcc?.pixels?.length)
        neckAcc.pixels.forEach(p => filled.add(`${p.x},${p.y}`));
      // 얼굴 (offset 0, 픽셀 기반 프리셋만)
      if (faceAcc?.pixels?.length)
        faceAcc.pixels.forEach(p => filled.add(`${p.x},${p.y}`));
      outlineRects = _buildOutlineFromSet(filled, size);
    }
    const shadowFilter = outlineMode === 'shadow'
      ? ' style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.35)) drop-shadow(0 1px 1px rgba(0,0,0,.25))"'
      : '';

    // 렌더 순서: outline → 머리장식 → 몸통 → 목장식 → 얼굴
    return `<svg class="cigh-clean-pet-svg" viewBox="${viewBox}" width="${totalW}" height="${totalH}" aria-hidden="true"${shadowFilter}>${outlineRects}${headRects}${bodyRects}${neckRects}${faceRects}</svg>`;
  }

  function petSpriteSVG(stageObj, mood, finalType, size = 8, pet = getPet()) {
    // 완전체(stage>=3)이고 이미지 있으면 이미지로 표시
    const frames = stageObj.stage >= 3 ? getPetImageFrames(finalType) : null;
    if (frames && frames.normal) {
      const mode = getPetVisualMode(pet);
      const src = pickPetImageFrame(frames, mode, pet, Date.now());
      if (src) return petImageHTML(src, mode, size);
    }
    return petSpriteSVGWithAccessory(stageObj, mood, finalType, size);
  }

  function petBondLevel(feedCount) {
    const count = Number(feedCount || 0);
    let level = 0;
    for (let i = 0; i < BOND_LEVELS.length; i++) {
      if (count >= BOND_LEVELS[i]) level = i;
    }
    return level;
  }

  function updatePetCharAffinity(pet, deltas = []) {
    pet.charAffinity = pet.charAffinity && typeof pet.charAffinity === 'object' ? pet.charAffinity : {};
    for (const raw of deltas || []) {
      const d = normalizeDelta(raw);
      if (!d) continue;
      const name = relationKey(d.name);
      if (!isValidRelationName(name)) continue;
      const delta = Number(d.delta) || 0;
      const gain = delta > 0 ? delta * 1.35 : delta;
      pet.charAffinity[name] = Number(pet.charAffinity[name] || 0) + gain;
    }
  }

  function getFavoriteCharacter(pet = getPet()) {
    const entries = Object.entries(pet.charAffinity || {})
      .map(([name, value]) => [name, Number(value) || 0])
      .filter(([name, value]) => name && value > 0)
      .sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] || '';
  }

  function growPet(room, merged, latestReply) {
    const pet = getPet(room);
    pet.tally = { ...zeroTally(), ...(pet.tally || {}) };
    const prevLevel = pet.level;
    const prevStage = pet.stage;
    const prevFinalType = pet.finalType || petFinalType(pet.tally);
    const prevBondLevel = Number(pet.bondLevel || 0);
    const deltaSum = (merged.relationshipDeltas || []).reduce((sum, d) => sum + Math.abs(Number(d.delta) || 0), 0);

    const tokenExp = petTokenExpGain(merged?._usageTokens);
    const achvMult = getAchvExpBonusMultiplier();
    pet.exp = Math.max(0, (pet.exp || 0) + Math.round(petExpGain(deltaSum) * achvMult) + tokenExp);
    pet.feedCount = (pet.feedCount || 0) + 1;
    pet.level = petLevelFromExp(pet.exp);
    pet.stage = petStageFromLevel(pet.level).stage;
    pet.mood = detectPetMood(latestReply, deltaSum);
    pet.tally[petMoodBucket(pet.mood)] = Number(pet.tally[petMoodBucket(pet.mood)] || 0) + 1;
    pet.finalType = petFinalType(pet.tally);
    if (prevStage < 3 && pet.stage >= 3 && !TENDENCY_KEYS.includes(String(pet.fixedFinalType || ''))) {
      pet.fixedFinalType = weightedPetFinalType(pet.tally);
    } else if (pet.stage >= 3 && !TENDENCY_KEYS.includes(String(pet.fixedFinalType || ''))) {
      pet.fixedFinalType = pet.finalType;
    }
    pet.bondLevel = petBondLevel(pet.feedCount);
    updatePetCharAffinity(pet, merged.relationshipDeltas || []);
    pet.lastFedAt = Date.now();
    room.pet = pet;

    // [업적] 펫 성장 카운터
    {
      const st = petStageFromLevel(pet.level).stage;
      const state = readAchvState();
      let changed = false;
      const setFlag = (k, cond) => { if (cond && !Number(state.counters[k])) { state.counters[k] = 1; changed = true; } };
      setFlag('petBaby', st >= 1);
      setFlag('petBondMax', Number(pet.bondLevel || 0) >= 4);
      setFlag('petFinal', st >= 4);
      if (changed) { evaluateAchvUnlocks(state); writeAchvState(state); }
    }
    if (petStageFromLevel(pet.level).stage >= 4) bumpAchvFinalForm(getPetDisplayFinalType(pet));

    const displayFinalType = getPetDisplayFinalType(pet);
    const events = [];
    if (pet.stage > prevStage) events.push({ type: 'evolve', stage: pet.stage, level: pet.level, finalType: displayFinalType });
    if (pet.level > prevLevel) events.push({ type: 'level', level: pet.level, finalType: displayFinalType });
    if (pet.stage < 3 && pet.finalType !== prevFinalType) events.push({ type: 'tendency', finalType: pet.finalType, prevFinalType });
    if (pet.stage >= 3 && getPetDisplayFinalType({ ...pet, level: prevLevel }) !== displayFinalType) events.push({ type: 'tendency', finalType: displayFinalType, prevFinalType });
    if (pet.bondLevel > prevBondLevel) events.push({ type: 'bond', bondLevel: pet.bondLevel, finalType: displayFinalType });
    return events.length ? events : null;
  }

  function announcePetEvent(ev) {
    const events = Array.isArray(ev) ? ev : (ev ? [ev] : []);
    if (!events.length) return;

    for (const item of events) {
      if (!item) continue;

      if (item.type === 'evolve') {
        const form = PET_FINAL_FORMS[item.finalType] || PET_FINAL_FORMS.peace;
        const st = PET_STAGES.find(s => s.stage === item.stage) || PET_STAGES[0];
        const name = item.stage >= 4 ? form.name : st.name;
        pushLog([`▶펫이 진화했다! → ${name} (Lv.${item.level})`]);
        showPopup([`▶펫이 ${name}(으)로 진화했다!`]);
        playBeep('evolve');
        pendingPetCelebrate = 'evolve';
        mascotSay(petEventLine(item, getPet()), 90);
      } else if (item.type === 'level') {
        pushLog([`▷펫이 레벨업했다! Lv.${item.level}`]);
        playBeep('levelup');
        pendingPetCelebrate = 'level';
        mascotSay(petEventLine(item, getPet()), 90);
      } else if (item.type === 'tendency') {
        mascotSay(petEventLine(item, getPet()), 85);
      } else if (item.type === 'bond') {
        mascotSay(petEventLine(item, getPet()), 90);
      }
    }
  }

  let lastPetTouch = 0;
  let pendingPetCelebrate = null;
  let mascotWanderTimer = null;
  let mascotIdleTimer = null;
  let mascotDragState = null;
  let mascotSpeechTimer = null;
  let mascotMoodFxTimer = null;
  let lastMascotPoke = 0;
  let mascotPokeCount = 0;
  let mascotSayUntil = 0;
  let mascotSayPriority = 0;
  let lastMascotMoodFxAt = 0;

  const PET_LINES = {
    love: ['두근두근... 나 어떡해', '심장 터질 것 같아!', '이거 완전 설레잖아', '꺅 나도 두근거려'],
    happy: ['헤헤 기분 좋아', '오늘 너무 행복해', '이런 분위기 최고야', '히히 신난다'],
    normal: ['음~ 평화롭다', '오늘도 평범하게 좋아', '뭐 하고 놀까?', '나 여기 잘 있어'],
    sad: ['조금 슬퍼...', '괜찮아질 거야, 그치?', '마음이 시큰해', '옆에 있어줄래?'],
    scared: ['으... 무서워', '심장 쫄깃해졌어', '긴장돼 죽겠어', '꼭 붙어있을래'],
  };
  const PET_PET_LINES = ['에헤헤 간지러워', '더 쓰다듬어줘!', '좋아좋아~', '헤헤 기분 좋다', '또 해줘!', '꺅 부끄러워'];
  const PET_LINES_BY_TENDENCY = {
    heart: {
      love: ['{name} 너 진짜 좋아!', '헤헤, 더 가까이 와', '두근두근 못 참아!', '좋아해서 터질래!'],
      happy: ['헤헤 좋아좋아~', '오늘 완전 행복해!', '같이 있으니 좋아', '나 지금 들떴어!'],
      normal: ['나 여기 얌전히 있어', '뭐 하고 놀까?', '네 옆이 제일 좋아', '심심하면 불러줘'],
      sad: ['힝... 안아주라', '나 조금 속상해', '곁에 있어줄래?', '울적해서 기대고파'],
      scared: ['무서워, 꼭 붙을래', '손 잡아주면 안 돼?', '으앙 나 떨려', '나 숨겨줘, 제발'],
    },
    bloom: {
      love: ['꺄아 완전 두근!', '이거 로맨스잖아!', '나까지 설레버림!', '꽃가루 터질 뻔!'],
      happy: ['오늘 완전 신난다!', '텐션 쭉쭉 올라!', '우와 재밌다!', '나 지금 반짝반짝!'],
      normal: ['뭐 재밌는 거 없어?', '심심하면 나 불러!', '햇살 같지 않아?', '나 둥둥 떠다님!'],
      sad: ['으악 마음 찡해!', '울면 내가 놀아줄게!', '기운 내자, 응?', '분위기 바꿔볼까?'],
      scared: ['우왁 깜짝이야!', '도망갈 준비 완료!', '나 지금 얼음 됨!', '그래도 버텨보자!'],
    },
    peace: {
      love: ['음~ 따뜻하다', '마음이 포근해', '천천히 좋아하자', '같이 있으면 좋아'],
      happy: ['음~ 평화롭다', '오늘 잔잔해서 좋아', '기분이 몽글해', '느긋하게 웃자'],
      normal: ['천천히 해도 돼', '나는 여기 있어', '조용해서 좋다', '오늘도 무난해'],
      sad: ['괜찮아, 쉬어가자', '조금 쉬면 나아져', '옆에 있어줄게', '천천히 울어도 돼'],
      scared: ['천천히 숨 쉬자', '괜찮아, 여기 있어', '놀랐지? 쉬자', '조용히 숨어있자'],
    },
    tear: {
      love: ['마음이 울렁해…', '이런 다정함 약해…', '조금 울컥했어…', '따뜻해서 눈물 나'],
      happy: ['기뻐서 울 것 같아', '오늘은 덜 쓸쓸해', '작게 웃어도 돼?', '햇빛이 예쁘다…'],
      normal: ['조용히 곁에 있을게', '오늘은 잔잔하네', '혼자는 아닌 거지?', '가만히 기대고파'],
      sad: ['나도 마음 아파…', '조금 울어도 돼?', '쓸쓸해서 그래…', '괜히 눈물 나…'],
      scared: ['떨려서 숨 막혀…', '혼자 두지 마…', '무서운데 참을게', '손끝이 차가워…'],
    },
    blade: {
      love: ['흥, 싫진 않아', '…좋다고는 안 했어', '가까워도 봐준다', '딱히 설렌 건 아냐'],
      happy: ['뭐, 나쁘진 않네', '흥, 꽤 괜찮아', '이 정도면 합격', '조금은 신나네'],
      normal: ['별일 없네', '난 멀쩡해', '지켜보고 있어', '방심하지 마'],
      sad: ['…괜찮다니까', '조금 조용히 있어', '흔들린 건 아니야', '신경 쓰지 마'],
      scared: ['긴장한 거 아냐', '뒤는 내가 볼게', '흥, 겁먹지 마', '…조심하라고'],
    },
  };
  const PET_PET_LINES_BY_TENDENCY = {
    heart: ['헤헤 좋아좋아~', '더 쓰다듬어줘!', '나 녹아버릴래', '꺅 부끄러워!', '또 해줘 또!'],
    bloom: ['우와 간지러워!', '나 지금 날아가!', '한 번 더! 빨리!', '꺄르르 재밌다!', '머리 쓰담 최고!'],
    peace: ['음~ 포근하다', '천천히 쓰다듬어줘', '기분이 잔잔해', '좋다, 편안해', '몽글몽글해'],
    tear: ['조심히 해줘…', '따뜻해서 좋아…', '나 울컥했어', '계속 곁에 있어줘', '살살이면 좋아…'],
    blade: ['흥, 간지럽잖아', '…나쁘진 않네', '딱 한 번만 더', '별거 아닌데 좋아', '손길은 합격'],
  };
  const PET_PARTICLE_COLORS = ['#ff9ec4', '#ffd166', '#b6a3e0', '#a8e0b0', '#9ecbf0', '#ffd9a8', '#8fb4e0'];

  function pickRandom(list, fallback = '') {
    const safe = Array.isArray(list) && list.length ? list : (fallback ? [fallback] : []);
    return safe.length ? safe[Math.floor(Math.random() * safe.length)] : '';
  }

  function getPetName() {
    return String(localStorage.getItem(PET_NAME_STORE) || '').trim().slice(0, 12);
  }

  function setPetName(value) {
    const name = String(value || '').trim().slice(0, 12);
    if (name) localStorage.setItem(PET_NAME_STORE, name);
    else localStorage.removeItem(PET_NAME_STORE);
  }

  function renderPetLineTemplate(line, pet = getPet()) {
    const name = getPetName();
    let out = String(line || '');
    if (out.includes('{name}')) {
      out = name
        ? out.split('{name}').join(name)
        : out.split('{name} ').join('').split('{name}').join('나');
    }
    return shortText(out.replace(/\s+/g, ' ').trim(), 34);
  }

  function petTendency(pet) {
    const value = String(pet?.finalType || 'peace');
    return TENDENCY_KEYS.includes(value) ? value : 'peace';
  }

  function getEffectiveMood(pet = getPet()) {
    const last = Number(pet?.lastFedAt || 0);
    if (last && Date.now() - last < MOOD_WINDOW) return String(pet?.mood || 'normal');
    return 'normal';
  }

  function petBpmForMood(mood) {
    const base = { love: 118, scared: 122, happy: 96, normal: 72, sad: 58 }[String(mood || 'normal')] || 72;
    const wobble = Math.floor(Math.random() * 7) - 3;
    return clamp(base + wobble, 50, 130);
  }

  function petSpeakLocal(pet) {
    const mood = getEffectiveMood(pet);
    const tendency = petTendency(pet);
    return renderPetLineTemplate(pickRandom(
      PET_LINES_BY_TENDENCY[tendency]?.[mood] || PET_LINES[mood] || PET_LINES.normal,
      '나 여기 있어'
    ), pet);
  }

  function petPetLineLocal(pet) {
    const tendency = petTendency(pet);
    return renderPetLineTemplate(pickRandom(
      PET_PET_LINES_BY_TENDENCY[tendency] || PET_PET_LINES,
      '좋아좋아~'
    ), pet);
  }

  function isEggStagePet(pet = getPet()) {
    return petStageFromLevel(Number(pet?.level || 1)).stage === 0;
  }

  function triggerEggTapFeedback() {
    const mascot = document.getElementById(MASCOT_ID);
    if (mascot) {
      mascot.classList.remove('egg-poke');
      void mascot.offsetWidth;
      mascot.classList.add('egg-poke');
      setTimeout(() => mascot.classList.remove('egg-poke'), 420);
    }
    const sprite = document.querySelector(`#${PANEL_ID} .cigh-clean-pet-sprite`);
    if (sprite) {
      sprite.classList.remove('egg-poke');
      void sprite.offsetWidth;
      sprite.classList.add('egg-poke');
      setTimeout(() => sprite.classList.remove('egg-poke'), 420);
    }
  }

  function petPet() {
    const now = Date.now();
    if (now - lastPetTouch < 1200) return;
    lastPetTouch = now;

    const currentPet = getPet();
    if (isEggStagePet(currentPet)) {
      triggerEggTapFeedback();
      playBeep('tab');
      return;
    }

    let nextPet = null;
    updateRoom(r => {
      const p = getPet(r);
      p.lastLine = petPetLineLocal(p);
      p.lastLineAt = now;
      r.pet = p;
      nextPet = p;
    });

    touchPetVisual('smile', PET_VISUAL_SMILE_MS);
    updatePetPanelSpeech(nextPet);
    updatePetPanelMoodLabel(nextPet);
    bumpAchvCounter('petTouch', 1);
    announceAchvUnlocks();
    playBeep('tab');
  }

  function mascotSay(text, priority = 0) {
    if (!isMascotEnabled()) return false;
    const line = renderPetLineTemplate(text, getPet());
    if (!line) return false;

    const now = Date.now();
    if (priority < 100 && now < mascotSayUntil && priority <= mascotSayPriority) return false;

    const cooldown = priority >= 80 ? 1200 : priority >= 40 ? 4000 : 8000;
    showMascotSpeech(line);
    mascotSayUntil = now + cooldown;
    mascotSayPriority = priority;
    setTimeout(() => {
      if (Date.now() >= mascotSayUntil) mascotSayPriority = 0;
    }, cooldown + 80);
    return true;
  }

  function petEventLine(ev, pet = getPet()) {
    const tendency = petTendency(pet);
    const map = {
      evolve: {
        heart: ['나 좀 예뻐졌지?', '헤헤 더 좋아해줘!'],
        bloom: ['짠! 나 업그레이드!', '우와 나 피어났어!'],
        peace: ['음~ 조금 자랐어', '나 느긋하게 컸어'],
        tear: ['나… 조금 변했어', '눈물만큼 자랐어…'],
        blade: ['흥, 강해졌을 뿐이야', '딱히 멋져진 건 아냐'],
      },
      level: {
        heart: ['나 레벨 올랐어!', '칭찬해줘, 빨리!'],
        bloom: ['레벨업! 빰빠밤!', '나 완전 신났어!'],
        peace: ['조금 더 자랐네', '천천히 강해졌어'],
        tear: ['나도 조금은 컸어…', '기특하지 않아…?'],
        blade: ['당연한 성장이지', '흥, 이 정도쯤이야'],
      },
      tendency: {
        heart: ['나… 애정이 많나 봐', '좋아하는 게 티 나?'],
        bloom: ['나 명랑한 애였네!', '꽃처럼 팡 피었어!'],
        peace: ['난 잔잔한 쪽이네', '평화로운 게 좋아'],
        tear: ['나 감성이 깊은가 봐…', '조금 여린 애였네…'],
        blade: ['…까칠한 게 뭐 어때', '난 원래 이런 쪽이야'],
      },
      bond: {
        heart: ['우리 더 친해졌지?', '이제 더 붙어있자!'],
        bloom: ['친밀도 업! 예이!', '우리 팀워크 좋아!'],
        peace: ['조금 더 가까워졌네', '편해져서 좋아'],
        tear: ['이제 덜 외로워…', '곁에 있어줘서 좋아'],
        blade: ['뭐, 좀 믿을 만하네', '조금은 인정해줄게'],
      },
    };
    return pickRandom(map[ev?.type]?.[tendency] || map[ev?.type]?.peace || [], '나 조금 자랐어');
  }

  function relationMascotLine(deltas = [], pet = getPet()) {
    const picked = (deltas || [])
      .map(normalizeDelta)
      .filter(Boolean)
      .sort((a, b) => Math.abs(Number(b.delta) || 0) - Math.abs(Number(a.delta) || 0))[0];
    if (!picked || Math.abs(Number(picked.delta) || 0) < 5) return '';

    const tendency = petTendency(pet);
    const name = relationKey(picked.name);
    const positive = Number(picked.delta) > 0;
    const lines = positive ? {
      heart: [`${name}이랑 확 가까워졌어!`, `${name} 좋다, 헤헤!`],
      bloom: [`${name}이랑 분위기 업!`, `${name} 호감 터졌다!`],
      peace: [`${name}이랑 편해졌네`, `${name}과 잔잔히 좋아졌어`],
      tear: [`${name}이 따뜻해졌어…`, `${name} 때문에 울컥해…`],
      blade: [`${name}, 제법 괜찮네`, `${name}은 봐줄 만해`],
    } : {
      heart: [`${name}이랑 좀 멀어졌어…`, `${name} 분위기 슬퍼…`],
      bloom: [`${name} 쪽 공기 싸늘!`, `${name}이랑 삐걱했어!`],
      peace: [`${name}과 잠깐 쉬자`, `${name} 분위기 가라앉았어`],
      tear: [`${name} 때문에 마음 아파…`, `${name}과 쓸쓸해졌어…`],
      blade: [`${name}, 방심하면 안 돼`, `${name} 분위기 별로네`],
    };
    return pickRandom(lines[tendency] || lines.peace, '관계가 흔들렸어');
  }

  function milestoneMascotLine(pet = getPet()) {
    const count = Number(pet.feedCount || 0);
    const milestones = [50, 100, 200, 300, 500];
    const hit = milestones.find(n => count === n);
    if (!hit) return '';

    pet.shownMilestones = Array.isArray(pet.shownMilestones) ? pet.shownMilestones : [];
    const key = `feed-${hit}`;
    if (pet.shownMilestones.includes(key)) return '';
    pet.shownMilestones.push(key);
    pet.shownMilestones = pet.shownMilestones.slice(-20);
    return `우리 벌써 ${hit}번째야!`;
  }

  function comboMascotLine(prevLastFedAt, pet = getPet()) {
    if (!prevLastFedAt) return '';
    const gap = Date.now() - Number(prevLastFedAt || 0);
    const tendency = petTendency(pet);
    if (gap < 60 * 1000) {
      return pickRandom({
        heart: ['오늘 얘기 많아서 좋아!', '계속 불러줘서 좋아!'],
        bloom: ['콤보 이어간다!', '오늘 텐션 장난 아냐!'],
        peace: ['이야기가 잘 흐르네', '계속 이어가도 좋아'],
        tear: ['계속 곁에 있네…', '안 끊겨서 좋아…'],
        blade: ['흠, 꽤 빠르네', '집중력은 괜찮네'],
      }[tendency], '오늘 얘기 많네!');
    }
    if (gap > MASCOT_IDLE_MS) {
      return pickRandom({
        heart: ['오랜만이야, 보고팠어!', '나 기다렸단 말이야'],
        bloom: ['드디어 왔다!', '심심해 죽는 줄!'],
        peace: ['오랜만이네, 어서 와', '천천히 다시 하자'],
        tear: ['혼자라 쓸쓸했어…', '다시 와줘서 좋아…'],
        blade: ['흥, 이제 왔어?', '뭐… 기다린 건 아냐'],
      }[tendency], '오랜만이야');
    }
    return '';
  }

  function idleMascotLine(pet = getPet()) {
    const tendency = petTendency(pet);
    const mood = getEffectiveMood(pet);
    const stage = petStageFromLevel(pet?.level || 1);
    const acc = getMascotAccessory();
    const head = acc?.head || 'none';
    const neck = acc?.neck || 'none';

    // 액세서리 관련 대사
    const accLines = {
      crown:  { heart:['왕관 어울려?','이 왕관 내 거야!'], bloom:['왕관 쓰면 기분 달라!','나 여왕이야!'], peace:['왕관 무게가 딱 좋아','조용한 여왕이랄까'], tear:['왕관이 무거워…','이 왕관 외로워…'], blade:['왕관은 강한 자의 것','당연히 내 거지'] },
      ribbon: { heart:['리본 귀엽지? 헤헤','리본 해줘서 고마워!'], bloom:['리본이 팔랑팔랑!','나 귀여워 죽겠어!'], peace:['리본이 마음에 들어','오늘도 차분하게'], tear:['리본이 위로가 돼…','이 리본 소중해…'], blade:['리본 정도는 허락해줌','귀엽다고 말하지 마'] },
      horn:   { heart:['뿔이 생겼어! 신기해!','뿔 만져봐도 돼!'], bloom:['유니콘이다!!!','뿔로 무지개 그릴게!'], peace:['뿔은 고요한 힘이야','뿔의 무게가 좋아'], tear:['뿔이 있어도 외로워…','뿔로 찌를 수도 없어…'], blade:['이 뿔은 무기야','가까이 오지 마'] },
      star:   { heart:['별 달았어! 반짝!','나 슈퍼스타야!'], bloom:['별빛 파워 충전!','나 진짜 빛나지?!'], peace:['별처럼 고요하게','별빛은 잔잔해'], tear:['별도 외로운 거 알지…','저 별은 나 같아…'], blade:['별 정도는 어울리지','반짝인다고 기뻐 마'] },
      flower: { heart:['꽃 꽂아줘서 좋아!','꽃처럼 예뻐지고 싶어!'], bloom:['꽃이야 꽃! 봄이야!','꽃 향기 나는 것 같아!'], peace:['꽃은 느긋하게 피어나','꽃처럼 천천히'], tear:['꽃도 지는 날이 있어…','꽃말이 뭔지 궁금해…'], blade:['꽃 달아도 안 귀여운 거 아냐','그냥 멋있는 거라고'] },
      scarf:  { heart:['스카프 따뜻해!','이거 {name}이 줬어?'], bloom:['스카프 두르고 모험!','따뜻하면 뭐든 가능해!'], peace:['스카프가 포근해','이 온기가 좋아'], tear:['포근한데 왜 외롭지…','스카프 속에 숨고 싶어…'], blade:['스카프 정도는 허용','체온 관리는 기본이야'] },
    };
    const accKey = head !== 'none' ? head : neck !== 'none' ? neck : null;
    if (accKey && accLines[accKey] && Math.random() < 0.22) {
      return pickRandom(accLines[accKey][tendency] || accLines[accKey].peace, '');
    }

    // 스테이지별 대사
    if (stage.stage === 0 && Math.random() < 0.25) {
      return pickRandom({
        heart: ['알 속에서 두근두근!','나 언제 나와?'],
        bloom: ['빨리 나가고 싶어!','알이 좁아!'],
        peace: ['아직 알 안에…','천천히 부화할게'],
        tear: ['알 속이 외로워…','나와도 되는 거야…?'],
        blade: ['방해하지 마, 준비 중이야','때 되면 나와'],
      }[tendency], '알 속에서 기다리는 중');
    }
    if (stage.stage >= 4 && Math.random() < 0.20) {
      return pickRandom({
        heart: ['완전체! 이제 어디든 가자!','나 최강이야! 같이!'],
        bloom: ['완전체 달성! 파티하자!','이게 진짜 나야!'],
        peace: ['완전체가 됐어, 조용히','여기서 더 자랄 수 있을까'],
        tear: ['완전체인데 왜 허전하지…','이제 어디로 가야 해…'],
        blade: ['완전체. 당연한 결과','만족하진 않아. 아직'],
      }[tendency], '완전체가 됐어');
    }

    // 기본 idle 대사 — 기존보다 많이 확장
    const baseLines = {
      heart: [
        '나 심심해 놀아줘', '쓰다듬어주면 안 돼?',
        '{name} 생각하고 있었어', '같이 있으면 두근거려',
        '오늘 기분 어때?', '나 뭔가 하고 싶어!',
        '심심해, 말 걸어줘', '나 지금 여기 있어!',
        '뭔가 달콤한 거 먹고 싶다', '오늘 하루 잘 보내고 있어?',
        '나만 보면 안 돼?', '같이 뭔가 하고 싶어!',
        '{name}이 웃으면 나도 좋아', '오늘도 곁에 있어줄 거지?',
        '나 여기 있는 거 알지?', '오늘 뭐 했어?',
      ],
      bloom: [
        '심심해 죽겠어!', '뭐 재밌는 거 하자!',
        '에너지 넘쳐서 어떡해!', '뭔가 쾅 터트리고 싶어!',
        '나 지금 엄청 신나는데?', '가만있기 너무 힘들어!',
        '누군가 불러줘요!', '어디 모험이라도 떠나자!',
        '가만있으면 터질 것 같아!', '놀자 놀자 놀자!',
        '뭔가 빵 터지는 거 없어?', '오늘 날씨 좋지 않아?!',
        '지금 당장 뛰어나가고 싶어!', '텐션이 하늘을 뚫을 것 같아!',
        '나 오늘 엄청 컨디션 좋아!', '같이 뭔가 신나는 거 하자!!',
      ],
      peace: [
        '조용히 기다리는 중',
        '이 고요함이 좋아', '바람 소리가 들려',
        '천천히 숨 쉬는 중', '지금 이 순간도 괜찮아',
        '잔잔하게 여기 있을게', '아무것도 안 해도 돼',
        '이런 시간도 나쁘지 않아',
        '천천히 흘러가는 게 좋아', '서두르지 않아도 돼',
        '이대로가 편해', '조용한 게 제일 좋더라',
        '뭔가 따뜻한 거 마시고 싶다', '오늘은 느긋하게 가자',
      ],
      tear: [
        '혼자 있으니 쓸쓸해…', '나 잊은 건 아니지…?',
        '조용히 있으면 마음이 말랑해져…', '뭔가 그리운 게 있어…',
        '가끔 이렇게 멍때려…', '나 여기 있어, 알지?',
        '슬픈 건 아닌데 왠지…', '그냥 같이 있어줘…',
        '이 고요함이 좀 외로워…', '말 안 해도 곁에 있어줘…',
        '뭔가 마음 한켠이 서늘해…', '오늘따라 혼자인 게 크게 느껴져…',
        '이런 날엔 따뜻한 말 한마디가 고파…', '괜찮냐고 물어봐 줘…',
        '가끔은 그냥 안겨있고 싶어…', '나 여기 있는데 왜 아무도…',
      ],
      blade: [
        '흥, 바쁜가 보지', '기다린 건 아니거든',
        '혼자 있는 게 편하긴 해', '불러도 바로 안 와도 돼',
        '…뭐야, 눈치 없이 쳐다봐?', '난 내 할 거 하는 중이야',
        '방해하지 마, 생각 중이야', '나한테 의존하지 마',
        '...사실 조금 심심하긴 한데', '뭐 볼 거 있어? 가',
        '조용한 게 좋아, 원래', '뭐 기대하는 거야, 말 안 해',
        '흠, 이 상황 나쁘지는 않은데', '…그냥 있는 거야, 아무것도 아냐',
        '말 걸지 마, 지금 집중 중이거든', '흥, 너도 할 일이나 해',
      ],
    };

    // mood 따라 추가 감정 대사 섞기
    if (mood === 'love' && Math.random() < 0.3) {
      return pickRandom({
        heart: ['지금 엄청 행복해!','사랑받는 기분이야!'],
        bloom: ['오늘 텐션 최고야!','세상이 반짝반짝!'],
        peace: ['따뜻해서 좋아','이 감정이 편해'],
        tear: ['행복한데 눈물 날 것 같아…','이 순간 간직하고 싶어…'],
        blade: ['...뭐, 기분이 나쁘지는 않아','흥, 이런 기분도 있구나'],
      }[tendency], '기분이 좋아');
    }
    if (mood === 'sad' && Math.random() < 0.3) {
      return pickRandom({
        heart: ['나 좀 기운 없어…','안아줄 수 있어…?'],
        bloom: ['텐션 0…회복 중…','힘내야 하는데…'],
        peace: ['지금은 조용히 있을게','괜찮아, 그냥 쉬는 거야'],
        tear: ['마음이 무거워…','혼자 울면 안 되는데…'],
        blade: ['약한 거 아니야, 그냥 오늘만','아무도 몰라도 돼'],
      }[tendency], '기운이 없어');
    }

    // 졸림/수면 계열 대사는 밤·새벽에만
    const hour = new Date().getHours();
    const isNightTime = hour >= 22 || hour <= 6;
    const sleepyLines = {
      peace: ['음~ 졸려…', '눈 감으면 평화로워'],
      tear:  ['나 여기 있는데 왜 아무도…'],
      heart: [],
      bloom: [],
      blade: [],
    };
    let pool = [...(baseLines[tendency] || baseLines.peace)];
    if (isNightTime && sleepyLines[tendency]?.length) {
      pool = pool.concat(sleepyLines[tendency]);
    }
    return pickRandom(pool, '나 여기 있어');
  }

  function timeMascotLine(pet = getPet()) {
    const hour = new Date().getHours();
    const tendency = petTendency(pet);
    let bucket = 'day';
    if (hour >= 0 && hour <= 5) bucket = 'dawn';
    else if (hour >= 6 && hour <= 10) bucket = 'morning';
    else if (hour >= 18 && hour <= 23) bucket = 'night';

    const lines = {
      dawn: {
        heart: ['너 안 자…? 걱정돼', '같이 밤새는 거야?'],
        bloom: ['새벽 텐션 위험해!', '아직 안 잔다고?!'],
        peace: ['슬슬 자도 돼', '밤공기가 조용하네'],
        tear: ['새벽은 좀 쓸쓸해…', '잠 못 드는 거야…?'],
        blade: ['이 시간까지 뭐 해', '졸리면 자, 바보야'],
      },
      morning: {
        heart: ['좋은 아침이야!', '오늘도 같이 있자!'],
        bloom: ['아침이다! 반짝!', '오늘 시작 좋아!'],
        peace: ['좋은 아침, 천천히', '햇빛이 부드럽네'],
        tear: ['아침이라 조금 나아…', '오늘은 덜 외롭길'],
        blade: ['일어났으면 움직여', '아침부터 방심 금지'],
      },
      day: {
        heart: ['오늘도 곁에 있을게', '불러줘서 좋아'],
        bloom: ['낮이라 힘난다!', '뭔가 할 시간!'],
        peace: ['낮은 잔잔해서 좋아', '천천히 가자'],
        tear: ['빛이 따뜻하네…', '조금은 괜찮아졌어'],
        blade: ['낮이라고 느슨해지지 마', '계속 보고 있어'],
      },
      night: {
        heart: ['밤엔 더 붙어있자', '졸리면 기대도 돼'],
        bloom: ['밤 산책 가고 싶다!', '밤인데도 신나!'],
        peace: ['슬슬 쉬어도 좋아', '밤은 조용해서 좋다'],
        tear: ['밤은 마음이 말랑해…', '괜히 울컥하는 밤…'],
        blade: ['늦었으면 쉬어', '무리하지 말라니까'],
      },
    };
    return pickRandom(lines[bucket]?.[tendency] || lines.day.peace, '천천히 가자');
  }

  function favoriteMascotLine(pet = getPet()) {
    const fav = getFavoriteCharacter(pet);
    if (!fav) return '';
    const tendency = petTendency(pet);
    return pickRandom({
      heart: [`난 ${fav}이 좋더라`, `${fav}, 왠지 좋아!`],
      bloom: [`${fav} 있으면 재밌어!`, `${fav} 텐션 좋아!`],
      peace: [`${fav}은 편한 느낌이야`, `${fav} 곁은 잔잔해`],
      tear: [`${fav} 생각하면 울컥해…`, `${fav}은 마음 쓰여…`],
      blade: [`${fav}은 좀 인정`, `${fav}, 나쁘진 않아`],
    }[tendency], `${fav}이 좋아`);
  }

  // 방치 시간별 대사
  function idleTimeMascotLine(pet = getPet()) {
    const last = Number(pet?.lastFedAt || 0);
    if (!last) return '';
    const gap = Date.now() - last;
    const mins = Math.floor(gap / 60000);
    const tendency = petTendency(pet);
    if (mins < 3) return '';
    if (mins < 10) {
      return pickRandom({
        heart: ['잠깐만 뭐 해?','나 기다리고 있는 거 알지?'],
        bloom: ['빨리빨리! 심심해!','뭔가 하면 안 돼?'],
        peace: ['괜찮아, 천천히 해','기다리는 것도 나쁘지 않아'],
        tear: ['조금 기다렸어…','나 잊은 건 아니지?'],
        blade: ['흠, 좀 걸리네','뭐 하는 거야, 느린'],
      }[tendency], '기다리는 중');
    }
    if (mins < 30) {
      return pickRandom({
        heart: [`${mins}분이나 기다렸잖아!`,'나 여기 있는데…'],
        bloom: ['심심함 한계야!','뭔가 해줘요!!'],
        peace: ['이 고요함도 나쁘지 않아','그래도 이야기 듣고 싶어'],
        tear: [`${mins}분 혼자였어…`,'쓸쓸했어, 사실'],
        blade: ['흥, 느긋하게 기다려줬지','바쁜 거 알아, 그래도'],
      }[tendency], `${mins}분 기다렸어`);
    }
    return pickRandom({
      heart: ['오래 기다렸어, 보고 싶었어!','드디어 나 생각했구나!'],
      bloom: ['돌아왔다! 환영!','이제 같이 뭔가 하자!'],
      peace: ['오랜만이야. 잘 지냈어?','다시 만났네'],
      tear: ['오래됐어… 외로웠어…','다시 봐서 다행이야…'],
      blade: ['이제 왔어? 느렸는데','뭐, 돌아왔으니까 됐어'],
    }[tendency], '오랜만이야');
  }

  // 레벨/성장 독백
  function growthMascotLine(pet = getPet()) {
    const level = Number(pet?.level || 1);
    const feedCount = Number(pet?.feedCount || 0);
    const tendency = petTendency(pet);
    if (level >= 10 && Math.random() < 0.3) {
      return pickRandom({
        heart: [`레벨 ${level}이야! 같이 커온 거잖아!`,'우리 꽤 오래됐지?'],
        bloom: [`레벨 ${level}! 나 강해졌어!`,'성장이 느껴져!'],
        peace: [`레벨 ${level}… 천천히 왔네`,'여기까지 온 게 신기해'],
        tear: [`레벨 ${level}인데… 아직 갈 길이…`,'같이 있어줘서 커진 것 같아…'],
        blade: [`레벨 ${level}. 당연한 결과야`,'아직 부족하지만'],
      }[tendency], `레벨 ${level}이야`);
    }
    if (feedCount > 0 && feedCount % 10 === 0 && Math.random() < 0.4) {
      return pickRandom({
        heart: [`벌써 ${feedCount}번이야! 헤헤!`,'우리 많이 이야기했다!'],
        bloom: [`${feedCount}번 이야기했어! 대기록!`,'기록 갱신!'],
        peace: [`${feedCount}번… 꽤 됐네`,'조금씩 쌓인 거야'],
        tear: [`${feedCount}번… 그만큼 곁에 있었어…`,'이 숫자가 소중해…'],
        blade: [`${feedCount}번. 수치로 보니 꽤 많네`,'효율적이었다고 봐야 하나'],
      }[tendency], `${feedCount}번 이야기했어`);
    }
    return '';
  }

  function ambientMascotLine(pet = getPet()) {
    const r = Math.random();
    // 방치 시간 대사 — 먼저 체크
    const idleTimeLine = idleTimeMascotLine(pet);
    if (idleTimeLine && r < 0.30) return idleTimeLine;
    // 시간대 대사
    if (r < 0.22) return timeMascotLine(pet);
    // 성장 독백
    const growthLine = growthMascotLine(pet);
    if (growthLine && r < 0.40) return growthLine;
    // 좋아하는 캐릭터 언급
    if (r < 0.18) { const fl = favoriteMascotLine(pet); if (fl) return fl; }
    // 기본 speak
    return petSpeakLocal(pet);
  }

  function spawnPetParticles(host, kind = 'level') {
    if (!host) return;
    const count = kind === 'evolve' ? 20 : 13;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const ang = (Math.PI * 2 * i) / count + (Math.random() * 0.5 - 0.25);
      const dist = (kind === 'evolve' ? 34 : 24) + Math.random() * 18;
      p.className = 'cigh-clean-particle';
      p.style.setProperty('--dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
      p.style.setProperty('--dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
      p.style.background = PET_PARTICLE_COLORS[i % PET_PARTICLE_COLORS.length];
      host.appendChild(p);
      setTimeout(() => p.remove(), 760);
    }
  }

  // ─────────────────────────────────────────────
  // Mascot (시메지풍 화면 마스코트)
  // ─────────────────────────────────────────────
  function isMascotEnabled() {
    return localStorage.getItem(MASCOT_STORE) === '1';
  }

  function setMascotEnabled(on) {
    localStorage.setItem(MASCOT_STORE, on ? '1' : '0');
  }

  function saveMascotPos(el) {
    const r = el.getBoundingClientRect();
    el.dataset.homeLeft = String(r.left);
    el.dataset.homeTop = String(r.top);
    localStorage.setItem(MASCOT_POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
  }

  function restoreMascotPos(el) {
    let left = Math.max(0, innerWidth - 96);
    let top = Math.max(0, innerHeight - 170);
    try {
      const pos = JSON.parse(localStorage.getItem(MASCOT_POS_KEY) || 'null');
      if (pos) {
        left = clamp(pos.left, 0, innerWidth - 60);
        top = clamp(pos.top, 0, innerHeight - 80);
      }
    } catch {}
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.homeLeft = String(left);
    el.dataset.homeTop = String(top);
  }

  function updateMascotSprite() {
    const el = document.getElementById(MASCOT_ID);
    if (!el) return;
    const body = el.querySelector('.cigh-clean-mascot-body');
    renderPetSpriteInto(body, getMascotSize());
  }

  function showMascotSpeech(text) {
    const el = document.getElementById(MASCOT_ID);
    if (!el) return;
    const sp = el.querySelector('.cigh-clean-mascot-speech');
    if (!sp) return;
    sp.textContent = shortText(text, 30);
    sp.classList.add('show');
    clearTimeout(mascotSpeechTimer);
    mascotSpeechTimer = setTimeout(() => sp.classList.remove('show'), 3200);
  }

  function ensureMascotFxLayer(el = document.getElementById(MASCOT_ID)) {
    if (!el) return null;
    let fx = el.querySelector('.cigh-clean-mascot-fx');
    if (!fx) {
      fx = document.createElement('div');
      fx.className = 'cigh-clean-mascot-fx';
      el.appendChild(fx);
    }
    return fx;
  }

  function clearMascotMoodFx(el = document.getElementById(MASCOT_ID)) {
    clearTimeout(mascotMoodFxTimer);
    if (!el) return;
    el.classList.remove('cigh-clean-mascot-happy', 'cigh-clean-mascot-scared', 'cigh-clean-mascot-sad');
    el.querySelectorAll('.cigh-clean-mascot-blush').forEach(node => node.remove());
    const fx = el.querySelector('.cigh-clean-mascot-fx');
    if (fx) fx.textContent = '';
  }

  function addMascotFxDot(fx, options = {}) {
    if (!fx) return;
    const dot = document.createElement('span');
    dot.className = `cigh-clean-mascot-fx-dot ${options.className || ''}`.trim();
    dot.textContent = options.text || '';
    dot.style.left = `${options.left ?? 50}%`;
    dot.style.top = `${options.top ?? 52}%`;
    dot.style.setProperty('--mx', `${options.dx ?? 0}px`);
    dot.style.setProperty('--my', `${options.dy ?? -26}px`);
    dot.style.setProperty('--dur', `${options.duration ?? 900}ms`);
    if (options.color) {
      dot.style.background = options.color;
      dot.style.color = options.color;
    }
    fx.appendChild(dot);
    setTimeout(() => dot.remove(), (options.duration ?? 900) + 120);
  }

  function addMascotBlush(body) {
    if (!body) return;
    ['left', 'right'].forEach(side => {
      const blush = document.createElement('span');
      blush.className = `cigh-clean-mascot-blush ${side}`;
      body.appendChild(blush);
      setTimeout(() => blush.remove(), 2500);
    });
  }

  function triggerMascotMood(mood, deltaSum = 0) {
    if (!isMascotEnabled()) return;

    const now = Date.now();
    if (now - lastMascotMoodFxAt < 650) return;
    lastMascotMoodFxAt = now;

    const el = ensureMascot();
    if (!el) return;

    clearMascotMoodFx(el);

    const currentMood = String(mood || 'normal');
    if (currentMood === 'normal') return;

    const tier = Number(deltaSum || 0) >= 8 ? 2 : Number(deltaSum || 0) >= 3 ? 1 : 0;
    const fx = ensureMascotFxLayer(el);
    const body = el.querySelector('.cigh-clean-mascot-body');
    const extra = tier * 3;
    const durBoost = tier * 120;

    if (currentMood === 'love') {
      addMascotBlush(body);
      for (let i = 0; i < 6 + extra; i++) {
        addMascotFxDot(fx, {
          className: 'heart',
          text: i % 2 ? '♥' : '',
          left: 28 + Math.random() * 48,
          top: 36 + Math.random() * 18,
          dx: (Math.random() - 0.5) * (24 + tier * 10),
          dy: -32 - Math.random() * (20 + tier * 9),
          duration: 920 + i * 50 + durBoost,
          color: PET_PARTICLE_COLORS[0],
        });
      }
      mascotMoodFxTimer = setTimeout(() => clearMascotMoodFx(el), 2600 + durBoost);
      return;
    }

    if (currentMood === 'happy') {
      el.classList.add('cigh-clean-mascot-happy');
      for (let i = 0; i < 8 + extra; i++) {
        addMascotFxDot(fx, {
          className: i % 3 === 0 ? 'spark flower' : 'spark',
          text: i % 3 === 0 ? '✿' : '✦',
          left: 18 + Math.random() * 66,
          top: 32 + Math.random() * 42,
          dx: (Math.random() - 0.5) * (32 + tier * 12),
          dy: -16 - Math.random() * (18 + tier * 10),
          duration: 780 + Math.random() * 460 + durBoost,
          color: PET_PARTICLE_COLORS[(i + 1) % PET_PARTICLE_COLORS.length],
        });
      }
      mascotMoodFxTimer = setTimeout(() => clearMascotMoodFx(el), 2100 + durBoost);
      return;
    }

    if (currentMood === 'scared') {
      el.classList.add('cigh-clean-mascot-scared');
      addMascotFxDot(fx, { className: 'sweat', left: 68, top: 52, dx: 8 + tier * 2, dy: 18 + tier * 6, duration: 1100 + durBoost });
      mascotMoodFxTimer = setTimeout(() => clearMascotMoodFx(el), 1550 + durBoost);
      return;
    }

    if (currentMood === 'sad') {
      el.classList.add('cigh-clean-mascot-sad');
      addMascotFxDot(fx, { className: 'tear', left: 56, top: 55, dx: 0, dy: 26 + tier * 8, duration: 1500 + durBoost });
      if (tier >= 2) addMascotFxDot(fx, { className: 'tear', left: 45, top: 57, dx: -3, dy: 24, duration: 1650 + durBoost });
      mascotMoodFxTimer = setTimeout(() => clearMascotMoodFx(el), 2100 + durBoost);
    }
  }

  function mascotPokeLine(pet, count) {
    const tendency = petTendency(pet);
    if (count >= 5) {
      return pickRandom({
        heart: ['꺅 그만, 부끄러워!', '너무 만지면 녹아!'],
        bloom: ['으악 간지럼 폭발!', '나 날아간다니까!'],
        peace: ['하하, 조금 간지러워', '살살이면 더 좋아'],
        tear: ['앗… 살살 해줘…', '조금 놀랐어…'],
        blade: ['그만 좀 해!', '손 치워, 바보야'],
      }[tendency], '그만 좀!');
    }
    if (count >= 3) {
      return pickRandom({
        heart: ['계속 해주는 거야?', '헤헤 간지러워!'],
        bloom: ['연타다 연타!', '더 하면 폭발해!'],
        peace: ['천천히 해도 돼', '간지럽지만 좋아'],
        tear: ['나 조금 떨려…', '그래도 따뜻해…'],
        blade: ['끈질기네 진짜', '…간지럽다고'],
      }[tendency], '간지러워!');
    }
    return petPetLineLocal(pet);
  }

  // ── 마스코트 애니메이션 헬퍼 ──────────────────────────────────
  let mascotAnimTimer = null;

  // 머리 액세서리에 따라 몸통 bounce 변형 클래스 결정 (neck/face는 몸통 bounce에 영향 없음)
  function _getAccBounceClass(acc) {
    const head = acc?.head || 'none';
    const headMap = {
      crown:  'bounce-crown',
      star:   'bounce-star',
      ribbon: 'bounce-ribbon',
      flower: 'bounce-flower',
      horn:   'bounce-horn',
    };
    return headMap[head] || null;
  }

  // 액세서리 연동 클래스 목록 (제거 시 사용)
  const ACC_ANIM_CLASSES = [
    'bounce-crown','bounce-star','bounce-ribbon','bounce-flower','bounce-horn',
  ];

  function mascotAnimate(className, duration = 500) {
    const el = document.getElementById(MASCOT_ID);
    if (!el) return;
    // 기존 애니 클래스 + 액세서리 bounce 클래스 전부 제거
    ['poke','spin','bounce','tilt','nod','wiggle','tada','analyzing','done-pop','grabbed','carried','landed',
     ...ACC_ANIM_CLASSES]
      .forEach(c => el.classList.remove(c));
    void el.offsetWidth; // reflow

    // poke 클래스는 루트 el에 붙는 jump 애니 — 액세서리 분기 없이 그대로 처리
    if (className === 'poke') {
      el.classList.add('poke');
      clearTimeout(mascotAnimTimer);
      mascotAnimTimer = setTimeout(() => el.classList.remove('poke'), duration);
      return;
    }

    // bounce / tada: 착용 액세서리에 따라 전용 bounce 분기
    if (className === 'bounce' || className === 'tada') {
      const acc = getMascotAccessory();
      const accAnim = _getAccBounceClass(acc);
      if (accAnim) {
        el.classList.add(accAnim);
        clearTimeout(mascotAnimTimer);
        mascotAnimTimer = setTimeout(() => el.classList.remove(accAnim), duration + 80);
        return;
      }
    }

    el.classList.add(className);
    clearTimeout(mascotAnimTimer);
    mascotAnimTimer = setTimeout(() => el.classList.remove(className), duration);
  }

  function mascotPoke() {
    const now = Date.now();
    if (now - lastMascotPoke > 2600) mascotPokeCount = 0;
    mascotPokeCount += 1;
    lastMascotPoke = now;

    let line = '';
    updateRoom(r => {
      const p = getPet(r);
      line = mascotPokeLine(p, mascotPokeCount);
      p.lastLine = line;
      p.lastLineAt = now;
      r.pet = p;
    });

    mascotSay(line, 100);
    playBeep('tab');

    // mood + 성향 + 연타 여부에 따라 랜덤 리액션
    (() => {
      const pet = getPet();
      const mood = getEffectiveMood(pet);
      const tendency = petTendency(pet);
      const isCombo = mascotPokeCount >= 3;

      // 감정별 어울리는 애니 풀
      const moodPool = {
        love:   [{cls:'bounce',dur:420},{cls:'spin',dur:520},{cls:'tada',dur:700},{cls:'bounce',dur:380}],
        happy:  [{cls:'bounce',dur:400},{cls:'wiggle',dur:500},{cls:'tada',dur:700},{cls:'nod',dur:600}],
        normal: [{cls:'tilt',dur:600},{cls:'nod',dur:700},{cls:'wiggle',dur:500},{cls:'poke',dur:420}],
        sad:    [{cls:'nod',dur:700},{cls:'tilt',dur:600},{cls:'poke',dur:420}],
        scared: [{cls:'wiggle',dur:500},{cls:'poke',dur:420},{cls:'tilt',dur:600}],
      };
      // 성향별 특수 리액션 추가
      const tendencyBonus = {
        heart: [{cls:'spin',dur:520},{cls:'tada',dur:700}],
        bloom: [{cls:'tada',dur:700},{cls:'bounce',dur:380}],
        blade: [{cls:'wiggle',dur:500},{cls:'tilt',dur:600}],
        tear:  [{cls:'nod',dur:700},{cls:'poke',dur:420}],
        peace: [{cls:'tilt',dur:600},{cls:'nod',dur:700}],
      };

      let pool = [...(moodPool[mood] || moodPool.normal)];
      if (isCombo) pool.push(...(tendencyBonus[tendency] || []));

      // 직전 애니와 같은 건 피하기
      const lastAnim = pool._last || '';
      const filtered = pool.filter(a => a.cls !== lastAnim);
      const chosen = (filtered.length ? filtered : pool)[Math.floor(Math.random() * (filtered.length || pool.length))];
      pool._last = chosen.cls;

      mascotAnimate(chosen.cls, chosen.dur);
      triggerMascotMood(mood);
    })();

    bumpAchvCounter('petTouch', 1);
    announceAchvUnlocks();
    if (activeTab === 'pet') renderContent();
  }

  // 새 답변 감지 시작 애니메이션
  function mascotAnimAnalyzing() {
    if (!isMascotEnabled()) return;
    mascotAnimate('analyzing', 1800);
  }

  // 분석 완료 애니메이션
  function mascotAnimDone() {
    if (!isMascotEnabled()) return;
    mascotAnimate('done-pop', 600);
  }

  // ── Idle 동작 루프 ────────────────────────────────────────────
  // 짧은 간격(3~7초)으로 계속 작은 동작 실행 — 살아있는 느낌
  // mood에 따라 어울리는 동작 풀 선택
  const IDLE_ANIM_POOLS = {
    love:   [
      {cls:'bounce',dur:420},{cls:'bounce',dur:380},{cls:'spin',dur:520},
      {cls:'tada',dur:700},{cls:'wiggle',dur:500},{cls:'nod',dur:600},
    ],
    happy:  [
      {cls:'bounce',dur:400},{cls:'wiggle',dur:500},{cls:'tada',dur:700},
      {cls:'nod',dur:600},{cls:'bounce',dur:380},
    ],
    normal: [
      {cls:'bounce',dur:420},{cls:'wiggle',dur:500},{cls:'tilt',dur:600},
      {cls:'nod',dur:700},{cls:'bounce',dur:380},{cls:'wiggle',dur:480},
    ],
    sad:    [
      {cls:'nod',dur:800},{cls:'tilt',dur:700},{cls:'wiggle',dur:500},
      {cls:'nod',dur:750},
    ],
    scared: [
      {cls:'wiggle',dur:500},{cls:'wiggle',dur:480},{cls:'tilt',dur:600},
      {cls:'bounce',dur:380},
    ],
  };
  let _lastIdleAnim = '';

  function scheduleMascotIdle() {
    clearTimeout(mascotIdleTimer);
    if (!isMascotEnabled()) return;
    // 10~20초마다 idle 애니. 드래그 중엔 타이머 멈춤 (pointerup에서 재시작)
    mascotIdleTimer = setTimeout(mascotIdleTick, 5000 + Math.random() * 5000);
  }

  // idle tick 발화 타입 순환 — 연속으로 같은 종류 안 나오게
  let _lastIdleSpeakType = '';

  function mascotIdleTick() {
    if (!isMascotEnabled()) return;
    if (mascotDragState) { scheduleMascotIdle(); return; }
    const pet = getPet();
    const mood = getEffectiveMood(pet);
    const now = Date.now();
    const idleLong = Number(pet.lastFedAt || 0) && now - Number(pet.lastFedAt || 0) > MASCOT_IDLE_MS;

    // 작은 idle 동작 — mood에 따라 풀 선택
    const pool = IDLE_ANIM_POOLS[mood] || IDLE_ANIM_POOLS.normal;
    const filtered = pool.filter(a => a.cls !== _lastIdleAnim);
    const chosen = (filtered.length ? filtered : pool)[Math.floor(Math.random() * (filtered.length || pool.length))];
    _lastIdleAnim = chosen.cls;
    mascotAnimate(chosen.cls, chosen.dur);

    // 발화: 이전 tick보다 확률 높임, 타입 다양화
    // idleLong(방치 10분 이상)이면 더 적극적으로 말함
    const speakRoll = Math.random();
    const speakThreshold = idleLong ? 0.52 : 0.38;

    if (speakRoll < speakThreshold) {
      // 대사 타입 풀에서 직전과 다른 것 선택
      const speakTypes = ['idle', 'ambient', 'time', 'idle', 'ambient'];
      const filtered2 = speakTypes.filter(t => t !== _lastIdleSpeakType);
      const type = filtered2[Math.floor(Math.random() * filtered2.length)] || 'ambient';
      _lastIdleSpeakType = type;

      let line = '';
      if (type === 'idle') line = idleMascotLine(pet);
      else if (type === 'time') line = timeMascotLine(pet);
      else line = ambientMascotLine(pet);

      if (line) {
        const priority = idleLong ? 55 : 30;
        mascotSay(line, priority);
        triggerMascotMood(mood);
      }
    }

    scheduleMascotIdle();
  }

  function scheduleMascotWander() {
    clearTimeout(mascotWanderTimer);
    mascotWanderTimer = setTimeout(mascotWander, 4200 + Math.random() * 4200);
  }

  function mascotWander() {
    const el = document.getElementById(MASCOT_ID);
    if (!el || mascotDragState) return;

    updateMascotSprite();

    const w = el.offsetWidth || 60;
    const h = el.offsetHeight || 70;
    const cur = el.getBoundingClientRect();
    const homeLeft = Number(el.dataset.homeLeft || cur.left);
    const homeTop = Number(el.dataset.homeTop || cur.top);
    const dx = Math.round((Math.random() - 0.5) * 28);
    const dy = Math.round((Math.random() - 0.5) * 18);
    const targetLeft = clamp(homeLeft + dx, 0, innerWidth - w);
    const targetTop = clamp(homeTop + dy, 0, innerHeight - h);

    const body = el.querySelector('.cigh-clean-mascot-body');
    if (body && Math.abs(targetLeft - cur.left) > 2) body.style.transform = targetLeft < cur.left ? 'scaleX(-1)' : 'scaleX(1)';

    el.style.transition = 'left 1.1s ease-in-out, top 1.1s ease-in-out';
    el.style.left = `${targetLeft}px`;
    el.style.top = `${targetTop}px`;

    scheduleMascotWander();
  }

  function setupMascotInteraction(el) {
    let moved = false;
    let dragSpoken = false;

    el.addEventListener('pointerdown', e => {
      const rect = el.getBoundingClientRect();
      mascotDragState = { id: e.pointerId, sx: e.clientX, sy: e.clientY, left: rect.left, top: rect.top };
      moved = false;
      dragSpoken = false;
      el.classList.add('grab');
      clearTimeout(mascotWanderTimer);
      clearTimeout(mascotIdleTimer); // 잡는 순간 idle 타이머 멈춤
      el.style.transition = 'none';
      try { el.setPointerCapture(e.pointerId); } catch {}
      beginPetDragVisual();

      // 잡힌 순간 — 살짝 들리는 애니
      mascotAnimate('grabbed', 380);
    });

    el.addEventListener('pointermove', e => {
      if (!mascotDragState || mascotDragState.id !== e.pointerId) return;
      const dx = e.clientX - mascotDragState.sx;
      const dy = e.clientY - mascotDragState.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) {
        if (!moved && !dragSpoken) {
          dragSpoken = true;
          const pet = getPet();
          const tendency = petTendency(pet);
          mascotSay(pickRandom({
            heart: ['꺅 어디 가는 거야?', '나 안아드는 거야?'],
            bloom: ['우와 난다~!', '이사 간다 이사!'],
            peace: ['천천히 옮겨줘', '음~ 산책인가?'],
            tear: ['떨어뜨리지 마…', '조심히 들어줘…'],
            blade: ['어어 떨어져!', '함부로 들지 마!'],
          }[tendency], '어어 떨어져!'), 100);
          // 이동 시작 — 흔들리는 애니
          mascotAnimate('carried', 500);
        }
        moved = true;
      }

      const left = clamp(mascotDragState.left + dx, 0, innerWidth - el.offsetWidth);
      const top = clamp(mascotDragState.top + dy, 0, innerHeight - el.offsetHeight);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      e.preventDefault();
    });

    el.addEventListener('pointerup', e => {
      el.classList.remove('grab');
      if (mascotDragState?.id === e.pointerId) {
        try { el.releasePointerCapture(e.pointerId); } catch {}
      }
      const wasMoved = moved;
      mascotDragState = null;

      if (wasMoved) {
        saveMascotPos(el);
        endPetDragVisual('smile', PET_VISUAL_POST_DRAG_MS);
        // 착지 — 통통 바운스
        mascotAnimate('landed', 550);
        mascotSay(pickRandom({
          heart: ['휴, 안착했다!', '여기 좋아!'],
          bloom: ['착지 성공!', '새 자리 접수!'],
          peace: ['음~ 여기 괜찮네', '편하게 앉았어'],
          tear: ['휴… 안 떨어졌어…', '조금 무서웠어…'],
          blade: ['흥, 나쁘진 않네', '다음엔 조심해'],
        }[petTendency(getPet())], '휴…'), 100);
        scheduleMascotWander();
      } else {
        mascotPoke();
        scheduleMascotWander();
      }
      scheduleMascotIdle(); // 놓아지면 idle 타이머 재시작
    });

    el.addEventListener('pointercancel', () => {
      el.classList.remove('grab');
      mascotDragState = null;
      scheduleMascotWander();
      scheduleMascotIdle(); // 취소돼도 재시작
    });
  }

  function ensureMascot() {
    let el = document.getElementById(MASCOT_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = MASCOT_ID;
    el.innerHTML = '<div class="cigh-clean-mascot-speech"></div><div class="cigh-clean-mascot-body"></div><div class="cigh-clean-mascot-fx"></div>';
    document.body.appendChild(el);

    restoreMascotPos(el);
    setupMascotInteraction(el);
    updateMascotSprite();
    applyThemeMode();
    return el;
  }

  function startMascot() {
    ensureMascot();
    scheduleMascotWander();
    scheduleMascotIdle();
  }

  function stopMascot() {
    clearTimeout(mascotWanderTimer);
    clearTimeout(mascotIdleTimer);
    document.getElementById(MASCOT_ID)?.remove();
  }

  function heartColor(value) {
    const v = clamp(value, 0, 100);
    if (v >= 75) return '#ff4d6d';
    if (v >= 50) return '#ff6b6b';
    if (v >= 25) return '#d88989';
    return '#b79b9b';
  }

  function pixelMeterBar(value) {
    const total = 10;
    const filled = Math.round(clamp(value, 0, 100) / 10);
    let html = '<div class="cigh-clean-pixelbar">';
    for (let i = 0; i < total; i++) {
      html += `<span class="${i < filled ? 'on' : ''}"></span>`;
    }
    html += '</div>';
    return html;
  }

  function renderContent() {
    const main = document.getElementById('cigh-clean-main');
    if (!main) return;

    const data = sanitizeData(currentData || getRoom().data);

    if (activeTab === 'log') {
      main.innerHTML = `<div class="cigh-clean-log-screen"><div id="cigh-clean-log-inner" class="cigh-clean-log-inner"></div></div>`;
      flushLog();
      return;
    }

    if (activeTab === 'hud') {
      const commentLog = (getRoom().commentLog || []).slice().reverse();
      main.innerHTML = commentLog.length
        ? commentLog.map(c => `
            <div class="cigh-clean-comment-log-row">
              <span class="cigh-clean-comment-log-time">${esc(c.time)}</span>
              <span class="cigh-clean-comment-log-text">${esc(c.text)}</span>
            </div>
          `).join('')
        : empty('코멘트 기록 없음');
      return;
    }


    if (activeTab === 'achv') {
      const achvState = readAchvState();
      const equippedId = readEquippedAchvId();
      const unlockedCount = ACHV_DEFS.filter(def => achvState.unlocked[def.id]).length;
      const bonusPct = (getAchvExpBonusMultiplier(achvState) - 1) * 100;
      const equippedName = (equippedId && achvState.unlocked[equippedId])
        ? ((ACHV_DEFS.find(d => d.id === equippedId) || {}).name || '없음')
        : '없음';

      const cards = ACHV_DEFS.map(def => {
        const prog = getAchvProgress(def, achvState);
        const meta = ACHV_RANK_META[def.rank] || ACHV_RANK_META.N;
        const secret = def.hidden && !prog.unlocked && prog.cur <= 0;
        const equipped = prog.unlocked && equippedId === def.id;
        const icon = secret ? '？' : def.icon;
        const name = secret ? '???' : def.name;
        const tip = secret
          ? '숨겨진 업적 · 조건 달성 시 공개'
          : `${def.desc} · EXP +${(meta.bonus * 100).toFixed(1)}%${prog.unlocked ? ' (보유 중)' : ` · ${prog.cur}/${prog.target}`}`;
        const stateClass = prog.unlocked ? 'unlocked' : (secret ? 'secret' : 'locked');
        const footer = prog.unlocked
          ? '<span class="cigh-clean-achv-done">달성</span>'
          : (secret ? '' : `<span class="cigh-clean-achv-prog">${prog.cur}/${prog.target}</span>`);
        return `
          <div class="cigh-clean-achv-card ${stateClass} rank-${esc(def.rank)}${equipped ? ' equipped' : ''}" style="--achv-rank-color:${esc(meta.color)};" data-achv-id="${esc(def.id)}" title="${esc(tip)}">
            <span class="cigh-clean-achv-shimmer" aria-hidden="true"></span>
            <span class="cigh-clean-achv-rank">${esc(meta.label)}</span>
            <span class="cigh-clean-achv-icon">${esc(icon)}</span>
            <span class="cigh-clean-achv-name">${esc(name)}</span>
            ${footer}
          </div>`;
      }).join('');

      main.innerHTML = section('TITLES', `
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">달성</span>
          <span class="cigh-clean-sval">${unlockedCount} / ${ACHV_DEFS.length}</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">보유 효과</span>
          <span class="cigh-clean-sval">EXP +${bonusPct.toFixed(1)}%</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">장착</span>
          <span class="cigh-clean-sval">${esc(equippedName)}</span>
        </div>
      `) + `<div class="cigh-clean-achv-grid">${cards}</div>`;

      if (pendingAchvCelebrate) {
        const celebrateId = pendingAchvCelebrate.id;
        pendingAchvCelebrate = null;
        const card = main.querySelector(`.cigh-clean-achv-card[data-achv-id="${CSS.escape(celebrateId)}"]`);
        if (card) requestAnimationFrame(() => spawnPetParticles(card, 'evolve'));
      }
      return;
    }

    if (activeTab === 'pet') {
      const pet = getPet();
      const stageObj = petStageFromLevel(pet.level);
      const finalForm = PET_FINAL_FORMS[pet.finalType] || PET_FINAL_FORMS.peace;
      const isFinal = stageObj.stage >= 4;
      const displayName = isFinal ? finalForm.name : stageObj.name;
      const tally = { ...zeroTally(), ...(pet.tally || {}) };
      const curFloor = petExpForLevel(pet.level);
      const nextFloor = petExpForLevel(pet.level + 1);
      const inLevel = pet.exp - curFloor;
      const need = Math.max(1, nextFloor - curFloor);
      const ratio = clamp(Math.round((inLevel / need) * 100), 0, 100);
      const nextStage = PET_STAGES.find(s => s.stage === stageObj.stage + 1);
      const moodLabel = PET_MOOD_LABEL[pet.mood] || PET_MOOD_LABEL.normal;
      const tendencyLabel = PET_TENDENCY_LABEL[pet.finalType] || PET_TENDENCY_LABEL.peace;
      const petName = getPetName();
      const favoriteName = getFavoriteCharacter(pet);
      const bondLabel = ['낯가림', '익숙함', '친함', '단짝', '영혼친구'][Number(pet.bondLevel || 0)] || '낯가림';
      const effectiveMood = getEffectiveMood(pet);
      const bpm = petBpmForMood(effectiveMood);
      const bpmVisualDur = (60 / Math.max(1, bpm)) * 7.2;
      const bpmDur = `${bpmVisualDur.toFixed(3)}s`;
      const bpmTone = (PET_FINAL_FORMS[petMoodBucket(effectiveMood)] || finalForm).color || heartColor(clamp(bpm - 50, 0, 100));
      const bpmMoodLabel = PET_MOOD_LABEL[effectiveMood] || PET_MOOD_LABEL.normal;
      const totalTally = TENDENCY_KEYS.reduce((sum, key) => sum + Math.max(0, Number(tally[key] || 0)), 0);
      const tendencyShortLabel = { heart: '애정', bloom: '명랑', peace: '평화', tear: '애상', blade: '시련' };
      const tendencyBadges = TENDENCY_KEYS.map(key => {
        const form = PET_FINAL_FORMS[key] || PET_FINAL_FORMS.peace;
        const label = PET_TENDENCY_LABEL[key] || key;
        const emoji = label.split(' ')[0] || '◆';
        const count = Math.max(0, Number(tally[key] || 0));
        const pct = totalTally ? clamp(Math.round((count / totalTally) * 100), 0, 100) : 0;
        const fillPx = 2 + Math.round((pct / 100) * 8);
        const activeClass = key === pet.finalType ? ' is-active' : '';
        const zeroClass = count <= 0 ? ' is-zero' : '';
        return `
          <div class="cigh-clean-tendency-badge${activeClass}${zeroClass}" style="--tendency-color:${esc(form.color || '#ffd166')};--tendency-fill:${fillPx}px;" title="${esc(label)} ${count}회 · ${pct}%">
            <span class="cigh-clean-tendency-fill"></span>
            <span class="cigh-clean-tendency-emoji">${esc(emoji)}</span>
            <span class="cigh-clean-tendency-name">${esc(tendencyShortLabel[key] || key)}</span>
            <span class="cigh-clean-tendency-count">${count}</span>
          </div>`;
      }).join('');

      const decoState = decoEditMode ? getDecoDraft() : getDecoState();
      const decoBackdrop = renderDecoBackdropHtml(decoState);
      const decoEditor = decoEditMode ? renderDecoEditorHtml() : '';

      const equippedAchv = getEquippedAchvDef();
      const titleText = equippedAchv ? `${equippedAchv.icon} ${equippedAchv.name}` : '';
      const petDisplayName = petName || '이름 없음';
      const nameStrip = decoEditMode ? '' : `
        <div class="cigh-clean-pet-id">
          ${titleText ? `<span class="cigh-clean-pet-title">${esc(titleText)}</span>` : ''}
          <span class="cigh-clean-pet-name">${esc(petDisplayName)}</span>
        </div>
      `;
      const roomPositionSpacer = decoEditMode ? '' : `<div class="cigh-clean-pet-room-spacer${titleText ? ' has-title' : ''}" aria-hidden="true"></div>`;

      const petRoomHtml = `
        <div class="cigh-clean-pet-wrap${decoEditMode ? ' is-edit' : ''}">
          ${decoBackdrop}
          <button type="button" class="cigh-clean-info-reset-btn cigh-clean-pet-edit-btn${decoEditMode ? ' save' : ''}" data-deco-action="toggle-edit">${decoEditMode ? 'SAVE' : 'EDIT'}</button>
          ${decoEditMode ? '' : `<div class="cigh-clean-pet-speech">${esc(pet.lastLine || '쓰다듬어줘!')}</div>`}
          ${roomPositionSpacer}
          ${decoEditMode ? '' : `<div class="cigh-clean-pet-sprite" title="쓰다듬기">${renderPetSpriteHTML(pet, PET_PANEL_SPRITE_SIZE)}</div>`}
        </div>
      `;

      if (decoEditMode) {
        main.innerHTML = petRoomHtml + decoEditor;
        if (pendingPetCelebrate) {
          const kind = pendingPetCelebrate;
          pendingPetCelebrate = null;
          const host = main.querySelector('.cigh-clean-pet-wrap');
          requestAnimationFrame(() => spawnPetParticles(host, kind));
        }
        return;
      }

      main.innerHTML = petRoomHtml + nameStrip + section('♥ BPM', `
        <div class="cigh-clean-bpm-card cigh-clean-bpm-${esc(effectiveMood)}" style="--cigh-bpm-color:${esc(bpmTone)};--bpm-dur:${esc(bpmDur)};">
          <div class="cigh-clean-bpm-head">
            <span class="cigh-clean-bpm-heart" aria-hidden="true">♥</span>
            <span class="cigh-clean-bpm-number">${bpm} BPM</span>
            <span class="cigh-clean-bpm-mood">${esc(bpmMoodLabel)}</span>
          </div>
          <div class="cigh-clean-ecg-window" aria-hidden="true">
            <svg class="cigh-clean-ecg-line" viewBox="0 0 320 32" preserveAspectRatio="none">
              <polyline class="cigh-clean-ecg-base" pathLength="320" points="0,18 30,18 36,18 40,9 45,27 51,18 80,18 96,18 100,11 105,24 111,18 140,18 156,18 160,8 165,27 171,18 200,18 216,18 220,11 225,24 231,18 260,18 276,18 280,9 285,27 291,18 320,18" />
              <polyline class="cigh-clean-ecg-trace" pathLength="320" points="0,18 30,18 36,18 40,9 45,27 51,18 80,18 96,18 100,11 105,24 111,18 140,18 156,18 160,8 165,27 171,18 200,18 216,18 220,11 225,24 231,18 260,18 276,18 280,9 285,27 291,18 320,18" />
            </svg>
          </div>
        </div>
      `) + section('EXP', `
        <div class="cigh-clean-brow">
          <div class="cigh-clean-blbl">
            <span class="cigh-clean-bdim">다음 레벨까지</span>
            <span class="cigh-clean-bdim">${inLevel} / ${need} (${ratio}%)</span>
          </div>
          ${pixelMeterBar(ratio)}
        </div>
      `) + section('TENDENCY', `
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">${isFinal ? '확정 성향' : '현재 우세'}</span>
          <span class="cigh-clean-sval">${esc(tendencyLabel)}</span>
        </div>
        <div class="cigh-clean-tendency-grid">${tendencyBadges}</div>
      `) + section('STATUS', `
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">진화 단계</span>
          <span class="cigh-clean-sval">${esc(stageObj.name)} (${stageObj.stage}/${PET_STAGES.length - 1})</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">먹인 횟수</span>
          <span class="cigh-clean-sval">${pet.feedCount}회</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">유대 단계</span>
          <span class="cigh-clean-sval">${esc(bondLabel)} (${Number(pet.bondLevel || 0)})</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">최애</span>
          <span class="cigh-clean-sval">${favoriteName ? esc(favoriteName) : '아직 없음'}</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">누적 EXP</span>
          <span class="cigh-clean-sval">${pet.exp}</span>
        </div>
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">다음 진화</span>
          <span class="cigh-clean-sval">${nextStage ? `Lv.${nextStage.minLevel}` : '최종 단계'}</span>
        </div>
      `);
      if (pendingPetCelebrate) {
        const kind = pendingPetCelebrate;
        pendingPetCelebrate = null;
        const host = main.querySelector('.cigh-clean-pet-wrap');
        requestAnimationFrame(() => spawnPetParticles(host, kind));
      }
      return;
    }

    if (activeTab === 'info') {
      const roomUserName = getRoomUserName();
      const infoResetBar = `
        <div class="cigh-clean-info-tools">
          <label class="cigh-clean-user-name-box" title="이 방의 USER 캐릭터 이름">
            <span>USER</span>
            <input type="text" class="cigh-clean-user-name-input" data-user-name-input="1" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(roomUserName)}" placeholder="이 방의 USER 캐릭터 이름">
          </label>
          <button type="button" class="cigh-clean-info-reset-btn" data-action="user-name-save" title="USER 이름 저장">Save</button>
          <button type="button" class="cigh-clean-info-reset-btn" data-action="info-reset" title="INFO 정보 초기화">Reset</button>
        </div>
      `;

      if (!data) {
        main.innerHTML = infoResetBar + empty('NO INFO');
        return;
      }

      const rows = [
        ['TIME', data.time],
        ['LOC', data.location],
        ['USER', data.character],
        ['GOAL', data.goal],
        ['OUTFIT', data.clothing],
      ].map(([label, value]) => [label, cleanOptionalValue(value)]).filter(([, value]) => value);

      const infoTitle = data._inferredStatus ? 'INFERRED INFO' : 'INFO';

      const infoBlock = rows.length
        ? section(infoTitle, rows.map(([label, value]) => `
            <div class="cigh-clean-srow">
              <span class="cigh-clean-slbl">${esc(label)}</span>
              <span class="cigh-clean-sval">${esc(value)}</span>
            </div>
          `).join(''))
        : '';

      const situationBlock = data.situation
        ? section('SITUATION', `<div class="cigh-clean-situ">${esc(data.situation)}</div>`)
        : '';

      const meterBlock = data.affection?.length
        ? section('RELATION METER', data.affection.map(item => {
            const m = normalizeMeter(item, 50);
            const value = clamp(m.value, 0, 100);
            return `
              <div class="cigh-clean-brow">
                <div class="cigh-clean-blbl">
                  <span class="cigh-clean-mname">
                    ${pixelHeartSVG(value)}
                    <span>${esc(m.name)} <span class="cigh-clean-bdim">· ${esc(m.label || '관계')}</span></span>
                  </span>
                  <span class="cigh-clean-bdim">${value}%</span>
                </div>
                ${pixelMeterBar(value)}
                ${m.memo ? `<div class="cigh-clean-idetail">${esc(m.memo)}</div>` : ''}
              </div>
            `;
          }).join(''))
        : (data._inferredStatus
          ? section('RELATION METER', `<div class="cigh-clean-mini-empty">INFO 관계 없음</div>`)
          : '');

      const inventoryBlock = data.inventory?.length
        ? section('INVENTORY', data.inventory.map(raw => {
            const item = normalizeInventoryItem(raw);
            return `
              <div class="cigh-clean-irow">
                <span class="cigh-clean-ico">${esc(normalizeIcon(item.icon, item.name))}</span>
                <span>${esc(item.name)}${item.detail ? `<div class="cigh-clean-idetail">${esc(item.detail)}</div>` : ''}</span>
              </div>
            `;
          }).join(''))
        : '';

      const statBlock = data.stats?.length
        ? section('STATUS', data.stats.map(stat => `
            <div class="cigh-clean-srow">
              <span class="cigh-clean-slbl">${esc(stat.name)}</span>
              <span class="cigh-clean-sval">${esc(stat.value)}</span>
            </div>
          `).join(''))
        : '';

      const questBlock = data.quests?.length
        ? section('QUESTS', data.quests.map(q => `<div class="cigh-clean-q">▸ ${esc(q)}</div>`).join(''))
        : '';

      const analysisBlock = section('ANALYSIS', `
        <div class="cigh-clean-srow">
          <span class="cigh-clean-slbl">분석 횟수</span>
          <span class="cigh-clean-sval">${getAnalyzeCount()}회</span>
        </div>
      `);

      main.innerHTML = infoResetBar + (infoBlock + situationBlock + meterBlock + inventoryBlock + statBlock + questBlock + analysisBlock || empty('NO INFO / LOG ONLY'));
    }
  }

  function setPanelOpen(panel, open) {
    if (!panel) return;

    playBeep(open ? 'open' : 'close');
    panel.classList.toggle('open', !!open);
    panel.style.display = open ? 'flex' : 'none';

    if (open) {
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';
      renderContent();

      const data = currentData || getRoom().data;
      if (data?.hudComments?.length) {
        startFooterComments(data.hudComments, { popup: false });
      } else if (footerLastText) {
        setFooter(footerLastText);
      }
    }
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="cigh-clean-head" class="cigh-clean-head">
        <span class="cigh-clean-ttl">◆ RPG</span>
        <span class="cigh-clean-room" id="cigh-clean-room"></span>
        <button id="cigh-clean-settings-btn" type="button" class="cigh-clean-x" title="설정">⚙</button>
        <button id="cigh-clean-refresh" type="button" class="cigh-clean-x" title="수동 갱신">↻</button>
        <button id="cigh-clean-x" type="button" class="cigh-clean-x" title="닫기">✕</button>
      </div>
      <div id="cigh-clean-tabs" class="cigh-clean-tabs">
        ${TABS.map(tab => `<button type="button" class="cigh-clean-tab ${tab.id === activeTab ? 'on' : ''}" data-tab="${tab.id}" title="${tab.label}">${tab.label}</button>`).join('')}
      </div>
      <div id="cigh-clean-main" class="cigh-clean-main"></div>
      <div class="cigh-clean-foot">
        <span id="cigh-clean-ft" class="cigh-clean-ft">READY</span>
        <span id="cigh-clean-count" class="cigh-clean-count">0회</span>
      </div>
      <div id="cigh-clean-resize-y" class="cigh-clean-resize-y" title="세로 크기 조절"></div>
    `;

    panel.querySelector('#cigh-clean-x').addEventListener('click', event => {
      event.stopPropagation();
      setPanelOpen(panel, false);
    });

    panel.querySelector('#cigh-clean-settings-btn').addEventListener('click', event => {
      event.stopPropagation();
      openSettings();
    });

    panel.querySelector('#cigh-clean-refresh').addEventListener('click', event => {
      event.stopPropagation();
      pushLog(['▶채팅을 불러오는 중이다!']);
      showPopup(['▶채팅을 불러오는 중이다!']);
      analyzeLatest(true);
    });

    panel.querySelector('#cigh-clean-tabs').addEventListener('click', event => {
      const btn = event.target.closest('[data-tab]');
      if (!btn) return;

      playBeep('tab');
      activeTab = btn.dataset.tab;
      panel.querySelectorAll('.cigh-clean-tab').forEach(tab => tab.classList.toggle('on', tab.dataset.tab === activeTab));
      renderContent();
    });

    panel.querySelector('#cigh-clean-main').addEventListener('click', event => {
      const infoReset = event.target.closest('[data-action="info-reset"]');
      if (infoReset) {
        event.preventDefault();
        event.stopPropagation();
        openInfoResetConfirm();
        return;
      }

      const userNameSave = event.target.closest('[data-action="user-name-save"]');
      if (userNameSave) {
        event.preventDefault();
        event.stopPropagation();
        const input = panel.querySelector('[data-user-name-input="1"]');
        commitRoomUserNameInput(input);
        return;
      }

      const petSpeech = event.target.closest('.cigh-clean-pet-speech');
      if (petSpeech && activeTab === 'pet') {
        event.preventDefault();
        event.stopPropagation();
        petSpeech.classList.add('is-hidden');
        playBeep('tab');
        return;
      }

      const decoAction = event.target.closest('[data-deco-action]');
      if (decoAction) {
        event.preventDefault();
        event.stopPropagation();
        const action = decoAction.dataset.decoAction || '';

        if (action === 'toggle-edit') {
          if (decoEditMode) {
            setDecoState(getDecoDraft());
            decoEditMode = false;
            decoDraft = null;
            setFooter('ROOM SAVED');
            playBeep('save');
          } else {
            decoEditMode = true;
            decoDraft = cloneDecoState();
            setFooter('ROOM EDIT');
            playBeep('tab');
            bumpAchvCounter('decoEdit', 1, true);
            announceAchvUnlocks();
          }
          renderContent();
          return;
        }

        if (action === 'gacha') {
          const result = rollDecoGacha();
          if (!result.ok) {
            playBeep('error');
            setFooter(result.reason === 'ticket' ? '티켓 부족' : '전부 보유 중');
            renderContent();
          } else {
            setFooter(`획득: ${result.item.name}`);
            playDecoGachaAnimation(result.item, result.count);
          }
          return;
        }

        if (action === 'clear-current') {
          clearCurrentDecoTab();
          playBeep('tab');
          renderContent();
          return;
        }
      }

      const decoTab = event.target.closest('[data-deco-tab]');
      if (decoTab) {
        event.preventDefault();
        event.stopPropagation();
        decoEditTab = decoTab.dataset.decoTab || 'wallpaper';
        renderContent();
        playBeep('tab');
        return;
      }

      const decoItem = event.target.closest('[data-deco-item]');
      if (decoItem) {
        event.preventDefault();
        event.stopPropagation();
        const shelf = decoItem.closest('.cigh-clean-deco-shelf');
        const keepScroll = shelf ? shelf.scrollLeft : 0;
        if (toggleDecoItem(decoItem.dataset.decoItem || '')) {
          renderContent();
          requestAnimationFrame(() => {
            const nextShelf = panel.querySelector('#cigh-clean-main .cigh-clean-deco-shelf');
            if (nextShelf) nextShelf.scrollLeft = keepScroll;
          });
          playBeep('tab');
        } else {
          playBeep('error');
          setFooter('더 배치할 보유 수가 없음');
        }
        return;
      }

      const achvCard = event.target.closest('.cigh-clean-achv-card');
      if (achvCard) {
        const id = achvCard.dataset.achvId || '';
        const state = readAchvState();
        if (!id || !state.unlocked[id]) { playBeep('error'); return; }
        toggleEquippedAchv(id);
        playBeep('save');
        renderContent();
        return;
      }

      if (event.target.closest('.cigh-clean-pet-sprite')) petPet();
    });

    panel.querySelector('#cigh-clean-main').addEventListener('keydown', event => {
      const input = event.target?.closest?.('[data-user-name-input="1"]');
      if (!input || event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      commitRoomUserNameInput(input);
    });

    panel.querySelector('#cigh-clean-main').addEventListener('focusout', event => {
      const input = event.target?.closest?.('[data-user-name-input="1"]');
      if (!input) return;
      commitRoomUserNameInput(input, { silent: true });
    });

    panel.querySelector('#cigh-clean-main').addEventListener('pointerdown', event => {
      const prop = event.target?.closest?.('.cigh-clean-room-prop.editable');
      if (prop) startDecoPropDrag(event, prop);
    });

    panel.querySelector('#cigh-clean-main').addEventListener('pointermove', event => {
      moveDecoPropDrag(event);
    });

    panel.querySelector('#cigh-clean-main').addEventListener('pointerup', event => {
      endDecoPropDrag(event);
    });

    panel.querySelector('#cigh-clean-main').addEventListener('pointercancel', event => {
      endDecoPropDrag(event);
    });

    setupDrag(panel);
    setupPanelResize(panel);
    restorePanelHeight(panel);
    restorePos(panel);
    panel.style.display = 'none';
    document.body.appendChild(panel);
    applyThemeMode();

    return panel;
  }

  function restoreFabPos(fab) {
    try {
      const pos = JSON.parse(localStorage.getItem(FAB_POS_KEY) || 'null');
      if (!pos || innerWidth <= 520) return;

      fab.style.left = `${Math.max(6, Math.min(pos.left, innerWidth - 44))}px`;
      fab.style.top = `${Math.max(6, Math.min(pos.top, innerHeight - 44))}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    } catch {}
  }

  function saveFabPos(fab) {
    const rect = fab.getBoundingClientRect();
    localStorage.setItem(FAB_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function buildUI() {
    [
      'cigh-panel', 'cigh-fab', 'cigh-popup', 'cigh-settings',
      'cigh5-panel', 'cigh5-fab', 'cigh5-popup', 'cigh5-settings',
      'cigh6-panel', 'cigh6-fab', 'cigh6-popup', 'cigh6-settings',
      PANEL_ID, FAB_ID, POPUP_ID, COMMENT_POPUP_ID, SETTINGS_ID,
    ].forEach(id => document.getElementById(id)?.remove());

    injectStyle();

    const fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.title = `INFO Game HUD v${VERSION}`;
    fab.textContent = '◆';

    let pressTimer = null;
    let longPressed = false;
    let dragged = false;

    const clearPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
    };

    fab.addEventListener('pointerdown', event => {
      event.stopPropagation();
      longPressed = false;
      dragged = false;
      clearPress();

      const rect = fab.getBoundingClientRect();
      fabDragState = {
        id: event.pointerId,
        sx: event.clientX,
        sy: event.clientY,
        left: rect.left,
        top: rect.top,
      };

      try { fab.setPointerCapture(event.pointerId); } catch {}

      pressTimer = setTimeout(() => {
        if (dragged) return;
        longPressed = true;
        pushLog(['▶최신 로그를 다시 읽는다!']);
        showPopup(['▶최신 로그를 다시 읽는다!']);
        analyzeLatest(true);
      }, 520);
    });

    fab.addEventListener('pointermove', event => {
      if (!fabDragState || fabDragState.id !== event.pointerId) return;

      const dx = event.clientX - fabDragState.sx;
      const dy = event.clientY - fabDragState.sy;

      if (Math.abs(dx) + Math.abs(dy) > 6) {
        dragged = true;
        clearPress();
      }

      if (!dragged) return;

      const left = Math.max(6, Math.min(fabDragState.left + dx, innerWidth - 44));
      const top = Math.max(6, Math.min(fabDragState.top + dy, innerHeight - 44));

      fab.style.left = `${left}px`;
      fab.style.top = `${top}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      updateFloatingPopupPositions();
      event.preventDefault();
    });

    fab.addEventListener('pointerup', event => {
      event.stopPropagation();
      clearPress();

      const wasDragged = dragged;
      const wasLongPressed = longPressed;

      if (fabDragState?.id === event.pointerId) {
        try { fab.releasePointerCapture(event.pointerId); } catch {}
      }

      fabDragState = null;

      if (wasDragged) {
        saveFabPos(fab);
        updateFloatingPopupPositions();
        return;
      }

      if (wasLongPressed) return;

      const panel = ensurePanel();
      const nextOpen = !panel.classList.contains('open') || panel.style.display === 'none';
      setPanelOpen(panel, nextOpen);
    });

    fab.addEventListener('pointercancel', () => {
      clearPress();
      fabDragState = null;
      dragged = false;
    });

    fab.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
    });

    restoreFabPos(fab);
    document.body.appendChild(fab);
    ensurePanel();
    applyThemeMode();
  }

  // ─────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────
  function buildModelOptions() {
    return GEMINI_MODEL_OPTIONS.map(model => {
      return `<option value="${esc(model)}" ${getGeminiModel() === model ? 'selected' : ''}>${esc(model)}</option>`;
    }).join('');
  }

  function openSettings() {
    const old = document.getElementById(SETTINGS_ID);
    if (old) {
      old.remove();
      return;
    }

    const provider = getGeminiProvider();

    const box = document.createElement('div');
    box.id = SETTINGS_ID;
    box.innerHTML = `
      ${settingsSection('api', '◆ API / 모델', `
        <div class="cigh-clean-settings-grid">
          <label>
            <span>Provider</span>
            <select id="cigh-clean-provider-input">
              <option value="ai-studio" ${provider === 'ai-studio' ? 'selected' : ''}>AI Studio</option>
              <option value="openrouter" ${provider === 'openrouter' ? 'selected' : ''}>OpenRouter</option>
              <option value="firebase" ${provider === 'firebase' ? 'selected' : ''}>Firebase AI</option>
            </select>
          </label>
          <label>
            <span>Gemini API Key</span>
            <input id="cigh-clean-api-input" type="password" autocomplete="off" spellcheck="false" placeholder="AIzaSy..." value="${esc(getGeminiKey())}">
          </label>
        </div>
        <div class="cigh-clean-settings-grid">
          <label>
            <span>OR API Key</span>
            <input id="cigh-clean-or-key-input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-or-..." value="${esc(getOpenRouterKey())}">
          </label>
          <label>
            <span>OR 모델</span>
            <input id="cigh-clean-or-model-input" autocomplete="off" spellcheck="false" placeholder="google/gemini-2.5-flash" value="${esc(getOpenRouterModel())}">
          </label>
        </div>
        <div class="cigh-clean-settings-grid">
          <label>
            <span>Gemini 모델</span>
            <select id="cigh-clean-model-input">${buildModelOptions()}</select>
          </label>
          <label>
            <span>추론</span>
            <select id="cigh-clean-thinking-input">
              <option value="0" ${getThinkingBudget() === 0 ? 'selected' : ''}>끔</option>
              <option value="512" ${getThinkingBudget() === 512 ? 'selected' : ''}>낮음</option>
              <option value="1024" ${getThinkingBudget() === 1024 ? 'selected' : ''}>보통</option>
              <option value="2048" ${getThinkingBudget() === 2048 ? 'selected' : ''}>높음</option>
              <option value="-1" ${getThinkingBudget() === -1 ? 'selected' : ''}>자동</option>
            </select>
          </label>
        </div>
        <div class="cigh-clean-settings-mini-title">Firebase AI Logic</div>
        <textarea id="cigh-clean-firebase-input" spellcheck="false" placeholder='const firebaseConfig = { apiKey: "...", projectId: "...", appId: "..." };'>${esc(getFirebaseConfigRaw())}</textarea>
        <div class="cigh-clean-settings-grid">
          <label>
            <span>Location</span>
            <input id="cigh-clean-firebase-location-input" value="${esc(getFirebaseLocation())}" placeholder="global">
          </label>
          <label>
            <span>SDK</span>
            <input id="cigh-clean-firebase-sdk-input" value="${esc(getFirebaseSdkVersion())}" placeholder="12.5.0">
          </label>
        </div>
        <div class="cigh-clean-settings-row" style="margin-top:6px;">
          <button type="button" class="cigh-clean-set-btn" data-action="toggle">키보기</button>
          <button type="button" class="cigh-clean-set-btn red" data-action="clear">AI키삭제</button>
          <button type="button" class="cigh-clean-set-btn red" data-action="or-clear">OR삭제</button>
          <button type="button" class="cigh-clean-set-btn" data-action="firebase-clear">FB삭제</button>
        </div>
      `, { subtitle: true })}

      ${settingsSection('ui', '◆ UI / 마스코트', `
        <div class="cigh-clean-settings-grid">
          <label>
            <span>UI 크기</span>
            <select id="cigh-clean-font-size-input">
              <option value="small" ${getUiFontSize() === 'small' ? 'selected' : ''}>작게</option>
              <option value="medium" ${getUiFontSize() === 'medium' ? 'selected' : ''}>보통</option>
              <option value="large" ${getUiFontSize() === 'large' ? 'selected' : ''}>크게</option>
            </select>
          </label>
          <label>
            <span>펫 이름</span>
            <input id="cigh-clean-pet-name-input" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(getPetName())}" placeholder="마스코트 이름">
          </label>
        </div>
        <div class="cigh-clean-settings-grid">
          <label>
            <span>마스코트 외곽선</span>
            <select id="cigh-clean-outline-input">
              <option value="outline" ${getMascotOutline() === 'outline' ? 'selected' : ''}>아웃라인</option>
              <option value="shadow" ${getMascotOutline() === 'shadow' ? 'selected' : ''}>그림자</option>
              <option value="none" ${getMascotOutline() === 'none' ? 'selected' : ''}>없음</option>
            </select>
          </label>
          <label>
            <span>마스코트 크기</span>
            <select id="cigh-clean-mascot-size-input">
              <option value="2" ${getMascotSize() === 2 ? 'selected' : ''}>작게</option>
              <option value="3" ${getMascotSize() === 3 ? 'selected' : ''}>보통</option>
              <option value="4" ${getMascotSize() === 4 ? 'selected' : ''}>크게</option>
            </select>
          </label>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">
          <label class="cigh-clean-checkrow" style="margin:0;">
            <input id="cigh-clean-mascot-input" type="checkbox" ${isMascotEnabled() ? 'checked' : ''}>
            <span>마스코트 띄우기</span>
          </label>
          <label class="cigh-clean-checkrow" style="margin:0;">
            <input id="cigh-clean-auto-analyze-input" type="checkbox" ${isAutoAnalyzeEnabled() ? 'checked' : ''}>
            <span>자동 읽기</span>
          </label>
          <label class="cigh-clean-checkrow" style="margin:0;">
            <input id="cigh-clean-comment-popup-input" type="checkbox" ${isCommentPopupEnabled() ? 'checked' : ''}>
            <span>코멘트 팝업</span>
          </label>
          <label class="cigh-clean-checkrow" style="margin:0;">
            <input id="cigh-clean-sfx-input" type="checkbox" ${isSfxEnabled() ? 'checked' : ''}>
            <span>효과음</span>
          </label>
        </div>
      `, { subtitle: true })}

      ${settingsSection('accessory', '◆ 마스코트 꾸미기', `
        <div id="cigh-acc-editor">
          <div class="cigh-acc-slot-row">
            <button type="button" class="cigh-acc-slot active" data-slot="head">머리</button>
            <button type="button" class="cigh-acc-slot" data-slot="neck">목</button>
            <button type="button" class="cigh-acc-slot" data-slot="face">얼굴</button>
            <span class="cigh-acc-hint" id="cigh-acc-hint">위 1~3행에 그리기</span>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;">
            <div style="display:flex;flex-direction:column;gap:4px;">
              <canvas id="cigh-acc-cv" width="112" height="112" style="display:block;border:1px solid var(--cigh-border);cursor:crosshair;image-rendering:pixelated;border-radius:3px;"></canvas>
              <div style="display:flex;gap:4px;">
                <button type="button" class="cigh-clean-set-btn" id="cigh-acc-undo">↩</button>
                <button type="button" class="cigh-clean-set-btn" id="cigh-acc-clear">지우기</button>
                <button type="button" class="cigh-clean-set-btn" id="cigh-acc-erase-tog">지우개</button>
              </div>
              <div style="font-size:9px;color:var(--cigh-text-faint);letter-spacing:.06em;margin-top:2px;">미리보기</div>
              <canvas id="cigh-acc-pv2" width="56" height="68" style="image-rendering:pixelated;"></canvas>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;min-width:88px;">
              <div style="font-size:9px;color:var(--cigh-text-faint);letter-spacing:.06em;">색상</div>
              <div id="cigh-acc-palette" style="display:grid;grid-template-columns:repeat(4,16px);gap:3px;"></div>
              <input type="color" id="cigh-acc-custom" title="직접 선택" style="width:36px;height:18px;padding:0;border:none;cursor:pointer;background:none;">
              <div style="font-size:9px;color:var(--cigh-text-faint);margin-top:2px;letter-spacing:.06em;">프리셋</div>
              <div id="cigh-acc-presets" style="display:flex;flex-direction:column;gap:3px;"></div>
            </div>
          </div>
          <div style="display:flex;gap:5px;margin-top:7px;">
            <button type="button" class="cigh-clean-set-btn gold" id="cigh-acc-apply">적용</button>
            <button type="button" class="cigh-clean-set-btn" id="cigh-acc-reset-slot">이 슬롯 초기화</button>
          </div>
        </div>
      `, { subtitle: true })}

      ${settingsSection('log-style', '◆ LOG STYLE / 기타', `
        <textarea id="cigh-clean-style-input" spellcheck="false" placeholder="원하는 포켓몬식 문체 지침">${esc(getStylePrompt())}</textarea>
        <div class="cigh-clean-settings-row" style="margin-top:6px;">
          <button type="button" class="cigh-clean-set-btn" data-action="style-reset">문체초기화</button>
          <button type="button" class="cigh-clean-set-btn" data-action="preview">대상보기</button>
        </div>
      `, { subtitle: true })}

      ${settingsSection('usage', '◆ USAGE', buildUsageSettingsHtml(), { subtitle: true })}

      <div class="cigh-clean-settings-help">
        OpenRouter: openrouter.ai에서 API 키와 모델명(예: google/gemini-2.5-flash)을 입력하세요.<br>
        Firebase AI Logic Beta는 Config + Location(global 권장) + SDK를 사용합니다.
      </div>

      <div class="cigh-clean-settings-save-bar">
        <button type="button" class="cigh-clean-set-btn gold" data-action="save" style="flex:2;font-size:11.5px;height:32px;letter-spacing:.06em;">◆ 저장</button>
        <button type="button" class="cigh-clean-set-btn" data-action="preview" style="height:32px;">대상보기</button>
        <button type="button" class="cigh-clean-set-btn" data-action="style-reset" style="height:32px;">문체초기화</button>
      </div>
    `;

    ensurePanel().appendChild(box);
    applyThemeMode();

    // ── 픽셀 에디터 초기화 ──────────────────────────────────────
    (() => {
      const ACC_COLS = 14, ACC_ROWS = 14, ACC_PX = 8;
      const ACC_PALETTE = [
        '#ff9ec4','#ffd166','#d9b3ec','#9ecbf0','#a8e0b0',
        '#f0a090','#e46576','#c8a84b','#7fb9f0','#b6a3e0',
        '#ffd9a8','#8fb4e0','#ffffff','#aaaaaa','#555555','#111111',
      ];
      const ACC_SPRITE = [
        '00000000000000','00000111100000','00001111110000',
        '00011111111000','00111111111100','00111111111100',
        '01111111111110','01111111111110','01111111111110',
        '01111111111110','00111111111100','00111111111100',
        '00011111111000','00001111110000',
      ];
      const ACC_SPRITE_COLOR = '#9ecbf0';
      const ACC_SLOT_HINTS = {
        head: '위 1~3행에 그리기 → 스프라이트 머리 위에 표시',
        neck: '7~9행 중앙에 그리기 → 목 부근 표시',
        face: '5~7행 좌우 모서리에 → 볼 페인팅',
      };
      const ACC_PRESETS_MAP = {
        head: MASCOT_ACCESSORIES.head,
        neck: MASCOT_ACCESSORIES.neck,
        face: MASCOT_ACCESSORIES.face,
      };

      const cv = box.querySelector('#cigh-acc-cv');
      if (!cv) return;
      const ctx = cv.getContext('2d');

      // 3개 슬롯 각각 별도 그리드 유지
      const slotGrids = {
        head: Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null)),
        neck: Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null)),
        face: Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null)),
      };
      const slotHistory = { head: [], neck: [], face: [] };

      let accSlot = 'head';
      let accColor = ACC_PALETTE[0];
      let accErase = false;
      let accPainting = false;

      // 저장된 액세서리 로드해서 그리드 초기화
      const savedAcc = getMascotAccessory();
      function loadSavedToGrid(slotKey) {
        const accDef = MASCOT_ACCESSORIES[slotKey]?.[savedAcc[slotKey]];
        if (!accDef || !accDef.pixels?.length) return;
        const g = slotGrids[slotKey];
        const colorMap = accDef.colors || {};
        accDef.pixels.forEach(p => {
          if (p.y >= 0 && p.y < ACC_ROWS && p.x >= 0 && p.x < ACC_COLS) {
            // p.c 우선, 없으면 colors 맵, 없으면 defaultColor
            g[p.y][p.x] = p.c || colorMap[`${p.x},${p.y}`] || accDef.color || accColor;
          }
        });
      }
      loadSavedToGrid('head');
      loadSavedToGrid('neck');
      loadSavedToGrid('face');

      function grid() { return slotGrids[accSlot]; }

      function drawEditor() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        const g = grid();
        for (let y = 0; y < ACC_ROWS; y++) {
          for (let x = 0; x < ACC_COLS; x++) {
            ctx.fillStyle = g[y][x] || (y < 3 ? 'rgba(200,168,75,.06)' : y > 10 ? 'rgba(158,203,240,.05)' : 'rgba(0,0,0,.03)');
            ctx.fillRect(x * ACC_PX, y * ACC_PX, ACC_PX, ACC_PX);
            ctx.strokeStyle = 'rgba(0,0,0,.08)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x * ACC_PX, y * ACC_PX, ACC_PX, ACC_PX);
          }
        }
        // 슬롯 가이드라인
        ctx.strokeStyle = 'rgba(200,168,75,.35)';
        ctx.lineWidth = 1;
        if (accSlot === 'head') {
          ctx.strokeRect(0, 0, ACC_COLS * ACC_PX, 3 * ACC_PX);
        } else if (accSlot === 'neck') {
          ctx.strokeRect(0, 6 * ACC_PX, ACC_COLS * ACC_PX, 3 * ACC_PX);
        } else {
          ctx.strokeRect(0, 4 * ACC_PX, 4 * ACC_PX, 3 * ACC_PX);
          ctx.strokeRect(10 * ACC_PX, 4 * ACC_PX, 4 * ACC_PX, 3 * ACC_PX);
        }
        renderPreview();
      }

      function renderPreview() {
        const pv = box.querySelector('#cigh-acc-pv2');
        if (!pv) return;
        const s = 4; // sz=2, s=sz*2=4
        pv.width = ACC_COLS * s; pv.height = (ACC_ROWS + 3) * s;
        const px = pv.getContext('2d');
        px.clearRect(0, 0, pv.width, pv.height);
        // 1) 머리
        const hg = slotGrids['head'];
        for (let y = 0; y < ACC_ROWS; y++) for (let x = 0; x < ACC_COLS; x++) {
          if (hg[y][x]) { px.fillStyle = hg[y][x]; px.fillRect(x * s, y * s, s, s); }
        }
        // 2) 몸통
        ACC_SPRITE.forEach((row, y) => [...row].forEach((cell, x) => {
          if (cell === '1') { px.fillStyle = ACC_SPRITE_COLOR; px.fillRect(x * s, (y + 3) * s, s, s); }
        }));
        // 3) 목·얼굴
        ['neck', 'face'].forEach(slot => {
          const g = slotGrids[slot];
          for (let y = 0; y < ACC_ROWS; y++) for (let x = 0; x < ACC_COLS; x++) {
            if (g[y][x]) { px.fillStyle = g[y][x]; px.fillRect(x * s, (y + 3) * s, s, s); }
          }
        });
      }

      function getCell(e) {
        const r = cv.getBoundingClientRect();
        return [Math.floor((e.clientX - r.left) / ACC_PX), Math.floor((e.clientY - r.top) / ACC_PX)];
      }

      function paintCell(e) {
        const [x, y] = getCell(e);
        if (x < 0 || x >= ACC_COLS || y < 0 || y >= ACC_ROWS) return;
        const g = grid();
        g[y][x] = accErase ? null : accColor;
        drawEditor();
      }

      cv.addEventListener('mousedown', e => {
        const g = grid();
        slotHistory[accSlot].push(g.map(r => [...r]));
        accPainting = true; paintCell(e);
      });
      cv.addEventListener('mousemove', e => { if (accPainting) paintCell(e); });
      cv.addEventListener('mouseup', () => { accPainting = false; });
      cv.addEventListener('mouseleave', () => { accPainting = false; });

      // 팔레트
      const palCont = box.querySelector('#cigh-acc-palette');
      if (palCont) {
        ACC_PALETTE.forEach(c => {
          const s = document.createElement('div');
          s.style.cssText = `width:16px;height:16px;border-radius:3px;background:${c};cursor:pointer;border:2px solid transparent;`;
          if (c === accColor) s.style.borderColor = 'var(--cigh-text)';
          s.addEventListener('click', () => {
            accColor = c; accErase = false;
            palCont.querySelectorAll('div').forEach(d => d.style.borderColor = 'transparent');
            s.style.borderColor = 'var(--cigh-text)';
          });
          palCont.appendChild(s);
        });
      }

      // 직접 색상 선택
      const customColor = box.querySelector('#cigh-acc-custom');
      if (customColor) {
        customColor.value = accColor;
        customColor.addEventListener('input', e => { accColor = e.target.value; accErase = false; });
      }

      // 지우개 토글
      const eraseBtn = box.querySelector('#cigh-acc-erase-tog');
      if (eraseBtn) eraseBtn.addEventListener('click', () => {
        accErase = !accErase;
        eraseBtn.style.color = accErase ? 'var(--cigh-accent)' : '';
        eraseBtn.style.borderColor = accErase ? 'var(--cigh-accent-soft)' : '';
      });

      // 실행취소
      box.querySelector('#cigh-acc-undo')?.addEventListener('click', () => {
        const h = slotHistory[accSlot];
        if (h.length) { slotGrids[accSlot] = h.pop(); drawEditor(); }
      });

      // 지우기
      box.querySelector('#cigh-acc-clear')?.addEventListener('click', () => {
        slotHistory[accSlot].push(slotGrids[accSlot].map(r => [...r]));
        slotGrids[accSlot] = Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null));
        drawEditor();
      });

      // 슬롯 이 슬롯 초기화
      box.querySelector('#cigh-acc-reset-slot')?.addEventListener('click', () => {
        slotHistory[accSlot].push(slotGrids[accSlot].map(r => [...r]));
        slotGrids[accSlot] = Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null));
        drawEditor();
      });

      // 슬롯 탭
      box.querySelectorAll('.cigh-acc-slot').forEach(btn => {
        btn.addEventListener('click', () => {
          accSlot = btn.dataset.slot;
          box.querySelectorAll('.cigh-acc-slot').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const hint = box.querySelector('#cigh-acc-hint');
          if (hint) hint.textContent = ACC_SLOT_HINTS[accSlot] || '';
          buildPresets();
          drawEditor();
        });
      });


      // 프리셋
      function buildPresets() {
        const cont = box.querySelector('#cigh-acc-presets');
        if (!cont) return;
        cont.innerHTML = '';
        const presets = ACC_PRESETS_MAP[accSlot] || {};
        Object.entries(presets).forEach(([k, v]) => {
          if (k === 'none') return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cigh-clean-set-btn';
          btn.style.cssText = 'font-size:9.5px;padding:3px 6px;text-align:left;';
          btn.textContent = v.label;
          btn.addEventListener('click', () => {
            slotHistory[accSlot].push(slotGrids[accSlot].map(r => [...r]));
            const g = Array.from({length: ACC_ROWS}, () => Array(ACC_COLS).fill(null));
            (v.pixels || []).forEach(p => {
              if (p.y >= 0 && p.y < ACC_ROWS && p.x >= 0 && p.x < ACC_COLS)
                g[p.y][p.x] = p.c || v.color || accColor;
            });
            slotGrids[accSlot] = g;
            drawEditor();
          });
          cont.appendChild(btn);
        });
      }
      buildPresets();

      // 적용 버튼 — 그리드에서 픽셀 데이터 추출 → setMascotAccessory 직접 호출
      // 모든 픽셀을 {x,y,c} 형태로 통째 저장 (color/colors 분리 없이 단순화)
      box.querySelector('#cigh-acc-apply')?.addEventListener('click', () => {
        const newAcc = getMascotAccessory();
        ['head', 'neck', 'face'].forEach(slotKey => {
          const g = slotGrids[slotKey];
          const pixels = [];
          for (let y = 0; y < ACC_ROWS; y++) for (let x = 0; x < ACC_COLS; x++) {
            if (g[y][x]) pixels.push({ x, y, c: g[y][x] });
          }
          if (!pixels.length) { newAcc[slotKey] = 'none'; return; }
          const key = `custom_${slotKey}`;
          // pixels에 c가 모두 포함 → _accPixelsToRects에서 p.c로 바로 읽음
          MASCOT_ACCESSORIES[slotKey][key] = {
            label: '✏ 커스텀',
            color: pixels[0].c,  // fallback용 (실제로는 p.c가 항상 존재)
            pixels,
          };
          newAcc[slotKey] = key;
        });
        setMascotAccessory(newAcc);
        updateMascotSprite();
        if (activeTab === 'pet') renderContent();
        pushLog(['▷마스코트 꾸미기 적용!']);
        playBeep('save');
      });

      drawEditor();
    })();
    // ── 픽셀 에디터 끝 ───────────────────────────────────────────

    const providerInput = box.querySelector('#cigh-clean-provider-input');
    const apiInput = box.querySelector('#cigh-clean-api-input');
    const orKeyInput = box.querySelector('#cigh-clean-or-key-input');
    const orModelInput = box.querySelector('#cigh-clean-or-model-input');
    const firebaseInput = box.querySelector('#cigh-clean-firebase-input');
    const firebaseLocationInput = box.querySelector('#cigh-clean-firebase-location-input');
    const firebaseSdkInput = box.querySelector('#cigh-clean-firebase-sdk-input');
    const styleInput = box.querySelector('#cigh-clean-style-input');
    const modelInput = box.querySelector('#cigh-clean-model-input');
    const thinkingInput = box.querySelector('#cigh-clean-thinking-input');
    const fontSizeInput = box.querySelector('#cigh-clean-font-size-input');
    const petNameInput = box.querySelector('#cigh-clean-pet-name-input');
    const commentInput = box.querySelector('#cigh-clean-comment-popup-input');
    const sfxInput = box.querySelector('#cigh-clean-sfx-input');
    const mascotInput = box.querySelector('#cigh-clean-mascot-input');
    const autoAnalyzeInput = box.querySelector('#cigh-clean-auto-analyze-input');
    providerInput?.focus();

    const toggleFoldSection = title => {
      const section = title?.dataset?.foldSection || '';
      const body = section ? box.querySelector(`[data-fold-body="${CSS.escape(section)}"]`) : null;
      if (!body) return;

      const collapsed = !body.classList.contains('collapsed');
      body.classList.toggle('collapsed', collapsed);
      title.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const arrow = title.querySelector('.cigh-clean-fold-arrow');
      if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
      setSettingsFoldState(section, collapsed);
    };

    const saveSettings = () => {
      try {
        setFirebaseConfig(firebaseInput?.value || '');
        setFirebaseLocation(firebaseLocationInput?.value || DEFAULT_FIREBASE_LOCATION);
        setFirebaseSdkVersion(firebaseSdkInput?.value || DEFAULT_FIREBASE_SDK_VERSION);
      } catch (err) {
        alert(`Firebase config 형식이 올바르지 않습니다.\n${err?.message || err}`);
        return;
      }

      setGeminiProvider(providerInput?.value || 'ai-studio');
      // password 필드는 브라우저 보안 정책에 따라 .value가 빈 문자열로 읽힐 수 있음.
      // 입력값이 비어 있으면 기존 저장 키를 보존하고 덮어쓰지 않는다.
      const apiInputVal = String(apiInput?.value || '').trim();
      if (apiInputVal) setGeminiKey(apiInputVal);
      // OR 키: 값이 있을 때만 저장 (clear 버튼은 별도 처리)
      const orKeyInputVal = String(orKeyInput?.value || '').trim();
      if (orKeyInputVal) setOpenRouterKey(orKeyInputVal);
      setOpenRouterModel(orModelInput?.value || DEFAULT_OPENROUTER_MODEL);
      setGeminiModel(modelInput?.value || DEFAULT_GEMINI_MODEL);
      setMascotOutline(box.querySelector('#cigh-clean-outline-input')?.value || 'outline');
      setMascotSize(box.querySelector('#cigh-clean-mascot-size-input')?.value || 4);
      updateMascotSprite();
      setThinkingBudget(thinkingInput?.value || DEFAULT_THINKING_BUDGET);
      setUiFontSize(fontSizeInput?.value || 'small');
      setPetName(petNameInput?.value || '');
      applyThemeMode();
      setStylePrompt(styleInput?.value || DEFAULT_STYLE_PROMPT);
      setCommentPopupEnabled(!!commentInput?.checked);
      setSfxEnabled(!!sfxInput?.checked);
      setMascotEnabled(!!mascotInput?.checked);
      if (isMascotEnabled()) startMascot();
      else stopMascot();
      setAutoAnalyzeEnabled(!!autoAnalyzeInput?.checked);

      setFooter('SETTING SAVED');

      const savedProvider = getGeminiProvider();
      pushLog([
        '▶설정을 저장했다!',
        savedProvider === 'firebase'
          ? `▷Firebase AI Logic: ${hasFirebaseConfig() ? 'ON' : 'Config 없음'} (${getFirebaseLocation()}, SDK ${getFirebaseSdkVersion()})`
          : savedProvider === 'openrouter'
          ? `▷OpenRouter: ${hasOpenRouterKey() ? 'ON' : '키 없음'} (${getOpenRouterModel()})`
          : `▷AI Studio API Key: ${hasGeminiKey() ? 'ON' : '없음'}`,
        isAutoAnalyzeEnabled() ? '▷새 답변 자동 읽기 ON!' : '▷새 답변 자동 읽기 OFF!',
        `▷UI 폰트: ${getUiFontSizeLabel()}`,
      ]);

      playBeep('save');
      if (isAutoAnalyzeEnabled()) scheduleAutoAnalyze();
      box.remove();
    };

    box.addEventListener('click', event => {
      const foldTitle = event.target.closest('.cigh-clean-settings-title[data-fold-section]');
      if (foldTitle && box.contains(foldTitle)) {
        event.preventDefault();
        event.stopPropagation();
        toggleFoldSection(foldTitle);
        return;
      }

      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      event.stopPropagation();

      const action = btn.dataset.action;

      if (action === 'save') {
        saveSettings();
      } else if (action === 'clear') {
        if (!confirm('저장된 Gemini API 키를 삭제할까요?')) return;
        setGeminiKey('');
        apiInput.value = '';
        setFooter('API CLEARED');
        pushLog(['▷Gemini API 키를 삭제했다!']);
      } else if (action === 'or-clear') {
        if (!confirm('저장된 OpenRouter API 키를 삭제할까요?')) return;
        setOpenRouterKey('');
        if (orKeyInput) orKeyInput.value = '';
        setFooter('OR KEY CLEARED');
        pushLog(['▷OpenRouter API 키를 삭제했다!']);
      } else if (action === 'firebase-clear') {
        if (!confirm('저장된 Firebase Config를 삭제할까요?')) return;
        setFirebaseConfig('');
        if (firebaseInput) firebaseInput.value = '';
        setFooter('FIREBASE CLEARED');
        pushLog(['▷Firebase Config를 삭제했다!']);
      } else if (action === 'toggle') {
        apiInput.type = apiInput.type === 'password' ? 'text' : 'password';
        btn.textContent = apiInput.type === 'password' ? '키보기' : '숨김';
      } else if (action === 'style-reset') {
        resetStylePrompt();
        styleInput.value = DEFAULT_STYLE_PROMPT;
        pushLog(['▷문체 지침이 기본값으로 돌아갔다!']);
      } else if (action === 'usage-reset') {
        if (!confirm('누적 토큰 사용량을 초기화할까요?')) return;
        resetUsage();
        refreshUsageSettingsSection(box);
        setFooter('USAGE RESET');
      } else if (action === 'preview') {
        const found = findLatestContext();
        if (!found) {
          alert('분석 대상 채팅을 찾지 못했습니다.');
          return;
        }

        const parsedInfo = parseInfoDeterministic(found.infoText);
        const preview = [
          '[Provider]',
          JSON.stringify({
            provider: getGeminiProvider(),
            model: getGeminiModel(),
            hasGeminiKey: hasGeminiKey(),
            hasFirebaseConfig: hasFirebaseConfig(),
            firebaseLocation: getFirebaseLocation(),
            firebaseSdkVersion: getFirebaseSdkVersion(),
            autoAnalyze: isAutoAnalyzeEnabled(),
          }, null, 2),
          '',
          '[최신 답변]',
          found.latestReply || '(없음)',
          '',
          '[RAW INFO BLOCK]',
          found.infoText || '(없음)',
          '',
          '[로컬 보조 파싱 결과]',
          JSON.stringify({
            character: parsedInfo.character,
            location: parsedInfo.location,
            situation: parsedInfo.situation,
            goal: parsedInfo.goal,
            relations: parsedInfo.relations,
            inventory: parsedInfo.inventory,
          }, null, 2),
          '',
          '[직전 맥락]',
          found.context || '(없음)',
        ].join('\n');

        lastDebugPayload = found;
        console.log('[UniChat INFO Game HUD] 분석 대상 미리보기\n', preview);
        alert(preview.slice(0, 1800));
      }
    });

    box.addEventListener('keydown', event => {
      const foldTitle = event.target.closest?.('.cigh-clean-settings-title[data-fold-section]');
      if (foldTitle && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        toggleFoldSection(foldTitle);
      }
    });

    apiInput?.addEventListener('keydown', event => {
      if (event.key === 'Enter') saveSettings();
      else if (event.key === 'Escape') box.remove();
    });
  }

  // ─────────────────────────────────────────────
  // Drag / route / theme
  // ─────────────────────────────────────────────
  function setupDrag(panel) {
    const head = panel.querySelector('#cigh-clean-head');
    if (!head) return;

    head.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || innerWidth <= 520) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        id: event.pointerId,
        sx: event.clientX,
        sy: event.clientY,
        left: rect.left,
        top: rect.top,
      };

      head.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    head.addEventListener('pointermove', event => {
      if (!dragState || dragState.id !== event.pointerId) return;

      const left = Math.max(6, Math.min(dragState.left + event.clientX - dragState.sx, innerWidth - 60));
      const top = Math.max(6, Math.min(dragState.top + event.clientY - dragState.sy, innerHeight - 50));

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const end = event => {
      if (dragState?.id === event.pointerId) {
        dragState = null;
        savePos(panel);
      }
    };

    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', () => { dragState = null; });
  }

  function panelHeightLimits(panel) {
    const rect = panel.getBoundingClientRect();
    const top = Number.isFinite(rect.top) && rect.top > 0 ? rect.top : 8;
    const min = getUiFontSize() === 'large' ? 360 : getUiFontSize() === 'medium' ? 310 : 260;
    const max = innerWidth <= 520 ? innerHeight - 96 : innerHeight - top - 8;
    return { min, max: Math.max(min, max) };
  }

  function setPanelHeight(panel, height, save = false) {
    const limit = panelHeightLimits(panel);
    const next = Math.round(clamp(height, limit.min, limit.max));
    panel.style.setProperty('height', `${next}px`, 'important');
    if (save) localStorage.setItem(PANEL_HEIGHT_KEY, String(next));
  }

  function savePanelHeight(panel) {
    setPanelHeight(panel, panel.getBoundingClientRect().height, true);
  }

  function restorePanelHeight(panel) {
    const saved = Number(localStorage.getItem(PANEL_HEIGHT_KEY) || 0);
    if (saved > 0) setPanelHeight(panel, saved, false);
  }

  function setupPanelResize(panel) {
    const handle = panel.querySelector('#cigh-clean-resize-y');
    if (!handle) return;

    handle.addEventListener('pointerdown', event => {
      if (event.button && event.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      resizeState = { id: event.pointerId, sy: event.clientY, height: rect.height };
      try { handle.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener('pointermove', event => {
      if (!resizeState || resizeState.id !== event.pointerId) return;
      setPanelHeight(panel, resizeState.height + event.clientY - resizeState.sy, false);
      event.preventDefault();
    });

    const end = event => {
      if (resizeState?.id !== event.pointerId) return;
      try { handle.releasePointerCapture(event.pointerId); } catch {}
      resizeState = null;
      savePanelHeight(panel);
      savePos(panel);
    };

    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { resizeState = null; });
  }

  function savePos(panel) {
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function restorePos(panel) {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (!pos || innerWidth <= 520) return;

      panel.style.left = `${Math.max(6, Math.min(pos.left, innerWidth - 80))}px`;
      panel.style.top = `${Math.max(6, Math.min(pos.top, innerHeight - 80))}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    } catch {}
  }

  function onRoomChanged() {
    const nextKey = roomKey();
    const prevKey = lastSeenRoomKey;

    if (nextKey === prevKey) return;

    saveRoomLogLines(prevKey);

    lastSeenRoomKey = nextKey;
    currentData = null;
    clearTransientUi();

    const settings = document.getElementById(SETTINGS_ID);
    if (settings) settings.remove();

    loadRoomData();
    watchAutoAnalyze();
    // 방 전환 즉시 마스코트 스프라이트 갱신 (이 방의 펫 상태로)
    if (isMascotEnabled()) updateMascotSprite();
  }

  function patchRoute() {
    const wrap = fn => function (...args) {
      const before = roomKey();
      const result = fn.apply(this, args);

      setTimeout(() => {
        if (roomKey() !== before) onRoomChanged();
        else loadRoomData();
      }, 120);

      return result;
    };

    if (!history.__cighCleanPatchedV122) {
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
      history.__cighCleanPatchedV122 = true;
    }

    window.addEventListener('popstate', () => setTimeout(onRoomChanged, 120));

    clearInterval(routeWatchTimer);
    routeWatchTimer = setInterval(onRoomChanged, 700);
  }

  function parseThemeColor(raw) {
    const m = String(raw || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function colorLuma(rgb) {
    if (!rgb) return null;
    const [r, g, b] = rgb.map(value => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function detectThemeMode() {
    const html = document.documentElement;
    const body = document.body;
    const classText = `${html?.className || ''} ${body?.className || ''}`.toLowerCase();
    const dataTheme = `${html?.getAttribute('data-theme') || ''} ${body?.getAttribute('data-theme') || ''}`.toLowerCase();

    if (/\bdark\b/.test(classText) || /\bdark\b/.test(dataTheme)) return 'dark';
    if (/\blight\b/.test(classText) || /\blight\b/.test(dataTheme)) return 'light';

    const luma = colorLuma(parseThemeColor(getComputedStyle(document.body).backgroundColor));
    if (luma != null) return luma > 0.55 ? 'light' : 'dark';

    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyThemeMode() {
    const mode = detectThemeMode();

    [
      document.getElementById(FAB_ID),
      document.getElementById(PANEL_ID),
      document.getElementById(POPUP_ID),
      document.getElementById(COMMENT_POPUP_ID),
      document.getElementById(SETTINGS_ID),
      document.getElementById(MASCOT_ID),
    ].filter(Boolean).forEach(el => {
      el.setAttribute('data-cigh-theme', mode);
      el.setAttribute('data-cigh-font', getUiFontSize());
    });
  }

  function watchThemeMode() {
    applyThemeMode();

    const observer = new MutationObserver(() => requestAnimationFrame(applyThemeMode));
    if (document.documentElement) observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });

    window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', applyThemeMode);
  }

  // ─────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────
  function injectStyle() {
    document.getElementById(STYLE_ID)?.remove();

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${FAB_ID}, #${PANEL_ID}, #${POPUP_ID}, #${COMMENT_POPUP_ID}, #${SETTINGS_ID}, #${MASCOT_ID} {
        --cigh-bg: #0d0e0b;
        --cigh-bg-2: #111210;
        --cigh-bg-3: #0f100e;
        --cigh-bg-soft: #090a08;
        --cigh-fill: #181917;
        --cigh-fill-soft: rgba(0,0,0,.18);
        --cigh-border: #222320;
        --cigh-border-soft: #1c1d1a;
        --cigh-border-faint: #191a17;
        --cigh-text: #e0d5b0;
        --cigh-text-soft: #5a5748;
        --cigh-text-faint: #3d3c35;
        --cigh-text-dim: #2d2c28;
        --cigh-accent: #c8a84b;
        --cigh-accent-soft: rgba(200,168,75,.34);
        --cigh-accent-softer: rgba(200,168,75,.07);
        --cigh-good: #5aaa70;
        --cigh-shadow-fab: 0 2px 10px rgba(0,0,0,.45);
        --cigh-shadow-panel: 0 8px 40px rgba(0,0,0,.65);
        --cigh-shadow-popup: 0 4px 20px rgba(0,0,0,.55);
        --cigh-shadow-settings: 0 8px 26px rgba(0,0,0,.55);
        --cigh-fill-grad: linear-gradient(90deg, #3a6e62, #c8a84b);
        --cigh-rel-grad: linear-gradient(90deg, #a24d5d, #db5d6f, #f0c15a);
      }

      #${FAB_ID}[data-cigh-theme="light"],
      #${PANEL_ID}[data-cigh-theme="light"],
      #${POPUP_ID}[data-cigh-theme="light"],
      #${COMMENT_POPUP_ID}[data-cigh-theme="light"],
      #${SETTINGS_ID}[data-cigh-theme="light"],
      #${MASCOT_ID}[data-cigh-theme="light"] {
        --cigh-bg: #fffdf8;
        --cigh-bg-2: #f6efe2;
        --cigh-bg-3: #fbf5ea;
        --cigh-bg-soft: #f2eadb;
        --cigh-fill: #e9decc;
        --cigh-fill-soft: rgba(218,204,180,.38);
        --cigh-border: #d7c7ae;
        --cigh-border-soft: #e4d7c1;
        --cigh-border-faint: #ecdfcb;
        --cigh-text: #5b4a39;
        --cigh-text-soft: #7f6c58;
        --cigh-text-faint: #9b866f;
        --cigh-text-dim: #b09d8a;
        --cigh-accent: #b8863b;
        --cigh-accent-soft: rgba(184,134,59,.30);
        --cigh-accent-softer: rgba(184,134,59,.10);
        --cigh-good: #528965;
        --cigh-shadow-fab: 0 2px 10px rgba(120,90,45,.16);
        --cigh-shadow-panel: 0 8px 30px rgba(120,90,45,.18);
        --cigh-shadow-popup: 0 4px 20px rgba(120,90,45,.18);
        --cigh-shadow-settings: 0 8px 24px rgba(120,90,45,.18);
        --cigh-fill-grad: linear-gradient(90deg, #7fa696, #c9a35c);
        --cigh-rel-grad: linear-gradient(90deg, #c47a88, #e46576, #e9b465);
      }

      #${FAB_ID} {
        position: fixed;
        left: 16px;
        bottom: 82px;
        z-index: 2147483645;
        width: 34px;
        height: 34px;
        border-radius: 7px;
        cursor: grab;
        touch-action: none;
        user-select: none;
        background: var(--cigh-bg);
        border: 1px solid var(--cigh-border-soft);
        color: var(--cigh-accent);
        font-size: 15px;
        line-height: 1;
        display: grid;
        place-items: center;
        box-shadow: var(--cigh-shadow-fab);
      }
      #${FAB_ID}:hover {
        border-color: var(--cigh-accent);
        box-shadow: 0 0 10px var(--cigh-accent-softer);
      }
      #${FAB_ID}:active {
        cursor: grabbing;
      }

      #${PANEL_ID} {
        position: fixed;
        left: 16px;
        bottom: 124px;
        z-index: 2147483645;
        width: 252px;
        height: 374px;
        display: none;
        flex-direction: column;
        overflow: hidden;
        background: var(--cigh-bg);
        border: 1px solid var(--cigh-border);
        border-radius: 8px;
        font-family: "Courier New", Consolas, monospace;
        font-size: 11px;
        color: var(--cigh-text);
        box-shadow: var(--cigh-shadow-panel);
      }
      #${PANEL_ID}.open { display: flex; }
      .cigh-clean-resize-y {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 8px;
        cursor: ns-resize;
        touch-action: none;
        z-index: 4;
      }
      .cigh-clean-resize-y::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: 2px;
        width: 34px;
        height: 2px;
        transform: translateX(-50%);
        border-radius: 999px;
        background: var(--cigh-border-soft);
        opacity: .75;
      }

      .cigh-clean-head {
        height: 27px;
        min-height: 27px;
        padding: 0 8px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--cigh-bg-2);
        border-bottom: 1px solid var(--cigh-border-soft);
        cursor: move;
        user-select: none;
      }
      .cigh-clean-ttl {
        color: var(--cigh-accent);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .12em;
      }
      .cigh-clean-room {
        flex: 1;
        color: var(--cigh-text-dim);
        font-size: 9px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .cigh-clean-x {
        border: none;
        background: none;
        color: var(--cigh-text-faint);
        cursor: pointer;
        font: inherit;
        font-size: 11px;
        padding: 0 2px;
      }
      .cigh-clean-x:hover { color: var(--cigh-text); }

      .cigh-clean-tabs {
        height: 26px;
        min-height: 26px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        background: var(--cigh-bg-3);
        border-bottom: 1px solid var(--cigh-border-faint);
      }
      .cigh-clean-tab {
        border: none;
        background: none;
        color: var(--cigh-text-faint);
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .16em;
      }
      .cigh-clean-tab:hover { color: var(--cigh-accent); }
      .cigh-clean-tab.on {
        color: var(--cigh-accent);
        background: var(--cigh-accent-softer);
      }

      .cigh-clean-main {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px;
        scrollbar-width: thin;
        scrollbar-color: var(--cigh-border) transparent;
      }
      .cigh-clean-main::-webkit-scrollbar { width: 3px; }
      .cigh-clean-main::-webkit-scrollbar-thumb { background: var(--cigh-border); }

      .cigh-clean-log-screen {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .cigh-clean-log-inner {
        flex: 1;
        overflow-y: auto;
        line-height: 1.5;
        scrollbar-width: thin;
        scrollbar-color: var(--cigh-border) transparent;
      }

      .cigh-clean-sec { margin-bottom: 10px; }
      .cigh-clean-sh {
        color: var(--cigh-text-faint);
        font-size: 9px;
        letter-spacing: .14em;
        padding-bottom: 4px;
        margin-bottom: 5px;
        border-bottom: 1px solid var(--cigh-fill);
      }
      .cigh-clean-srow {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 2px 0;
        border-bottom: 1px solid color-mix(in srgb, var(--cigh-fill) 70%, transparent);
      }
      .cigh-clean-slbl { color: var(--cigh-text-faint); }
      .cigh-clean-sval {
        color: color-mix(in srgb, var(--cigh-accent) 55%, var(--cigh-text) 45%);
        text-align: right;
        max-width: 160px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .cigh-clean-situ {
        color: color-mix(in srgb, var(--cigh-accent) 55%, var(--cigh-text) 45%);
        line-height: 1.45;
      }

      .cigh-clean-brow { margin-bottom: 8px; }
      .cigh-clean-blbl {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
        font-size: 10px;
        margin-bottom: 3px;
      }
      .cigh-clean-mname {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }
      .cigh-clean-heart {
        transform-origin: center;
        will-change: transform;
        animation: cigh-clean-beat 1.45s ease-in-out infinite;
      }
      @keyframes cigh-clean-beat {
        0%, 100% { transform: scale(1); }
        45% { transform: scale(1.12); }
      }
      .cigh-clean-bdim {
        color: var(--cigh-text-faint);
        font-size: 9.5px;
      }
      .cigh-clean-pixelbar {
        display: grid;
        grid-template-columns: repeat(10, 1fr);
        gap: 2px;
        height: 6px;
      }
      .cigh-clean-pixelbar span {
        background: var(--cigh-fill);
        border: 1px solid var(--cigh-border-soft);
        box-sizing: border-box;
      }
      .cigh-clean-pixelbar span.on {
        background: var(--cigh-rel-grad);
      }

      .cigh-clean-irow {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 3px 2px;
      }
      .cigh-clean-ico {
        width: 16px;
        text-align: center;
        flex: 0 0 auto;
      }
      .cigh-clean-idetail {
        color: var(--cigh-text-soft);
        font-size: 9.5px;
        margin-top: 2px;
        line-height: 1.35;
      }
      .cigh-clean-q {
        color: var(--cigh-good);
        padding: 1px 0;
      }
      .cigh-clean-empty {
        height: 80px;
        display: grid;
        place-items: center;
        color: var(--cigh-text-dim);
        font-size: 9.5px;
        letter-spacing: .08em;
      }
      .cigh-clean-particle {
        position: absolute;
        left: 50%;
        top: 44%;
        width: 5px;
        height: 5px;
        border-radius: 1px;
        pointer-events: none;
        image-rendering: pixelated;
        z-index: 2;
        animation: cigh-clean-burst 0.72s ease-out forwards;
      }
      @keyframes cigh-clean-burst {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        70% { opacity: 1; }
        100% { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.35); opacity: 0; }
      }
      .cigh-clean-pet-wrap {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        width: 100%;
        aspect-ratio: 1 / 1;
        min-height: 0;
        padding: 10px 0 12px;
        margin: -1px -1px 6px;
        border-bottom: 1px solid var(--cigh-fill);
        overflow: hidden;
        image-rendering: pixelated;
        box-sizing: border-box;
        flex: 0 0 auto;
      }
      .cigh-clean-pet-wrap.is-edit {
        outline: 1px dashed color-mix(in srgb, var(--cigh-accent) 42%, transparent);
        outline-offset: -3px;
        justify-content: flex-start;
      }
      .cigh-clean-pet-wrap > .cigh-clean-pet-speech,
      .cigh-clean-pet-wrap > .cigh-clean-pet-room-spacer,
      .cigh-clean-pet-wrap > .cigh-clean-deco-editor,
      .cigh-clean-pet-wrap > .cigh-clean-pet-edit-btn {
        position: relative;
        z-index: 5;
      }
      .cigh-clean-pet-wrap > .cigh-clean-pet-sprite {
        position: relative;
        z-index: 4;
      }
      .cigh-clean-pet-speech {
        max-width: 90%;
        /* EDIT 버튼과 겹치지 않게 말풍선만 살짝 아래로 */
        margin-top: calc(7px * var(--cigh-ui-font-scale, 1));
        margin-bottom: calc(-7px * var(--cigh-ui-font-scale, 1));
        background: var(--cigh-fill);
        border: 1px solid var(--cigh-border-soft);
        border-radius: 8px;
        padding: 5px 9px;
        font-size: calc(10.5px * var(--cigh-ui-font-scale, 1));
        color: var(--cigh-text);
        text-align: center;
        line-height: 1.4;
        word-break: keep-all;
        animation: cigh-clean-pop 0.28s ease;
        cursor: pointer;
      }
      .cigh-clean-pet-speech.is-hidden {
        visibility: hidden;
        opacity: 0;
        pointer-events: none;
      }
      .cigh-clean-pet-room-spacer {
        flex: 0 0 auto;
        width: 1px;
        /* 칭호 착용 여부와 무관하게 같은 높이 유지 + 펫 위치 추가 하향 */
        height: calc(65px * var(--cigh-ui-font-scale, 1));
        pointer-events: none;
        opacity: 0;
      }
      .cigh-clean-pet-room-spacer.has-title {
        height: calc(65px * var(--cigh-ui-font-scale, 1));
      }
      @keyframes cigh-clean-pop {
        0% { opacity: 0; transform: scale(0.9) translateY(4px); }
        100% { opacity: 1; transform: scale(1) translateY(0); }
      }
      .cigh-clean-pet-stage {
        color: var(--cigh-accent);
        font-size: calc(11px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        letter-spacing: .1em;
      }
      .cigh-clean-pet-sprite {
        display: grid;
        place-items: center;
        min-height: 102px;
        padding: 4px;
        cursor: pointer;
        animation: cigh-clean-float 2.4s ease-in-out infinite;
      }
      .cigh-clean-pet-sprite.is-sleep {
        animation: none;
      }
      .cigh-clean-pet-sprite.egg-poke .cigh-clean-pet-svg,
      .cigh-clean-pet-sprite.egg-poke .cigh-clean-pet-img-wrap {
        animation: cigh-clean-egg-wobble 0.42s ease;
        transform-origin: center bottom;
      }
      .cigh-clean-pet-sprite.is-sleep .cigh-clean-pet-img-wrap,
      .cigh-clean-pet-sprite.is-sleep .cigh-clean-pet-svg {
        animation: cigh-clean-sleep-breathe 2.2s ease-in-out infinite;
        transform-origin: center bottom;
      }
      .cigh-clean-pet-svg {
        image-rendering: pixelated;
      }
      .cigh-clean-pet-img-wrap {
        display: grid;
        place-items: center;
        position: relative;
        width: var(--cigh-pet-img-size, 112px);
        height: var(--cigh-pet-img-size, 112px);
        overflow: visible;
      }
      #cigh-clean-panel{--cigh-deco-scale:1;--cigh-ui-font-scale:1;}
      #cigh-clean-panel[data-cigh-font="small"]{--cigh-deco-scale:.92;--cigh-ui-font-scale:.92;}
      #cigh-clean-panel[data-cigh-font="large"]{--cigh-deco-scale:1.1;--cigh-ui-font-scale:1.12;}

      .cigh-clean-pet-edit-btn {
        position: absolute !important;
        right: 6px;
        top: 5px;
        z-index: 8 !important;
      }
      .cigh-clean-pet-edit-btn.save {
        color: var(--cigh-good);
        border-color: color-mix(in srgb, var(--cigh-good) 45%, var(--cigh-border-soft));
      }
      .cigh-clean-room-wall,
      .cigh-clean-room-floor {
        position: absolute;
        left: 0;
        right: 0;
        pointer-events: none;
        z-index: 0;
      }
      .cigh-clean-room-wall {
        top: 0;
        height: 50%;
        background: transparent;
      }
      .cigh-clean-room-floor {
        bottom: 0;
        height: calc(50% + 1px);
        background: transparent;
        border-top: none;
      }
      .cigh-clean-room-floor::before,
      .cigh-clean-room-floor::after {
        content: none !important;
      }
      .cigh-clean-room-props {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
      }
      .cigh-clean-room-prop {
        position: absolute;
        z-index: 2;
        transform: translate(-50%, -50%);
        min-width: 20px;
        min-height: 18px;
        padding: 1px 3px;
        border: 1px solid color-mix(in srgb, var(--cigh-border-soft) 75%, transparent);
        background: color-mix(in srgb, var(--cigh-fill) 80%, transparent);
        color: var(--cigh-text-soft);
        font-family: "Courier New", Consolas, monospace;
        font-size: 13px;
        line-height: 1;
        display: grid;
        place-items: center;
        cursor: default;
        image-rendering: pixelated;
        box-shadow: 2px 2px 0 color-mix(in srgb, #000 18%, transparent);
        pointer-events: auto;
      }
      .cigh-clean-room-prop.editable { cursor: grab; }
      .cigh-clean-room-prop.dragging {
        cursor: grabbing;
        z-index: 7;
        filter: brightness(1.12);
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-night-star { background: radial-gradient(circle at 22% 28%, rgba(255,230,120,.9) 0 1px, transparent 2px), radial-gradient(circle at 72% 44%, rgba(255,230,120,.75) 0 1px, transparent 2px), linear-gradient(#0c1024, #141125); }
      .cigh-clean-room-floor.cigh-clean-deco-floor-wood { background: repeating-linear-gradient(90deg, #3b271e 0 18px, #4a3024 18px 20px, #2b1c17 20px 38px); }
      .cigh-clean-room-floor.cigh-clean-deco-floor-wood-piskel {
        background:#9b9186 url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%239b9186'/><rect x='0' y='0' width='8' height='32' fill='%2393887d'/><rect x='8' y='0' width='8' height='32' fill='%23a0968b'/><rect x='16' y='0' width='8' height='32' fill='%238f8478'/><rect x='24' y='0' width='8' height='32' fill='%23a59a90'/><rect x='7' y='0' width='1' height='32' fill='%23706760'/><rect x='15' y='0' width='1' height='32' fill='%236a615a'/><rect x='23' y='0' width='1' height='32' fill='%23706760'/><rect x='2' y='4' width='3' height='1' fill='%23b7aca0'/><rect x='10' y='7' width='4' height='1' fill='%23b2a79c'/><rect x='18' y='5' width='3' height='1' fill='%23877c73'/><rect x='26' y='8' width='3' height='1' fill='%23bbb1a6'/><rect x='3' y='13' width='2' height='1' fill='%23857b72'/><rect x='11' y='15' width='3' height='1' fill='%23b8aea3'/><rect x='19' y='12' width='4' height='1' fill='%23867c73'/><rect x='27' y='16' width='2' height='1' fill='%23b3a89d'/><rect x='1' y='22' width='4' height='1' fill='%23b9afa4'/><rect x='9' y='24' width='3' height='1' fill='%238b8077'/><rect x='18' y='21' width='2' height='1' fill='%23b5aba0'/><rect x='25' y='25' width='4' height='1' fill='%23877c73'/></svg>") repeat;
        background-size: 32px 32px;
        image-rendering: pixelated;
      }
      .cigh-clean-room-floor.cigh-clean-deco-floor-ash-wood {
        background-color: #bab29d;
        background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAWElEQVR4AezXMQqAMBBE0WF6Faz08F7C0gtpJWgOkBwh5UD4gd+HBwu7vs6jJrPCjw8ggIDL/yqZn/tTMm/7omSe5lXJmAIEEEAAAQTYB9gHmILxBXrHdwMAAP//gF1LwAAAAAZJREFUAwD5XOFQBKR2zgAAAABJRU5ErkJggg==");
        background-repeat: repeat;
        background-size: 64px 64px;
        image-rendering: pixelated;
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-sky{
        background-color:#79b6e6;
        background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA2NCA0MCc+PHJlY3QgeD0nOScgeT0nNycgd2lkdGg9JzcnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzcnIHk9JzgnIHdpZHRoPScxMScgaGVpZ2h0PScxJyBmaWxsPScjZmZmZmZmJy8+PHJlY3QgeD0nNicgeT0nOScgd2lkdGg9JzEzJyBoZWlnaHQ9JzEnIGZpbGw9JyNmZmZmZmYnLz48cmVjdCB4PSc1JyB5PScxMCcgd2lkdGg9JzE1JyBoZWlnaHQ9JzEnIGZpbGw9JyNlZWY0ZmEnLz48cmVjdCB4PSc2JyB5PScxMScgd2lkdGg9JzEzJyBoZWlnaHQ9JzEnIGZpbGw9JyNjNWQzZTAnLz48cmVjdCB4PSc5JyB5PScxMicgd2lkdGg9JzcnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjxyZWN0IHg9JzQxJyB5PScxMCcgd2lkdGg9JzUnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzM5JyB5PScxMScgd2lkdGg9JzknIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzM5JyB5PScxMicgd2lkdGg9JzknIGhlaWdodD0nMScgZmlsbD0nI2VlZjRmYScvPjxyZWN0IHg9JzQwJyB5PScxMycgd2lkdGg9JzcnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjxyZWN0IHg9JzQyJyB5PScxNCcgd2lkdGg9JzQnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjxyZWN0IHg9JzI3JyB5PScyNicgd2lkdGg9JzUnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzI1JyB5PScyNycgd2lkdGg9JzknIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzI2JyB5PScyOCcgd2lkdGg9JzcnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjxyZWN0IHg9JzUyJyB5PScyOCcgd2lkdGg9JzQnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzUxJyB5PScyOScgd2lkdGg9JzYnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzUyJyB5PSczMCcgd2lkdGg9JzQnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjxyZWN0IHg9JzExJyB5PSczMCcgd2lkdGg9JzUnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzEwJyB5PSczMScgd2lkdGg9JzcnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzEyJyB5PSczMicgd2lkdGg9JzMnIGhlaWdodD0nMScgZmlsbD0nI2M1ZDNlMCcvPjwvc3ZnPg=="),linear-gradient(#4a93d4 0%,#79b6e6 55%,#bfe0f4 100%);
        background-repeat:repeat,no-repeat;
        background-position:top left,center;
        background-size:64px 40px,100% 100%;
        image-rendering:pixelated;
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-plain-ivory{
        background:#f0eae3;
        image-rendering:pixelated;
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-plain-pink{
        background-color:#846d55;
        background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAO0lEQVR4AezXwQkAMAgDwOKOHaNbdG8dwacgF8g/3C/x383JxhmOAQQIECBAgAABAgQIECBAYL9Ad74LAAD//6nu6zMAAAAGSURBVAMAGg1I4W6zWCUAAAAASUVORK5CYII=");
        background-repeat:repeat;
        background-size:64px 64px;
        image-rendering:pixelated;
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-plain-plain-3{
        background-color:#949b8d;
        background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOklEQVR4AezXMQoAMAgDwOL/u3XrY/UJjoJcIHu4LfH+zcnGGY4BBAgQIECAAAECBAgQIEBgv0B3vgsAAP//ZkcOWwAAAAZJREFUAwBKw1ehhQmjwwAAAABJRU5ErkJggg==");
        background-repeat:repeat;
        background-size:64px 64px;
        image-rendering:pixelated;
      }
      .cigh-clean-room-wall.cigh-clean-deco-wall-muted-sage{ background:#b8c2b0; image-rendering:pixelated; }
      .cigh-clean-room-wall.cigh-clean-deco-wall-muted-bluegrey{ background:#b4bcc7; image-rendering:pixelated; }
      .cigh-clean-room-wall.cigh-clean-deco-wall-muted-mauve{ background:#c4b6bf; image-rendering:pixelated; }
      .cigh-clean-room-wall.cigh-clean-deco-wall-pastel-mint{ background:#d9efe3; image-rendering:pixelated; }
      .cigh-clean-room-wall.cigh-clean-deco-wall-pastel-peach{ background:#f4ddd2; image-rendering:pixelated; }
      .cigh-clean-room-wall.cigh-clean-deco-wall-pastel-lilac{ background:#e7def6; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-grass{
        background-color:#78bc54;
        background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAzMiAzMic+PHJlY3Qgd2lkdGg9JzMyJyBoZWlnaHQ9JzMyJyBmaWxsPScjNzhiYzU0Jy8+PHJlY3QgeD0nMycgeT0nNScgd2lkdGg9JzEnIGhlaWdodD0nMycgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzUnIHk9JzQnIHdpZHRoPScxJyBoZWlnaHQ9JzQnIGZpbGw9JyMzNDdmM2YnLz48cmVjdCB4PSc0JyB5PSc2JyB3aWR0aD0nMScgaGVpZ2h0PScyJyBmaWxsPScjOWJkODc3Jy8+PHJlY3QgeD0nMjAnIHk9JzMnIHdpZHRoPScxJyBoZWlnaHQ9JzMnIGZpbGw9JyMzNDdmM2YnLz48cmVjdCB4PScyMicgeT0nNCcgd2lkdGg9JzEnIGhlaWdodD0nMycgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzE0JyB5PScxNCcgd2lkdGg9JzEnIGhlaWdodD0nMycgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzE2JyB5PScxMycgd2lkdGg9JzEnIGhlaWdodD0nNCcgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzE1JyB5PScxNScgd2lkdGg9JzEnIGhlaWdodD0nMicgZmlsbD0nIzliZDg3NycvPjxyZWN0IHg9JzI2JyB5PScxOCcgd2lkdGg9JzEnIGhlaWdodD0nMycgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzI4JyB5PScxOScgd2lkdGg9JzEnIGhlaWdodD0nMycgZmlsbD0nIzM0N2YzZicvPjxyZWN0IHg9JzYnIHk9JzIyJyB3aWR0aD0nMScgaGVpZ2h0PSczJyBmaWxsPScjMzQ3ZjNmJy8+PHJlY3QgeD0nOCcgeT0nMjEnIHdpZHRoPScxJyBoZWlnaHQ9JzQnIGZpbGw9JyMzNDdmM2YnLz48cmVjdCB4PSc3JyB5PScyMycgd2lkdGg9JzEnIGhlaWdodD0nMicgZmlsbD0nIzliZDg3NycvPjxyZWN0IHg9JzEwJyB5PSc5JyB3aWR0aD0nMScgaGVpZ2h0PScxJyBmaWxsPScjOGFjODY2Jy8+PHJlY3QgeD0nMjQnIHk9JzI3JyB3aWR0aD0nMScgaGVpZ2h0PScxJyBmaWxsPScjOGFjODY2Jy8+PHJlY3QgeD0nMTgnIHk9JzI1JyB3aWR0aD0nMScgaGVpZ2h0PScxJyBmaWxsPScjNjJhNDQ0Jy8+PHJlY3QgeD0nMicgeT0nMTYnIHdpZHRoPScxJyBoZWlnaHQ9JzEnIGZpbGw9JyM2MmE0NDQnLz48cmVjdCB4PScyOScgeT0nOScgd2lkdGg9JzInIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzI4JyB5PSc4JyB3aWR0aD0nMScgaGVpZ2h0PScxJyBmaWxsPScjZmZmZmZmJy8+PHJlY3QgeD0nMzAnIHk9JzgnIHdpZHRoPScxJyBoZWlnaHQ9JzEnIGZpbGw9JyNmZmZmZmYnLz48cmVjdCB4PScyOScgeT0nOCcgd2lkdGg9JzEnIGhlaWdodD0nMScgZmlsbD0nI2ZmZTE0ZCcvPjxyZWN0IHg9JzEyJyB5PScyOCcgd2lkdGg9JzEnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzExJyB5PScyOScgd2lkdGg9JzMnIGhlaWdodD0nMScgZmlsbD0nI2ZmZmZmZicvPjxyZWN0IHg9JzEyJyB5PScyOScgd2lkdGg9JzEnIGhlaWdodD0nMScgZmlsbD0nI2ZmZTE0ZCcvPjwvc3ZnPg==");
        background-repeat:repeat;
        background-size:32px 32px;
        image-rendering:pixelated;
      }      .cigh-clean-room-floor.cigh-clean-deco-floor-deep-grass{
        background:#3f7f3f url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%233f7f3f'/><rect x='3' y='4' width='1' height='4' fill='%23224f23'/><rect x='5' y='5' width='1' height='4' fill='%23224f23'/><rect x='4' y='6' width='1' height='2' fill='%2368a84f'/><rect x='12' y='12' width='1' height='4' fill='%23224f23'/><rect x='14' y='11' width='1' height='5' fill='%23224f23'/><rect x='13' y='13' width='1' height='2' fill='%2368a84f'/><rect x='22' y='3' width='1' height='4' fill='%23224f23'/><rect x='24' y='4' width='1' height='4' fill='%23224f23'/><rect x='23' y='5' width='1' height='2' fill='%2368a84f'/><rect x='26' y='18' width='1' height='4' fill='%23224f23'/><rect x='28' y='19' width='1' height='4' fill='%23224f23'/><rect x='27' y='20' width='1' height='2' fill='%2368a84f'/><rect x='7' y='23' width='1' height='4' fill='%23224f23'/><rect x='9' y='22' width='1' height='5' fill='%23224f23'/><rect x='8' y='24' width='1' height='2' fill='%2368a84f'/><rect x='16' y='24' width='1' height='1' fill='%23599646'/><rect x='2' y='16' width='1' height='1' fill='%23599646'/><rect x='18' y='28' width='1' height='1' fill='%23599646'/><rect x='29' y='9' width='1' height='1' fill='%23f0f6ff'/><rect x='30' y='9' width='1' height='1' fill='%23f0f6ff'/><rect x='29' y='10' width='1' height='1' fill='%23ffd767'/><rect x='12' y='29' width='1' height='1' fill='%23f0f6ff'/><rect x='11' y='30' width='3' height='1' fill='%23f0f6ff'/><rect x='12' y='30' width='1' height='1' fill='%23ffd767'/></svg>") repeat;background-size:32px 32px;image-rendering:pixelated;}
      .cigh-clean-room-floor.cigh-clean-deco-floor-star-grass{
        background:#2f5b30 url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%232f5b30'/><rect x='3' y='5' width='1' height='4' fill='%231a331b'/><rect x='5' y='4' width='1' height='5' fill='%231a331b'/><rect x='4' y='6' width='1' height='2' fill='%235b8e53'/><rect x='11' y='12' width='1' height='4' fill='%231a331b'/><rect x='13' y='11' width='1' height='5' fill='%231a331b'/><rect x='12' y='13' width='1' height='2' fill='%235b8e53'/><rect x='22' y='3' width='1' height='4' fill='%231a331b'/><rect x='24' y='4' width='1' height='4' fill='%231a331b'/><rect x='23' y='5' width='1' height='2' fill='%235b8e53'/><rect x='27' y='17' width='1' height='4' fill='%231a331b'/><rect x='29' y='18' width='1' height='4' fill='%231a331b'/><rect x='28' y='19' width='1' height='2' fill='%235b8e53'/><rect x='7' y='22' width='1' height='4' fill='%231a331b'/><rect x='9' y='21' width='1' height='5' fill='%231a331b'/><rect x='8' y='23' width='1' height='2' fill='%235b8e53'/><rect x='16' y='25' width='1' height='1' fill='%23447640'/><rect x='2' y='15' width='1' height='1' fill='%23447640'/><rect x='18' y='28' width='1' height='1' fill='%23447640'/><rect x='6' y='10' width='1' height='1' fill='%23f4f8ff'/><rect x='7' y='10' width='1' height='1' fill='%23f4f8ff'/><rect x='6' y='11' width='1' height='1' fill='%23ffe07c'/><rect x='20' y='8' width='1' height='1' fill='%23f4f8ff'/><rect x='21' y='8' width='1' height='1' fill='%23f4f8ff'/><rect x='20' y='9' width='1' height='1' fill='%23ffe07c'/><rect x='25' y='26' width='1' height='1' fill='%23f4f8ff'/><rect x='26' y='26' width='1' height='1' fill='%23f4f8ff'/><rect x='25' y='27' width='1' height='1' fill='%23ffe07c'/><rect x='12' y='28' width='1' height='1' fill='%23f4f8ff'/><rect x='13' y='28' width='1' height='1' fill='%23f4f8ff'/><rect x='12' y='29' width='1' height='1' fill='%23ffe07c'/></svg>") repeat;
        background-size:32px 32px;
        image-rendering:pixelated;
      }
      .cigh-clean-room-floor.cigh-clean-deco-floor-cloud-soft{
        background:#cfe5f6 url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23cfe5f6'/><rect x='3' y='6' width='7' height='1' fill='%23ffffff'/><rect x='2' y='7' width='10' height='1' fill='%23ffffff'/><rect x='2' y='8' width='10' height='1' fill='%23eef7ff'/><rect x='3' y='9' width='8' height='1' fill='%23d9e8f4'/><rect x='4' y='10' width='5' height='1' fill='%23d9e8f4'/><rect x='18' y='4' width='5' height='1' fill='%23ffffff'/><rect x='17' y='5' width='8' height='1' fill='%23ffffff'/><rect x='17' y='6' width='8' height='1' fill='%23eef7ff'/><rect x='18' y='7' width='6' height='1' fill='%23d9e8f4'/><rect x='21' y='8' width='2' height='1' fill='%23d9e8f4'/><rect x='11' y='18' width='7' height='1' fill='%23ffffff'/><rect x='10' y='19' width='10' height='1' fill='%23ffffff'/><rect x='10' y='20' width='10' height='1' fill='%23eef7ff'/><rect x='11' y='21' width='8' height='1' fill='%23d9e8f4'/><rect x='12' y='22' width='5' height='1' fill='%23d9e8f4'/><rect x='23' y='22' width='5' height='1' fill='%23ffffff'/><rect x='22' y='23' width='8' height='1' fill='%23ffffff'/><rect x='22' y='24' width='8' height='1' fill='%23eef7ff'/><rect x='23' y='25' width='6' height='1' fill='%23d9e8f4'/><rect x='5' y='24' width='5' height='1' fill='%23ffffff'/><rect x='4' y='25' width='8' height='1' fill='%23ffffff'/><rect x='4' y='26' width='8' height='1' fill='%23eef7ff'/><rect x='5' y='27' width='6' height='1' fill='%23d9e8f4'/></svg>") repeat;
        background-size:32px 32px;
        image-rendering:pixelated;
      }
      .cigh-clean-room-floor.cigh-clean-deco-floor-muted-sand{ background:#b7ab9b; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-muted-sage{ background:#a7b39f; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-muted-bluegrey{ background:#9ea9b6; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-pastel-cream{ background:#f1e8d7; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-pastel-mint{ background:#d1e6db; image-rendering:pixelated; }
      .cigh-clean-room-floor.cigh-clean-deco-floor-pastel-lilac{ background:#d8d0ea; image-rendering:pixelated; }

      .cigh-clean-room-prop.cigh-clean-deco-prop-cushion,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plant,
      .cigh-clean-room-prop.cigh-clean-deco-prop-books,
      .cigh-clean-room-prop.cigh-clean-deco-prop-lamp,
      .cigh-clean-room-prop.cigh-clean-deco-prop-star,
      .cigh-clean-room-prop.cigh-clean-deco-prop-table,
      .cigh-clean-room-prop.cigh-clean-deco-prop-rug,
      .cigh-clean-room-prop.cigh-clean-deco-prop-clock,
      .cigh-clean-room-prop.cigh-clean-deco-prop-bed,
      .cigh-clean-room-prop.cigh-clean-deco-prop-door,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-twin,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-bell,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blossom,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-white,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blue,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-sun,
      .cigh-clean-room-prop.cigh-clean-deco-prop-bush-berry,
      .cigh-clean-room-prop.cigh-clean-deco-prop-fence-wood,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-sakura,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-willow,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-maple,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-dream,
      .cigh-clean-room-prop.cigh-clean-deco-prop-moon-full,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-iv,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-iv,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-iv,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-iv,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-mt,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-mt,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-mt,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-mt,
      .cigh-clean-room-prop.cigh-clean-deco-prop-swag,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-large,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-small,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-curtain
{
        background-color:transparent;border-color:transparent;box-shadow:none;
        padding:0;min-width:0;min-height:0;
        font-size:calc(2px * var(--cigh-deco-scale,1));
        background-repeat:no-repeat;background-position:center;background-size:contain;
        image-rendering:pixelated;
      }
      .cigh-clean-room-prop.cigh-clean-deco-prop-cushion>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plant>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-books>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-lamp>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-star>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-table>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-rug>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-clock>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-bed>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-door>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-twin>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-bell>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blossom>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-white>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blue>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-sun>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-bush-berry>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-fence-wood>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-sakura>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-willow>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-maple>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-dream>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-moon-full>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-iv>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-iv>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-iv>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-iv>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-mt>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-mt>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-mt>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-mt>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-swag>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-large>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-small>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-curtain>span{font-size:0;line-height:0;}
      .cigh-clean-room-prop.cigh-clean-deco-prop-cushion{width:30em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 20'><rect x='4' y='4' width='20' height='12' fill='%23f0c97a'/><rect x='3' y='6' width='22' height='8' fill='%23f0c97a'/><rect x='4' y='3' width='20' height='2' fill='%23ffe0a0'/><rect x='4' y='14' width='20' height='2' fill='%23cf9f4a'/><rect x='2' y='4' width='2' height='3' fill='%23fff0c8'/><rect x='24' y='4' width='2' height='3' fill='%23fff0c8'/><rect x='2' y='13' width='2' height='3' fill='%23fff0c8'/><rect x='24' y='13' width='2' height='3' fill='%23fff0c8'/><rect x='13' y='9' width='2' height='2' fill='%23cf9f4a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-plant{width:20em;height:25em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='5' y='20' width='12' height='7' fill='%23c2724a'/><rect x='4' y='18' width='14' height='3' fill='%23d98a5e'/><rect x='6' y='24' width='10' height='1' fill='%23a85d38'/><rect x='10' y='9' width='2' height='11' fill='%233f8f55'/><rect x='5' y='10' width='5' height='3' fill='%235cb878'/><rect x='3' y='12' width='4' height='2' fill='%234ea568'/><rect x='12' y='8' width='5' height='3' fill='%235cb878'/><rect x='15' y='10' width='4' height='2' fill='%234ea568'/><rect x='8' y='5' width='6' height='3' fill='%236cc888'/><rect x='9' y='3' width='4' height='2' fill='%237ad497'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-books{width:24em;height:19em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 26 22'><rect x='2' y='15' width='22' height='5' fill='%237d6bd8'/><rect x='2' y='15' width='22' height='1' fill='%239a8bf0'/><rect x='2' y='19' width='22' height='1' fill='%235e4eb0'/><rect x='3' y='16' width='1' height='3' fill='%23f0ecff'/><rect x='4' y='10' width='20' height='5' fill='%23e46b96'/><rect x='4' y='10' width='20' height='1' fill='%23ff8db8'/><rect x='5' y='11' width='1' height='3' fill='%23ffe3ee'/><rect x='3' y='5' width='18' height='5' fill='%234ea568'/><rect x='3' y='5' width='18' height='1' fill='%236cc888'/><rect x='4' y='6' width='1' height='3' fill='%23e8ffee'/><rect x='17' y='3' width='2' height='4' fill='%23ffd166'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-lamp{width:23em;height:39em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 48'><rect x='10' y='4' width='8' height='1' fill='%23ffe7a8'/><rect x='9' y='5' width='10' height='1' fill='%23ffdf8a'/><rect x='8' y='6' width='12' height='1' fill='%23ffd166'/><rect x='7' y='7' width='14' height='1' fill='%23ffd166'/><rect x='6' y='8' width='16' height='1' fill='%23f0c050'/><rect x='6' y='9' width='16' height='1' fill='%23e8b84a'/><rect x='7' y='10' width='14' height='1' fill='%23d8a83e'/><rect x='12' y='11' width='4' height='1' fill='%235c4a38'/><rect x='13' y='12' width='2' height='30' fill='%237a6650'/><rect x='13' y='12' width='1' height='30' fill='%238c785f'/><rect x='9' y='42' width='10' height='1' fill='%236b5642'/><rect x='8' y='43' width='12' height='1' fill='%236b5642'/><rect x='6' y='44' width='16' height='2' fill='%235c4a38'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-star{width:19em;height:19em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='11' y='3' width='2' height='5' fill='%23ffd84a'/><rect x='8' y='8' width='8' height='3' fill='%23ffd84a'/><rect x='4' y='10' width='16' height='3' fill='%23ffd84a'/><rect x='7' y='13' width='10' height='3' fill='%23ffcf2e'/><rect x='8' y='16' width='3' height='4' fill='%23e8b62a'/><rect x='13' y='16' width='3' height='4' fill='%23e8b62a'/><rect x='10' y='9' width='3' height='2' fill='%23fff4c2'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-table{width:38em;height:26em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 20'><rect x='2' y='5' width='24' height='4' fill='%23a8794f'/><rect x='2' y='5' width='24' height='1' fill='%23c2916a'/><rect x='2' y='8' width='24' height='1' fill='%23825d3a'/><rect x='5' y='9' width='3' height='9' fill='%238a6342'/><rect x='20' y='9' width='3' height='9' fill='%238a6342'/><rect x='12' y='2' width='4' height='3' fill='%23e46b96'/><rect x='12' y='2' width='4' height='1' fill='%23ff8db8'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-rug{width:60em;height:37em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 30'><rect x='0' y='4' width='2' height='1' fill='%23ece0c4'/><rect x='0' y='8' width='2' height='1' fill='%23ece0c4'/><rect x='0' y='12' width='2' height='1' fill='%23ece0c4'/><rect x='0' y='16' width='2' height='1' fill='%23ece0c4'/><rect x='0' y='20' width='2' height='1' fill='%23ece0c4'/><rect x='0' y='24' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='4' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='8' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='12' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='16' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='20' width='2' height='1' fill='%23ece0c4'/><rect x='46' y='24' width='2' height='1' fill='%23ece0c4'/><rect x='2' y='1' width='44' height='28' fill='%23e7d3aa'/><rect x='3' y='2' width='42' height='26' fill='%238a6342'/><rect x='5' y='4' width='38' height='22' fill='%23b5895a'/><rect x='7' y='6' width='34' height='18' fill='%23cda878'/><rect x='9' y='8' width='30' height='14' fill='%238a6342'/><rect x='11' y='10' width='26' height='10' fill='%23ddc096'/><rect x='11' y='10' width='26' height='1' fill='%23ebd3a6'/><rect x='11' y='19' width='26' height='1' fill='%23c8a06a'/><rect x='18' y='13' width='12' height='4' fill='%23cda878'/><rect x='18' y='13' width='12' height='1' fill='%23e7d3aa'/><rect x='23' y='14' width='2' height='2' fill='%238a6342'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-clock{width:20em;height:20em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='11' y='4' width='10' height='1' fill='%236b4a30'/><rect x='9' y='5' width='14' height='1' fill='%236b4a30'/><rect x='8' y='6' width='16' height='1' fill='%236b4a30'/><rect x='7' y='7' width='18' height='1' fill='%236b4a30'/><rect x='6' y='8' width='20' height='1' fill='%236b4a30'/><rect x='5' y='9' width='22' height='2' fill='%236b4a30'/><rect x='4' y='11' width='24' height='10' fill='%236b4a30'/><rect x='5' y='21' width='22' height='2' fill='%236b4a30'/><rect x='6' y='23' width='20' height='1' fill='%236b4a30'/><rect x='7' y='24' width='18' height='1' fill='%236b4a30'/><rect x='8' y='25' width='16' height='1' fill='%236b4a30'/><rect x='9' y='26' width='14' height='1' fill='%236b4a30'/><rect x='11' y='27' width='10' height='1' fill='%236b4a30'/><rect x='10' y='6' width='12' height='1' fill='%23f3e7cf'/><rect x='9' y='7' width='14' height='1' fill='%23f3e7cf'/><rect x='8' y='8' width='16' height='1' fill='%23f3e7cf'/><rect x='7' y='9' width='18' height='2' fill='%23f3e7cf'/><rect x='6' y='11' width='20' height='10' fill='%23f3e7cf'/><rect x='7' y='21' width='18' height='2' fill='%23f3e7cf'/><rect x='8' y='23' width='16' height='1' fill='%23f3e7cf'/><rect x='9' y='24' width='14' height='1' fill='%23f3e7cf'/><rect x='10' y='25' width='12' height='1' fill='%23f3e7cf'/><rect x='15' y='8' width='2' height='1' fill='%236b4a30'/><rect x='15' y='23' width='2' height='1' fill='%236b4a30'/><rect x='23' y='15' width='1' height='2' fill='%236b4a30'/><rect x='8' y='15' width='1' height='2' fill='%236b4a30'/><rect x='15' y='9' width='1' height='6' fill='%233a2a1c'/><rect x='16' y='15' width='5' height='1' fill='%233a2a1c'/><rect x='15' y='15' width='2' height='2' fill='%23c0392b'/><rect x='15' y='2' width='2' height='2' fill='%236b4a30'/><rect x='14' y='4' width='4' height='1' fill='%236b4a30'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-bed{width:46em;height:32em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 28'><rect x='4' y='19' width='2' height='5' fill='%236b4a30'/><rect x='34' y='19' width='2' height='5' fill='%236b4a30'/><rect x='2' y='3' width='4' height='17' fill='%238a6342'/><rect x='2' y='3' width='4' height='1' fill='%23a87a52'/><rect x='34' y='9' width='4' height='10' fill='%238a6342'/><rect x='34' y='9' width='4' height='1' fill='%23a87a52'/><rect x='4' y='13' width='32' height='6' fill='%23efe6d2'/><rect x='4' y='18' width='32' height='1' fill='%23d2c6ac'/><rect x='15' y='11' width='20' height='7' fill='%237fb0d8'/><rect x='15' y='11' width='20' height='1' fill='%23a8cdea'/><rect x='15' y='17' width='20' height='1' fill='%235f90b8'/><rect x='5' y='10' width='9' height='4' fill='%23fff6e6'/><rect x='5' y='13' width='9' height='1' fill='%23e6dac2'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-door{width:26em;height:44em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 48'><rect x='2' y='2' width='24' height='44' fill='%23533a27'/><rect x='3' y='3' width='22' height='42' fill='%2362432b'/><rect x='4' y='4' width='20' height='40' fill='%23966b45'/><rect x='4' y='4' width='1' height='40' fill='%23b78b62'/><rect x='23' y='4' width='1' height='40' fill='%2369472d'/><rect x='5' y='5' width='18' height='1' fill='%23c99b70'/><rect x='5' y='43' width='18' height='1' fill='%23735237'/><rect x='6' y='7' width='14' height='1' fill='%23674128'/><rect x='6' y='7' width='1' height='15' fill='%23674128'/><rect x='7' y='8' width='12' height='13' fill='%23895c38'/><rect x='7' y='8' width='12' height='1' fill='%23b88c60'/><rect x='7' y='20' width='12' height='1' fill='%237b5031'/><rect x='19' y='8' width='1' height='13' fill='%23b88c60'/><rect x='8' y='10' width='10' height='9' fill='%23a27249'/><rect x='6' y='25' width='14' height='1' fill='%23674128'/><rect x='6' y='25' width='1' height='15' fill='%23674128'/><rect x='7' y='26' width='12' height='13' fill='%23895c38'/><rect x='7' y='26' width='12' height='1' fill='%23b88c60'/><rect x='7' y='38' width='12' height='1' fill='%237b5031'/><rect x='19' y='26' width='1' height='13' fill='%23b88c60'/><rect x='8' y='28' width='10' height='9' fill='%23a27249'/><rect x='20' y='23' width='2' height='2' fill='%23d1a94a'/><rect x='19' y='22' width='3' height='3' fill='%23b98e2f'/><rect x='20' y='23' width='1' height='1' fill='%23f6df94'/><rect x='21' y='23' width='1' height='8' fill='%23714d31'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-bear,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-dino,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-rabbit{
        background-color:transparent;border-color:transparent;box-shadow:none;
        padding:0;min-width:0;min-height:0;
        font-size:calc(2px * var(--cigh-deco-scale,1));
        background-repeat:no-repeat;background-position:center;background-size:contain;
        image-rendering:pixelated;
      }
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-bear>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-dino>span,
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-rabbit>span{font-size:0;line-height:0;}
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-bear{width:18em;height:20em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 22'><rect x='4' y='1' width='3' height='3' fill='%23755343'/><rect x='13' y='1' width='3' height='3' fill='%23755343'/><rect x='5' y='2' width='2' height='2' fill='%23d9b49a'/><rect x='13' y='2' width='2' height='2' fill='%23d9b49a'/><rect x='3' y='4' width='14' height='10' fill='%238d6a55'/><rect x='4' y='5' width='12' height='8' fill='%23b9957c'/><rect x='7' y='8' width='6' height='4' fill='%23efd9bf'/><rect x='6' y='6' width='2' height='2' fill='%234a332a'/><rect x='12' y='6' width='2' height='2' fill='%234a332a'/><rect x='9' y='8' width='2' height='2' fill='%2367463a'/><rect x='8' y='10' width='4' height='1' fill='%23d88895'/><rect x='5' y='14' width='10' height='6' fill='%23b9957c'/><rect x='3' y='15' width='3' height='4' fill='%23b9957c'/><rect x='14' y='15' width='3' height='4' fill='%23b9957c'/><rect x='4' y='20' width='3' height='2' fill='%238d6a55'/><rect x='13' y='20' width='3' height='2' fill='%238d6a55'/><rect x='1' y='15' width='2' height='4' fill='%238d6a55'/><rect x='17' y='15' width='2' height='4' fill='%238d6a55'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-dino{width:19em;height:20em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'><rect x='10' y='1' width='4' height='3' fill='%23527c44'/><rect x='9' y='3' width='6' height='3' fill='%23699658'/><rect x='7' y='5' width='9' height='7' fill='%237fb269'/><rect x='5' y='8' width='11' height='6' fill='%2391c27b'/><rect x='4' y='10' width='10' height='6' fill='%2391c27b'/><rect x='12' y='9' width='5' height='6' fill='%237fb269'/><rect x='16' y='10' width='3' height='3' fill='%237fb269'/><rect x='18' y='11' width='2' height='2' fill='%237fb269'/><rect x='11' y='6' width='2' height='2' fill='%2338522f'/><rect x='9' y='9' width='5' height='3' fill='%23cfe6b7'/><rect x='7' y='14' width='8' height='4' fill='%2391c27b'/><rect x='5' y='15' width='2' height='5' fill='%23527c44'/><rect x='11' y='15' width='2' height='5' fill='%23527c44'/><rect x='3' y='15' width='3' height='2' fill='%23527c44'/><rect x='2' y='16' width='2' height='2' fill='%23527c44'/><rect x='13' y='7' width='1' height='1' fill='%23e595a8'/><rect x='8' y='5' width='1' height='3' fill='%23527c44'/><rect x='6' y='6' width='1' height='3' fill='%23527c44'/><rect x='15' y='7' width='1' height='3' fill='%23527c44'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-plush-rabbit{width:18em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 24'><rect x='5' y='1' width='3' height='8' fill='%23eadcc8'/><rect x='12' y='1' width='3' height='8' fill='%23eadcc8'/><rect x='6' y='2' width='1' height='6' fill='%23efb5c8'/><rect x='13' y='2' width='1' height='6' fill='%23efb5c8'/><rect x='4' y='8' width='12' height='8' fill='%23efe4d4'/><rect x='5' y='9' width='10' height='6' fill='%23fbf6ee'/><rect x='6' y='10' width='2' height='2' fill='%23473a35'/><rect x='12' y='10' width='2' height='2' fill='%23473a35'/><rect x='9' y='11' width='2' height='2' fill='%23c98595'/><rect x='8' y='13' width='4' height='1' fill='%23e7b0bd'/><rect x='6' y='16' width='8' height='6' fill='%23efe4d4'/><rect x='4' y='17' width='3' height='4' fill='%23efe4d4'/><rect x='13' y='17' width='3' height='4' fill='%23efe4d4'/><rect x='5' y='22' width='3' height='2' fill='%23d7c5b0'/><rect x='12' y='22' width='3' height='2' fill='%23d7c5b0'/><rect x='8' y='18' width='4' height='3' fill='%23ffffff'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-twin{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='6' y='16' width='2' height='10' fill='%232f6d3c'/><rect x='14' y='15' width='2' height='11' fill='%232f6d3c'/><rect x='8' y='19' width='4' height='2' fill='%233a8146'/><rect x='12' y='20' width='4' height='2' fill='%233a8146'/><rect x='5' y='20' width='3' height='3' fill='%2355984e'/><rect x='14' y='21' width='4' height='3' fill='%2355984e'/><rect x='3' y='5' width='8' height='1' fill='%237d394a'/><rect x='2' y='6' width='10' height='2' fill='%237d394a'/><rect x='1' y='8' width='2' height='5' fill='%237d394a'/><rect x='3' y='8' width='8' height='1' fill='%237d394a'/><rect x='3' y='12' width='8' height='1' fill='%237d394a'/><rect x='11' y='8' width='1' height='4' fill='%237d394a'/><rect x='4' y='6' width='6' height='2' fill='%23a74e63'/><rect x='3' y='8' width='8' height='5' fill='%23d8798d'/><rect x='4' y='8' width='6' height='1' fill='%23efadbb'/><rect x='2' y='10' width='2' height='2' fill='%23b95f73'/><rect x='10' y='10' width='2' height='2' fill='%23b95f73'/><rect x='5' y='9' width='4' height='3' fill='%23f092a5'/><rect x='6' y='10' width='2' height='2' fill='%23f2d06e'/><rect x='11' y='3' width='8' height='1' fill='%237d394a'/><rect x='10' y='4' width='10' height='2' fill='%237d394a'/><rect x='9' y='6' width='2' height='5' fill='%237d394a'/><rect x='11' y='6' width='8' height='1' fill='%237d394a'/><rect x='11' y='10' width='8' height='1' fill='%237d394a'/><rect x='19' y='6' width='1' height='4' fill='%237d394a'/><rect x='12' y='4' width='6' height='2' fill='%23a74e63'/><rect x='11' y='6' width='8' height='5' fill='%23d8798d'/><rect x='12' y='6' width='6' height='1' fill='%23efadbb'/><rect x='10' y='8' width='2' height='2' fill='%23b95f73'/><rect x='18' y='8' width='2' height='2' fill='%23b95f73'/><rect x='13' y='7' width='4' height='3' fill='%23f092a5'/><rect x='14' y='8' width='2' height='2' fill='%23f2d06e'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-bell{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='10' y='6' width='2' height='20' fill='%23386d28'/><rect x='6' y='18' width='4' height='2' fill='%2344872f'/><rect x='12' y='14' width='4' height='2' fill='%2344872f'/><rect x='5' y='19' width='4' height='5' fill='%234d8e33'/><rect x='13' y='15' width='4' height='5' fill='%234d8e33'/><rect x='9' y='7' width='2' height='4' fill='%2344872f'/><rect x='11' y='8' width='3' height='2' fill='%2344872f'/><rect x='3' y='5' width='7' height='1' fill='%237a6c3d'/><rect x='2' y='6' width='9' height='1' fill='%237a6c3d'/><rect x='1' y='7' width='10' height='1' fill='%237a6c3d'/><rect x='1' y='8' width='1' height='5' fill='%237a6c3d'/><rect x='2' y='13' width='1' height='1' fill='%237a6c3d'/><rect x='9' y='13' width='1' height='1' fill='%237a6c3d'/><rect x='4' y='6' width='5' height='1' fill='%23987842'/><rect x='3' y='7' width='7' height='1' fill='%23b89f6a'/><rect x='2' y='8' width='8' height='5' fill='%23e7d7aa'/><rect x='3' y='8' width='6' height='1' fill='%23f3ead1'/><rect x='3' y='12' width='6' height='1' fill='%23cab884'/><rect x='2' y='13' width='2' height='1' fill='%23b89f6a'/><rect x='7' y='13' width='2' height='1' fill='%23b89f6a'/><rect x='11' y='3' width='7' height='1' fill='%237a6c3d'/><rect x='10' y='4' width='9' height='1' fill='%237a6c3d'/><rect x='10' y='5' width='9' height='1' fill='%237a6c3d'/><rect x='10' y='6' width='1' height='5' fill='%237a6c3d'/><rect x='18' y='6' width='1' height='5' fill='%237a6c3d'/><rect x='11' y='11' width='1' height='1' fill='%237a6c3d'/><rect x='17' y='11' width='1' height='1' fill='%237a6c3d'/><rect x='12' y='4' width='5' height='1' fill='%23987842'/><rect x='11' y='5' width='7' height='1' fill='%23b89f6a'/><rect x='11' y='6' width='8' height='5' fill='%23e7d7aa'/><rect x='12' y='6' width='6' height='1' fill='%23f3ead1'/><rect x='12' y='10' width='6' height='1' fill='%23cab884'/><rect x='11' y='11' width='2' height='1' fill='%23b89f6a'/><rect x='16' y='11' width='2' height='1' fill='%23b89f6a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blossom{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='10' y='11' width='2' height='15' fill='%233b7434'/><rect x='6' y='18' width='4' height='2' fill='%234d8d42'/><rect x='12' y='20' width='4' height='2' fill='%234d8d42'/><rect x='5' y='19' width='4' height='5' fill='%235aa150'/><rect x='13' y='21' width='4' height='4' fill='%235aa150'/><rect x='10' y='3' width='2' height='1' fill='%23774e85'/><rect x='9' y='4' width='4' height='1' fill='%23774e85'/><rect x='7' y='5' width='2' height='1' fill='%23774e85'/><rect x='13' y='5' width='2' height='1' fill='%23774e85'/><rect x='6' y='7' width='1' height='4' fill='%23774e85'/><rect x='7' y='6' width='3' height='1' fill='%23774e85'/><rect x='12' y='6' width='3' height='1' fill='%23774e85'/><rect x='15' y='7' width='1' height='4' fill='%23774e85'/><rect x='8' y='9' width='1' height='2' fill='%23774e85'/><rect x='13' y='9' width='1' height='2' fill='%23774e85'/><rect x='9' y='10' width='4' height='1' fill='%23774e85'/><rect x='10' y='4' width='2' height='3' fill='%23b16fbe'/><rect x='7' y='7' width='2' height='4' fill='%23c48bd0'/><rect x='13' y='7' width='2' height='4' fill='%23c48bd0'/><rect x='9' y='9' width='4' height='2' fill='%23d6a3de'/><rect x='8' y='6' width='2' height='2' fill='%23d6a3de'/><rect x='12' y='6' width='2' height='2' fill='%23d6a3de'/><rect x='9' y='5' width='4' height='1' fill='%23edd5f2'/><rect x='10' y='7' width='2' height='2' fill='%23f0df85'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-white{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='10' y='11' width='2' height='15' fill='%233a743a'/><rect x='6' y='19' width='4' height='2' fill='%234e8a43'/><rect x='12' y='18' width='4' height='2' fill='%234e8a43'/><rect x='5' y='20' width='4' height='4' fill='%235a9a50'/><rect x='13' y='19' width='4' height='4' fill='%235a9a50'/><rect x='10' y='3' width='2' height='1' fill='%23b9b7ae'/><rect x='9' y='4' width='4' height='1' fill='%23b9b7ae'/><rect x='7' y='5' width='2' height='1' fill='%23b9b7ae'/><rect x='13' y='5' width='2' height='1' fill='%23b9b7ae'/><rect x='6' y='7' width='1' height='3' fill='%23b9b7ae'/><rect x='7' y='6' width='3' height='1' fill='%23b9b7ae'/><rect x='12' y='6' width='3' height='1' fill='%23b9b7ae'/><rect x='15' y='7' width='1' height='3' fill='%23b9b7ae'/><rect x='8' y='10' width='1' height='2' fill='%23b9b7ae'/><rect x='13' y='10' width='1' height='2' fill='%23b9b7ae'/><rect x='9' y='11' width='4' height='1' fill='%23b9b7ae'/><rect x='10' y='4' width='2' height='3' fill='%23d8d8d0'/><rect x='7' y='7' width='3' height='3' fill='%23f2f1e8'/><rect x='12' y='7' width='3' height='3' fill='%23f2f1e8'/><rect x='9' y='10' width='4' height='2' fill='%23ffffff'/><rect x='8' y='6' width='2' height='2' fill='%23ffffff'/><rect x='12' y='6' width='2' height='2' fill='%23ffffff'/><rect x='9' y='5' width='4' height='1' fill='%23ffffff'/><rect x='10' y='8' width='2' height='2' fill='%23f0d96a'/><rect x='10' y='9' width='2' height='1' fill='%23c9a74a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-blue{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='10' y='10' width='2' height='16' fill='%23346f42'/><rect x='6' y='18' width='4' height='2' fill='%23488452'/><rect x='12' y='20' width='4' height='2' fill='%23488452'/><rect x='5' y='19' width='4' height='4' fill='%235a9a61'/><rect x='13' y='21' width='4' height='4' fill='%235a9a61'/><rect x='10' y='3' width='2' height='1' fill='%234466b0'/><rect x='9' y='4' width='4' height='1' fill='%234466b0'/><rect x='7' y='5' width='2' height='1' fill='%234466b0'/><rect x='13' y='5' width='2' height='1' fill='%234466b0'/><rect x='6' y='7' width='1' height='4' fill='%234466b0'/><rect x='7' y='6' width='3' height='1' fill='%234466b0'/><rect x='12' y='6' width='3' height='1' fill='%234466b0'/><rect x='15' y='7' width='1' height='4' fill='%234466b0'/><rect x='8' y='9' width='1' height='3' fill='%234466b0'/><rect x='13' y='9' width='1' height='3' fill='%234466b0'/><rect x='9' y='11' width='4' height='1' fill='%234466b0'/><rect x='10' y='4' width='2' height='3' fill='%235786d8'/><rect x='7' y='7' width='3' height='4' fill='%236fa2ee'/><rect x='12' y='7' width='3' height='4' fill='%236fa2ee'/><rect x='9' y='9' width='4' height='3' fill='%238bbcff'/><rect x='8' y='6' width='2' height='2' fill='%238bbcff'/><rect x='12' y='6' width='2' height='2' fill='%238bbcff'/><rect x='9' y='5' width='4' height='1' fill='%23cfe4ff'/><rect x='10' y='8' width='2' height='2' fill='%23ffe28a'/><rect x='10' y='9' width='2' height='1' fill='%23caa64a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-flower-sun{width:17em;height:21em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 28'><rect x='10' y='12' width='2' height='14' fill='%233b7434'/><rect x='6' y='19' width='4' height='2' fill='%234d8d42'/><rect x='12' y='20' width='4' height='2' fill='%234d8d42'/><rect x='5' y='20' width='4' height='4' fill='%235aa150'/><rect x='13' y='21' width='4' height='4' fill='%235aa150'/><rect x='10' y='2' width='2' height='1' fill='%23b57f2e'/><rect x='9' y='3' width='4' height='1' fill='%23b57f2e'/><rect x='7' y='4' width='2' height='1' fill='%23b57f2e'/><rect x='13' y='4' width='2' height='1' fill='%23b57f2e'/><rect x='5' y='7' width='4' height='1' fill='%23b57f2e'/><rect x='13' y='7' width='4' height='1' fill='%23b57f2e'/><rect x='6' y='11' width='3' height='3' fill='%23b57f2e'/><rect x='13' y='11' width='3' height='3' fill='%23b57f2e'/><rect x='10' y='3' width='2' height='4' fill='%23f5c84b'/><rect x='7' y='5' width='2' height='3' fill='%23f0b83e'/><rect x='13' y='5' width='2' height='3' fill='%23f0b83e'/><rect x='5' y='8' width='4' height='2' fill='%23f5c84b'/><rect x='13' y='8' width='4' height='2' fill='%23f5c84b'/><rect x='7' y='11' width='2' height='3' fill='%23d99532'/><rect x='13' y='11' width='2' height='3' fill='%23d99532'/><rect x='9' y='7' width='4' height='5' fill='%23805a2f'/><rect x='10' y='8' width='2' height='3' fill='%23a6783a'/><rect x='9' y='7' width='4' height='1' fill='%23c08b42'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-bush-berry{width:60em;height:26em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 28'><rect x='4' y='18' width='56' height='6' fill='%23264f24'/><rect x='2' y='15' width='60' height='8' fill='%2332642d'/><rect x='1' y='14' width='10' height='6' fill='%233b7335'/><rect x='8' y='11' width='12' height='8' fill='%2344813d'/><rect x='17' y='10' width='12' height='9' fill='%234d8d45'/><rect x='26' y='9' width='12' height='10' fill='%2357994f'/><rect x='35' y='10' width='12' height='9' fill='%234d8d45'/><rect x='44' y='11' width='12' height='8' fill='%2344813d'/><rect x='53' y='14' width='10' height='6' fill='%233b7335'/><rect x='10' y='9' width='8' height='3' fill='%2364aa57'/><rect x='18' y='8' width='8' height='3' fill='%236cb45f'/><rect x='27' y='7' width='10' height='3' fill='%2374be67'/><rect x='38' y='8' width='8' height='3' fill='%236cb45f'/><rect x='46' y='9' width='8' height='3' fill='%2364aa57'/><rect x='11' y='16' width='2' height='2' fill='%23e54848'/><rect x='12' y='15' width='1' height='1' fill='%23ffd0d0'/><rect x='20' y='13' width='2' height='2' fill='%23d83f3f'/><rect x='21' y='12' width='1' height='1' fill='%23ffd0d0'/><rect x='29' y='16' width='2' height='2' fill='%23e54848'/><rect x='30' y='15' width='1' height='1' fill='%23ffd0d0'/><rect x='38' y='14' width='2' height='2' fill='%23d83f3f'/><rect x='39' y='13' width='1' height='1' fill='%23ffd0d0'/><rect x='47' y='16' width='2' height='2' fill='%23e54848'/><rect x='48' y='15' width='1' height='1' fill='%23ffd0d0'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-fence-wood{width:72em;height:18em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 18'><rect x='3' y='4' width='4' height='12' fill='%238b613e'/><rect x='15' y='4' width='4' height='12' fill='%238b613e'/><rect x='27' y='4' width='4' height='12' fill='%238b613e'/><rect x='39' y='4' width='4' height='12' fill='%238b613e'/><rect x='51' y='4' width='4' height='12' fill='%238b613e'/><rect x='63' y='4' width='4' height='12' fill='%238b613e'/><rect x='2' y='3' width='6' height='1' fill='%23b78658'/><rect x='14' y='3' width='6' height='1' fill='%23b78658'/><rect x='26' y='3' width='6' height='1' fill='%23b78658'/><rect x='38' y='3' width='6' height='1' fill='%23b78658'/><rect x='50' y='3' width='6' height='1' fill='%23b78658'/><rect x='62' y='3' width='6' height='1' fill='%23b78658'/><rect x='4' y='7' width='60' height='3' fill='%239d6f47'/><rect x='4' y='11' width='60' height='3' fill='%239d6f47'/><rect x='4' y='7' width='60' height='1' fill='%23c18f62'/><rect x='4' y='11' width='60' height='1' fill='%23c18f62'/><rect x='4' y='9' width='60' height='1' fill='%23724d31'/><rect x='4' y='13' width='60' height='1' fill='%23724d31'/></svg>");}

      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-iv{width:40em;height:34em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 34'><rect x='0' y='0' width='40' height='34' fill='%23c9bfb0'/><rect x='1' y='1' width='38' height='32' fill='%23e8e0cf'/><rect x='1' y='1' width='38' height='1' fill='%23f5efe2'/><rect x='1' y='1' width='1' height='32' fill='%23f5efe2'/><rect x='38' y='1' width='1' height='32' fill='%23d3c7b3'/><rect x='1' y='32' width='38' height='1' fill='%23d3c7b3'/><rect x='4' y='4' width='32' height='26' fill='%23bdb1a0'/><rect x='5' y='5' width='30' height='24' fill='%23f6f1e6'/><rect x='5' y='5' width='30' height='1' fill='%23fdfaf2'/><rect x='5' y='5' width='1' height='24' fill='%23fdfaf2'/><rect x='17' y='22' width='6' height='5' fill='%23b8946a'/><rect x='18' y='23' width='4' height='1' fill='%23cda87c'/><rect x='15' y='16' width='2' height='7' fill='%23839a6e'/><rect x='19' y='15' width='2' height='8' fill='%23839a6e'/><rect x='23' y='16' width='2' height='7' fill='%23839a6e'/><rect x='13' y='13' width='4' height='4' fill='%23cf9aaa'/><rect x='13' y='13' width='4' height='1' fill='%23e0b8c2'/><rect x='14' y='14' width='2' height='2' fill='%23e8cf86'/><rect x='18' y='10' width='4' height='4' fill='%23b8a6cf'/><rect x='18' y='10' width='4' height='1' fill='%23ccc0e0'/><rect x='19' y='11' width='2' height='2' fill='%23e8cf86'/><rect x='23' y='12' width='4' height='4' fill='%23dca878'/><rect x='23' y='12' width='4' height='1' fill='%23e8c49a'/><rect x='24' y='13' width='2' height='2' fill='%23e8cf86'/><rect x='10' y='15' width='3' height='3' fill='%23c2d0a0'/><rect x='27' y='14' width='3' height='3' fill='%23c2d0a0'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-iv{width:30em;height:32em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 32'><rect width='30' height='32' fill='%23c9bfb0'/><rect x='1' y='1' width='28' height='30' fill='%23e8e0cf'/><rect x='1' y='1' width='28' height='1' fill='%23f5efe2'/><rect x='1' y='1' width='1' height='30' fill='%23f5efe2'/><rect x='1' y='30' width='28' height='1' fill='%23d3c7b3'/><rect x='4' y='4' width='22' height='24' fill='%23bdb1a0'/><rect x='5' y='5' width='20' height='22' fill='%23f6f1e6'/><rect x='5' y='5' width='20' height='1' fill='%23fdfaf2'/><rect x='5' y='5' width='1' height='22' fill='%23fdfaf2'/><rect x='5' y='26' width='20' height='1' fill='%23ece5d8'/><rect x='14' y='17' width='2' height='8' fill='%23839a6e'/><rect x='14' y='17' width='1' height='8' fill='%2396b088'/><rect x='10' y='20' width='4' height='1' fill='%23839a6e'/><rect x='16' y='19' width='4' height='1' fill='%23839a6e'/><rect x='9' y='19' width='2' height='2' fill='%2396b088'/><rect x='19' y='18' width='2' height='2' fill='%2396b088'/><rect x='11' y='9' width='8' height='8' fill='%23d49aae'/><rect x='11' y='9' width='8' height='2' fill='%23e6b8c6'/><rect x='12' y='8' width='6' height='1' fill='%23e6b8c6'/><rect x='12' y='16' width='6' height='1' fill='%23b87e8e'/><rect x='13' y='11' width='4' height='4' fill='%23ecd28a'/><rect x='14' y='12' width='2' height='2' fill='%23f2e2a4'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-iv{width:28em;height:34em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 34'><rect x='0' y='0' width='28' height='34' fill='%23c9bfb0'/><rect x='1' y='1' width='26' height='32' fill='%23e8e0cf'/><rect x='1' y='1' width='26' height='1' fill='%23f5efe2'/><rect x='1' y='1' width='1' height='32' fill='%23f5efe2'/><rect x='1' y='32' width='26' height='1' fill='%23d3c7b3'/><rect x='4' y='4' width='20' height='26' fill='%23bdb1a0'/><rect x='5' y='5' width='18' height='24' fill='%23f6f1e6'/><rect x='5' y='5' width='18' height='1' fill='%23fdfaf2'/><rect x='5' y='5' width='1' height='24' fill='%23fdfaf2'/><rect x='22' y='5' width='1' height='24' fill='%23f6f1e6'/><rect x='9' y='20' width='10' height='7' fill='%23c08a5e'/><rect x='9' y='20' width='10' height='1' fill='%23d4a074'/><rect x='8' y='19' width='12' height='2' fill='%23cf9868'/><rect x='13' y='13' width='2' height='7' fill='%23839a6e'/><rect x='10' y='14' width='3' height='2' fill='%2396b088'/><rect x='15' y='13' width='3' height='2' fill='%2396b088'/><rect x='11' y='10' width='3' height='3' fill='%23d49aae'/><rect x='11' y='10' width='3' height='1' fill='%23e6b8c6'/><rect x='15' y='11' width='3' height='3' fill='%23b8a6cf'/><rect x='15' y='11' width='3' height='1' fill='%23ccc0e0'/><rect x='13' y='8' width='2' height='2' fill='%23ecd28a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-iv{width:28em;height:32em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 32'><rect x='0' y='0' width='28' height='32' fill='%23c9bfb0'/><rect x='1' y='1' width='26' height='30' fill='%23e8e0cf'/><rect x='1' y='1' width='26' height='1' fill='%23f5efe2'/><rect x='1' y='1' width='1' height='30' fill='%23f5efe2'/><rect x='4' y='4' width='20' height='24' fill='%23bdb1a0'/><rect x='5' y='5' width='18' height='22' fill='%23faf6ee'/><rect x='5' y='5' width='18' height='1' fill='%23fdfaf2'/><rect x='9' y='8' width='1' height='14' fill='%23a8b87e'/><rect x='9' y='10' width='4' height='1' fill='%23a8b87e'/><rect x='6' y='13' width='4' height='1' fill='%23a8b87e'/><rect x='9' y='16' width='4' height='1' fill='%23a8b87e'/><rect x='8' y='8' width='3' height='2' fill='%23c98a9e'/><rect x='7' y='12' width='2' height='2' fill='%23c0a0d0'/><rect x='11' y='15' width='2' height='2' fill='%23d6b074'/><rect x='17' y='9' width='1' height='13' fill='%23a8b87e'/><rect x='17' y='11' width='4' height='1' fill='%23a8b87e'/><rect x='14' y='14' width='4' height='1' fill='%23a8b87e'/><rect x='16' y='8' width='3' height='2' fill='%23c0a0d0'/><rect x='19' y='12' width='2' height='2' fill='%23c98a9e'/><rect x='14' y='16' width='2' height='2' fill='%23d6b074'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-bouquet-mt{width:40em;height:34em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 34'><rect x='0' y='0' width='40' height='34' fill='%236e6258'/><rect x='1' y='1' width='38' height='32' fill='%239a8c7e'/><rect x='1' y='1' width='38' height='1' fill='%23b3a596'/><rect x='1' y='1' width='1' height='32' fill='%23b3a596'/><rect x='38' y='1' width='1' height='32' fill='%237e7064'/><rect x='1' y='32' width='38' height='1' fill='%237e7064'/><rect x='4' y='4' width='32' height='26' fill='%23857668'/><rect x='5' y='5' width='30' height='24' fill='%23ece4d6'/><rect x='5' y='5' width='30' height='1' fill='%23f6f1e6'/><rect x='5' y='5' width='1' height='24' fill='%23f6f1e6'/><rect x='17' y='22' width='6' height='5' fill='%23a88a64'/><rect x='18' y='23' width='4' height='1' fill='%23bf9c72'/><rect x='15' y='16' width='2' height='7' fill='%237e9270'/><rect x='19' y='15' width='2' height='8' fill='%237e9270'/><rect x='23' y='16' width='2' height='7' fill='%237e9270'/><rect x='13' y='13' width='4' height='4' fill='%23bf95a2'/><rect x='13' y='13' width='4' height='1' fill='%23d2adb8'/><rect x='14' y='14' width='2' height='2' fill='%23d9c182'/><rect x='18' y='10' width='4' height='4' fill='%23ad9ec2'/><rect x='18' y='10' width='4' height='1' fill='%23c2b6d8'/><rect x='19' y='11' width='2' height='2' fill='%23d9c182'/><rect x='23' y='12' width='4' height='4' fill='%23cf9f78'/><rect x='23' y='12' width='4' height='1' fill='%23dcb594'/><rect x='24' y='13' width='2' height='2' fill='%23d9c182'/><rect x='10' y='15' width='3' height='3' fill='%23aab487'/><rect x='27' y='14' width='3' height='3' fill='%23aab487'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-single-mt{width:30em;height:32em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 30 32'><rect x='0' y='0' width='30' height='32' fill='%236e6258'/><rect x='1' y='1' width='28' height='30' fill='%23968a7d'/><rect x='1' y='1' width='28' height='1' fill='%23b3a596'/><rect x='1' y='1' width='1' height='30' fill='%23b3a596'/><rect x='1' y='30' width='28' height='1' fill='%237e7064'/><rect x='4' y='4' width='22' height='24' fill='%23857668'/><rect x='5' y='5' width='20' height='22' fill='%23ece4d6'/><rect x='5' y='5' width='20' height='1' fill='%23f6f1e6'/><rect x='5' y='5' width='1' height='22' fill='%23f6f1e6'/><rect x='24' y='5' width='1' height='22' fill='%23ece4d6'/><rect x='14' y='17' width='2' height='8' fill='%237e9270'/><rect x='14' y='17' width='1' height='8' fill='%2396a888'/><rect x='10' y='20' width='4' height='1' fill='%237e9270'/><rect x='16' y='19' width='4' height='1' fill='%237e9270'/><rect x='9' y='19' width='2' height='2' fill='%2396a888'/><rect x='19' y='18' width='2' height='2' fill='%2396a888'/><rect x='11' y='9' width='8' height='8' fill='%23bf95a2'/><rect x='11' y='9' width='8' height='2' fill='%23d2adb8'/><rect x='12' y='8' width='6' height='1' fill='%23d2adb8'/><rect x='12' y='16' width='6' height='1' fill='%23a37e8a'/><rect x='13' y='11' width='4' height='4' fill='%23d9c182'/><rect x='14' y='12' width='2' height='2' fill='%23e6d29a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pot-mt{width:28em;height:34em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 34'><rect width='28' height='34' fill='%236e6258'/><rect x='1' y='1' width='26' height='32' fill='%239a8c7e'/><rect x='1' y='1' width='26' height='1' fill='%23b3a596'/><rect x='1' y='1' width='1' height='32' fill='%23b3a596'/><rect x='1' y='32' width='26' height='1' fill='%237e7064'/><rect x='4' y='4' width='20' height='26' fill='%23857668'/><rect x='5' y='5' width='18' height='24' fill='%23ece4d6'/><rect x='5' y='5' width='18' height='1' fill='%23f6f1e6'/><rect x='5' y='5' width='1' height='24' fill='%23f6f1e6'/><rect x='5' y='28' width='18' height='1' fill='%23ddd3c2'/><rect x='9' y='20' width='10' height='7' fill='%23b08560'/><rect x='8' y='19' width='12' height='2' fill='%23bd9069'/><rect x='9' y='20' width='10' height='1' fill='%23c49c75'/><rect x='13' y='13' width='2' height='7' fill='%237e9270'/><rect x='10' y='14' width='3' height='2' fill='%2396a888'/><rect x='15' y='13' width='3' height='2' fill='%2396a888'/><rect x='11' y='10' width='3' height='3' fill='%23bf95a2'/><rect x='11' y='10' width='3' height='1' fill='%23d2adb8'/><rect x='15' y='11' width='3' height='3' fill='%23ad9ec2'/><rect x='15' y='11' width='3' height='1' fill='%23c2b6d8'/><rect x='13' y='8' width='2' height='2' fill='%23d9c182'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-frame-pressed-mt{width:28em;height:32em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 32'><rect x='0' y='0' width='28' height='32' fill='%236e6258'/><rect x='1' y='1' width='26' height='30' fill='%239a8c7e'/><rect x='1' y='1' width='26' height='1' fill='%23b3a596'/><rect x='1' y='1' width='1' height='30' fill='%23b3a596'/><rect x='4' y='4' width='20' height='24' fill='%23857668'/><rect x='5' y='5' width='18' height='22' fill='%23f0ebe0'/><rect x='5' y='5' width='18' height='1' fill='%23f6f1e6'/><rect x='9' y='8' width='1' height='14' fill='%2398a878'/><rect x='9' y='10' width='4' height='1' fill='%2398a878'/><rect x='6' y='13' width='4' height='1' fill='%2398a878'/><rect x='9' y='16' width='4' height='1' fill='%2398a878'/><rect x='8' y='8' width='3' height='2' fill='%23b8899a'/><rect x='7' y='12' width='2' height='2' fill='%23a795c0'/><rect x='11' y='15' width='2' height='2' fill='%23c8a46e'/><rect x='17' y='9' width='1' height='13' fill='%2398a878'/><rect x='17' y='11' width='4' height='1' fill='%2398a878'/><rect x='14' y='14' width='4' height='1' fill='%2398a878'/><rect x='16' y='8' width='3' height='2' fill='%23a795c0'/><rect x='19' y='12' width='2' height='2' fill='%23b8899a'/><rect x='14' y='16' width='2' height='2' fill='%23c8a46e'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-swag{width:28em;height:40em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 40'><rect x='13' y='2' width='2' height='2' fill='%238a7a5c'/><rect x='10' y='4' width='8' height='1' fill='%23b8a07a'/><rect x='12' y='5' width='4' height='2' fill='%23a8946e'/><rect x='13' y='7' width='2' height='6' fill='%237a6a4c'/><rect x='11' y='8' width='2' height='8' fill='%238a7656'/><rect x='15' y='8' width='2' height='8' fill='%238a7656'/><rect x='9' y='10' width='2' height='9' fill='%237a6a4c'/><rect x='17' y='10' width='2' height='9' fill='%237a6a4c'/><rect x='7' y='13' width='2' height='8' fill='%23857448'/><rect x='19' y='13' width='2' height='8' fill='%23857448'/><rect x='12' y='13' width='4' height='5' fill='%23c98a9a'/><rect x='12' y='13' width='4' height='2' fill='%23dba6b2'/><rect x='9' y='16' width='3' height='4' fill='%23b08a6a'/><rect x='16' y='16' width='3' height='4' fill='%23b08a6a'/><rect x='10' y='19' width='3' height='5' fill='%23c7a6c0'/><rect x='10' y='19' width='3' height='2' fill='%23d8bcd2'/><rect x='15' y='19' width='3' height='5' fill='%23a89a6a'/><rect x='7' y='20' width='2' height='6' fill='%23967c4e'/><rect x='19' y='20' width='2' height='6' fill='%23967c4e'/><rect x='12' y='22' width='4' height='6' fill='%23bb6f7e'/><rect x='12' y='22' width='4' height='2' fill='%23cf8a98'/><rect x='9' y='24' width='3' height='6' fill='%23867044'/><rect x='16' y='24' width='3' height='6' fill='%23867044'/><rect x='11' y='27' width='2' height='6' fill='%237a6a4c'/><rect x='15' y='27' width='2' height='6' fill='%237a6a4c'/><rect x='13' y='29' width='2' height='7' fill='%238a7656'/><rect x='10' y='5' width='1' height='30' fill='%23c9b896'/><rect x='17' y='5' width='1' height='30' fill='%23c9b896'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-large{width:44em;height:38em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 40'><rect x='0' y='0' width='48' height='36' fill='%235a3c24'/><rect x='1' y='1' width='46' height='34' fill='%238a6342'/><rect x='1' y='1' width='46' height='1' fill='%23a87a52'/><rect x='3' y='3' width='42' height='28' fill='%23a9d4ea'/><rect x='3' y='3' width='42' height='7' fill='%23c0e3f2'/><rect x='5' y='5' width='5' height='1' fill='%23dcf0f8'/><rect x='30' y='4' width='6' height='1' fill='%23dcf0f8'/><rect x='3' y='10' width='42' height='6' fill='%235f8f4a'/><rect x='3' y='10' width='6' height='3' fill='%236fa055'/><rect x='10' y='9' width='7' height='4' fill='%236fa055'/><rect x='18' y='10' width='6' height='3' fill='%23567f42'/><rect x='25' y='9' width='7' height='4' fill='%236fa055'/><rect x='33' y='10' width='6' height='3' fill='%23567f42'/><rect x='39' y='9' width='6' height='4' fill='%236fa055'/><rect x='6' y='9' width='2' height='1' fill='%2382b568'/><rect x='13' y='8' width='2' height='1' fill='%2382b568'/><rect x='28' y='8' width='2' height='1' fill='%2382b568'/><rect x='3' y='15' width='42' height='16' fill='%237cb356'/><rect x='3' y='15' width='42' height='2' fill='%238cc266'/><rect x='3' y='26' width='42' height='5' fill='%236aa048'/><rect x='7' y='19' width='1' height='1' fill='%23f0e85a'/><rect x='14' y='21' width='1' height='1' fill='%23e87aa8'/><rect x='21' y='18' width='1' height='1' fill='%23ffffff'/><rect x='28' y='22' width='1' height='1' fill='%23c89af0'/><rect x='35' y='20' width='1' height='1' fill='%23f0e85a'/><rect x='41' y='19' width='1' height='1' fill='%23e87aa8'/><rect x='11' y='27' width='1' height='1' fill='%23ffffff'/><rect x='25' y='28' width='1' height='1' fill='%23e87aa8'/><rect x='18' y='25' width='1' height='1' fill='%23f0e85a'/><rect x='38' y='27' width='1' height='1' fill='%23ffffff'/><rect x='15' y='3' width='2' height='28' fill='%238a6342'/><rect x='15' y='3' width='1' height='28' fill='%23a87a52'/><rect x='31' y='3' width='2' height='28' fill='%238a6342'/><rect x='31' y='3' width='1' height='28' fill='%23a87a52'/><rect x='3' y='16' width='42' height='2' fill='%238a6342'/><rect x='3' y='16' width='42' height='1' fill='%23a87a52'/><rect x='0' y='31' width='48' height='2' fill='%236b4a30'/><rect x='0' y='33' width='48' height='4' fill='%239a6b42'/><rect x='0' y='33' width='48' height='1' fill='%23b08254'/><rect x='0' y='37' width='48' height='1' fill='%235a3c24'/><rect x='6' y='33' width='4' height='4' fill='%23c2607a'/><rect x='6' y='32' width='4' height='1' fill='%235f8f4a'/><rect x='38' y='32' width='2' height='5' fill='%23cfa0d8'/><rect x='38' y='32' width='2' height='1' fill='%23e0c0e8'/><rect x='20' y='34' width='3' height='3' fill='%23d8c49a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-small{width:30em;height:33em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 40'><rect x='0' y='0' width='36' height='36' fill='%235a3c24'/><rect x='1' y='1' width='34' height='34' fill='%238a6342'/><rect x='1' y='1' width='34' height='1' fill='%23a87a52'/><rect x='3' y='3' width='30' height='28' fill='%23a9d4ea'/><rect x='3' y='3' width='30' height='7' fill='%23c0e3f2'/><rect x='5' y='5' width='4' height='1' fill='%23dcf0f8'/><rect x='23' y='4' width='5' height='1' fill='%23dcf0f8'/><rect x='3' y='10' width='30' height='6' fill='%235f8f4a'/><rect x='3' y='10' width='5' height='3' fill='%236fa055'/><rect x='9' y='9' width='6' height='4' fill='%236fa055'/><rect x='16' y='10' width='5' height='3' fill='%23567f42'/><rect x='22' y='9' width='6' height='4' fill='%236fa055'/><rect x='28' y='10' width='5' height='3' fill='%23567f42'/><rect x='3' y='15' width='30' height='16' fill='%237cb356'/><rect x='3' y='15' width='30' height='2' fill='%238cc266'/><rect x='3' y='26' width='30' height='5' fill='%236aa048'/><rect x='6' y='19' width='1' height='1' fill='%23f0e85a'/><rect x='12' y='21' width='1' height='1' fill='%23e87aa8'/><rect x='18' y='18' width='1' height='1' fill='%23ffffff'/><rect x='24' y='22' width='1' height='1' fill='%23c89af0'/><rect x='29' y='20' width='1' height='1' fill='%23f0e85a'/><rect x='9' y='27' width='1' height='1' fill='%23ffffff'/><rect x='22' y='28' width='1' height='1' fill='%23e87aa8'/><rect x='15' y='25' width='1' height='1' fill='%23f0e85a'/><rect x='17' y='3' width='2' height='28' fill='%238a6342'/><rect x='17' y='3' width='1' height='28' fill='%23a87a52'/><rect x='3' y='16' width='30' height='2' fill='%238a6342'/><rect x='3' y='16' width='30' height='1' fill='%23a87a52'/><rect x='0' y='31' width='36' height='2' fill='%236b4a30'/><rect x='0' y='33' width='36' height='4' fill='%239a6b42'/><rect x='0' y='33' width='36' height='1' fill='%23b08254'/><rect x='0' y='37' width='36' height='1' fill='%235a3c24'/><rect x='5' y='33' width='4' height='4' fill='%23c2607a'/><rect x='5' y='32' width='4' height='1' fill='%235f8f4a'/><rect x='27' y='32' width='2' height='5' fill='%23cfa0d8'/><rect x='27' y='32' width='2' height='1' fill='%23e0c0e8'/><rect x='11' y='34' width='2' height='3' fill='%23d8c49a'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-window-curtain{width:44em;height:38em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 40'><rect x='10' y='2' width='28' height='34' fill='%235a3c24'/><rect x='11' y='3' width='26' height='33' fill='%238a6342'/><rect x='11' y='3' width='26' height='1' fill='%23a87a52'/><rect x='13' y='5' width='22' height='26' fill='%23a9d4ea'/><rect x='13' y='5' width='22' height='7' fill='%23c0e3f2'/><rect x='13' y='12' width='22' height='5' fill='%235f8f4a'/><rect x='13' y='12' width='6' height='3' fill='%236fa055'/><rect x='21' y='11' width='6' height='4' fill='%236fa055'/><rect x='29' y='12' width='6' height='3' fill='%23567f42'/><rect x='13' y='16' width='22' height='15' fill='%237cb356'/><rect x='13' y='16' width='22' height='2' fill='%238cc266'/><rect x='13' y='26' width='22' height='5' fill='%236aa048'/><rect x='17' y='20' width='1' height='1' fill='%23f0e85a'/><rect x='24' y='22' width='1' height='1' fill='%23e87aa8'/><rect x='30' y='19' width='1' height='1' fill='%23ffffff'/><rect x='20' y='27' width='1' height='1' fill='%23f0e85a'/><rect x='28' y='28' width='1' height='1' fill='%23c89af0'/><rect x='23' y='5' width='2' height='26' fill='%238a6342'/><rect x='23' y='5' width='1' height='26' fill='%23a87a52'/><rect x='13' y='17' width='22' height='2' fill='%238a6342'/><rect x='13' y='17' width='22' height='1' fill='%23a87a52'/><rect x='10' y='31' width='28' height='2' fill='%236b4a30'/><rect x='10' y='33' width='28' height='3' fill='%239a6b42'/><rect x='10' y='33' width='28' height='1' fill='%23b08254'/><rect x='2' y='1' width='44' height='2' fill='%235a4030'/><rect x='1' y='1' width='2' height='3' fill='%23e8d8b8'/><rect x='45' y='1' width='2' height='3' fill='%23e8d8b8'/><rect x='3' y='3' width='11' height='32' fill='%23eef2f8'/><rect x='4' y='3' width='1' height='32' fill='%23ffffff'/><rect x='7' y='3' width='1' height='32' fill='%23ffffff'/><rect x='10' y='3' width='1' height='32' fill='%23ffffff'/><rect x='6' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='9' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='12' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='3' y='3' width='11' height='1' fill='%23d3dde9'/><rect x='34' y='3' width='11' height='32' fill='%23eef2f8'/><rect x='35' y='3' width='1' height='32' fill='%23ffffff'/><rect x='38' y='3' width='1' height='32' fill='%23ffffff'/><rect x='41' y='3' width='1' height='32' fill='%23ffffff'/><rect x='36' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='39' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='44' y='3' width='1' height='32' fill='%23d3dde9'/><rect x='34' y='3' width='11' height='1' fill='%23d3dde9'/></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-sakura{width:104em;height:69em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 48' shape-rendering='crispEdges'><g fill='%23b56b88'><rect x='8' y='14' width='14' height='8'/><rect x='50' y='14' width='14' height='8'/><rect x='14' y='8' width='44' height='8'/><rect x='6' y='16' width='60' height='8'/><rect x='5' y='22' width='26' height='7'/><rect x='41' y='22' width='26' height='7'/><rect x='18' y='5' width='16' height='5'/><rect x='38' y='5' width='16' height='5'/><rect x='10' y='22' width='52' height='4'/><rect x='26' y='26' width='20' height='3'/></g><g fill='%23d98fab'><rect x='20' y='5' width='14' height='4'/><rect x='38' y='5' width='14' height='4'/><rect x='13' y='9' width='15' height='5'/><rect x='44' y='9' width='15' height='5'/><rect x='30' y='8' width='12' height='4'/><rect x='6' y='16' width='15' height='5'/><rect x='51' y='16' width='15' height='5'/><rect x='8' y='14' width='12' height='4'/><rect x='52' y='14' width='12' height='4'/><rect x='22' y='15' width='16' height='4'/><rect x='38' y='15' width='16' height='4'/><rect x='5' y='22' width='15' height='5'/><rect x='52' y='22' width='15' height='5'/><rect x='22' y='22' width='16' height='4'/><rect x='38' y='22' width='16' height='4'/><rect x='13' y='25' width='16' height='4'/><rect x='43' y='25' width='16' height='4'/></g><g fill='%23f0b4cc'><rect x='22' y='5' width='8' height='3'/><rect x='44' y='5' width='8' height='3'/><rect x='16' y='10' width='9' height='3'/><rect x='49' y='10' width='9' height='3'/><rect x='32' y='8' width='10' height='3'/><rect x='8' y='17' width='9' height='3'/><rect x='56' y='17' width='9' height='3'/><rect x='24' y='16' width='10' height='2'/><rect x='40' y='16' width='10' height='2'/><rect x='7' y='23' width='9' height='3'/><rect x='57' y='23' width='8' height='3'/><rect x='15' y='25' width='9' height='2'/><rect x='49' y='25' width='9' height='2'/></g><g fill='%23ffd4e4'><rect x='24' y='5' width='4' height='2'/><rect x='46' y='5' width='4' height='2'/><rect x='18' y='10' width='4' height='2'/><rect x='51' y='10' width='4' height='2'/><rect x='10' y='17' width='4' height='2'/><rect x='34' y='8' width='5' height='2'/></g><g fill='%23a05675'><rect x='30' y='17' width='16' height='2'/><rect x='18' y='19' width='10' height='2'/><rect x='46' y='19' width='10' height='2'/><rect x='24' y='25' width='14' height='2'/><rect x='40' y='25' width='14' height='2'/></g><g fill='%237a4a30'><rect x='33' y='27' width='6' height='14'/><rect x='28' y='29' width='6' height='3'/><rect x='40' y='28' width='6' height='3'/></g><rect x='34' y='27' width='3' height='14' fill='%238f5a3c'/><rect x='38' y='27' width='2' height='14' fill='%235e3a26'/><g fill='%237a4a30'><rect x='30' y='41' width='5' height='2'/><rect x='38' y='41' width='6' height='2'/><rect x='26' y='42' width='6' height='1'/><rect x='42' y='42' width='6' height='1'/></g><g fill='%23d98fab'><rect x='16' y='34' width='2' height='1'/><rect x='54' y='32' width='2' height='1'/><rect x='20' y='38' width='1' height='1'/><rect x='50' y='37' width='1' height='1'/></g></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-willow{width:114em;height:72em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 50' shape-rendering='crispEdges'><g fill='%236a9460'><rect x='6' y='14' width='16' height='8'/><rect x='58' y='14' width='16' height='8'/><rect x='16' y='8' width='48' height='8'/><rect x='5' y='16' width='70' height='6'/><rect x='22' y='5' width='18' height='4'/><rect x='40' y='5' width='18' height='4'/></g><g fill='%2388b478'><rect x='22' y='5' width='16' height='4'/><rect x='42' y='5' width='16' height='4'/><rect x='14' y='9' width='16' height='5'/><rect x='50' y='9' width='16' height='5'/><rect x='32' y='8' width='16' height='4'/><rect x='6' y='15' width='16' height='5'/><rect x='58' y='15' width='16' height='5'/><rect x='24' y='15' width='16' height='4'/><rect x='40' y='15' width='16' height='4'/></g><g fill='%23a8d090'><rect x='24' y='5' width='9' height='3'/><rect x='48' y='5' width='9' height='3'/><rect x='16' y='10' width='10' height='3'/><rect x='56' y='10' width='10' height='3'/><rect x='34' y='8' width='12' height='3'/><rect x='8' y='16' width='10' height='2'/><rect x='62' y='16' width='10' height='2'/></g><g fill='%23c8e8b0'><rect x='26' y='5' width='4' height='2'/><rect x='50' y='5' width='4' height='2'/><rect x='18' y='10' width='4' height='2'/><rect x='58' y='10' width='4' height='2'/></g><g fill='%235a8050'><rect x='7' y='22' width='4' height='14'/><rect x='14' y='21' width='3' height='11'/><rect x='21' y='20' width='3' height='15'/><rect x='28' y='21' width='3' height='10'/><rect x='35' y='20' width='3' height='13'/><rect x='42' y='20' width='3' height='10'/><rect x='49' y='20' width='3' height='15'/><rect x='56' y='21' width='3' height='11'/><rect x='63' y='21' width='3' height='14'/><rect x='70' y='22' width='4' height='13'/><rect x='31' y='22' width='2' height='8'/><rect x='47' y='22' width='2' height='8'/></g><g fill='%2388b478'><rect x='7' y='22' width='3' height='9'/><rect x='21' y='20' width='2' height='9'/><rect x='35' y='20' width='2' height='8'/><rect x='49' y='20' width='2' height='9'/><rect x='63' y='21' width='2' height='9'/><rect x='70' y='22' width='3' height='8'/></g><g fill='%23a8d090'><rect x='8' y='34' width='2' height='2'/><rect x='22' y='33' width='2' height='2'/><rect x='50' y='33' width='2' height='2'/><rect x='71' y='33' width='2' height='2'/></g><g fill='%237a4a30'><rect x='36' y='19' width='7' height='24'/><rect x='31' y='24' width='6' height='3'/><rect x='42' y='23' width='6' height='3'/></g><rect x='37' y='19' width='3' height='24' fill='%238f5a3c'/><rect x='41' y='19' width='2' height='24' fill='%235e3a26'/><g fill='%237a4a30'><rect x='33' y='43' width='5' height='2'/><rect x='41' y='43' width='6' height='2'/><rect x='29' y='44' width='6' height='1'/><rect x='45' y='44' width='6' height='1'/></g></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-maple{width:104em;height:69em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 48' shape-rendering='crispEdges'><g fill='%23bd7838'><rect x='8' y='12' width='14' height='8'/><rect x='50' y='12' width='14' height='8'/><rect x='14' y='7' width='44' height='8'/><rect x='6' y='14' width='60' height='8'/><rect x='5' y='20' width='26' height='7'/><rect x='41' y='20' width='26' height='7'/><rect x='18' y='4' width='16' height='5'/><rect x='38' y='4' width='16' height='5'/><rect x='10' y='22' width='52' height='4'/><rect x='26' y='26' width='20' height='3'/></g><g fill='%23e0993f'><rect x='20' y='4' width='14' height='4'/><rect x='38' y='4' width='14' height='4'/><rect x='13' y='8' width='15' height='5'/><rect x='44' y='8' width='15' height='5'/><rect x='30' y='6' width='12' height='4'/><rect x='6' y='14' width='15' height='5'/><rect x='51' y='14' width='15' height='5'/><rect x='8' y='12' width='12' height='4'/><rect x='52' y='12' width='12' height='4'/><rect x='22' y='14' width='16' height='4'/><rect x='38' y='14' width='16' height='4'/><rect x='5' y='20' width='15' height='5'/><rect x='52' y='20' width='15' height='5'/><rect x='22' y='20' width='16' height='4'/><rect x='38' y='20' width='16' height='4'/><rect x='13' y='24' width='16' height='4'/><rect x='43' y='24' width='16' height='4'/></g><g fill='%23f0c050'><rect x='22' y='4' width='8' height='3'/><rect x='44' y='4' width='8' height='3'/><rect x='16' y='9' width='9' height='3'/><rect x='49' y='9' width='9' height='3'/><rect x='32' y='6' width='10' height='3'/><rect x='8' y='15' width='9' height='3'/><rect x='56' y='15' width='9' height='3'/><rect x='24' y='15' width='10' height='2'/><rect x='40' y='15' width='10' height='2'/><rect x='7' y='21' width='9' height='3'/><rect x='57' y='21' width='8' height='3'/><rect x='15' y='24' width='9' height='2'/><rect x='49' y='24' width='9' height='2'/></g><g fill='%23f8dc88'><rect x='24' y='4' width='4' height='2'/><rect x='46' y='4' width='4' height='2'/><rect x='18' y='9' width='4' height='2'/><rect x='51' y='9' width='4' height='2'/><rect x='34' y='6' width='5' height='2'/></g><g fill='%23a85f28'><rect x='30' y='15' width='16' height='2'/><rect x='18' y='17' width='10' height='2'/><rect x='46' y='17' width='10' height='2'/><rect x='24' y='23' width='14' height='2'/><rect x='40' y='23' width='14' height='2'/></g><g fill='%237a4a30'><rect x='33' y='27' width='6' height='14'/><rect x='28' y='29' width='6' height='3'/><rect x='40' y='28' width='6' height='3'/></g><rect x='34' y='27' width='3' height='14' fill='%238f5a3c'/><rect x='38' y='27' width='2' height='14' fill='%235e3a26'/><g fill='%237a4a30'><rect x='30' y='41' width='5' height='2'/><rect x='38' y='41' width='6' height='2'/><rect x='26' y='42' width='6' height='1'/><rect x='42' y='42' width='6' height='1'/></g><g fill='%23e0993f'><rect x='16' y='34' width='2' height='1'/><rect x='54' y='32' width='2' height='1'/><rect x='20' y='38' width='1' height='1'/></g></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-tree-dream{width:104em;height:69em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 48' shape-rendering='crispEdges'><g fill='%237064a8'><rect x='8' y='13' width='14' height='8'/><rect x='50' y='13' width='14' height='8'/><rect x='14' y='7' width='44' height='8'/><rect x='6' y='15' width='60' height='8'/><rect x='5' y='21' width='26' height='7'/><rect x='41' y='21' width='26' height='7'/><rect x='18' y='4' width='16' height='5'/><rect x='38' y='4' width='16' height='5'/><rect x='10' y='23' width='52' height='4'/><rect x='26' y='27' width='20' height='3'/></g><g fill='%239488d0'><rect x='20' y='4' width='14' height='4'/><rect x='38' y='4' width='14' height='4'/><rect x='13' y='8' width='15' height='5'/><rect x='44' y='8' width='15' height='5'/><rect x='30' y='6' width='12' height='4'/><rect x='6' y='15' width='15' height='5'/><rect x='51' y='15' width='15' height='5'/><rect x='8' y='13' width='12' height='4'/><rect x='52' y='13' width='12' height='4'/><rect x='22' y='15' width='16' height='4'/><rect x='38' y='15' width='16' height='4'/><rect x='5' y='21' width='15' height='5'/><rect x='52' y='21' width='15' height='5'/><rect x='22' y='21' width='16' height='4'/><rect x='38' y='21' width='16' height='4'/><rect x='13' y='25' width='16' height='4'/><rect x='43' y='25' width='16' height='4'/></g><g fill='%23b8acec'><rect x='22' y='4' width='8' height='3'/><rect x='44' y='4' width='8' height='3'/><rect x='16' y='9' width='9' height='3'/><rect x='49' y='9' width='9' height='3'/><rect x='32' y='6' width='10' height='3'/><rect x='8' y='16' width='9' height='3'/><rect x='56' y='16' width='9' height='3'/><rect x='24' y='15' width='10' height='2'/><rect x='40' y='15' width='10' height='2'/><rect x='7' y='22' width='9' height='3'/><rect x='57' y='22' width='8' height='3'/></g><g fill='%23e4dcff'><rect x='24' y='4' width='4' height='2'/><rect x='46' y='4' width='4' height='2'/><rect x='18' y='9' width='4' height='2'/><rect x='34' y='6' width='5' height='2'/></g><g fill='%235a4e90'><rect x='30' y='16' width='16' height='2'/><rect x='18' y='18' width='10' height='2'/><rect x='46' y='18' width='10' height='2'/><rect x='24' y='24' width='14' height='2'/><rect x='40' y='24' width='14' height='2'/></g><g fill='%23a0ece0'><rect x='22' y='10' width='2' height='2'/><rect x='46' y='7' width='2' height='2'/><rect x='14' y='18' width='2' height='2'/><rect x='58' y='17' width='2' height='2'/><rect x='34' y='12' width='2' height='2'/><rect x='28' y='22' width='2' height='2'/><rect x='44' y='21' width='2' height='2'/></g><g fill='%237a4a30'><rect x='33' y='28' width='6' height='13'/><rect x='28' y='30' width='6' height='3'/><rect x='40' y='29' width='6' height='3'/></g><rect x='34' y='28' width='3' height='13' fill='%238f5a3c'/><rect x='38' y='28' width='2' height='13' fill='%235e3a26'/><g fill='%237a4a30'><rect x='30' y='41' width='5' height='2'/><rect x='38' y='41' width='6' height='2'/><rect x='26' y='42' width='6' height='1'/><rect x='42' y='42' width='6' height='1'/></g><g fill='%23a0ece0'><rect x='16' y='34' width='2' height='2'/><rect x='54' y='32' width='2' height='2'/></g></svg>");}
      .cigh-clean-room-prop.cigh-clean-deco-prop-moon-full{width:28em;height:28em;background-image:url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' shape-rendering='crispEdges'><circle cx='16' cy='16' r='14' fill='%23fff8dc' fill-opacity='.16'/><circle cx='16' cy='16' r='12.5' fill='%23f5dfa0'/><circle cx='16' cy='16' r='10.5' fill='%23ffeaa8'/><circle cx='16' cy='16' r='8.5' fill='%23fff3c7'/><circle cx='12' cy='11' r='3.5' fill='%23fffdf3' fill-opacity='.78'/><circle cx='20' cy='20' r='2' fill='%23f6df9a' fill-opacity='.55'/></svg>");}

      .cigh-clean-deco-editor {
        position: relative;
        z-index: 1;
        width: 100%;
        margin: calc(8px * var(--cigh-ui-font-scale, 1)) 0;
        border: 1px solid var(--cigh-border-soft);
        border-radius: calc(8px * var(--cigh-ui-font-scale, 1));
        background: linear-gradient(180deg, color-mix(in srgb, var(--cigh-bg-2) 96%, transparent), var(--cigh-bg-soft));
        padding: calc(8px * var(--cigh-ui-font-scale, 1));
        box-sizing: border-box;
        box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 6%, transparent);
      }
      .cigh-clean-deco-head {
        display: flex;
        align-items: center;
        gap: calc(5px * var(--cigh-ui-font-scale, 1));
        margin-bottom: calc(7px * var(--cigh-ui-font-scale, 1));
        min-width: 0;
      }
      .cigh-clean-deco-ticket {
        margin-right: auto;
        display: inline-flex;
        align-items: baseline;
        gap: calc(2px * var(--cigh-ui-font-scale, 1));
        padding: calc(2px * var(--cigh-ui-font-scale, 1)) calc(8px * var(--cigh-ui-font-scale, 1));
        border-radius: 999px;
        background: color-mix(in srgb, var(--cigh-accent) 16%, var(--cigh-bg-3));
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 34%, var(--cigh-border-soft));
        color: var(--cigh-accent);
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(11px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        white-space: nowrap;
      }
      .cigh-clean-deco-ticket b { font-size: calc(10px * var(--cigh-ui-font-scale, 1)); }
      .cigh-clean-deco-ticket i { font-style: normal; font-size: calc(8px * var(--cigh-ui-font-scale, 1)); opacity: .75; }
      .cigh-clean-deco-ticket em {
        font-style: normal;
        margin-left: calc(4px * var(--cigh-ui-font-scale, 1));
        padding-left: calc(4px * var(--cigh-ui-font-scale, 1));
        border-left: 1px solid color-mix(in srgb, var(--cigh-accent) 32%, transparent);
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        color: color-mix(in srgb, var(--cigh-accent) 72%, var(--cigh-text-dim) 28%);
        opacity: .9;
      }
      .cigh-clean-deco-count {
        flex: 0 0 auto;
        color: color-mix(in srgb, var(--cigh-accent) 70%, var(--cigh-text) 30%);
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        letter-spacing: .02em;
        white-space: nowrap;
      }
      .cigh-clean-deco-mini-btn {
        flex: 0 0 auto;
        border: 1px solid var(--cigh-border-soft);
        border-radius: calc(6px * var(--cigh-ui-font-scale, 1));
        background: color-mix(in srgb, var(--cigh-fill) 80%, transparent);
        color: var(--cigh-text-soft);
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        padding: calc(3px * var(--cigh-ui-font-scale, 1)) calc(8px * var(--cigh-ui-font-scale, 1));
        cursor: pointer;
        transition: transform .08s ease, filter .12s ease;
      }
      .cigh-clean-deco-mini-btn:active { transform: translateY(1px); }
      .cigh-clean-deco-mini-btn.ghost { opacity: .82; }
      .cigh-clean-deco-mini-btn.gacha {
        color: var(--cigh-bg);
        font-weight: 700;
        border-color: color-mix(in srgb, var(--cigh-accent) 60%, #000 10%);
        background: linear-gradient(180deg, color-mix(in srgb, var(--cigh-accent) 92%, #fff 8%), var(--cigh-accent));
        box-shadow: 0 1px 0 color-mix(in srgb, var(--cigh-accent) 55%, #000 45%);
      }
      .cigh-clean-deco-mini-btn.gacha.off { filter: grayscale(.5); opacity: .55; }
      .cigh-clean-deco-tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: calc(4px * var(--cigh-ui-font-scale, 1));
        margin-bottom: calc(6px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-deco-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 1px solid var(--cigh-border-soft);
        border-radius: calc(6px * var(--cigh-ui-font-scale, 1));
        background: var(--cigh-bg-3);
        color: var(--cigh-text-soft);
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(9.5px * var(--cigh-ui-font-scale, 1));
        padding: calc(5px * var(--cigh-ui-font-scale, 1)) calc(2px * var(--cigh-ui-font-scale, 1));
        cursor: pointer;
      }
      .cigh-clean-deco-tab-icon { font-size: calc(10px * var(--cigh-ui-font-scale, 1)); line-height: 1; opacity: .85; }
      .cigh-clean-deco-tab-count {
        min-width: calc(14px * var(--cigh-ui-font-scale, 1));
        padding: 0 calc(3px * var(--cigh-ui-font-scale, 1));
        border-radius: 999px;
        background: color-mix(in srgb, var(--cigh-fill) 70%, transparent);
        color: var(--cigh-text-faint);
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        line-height: 1.5;
      }
      .cigh-clean-deco-tab.on {
        color: var(--cigh-accent);
        border-color: color-mix(in srgb, var(--cigh-accent) 52%, var(--cigh-border-soft));
        background: color-mix(in srgb, var(--cigh-accent) 12%, var(--cigh-bg-3));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cigh-accent) 20%, transparent);
      }
      .cigh-clean-deco-tab.on .cigh-clean-deco-tab-count {
        background: color-mix(in srgb, var(--cigh-accent) 24%, transparent);
        color: var(--cigh-accent);
      }
      .cigh-clean-deco-shelf {
        display: flex;
        align-items: stretch;
        gap: calc(5px * var(--cigh-ui-font-scale, 1));
        overflow-x: auto;
        overflow-y: hidden;
        padding: calc(1px * var(--cigh-ui-font-scale, 1)) calc(1px * var(--cigh-ui-font-scale, 1)) calc(4px * var(--cigh-ui-font-scale, 1));
        scrollbar-width: thin;
        scrollbar-color: var(--cigh-border) transparent;
      }
      .cigh-clean-deco-shelf::-webkit-scrollbar { height: calc(4px * var(--cigh-ui-font-scale, 1)); }
      .cigh-clean-deco-shelf::-webkit-scrollbar-thumb { background: var(--cigh-border); border-radius: 999px; }
      .cigh-clean-deco-item {
        position: relative;
        flex: 0 0 calc(48px * var(--cigh-ui-font-scale, 1));
        min-height: calc(50px * var(--cigh-ui-font-scale, 1));
        padding: calc(6px * var(--cigh-ui-font-scale, 1)) calc(3px * var(--cigh-ui-font-scale, 1)) calc(5px * var(--cigh-ui-font-scale, 1));
        border: 1px solid var(--cigh-border-soft);
        border-radius: calc(7px * var(--cigh-ui-font-scale, 1));
        background: var(--cigh-bg-2);
        color: var(--cigh-text-soft);
        font-family: "Courier New", Consolas, monospace;
        cursor: pointer;
        display: grid;
        grid-template-rows: 1fr auto;
        place-items: center;
        gap: calc(3px * var(--cigh-ui-font-scale, 1));
        overflow: hidden;
        transition: transform .08s ease, border-color .12s ease;
      }
      .cigh-clean-deco-item:active { transform: translateY(1px) scale(.97); }
      .cigh-clean-deco-rank-dot {
        position: absolute;
        top: calc(4px * var(--cigh-ui-font-scale, 1));
        left: calc(4px * var(--cigh-ui-font-scale, 1));
        width: calc(5px * var(--cigh-ui-font-scale, 1));
        height: calc(5px * var(--cigh-ui-font-scale, 1));
        border-radius: 999px;
        background: var(--deco-rank-color, var(--cigh-text-dim));
        box-shadow: 0 0 5px color-mix(in srgb, var(--deco-rank-color, transparent) 60%, transparent);
      }
      .cigh-clean-deco-item.rank-SR { border-color: color-mix(in srgb, var(--deco-rank-color) 40%, var(--cigh-border-soft)); }
      .cigh-clean-deco-icon {
        font-size: calc(16px * var(--cigh-ui-font-scale, 1));
        line-height: 1;
              }
      .cigh-clean-deco-name {
        max-width: calc(44px * var(--cigh-ui-font-scale, 1));
        overflow: hidden;
        white-space: nowrap;
        text-overflow: clip;
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        line-height: 1.15;
        color: color-mix(in srgb, var(--cigh-text-soft) 78%, var(--cigh-accent) 22%);
      }
      .cigh-clean-deco-item-qty {
        position: absolute;
        top: calc(3px * var(--cigh-ui-font-scale, 1));
        right: calc(3px * var(--cigh-ui-font-scale, 1));
        padding: 0 calc(3px * var(--cigh-ui-font-scale, 1));
        border-radius: 999px;
        font-size: calc(7px * var(--cigh-ui-font-scale, 1));
        line-height: 1.4;
        color: var(--cigh-accent);
        background: color-mix(in srgb, #0a0d0b 78%, transparent);
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 30%, var(--cigh-border-soft));
      }
      .cigh-clean-deco-item.on {
        color: var(--cigh-accent);
        border-color: var(--cigh-accent);
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, var(--cigh-accent) 28%, transparent),
          0 0 7px color-mix(in srgb, var(--cigh-accent) 30%, transparent);
      }
      .cigh-clean-deco-on-mark {
        position: absolute;
        bottom: 3px;
        right: 4px;
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        color: var(--cigh-accent);
      }
      .cigh-clean-deco-empty,
      .cigh-clean-deco-help { color: var(--cigh-text-dim); font-size: calc(8.5px * var(--cigh-ui-font-scale, 1)); line-height: 1.4; }
      .cigh-clean-deco-empty {
        flex: 1;
        display: grid;
        place-items: center;
        min-height: calc(50px * var(--cigh-ui-font-scale, 1));
        text-align: center;
      }
      .cigh-clean-deco-help { margin-top: calc(6px * var(--cigh-ui-font-scale, 1)); }

      /* ── Gacha reveal ── */
      .cigh-clean-gacha-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background: rgba(8, 9, 12, .62);
        backdrop-filter: blur(3px);
        font-family: "Courier New", Consolas, monospace;
        animation: cigh-clean-gacha-fade .22s ease;
      }
      .cigh-clean-gacha-backdrop.in-panel {
        position: absolute;
        inset: 0;
        z-index: 40;
        border-radius: inherit;
        background: rgba(8, 9, 12, .68);
        backdrop-filter: blur(2px);
      }
      .cigh-clean-gacha-backdrop.closing { opacity: 0; transition: opacity .19s ease; }
      .cigh-clean-gacha-backdrop.in-panel .cigh-clean-gacha-stage {
        width: min(228px, calc(100% - 18px));
        height: min(260px, calc(100% - 18px));
      }
      .cigh-clean-gacha-backdrop.in-panel .cigh-clean-gacha-rays {
        width: 260px;
        height: 260px;
      }
      @keyframes cigh-clean-gacha-fade { from { opacity: 0; } to { opacity: 1; } }
      .cigh-clean-gacha-stage {
        position: relative;
        width: min(240px, calc(100vw - 44px));
        height: 240px;
        display: grid;
        place-items: center;
        text-align: center;
      }
      .cigh-clean-gacha-rays {
        position: absolute;
        width: 300px;
        height: 300px;
        background: repeating-conic-gradient(from 0deg,
          color-mix(in srgb, var(--gacha-color) 30%, transparent) 0deg 10deg,
          transparent 10deg 20deg);
        border-radius: 50%;
        opacity: 0;
        pointer-events: none;
        transition: opacity .5s ease;
        animation: cigh-clean-gacha-spin 14s linear infinite;
        -webkit-mask: radial-gradient(circle, #000 22%, transparent 70%);
        mask: radial-gradient(circle, #000 22%, transparent 70%);
      }
      .cigh-clean-gacha-stage.revealed .cigh-clean-gacha-rays { opacity: .5; }
      @keyframes cigh-clean-gacha-spin { to { transform: rotate(360deg); } }
      .cigh-clean-gacha-capsule { position: absolute; width: 60px; height: 60px; z-index: 2; }
      .cigh-clean-gacha-stage.shake .cigh-clean-gacha-capsule { animation: cigh-clean-gacha-shake .62s ease-in-out; }
      .cigh-clean-gacha-stage.revealed .cigh-clean-gacha-capsule { display: none; }
      .cigh-clean-gacha-cap-top,
      .cigh-clean-gacha-cap-bot {
        position: absolute;
        left: 0;
        width: 60px;
        height: 30px;
        box-sizing: border-box;
        image-rendering: pixelated;
      }
      .cigh-clean-gacha-cap-top {
        top: 0;
        border-radius: 30px 30px 0 0;
        background: linear-gradient(180deg, color-mix(in srgb, var(--gacha-color) 88%, #fff 12%), var(--gacha-color));
        border: 2px solid color-mix(in srgb, var(--gacha-color) 60%, #000 40%);
        border-bottom: 0;
      }
      .cigh-clean-gacha-cap-bot {
        bottom: 0;
        border-radius: 0 0 30px 30px;
        background: #efe7d4;
        border: 2px solid #b8a884;
        border-top: 0;
      }
      .cigh-clean-gacha-cap-dot {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 10px;
        height: 10px;
        margin: -5px 0 0 -5px;
        border-radius: 999px;
        background: #fff;
        border: 2px solid #b8a884;
        z-index: 3;
      }
      .cigh-clean-gacha-reveal {
        position: absolute;
        z-index: 3;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        opacity: 0;
        transform: scale(.4);
        pointer-events: none;
      }
      .cigh-clean-gacha-stage.revealed .cigh-clean-gacha-reveal { animation: cigh-clean-gacha-pop .46s cubic-bezier(.2, 1.5, .4, 1) .1s forwards; }
      @keyframes cigh-clean-gacha-pop { to { opacity: 1; transform: scale(1); } }
      .cigh-clean-gacha-rank {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .16em;
        color: var(--gacha-color);
      }
      .cigh-clean-gacha-icon {
        font-size: 38px;
        line-height: 1;
        filter: drop-shadow(0 0 12px color-mix(in srgb, var(--gacha-color) 55%, transparent));
        animation: cigh-clean-gacha-float 2.2s ease-in-out infinite;
      }
      @keyframes cigh-clean-gacha-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      .cigh-clean-gacha-name { font-size: 13px; font-weight: 700; color: var(--cigh-text); }
      .cigh-clean-gacha-tag {
        font-size: 8.5px;
        font-weight: 700;
        letter-spacing: .08em;
        color: var(--cigh-bg);
        background: var(--gacha-color);
        padding: 2px 8px;
        border-radius: 999px;
      }
      .cigh-clean-gacha-hint {
        position: absolute;
        bottom: 4px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 8.5px;
        letter-spacing: .04em;
        color: var(--cigh-text-dim);
        white-space: nowrap;
        opacity: 0;
      }
      .cigh-clean-gacha-stage.revealed .cigh-clean-gacha-hint { animation: cigh-clean-gacha-fade .4s ease .85s forwards; }
      @keyframes cigh-clean-gacha-shake {
        0%, 100% { transform: translateX(0) rotate(0); }
        20% { transform: translateX(-4px) rotate(-6deg); }
        40% { transform: translateX(4px) rotate(6deg); }
        60% { transform: translateX(-3px) rotate(-4deg); }
        80% { transform: translateX(3px) rotate(4deg); }
      }
      .cigh-clean-pet-img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: auto;
        pointer-events: none;
        user-select: none;
        -webkit-user-drag: none;
      }
      .cigh-clean-bpm-card {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--cigh-border-soft);
        background: color-mix(in srgb, var(--cigh-fill) 76%, transparent);
        padding: 7px 8px 8px;
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cigh-bpm-color) 12%, transparent);
      }
      .cigh-clean-bpm-head {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        font-family: "Courier New", Consolas, monospace;
      }
      .cigh-clean-bpm-heart {
        color: var(--cigh-bpm-color);
        font-size: 12px;
        line-height: 1;
        animation: cigh-clean-bpm-heartbeat var(--bpm-dur) ease-in-out infinite;
        filter: drop-shadow(0 0 4px color-mix(in srgb, var(--cigh-bpm-color) 50%, transparent));
      }
      .cigh-clean-bpm-number {
        color: var(--cigh-text);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
      }
      .cigh-clean-bpm-mood {
        margin-left: auto;
        color: var(--cigh-text-dim);
        font-size: 9px;
        letter-spacing: .04em;
      }
      .cigh-clean-ecg-window {
        position: relative;
        height: 32px;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--cigh-bpm-color) 24%, var(--cigh-border-soft));
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--cigh-bpm-color) 10%, transparent) 1px, transparent 1px),
          linear-gradient(0deg, color-mix(in srgb, var(--cigh-bpm-color) 8%, transparent) 1px, transparent 1px);
        background-size: 12px 12px;
      }
      .cigh-clean-ecg-line {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        fill: none;
        overflow: visible;
      }
      .cigh-clean-ecg-base,
      .cigh-clean-ecg-trace {
        fill: none;
        stroke: var(--cigh-bpm-color);
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .cigh-clean-ecg-base {
        opacity: .28;
        stroke-width: 1.45;
      }
      .cigh-clean-ecg-trace {
        opacity: .92;
        stroke-width: 2.05;
        stroke-dasharray: 70 250;
        stroke-dashoffset: 320;
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--cigh-bpm-color) 34%, transparent));
        animation: cigh-clean-ecg-trace var(--bpm-dur) linear infinite;
      }
      .cigh-clean-bpm-love .cigh-clean-bpm-number,
      .cigh-clean-bpm-scared .cigh-clean-bpm-number {
        color: var(--cigh-bpm-color);
        animation: cigh-clean-bpm-soft-pulse calc(var(--bpm-dur) * 1.15) ease-in-out infinite;
      }
      .cigh-clean-bpm-sad {
        opacity: .82;
      }
      .cigh-clean-bpm-sad .cigh-clean-ecg-base {
        opacity: .20;
      }
      .cigh-clean-bpm-sad .cigh-clean-ecg-trace {
        stroke-width: 1.55;
        filter: none;
        opacity: .70;
      }
      @keyframes cigh-clean-ecg-trace {
        0% { stroke-dashoffset: 320; opacity: .92; }
        100% { stroke-dashoffset: 0; opacity: .92; }
      }
      @keyframes cigh-clean-bpm-heartbeat {
        0%, 100% { transform: scale(1); }
        18% { transform: scale(1.10); }
        34% { transform: scale(.995); }
        52% { transform: scale(1.035); }
        68% { transform: scale(1); }
      }
      @keyframes cigh-clean-bpm-soft-pulse {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-0.5px); }
      }
      .cigh-clean-tendency-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 5px;
        margin-top: 6px;
      }
      .cigh-clean-tendency-badge {
        position: relative;
        isolation: isolate;
        min-height: 47px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto auto;
        place-items: center;
        gap: 1px;
        padding: 6px 3px 8px;
        border: 1px solid color-mix(in srgb, var(--tendency-color) 58%, var(--cigh-border-soft));
        background: var(--cigh-bg-2);
        color: var(--cigh-text);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cigh-bg) 72%, transparent);
      }
      #${PANEL_ID}[data-cigh-theme="light"] .cigh-clean-tendency-badge {
        background: var(--cigh-bg-3);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cigh-fill) 72%, transparent);
      }
      .cigh-clean-tendency-badge::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--tendency-color);
        z-index: 0;
        image-rendering: pixelated;
      }
      .cigh-clean-tendency-fill {
        position: absolute;
        left: 3px;
        right: 3px;
        bottom: 2px;
        height: var(--tendency-fill);
        min-height: 2px;
        max-height: 4px;
        background: var(--tendency-color);
        opacity: .86;
        border-top: 0;
        z-index: 0;
        image-rendering: pixelated;
      }
      .cigh-clean-tendency-emoji,
      .cigh-clean-tendency-name,
      .cigh-clean-tendency-count {
        position: relative;
        z-index: 2;
      }
      .cigh-clean-tendency-emoji {
        font-size: 13px;
        line-height: 1;
              }
      .cigh-clean-tendency-name {
        font-size: 8.5px;
        letter-spacing: .02em;
        color: var(--cigh-text-soft);
        white-space: nowrap;
      }
      .cigh-clean-tendency-count {
        font-family: "Courier New", Consolas, monospace;
        font-size: 12px;
        font-weight: 700;
        color: var(--cigh-text);
      }
      .cigh-clean-tendency-badge.is-active {
        border-color: var(--cigh-accent);
        color: var(--cigh-text);
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, var(--cigh-accent) 42%, transparent),
          0 0 8px color-mix(in srgb, var(--cigh-accent) 48%, transparent),
          0 0 10px color-mix(in srgb, var(--tendency-color) 34%, transparent);
        animation: cigh-clean-tendency-pulse 1.4s ease-in-out infinite;
      }
      .cigh-clean-tendency-badge.is-active .cigh-clean-tendency-name {
        color: var(--cigh-text);
      }
      .cigh-clean-tendency-badge.is-zero {
        opacity: .46;
        filter: grayscale(.25);
      }
      @keyframes cigh-clean-tendency-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.04); }
      }
      @keyframes cigh-clean-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }
      @keyframes cigh-clean-sleep-breathe {
        0%, 100% { transform: scale(0.985); }
        50% { transform: scale(1.015); }
      }
      .cigh-clean-mini-empty {
        color: var(--cigh-text-dim);
        font-size: 9.5px;
        letter-spacing: .06em;
        padding: 4px 0 2px;
      }

      .cigh-clean-comment-log-row {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        column-gap: 6px;
        align-items: start;
        padding: 4px 0 6px;
        border-bottom: 1px solid color-mix(in srgb, var(--cigh-fill) 70%, transparent);
      }
      .cigh-clean-comment-log-time {
        color: var(--cigh-text-dim);
        font-size: calc(9.5px * var(--cigh-ui-font-scale, 1));
        flex: 0 0 auto;
        letter-spacing: .04em;
        line-height: 1.45;
        white-space: nowrap;
      }
      .cigh-clean-comment-log-text {
        color: var(--cigh-text-soft);
        font-size: inherit;
        line-height: 1.45;
        word-break: keep-all;
        overflow-wrap: anywhere;
        min-width: 0;
      }
      .cigh-clean-comment-log-line {
        position: relative;
        display: block;
        padding-left: 10px;
      }
      .cigh-clean-comment-log-line::before {
        content: '';
        position: absolute;
        left: 1px;
        top: .68em;
        width: 3px;
        height: 3px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--cigh-accent) 60%, var(--cigh-text-dim) 40%);
        opacity: .82;
        box-shadow: 0 0 4px color-mix(in srgb, var(--cigh-accent) 28%, transparent);
      }

      .cigh-clean-info-tools {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;
        min-height: 18px;
        margin: -2px 0 5px;
        padding-right: 1px;
      }
      .cigh-clean-user-name-box {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--cigh-text-faint);
        font-size: 8.5px;
        letter-spacing: .08em;
      }
      .cigh-clean-user-name-box span {
        flex: 0 0 auto;
        color: var(--cigh-accent);
        font-weight: 700;
      }
      .cigh-clean-user-name-input {
        flex: 1 1 auto;
        min-width: 0;
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 24%, transparent);
        border-radius: 4px;
        padding: 2px 5px;
        background: color-mix(in srgb, var(--cigh-bg-soft) 88%, transparent);
        color: var(--cigh-text-soft);
        font-size: 9px;
        line-height: 1.2;
        font-family: "Courier New", Consolas, monospace;
        outline: none;
      }
      .cigh-clean-user-name-input:focus {
        border-color: var(--cigh-accent-soft);
        color: var(--cigh-text);
      }

      .cigh-clean-info-reset-btn {
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 38%, transparent);
        border-radius: 4px;
        padding: 2px 7px;
        background: color-mix(in srgb, var(--cigh-bg-soft) 88%, transparent);
        color: var(--cigh-text-soft);
        font-size: 8.5px;
        line-height: 1.2;
        letter-spacing: .08em;
        font-family: "Courier New", Consolas, monospace;
        cursor: pointer;
        opacity: .78;
      }
      .cigh-clean-info-reset-btn:hover {
        opacity: 1;
        color: var(--cigh-accent);
        background: color-mix(in srgb, var(--cigh-accent) 14%, var(--cigh-bg-soft));
      }
      .cigh-clean-confirm-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--cigh-accent) 12%, transparent), transparent 52%),
          rgba(0, 0, 0, .46);
        backdrop-filter: blur(2px);
        font-family: "Courier New", Consolas, monospace;
      }
      .cigh-clean-confirm-backdrop.in-panel {
        position: absolute;
        inset: 0;
        z-index: 48;
        border-radius: inherit;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--cigh-bg) 28%, transparent), color-mix(in srgb, #000 58%, transparent)),
          radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--cigh-accent) 18%, transparent), transparent 55%);
        backdrop-filter: blur(1.5px);
      }
      .cigh-clean-confirm-box {
        position: relative;
        width: min(calc(286px * var(--cigh-ui-font-scale, 1)), calc(100% - 22px));
        padding: calc(8px * var(--cigh-ui-font-scale, 1));
        color: var(--cigh-text);
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--cigh-bg-2) 96%, #fff 4%), var(--cigh-bg)),
          repeating-linear-gradient(0deg, transparent 0 7px, color-mix(in srgb, var(--cigh-accent) 5%, transparent) 7px 8px);
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 48%, var(--cigh-border-soft));
        border-radius: calc(4px * var(--cigh-ui-font-scale, 1));
        box-shadow:
          inset 0 0 0 1px color-mix(in srgb, #fff 6%, transparent),
          inset 0 0 0 2px color-mix(in srgb, #000 24%, transparent),
          0 10px 0 color-mix(in srgb, #000 34%, transparent),
          0 20px 48px rgba(0,0,0,.48);
        box-sizing: border-box;
      }
      .cigh-clean-confirm-box.rpg::before,
      .cigh-clean-confirm-box.rpg::after {
        content: "";
        position: absolute;
        width: calc(5px * var(--cigh-ui-font-scale, 1));
        height: calc(5px * var(--cigh-ui-font-scale, 1));
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 55%, var(--cigh-border-soft));
        background: var(--cigh-bg);
        box-sizing: border-box;
      }
      .cigh-clean-confirm-box.rpg::before {
        left: calc(5px * var(--cigh-ui-font-scale, 1));
        top: calc(5px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-confirm-box.rpg::after {
        right: calc(5px * var(--cigh-ui-font-scale, 1));
        bottom: calc(5px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-confirm-title {
        display: flex;
        align-items: center;
        gap: calc(5px * var(--cigh-ui-font-scale, 1));
        padding: calc(3px * var(--cigh-ui-font-scale, 1)) calc(8px * var(--cigh-ui-font-scale, 1));
        margin-bottom: calc(7px * var(--cigh-ui-font-scale, 1));
        color: var(--cigh-accent);
        font-size: calc(10px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        letter-spacing: .12em;
        background: color-mix(in srgb, var(--cigh-accent) 12%, var(--cigh-bg-3));
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 28%, var(--cigh-border-soft));
        border-radius: calc(3px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-confirm-title-dot {
        color: color-mix(in srgb, var(--cigh-accent) 82%, #fff 18%);
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        line-height: 1;
      }
      .cigh-clean-confirm-panel {
        padding: calc(10px * var(--cigh-ui-font-scale, 1)) calc(8px * var(--cigh-ui-font-scale, 1));
        margin-bottom: calc(8px * var(--cigh-ui-font-scale, 1));
        text-align: center;
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--cigh-bg-soft) 90%, #fff 10%), color-mix(in srgb, var(--cigh-bg-3) 84%, #000 16%));
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 22%, var(--cigh-border-soft));
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, #fff 8%, transparent),
          inset 0 -1px 0 color-mix(in srgb, #000 28%, transparent);
      }
      .cigh-clean-confirm-text {
        font-size: calc(12px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        line-height: 1.45;
        color: var(--cigh-text);
        margin-bottom: calc(7px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-confirm-help {
        color: color-mix(in srgb, var(--cigh-text-soft) 88%, #fff 12%);
        font-size: calc(9.5px * var(--cigh-ui-font-scale, 1));
        line-height: 1.58;
        margin: 0;
      }
      .cigh-clean-confirm-help.sub {
        margin-top: calc(6px * var(--cigh-ui-font-scale, 1));
        color: color-mix(in srgb, var(--cigh-text-soft) 70%, var(--cigh-accent) 30%);
      }
      .cigh-clean-confirm-actions {
        display: flex;
        justify-content: stretch;
        gap: calc(6px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-confirm-btn {
        position: relative;
        flex: 1 1 0;
        min-width: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: calc(4px * var(--cigh-ui-font-scale, 1));
        border: 1px solid var(--cigh-border-soft);
        border-radius: calc(3px * var(--cigh-ui-font-scale, 1));
        padding: calc(6px * var(--cigh-ui-font-scale, 1)) calc(10px * var(--cigh-ui-font-scale, 1));
        background:
          linear-gradient(180deg, color-mix(in srgb, var(--cigh-bg-3) 92%, #fff 8%), var(--cigh-bg-soft));
        color: var(--cigh-text-soft);
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(10px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        letter-spacing: .08em;
        cursor: pointer;
        box-shadow:
          inset 0 1px 0 color-mix(in srgb, #fff 8%, transparent),
          0 2px 0 color-mix(in srgb, #000 34%, transparent);
      }
      .cigh-clean-confirm-btn span {
        position: relative;
        z-index: 1;
      }
      .cigh-clean-confirm-btn:active {
        transform: translateY(1px);
        box-shadow: inset 0 1px 0 color-mix(in srgb, #000 20%, transparent);
      }
      .cigh-clean-confirm-btn.yes {
        color: #fff6e3;
        text-shadow: 0 1px 0 rgba(0,0,0,.28);
        border-color: color-mix(in srgb, var(--cigh-danger) 78%, #000 22%);
        background:
          linear-gradient(180deg, color-mix(in srgb, #ff9f7a 24%, var(--cigh-danger) 76%), color-mix(in srgb, var(--cigh-danger) 88%, #000 12%));
      }
      .cigh-clean-confirm-btn.yes::before {
        content: "◆";
        color: #ffe1b0;
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        line-height: 1;
      }
      .cigh-clean-confirm-btn.no {
        color: var(--cigh-text);
        border-color: color-mix(in srgb, var(--cigh-accent) 34%, var(--cigh-border-soft));
      }
      .cigh-clean-confirm-btn.no::before {
        content: "›";
        color: var(--cigh-accent);
      }

      .cigh-clean-foot {
        min-height: 18px;
        height: auto;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 3px 8px 3px 9px;
        background: var(--cigh-bg-soft);
        border-top: 1px solid var(--cigh-fill);
        box-sizing: border-box;
      }
      .cigh-clean-count {
        flex: 0 0 auto;
        color: var(--cigh-text-dim);
        font-size: 8.5px;
        letter-spacing: .04em;
        margin-left: 0;
      }
      .cigh-clean-ft {
        flex: 1 1 auto;
        min-width: 0;
        color: color-mix(in srgb, var(--cigh-text-soft) 72%, var(--cigh-accent) 28%);
        font-size: 9px;
        letter-spacing: .07em;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        display: block;
        max-width: 100%;
        padding-left: 1px;
        box-sizing: border-box;
        line-height: 1.35;
        overflow-wrap: anywhere;
        word-break: keep-all;
      }

      #${POPUP_ID} {
        position: fixed;
        left: 16px;
        bottom: 128px;
        z-index: 2147483646;
        width: 218px;
        min-height: 20px;
        max-height: none;
        overflow: visible;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 2px;
        background: var(--cigh-bg);
        border: 1px solid var(--cigh-accent-soft);
        border-left: 2px solid var(--cigh-accent);
        border-radius: 5px;
        padding: 7px 10px;
        font-family: "Courier New", Consolas, monospace;
        font-size: 10.5px;
        color: var(--cigh-text);
        line-height: 1.55;
        pointer-events: none;
        box-shadow: var(--cigh-shadow-popup);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity .26s ease, transform .26s ease;
      }
      #${POPUP_ID}.show {
        opacity: 1;
        transform: translateY(0);
      }
      .cigh-clean-popup-line {
        min-height: 1.35em;
        max-height: none;
        overflow: visible;
        opacity: 1;
        transform: translateY(0);
        transition: opacity .26s ease, transform .26s ease, max-height .26s ease;
        word-break: keep-all;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .cigh-clean-popup-line.entering {
        opacity: 0;
        transform: translateY(10px);
      }
      .cigh-clean-popup-line.leaving {
        opacity: 0;
        transform: translateY(-10px);
        max-height: 0;
        overflow: hidden;
      }

      #${COMMENT_POPUP_ID} {
        position: fixed;
        left: 16px;
        bottom: 92px;
        z-index: 2147483647;
        width: 218px;
        min-height: 20px;
        box-sizing: border-box;
        background: var(--cigh-bg);
        border: 1px solid var(--cigh-accent-soft);
        border-left: 2px solid var(--cigh-accent);
        border-radius: 5px;
        padding: 7px 10px;
        font-family: "Courier New", Consolas, monospace;
        color: var(--cigh-text);
        box-shadow: var(--cigh-shadow-popup);
        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;
        transition: opacity .26s ease, transform .26s ease;
      }
      #${COMMENT_POPUP_ID}.show {
        opacity: 1;
        transform: translateY(0);
      }
      .cigh-clean-comment-prefix {
        color: var(--cigh-accent);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .12em;
        margin-bottom: 3px;
      }
      .cigh-clean-comment-text {
        font-size: 10.5px;
        line-height: 1.45;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }

      #${SETTINGS_ID} {
        position: absolute;
        left: 8px;
        right: 8px;
        top: 34px;
        z-index: 120;
        max-height: calc(100% - 44px);
        overflow-y: auto;
        padding: 9px;
        background: var(--cigh-bg);
        border: 1px solid var(--cigh-border);
        border-radius: 6px;
        box-shadow: var(--cigh-shadow-settings);
        scrollbar-width: thin;
        scrollbar-color: var(--cigh-border) transparent;
      }
      #${SETTINGS_ID}::-webkit-scrollbar { width: 3px; }
      #${SETTINGS_ID}::-webkit-scrollbar-thumb { background: var(--cigh-border); }

      .cigh-clean-settings-title {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--cigh-accent);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .12em;
        margin-bottom: 6px;
        cursor: pointer;
        user-select: none;
      }
      .cigh-clean-settings-title:hover {
        color: var(--cigh-accent-2);
      }
      .cigh-clean-settings-title:focus-visible {
        outline: 1px solid var(--cigh-accent-soft);
        outline-offset: 2px;
      }
      .cigh-clean-fold-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        color: var(--cigh-text-soft);
        letter-spacing: 0;
      }
      .cigh-clean-fold-body {
        display: block;
        margin-bottom: 4px;
      }
      .cigh-clean-fold-body.collapsed {
        display: none;
      }
      .cigh-clean-settings-subtitle { margin-top: 8px; }
      #cigh-clean-api-input,
      #cigh-clean-pet-name-input,
      #cigh-clean-style-input,
      #cigh-clean-model-input,
      #cigh-clean-thinking-input,
      #cigh-clean-font-size-input,
      #cigh-clean-provider-input,
      #cigh-clean-firebase-input,
      #cigh-clean-firebase-location-input,
      #cigh-clean-firebase-sdk-input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--cigh-border);
        border-radius: 4px;
        background: var(--cigh-bg);
        color: var(--cigh-text);
        outline: none;
        font: inherit;
      }
      #cigh-clean-api-input,
      #cigh-clean-pet-name-input,
      #cigh-clean-model-input,
      #cigh-clean-thinking-input,
      #cigh-clean-font-size-input,
      #cigh-clean-provider-input,
      #cigh-clean-firebase-location-input,
      #cigh-clean-firebase-sdk-input {
        height: 26px;
        padding: 0 7px;
        font-size: 10.5px;
      }
      #cigh-clean-style-input,
      #cigh-clean-firebase-input {
        resize: vertical;
        padding: 7px;
        font-size: 10px;
        line-height: 1.42;
      }
      #cigh-clean-style-input {
        height: 112px;
      }
      #cigh-clean-firebase-input {
        height: 82px;
      }
      #cigh-clean-api-input:focus,
      #cigh-clean-pet-name-input:focus,
      #cigh-clean-style-input:focus,
      #cigh-clean-provider-input:focus,
      #cigh-clean-firebase-input:focus,
      #cigh-clean-firebase-location-input:focus,
      #cigh-clean-firebase-sdk-input:focus {
        border-color: color-mix(in srgb, var(--cigh-accent) 58%, transparent);
      }
      .cigh-clean-checkrow {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 7px;
        color: var(--cigh-text-soft);
        font-size: 10px;
        user-select: none;
      }
      .cigh-clean-checkrow input {
        accent-color: var(--cigh-accent);
      }
      .cigh-clean-settings-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 4px;
      }
      .cigh-clean-settings-grid label {
        display: grid;
        gap: 3px;
        color: var(--cigh-text-soft);
        font-size: 9.5px;
      }
      .cigh-clean-settings-mini-title {
        margin: 7px 0 4px;
        color: var(--cigh-text-soft);
        font-size: 9.5px;
        letter-spacing: .04em;
      }


      .cigh-clean-usage-summary {
        display: grid;
        gap: 6px;
        margin-top: 2px;
      }
      .cigh-clean-usage-line {
        padding: 7px 8px;
        border: 1px solid var(--cigh-border-soft);
        border-radius: 5px;
        background: var(--cigh-bg-2);
        color: var(--cigh-text);
        font-size: 10px;
        line-height: 1.45;
      }
      .cigh-clean-usage-models {
        display: grid;
        gap: 4px;
      }
      .cigh-clean-usage-model-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        padding: 5px 6px;
        border: 1px solid var(--cigh-border-soft);
        border-radius: 5px;
        background: var(--cigh-bg-3);
        color: var(--cigh-text-soft);
        font-size: 9px;
      }
      .cigh-clean-usage-model-name {
        min-width: 0;
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        color: var(--cigh-text);
      }
      .cigh-clean-usage-model-row b {
        color: var(--cigh-accent);
        font-size: 9.5px;
      }
      .cigh-clean-usage-empty {
        padding: 6px;
        border: 1px dashed var(--cigh-border-soft);
        border-radius: 5px;
        color: var(--cigh-text-faint);
        font-size: 9px;
      }
      .cigh-clean-usage-note {
        margin-top: 7px !important;
      }
      .cigh-clean-settings-row {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .cigh-clean-set-btn {
        flex: 1;
        height: 24px;
        border: 1px solid var(--cigh-border);
        border-radius: 4px;
        background: var(--cigh-bg-3);
        color: var(--cigh-text-soft);
        font: inherit;
        font-size: 10px;
        cursor: pointer;
      }
      .cigh-clean-set-btn.gold {
        color: var(--cigh-accent);
        border-color: var(--cigh-accent-soft);
      }
      .cigh-clean-set-btn.red {
        color: #c55c5c;
        border-color: rgba(197,92,92,.28);
      }
      .cigh-clean-settings-help {
        margin-top: 6px;
        color: var(--cigh-text-faint);
        font-size: 9px;
        line-height: 1.35;
      }


      /* UI SIZE OPTIONS
         small = v1.3.1 기준
         medium = small과 large의 중간
         large = v1.3.4 LARGE UI OVERRIDE 기준 */

      /* small: v1.3.1 기본 UI 유지 + 글씨만 0.3px 정도 살짝 키움 */
      #${PANEL_ID}[data-cigh-font="small"] {
        font-size: 11.3px !important;
      }

      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-ttl { font-size: 10.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-room { font-size: 9.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-x { font-size: 11.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-tab { font-size: 10.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-sh { font-size: 9.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-blbl { font-size: 10.3px !important; }
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-bdim,
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-idetail,
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-mini-empty,
      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-empty {
        font-size: 9.8px !important;
      }

      #${PANEL_ID}[data-cigh-font="small"] .cigh-clean-ft {
        font-size: 9.3px !important;
        padding-left: 1px !important;
      }

      #${POPUP_ID}[data-cigh-font="small"],
      #${COMMENT_POPUP_ID}[data-cigh-font="small"] {
        font-size: 10.8px !important;
      }

      #${POPUP_ID}[data-cigh-font="small"] .cigh-clean-popup-line,
      #${COMMENT_POPUP_ID}[data-cigh-font="small"] .cigh-clean-comment-text {
        font-size: 10.8px !important;
      }

      #${COMMENT_POPUP_ID}[data-cigh-font="small"] .cigh-clean-comment-prefix {
        font-size: 9.3px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="small"] {
        font-size: 11.3px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="small"] .cigh-clean-settings-title {
        font-size: 10.3px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-api-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-pet-name-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-model-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-thinking-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-provider-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-firebase-location-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-firebase-sdk-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-font-size-input,
      #${SETTINGS_ID}[data-cigh-font="small"] .cigh-clean-checkrow,
      #${SETTINGS_ID}[data-cigh-font="small"] .cigh-clean-set-btn {
        font-size: 11.3px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-style-input,
      #${SETTINGS_ID}[data-cigh-font="small"] #cigh-clean-firebase-input {
        font-size: 10.3px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="small"] .cigh-clean-settings-help {
        font-size: 9.3px !important;
      }

      /* medium: v1.3.8 보통보다 전체적으로 1px 정도 작게 */
      #${FAB_ID}[data-cigh-font="medium"] {
        width: 37px !important;
        height: 37px !important;
        font-size: 16px !important;
        border-radius: 7px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] {
        width: 287px !important;
        height: 431px !important;
        font-size: 11.5px !important;
        border-radius: 8px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-head {
        height: 28px !important;
        min-height: 28px !important;
        padding: 0 8px !important;
        gap: 7px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-ttl { font-size: 10px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-room { font-size: 9px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-x {
        font-size: 11.5px !important;
        padding: 0 2px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-tabs {
        height: 28px !important;
        min-height: 28px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-tab { font-size: 10px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-main { padding: 8px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-log-inner { line-height: 1.56 !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-sh {
        font-size: 9.5px !important;
        margin-bottom: 5px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-srow {
        gap: 7px !important;
        padding: 3px 0 !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-sval { max-width: 181px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-blbl {
        font-size: 11.5px !important;
        margin-bottom: 4px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-bdim,
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-idetail,
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-mini-empty,
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-empty {
        font-size: 10px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-heart {
        width: 15px !important;
        height: 15px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-pixelbar { height: 6px !important; }
      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-irow {
        gap: 6px !important;
        padding: 3px 1px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-ico { width: 17px !important; }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-foot {
        height: auto !important;
        min-height: 21px !important;
        padding: 3px 8px !important;
      }

      #${PANEL_ID}[data-cigh-font="medium"] .cigh-clean-ft {
        font-size: 9.5px !important;
        line-height: 1.35 !important;
      }

      #${POPUP_ID}[data-cigh-font="medium"],
      #${COMMENT_POPUP_ID}[data-cigh-font="medium"] {
        width: 247px !important;
        font-size: 11.5px !important;
        padding: 8px 11px !important;
        border-radius: 5px !important;
      }

      #${POPUP_ID}[data-cigh-font="medium"] .cigh-clean-popup-line,
      #${COMMENT_POPUP_ID}[data-cigh-font="medium"] .cigh-clean-comment-text {
        font-size: 11.5px !important;
        line-height: 1.52 !important;
      }

      #${COMMENT_POPUP_ID}[data-cigh-font="medium"] .cigh-clean-comment-prefix {
        font-size: 9px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] {
        padding: 8px !important;
        font-size: 11.5px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] .cigh-clean-settings-title {
        font-size: 10px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-api-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-pet-name-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-model-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-thinking-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-provider-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-firebase-location-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-firebase-sdk-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-font-size-input {
        height: 28px !important;
        font-size: 11.5px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-style-input,
      #${SETTINGS_ID}[data-cigh-font="medium"] #cigh-clean-firebase-input {
        font-size: 10px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] .cigh-clean-checkrow,
      #${SETTINGS_ID}[data-cigh-font="medium"] .cigh-clean-set-btn {
        font-size: 10px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="medium"] .cigh-clean-set-btn { height: 26px !important; }
      #${SETTINGS_ID}[data-cigh-font="medium"] .cigh-clean-settings-help { font-size: 9px !important; }

      /* large: v1.3.4 LARGE UI 기준에서 전체적으로 1px 정도 작게 */
      #${FAB_ID}[data-cigh-font="large"] {
        width: 43px !important;
        height: 43px !important;
        font-size: 19px !important;
        border-radius: 8px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] {
        width: 339px !important;
        height: 519px !important;
        font-size: 15px !important;
        border-radius: 9px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-head {
        height: 39px !important;
        min-height: 39px !important;
        padding: 0 11px !important;
        gap: 8px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-ttl { font-size: 13px !important; }
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-room { font-size: 11px !important; }
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-x {
        font-size: 16px !important;
        padding: 0 3px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-tabs {
        height: 37px !important;
        min-height: 37px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-tab { font-size: 13px !important; }
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-main { padding: 11px !important; }
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-log-inner { line-height: 1.62 !important; }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-sh {
        font-size: 12px !important;
        margin-bottom: 7px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-srow {
        gap: 9px !important;
        padding: 4px 0 !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-sval { max-width: 219px !important; }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-blbl {
        font-size: 14px !important;
        margin-bottom: 5px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-bdim,
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-idetail,
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-mini-empty,
      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-empty {
        font-size: 12px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-heart {
        width: 17px !important;
        height: 17px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-pixelbar { height: 8px !important; }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-irow {
        gap: 8px !important;
        padding: 5px 1px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-ico { width: 21px !important; }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-foot {
        height: auto !important;
        min-height: 27px !important;
        padding: 4px 11px !important;
      }

      #${PANEL_ID}[data-cigh-font="large"] .cigh-clean-ft {
        font-size: 12px !important;
        line-height: 1.35 !important;
      }

      #${POPUP_ID}[data-cigh-font="large"],
      #${COMMENT_POPUP_ID}[data-cigh-font="large"] {
        width: 299px !important;
        font-size: 14px !important;
        padding: 9px 12px !important;
        border-radius: 6px !important;
      }

      #${POPUP_ID}[data-cigh-font="large"] .cigh-clean-popup-line,
      #${COMMENT_POPUP_ID}[data-cigh-font="large"] .cigh-clean-comment-text {
        font-size: 14px !important;
        line-height: 1.55 !important;
      }

      #${COMMENT_POPUP_ID}[data-cigh-font="large"] .cigh-clean-comment-prefix {
        font-size: 11px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] {
        padding: 11px !important;
        font-size: 14px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] .cigh-clean-settings-title {
        font-size: 13px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-api-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-pet-name-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-model-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-thinking-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-provider-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-firebase-location-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-firebase-sdk-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-font-size-input {
        height: 33px !important;
        font-size: 14px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-style-input,
      #${SETTINGS_ID}[data-cigh-font="large"] #cigh-clean-firebase-input {
        font-size: 13px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] .cigh-clean-checkrow,
      #${SETTINGS_ID}[data-cigh-font="large"] .cigh-clean-set-btn {
        font-size: 13px !important;
      }

      #${SETTINGS_ID}[data-cigh-font="large"] .cigh-clean-set-btn { height: 31px !important; }
      #${SETTINGS_ID}[data-cigh-font="large"] .cigh-clean-settings-help { font-size: 11px !important; }

      #${MASCOT_ID} {
        position: fixed;
        z-index: 2147483640;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: max-content;
        max-width: calc(100vw - 12px);
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      #${MASCOT_ID}.grab { cursor: grabbing; }
      #${MASCOT_ID}.grabbed .cigh-clean-mascot-body { animation:cigh-mascot-grabbed 0.38s cubic-bezier(.34,1.56,.64,1);transform-origin:center bottom; }
      #${MASCOT_ID}.carried .cigh-clean-mascot-body { animation:cigh-mascot-carried 0.5s ease-in-out; }
      #${MASCOT_ID}.landed .cigh-clean-mascot-body { animation:cigh-mascot-landed 0.55s cubic-bezier(.36,.07,.19,.97); }
      @keyframes cigh-mascot-grabbed {
        0%   { transform: scale(1,1) translateY(0); }
        40%  { transform: scale(1.15,0.88) translateY(-8px) rotate(-6deg); }
        70%  { transform: scale(0.92,1.1) translateY(-4px) rotate(3deg); }
        100% { transform: scale(1,1) translateY(0) rotate(0deg); }
      }
      @keyframes cigh-mascot-carried {
        0%,100% { transform: rotate(0deg) translateY(0); }
        25%     { transform: rotate(-8deg) translateY(-3px); }
        75%     { transform: rotate(6deg) translateY(-2px); }
      }
      @keyframes cigh-mascot-landed {
        0%   { transform: scale(1.1,0.88) translateY(4px); }
        30%  { transform: scale(0.9,1.14) translateY(-6px); }
        55%  { transform: scale(1.06,0.94) translateY(2px); }
        75%  { transform: scale(0.97,1.04) translateY(-2px); }
        100% { transform: scale(1,1) translateY(0); }
      }
      #${MASCOT_ID}.poke { animation: cigh-clean-mascot-jump 0.42s ease; }
      #${MASCOT_ID}.egg-poke .cigh-clean-mascot-body { animation: cigh-clean-egg-wobble 0.42s ease; }
      #${MASCOT_ID}.cigh-clean-mascot-happy .cigh-clean-pet-svg,
      #${MASCOT_ID}.cigh-clean-mascot-happy .cigh-clean-pet-img-wrap {
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)) drop-shadow(0 0 8px var(--cigh-accent-soft));
      }
      #${MASCOT_ID}.cigh-clean-mascot-scared .cigh-clean-mascot-body {
        animation: cigh-clean-mascot-shiver 0.12s linear infinite;
      }
      #${MASCOT_ID}.cigh-clean-mascot-sad .cigh-clean-mascot-body::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 10px;
        background: rgba(80,150,255,.16);
        pointer-events: none;
        mix-blend-mode: screen;
      }
      .cigh-clean-mascot-body {
        position: relative;
        z-index: 2;
      }
      .cigh-clean-mascot-body .cigh-clean-pet-svg,
      .cigh-clean-mascot-body .cigh-clean-pet-img-wrap {
        image-rendering: pixelated;
        animation: cigh-clean-float 2.4s ease-in-out infinite;
        filter: drop-shadow(0 2px 3px rgba(0,0,0,.35));
      }
      .cigh-clean-mascot-body.is-sleep .cigh-clean-pet-svg,
      .cigh-clean-mascot-body.is-sleep .cigh-clean-pet-img-wrap,
      .cigh-clean-mascot-body [data-cigh-pet-mode="sleep"] {
        animation: cigh-clean-sleep-breathe 2.2s ease-in-out infinite;
        transform-origin: center bottom;
      }
      .cigh-clean-mascot-speech {
        display: none;
        position: absolute;
        left: 50%;
        bottom: calc(100% + 4px);
        transform: translateX(-50%);
        z-index: 4;
        width: max-content;
        min-width: 56px;
        max-width: min(240px, calc(100vw - 24px));
        background: transparent;
        border: 0;
        border-radius: 0;
        padding: 1px 2px;
        font-family: "Courier New", Consolas, monospace;
        font-size: 10px;
        font-weight: 700;
        line-height: 1.25;
        color: var(--cigh-text);
        white-space: normal;
        overflow-wrap: break-word;
        word-break: keep-all;
        text-align: center;
        paint-order: stroke fill;
        -webkit-text-stroke: 0.35px var(--cigh-bg);
        box-shadow: none;
        pointer-events: none;
      }
      .cigh-clean-mascot-speech.show {
        display: block;
        animation: cigh-clean-mascot-speech-pop 0.22s ease;
      }
      @keyframes cigh-clean-mascot-speech-pop {
        0% { opacity: 0; transform: translateX(-50%); }
        100% { opacity: 1; transform: translateX(-50%); }
      }
      .cigh-clean-mascot-fx {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 64px;
        height: 64px;
        transform: translate(-50%, -34%);
        pointer-events: none;
        overflow: visible;
        z-index: 3;
      }
      .cigh-clean-mascot-fx-dot {
        position: absolute;
        width: 5px;
        height: 5px;
        border-radius: 2px;
        background: var(--cigh-accent);
        color: var(--cigh-accent);
        font-family: "Courier New", Consolas, monospace;
        font-size: 10px;
        line-height: 1;
        text-align: center;
        image-rendering: pixelated;
        opacity: 0;
        transform: translate(-50%, -50%);
        animation: cigh-clean-mascot-float-dot var(--dur, 900ms) ease-out forwards;
      }
      .cigh-clean-mascot-fx-dot.heart {
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: #ff9ec4;
        color: #ff9ec4;
      }
      .cigh-clean-mascot-fx-dot.heart:not(:empty) { background: transparent !important; }
      .cigh-clean-mascot-fx-dot.spark,
      .cigh-clean-mascot-fx-dot.flower,
      .cigh-clean-mascot-fx-dot.zzz {
        width: auto;
        height: auto;
        background: transparent !important;
        color: var(--cigh-accent);
        font-size: 11px;
      }
      .cigh-clean-mascot-fx-dot.zzz {
        color: #86c8ff;
        font-family: ui-rounded, "Apple SD Gothic Neo", "Segoe UI Rounded", system-ui, sans-serif;
        font-size: 10px;
        font-weight: 800;
        font-style: italic;
        letter-spacing: .015em;
        transform: translate(-50%, -50%) rotate(-8deg);
      }
      .cigh-clean-mascot-fx-dot.sweat,
      .cigh-clean-mascot-fx-dot.tear {
        width: 5px;
        height: 9px;
        border-radius: 999px 999px 999px 2px;
        background: #9ecbf0;
        box-shadow: 0 0 4px rgba(158,203,240,.45);
      }
      .cigh-clean-mascot-fx-dot.tear { background: #7fb9f0; }
      .cigh-clean-mascot-blush {
        position: absolute;
        top: 39%;
        width: 8px;
        height: 5px;
        border-radius: 999px;
        background: rgba(255,130,178,.55);
        filter: blur(.2px);
        pointer-events: none;
        z-index: 3;
        animation: cigh-clean-mascot-blush 2.5s ease forwards;
      }
      .cigh-clean-mascot-blush.left { left: 23%; }
      .cigh-clean-mascot-blush.right { right: 23%; }
      @keyframes cigh-clean-mascot-jump {
        0%, 100% { transform: translateY(0); }
        40% { transform: translateY(-9px); }
      }
      @keyframes cigh-clean-egg-wobble {
        0%, 100% { transform: rotate(0deg) scale(1); }
        25% { transform: rotate(-5deg) scale(0.995); }
        50% { transform: rotate(4deg) scale(1.005); }
        75% { transform: rotate(-3deg) scale(0.998); }
      }
      @keyframes cigh-clean-mascot-shiver {
        0%, 100% { left: 0; }
        25% { left: -1.5px; }
        50% { left: 1px; }
        75% { left: -1px; }
      }
      @keyframes cigh-clean-mascot-float-dot {
        0% { opacity: 0; transform: translate(-50%, -50%) translate(0, 0) scale(.75); }
        18% { opacity: 1; }
        100% { opacity: 0; transform: translate(-50%, -50%) translate(var(--mx, 0), var(--my, -26px)) scale(1.15); }
      }
      @keyframes cigh-clean-mascot-blush {
        0%, 82% { opacity: .85; }
        100% { opacity: 0; }
      }

      /* ── Achievements / Titles (무테두리 + 셔머) ── */
      .cigh-clean-achv-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: calc(6px * var(--cigh-ui-font-scale, 1));
        margin-top: calc(2px * var(--cigh-ui-font-scale, 1));
      }
      .cigh-clean-achv-card {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: calc(2px * var(--cigh-ui-font-scale, 1));
        padding: calc(8px * var(--cigh-ui-font-scale, 1)) calc(4px * var(--cigh-ui-font-scale, 1)) calc(7px * var(--cigh-ui-font-scale, 1));
        min-height: calc(66px * var(--cigh-ui-font-scale, 1));
        border: 0;
        border-radius: 6px;
        background: var(--cigh-bg-2);
        text-align: center;
        cursor: default;
      }
      .cigh-clean-achv-card.locked,
      .cigh-clean-achv-card.secret {
        background: color-mix(in srgb, var(--cigh-bg-2) 70%, transparent);
        opacity: .72;
      }
      .cigh-clean-achv-card.secret { filter: grayscale(.4); }
      .cigh-clean-achv-rank {
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(8px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        letter-spacing: .08em;
        color: var(--achv-rank-color, var(--cigh-text-faint));
      }
      .cigh-clean-achv-icon { font-size: calc(18px * var(--cigh-ui-font-scale, 1)); line-height: 1.1; }
      .cigh-clean-achv-card.locked .cigh-clean-achv-icon,
      .cigh-clean-achv-card.secret .cigh-clean-achv-icon { filter: grayscale(1); opacity: .55; }
      .cigh-clean-achv-name {
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        line-height: 1.25;
        color: var(--cigh-text);
        word-break: keep-all;
      }
      .cigh-clean-achv-card.locked .cigh-clean-achv-name,
      .cigh-clean-achv-card.secret .cigh-clean-achv-name { color: var(--cigh-text-faint); }
      .cigh-clean-achv-prog {
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(8.5px * var(--cigh-ui-font-scale, 1));
        color: var(--cigh-text-dim);
      }
      .cigh-clean-achv-done {
        font-size: calc(8.5px * var(--cigh-ui-font-scale, 1));
        letter-spacing: .08em;
        color: var(--cigh-good);
      }
      .cigh-clean-achv-card.equipped {
        box-shadow:
          inset 0 0 0 1px var(--cigh-accent),
          0 0 8px var(--cigh-accent-soft);
      }
      .cigh-clean-achv-card.unlocked { cursor: pointer; }
      .cigh-clean-achv-card.unlocked:hover {
        box-shadow: inset 0 0 0 1px var(--cigh-accent-soft);
      }
      .cigh-clean-achv-card.unlocked.equipped:hover {
        box-shadow:
          inset 0 0 0 1px var(--cigh-accent),
          0 0 10px var(--cigh-accent-soft);
      }
      .cigh-clean-achv-shimmer {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        opacity: 0;
        z-index: 1;
      }
      .cigh-clean-achv-card.locked .cigh-clean-achv-shimmer,
      .cigh-clean-achv-card.secret .cigh-clean-achv-shimmer { display: none; }
      .cigh-clean-achv-card.unlocked .cigh-clean-achv-shimmer { opacity: 1; }
      .cigh-clean-achv-shimmer::before {
        content: '';
        position: absolute;
        top: -20%;
        bottom: -20%;
        left: 0;
        width: 45%;
        background: linear-gradient(105deg, transparent 0%, var(--achv-shimmer-color, rgba(255,255,255,.1)) 50%, transparent 100%);
        transform: translateX(-150%) skewX(-16deg);
        will-change: transform;
        animation: cigh-clean-achv-shimmer 3.8s ease-in-out infinite;
      }
      .cigh-clean-achv-card.rank-N   { --achv-shimmer-color: rgba(255,255,255,.10); }
      .cigh-clean-achv-card.rank-R   { --achv-shimmer-color: rgba(120,180,255,.22); }
      .cigh-clean-achv-card.rank-SR  { --achv-shimmer-color: rgba(200,140,255,.32); }
      .cigh-clean-achv-card.rank-SSR { --achv-shimmer-color: rgba(255,200,90,.44); }
      .cigh-clean-achv-rank,
      .cigh-clean-achv-icon,
      .cigh-clean-achv-name,
      .cigh-clean-achv-prog,
      .cigh-clean-achv-done { position: relative; z-index: 2; }
      @keyframes cigh-clean-achv-shimmer {
        0% { transform: translateX(-150%) skewX(-16deg); }
        55%, 100% { transform: translateX(260%) skewX(-16deg); }
      }
      /* PET 탭: 마이룸 아래 칭호·이름 스트립 */
      .cigh-clean-pet-id {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin: 6px 0 2px;
        font-family: "Courier New", Consolas, monospace;
      }
      .cigh-clean-pet-title {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        min-height: calc(16px * var(--cigh-ui-font-scale, 1));
        padding: 1px 7px;
        border-radius: 999px;
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        line-height: 1;
        font-weight: 700;
        letter-spacing: .02em;
        color: var(--cigh-accent);
        background: color-mix(in srgb, var(--cigh-accent) 14%, var(--cigh-bg-3));
        border: 1px solid color-mix(in srgb, var(--cigh-accent) 34%, var(--cigh-border-soft));
        white-space: nowrap;
      }
      .cigh-clean-pet-name {
        display: inline-flex;
        align-items: center;
        min-height: calc(16px * var(--cigh-ui-font-scale, 1));
        font-size: calc(12px * var(--cigh-ui-font-scale, 1));
        line-height: 1;
        font-weight: 700;
        color: var(--cigh-text);
      }
      .cigh-clean-exp-lv {
        display: inline-block;
        margin-right: 6px;
        padding: 0 6px;
        border-radius: 4px;
        font-family: "Courier New", Consolas, monospace;
        font-size: calc(9px * var(--cigh-ui-font-scale, 1));
        font-weight: 700;
        color: var(--cigh-bg);
        background: var(--cigh-accent);
        vertical-align: middle;
      }

      @media (max-width: 520px) {
        #${FAB_ID} { left: 12px; bottom: 76px; }
        #${PANEL_ID} {
          left: 6px !important;
          right: 6px !important;
          bottom: 70px !important;
          top: auto !important;
          width: auto;
        }
        #${POPUP_ID},
        #${COMMENT_POPUP_ID} {
          width: min(218px, calc(100vw - 24px));
        }
      }
    `;

    document.head.appendChild(style);
  }

  // ─────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────
  function init() {
    if (!document.body) {
      requestAnimationFrame(init);
      return;
    }

    buildUI();
    watchThemeMode();
    loadRoomData();
    patchRoute();
    watchAutoAnalyze();
    preloadPetImageFrames();
    schedulePetVisualTick(1200);
    if (isMascotEnabled()) startMascot();

    const room = document.getElementById('cigh-clean-room');
    if (room) room.textContent = roomKey().slice(-22);
  }

  init();
})();

// ==UserScript==
// @name         Univers Scene Painter
// @namespace    univers-scene-painter
// @version      1.0.0
// @description  Crack Scene Painter 유니챗(univers.chat) 포트 - NAI 이미지 생성
// @author       ported from Crack Scene Painter by chyoyam-alt
// @match        https://www.univers.chat/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      aiplatform.googleapis.com
// @connect      *.aiplatform.googleapis.com
// @connect      image.novelai.net
// @connect      api.novelai.net
// @connect      novelai.net
// @connect      *.novelai.net
// @connect      aistudio.googleapis.com
// @connect      *
// @require      https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js
// @require      https://raw.githubusercontent.com/lemonpie601/monkey/raw/univers_scene_painter_core.user.js
// @updateURL    https://gist.githubusercontent.com/chyoyam-alt/f11d82e7a5bdd652c9d2182af5ec3bff/raw/univers_scene_painter_loader.user.js
// @downloadURL  https://gist.githubusercontent.com/chyoyam-alt/f11d82e7a5bdd652c9d2182af5ec3bff/raw/univers_scene_painter_loader.user.js
// @run-at       document-idle
// ==/UserScript==

// 이 로더 스크립트는 univers_scene_painter_core.user.js를 @require로 불러옵니다.
// Gist에 코어 파일을 업로드한 뒤 위 @require URL을 실제 raw URL로 교체하세요.
//
// 또는 코어 파일 전체를 이 스크립트 안에 인라인으로 붙여넣어 단일 파일로 사용할 수 있습니다.

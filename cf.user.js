// ==UserScript==
// @name         클플 자동
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  R2 + KV + Worker Binding > Setup
// @author       Gemini + 나조금
// @match        https://dash.cloudflare.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function() {
    'use strict';

    function injectUI() {
        if (document.getElementById('cf-auto-setup-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'cf-auto-setup-panel';

        panel.style.cssText = `
            position: fixed;
            bottom: 30px;
            right: 30px;
            width: 260px;
            padding: 15px;
            background-color: #ffffff;
            border-radius: 12px;
            border: 1px solid #ddd;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 99999;
            font-family: sans-serif;
        `;

        const savedToken = GM_getValue('cf_ai_api_token', '');

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="color:#f6821f; font-size:15px;">⚡ Workers 세팅기</strong>
                <button id="auto-minimize-btn" style="background:none; border:none; cursor:pointer; font-size:16px;">➖</button>
            </div>
            <div id="auto-setup-content" style="display: flex; flex-direction: column; gap: 8px;">
                <input type="text" id="auto-bucket-name" placeholder="R2 버킷 이름 (소문자/숫자/-/3글자 이상)" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                <input type="text" id="auto-kv-name" placeholder="KV 네임스페이스 (자동_KV)" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                <input type="text" id="auto-worker-name" placeholder="워커 앱 이름(소문자/숫자/-/짧게추천)" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                <input type="password" id="auto-api-token" placeholder="CF API Token" value="${savedToken}" style="padding:8px; border:1px solid #ccc; border-radius:4px; font-size:12px;">
                <button id="auto-start-btn" style="padding:10px; background-color:#0051c3; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; margin-top:5px;">+ Add</button>
                <div id="auto-status" style="font-size:11px; color:#555; margin-top:5px; word-break: keep-all; line-height: 1.4;">상태: 대기 중...</div>
            </div>
        `;

        document.body.appendChild(panel);

        let isMinimized = false;
        document.getElementById('auto-minimize-btn').addEventListener('click', () => {
            isMinimized = !isMinimized;
            document.getElementById('auto-setup-content').style.display = isMinimized ? 'none' : 'flex';
        });

        document.getElementById('auto-start-btn').addEventListener('click', startAutomation);
    }

    const observer = new MutationObserver(() => { injectUI(); });
    observer.observe(document.body, { childList: true, subtree: true });

    async function startAutomation() {
        let rawBucketName = document.getElementById('auto-bucket-name').value.trim();
        let bucketName = rawBucketName.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const kvBaseName = document.getElementById('auto-kv-name').value.trim();
        let rawWorkerName = document.getElementById('auto-worker-name').value.trim();
        let workerName = rawWorkerName.toLowerCase().replace(/[^a-z0-9-]/g, '');
        const apiToken = document.getElementById('auto-api-token').value.trim();
        const statusDiv = document.getElementById('auto-status');

        if (!bucketName || !kvBaseName || !workerName || !apiToken) {
            alert("빈칸을 모두 채워주세요!");
            return;
        }

        if (bucketName.length < 3) {
            alert(`R2 버킷 이름('${bucketName}')이 너무 짧습니다. 3글자 이상으로 지어주세요.`);
            return;
        }

        GM_setValue('cf_ai_api_token', apiToken);

        const kvFullName = `${kvBaseName}_KV`;
        const pathParts = window.location.pathname.split('/');
        const accountId = pathParts[1];

        if (!accountId || accountId.length !== 32) {
            statusDiv.innerText = "오류: URL에서 Account ID를 찾을 수 없습니다.";
            return;
        }

        try {
            statusDiv.innerHTML = `[1/4] R2 버킷(${bucketName}) 확인 중...`;
            try {
                await fetchAPI(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`, 'POST', apiToken, { name: bucketName });
            } catch (err) {
                if (err.status !== 409 && !JSON.stringify(err).includes("already exists")) throw err;
            }

            statusDiv.innerHTML = `[2/4] KV(${kvFullName}) 확인 중...`;
            let kvId = null;
            try {
                const kvResult = await fetchAPI(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, 'POST', apiToken, { title: kvFullName });
                kvId = kvResult.result.id;
            } catch (err) {
                if (err.status === 400 || err.status === 409 || JSON.stringify(err).includes("already exists")) {
                    const listResult = await fetchAPI(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces`, 'GET', apiToken);
                    const existingKV = listResult.result.find(k => k.title === kvFullName);
                    if (existingKV) kvId = existingKV.id;
                    else throw new Error("KV 목록에서 찾을 수 없습니다.");
                } else throw err;
            }

            statusDiv.innerHTML = "[3/4] 워커 배포 및 변수 바인딩 중...";
            await uploadWorkerWithBindings(accountId, apiToken, workerName, bucketName, kvId);

            statusDiv.innerHTML = "[4/4] 라우팅 활성화 중...";
            await fetchAPI(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, 'POST', apiToken, { enabled: true });

            const targetUrl = `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production`;

            statusDiv.innerHTML = `
                <span style="color: green; font-weight: bold;">✅ ${workerName} 생성 완료!</span><br><br>
                <a href="${targetUrl}" target="_blank" style="display:inline-block; padding:6px 10px; background-color:#2c2c2c; color:white; text-decoration:none; border-radius:4px; text-align:center; width:100%; box-sizing:border-box;">👉 설정 페이지 새 창으로 열기</a>
            `;

        } catch (error) {
            statusDiv.innerHTML = `<span style="color:red">오류 발생: 콘솔 확인</span>`;
            console.error("에러 상세:", error);
        }
    }

    function uploadWorkerWithBindings(accountId, apiToken, workerName, bucketName, kvId) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            const metadata = {
                main_module: "worker.js",
                compatibility_date: new Date().toISOString().split('T')[0],
                bindings: [
                    { type: "kv_namespace", name: "KV", namespace_id: kvId },
                    { type: "r2_bucket", name: "AVATARS", bucket_name: bucketName }
                ]
            };
            formData.append("metadata", new File([JSON.stringify(metadata)], "metadata.json", { type: "application/json" }));
            const scriptCode = `export default {\n  async fetch(request, env, ctx) {\n    return new Response("AI Worker is ready! Bindings: AVATARS & KV");\n  }\n};`;
            formData.append("worker.js", new File([scriptCode], "worker.js", { type: "application/javascript+module" }));

            GM_xmlhttpRequest({
                method: "PUT",
                url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`,
                headers: { "Authorization": `Bearer ${apiToken}` },
                data: formData,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) resolve(JSON.parse(response.responseText));
                    else reject({ status: response.status, data: response.responseText });
                },
                onerror: function(err) { reject({ status: 0, data: err }); }
            });
        });
    }

    function fetchAPI(url, method, token, bodyData = null) {
        return new Promise((resolve, reject) => {
            const options = {
                method: method,
                url: url,
                headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
                onload: function(response) {
                    try {
                        const parsed = JSON.parse(response.responseText);
                        if (response.status >= 200 && response.status < 300) resolve(parsed);
                        else reject({ status: response.status, data: parsed });
                    } catch (e) {
                        reject({ status: response.status, data: response.responseText });
                    }
                },
                onerror: function(err) { reject({ status: 0, data: err }); }
            };
            if (bodyData) options.data = JSON.stringify(bodyData);
            GM_xmlhttpRequest(options);
        });
    }

})();

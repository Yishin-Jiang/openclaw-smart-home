# OpenClaw Smart Home Web

React + TypeScript 前端與 Node.js 後端代理。瀏覽器不會取得 Gateway Token；所有聊天與設備操作皆由網站後端送往 OpenClaw，再由 OpenClaw 使用 HA MCP。

## 開發

1. 複製 `.env.example` 為 `.env`，只在後端環境設定 Gateway 與 Home Assistant 憑證；HA Token 也可透過 `HOME_ASSISTANT_TOKEN_FILE` 讀取既有秘密檔。
2. 執行 `npm ci`。
3. 執行 `npm run dev`，Vite 會將 `/api` 代理到本機 Node 後端。

正式模式先執行 `npm run build`，再執行 `npm start`。Node 後端會同時提供 `dist` 靜態檔案與 API。

## API

- `POST /api/chat`：送出訊息並以 SSE 串流回覆。
- `GET /api/chat/:sessionId/history`：讀取網站保存的對話紀錄。
- `GET /api/chat/:sessionId/events`：讀取可觀察的處理事件。
- `POST /api/chat/:sessionId/reset`：建立新的獨立對話 Session。
- `GET /api/health`：檢查後端與 Gateway 連線。
- `GET /api/home/status`：取得正規化後的 HA Area、設備、Entity 與狀態。
- `GET /api/home/areas`：取得 HA Area 與各區設備連線摘要。
- `GET /api/monitor/status`：取得主動感知服務、門檻、監測實體與最近通知狀態（不含秘密）。
- `GET /api/activity`、`DELETE /api/activity[/:id]`：查看或刪除網站使用紀錄。
- `GET /api/preferences`：查看待確認、使用中及停用偏好。
- `POST /api/preferences/candidates`：建立待確認偏好，不會直接生效。
- `POST /api/preferences/:id/confirm`、`PATCH /api/preferences/:id`、`DELETE /api/preferences/:id`：確認、修改、停用或忘記偏好。
- `GET /api/chat/:sessionId/snapshots/:snapshotId`：以短效簽章讀取 OpenClaw 明確回傳的攝影機快照。
- `GET /api/energy`：讀取 P110M 的 HA 即時功率、總累積電量與歷史資料，計算今日／本週／本月用電及趨勢。
- `POST /api/energy/insights`：按需將已由 HA 計算的數值交給 OpenClaw 產生白話摘要；不讓模型計算或捏造數字。

每個瀏覽器的 Session ID 保存於 `localStorage`。後端使用 `user: web:<sessionId>` 讓 OpenClaw 維持同一段對話，並將網站顯示用紀錄寫入 `SESSION_DATA_DIR`。

## 可驗證的執行流程

網站後端只讀取 OpenClaw 工作階段中的 `toolCall` 與 `toolResult`，即時顯示 HA MCP 工具名稱、執行狀態、時間與結果摘要，不會傳送模型的內部思考內容。設備控制要求會依序執行：

1. `GetLiveContext` 取得操作前狀態。
2. 呼叫 Home Assistant 控制工具。
3. 再次呼叫 `GetLiveContext` 驗證。
4. 依驗證結果整理回覆。

若控制工具失敗或缺少事後驗證，流程與最終回覆都會標示未完成，不會把未驗證的操作顯示成成功。

## 攝影機快照

目前 Aqara G350 在 HA 2026.4.4 的 still-image/MJPEG proxy 會回傳 500/空串流；快照 Skill 已改用 HA WebSocket `camera/stream` 取得短效 HLS URL，再由 VM 內受限權限的靜態 FFmpeg 擷取單張 JPEG。FFmpeg 放在 VM 的 Skill 目錄，不會暴露給瀏覽器。

- 「攝影機有連線嗎」只執行 metadata 狀態查詢，不拍攝快照。
- 「客廳現在有人嗎」允許 OpenClaw 取得一張新快照做視覺判讀，但不把照片傳給網站。
- 「取得並顯示最新快照」才會在文字判讀下方顯示照片。
- 網站會將 OpenClaw 產生的新 JPEG 複製到私有暫存區，透過綁定 Session、有效期限與 HMAC 簽章的 URL 提供。
- 快照預設 120 秒失效並定期刪除；無效、竄改或過期網址回傳 403。

## VM 安全邊界

- Gateway 維持 `127.0.0.1:18789`，不直接對 LAN 公開。
- Gateway Token 僅存於權限 `0600` 的 VM 後端環境檔。
- HA Token 由後端讀取既有權限受限的秘密檔，不會傳到瀏覽器。
- 攝影機僅查詢 Entity 連線狀態；狀態 API 不回傳快照或 `entity_picture`。G350 的 HA camera Entity 斷線時可能仍維持 `idle`，因此網站每 60 秒建立一次只取 HLS 清單標頭的連線探測並立即取消；連續探測失敗 5 分鐘才標示連線待確認／通知，不讀取或保存影像。
- 快照回覆不暴露 RTSP、HA Token、VM 檔案路徑或永久公開網址。
- Node 網站服務只監聽 loopback；LAN 流量由 Caddy 反向代理，不直接暴露 Gateway 或 Node Port。
- Caddy 在 `https://<SMART_HOME_HOST>:8443` 提供 HTTPS 與 Basic Auth；對應的 `8080` Port 只負責導向 HTTPS。
- API 使用明確 Origin allowlist；一般 API 每分鐘最多 120 次，聊天與能耗摘要每分鐘最多 12 次。
- `openclaw-smart-home-web.service` 與 `openclaw-smart-home-proxy.service` 為永久 user systemd 服務，均已啟用自動恢復。

## 主動感知

- Node 後端每 15 秒透過既有唯讀 HA API 觀察指定實體；所有通知門檻由固定程式規則判定，不交由模型猜測。
- 燈與 P110M 連續離線 2 分鐘才提醒；攝影機串流連線探測連續失敗 5 分鐘才提醒連線待確認；恢復後需穩定 1 分鐘才發恢復通知。
- 同一離線事件最多提醒 2 次，第二次最快間隔 30 分鐘。重啟狀態保存在權限受限的 `data/monitor-state.json`，避免重複通知。
- P110M 保持開啟 4 小時時只提醒「持續使用中」，不宣稱設備故障或使用者忘記關閉；功率安全仍由 P110M 本身處理。
- 規則只喚醒工具白名單為 `GetLiveContext` 與訊息投遞的 `home-monitor` Agent；它不能控制設備或取得攝影機快照。若要操作，使用者仍須另行送出完整明確指令。
- 通知透過 Gateway loopback Hook 送至 LINE。Hook 使用不同於 Gateway Token 的獨立秘密，且只允許目標 Agent `home-monitor`。

## 輕量記憶與使用紀錄

- 網站使用紀錄保存在 VM 的 `MEMORY_DATA_DIR/activity.json`，預設保留 30 天、最多 1,000 筆；只包含要求摘要、類型、相關 Entity ID、結果與耗時。
- 長期偏好的唯一資料來源為 `MEMORY_DATA_DIR/preferences.json`。網站聊天只有明確的「記住……」句型才建立候選，且使用者必須在卡片或 `/memory` 頁確認後才會啟用。
- 有效偏好會同步至 `USER.md` 的受管理區塊，讓網站、LINE 與 Telegram 共用；原有 `USER.md` 內容會保留。
- 偏好可以修改、停用或完整刪除。修改會保留最多 20 筆本機版本紀錄，刪除時會一併從受管理的 `USER.md` 區塊移除。
- 不接受密碼、Token、憑證、RTSP 網址、攝影機人物或在家狀態等敏感記憶。使用紀錄不保存模型內部思考、憑證或攝影機照片。
- 每次網站聊天都會明示 OpenClaw 不可自行寫入記憶檔；偏好只提供上下文，不能授權控制設備或取得攝影機畫面。

## 能耗頁（第七階段）

- P110M 目前使用 HA 實體 `sensor.smart_wi_fi_plug_dian_li_1`（功率）、`sensor.smart_wi_fi_plug_neng_yuan_1`（累積電量）、`sensor.smart_wi_fi_plug_you_xiao_dian_ya_1`（電壓）與 `sensor.smart_wi_fi_plug_you_xiao_dian_liu_1`（電流）。
- 今日用電由 `total_increasing` 累積電量的歷史差值計算；目前沒有獨立的「今日用電」感測器。
- 本週或本月若歷史資料沒有涵蓋計算起點，API 回傳 `null`，介面顯示 `—`，不會以 0 或原型示意值代替。
- API 回傳 `sources` 與 `traceability`，包含實體 ID、單位、最後更新時間、歷史端點與計算方式，圖表可追溯到 HA。
- 能耗摘要需使用者按下按鈕才呼叫 OpenClaw；頁面數值本身不經模型計算。

## 語音輸入（第八階段）

- 控制中心使用瀏覽器 Web Speech API，以 `zh-TW` 將麥克風語音轉成文字；不新增語音或錄音檔後端端點。
- 使用者可開始、停止或取消錄音，並會看到辨識中、失敗及瀏覽器不支援等狀態。
- 辨識結果會先停在可編輯的確認區，只有按下「確認並送出」才會交給既有 OpenClaw 對話與驗證流程。
- 第一版以最新版 Chrome 或 Edge 為主要支援瀏覽器；透過非 localhost 網址使用時，正式部署需提供 HTTPS 才能穩定取得麥克風權限。

## VM 部署與驗收（第九階段）

- 更新部署可在 Windows PowerShell 執行 `./scripts/deploy-vm.ps1`；它會建置、同步檔案、重新載入服務並執行唯讀煙霧測試。
- 第一次部署前需依 `deploy/README.md` 建立 VM 私密設定；可先執行 `./scripts/deploy-vm.ps1 -ValidateOnly`，只驗證本機輸入與 production build，不連線 VM。
- Caddy 使用內部 CA 為 LAN IP 簽發憑證。第一次從其他電腦存取前，需將部署時匯出的 `deploy/caddy-local-root.crt` 加入該裝置的受信任根憑證；CA 私鑰只保留在 VM。
- VM 秘密檔位於 `~/.config/openclaw-smart-home/`，權限為 `0600`；GitHub 只保存 `.env.example` 與不含秘密的部署模板。
- 固定展示與人工驗收步驟請見 `docs/acceptance-demo.md`。

LAN 第一次啟用需在 VM 互動式執行一次：

```bash
sudo ufw allow from <your-lan-cidr> to any port 8443 proto tcp comment 'OpenClaw Smart Home HTTPS'
sudo ufw status
```

只放行區域網路的 HTTPS Port；不需對外開放 Node 的 `4173`、Gateway 的 `18789` 或 HTTP 導向 Port。請將 `<your-lan-cidr>` 換成實際網段。

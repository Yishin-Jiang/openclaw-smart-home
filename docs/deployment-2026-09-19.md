# OpenClaw VM 部署紀錄

- 部署日期：2026-09-19
- 版本：`f3af7d32f0641a75c5aa57e793bf3df700d0fc47`（PR #1 合併版本）
- 目標：`openclaw-vm`
- 部署目錄：`~/.openclaw/workspace/web`
- G350 Skill：`~/.openclaw/workspace/skills/ha-camera-snapshot`

## 執行結果

已更新網站 dist、server、production dependencies、package metadata、smoke-test，以及七個 G350 Skill 原始檔。保留既有資料目錄、ffmpeg、憑證及服務設定。

VM 無法解析範例的 `homeassistant.local`。新增 Gateway user-service drop-in `~/.config/systemd/user/openclaw-gateway.service.d/90-smart-home-camera.conf`，使用 VM 既有 HA URL 設定 `HA_BASE_URL` 與 `HOME_ASSISTANT_URL`。設定值僅留在 VM。網站與 Gateway 已重新啟動；Proxy 未變更。

## 驗證

- 本機 production build 成功。
- VM production dependencies 安裝成功；六項 G350 單元測試通過。
- 部署後九項唯讀 smoke test 通過。
- Gateway、網站、Proxy 三項服務均 active。
- HTTPS 未登入請求回傳 401，登入保護仍有效；本次未驗證客戶端 CA 信任。
- 部署的 server、dist 與七個 Skill 檔案與暫存版本完全相同。
- 七個既有設定檔（六個環境檔及 Caddyfile）雜湊不變。
- 尚未執行攝影機快照、語音與實體設備控制驗收。
- 未執行 Git push。

## 私有備份與回復

VM 備份位於 `~/.local/share/openclaw-deploy/f3af7d3-20260919/backup.tar`，包含原網站、Skill 與設定，僅限 VM 使用者讀取。不可提交或上傳此備份。

同目錄的 `retired/` 保存切換前 dist、server 與 node_modules。`release/` 保存本次部署來源，`deployed-commit` 記錄版本。

若需回復，先停止網站及 Gateway，從備份還原原網站、Skill 與服務設定，並另外移除本次新增的 `90-smart-home-camera.conf`（解壓舊備份不會自動移除此新增檔）。保留並另行備份部署後新增的 runtime data，不可直接覆寫使用者的新紀錄。最後 daemon-reload、啟動服務並重新執行 smoke test。回復尚未演練。

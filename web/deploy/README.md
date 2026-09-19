# VM 部署前置設定

`scripts/deploy-vm.ps1` 負責更新已完成 bootstrap 的 OpenClaw VM。它不會產生或讀回任何秘密，也不會自動修改 Home Assistant 或實體設備。

## 第一次部署

在 VM 建立 `~/.config/openclaw-smart-home/`，並以權限 `0600` 準備：

- `web.env`：以專案根目錄 `.env.example` 為基礎，填入 VM 的 Gateway／HA 設定。
- `security.env`：以 `security.env.example` 為基礎，設定 Origin 與速率限制。
- `proxy.env`：以 `proxy.env.example` 為基礎，填入 Caddy password hash。
- `proxy.env` 中的 `SMART_HOME_HOST` 可填入 VM 的 LAN DNS 名稱或 IP。
- `Caddyfile`：直接以 `Caddyfile.example` 為基礎；站台位址由 `SMART_HOME_HOST` 注入。

若啟用記憶與主動感知，另依需求準備：

- `memory.env.example` → `memory.env`
- `home-monitor/monitor.env.example` → `monitor.env`
- `home-monitor/hook.env.example` → `hook.env`

真實設定檔只留在 VM 或本機被 Git 忽略的位置，不可提交。

## 本機部署前檢查

此命令只檢查必要檔案並執行 production build，不會連線 VM：

```powershell
./scripts/deploy-vm.ps1 -ValidateOnly
```

## 更新既有 VM

確認 bootstrap 設定已存在後，才執行：

```powershell
./scripts/deploy-vm.ps1 -Target openclaw-vm
```

更新前，請先將 `web/` 與 `skills/ha-camera-snapshot/` 的修改完成本機 commit。腳本只打包指定 HEAD，不部署未提交的工作目錄，也不會 commit 或 push；所有 Git 推送由使用者負責。

正式更新會：

1. 從 HEAD 匯出來源到本機暫存目錄，乾淨安裝依賴、測試、建置。
2. 上傳到 VM 私有 staging 目錄，安裝 production dependencies、再次測試。
3. 備份即將替換的網站程式、依賴與七個攝影機 Skill 檔案，記錄備份 SHA-256 與版本。
4. 停止網站與 Gateway，替換程式後啟動；Proxy 保持原狀。
5. 逐一檢查三項服務與九項 smoke checks。失敗時自動嘗試回復；回復仍失敗則回報 `recovery-required`，阻止繼續疊加部署。

不覆寫 VM 的任何 env、Caddyfile、systemd unit/drop-in、使用者記憶、通知紀錄、Skill cache 或 ffmpeg。本流程要求既有 `90-smart-home-camera.conf` 已完成設定（本專案 2026-09-19 部署已建立）；缺少時停止，不自動猜測 HA 位址。這是更新既有 VM 的工具，不是全新 VM bootstrap 工具。

Smoke test 會讀取健康狀態與頁面資料，HA status 可能觸發串流可達性探測；不控制設備、不要求攝影機快照。測試不是實體設備功能驗收，也沒有涵蓋 HTTPS 憑證信任。

## 回復最近一次更新

使用更新時輸出的部署 ID：

```powershell
./scripts/deploy-vm.ps1 -Target openclaw-vm -Rollback '<部署 ID>'
```

部署 ID 由 12 碼 commit 與 17 碼時間組成。回復使用 VM 留存的原版 runner，先驗證備份，再停止服務、還原受管理程式、啟動並檢查。被替換的新版程式保留在私有 `replaced-*` 目錄，沒有刪除。只允許回復目前最新的一次更新；成功後才將版本指標退回前一筆。

備份位於 `~/.local/share/openclaw-deploy/<部署 ID>/backup.tar`。本機暫存與 VM 備份不自動清理，請留意磁碟容量，勿提交或公開。不同部署由 `flock` 排他鎖保護。

此腳本不套用到 2026-09-19 手動部署留下的舊格式備份；該次回復仍依部署紀錄處理。遇到主機斷電或程序被強制終止，沒有保證自動回復；重新連線後使用同一 ID 的回復命令。

目前只適用**資料格式向後相容**的程式更新。不會倒退部署後產生的使用者資料，也不包含資料庫遷移、OS/Node/OpenClaw 升級或服務設定修改；這類變更需另訂遷移與回復方案。

## 隔離測試

```bash
bash web/scripts/test-deployment.sh
```

從 repository 根目錄執行。測試以暫存目錄與假的 systemctl/npm/health commands 驗證成功切換、回復、資料保留、重複回復拒絕、健康檢查失敗、中途複製失敗、回復失敗後重試及備份損壞。不會連線 VM 或控制正式服務；Linux CI 也會執行。Git Bash 缺少 flock 時會明確標示使用 mock，因此不代表已驗證鎖競爭。

隔離測試不能取代實際 VM 更新／回復演練。`-ValidateOnly` 只跑本機現有依賴的測試與建置，既不執行 clean install，也不宣稱正式部署成功。

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

更新流程會執行乾淨的本機 dependency install、production build、上傳最小 runtime 檔案、在 VM 安裝 production dependencies、重新啟動服務，最後執行唯讀 smoke test。Smoke test 會讀取健康狀態與頁面資料，但不會控制設備。

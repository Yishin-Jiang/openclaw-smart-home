# Git 與可重現部署：第三階段驗證

日期：2026-09-15

## 本階段目標

讓 Windows 工作區中的候選原始碼在不依賴既有 `node_modules`、不夾帶本機秘密與 runtime 資料的前提下，可以產生一致的 production build，並把 VM 更新流程的必要前置條件寫清楚。

## 已補強

- 新增 `.gitattributes`，確保 VM 使用的 shell、Node、systemd 與設定檔維持 LF 換行。
- 部署腳本新增輸入、命令、Target 與遠端路徑檢查。
- 新增 `-ValidateOnly`，可在完全不連線 VM 的情況下驗證本機部署輸入與 production build。
- 正式部署會執行 `npm ci`，並在 VM 使用 `npm ci --omit=dev` 安裝 production dependencies。
- 上傳內容縮小為 `dist/`、`server/`、package metadata 與單一唯讀 smoke-test，不再把整個 `src/`、`scripts/`、`deploy/` 或本機實際設定一併複製到 runtime 目錄。
- 部署路徑固定與 systemd 的 `WorkingDirectory` 一致，避免自訂路徑造成服務部署後無法啟動。
- 補上 `proxy.env`、Hook Token 的安全範例與第一次 bootstrap 文件。

## 安全限制

- 本階段沒有執行 SSH、SCP、VM 服務重啟或設備查詢。
- 本階段沒有 stage、commit 或 push。
- `git push` 保留由使用者本人執行。
- `AGENTS.md` 的既有使用者修改未被納入本階段變更。

## 驗證結果

- `./scripts/deploy-vm.ps1 -ValidateOnly`：通過，沒有進入 SSH／SCP 流程。
- PowerShell 與 G350 Bash 語法檢查：通過。
- 以 55 個 Git 可見的 `web` 候選檔案建立全新臨時目錄，執行 `npm ci --offline`：成功安裝 110 個套件，`npm audit` 回報 0 個已知漏洞。
- 上述乾淨環境執行 `npm run build`：通過。
- 驗證後已移除由本階段建立的臨時測試目錄；正式工作區未被替換。

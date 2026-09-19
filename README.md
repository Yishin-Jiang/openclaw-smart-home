# OpenClaw Smart Home

這個儲存庫保存 OpenClaw 智慧家庭網站、Home Assistant 介面、Aqara G350 專用 Skill、部署範例與驗收文件。真實 Token、VM 環境檔、個人記憶、攝影機影像及 runtime data 不屬於版本控管內容。

## 本機驗證

Windows PowerShell：

```powershell
./scripts/verify-repository.ps1 -Offline
```

此流程會檢查 Git whitespace、高可信秘密格式、忽略邊界、PowerShell／Bash／Node 語法與 G350 重啟邊界測試，並只使用 Git 可見的 `web` 候選檔案建立乾淨 production build。它不會連線 Home Assistant、OpenClaw VM 或控制設備。

只做快速檢查、不重新安裝依賴與 build：

```powershell
./scripts/verify-repository.ps1 -SkipCleanBuild
```

網站開發與 API 說明請見 `web/README.md`；VM bootstrap 請見 `web/deploy/README.md`。

## Git 安全

- 不使用 `git add .`，依 `docs/proposed-stage-plan-2026-09-15.md` 分批加入。
- commit 前檢查 staged diff。
- `git push` 一律由專案使用者本人執行，Codex 不自行推送。

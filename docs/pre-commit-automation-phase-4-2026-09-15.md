# Git 與可重現部署：第四階段自動化驗證

日期：2026-09-15

## 完成內容

- 新增 `scripts/verify-repository.ps1`，把安全掃描、忽略邊界、跨語言語法與乾淨候選建置整合為單一命令。
- 新增 GitHub Actions workflow；使用者將 commit 推送後，由唯讀權限的 Windows runner 自動執行相同驗證。
- 新增儲存庫根目錄 README，標示專案範圍、安全邊界與驗證入口。
- 本機驗證不會連線 HA、OpenClaw VM 或任何實體設備。

## Git 權限邊界

- 本階段沒有 stage、commit 或 push。
- Workflow 只有 `contents: read`，不會改寫儲存庫。
- 所有 `git push` 仍由使用者本人執行。

## 本機驗證結果

- 快速模式 `./scripts/verify-repository.ps1 -SkipCleanBuild`：通過。
- 完整離線模式 `./scripts/verify-repository.ps1 -Offline`：通過。
- 乾淨環境安裝 110 個套件，audit 回報 0 個已知漏洞。
- Git 可見的 55 個網站候選檔案可獨立完成 production build。
- 驗證結束時 staged 檔案數為 0。

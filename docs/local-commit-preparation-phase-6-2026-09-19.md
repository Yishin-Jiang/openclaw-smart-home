# 第六階段：本機 Commit 準備

日期：2026-09-19

## 目標

將前五階段完成的安全規則、G350 Skill、網站原始碼與文件整理為可獨立審查的本機 commits。所有遠端 push 由使用者本人執行。

## 提交前修正

- 私有 VM 稽核 `docs/phase-1-vm-audit-2026-09-11.md` 含實際 LAN 拓撲、VM 使用者與觀測值，已改為只留本機並由 `.gitignore` 排除。
- Git 可見候選中的實際 LAN IP 與寫死的 VM 帳號 home path 已清除。
- 部署路徑改用 SSH 遠端使用者家目錄；Node 與 G350 scripts 使用作業系統 home directory。
- Caddy 範例以 `SMART_HOME_HOST` 注入站台主機，不寫死專案現場 IP。
- G350 與 P110M Entity ID 為本專題必要設備對應，保留在範例與程式中；它們不包含憑證。

## 本機 Commit 分組

1. Repository safety：忽略規則、換行規則、唯讀 CI、自動驗證腳本與根目錄說明。
2. G350 Skill：快照、metadata status 與 HLS helpers。
3. Web application：contracts、前後端、G350 regression tests 與部署範例。
4. Documentation：階段紀錄與提交決策。

## 明確排除

- 根目錄 `AGENTS.md` 的使用者既有修改。
- 私有 VM 稽核、實際 `security.env`、憑證、runtime data、build、依賴與攝影機測試影像。
- 任何 `git push` 操作。
- `design/openclaw-prototype/`：確認為 UI 原型而非私人攝影機畫面，但控制中心仍使用第五階段修正前的 G350「連線正常」示意，待更新成「連線待確認」邊界後再提交。

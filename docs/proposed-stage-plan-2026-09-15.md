# 第二階段 Git 建議納入清單

日期：2026-09-15

本文件只提供人工審查與分批提交建議。目前沒有執行 `git add`、commit 或 push；所有 push 均由使用者本人負責。

## 建議第一批：安全邊界與文件

- `.gitignore`
- `.gitattributes`
- `.github/workflows/verify.yml`
- `README.md`
- `scripts/verify-repository.ps1`
- `web/.gitignore`
- `web/deploy/security.env.example`
- `web/deploy/proxy.env.example`
- `web/deploy/home-monitor/hook.env.example`
- `web/deploy/README.md`
- `docs/git-safety-policy.md`
- `docs/security-inventory-2026-09-15.md`
- `docs/reproducible-deployment-phase-3-2026-09-15.md`
- `docs/pre-commit-automation-phase-4-2026-09-15.md`
- `docs/g350-restart-boundary-phase-5-2026-09-15.md`
- `docs/local-commit-preparation-phase-6-2026-09-19.md`

目的：先固定秘密、攝影機媒體、個人記憶、runtime data、建置輸出與壓縮檔的排除規則。

## 建議第二批：G350 可重現 Skill

- `skills/ha-camera-snapshot/SKILL.md`
- `skills/ha-camera-snapshot/status.sh`
- `skills/ha-camera-snapshot/snapshot.sh`
- `skills/ha-camera-snapshot/hls-url.mjs`
- `skills/ha-camera-snapshot/inspect-capabilities.mjs`
- `skills/ha-camera-snapshot/stream-frame.mjs`
- `skills/ha-camera-snapshot/stream-info.mjs`

這一批已補齊 metadata-only 狀態腳本，並規定 `idle` 不能單獨證明 G350 實體在線。`cache/`、測試快照與本機 ffmpeg 執行檔不得加入。

## 建議第三批：網站與部署原始碼

- `contracts/`
- `web/` 中未被忽略的原始碼、測試、公開資產、lockfile 與 `.env.example`

網站已通過 `npm run build`。實際的 `web/deploy/security.env` 留在本機，只提交 `security.env.example`。

## 暫緩：設計稿

- `design/openclaw-prototype/`

這些 PNG／SVG 已確認是介面原型，不是攝影機畫面；但控制中心仍呈現第五階段修正前的 G350「連線正常」示意。待原型同步成重啟後先顯示「連線待確認」再獨立 commit。

## 暫不納入

- `AGENTS.md`：已有使用者原先的未提交修改，本次未碰觸，應由使用者另外審查。
- `docs/phase-1-vm-audit-2026-09-11.md`：包含實際 VM 使用者、LAN 拓撲與觀測數值，保留本機且已設為 ignored。
- `web/deploy/security.env`：VM 實際設定，已改為 ignored，原檔仍留在本機。
- `.tmp-g350-test.jpg`：私人攝影機測試影像。
- `.tmp-ffmpeg-20260912/`、`tmp/`、`web-stage3.tgz`：暫存、轉圖與舊封存資料。
- `web/data/`、`web/dist/`、`web/node_modules/`：runtime、build 與依賴產物。

## 使用者提交前的最小檢查

```powershell
git status --short --ignored
git diff --cached --stat
git diff --cached
```

請逐批指定路徑加入，避免使用 `git add .`。完成 commit 後，由使用者本人執行 `git push`。

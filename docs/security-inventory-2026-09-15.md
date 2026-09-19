# Git 與可重現部署：第一階段安全盤點

盤點日期：2026-09-15（Asia/Taipei）

> 2026-09-15 第二階段更新：已新增 Git 忽略規則與
> `docs/git-safety-policy.md`，並讓經檢查的 G350 Skill 原始碼可以納入版本控管。
> 臨時影像、封存檔、個人記憶與憑證仍保留在本機且不得提交；本次沒有刪檔、
> stage、commit 或 push。

## 範圍與限制

- 本次只讀取本機 Git 工作區、Git 歷史、忽略規則、部署範本、G350 Skill 與既有壓縮包。
- 沒有連線或控制 Home Assistant、OpenClaw 或任何實體設備。
- 使用者已說明目前只有 HA VM 與 OpenClaw VM 開啟，其餘設備因不在家而主動關閉；本次不把設備離線視為故障，也不執行設備狀態測試。
- 沒有刪除、移動、提交或推送任何既有檔案。
- 系統未安裝 Gitleaks 或 TruffleHog。本次使用不顯示匹配值的高可信格式掃描，提交前仍應使用專用秘密掃描工具再驗證一次。

## 結論摘要

目前沒有發現已提交或待提交內容包含下列高可信秘密格式：

- PEM 私鑰
- OpenAI／Anthropic 類型 API Key
- GitHub Personal Access Token
- JWT
- 寫死的 Bearer Token
- 帳號密碼內嵌於 RTSP URL

Git 歷史、目前工作樹、被忽略的 G350 Skill，以及 `web-stage3.tgz` 內的文字檔均未命中上述格式。

目前仍不適合直接執行 `git add .`。主要原因是工作區包含攝影機測試照片、約 84 MB 的 FFmpeg 暫存依賴、PDF 渲染暫存與舊網站壓縮包；同時正式網站及部署檔尚未納入版本控制，而重建所需的攝影機 Skill 又被整體忽略。

## Git 現況

| 項目 | 數量／狀態 |
|---|---:|
| 已追蹤檔案 | 9 |
| 未追蹤檔案 | 293 |
| 被忽略檔案 | 6,120 |
| 已修改的追蹤檔案 | 1（`AGENTS.md`） |
| 目前分支 | `main` |
| 遠端 | `origin` 已設定 |
| 最近提交 | `fad5fc0`、`61ddb7d` |

未追蹤檔案主要分布：

| 路徑 | 檔案數 | 約略大小 | 初步分類 |
|---|---:|---:|---|
| `.tmp-ffmpeg-20260912/` | 223 | 84,012,228 bytes | 暫存第三方依賴，不應提交 |
| `web/`（含被忽略依賴） | 6,166 | 122,938,045 bytes | 原始碼應提交；`node_modules`／`dist`／資料目錄不提交 |
| `tmp/` | 8 | 1,760,002 bytes | PDF 渲染暫存，不應提交 |
| `design/` | 5 | 516,269 bytes | 可提交，需確認是否保留完整設計輸出 |
| `contracts/` | 2 | 7,806 bytes | 應提交 |
| `docs/` | 原有1份 | 10,025 bytes | 應提交，需先更新過時狀態 |
| `skills/ha-camera-snapshot/` | 6 | 15,701 bytes | 重建所需，但目前被忽略 |
| `.tmp-g350-test.jpg` | 1 | 66,261 bytes | 攝影機測試畫面，不得提交 |
| `web-stage3.tgz` | 1 | 623,664 bytes | 舊網站封裝，建議不提交主分支 |

## 風險清單

### 高：攝影機測試照片位於 Git 工作區

- 檔案：`.tmp-g350-test.jpg`
- 風險：可能包含私人空間畫面。即使沒有 Token，也不應進入 Git、GitHub、Release 或部署包。
- 本次處理：未開啟、未移動、未刪除、未提交。
- 下一階段建議：在 `.gitignore` 明確排除攝影機快照與測試輸出；確認不再需要後，以可復原方式移出工作區或刪除。

### 高：G350 Skill 被 `skills/` 規則整體忽略

- 路徑：`skills/ha-camera-snapshot/`
- 內容：`SKILL.md` 與5個腳本，共6個檔案。
- 秘密掃描：未發現高可信秘密格式或含帳密 RTSP URL。
- 風險：目前 VM 可運作，但只靠 GitHub 無法重建攝影機功能。
- 下一階段建議：不要直接取消整個 `skills/` 忽略規則；應建立明確白名單，只納入去除秘密且確定需要交付的 `ha-camera-snapshot` Skill。

### 中：大量未追蹤檔案容易被一次加入

- `git add .` 目前會碰到293個未追蹤檔案，其中包含暫存、壓縮包與攝影機照片。
- `.tmp-ffmpeg-20260912/` 內有第三方 FFmpeg Windows執行檔及Node依賴，不應成為專案來源。
- `tmp/pdfs/` 是本次PDF檢查產物，不應提交。
- 下一階段建議：先更新忽略規則，再逐目錄使用 `git add <明確路徑>`，不要使用未審查的全量加入。

### 中：網站與部署來源尚未納入Git

- `web/`、`contracts/`、`design/`與`docs/`幾乎全部未追蹤。
- `web/.env.example` 已存在且未被忽略，但也尚未追蹤。
- 部署範本、systemd服務、Caddy設定、`home-monitor` Agent與記憶設定均尚未提交。
- 風險：目前遠端`main`無法代表VM實際運行版本。

### 中：部署腳本目前偏向更新，不是完整首次安裝

- `web/scripts/deploy-vm.ps1` 可以建置、複製檔案、重新啟動服務及執行Smoke Test。
- 它假設SSH別名、OpenClaw、Caddy、Token檔、Hook、Agent與systemd環境已存在。
- `home-monitor`、Gateway Hook、記憶設定及攝影機Skill沒有完整首次安裝／還原流程。
- 風險：新VM或乾淨工作目錄無法只依現有Git內容重建。

### 中：舊封裝檔可能造成版本混淆

- `web-stage3.tgz` 共32個項目，包含舊版`.env.example`與早期網站程式。
- 壓縮包文字內容未命中高可信秘密格式。
- 風險：內容已落後目前網站，若提交或部署可能誤用舊版本。
- 下一階段建議：保留於Git之外的備份位置，或以明確版本與用途存放；不要和目前來源一起加入主分支。

### 低：範本包含私人網段與固定Entity ID

- `web/.env.example`、README、Caddy範本與驗收文件包含`192.168.x.x`、VM路徑與P110M Entity ID。
- 這些不是憑證，對區網本身沒有直接存取能力，但公開GitHub前仍應確認是否接受揭露本機拓撲與設備命名。
- Token、Hook Secret與Snapshot Signing Secret目前使用範例／替換值，未發現實際秘密格式。

### 低：追蹤中的工作區個人化檔案

- Git目前追蹤`AGENTS.md`、`TOOLS.md`與`USER.md`。
- `AGENTS.md`有15行尚未提交的修改，屬既有使用者變更，本次未修改。
- `TOOLS.md`包含私人網段資訊；`USER.md`本次未發現已確認偏好區塊或高可信秘密。
- 公開GitHub前應再次確認這些工作區檔案是否要公開，並避免把VM上由記憶功能產生的真實偏好同步回Git。

## 環境與設定檔檢查

| 檔案 | 目前狀態 | 結論 |
|---|---|---|
| `web/.env.example` | 未追蹤、未忽略 | 應提交；秘密欄位為替換值，私有IP與Entity ID需確認公開範圍 |
| `web/deploy/memory.env.example` | 未追蹤、未忽略 | 應提交 |
| `web/deploy/home-monitor/monitor.env.example` | 未追蹤、未忽略 | 應提交；通知對象為替換值 |
| `web/deploy/security.env` | 未追蹤、已忽略 | VM 實際設定保留本機；版本控管只納入 `security.env.example` |
| `web/deploy/home-monitor/openclaw-config-set.json` | 未追蹤 | 7項設定操作；秘密使用環境替換方式，不應展開成實值後提交 |

## 已確認沒有執行的動作

- 未執行`git add`、`git commit`、`git push`。
- 未刪除或移動任何檔案。
- 未讀取或顯示G350測試照片內容。
- 未連線VM取得Token、攝影機畫面、記憶資料或執行期狀態。
- 未控制燈、插座、攝影機或情境。
- 未將目前設備離線狀態計入故障或測試失敗。

## 第二階段建議入口

1. 更新根目錄與`web/.gitignore`，先排除`.tmp-*`、`tmp/`、攝影機影像、舊壓縮包及執行期資料。
2. 決定`AGENTS.md`、`TOOLS.md`、`USER.md`的公開範圍。
3. 對`skills/ha-camera-snapshot/`建立安全白名單並逐檔複查。
4. 明確加入`web/`、`contracts/`、必要設計與文件，不使用未審查的`git add .`。
5. 安裝或取得Gitleaks後，對工作樹與完整Git歷史再次掃描。
6. 完成首次安裝、備份／還原及乾淨環境重建文件，再進入提交階段。

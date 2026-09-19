# 正式更新與回復腳本：實作與驗證

日期：2026-09-19。

沿用既有 SSH、Git archive、tar、npm、systemd 工具，不另建部署平台、不引入付費服務。更新入口為 `web/scripts/deploy-vm.ps1`，VM 執行器為 `web/scripts/remote-deploy.sh`；詳細操作見 `web/deploy/README.md`。

## 範圍

- 從已提交 HEAD 建置；未提交的部署來源會被阻擋。
- staging 安裝與測試完成後，備份受管理程式、停止服務並切換。
- 更新失敗自動嘗試回復；可用部署 ID 手動回復，備份損壞則拒絕還原。
- 保留使用者資料、VM 設定與密鑰、Skill cache、ffmpeg；不執行資料遷移。
- Gateway 使用目前既有 HA drop-in，不覆蓋服務設定。
- 部署與回復失敗留存狀態、備份及被替換的程式；不自動刪除。

## 本機驗證

- 既有 G350 單元測試：6/6 通過。
- TypeScript 與 Vite production build：通過。
- PowerShell 解析與 Bash 語法：通過。
- 未提交部署來源、無效回復 ID：在 SSH 前阻擋。
- 隔離流程涵蓋正常更新、明確回復、資料與設定保留、拒絕重複回復、健康檢查失敗自動回復、準備失敗不改 runtime、中途複製失敗回復、回復失敗後重試、拒絕損壞備份。

隔離測試使用假的 systemctl/npm/health commands，並不等同 VM 驗收；Git Bash 缺少 flock，測試明確使用 mock，尚未驗證鎖競爭。已新增 Linux CI job，但本機修改尚未推送，沒有宣稱遠端 CI 通過。

## 後續實機演練：已完成

使用者要求下一步後，已建立本機分支 `codex/deployment-rollback` 並執行正式 VM 更新及回復，未執行 Git push，也未操作實體設備。

- 初版 commit：`e7a6baf`；第一次演練 ID：`e7a6baff0e1c-20260919231215814`。
- 第一輪更新與回復各通過 9 項 smoke checks，但額外 tar 比對發現：`umask 077` 使解壓後部分原始權限未保留。依原備份 metadata 還原受管理程式權限，確認內容及權限與原備份一致。
- 修正 commit：`1a79c3e`；回復改用 `tar -xpf`，增加 Linux 原始檔案與目錄權限斷言。
- 在 VM 的私有暫存目錄執行 Linux 隔離測試，全部通過；systemctl/npm/health 為 mock，不接觸正式服務；使用真正 flock，但尚未測試並行鎖競爭。
- 第二輪演練 ID：`1a79c3e2ad73-20260919231457477`。乾淨本機安裝、6 項測試及建置通過，VM production 安裝與 6 項測試通過。
- 第二輪更新與回復各通過 9 項 smoke checks。每次服務剛啟動的第一輪 fetch 曾失敗，重試後通過；不將第一輪失敗隱藏為一次即成功。
- 最後 `tar -df` 同時對照第二輪備份及第一輪原始備份皆通過，受管理程式內容、權限與原始基準一致。
- 網站、Gateway、Proxy 均 active；狀態為 `rolled-back`，版本指標回到原始基準。正式 VM **未停留在演練新版**。
- 從第一輪更新後、回復前取得的既有 env/Caddyfile/Gateway drop-in 雜湊，到兩輪回復完成後一致。並非聲稱已比對第一輪更新前雜湊。
- 正式資料不在備份還原清單內；未為驗證而新增或刪改真實使用者記憶。資料保留情境由隔離測試確認。

私有備份及比對紀錄位於 VM `~/.local/share/openclaw-deploy/<演練 ID>/`；暫存測試與本機 staging 留存，未自動刪除。GitHub CI 仍待使用者推送後執行。

2026-09-19 的原手動部署備份格式不同，不可直接交給新腳本回復。新流程僅適用資料格式向後相容的更新；主機斷電或程序強制終止後可能需要以同一部署 ID 手動回復。

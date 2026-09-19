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

## 尚待實機驗證

本次沒有 SSH、切換 VM 服務、操作設備、Git commit 或 Git push。需要先完成本機 commit，再安排正式腳本的 VM 更新與回復演練。實機演練可能中斷網站及 Gateway，應選合適時段。

2026-09-19 的原手動部署備份格式不同，不可直接交給新腳本回復。新流程僅適用資料格式向後相容的更新；主機斷電或程序強制終止後可能需要以同一部署 ID 手動回復。

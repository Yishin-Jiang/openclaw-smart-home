# 第五階段：G350 重啟邊界回歸測試

日期：2026-09-15

## 修正原因

G350 的 Home Assistant camera entity 在實體攝影機離線後仍可能維持 `idle`。網站服務剛重啟時，記憶體中的串流探測結果尚不存在；舊邏輯會退回 `idle` 並暫時顯示「連線正常」，造成假陽性。

## 新判斷方式

- HA state 為 `unavailable`：顯示離線。
- 串流探測成功：顯示連線正常。
- 服務剛重啟、尚未取得探測結果：顯示連線待確認。
- 第一次探測失敗：仍顯示連線待確認，不採信 `idle`。
- 至少兩次失敗且持續達五分鐘：顯示離線。

此流程只要求取得 HLS manifest 並立即取消 response body，不擷取或保存任何影像。

## 自動測試

`web/server/home-assistant.test.mjs` 覆蓋：

1. 重啟後尚無 probe 結果。
2. probe 成功。
3. 第一次失敗。
4. 重複失敗但尚未達五分鐘。
5. 恰好達五分鐘門檻。
6. HA entity 為 `unavailable`。

測試使用固定的假時間與純函式，不連線 HA、VM、攝影機或其他設備。

## Git 邊界

- 本階段沒有 stage、commit 或 push。
- 所有 `git push` 仍由使用者本人執行。

## 驗證結果

- `npm test`：6 項通過、0 項失敗。
- `./scripts/deploy-vm.ps1 -ValidateOnly`：測試與 production build 通過，沒有進入 SSH／SCP 流程。
- 完整離線 repository verification：通過。
- 56 個 Git 可見網站候選檔可在乾淨臨時目錄安裝、測試及建置。
- 安裝 110 個套件，audit 回報 0 個已知漏洞。

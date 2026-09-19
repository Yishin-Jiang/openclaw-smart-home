export interface FlowStep {
  id: string
  title: string
  detail: string
}

export const flowSteps: FlowStep[] = [
  { id: 'received', title: '收到使用者要求', detail: '網站後端接受並記錄訊息' },
  { id: 'context', title: '取得 Home Assistant 即時狀態', detail: '等待 OpenClaw 呼叫 GetLiveContext' },
  { id: 'action', title: '呼叫情境或設備工具', detail: '等待 OpenClaw 決定是否需要控制設備' },
  { id: 'verify', title: '重新查詢並驗證狀態', detail: '設備操作後必須再次確認結果' },
  { id: 'response', title: '整理並傳回回覆', detail: '只依據可驗證的工具結果完成回覆' },
]

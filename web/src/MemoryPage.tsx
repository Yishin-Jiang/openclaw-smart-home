import { useEffect, useState, type FormEvent } from 'react'
import { Brain, Check, Clock3, Pause, Play, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  clearActivity,
  confirmPreference,
  createPreferenceCandidate,
  deleteActivity,
  deletePreference,
  getActivity,
  getPreferences,
  updatePreference,
  type ActivityRecord,
  type Preference,
  type PreferenceCategory,
} from './memoryApi'

const categories: Array<{ value: PreferenceCategory; label: string }> = [
  { value: 'lighting', label: '燈光' },
  { value: 'energy', label: '用電' },
  { value: 'notification', label: '通知' },
  { value: 'communication', label: '回覆方式' },
  { value: 'general', label: '一般' },
]

const activityLabels: Record<string, string> = {
  query: '狀態查詢', control: '設備操作', snapshot: '攝影機快照',
  'preference-candidate': '偏好候選', 'preference-confirmed': '確認偏好',
}

function dateTime(value: string) {
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

export default function MemoryPage() {
  const [preferences, setPreferences] = useState<Preference[]>([])
  const [activity, setActivity] = useState<ActivityRecord[]>([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [statement, setStatement] = useState('')
  const [category, setCategory] = useState<PreferenceCategory>('general')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const [preferenceResult, activityResult] = await Promise.all([getPreferences(), getActivity()])
      setPreferences(preferenceResult.items)
      setActivity(activityResult.items)
      setRetentionDays(activityResult.retentionDays)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '無法讀取記憶資料')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
      await reload()
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : '操作失敗')
    } finally {
      setBusy(false)
    }
  }

  const addCandidate = (event: FormEvent) => {
    event.preventDefault()
    if (!statement.trim()) return
    void run(async () => {
      await createPreferenceCandidate(statement, category)
      setStatement('')
      setCategory('general')
    })
  }

  const pending = preferences.filter((item) => item.status === 'pending')
  const saved = preferences.filter((item) => item.status !== 'pending')

  return (
    <div className="page page--memory">
      <header className="memory-header">
        <div><p className="breadcrumb">我的家 / 記憶與紀錄</p><h1>由你決定要記住什麼</h1><p>偏好需確認才會生效，也不代表設備控制授權。</p></div>
        <span className="system-pill"><ShieldCheck size={15} /> 本機 VM 儲存</span>
      </header>

      {error && <div className="memory-error" role="alert">{error}</div>}
      {loading ? <div className="panel memory-loading">正在讀取記憶資料…</div> : (
        <div className="memory-layout">
          <div className="memory-main">
            <section>
              <div className="section-heading"><h2>新增偏好</h2></div>
              <form className="panel preference-form" onSubmit={addCandidate}>
                <label htmlFor="preference-statement">想讓 OpenClaw 記住的內容</label>
                <textarea id="preference-statement" value={statement} onChange={(event) => setStatement(event.target.value)} maxLength={200} rows={3} placeholder="例如：晚上調整燈光時，我偏好暖色。" />
                <div className="preference-form__actions">
                  <select value={category} onChange={(event) => setCategory(event.target.value as PreferenceCategory)} aria-label="偏好分類">
                    {categories.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <button className="send-button" disabled={busy || statement.trim().length < 2}><Plus size={16} /> 建立待確認項目</button>
                </div>
              </form>
            </section>

            <section>
              <div className="section-heading"><h2>待確認偏好</h2><span>{pending.length} 項</span></div>
              <div className="preference-list">
                {pending.length === 0 && <div className="panel memory-empty">目前沒有待確認的偏好。</div>}
                {pending.map((item) => (
                  <article className="panel preference-card preference-card--pending" key={item.id}>
                    <div><span className="tag">{categories.find((categoryItem) => categoryItem.value === item.category)?.label}</span><p>{item.statement}</p><small>建立於 {dateTime(item.createdAt)} · 尚未生效</small></div>
                    <div className="preference-card__actions">
                      <button className="send-button" disabled={busy} onClick={() => void run(async () => { await confirmPreference(item.id) })}><Check size={15} /> 確認記住</button>
                      <button className="icon-button" disabled={busy} aria-label="刪除待確認偏好" onClick={() => void run(async () => { await deletePreference(item.id) })}><Trash2 size={17} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <div className="section-heading"><h2>已儲存偏好</h2><span>{saved.filter((item) => item.status === 'active').length} 項使用中</span></div>
              <div className="preference-list">
                {saved.length === 0 && <div className="panel memory-empty">尚未儲存長期偏好。</div>}
                {saved.map((item) => (
                  <article className={`panel preference-card ${item.status === 'inactive' ? 'is-inactive' : ''}`} key={item.id}>
                    <div className="preference-card__body">
                      <span className="tag">{categories.find((categoryItem) => categoryItem.value === item.category)?.label}</span>
                      {editingId === item.id ? (
                        <textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} maxLength={200} rows={2} autoFocus />
                      ) : <p>{item.statement}</p>}
                      <small>{item.status === 'active' ? '使用中' : '已停用'} · 確認於 {item.confirmedAt ? dateTime(item.confirmedAt) : '—'}</small>
                    </div>
                    <div className="preference-card__actions">
                      {editingId === item.id ? <>
                        <button className="text-button" disabled={busy || editingText.trim().length < 2} onClick={() => void run(async () => { await updatePreference(item.id, { statement: editingText }); setEditingId(null) })}><Save size={15} /> 儲存</button>
                        <button className="icon-button" onClick={() => setEditingId(null)} aria-label="取消編輯"><X size={16} /></button>
                      </> : <>
                        <button className="text-button" onClick={() => { setEditingId(item.id); setEditingText(item.statement) }}>修改</button>
                        <button className="icon-button" disabled={busy} title={item.status === 'active' ? '停用' : '啟用'} aria-label={item.status === 'active' ? '停用偏好' : '啟用偏好'} onClick={() => void run(async () => { await updatePreference(item.id, { status: item.status === 'active' ? 'inactive' : 'active' }) })}>{item.status === 'active' ? <Pause size={16} /> : <Play size={16} />}</button>
                        <button className="icon-button" disabled={busy} aria-label="忘記此偏好" onClick={() => { if (window.confirm('確定要忘記這項偏好嗎？')) void run(async () => { await deletePreference(item.id) }) }}><Trash2 size={17} /></button>
                      </>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="memory-side">
            <div className="section-heading"><h2>最近使用紀錄</h2><button className="text-button" disabled={busy || !activity.length} onClick={() => { if (window.confirm('確定要清除全部使用紀錄嗎？偏好不會被刪除。')) void run(clearActivity) }}><Trash2 size={14} /> 清除全部</button></div>
            <article className="panel activity-panel">
              <div className="activity-note"><Clock3 size={16} /><span>保留 {retentionDays} 天；不保存模型思考、Token 或攝影機照片。</span></div>
              {activity.length === 0 && <div className="memory-empty">目前沒有使用紀錄。</div>}
              <ol className="activity-list">
                {activity.map((item) => (
                  <li key={item.id}>
                    <span className={`activity-status is-${item.outcome}`} />
                    <div><strong>{activityLabels[item.type] || item.type}</strong><p>{item.requestSummary}</p>{item.entityIds.length > 0 && <code>{item.entityIds.join(' · ')}</code>}<small>{dateTime(item.createdAt)} · {item.outcome}{item.durationMs !== null ? ` · ${(item.durationMs / 1000).toFixed(1)} 秒` : ''}</small></div>
                    <button className="icon-button" disabled={busy} aria-label="刪除此筆紀錄" onClick={() => void run(async () => { await deleteActivity(item.id) })}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ol>
            </article>
          </aside>
        </div>
      )}
      <div className="memory-boundary"><Brain size={18} /><span>記憶只提供上下文；每次設備操作仍需由你明確提出。</span></div>
    </div>
  )
}

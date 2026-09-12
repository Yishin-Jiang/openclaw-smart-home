import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  ArrowRight,
  Brain,
  Camera,
  Check,
  CircleDot,
  Grid2X2,
  Lightbulb,
  Menu,
  Mic,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  X,
  Zap,
} from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Markdown from 'react-markdown'
import {
  getChatHistory,
  getGatewayHealth,
  getOrCreateSessionId,
  resetChatSession,
  saveSessionId,
  streamChat,
  type ChatMessage,
  type FlowEvent,
} from './chatApi'
import { getHomeStatus, type HomeDevice, type HomeStatus } from './homeApi'
import { flowSteps } from './mockData'
import LiveEnergyPage from './EnergyPage'
import MemoryPage from './MemoryPage'
import { confirmPreference, deletePreference } from './memoryApi'

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <img
        className="brand__mark"
        src="/brand/openclaw-lobster-mascot.png"
        alt=""
        aria-hidden="true"
      />
      {!compact && (
        <span className="brand__copy">
          <strong>OpenClaw</strong>
          <small>SMART HOME ASSISTANT</small>
        </span>
      )}
    </div>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()
  const navItems = [
    { to: '/', label: '控制中心', icon: Grid2X2 },
    { to: '/energy', label: '能耗分析', icon: Zap },
    { to: '/memory', label: '記憶與紀錄', icon: Brain },
  ]

  return (
    <>
      <button
        className={`sidebar-backdrop ${open ? 'is-open' : ''}`}
        aria-label="關閉導覽選單"
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar__top">
          <BrandMark />
          <button className="icon-button sidebar__close" onClick={onClose} aria-label="關閉導覽選單">
            <X size={20} />
          </button>
        </div>

        <nav aria-label="主要導覽">
          <p className="eyebrow">我的智慧家庭</p>
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} onClick={onClose} className={pathname === to ? 'nav-link is-active' : 'nav-link'}>
              <Icon size={21} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="connection-card">
            <span className="status-dot" />
            <strong>OpenClaw 已連線</strong>
          </div>
          <div className="profile-row">
            <span className="avatar">Y</span>
            <span><strong>Yishin 的家</strong><small>專題展示 / Prototype</small></span>
          </div>
        </div>
      </aside>
    </>
  )
}

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-shell">
        <div className="mobile-bar">
          <button className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="開啟導覽選單">
            <Menu size={22} />
          </button>
          <BrandMark compact />
          <span className="status-dot" title="系統正常" />
        </div>
        <Routes>
          <Route path="/" element={<ControlCenter />} />
          <Route path="/energy" element={<LiveEnergyPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function PageHeader({
  eyebrow,
  title,
  description,
  warning,
  homeStatus,
}: {
  eyebrow: string
  title: string
  description: string
  warning?: string
  homeStatus?: HomeStatus | null
}) {
  const homeWarning = homeStatus?.stale ? 'Home Assistant 資料已過期' : undefined
  return (
    <header className={`page-header ${!title && !description ? 'page-header--compact' : ''}`}>
      <div>
        <p className="breadcrumb">{eyebrow}</p>
        {title && <h1>{title}</h1>}
        {description && <p>{description}</p>}
      </div>
      <div className="page-header__meta">
        <span className={warning || homeWarning ? 'system-pill system-pill--warning' : 'system-pill'}>
          <span className="status-dot" />
          {warning ?? homeWarning ?? (homeStatus ? 'Home Assistant 已連線' : '系統正常')}
        </span>
      </div>
    </header>
  )
}

function SystemStrip({ status }: { status: HomeStatus | null }) {
  return (
    <section className="system-strip" aria-label="系統摘要">
      <div><small>連線設備</small><strong>{status?.summary.connected ?? '—'} <span>/ {status?.summary.total ?? '—'} 台</span></strong></div>
      <div><small>HA 實際分區</small><strong>{status?.summary.areas ?? '—'} <span>個分區</span></strong></div>
      <div className={status?.stale ? 'system-strip__verified is-stale' : 'system-strip__verified'}>
        <Check size={15} /> {status?.stale ? '顯示快取資料' : '狀態已同步'}
      </div>
      <time>{status ? new Date(status.updatedAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '讀取中'}</time>
    </section>
  )
}

function DeviceIcon({ kind }: { kind: HomeDevice['kind'] }) {
  const icons = { light: Lightbulb, outlet: PlugZap, camera: Camera }
  const Icon = icons[kind]
  return <span className={`device-icon device-icon--${kind}`}><Icon size={20} strokeWidth={1.7} /></span>
}

function formatDeviceTime(value: string | null) {
  if (!value) return '無更新時間'
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function DevicesPanel({ status, loading, error, onRefresh }: {
  status: HomeStatus | null
  loading: boolean
  error: string
  onRefresh: () => void
}) {
  return (
    <section className="column-section devices-section">
      <div className="section-heading">
        <h2>分區設備</h2>
        <button className="text-button" type="button" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'is-spinning' : ''} /> {loading ? '同步中' : '重新整理'}
        </button>
      </div>
      {error && <div className="home-status-message home-status-message--error">{error}</div>}
      {!status && !error && <div className="panel home-status-message">正在讀取 Home Assistant 實際狀態…</div>}
      {status?.areas.map((area) => {
        const connected = area.devices.filter((device) => device.available).length
        return (
          <article className={`panel area-panel ${status.stale ? 'is-stale' : ''}`} key={area.id}>
            <div className="area-panel__heading">
              <div><h3>{area.name}</h3><p>HA Area ID · {area.id}</p></div>
              <span className="tag">{connected} / {area.devices.length} 台連線</span>
            </div>
            {area.devices.length ? (
              <div className="device-list">
                {area.devices.map((device) => (
                  <div className="device-card" key={device.id}>
                    <DeviceIcon kind={device.kind} />
                    <div className="device-card__content">
                      <strong>{device.name}</strong>
                      <code>{device.entityId ?? '未配置 Entity ID'}</code>
                      <span className={`state state--${device.status}`}>
                        <i /> {device.statusLabel}
                      </span>
                    </div>
                    <time dateTime={device.lastUpdated ?? undefined}>{formatDeviceTime(device.lastUpdated)}</time>
                  </div>
                ))}
              </div>
            ) : <p className="area-panel__empty">此分區目前沒有可顯示的燈具、插座或攝影機。</p>}
            <p className="panel-footnote">最後同步：{formatDeviceTime(status.updatedAt)}{status.stale ? ' · 資料已過期' : ' · 即時資料'}</p>
          </article>
        )
      })}

    </section>
  )
}

interface FlowState {
  title: string
  events: FlowEvent[]
  running: boolean
}

const emptyFlowState: FlowState = { title: '', events: [], running: false }

interface BrowserSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition
type VoiceMode = 'idle' | 'listening' | 'stopping' | 'review' | 'error'

function getSpeechRecognitionConstructor() {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function speechErrorMessage(code: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return '麥克風權限遭拒，請在瀏覽器網站設定中允許麥克風。'
  if (code === 'no-speech') return '沒有辨識到語音，請靠近麥克風後再試一次。'
  if (code === 'audio-capture') return '找不到可用的麥克風，請確認裝置與系統設定。'
  if (code === 'network') return '語音辨識服務暫時無法連線，請稍後再試。'
  return '語音辨識失敗，請再試一次或改用文字輸入。'
}

function latestRunEvents(events: FlowEvent[]) {
  const lastStart = events.findLastIndex((event) => event.step === 'received')
  return lastStart >= 0 ? events.slice(lastStart) : events
}

function messageTime(createdAt: string) {
  return new Date(createdAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function ConversationPanel({ onFlowChange }: { onFlowChange: Dispatch<SetStateAction<FlowState>> }) {
  const [sessionId, setSessionId] = useState(getOrCreateSessionId)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [responding, setResponding] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState('')
  const [gatewayState, setGatewayState] = useState<'checking' | 'connected' | 'misconfigured' | 'unavailable'>('checking')
  const [gatewayDetail, setGatewayDetail] = useState('正在確認 Gateway')
  const [voiceMode, setVoiceMode] = useState<VoiceMode>('idle')
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [memoryCandidate, setMemoryCandidate] = useState<import('./chatApi').MemoryCandidate | null>(null)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceTranscriptRef = useRef('')
  const voiceCancelledRef = useRef(false)
  const messagesPanelRef = useRef<HTMLDivElement | null>(null)
  const speechSupported = Boolean(getSpeechRecognitionConstructor())

  useEffect(() => {
    let cancelled = false
    setLoadingHistory(true)
    getChatHistory(sessionId)
      .then((history) => {
        if (cancelled) return
        setMessages(history.messages)
        const events = latestRunEvents(history.events)
        onFlowChange({ title: history.messages.findLast((message) => message.role === 'user')?.text || '', events, running: false })
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => { cancelled = true }
  }, [sessionId, onFlowChange])

  useEffect(() => {
    getGatewayHealth()
      .then((gateway) => {
        setGatewayState(gateway.state)
        setGatewayDetail(gateway.detail)
      })
      .catch(() => {
        setGatewayState('unavailable')
        setGatewayDetail('網站後端無法連線')
      })
  }, [])

  useEffect(() => () => {
    voiceCancelledRef.current = true
    recognitionRef.current?.abort()
  }, [])

  // Keep the newest user/assistant content visible, including while a streamed
  // reply is appending tokens. The scroll belongs to the conversation panel,
  // so the surrounding page does not jump.
  useEffect(() => {
    const panel = messagesPanelRef.current
    if (!panel) return
    panel.scrollTo({ top: panel.scrollHeight, behavior: responding ? 'auto' : 'smooth' })
  }, [messages, responding, loadingHistory])

  const cancelVoice = () => {
    voiceCancelledRef.current = true
    recognitionRef.current?.abort()
    recognitionRef.current = null
    voiceTranscriptRef.current = ''
    setVoiceTranscript('')
    setVoiceError('')
    setVoiceMode('idle')
  }

  const startVoice = () => {
    if (responding) return
    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      setVoiceMode('error')
      setVoiceError('此瀏覽器不支援語音辨識，請使用最新版 Chrome 或 Edge，或改用文字輸入。')
      return
    }

    voiceCancelledRef.current = false
    voiceTranscriptRef.current = ''
    setVoiceTranscript('')
    setVoiceError('')

    const recognition = new Recognition()
    recognition.lang = 'zh-TW'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event) => {
      let transcript = ''
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript
      }
      voiceTranscriptRef.current = transcript.trim()
      setVoiceTranscript(transcript.trim())
    }
    recognition.onerror = (event) => {
      if (voiceCancelledRef.current && event.error === 'aborted') return
      voiceCancelledRef.current = true
      setVoiceMode('error')
      setVoiceError(speechErrorMessage(event.error))
    }
    recognition.onend = () => {
      recognitionRef.current = null
      if (voiceCancelledRef.current) return
      if (voiceTranscriptRef.current) {
        setVoiceMode('review')
      } else {
        setVoiceMode('error')
        setVoiceError('沒有辨識到語音，請靠近麥克風後再試一次。')
      }
    }
    recognitionRef.current = recognition
    setVoiceMode('listening')

    try {
      recognition.start()
    } catch {
      recognitionRef.current = null
      setVoiceMode('error')
      setVoiceError('無法啟動麥克風，請重新整理頁面後再試。')
    }
  }

  const stopVoice = () => {
    if (!recognitionRef.current) return
    setVoiceMode('stopping')
    recognitionRef.current.stop()
  }

  const sendText = async (candidate: string) => {
    const text = candidate.trim()
    if (!text || responding) return

    const timestamp = new Date().toISOString()
    const assistantId = crypto.randomUUID()
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text, createdAt: timestamp },
      { id: assistantId, role: 'assistant', text: '', createdAt: timestamp },
    ])
    setDraft('')
    setError('')
    setResponding(true)
    onFlowChange({ title: text, events: [], running: true })

    try {
      await streamChat(sessionId, text, {
        onDelta: (delta) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId ? { ...message, text: `${message.text}${delta}` } : message
          )))
        },
        onFlow: (flowEvent) => {
          onFlowChange((current) => ({ ...current, events: [...current.events, flowEvent], running: current.running && flowEvent.status !== 'failed' }))
        },
        onDone: (assistantMessage) => {
          setMessages((current) => current.map((message) => message.id === assistantId ? assistantMessage : message))
        },
        onMemoryCandidate: setMemoryCandidate,
      })
      setGatewayState('connected')
      setGatewayDetail('OpenClaw Gateway 已連線')
    } catch (chatError) {
      const detail = chatError instanceof Error ? chatError.message : 'OpenClaw 執行失敗'
      setError(detail)
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.text))
    } finally {
      setResponding(false)
      onFlowChange((current) => ({ ...current, running: false }))
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void sendText(draft)
  }

  const confirmVoice = () => {
    const text = voiceTranscript.trim()
    if (!text || responding) return
    cancelVoice()
    void sendText(text)
  }

  const reset = async () => {
    if (responding) return
    cancelVoice()
    try {
      const created = await resetChatSession(sessionId)
      saveSessionId(created.sessionId)
      setSessionId(created.sessionId)
      setMessages([])
      setDraft('')
      setError('')
      onFlowChange(emptyFlowState)
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '無法建立新對話')
    }
  }

  return (
    <section className="column-section conversation-section">
      <div className="section-heading">
        <h2>與 OpenClaw 對話</h2>
        <button className="text-button" onClick={reset} disabled={responding}><RotateCcw size={15} /> 建立新對話</button>
      </div>
      <article className="panel conversation-panel">
        <div className="conversation-topbar">
          <span className={`gateway-state gateway-state--${gatewayState}`} title={gatewayDetail}>
            <span className="status-dot" /> {gatewayDetail}
          </span>
          <small>SESSION · {sessionId.slice(0, 8).toUpperCase()}</small>
        </div>
        <div className="messages" aria-live="polite" ref={messagesPanelRef}>
          {loadingHistory && <div className="conversation-empty">正在載入對話紀錄…</div>}
          {!loadingHistory && messages.length === 0 && (
            <div className="conversation-empty">
              <BrandMark compact />
              <strong>想請 OpenClaw 做什麼？</strong>
              <p>用自然語言查詢或控制智慧家庭；送出前不會操作設備。</p>
              <div className="quick-prompts">
                <button type="button" onClick={() => setDraft('查詢客廳目前的設備狀態')}>查詢客廳設備狀態</button>
                <button type="button" onClick={() => setDraft('攝影機目前有連線嗎？不要取得快照')}>確認攝影機連線</button>
                <button type="button" onClick={() => setDraft('取得並顯示客廳攝影機的最新快照')}>取得最新快照</button>
              </div>
            </div>
          )}
          {messages.map((message) => message.role === 'user' ? (
            <div className="message message--user" key={message.id}>
              <small>你 · {messageTime(message.createdAt)}</small>
              <p>{message.text}</p>
            </div>
          ) : (
            <div className="message message--assistant" key={message.id}>
              <div className="assistant-label"><BrandMark compact /><strong>OpenClaw</strong><time>{messageTime(message.createdAt)}</time></div>
              <div className="assistant-answer">
                <div className="assistant-copy"><Markdown>{message.text || ' '}</Markdown></div>
                {message.attachments?.map((attachment) => (
                  <figure className="snapshot" key={attachment.id}>
                    {Date.parse(attachment.expiresAt) > Date.now() ? (
                      <img src={attachment.url} alt={attachment.alt} loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="snapshot__expired"><Camera size={22} /> 快照已依隱私設定自動刪除</div>
                    )}
                    <figcaption>Aqara G350 · 短效快照 · {messageTime(message.createdAt)}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
          {responding && <div className="typing"><span /><span /><span /> OpenClaw 正在整理回覆</div>}
          {error && <div className="conversation-error" role="alert">{error}</div>}
        </div>
        <form className="composer" onSubmit={submit}>
          <div className="composer__box">
            <textarea
              id="chat-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="用自然語言描述你想做的事…"
              rows={3}
            />
            <div className="composer__actions">
              {voiceMode === 'listening' || voiceMode === 'stopping' ? (
                <button
                  type="button"
                  className="icon-button mic-button is-recording"
                  aria-label="停止錄音"
                  title="停止錄音"
                  onClick={stopVoice}
                  disabled={voiceMode === 'stopping'}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="icon-button mic-button"
                  aria-label="開始語音輸入"
                  title={speechSupported ? '開始語音輸入' : '此瀏覽器不支援語音辨識'}
                  onClick={startVoice}
                  disabled={responding}
                >
                  <Mic size={18} />
                </button>
              )}
              <button className="send-button" type="submit" disabled={!draft.trim() || responding}>
                送出 <Send size={17} />
              </button>
            </div>
          </div>
          {(voiceMode === 'listening' || voiceMode === 'stopping') && (
            <div className="voice-panel voice-panel--listening" role="status" aria-live="polite">
              <div className="voice-panel__heading">
                <span className="voice-pulse"><i /><i /><i /></span>
                <div><strong>{voiceMode === 'listening' ? '正在聆聽' : '正在完成辨識'}</strong><small>{voiceMode === 'listening' ? '說完後按下停止按鈕' : '請稍候'}</small></div>
                <button type="button" className="text-button" onClick={cancelVoice}>取消</button>
              </div>
              <p>{voiceTranscript || '開始說話…'}</p>
            </div>
          )}
          {voiceMode === 'review' && (
            <div className="voice-panel voice-panel--review">
              <div className="voice-panel__heading">
                <div><strong>確認辨識文字</strong><small>可修改內容；確認後才會交給 OpenClaw</small></div>
                <button type="button" className="icon-button" onClick={cancelVoice} aria-label="取消語音輸入"><X size={17} /></button>
              </div>
              <label htmlFor="voice-transcript">語音辨識結果</label>
              <textarea
                id="voice-transcript"
                value={voiceTranscript}
                onChange={(event) => {
                  setVoiceTranscript(event.target.value)
                  voiceTranscriptRef.current = event.target.value
                }}
                rows={3}
                autoFocus
              />
              <div className="voice-panel__actions">
                <button type="button" className="text-button" onClick={startVoice}><Mic size={15} /> 重新錄音</button>
                <button type="button" className="send-button" onClick={confirmVoice} disabled={!voiceTranscript.trim() || responding}>
                  確認並送出 <Send size={16} />
                </button>
              </div>
            </div>
          )}
          {voiceMode === 'error' && (
            <div className="voice-panel voice-panel--error" role="alert">
              <div><strong>無法使用語音輸入</strong><p>{voiceError}</p></div>
              <div className="voice-panel__actions">
                <button type="button" className="text-button" onClick={cancelVoice}>關閉</button>
                {speechSupported && <button type="button" className="text-button" onClick={startVoice}><Mic size={15} /> 再試一次</button>}
              </div>
            </div>
          )}
          {memoryCandidate && (
            <div className={`memory-candidate ${memoryCandidate.status === 'active' ? 'is-active' : ''}`}>
              <Brain size={19} />
              <div><strong>{memoryCandidate.status === 'active' ? '已記住' : '要記住這項偏好嗎？'}</strong><p>{memoryCandidate.statement}</p><small>偏好不代表設備控制授權。</small></div>
              {memoryCandidate.status !== 'active' && <div className="memory-candidate__actions">
                <button type="button" className="send-button" disabled={memoryBusy} onClick={async () => {
                  setMemoryBusy(true)
                  try { const result = await confirmPreference(memoryCandidate.id); setMemoryCandidate(result.preference) } catch (memoryError) { setError(memoryError instanceof Error ? memoryError.message : '無法儲存偏好') } finally { setMemoryBusy(false) }
                }}><Check size={15} /> 確認記住</button>
                <button type="button" className="text-button" disabled={memoryBusy} onClick={async () => {
                  setMemoryBusy(true)
                  try { await deletePreference(memoryCandidate.id); setMemoryCandidate(null) } catch (memoryError) { setError(memoryError instanceof Error ? memoryError.message : '無法刪除偏好') } finally { setMemoryBusy(false) }
                }}>不記住</button>
              </div>}
            </div>
          )}
        </form>
      </article>
    </section>
  )
}

function FlowPanel({ flow }: { flow: FlowState }) {
  const hasFailed = flow.events.some((event) => event.status === 'failed')
  const completed = !flow.running && flow.events.some((event) => event.step === 'response' && event.status === 'success')
  const latestEvent = flow.events.at(-1)

  return (
    <section className="column-section flow-section">
      <div className="section-heading"><h2>OpenClaw 處理流程</h2></div>
      <article className="panel flow-panel">
        <div className="flow-panel__heading">
          <div>
            <h3>{flow.title || '等待新的要求'}</h3>
            <p>{latestEvent ? `最近更新 · ${messageTime(latestEvent.createdAt)}` : '送出訊息後顯示執行狀態'}</p>
          </div>
          <span className={hasFailed ? 'tag tag--failed' : flow.running ? 'tag tag--running' : 'tag'}>
            {hasFailed ? '失敗' : flow.running ? '執行中' : completed ? '已完成' : '待命'}
          </span>
        </div>
        <ol className="flow-list">
          {flowSteps.map((step, index) => {
            const stepEvents = flow.events.filter((candidate) => candidate.step === step.id)
            const event = stepEvents.find((candidate) => candidate.status === 'failed') || stepEvents.at(-1)
            const status = event?.status || 'pending'
            const statusLabels = { pending: '等待中', running: '執行中', success: '成功', failed: '失敗', skipped: '略過' }
            return (
              <li key={step.id} className={`is-${status}`}>
                <span className="flow-marker">
                  {status === 'success' ? <Check size={16} /> : status === 'running' ? <CircleDot size={15} /> : status === 'failed' ? <X size={15} /> : index + 1}
                </span>
                <div>
                  <span className="flow-step-meta"><em>{statusLabels[status]}</em>{event && <time>{messageTime(event.createdAt)}</time>}</span>
                  <strong>{event?.label || step.title}</strong>
                  <small>{event?.detail || step.detail}</small>
                </div>
              </li>
            )
          })}
        </ol>
      </article>
      <Link className="energy-peek" to="/energy">
        <span><Zap size={21} /><small>Home Assistant 實測</small></span>
        <strong className="energy-peek__label">能耗分析</strong>
        <span>查看即時與歷史資料 <ArrowRight size={17} /></span>
      </Link>
    </section>
  )
}

function ControlCenter() {
  const [flow, setFlow] = useState<FlowState>(emptyFlowState)
  const [homeStatus, setHomeStatus] = useState<HomeStatus | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState('')

  const refreshHome = () => {
    setHomeLoading(true)
    setHomeError('')
    getHomeStatus()
      .then(setHomeStatus)
      .catch((error) => setHomeError(error instanceof Error ? error.message : '無法讀取 Home Assistant 狀態'))
      .finally(() => setHomeLoading(false))
  }

  useEffect(() => {
    refreshHome()
    const interval = window.setInterval(refreshHome, 30_000)
    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="page page--control">
      <PageHeader
        eyebrow="我的家 / 控制中心"
        title=""
        description=""
        homeStatus={homeStatus}
      />
      <SystemStrip status={homeStatus} />
      <div className="control-grid">
        <DevicesPanel status={homeStatus} loading={homeLoading} error={homeError} onRefresh={refreshHome} />
        <ConversationPanel onFlowChange={setFlow} />
        <FlowPanel flow={flow} />
      </div>
    </div>
  )
}

/* Legacy phase-two energy prototype retained temporarily for diff history only.
function StatCard({ label, value, unit, note, featured = false }: { label: string; value: string; unit: string; note: string; featured?: boolean }) {
  return (
    <article className={`stat-card ${featured ? 'stat-card--featured' : ''}`}>
      <small>{label}</small>
      <strong>{value}<span>{unit}</span></strong>
      <p>{note}</p>
    </article>
  )
}

function EnergyChart({ period }: { period: EnergyPeriod }) {
  const data = energySeries[period]
  const width = 820
  const height = 245
  const padX = 12
  const padY = 18
  const max = Math.max(...data.values) * 1.14
  const pointPairs = data.values.map((value, index) => ({
    x: padX + (index / Math.max(data.values.length - 1, 1)) * (width - padX * 2),
    y: height - padY - (value / max) * (height - padY * 2),
  }))
  const points = pointPairs.map(({ x, y }) => `${x},${y}`).join(' ')
  const areaPoints = `${padX},${height - padY} ${points} ${width - padX},${height - padY}`
  const lastPoint = pointPairs.at(-1) ?? { x: padX, y: height - padY }

  return (
    <div className="chart-wrap">
      <div className="chart-y-labels" aria-hidden="true"><span>高</span><span>中</span><span>低</span><span>0</span></div>
      <svg className="energy-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.label}用電趨勢示意圖`}>
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#65e2bf" stopOpacity="0.24" />
            <stop offset="1" stopColor="#65e2bf" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.1, 0.36, 0.62, 0.88].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid-line" />
        ))}
        <polygon points={areaPoints} fill="url(#chart-fill)" />
        <polyline points={points} className="chart-line" />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="5" className="chart-dot" />
      </svg>
      <div className="chart-x-labels">{data.xLabels.map((label) => <span key={label}>{label}</span>)}</div>
    </div>
  )
}

function EnergyPage() {
  const [period, setPeriod] = useState<EnergyPeriod>('today')
  const selected = energySeries[period]
  const periodDescription = useMemo(() => period === 'today' ? '每小時用電量' : '每日用電量', [period])

  return (
    <div className="page page--energy">
      <PageHeader
        eyebrow="我的家 / 能耗分析"
        title="看懂用電，讓節能有依據。"
        description="以已量測設備為範圍，掌握用電變化與 OpenClaw 的節能協助。"
        warning="示意數據 · 尚未串接"
      />

      <section className="stats-grid" aria-label="能耗摘要">
        <StatCard label="今日累計用電" value="0.42" unit="kWh" note="P110M 量測範圍" featured />
        <StatCard label="本週累計用電" value="3.18" unit="kWh" note="9 / 7 – 9 / 11 · 示意" />
        <StatCard label="目前插座輸出功率" value="0" unit="W" note="P110M 已關閉 · 不含插座自身耗電" />
        <StatCard label="能耗資料覆蓋" value="1" unit="/ 3台" note="其他設備尚無量測資料" />
      </section>

      <div className="energy-grid">
        <div className="energy-main">
          <article className="panel chart-panel">
            <div className="chart-panel__top">
              <div><h2>用電趨勢</h2><p>{periodDescription} · P110M · 單位 kWh</p></div>
              <div className="segmented" aria-label="時間範圍">
                {(Object.keys(energySeries) as EnergyPeriod[]).map((key) => (
                  <button key={key} className={period === key ? 'is-active' : ''} onClick={() => setPeriod(key)}>{energySeries[key].label}</button>
                ))}
              </div>
            </div>
            <div className="chart-summary"><strong>{selected.total} kWh</strong><span>{selected.range}</span></div>
            <EnergyChart period={period} />
            <div className="chart-legend"><span><i /> 已量測用電</span><small>空白時段表示尚未發生或無資料</small></div>
          </article>

          <article className="panel detail-panel">
            <div className="detail-panel__heading"><h2>分區用電明細</h2><span>客廳 · 3 台設備</span></div>
            <div className="energy-table" role="table" aria-label="設備能耗明細">
              <div className="energy-table__row energy-table__header" role="row">
                <span role="columnheader">設備</span><span role="columnheader">目前狀態</span><span role="columnheader">今日用電</span><span role="columnheader">資料狀況</span>
              </div>
              <div className="energy-table__row" role="row">
                <strong role="cell">Tapo P110M 智慧插座</strong><span role="cell">關閉</span><strong role="cell">0.42 kWh</strong><span role="cell" className="available"><i /> 有量測 · 示意</span>
              </div>
              <div className="energy-table__row" role="row">
                <strong role="cell">MOES 智慧燈</strong><span role="cell">關閉</span><span role="cell">—</span><span role="cell">無能耗資料</span>
              </div>
              <div className="energy-table__row" role="row">
                <strong role="cell">Aqara G350 攝影機</strong><span role="cell">待機</span><span role="cell">—</span><span role="cell">無能耗資料</span>
              </div>
            </div>
            <small>缺少量測值的設備顯示「—」，不以 0 kWh 計算。</small>
          </article>
        </div>

        <aside className="energy-side">
          <article className="summary-card">
            <div className="summary-card__brand"><BrandMark compact /><strong>OpenClaw 能耗摘要</strong></div>
            <h2>讓用電數字，<br />變成你看得懂的建議。</h2>
            <p>今天已量測用電為 0.42 kWh。</p>
            <p>你在 14:24 啟用節能模式後，P110M 插座已停止輸出供電。</p>
            <div className="summary-prompt">「今天客廳用了多少電？」</div>
            <Link to="/">回到 OpenClaw 對話 <ArrowRight size={17} /></Link>
          </article>
          <article className="panel coverage-card">
            <h2>這些數字涵蓋哪些設備？</h2>
            <div className="coverage-row"><span>能耗量測覆蓋</span><strong>1 / 3 台</strong></div>
            <div className="progress"><span /></div>
            <p>目前只展示 P110M 插座的量測範圍。不代表全屋總用電，也不包含一般燈具。</p>
            <div className="coverage-note"><strong>原型數據說明</strong><span>正式上線前需確認 HA 能耗實體可用，再串接歷史資料、時間區間與更新時間。</span></div>
          </article>
        </aside>
      </div>
      <PageFooter code="DESKTOP PROTOTYPE 02" note="能耗數據為版型展示，非實際量測" />
    </div>
  )
}

*/
export default function App() {
  return <AppShell />
}

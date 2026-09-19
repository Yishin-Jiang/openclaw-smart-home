import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import Markdown from 'react-markdown'
import { getEnergyData, getEnergyInsight, type EnergyData, type EnergyDevice, type EnergyPeriod } from './energyApi'

const periodKeys: EnergyPeriod[] = ['today', 'week', 'month']
const periodMetricKey: Record<EnergyPeriod, keyof Pick<EnergyDevice, 'todayKwh' | 'weekKwh' | 'monthKwh'>> = {
  today: 'todayKwh',
  week: 'weekKwh',
  month: 'monthKwh',
}

function Brand() {
  return <div className="summary-card__brand"><img className="brand__mark" src="/brand/openclaw-lobster-mascot.png" alt="" /><strong>OpenClaw 能耗摘要</strong></div>
}

function formatEnergy(value: number | null | undefined, decimals = 3) {
  return value == null ? '—' : value.toFixed(decimals)
}

function StatCard({ label, value, unit, note, featured = false }: { label: string; value: string; unit: string; note: string; featured?: boolean }) {
  return <article className={`stat-card ${featured ? 'stat-card--featured' : ''}`}><small>{label}</small><strong>{value}<span>{unit}</span></strong><p>{note}</p></article>
}

function EnergyChart({ data, period }: { data: EnergyData; period: EnergyPeriod }) {
  const trend = data.trends[period]
  const width = 820
  const height = 245
  const padX = 12
  const padY = 18
  const finiteValues = trend.points.map((point) => point.value).filter((value): value is number => value !== null)
  const maxValue = Math.max(...finiteValues, 0.001)
  const points = trend.points.map((point, index) => ({
    x: padX + index / Math.max(trend.points.length - 1, 1) * (width - padX * 2),
    y: point.value === null ? null : height - padY - point.value / maxValue * (height - padY * 2),
  }))
  const segments: string[] = []
  let active: string[] = []
  for (const point of points) {
    if (point.y === null) {
      if (active.length) segments.push(active.join(' '))
      active = []
    } else active.push(`${point.x},${point.y}`)
  }
  if (active.length) segments.push(active.join(' '))
  const labelInterval = Math.max(1, Math.ceil(trend.points.length / 5))
  const xLabels = trend.points.filter((_, index) => index % labelInterval === 0 || index === trend.points.length - 1)

  return <div className="chart-wrap">
    <div className="chart-y-labels" aria-hidden="true">{[maxValue, maxValue * .67, maxValue * .33, 0].map((value, index) => <span key={index}>{value.toFixed(3)}</span>)}</div>
    <svg className="energy-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.periods[period].label}實際用電趨勢圖`}>
      {[.1, .36, .62, .88].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} className="chart-grid-line" />)}
      {segments.map((segment, index) => <polyline key={index} points={segment} className="chart-line" />)}
      {points.filter((point) => point.y !== null).map((point, index) => <circle key={index} cx={point.x} cy={point.y ?? 0} r="4" className="chart-dot" />)}
    </svg>
    <div className="chart-x-labels">{xLabels.map((point) => <span key={point.start}>{point.label}</span>)}</div>
    {!finiteValues.length && <div className="chart-empty">此區間沒有足夠的 HA 歷史資料</div>}
  </div>
}

export default function EnergyPage() {
  const [period, setPeriod] = useState<EnergyPeriod>('today')
  const [energy, setEnergy] = useState<EnergyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [insight, setInsight] = useState('')
  const [insightLoading, setInsightLoading] = useState(false)
  const [insightError, setInsightError] = useState('')

  const groupedDevices = useMemo(() => {
    const groups = new Map<string, EnergyData['devices']>()
    for (const device of energy?.devices || []) groups.set(device.area.name, [...(groups.get(device.area.name) || []), device])
    return [...groups.entries()]
  }, [energy])

  const refresh = () => {
    setLoading(true)
    setError('')
    getEnergyData().then(setEnergy).catch((failure) => setError(failure instanceof Error ? failure.message : '無法讀取能耗資料')).finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    const interval = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const generateInsight = async () => {
    setInsightLoading(true)
    setInsightError('')
    try {
      setInsight((await getEnergyInsight(period)).text)
    } catch (failure) {
      setInsightError(failure instanceof Error ? failure.message : '無法產生摘要')
    } finally {
      setInsightLoading(false)
    }
  }

  const selected = energy?.periods[period]
  const metricKey = periodMetricKey[period]
  const updatedTime = energy?.dataUpdatedAt ? new Date(energy.dataUpdatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '—'

  return <div className="page page--energy">
    <header className="page-header page-header--compact">
      <div><p className="breadcrumb">我的家 / 能耗分析</p></div>
      <div className="page-header__meta"><span className={error || energy?.stale ? 'system-pill system-pill--warning' : 'system-pill'}><span className="status-dot" />{error ? '能耗資料無法讀取' : energy?.stale ? '顯示快取資料' : 'HA 能耗已同步'}</span><small>資料更新於 {updatedTime}</small></div>
    </header>

    <div className="energy-toolbar energy-toolbar--actions"><button className="text-button" type="button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'is-spinning' : ''} />{loading ? '同步中' : '重新整理'}</button></div>
    {error && <div className="home-status-message home-status-message--error">{error}</div>}

    <section className="stats-grid" aria-label="能耗摘要">
      <StatCard label="今日累計用電" value={formatEnergy(energy?.periods.today.value)} unit="kWh" note={energy?.periods.today.complete ? '由累積電量歷史差值計算' : 'HA 歷史資料不足'} featured />
      <StatCard label="本週累計用電" value={formatEnergy(energy?.periods.week.value)} unit="kWh" note={energy?.periods.week.complete ? '週一 00:00 起算' : '區間起點缺少歷史基準值'} />
      <StatCard label="本月累計用電" value={formatEnergy(energy?.periods.month.value)} unit="kWh" note={energy?.periods.month.complete ? '本月 1 日 00:00 起算' : '區間起點缺少歷史基準值'} />
      <StatCard label="目前插座輸出功率" value={energy?.current.powerW == null ? '—' : energy.current.powerW.toFixed(1)} unit="W" note={energy?.sources.power?.entityId || '沒有功率感測器'} />
    </section>

    <div className="energy-grid">
      <div className="energy-main">
        <article className="panel chart-panel">
          <div className="chart-panel__top"><div><h2>用電趨勢</h2><p>{period === 'today' ? '每小時' : '每日'}用電量 · 單位 kWh</p></div><div className="segmented" aria-label="時間範圍">{periodKeys.map((key) => <button key={key} className={period === key ? 'is-active' : ''} onClick={() => { setPeriod(key); setInsight(''); setInsightError('') }}>{energy?.periods[key].label || { today: '今日', week: '本週', month: '本月' }[key]}</button>)}</div></div>
          <div className="chart-summary"><strong>{formatEnergy(selected?.value)} kWh</strong><span>{selected?.complete ? '完整區間' : '歷史資料不足'}</span></div>
          {energy ? <EnergyChart data={energy} period={period} /> : <div className="chart-loading">正在讀取 HA 歷史資料…</div>}
          <div className="chart-legend"><span><i />實際量測用電</span><small>斷線表示該時段缺少歷史基準值</small></div>
        </article>

        <article className="panel detail-panel">
          <div className="detail-panel__heading"><h2>分區與設備明細</h2><span>{energy?.coverage.measured ?? '—'} / {energy?.coverage.total ?? '—'} 台有量測</span></div>
          <div className="energy-table" role="table" aria-label="設備能耗明細">
            <div className="energy-table__row energy-table__header" role="row"><span role="columnheader">設備</span><span role="columnheader">目前狀態</span><span role="columnheader">{selected?.label || '期間'}用電</span><span role="columnheader">資料狀況</span></div>
            {groupedDevices.map(([area, devices]) => <div className="energy-area-group" key={area}><div className="energy-area-label">{area}</div>{devices.map((device) => <div className="energy-table__row" role="row" key={device.id}><span role="cell"><strong>{device.name}</strong><code>{device.entityId}</code></span><span role="cell">{device.state}</span><strong role="cell">{formatEnergy(device[metricKey])}{device[metricKey] == null ? '' : ' kWh'}</strong><span role="cell" className={device.measured ? 'available' : ''}>{device.measured && <i />}{device.measured ? 'HA 感測器' : '無能耗量測'}</span></div>)}</div>)}
          </div>
          <small>缺少量測值的設備顯示「—」，不以 0 kWh 計算。</small>
        </article>
      </div>

      <aside className="energy-side">
        <article className="summary-card">
          <Brand />
          <h2>讓 OpenClaw 解讀<br />HA 的實際量測結果。</h2>
          {insight ? <div className="energy-insight"><Markdown>{insight}</Markdown></div> : <p>摘要不會自動產生，避免每次重新整理都消耗模型額度。數值會由後端先計算，再交給 OpenClaw 說明。</p>}
          {insightError && <div className="conversation-error" role="alert">{insightError}</div>}
          <button className="insight-button" type="button" onClick={generateInsight} disabled={!energy || insightLoading}>{insightLoading ? 'OpenClaw 整理中…' : `產生${selected?.label || '目前'}摘要`}</button>
          <div className="summary-prompt">數值來源：{energy?.traceability.historyEntityId || '讀取中'}</div>
        </article>
        <article className="panel coverage-card">
          <h2>量測範圍與來源</h2>
          <div className="coverage-row"><span>能耗量測覆蓋</span><strong>{energy?.coverage.measured ?? '—'} / {energy?.coverage.total ?? '—'} 台</strong></div>
          <div className="progress"><span style={{ width: energy?.coverage.total ? `${energy.coverage.measured / energy.coverage.total * 100}%` : '0%' }} /></div>
          <p>目前只計入 P110M 感測器，不代表全屋總用電；沒有量測的設備顯示「—」。</p>
          <div className="electrical-readings"><span>累積電量<strong>{formatEnergy(energy?.current.energyTotalKwh)} kWh</strong></span><span>有效電壓<strong>{energy?.current.voltageV == null ? '—' : `${energy.current.voltageV.toFixed(2)} V`}</strong></span><span>有效電流<strong>{energy?.current.currentA == null ? '—' : `${energy.current.currentA.toFixed(3)} A`}</strong></span></div>
          <div className="coverage-note"><strong>計算與追溯</strong><span>{energy?.traceability.calculation || '正在讀取計算方式'}</span><code>{energy?.traceability.historyEntityId || '—'}</code><span>{energy?.traceability.dedicatedTodaySensorAvailable ? 'HA 有獨立今日用電感測器' : 'HA 無獨立今日用電感測器，改由累積值計算'}</span></div>
        </article>
      </aside>
    </div>
  </div>
}

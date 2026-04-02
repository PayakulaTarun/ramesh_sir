import React, { useState, useEffect, useRef } from 'react'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

const STATUSES = ['AFC', 'IFC', 'IFA', 'IFR', 'IDC', 'DUE']
const SC = { AFC: '#00d4aa', IFC: '#4c9aff', IFA: '#ffb020', IFR: '#ff8c42', IDC: '#a78bfa', DUE: '#ff5c5c' }
const SHORTS = { PROCESS: 'PRC', EQUIPMENT: 'EQP', PIPING: 'PIP', 'FIRE PROTECTION': 'FPR', CIVIL: 'CIV', STRUCTURAL: 'STR', ELECTRICAL: 'ELC', INSTRUMENTATION: 'INS', PROJECTS: 'PRJ', HSE: 'HSE' }

const pctColor = v => v >= 75 ? 'var(--accent)' : v >= 50 ? 'var(--amber)' : 'var(--red)'
const pctBg = v => v >= 75 ? 'rgba(0,212,170,.12)' : v >= 50 ? 'rgba(255,176,32,.12)' : 'rgba(255,92,92,.12)'

function App() {
  const [data, setData] = useState([])
  const [dci, setDCI] = useState([])
  const [config, setConfig] = useState({})
  const [snapshots, setSnapshots] = useState([])
  const [dbInfo, setDbInfo] = useState({})
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedDiscs, setSelectedDiscs] = useState(new Set())
  const [focusDisc, setFocusDisc] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [notification, setNotification] = useState({ message: '', type: 'success', visible: false })
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0])
  const [inputData, setInputData] = useState({
    discipline: '', docNum: '', docDesc: '', subFormat: '', approvalCat: '', 
    weitage: 0, initSchedule: '', latestRev: '', latestStatus: 'DUE', remarks: ''
  })
  const [searchTerm, setSearchTerm] = useState('')
  
  const chartRefs = {
    bar: useRef(null),
    pie: useRef(null),
    wt: useRef(null),
    radar: useRef(null),
    trend: useRef(null)
  }
  const chartInstances = useRef({})

  const notify = (message, type = 'success') => {
    setNotification({ message, type, visible: true })
    setTimeout(() => setNotification(prev => ({ ...prev, visible: false })), 3000)
  }

  const fetchAll = async () => {
    try {
      const [sumRes, confRes, snapRes, dbRes] = await Promise.all([
        fetch('/api/summary').then(r => r.json()),
        fetch('/api/config').then(r => r.json()),
        fetch('/api/snapshots').then(r => r.json()),
        fetch('/api/db_info').then(r => r.json())
      ])
      setData(sumRes)
      setConfig(confRes)
      setSnapshots(snapRes)
      setDbInfo(dbRes)
    } catch (err) {
      notify('Failed to load data', 'error')
    }
  }

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    if (activeTab === 'overview' || activeTab === 'analytics' || activeTab === 'history') {
      renderCharts()
    }
    if (activeTab === 'deliverables' && dci.length === 0) {
      loadDCI()
    }
  }, [activeTab, data, snapshots, selectedDiscs])

  const refreshData = async () => {
    await fetch('/api/refresh_summary', { method: 'POST' }).then(r => r.json())
    const res = await fetch('/api/summary').then(r => r.json())
    setData(res)
    notify('Refreshed from output DB')
  }

  const reimportFromInput = async () => {
    const r = await fetch('/api/reimport', { method: 'POST' }).then(r => r.json())
    const res = await fetch('/api/summary').then(r => r.json())
    setData(res)
    notify(r.message || 'Done')
  }

  const saveSnapshot = async () => {
    if (!reportDate) { notify('Set date first', 'error'); return }
    const r = await fetch('/api/save_snapshot', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: reportDate }) 
    }).then(r => r.json())
    const snaps = await fetch('/api/snapshots').then(r => r.json())
    setSnapshots(snaps)
    notify(`Week ${r.week} snapshot saved`)
  }

  const updateDCIStatus = async (docNum, newStatus) => {
    await fetch('/api/update_status', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docNum, newStatus }) 
    }).then(r => r.json())
    const res = await fetch('/api/summary').then(r => r.json())
    setData(res)
    notify(`${docNum} → ${newStatus}`)
    if (focusDisc) loadDCI(focusDisc)
  }

  const loadDCI = async (disc = '', status = '', cat = '') => {
    let u = '/api/dci?';
    if (disc) u += `discipline=${encodeURIComponent(disc)}&`;
    if (status) u += `status=${encodeURIComponent(status)}&`;
    if (cat) u += `category=${encodeURIComponent(cat)}&`;
    const res = await fetch(u).then(r => r.json())
    setDCI(res)
  }

  const handleDCIFilterChange = () => {
    const disc = document.getElementById('dciDiscFilter')?.value || ''
    const status = document.getElementById('dciStatusFilter')?.value || ''
    const cat = document.getElementById('dciCatFilter')?.value || ''
    loadDCI(disc, status, cat)
  }

  const saveEdits = async () => {
    const inputs = document.querySelectorAll('.edit-input')
    for (const inp of inputs) {
      const d = inp.dataset.disc
      const s = inp.dataset.status
      const v = parseInt(inp.value) || 0
      const original = data.find(x => x.name === d)
      if (original && original[s] !== v) {
        await fetch('/api/update_summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discipline: d, status: s, value: v })
        }).then(r => r.json())
      }
    }
    setEditMode(false)
    const res = await fetch('/api/summary').then(r => r.json())
    setData(res)
    notify('Saved to output Excel')
  }

  const handleInputSubmit = async (e) => {
    e.preventDefault()
    
    // Validation
    const required = [
      { key: 'discipline', label: 'Discipline' },
      { key: 'docNum', label: 'Document Number' },
      { key: 'docDesc', label: 'Description' },
      { key: 'initSchedule', label: 'Initial Schedule' }
    ];

    for (const field of required) {
      if (!inputData[field.key] || inputData[field.key].toString().trim() === '') {
        notify(`Please fill the ${field.label} field!`, 'error');
        return;
      }
    }

    const res = await fetch('/api/add_dci', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputData)
    }).then(r => r.json())
    
    if (res.success) {
      notify('New deliverable added successfully!')
      setInputData({
        discipline: '', docNum: '', docDesc: '', subFormat: '', approvalCat: '', 
        weitage: 0, initSchedule: '', latestRev: '', latestStatus: 'DUE', remarks: ''
      })
      fetchAll()
      setActiveTab('deliverables')
    } else {
      notify('Failed to add deliverable', 'error')
    }
  }

  const handleDeleteDCI = async (docNum) => {
    if (!window.confirm(`Are you sure you want to delete ${docNum}?`)) return
    const res = await fetch('/api/delete_dci', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docNum })
    }).then(r => r.json())
    
    if (res.success) {
      notify('Deliverable deleted')
      fetchAll()
      if (focusDisc) loadDCI(focusDisc)
      else if (activeTab === 'deliverables') handleDCIFilterChange()
    } else {
      notify('Delete failed', 'error')
    }
  }

  const deleteSnapshot = async (dateId) => {
    if (!window.confirm(`Delete snapshot from ${dateId}?`)) return
    const res = await fetch('/api/delete_snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateId })
    }).then(r => r.json())
    if (res.success) {
      notify('Snapshot deleted')
      const snaps = await fetch('/api/snapshots').then(r => r.json())
      setSnapshots(snaps)
    } else {
      notify('Delete failed', 'error')
    }
  }

  const getFiltered = () => {
    let d = data
    if (selectedDiscs.size > 0) d = d.filter(x => selectedDiscs.has(x.name))
    return d
  }

  const computeTotals = (filteredData) => {
    const d = filteredData || getFiltered()
    const t = { docs: 0, wt: 0, ew: 0, status: {} }
    STATUSES.forEach(s => t.status[s] = 0)
    d.forEach(r => {
      t.docs += r.total
      t.wt += r.plannedWtg
      t.ew += r.earnedWtg
      STATUSES.forEach(s => t.status[s] += (r[s] || 0))
    })
    t.pct = t.wt > 0 ? (t.ew / t.wt * 100) : 0
    t.approved = t.status.AFC + t.status.IFC
    t.inProg = t.status.IFA + t.status.IFR + t.status.IDC
    t.pending = t.status.DUE
    return t
  }

  const destroyChart = (id) => {
    if (chartInstances.current[id]) {
      chartInstances.current[id].destroy()
      chartInstances.current[id] = null
    }
  }

  const renderCharts = () => {
    const f = getFiltered()
    const t = computeTotals(f)
    const sorted = [...f].sort((a, b) => b.total - a.total)

    // Bar Chart
    if (chartRefs.bar.current) {
      destroyChart('bar')
      chartInstances.current.bar = new Chart(chartRefs.bar.current, {
        type: 'bar',
        data: {
          labels: sorted.map(d => SHORTS[d.name] || d.name.slice(0, 3)),
          datasets: STATUSES.map(s => ({
            label: s,
            data: sorted.map(d => d[s] || 0),
            backgroundColor: SC[s]
          }))
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8899b4', font: { size: 11 }, boxWidth: 12, padding: 8 } } },
          scales: { x: { stacked: true, ticks: { color: '#8899b4', font: { size: 12 } } }, y: { stacked: true, ticks: { color: '#8899b4', font: { size: 11 } } } }
        }
      })
    }

    // Pie Chart
    if (chartRefs.pie.current) {
      destroyChart('pie')
      const activeStats = STATUSES.filter(s => t.status[s] > 0)
      chartInstances.current.pie = new Chart(chartRefs.pie.current, {
        type: 'doughnut',
        data: {
          labels: activeStats,
          datasets: [{
            data: activeStats.map(s => t.status[s]),
            backgroundColor: activeStats.map(s => SC[s]),
            borderColor: '#06090f',
            borderWidth: 3
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      })
    }

    // Weightage Chart
    if (chartRefs.wt.current) {
      destroyChart('wt')
      const ws = [...f].sort((a, b) => b.plannedWtg - a.plannedWtg)
      chartInstances.current.wt = new Chart(chartRefs.wt.current, {
        type: 'bar',
        data: {
          labels: ws.map(d => SHORTS[d.name] || d.name),
          datasets: [
            { label: 'Planned', data: ws.map(d => +(d.plannedWtg * 100).toFixed(2)), backgroundColor: 'rgba(76,154,255,.3)', borderColor: '#4c9aff', borderWidth: 1 },
            { label: 'Earned', data: ws.map(d => +(d.earnedWtg * 100).toFixed(2)), backgroundColor: 'rgba(0,212,170,.7)', borderColor: '#00d4aa', borderWidth: 1 },
            { label: 'Completion%', data: ws.map(d => d.completionPct.toFixed(1)), type: 'line', borderColor: '#ffb020', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8899b4', font: { size: 11 }, boxWidth: 12, padding: 8 } } },
          scales: { x: { ticks: { color: '#8899b4', font: { size: 12 } } }, y: { ticks: { color: '#8899b4', font: { size: 11 } } }, y1: { position: 'right', min: 0, max: 100, ticks: { color: '#8899b4', font: { size: 11 } } } }
        }
      })
    }

    // Radar Chart (Analytics Tab)
    if (chartRefs.radar.current) {
      destroyChart('radar')
      chartInstances.current.radar = new Chart(chartRefs.radar.current, {
        type: 'radar',
        data: {
          labels: f.map(d => SHORTS[d.name] || d.name),
          datasets: [
            { label: 'Completion%', data: f.map(d => d.completionPct.toFixed(1)), borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,.1)', borderWidth: 2 },
            { label: 'Approved', data: f.map(d => (d.AFC || 0) + (d.IFC || 0)), borderColor: '#4c9aff', backgroundColor: 'rgba(76,154,255,.05)', borderWidth: 2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8899b4', font: { size: 11 } } } },
          scales: { r: { ticks: { color: '#556b8a', font: { size: 9 }, display: false }, grid: { color: '#1c2842' }, pointLabels: { color: '#8899b4', font: { size: 12 } } } }
        }
      })
    }

    // Trend Chart (History Tab)
    if (chartRefs.trend.current && snapshots.length > 0) {
      destroyChart('trend')
      const td = [...snapshots].reverse()
      chartInstances.current.trend = new Chart(chartRefs.trend.current, {
        type: 'line',
        data: {
          labels: td.map(s => `W${s.week}`),
          datasets: [
            { label: 'Completion%', data: td.map(s => (s.totals?.pct || 0).toFixed(1)), borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,.1)', fill: true, borderWidth: 2, pointRadius: 4 },
            { label: 'Approved', data: td.map(s => s.totals?.approved || 0), borderColor: '#4c9aff', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' },
            { label: 'Pending', data: td.map(s => s.totals?.pending || 0), borderColor: '#ff5c5c', borderWidth: 2, pointRadius: 3, yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#8899b4', font: { size: 11 } } } },
          scales: { x: { ticks: { color: '#8899b4', font: { size: 12 } } }, y: { min: 0, max: 100, ticks: { color: '#8899b4', font: { size: 11 } } }, y1: { position: 'right', ticks: { color: '#8899b4', font: { size: 11 } } } }
        }
      })
    }
  }

  const publishReport = () => {
    const w = window.open('', '_blank')
    const t = computeTotals()
    let h = `<!DOCTYPE html><html><head><style>body{font-family:'Segoe UI',sans-serif;padding:40px;color:#1a1a2e}h1{font-size:24px;text-align:center;margin-bottom:4px}h2{font-size:18px;border-bottom:2px solid #1a1a2e;padding-bottom:4px;margin:20px 0 10px}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px}th{background:#1a1a2e;color:#fff;padding:8px 10px;text-align:center}th:first-child{text-align:left}td{padding:8px 10px;text-align:center;border-bottom:1px solid #e5e7eb}td:first-child{text-align:left;font-weight:600}.kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px}.kpi{border:2px solid #e5e7eb;border-radius:10px;padding:14px;text-align:center}.kpi .val{font-size:28px;font-weight:800}.kpi .label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px}.badge{padding:2px 8px;border-radius:4px;font-weight:700;font-size:12px}.g{background:#dcfce7;color:#16a34a}.y{background:#fef3c7;color:#d97706}.r{background:#fee2e2;color:#dc2626}p.sub{text-align:center;color:#666;font-size:14px}.footer{text-align:center;font-size:11px;color:#aaa;margin-top:40px}.db-note{text-align:center;font-size:12px;color:#999;margin:8px 0}</style></head><body>`;
    h += `<h1>UBPL Project — Weekly Progress Report</h1><p class="sub">${config.ProjectName || ''} · ${config.ProjectCode || ''}</p>`;
    h += `<p class="sub" style="font-weight:700;color:#1a1a2e;margin-top:8px">Report Date: ${reportDate}</p>`;
    h += `<p class="db-note">Source: ${dbInfo.inputFile} → Output: ${dbInfo.outputFile}</p>`;
    h += `<div class="kpi-row">`;
    [{ l: 'Total Docs', v: t.docs }, { l: 'Approved', v: t.approved }, { l: 'In Progress', v: t.inProg }, { l: 'Pending', v: t.pending }, { l: 'Progress', v: t.pct.toFixed(1) + '%' }].forEach(k => { h += `<div class="kpi"><div class="label">${k.l}</div><div class="val">${k.v}</div></div>` });
    h += `</div><h2>Status by Discipline</h2><table><tr><th>Discipline</th>`; STATUSES.forEach(s => h += `<th>${s}</th>`); h += `<th>Total</th><th>Completion</th></tr>`;
    [...data].sort((a, b) => b.total - a.total).forEach((d, i) => { const p = d.completionPct, c = p >= 75 ? 'g' : p >= 50 ? 'y' : 'r'; h += `<tr style="background:${i % 2 ? '#f8f9fa' : '#fff'}"><td>${d.name}</td>`; STATUSES.forEach(s => h += `<td>${d[s] || '—'}</td>`); h += `<td><strong>${d.total}</strong></td><td><span class="badge ${c}">${p.toFixed(1)}%</span></td></tr>` });
    h += `<tr style="background:#1a1a2e;color:#fff"><td><strong>TOTAL</strong></td>`; STATUSES.forEach(s => h += `<td><strong>${t.status[s]}</strong></td>`); h += `<td><strong>${t.docs}</strong></td><td><strong>${t.pct.toFixed(1)}%</strong></td></tr></table>`;
    h += `<div class="footer">Generated from UBPL Dashboard · ${new Date().toLocaleString()}</div></body></html>`;
    w.document.write(h); w.document.close();
  }

  const toggleDisc = (n) => {
    const next = new Set(selectedDiscs)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    setSelectedDiscs(next)
  }

  const clearFilters = () => {
    setSelectedDiscs(new Set())
    setFocusDisc(null)
  }

  const filtered = getFiltered()
  const totals = computeTotals(filtered)

  return (
    <div className="app">
      {notification.visible && (
        <div className="notify" style={{ background: notification.type === 'error' ? 'var(--red)' : 'var(--accent)', display: 'block' }}>
          {notification.message}
        </div>
      )}

      <div className="header no-print">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: 'linear-gradient(135deg,var(--accent),var(--blue))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 800, color: 'var(--bg)' }}>U</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <h1>UBPL Engineering Dashboard</h1>
              <div className="live-dot"></div>
            </div>
            <p id="subtitle">{config.ProjectName || 'Project'} · {config.ProjectCode || ''}</p>
          </div>
        </div>
        <div className="toolbar">
          <div className="db-info">
            <span className="db-tag db-in">INPUT: {dbInfo.inputFile || '?'}</span>
            <span className="db-tag db-out">OUTPUT: {dbInfo.outputFile || '?'}</span>
          </div>
          <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '4px 8px', color: 'var(--accent)', fontFamily: 'IBM Plex Mono', fontSize: '13px', outline: 'none' }} />
          <button className="btn btn-outline" onClick={refreshData} title="Reload from output DB">⟳ Refresh</button>
          <button className="btn btn-outline" onClick={reimportFromInput} title="Re-import source data (preserves snapshots)">📥 Re-import Input</button>
          <button className="btn btn-outline" onClick={() => window.location.href = '/api/download_output'}>↓ Output Excel</button>
          <button className="btn btn-blue" onClick={saveSnapshot}>📸 Snapshot</button>
          <button className="btn btn-accent" onClick={publishReport}>📄 Publish</button>
          <button className="btn btn-blue" style={{background: 'var(--blue)', color: '#fff'}} onClick={() => setActiveTab('input')}>➕ INSERT</button>
        </div>
      </div>

      <div className="nav no-print">
        <div className="tabs">
          {['overview', 'disciplines', 'deliverables', 'analytics', 'history'].map(t => (
            <button key={t} className={`tab ${activeTab === t ? 'active' : ''}`} onClick={() => { setActiveTab(t); setFocusDisc(null) }}>
              {t === 'history' ? `History (${snapshots.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="filters">
          <span className="filter-label">Disc</span>
          {data.map(d => (
            <span key={d.name} className={`chip ${selectedDiscs.has(d.name) ? 'on' : ''}`} onClick={() => toggleDisc(d.name)}>
              {SHORTS[d.name] || d.name.slice(0, 3)}
            </span>
          ))}
          {(selectedDiscs.size > 0) && (
            <button className="btn btn-outline" onClick={clearFilters} style={{ marginLeft: 'auto', fontSize: '11px', padding: '3px 10px', borderColor: 'var(--red)', color: 'var(--red)' }}>Clear</button>
          )}
        </div>
      </div>

      <div className={`body ${activeTab === 'overview' ? 'fit' : ''}`}>
        {/* KPI Grid */}
        <div className="grid g5" style={{ marginBottom: '8px' }}>
          {[
            { l: 'TOTAL DELIVERABLES', v: totals.docs, c: 'var(--blue)', s: `${filtered.length} disciplines` },
            { l: 'APPROVED (AFC+IFC)', v: totals.approved, c: 'var(--accent)', s: `AFC ${totals.status.AFC} · IFC ${totals.status.IFC}` },
            { l: 'IN PROGRESS', v: totals.inProg, c: 'var(--amber)', s: `IFA ${totals.status.IFA} · IFR ${totals.status.IFR}` },
            { l: 'PENDING / DUE', v: totals.pending, c: 'var(--red)', s: 'Not yet submitted' },
            { l: 'OVERALL PROGRESS', v: totals.pct.toFixed(1) + '%', c: 'var(--cyan)', s: `Earned ${(totals.ew * 100).toFixed(1)}%` }
          ].map((k, i) => (
            <div key={i} className="card" style={{ padding: '10px 14px' }}>
              <div className="kpi-label">{k.l}</div>
              <div className="kpi-val" style={{ color: k.c }}>{k.v}</div>
              <div className="kpi-sub">{k.s}</div>
            </div>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '3fr 2fr', gridTemplateRows: '1fr 1fr', gap: '10px', minHeight: 0 }}>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="sec-title">Status by Discipline</div>
              <div className="chart-wrap" style={{ flex: 1, minHeight: 0 }}><canvas ref={chartRefs.bar}></canvas></div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="sec-title">Completion by Discipline</div>
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                {[...filtered].sort((a, b) => b.completionPct - a.completionPct).map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px', cursor: 'pointer' }} onClick={() => setFocusDisc(focusDisc === d.name ? null : d.name)}>
                    <div style={{ width: '120px', fontSize: '13px', color: focusDisc === d.name ? 'var(--accent)' : 'var(--text2)', textAlign: 'right', fontWeight: focusDisc === d.name ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                    <div style={{ flex: 1 }}><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(d.completionPct, 100)}%`, background: pctColor(d.completionPct) }}></div></div></div>
                    <div className="mono" style={{ width: '50px', fontSize: '13px', fontWeight: 700, color: pctColor(d.completionPct), textAlign: 'right' }}>{d.completionPct.toFixed(1)}%</div>
                    <div style={{ width: '30px', fontSize: '12px', color: 'var(--text3)', textAlign: 'right' }}>{d.total}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="sec-title">Planned vs Earned Weightage</div>
              <div className="chart-wrap" style={{ flex: 1, minHeight: 0 }}><canvas ref={chartRefs.wt}></canvas></div>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="sec-title">Status Distribution</div>
              <div className="chart-wrap" style={{ flex: 1, minHeight: 0 }}><canvas ref={chartRefs.pie}></canvas></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', paddingTop: '6px' }}>
                {STATUSES.filter(s => totals.status[s] > 0).map(s => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                    <span className="dot" style={{ background: SC[s] }}></span>
                    <span style={{ color: 'var(--text2)' }}>{s}</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{totals.status[s]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'disciplines' && (
          <>
            <div className="grid g-auto">
              {[...filtered].sort((a, b) => b.total - a.total).map(d => {
                const p = d.completionPct;
                const c = pctColor(p);
                return (
                  <div key={d.name} className={`disc-card ${focusDisc === d.name ? 'sel' : ''}`} onClick={() => { setFocusDisc(d.name); loadDCI(d.name) }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <div style={{ fontSize: '16px', fontWeight: 700 }}>{d.name}</div>
                        <div style={{ fontSize: '13px', color: 'var(--text3)' }}>{d.total} docs · Wtg {(d.plannedWtg * 100).toFixed(1)}%</div>
                      </div>
                      <div className="mono" style={{ fontSize: '20px', fontWeight: 800, color: c, padding: '2px 10px', background: pctBg(p), borderRadius: '7px' }}>{p.toFixed(0)}%</div>
                    </div>
                    <div className="bar-track" style={{ marginBottom: '8px' }}><div className="bar-fill" style={{ width: `${Math.min(p, 100)}%`, background: c }}></div></div>
                    <div style={{ display: 'flex', gap: '2px', height: '22px', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px' }}>
                      {STATUSES.map(s => {
                        const w = d.total > 0 ? (d[s] / d.total) * 100 : 0;
                        return w > 0 ? <div key={s} style={{ width: `${w}%`, background: SC[s], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: 700, color: '#fff', minWidth: '3px' }}>{w > 12 ? d[s] : ''}</div> : null
                      })}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {STATUSES.filter(s => d[s] > 0).map(s => (
                        <span key={s} style={{ fontSize: '12px', color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span className="dot" style={{ background: SC[s], width: '6px', height: '6px' }}></span>{s}:{d[s]}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {focusDisc && (
              <div className="detail-panel" style={{ marginTop: '10px' }}>
                <div className="sec-title" style={{ color: 'var(--accent)' }}>{focusDisc} — Deliverables</div>
                <div id="dciList">
                  {dci.length === 0 ? (
                    <p style={{ color: 'var(--text3)', padding: '16px', textAlign: 'center' }}>No deliverables found or loading...</p>
                  ) : (
                    <table style={{ fontSize: '12px' }}>
                      <thead><tr><th>Doc Number</th><th>Description</th><th>Cat</th><th>Status</th><th>Rev</th><th>Wtg</th><th>Action</th></tr></thead>
                      <tbody>
                        {dci
                          .filter(doc => (doc.docNum || '').toLowerCase().includes(searchTerm.toLowerCase()))
                          .slice(0, 100).map((doc, idx) => {
                          const sc = SC[doc.latestStatus] || 'var(--text3)';
                          return (
                            <tr key={`${doc.docNum}-${idx}`}>
                              <td style={{ fontSize: '11px', fontFamily: 'IBM Plex Mono' }}>{doc.docNum}</td>
                              <td style={{ fontSize: '11px', textAlign: 'left', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.docDesc}>{doc.docDesc}</td>
                              <td>{doc.approvalCat}</td>
                              <td><span className="status-badge" style={{ background: `${sc}18`, color: sc }}>{doc.latestStatus || '—'}</span></td>
                              <td style={{ fontSize: '11px' }}>{doc.latestRev}</td>
                              <td className="mono" style={{ fontSize: '11px' }}>{doc.weitage ? doc.weitage.toFixed(4) : ''}</td>
                              <td style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
                                <select value={doc.latestStatus} onChange={e => updateDCIStatus(doc.docNum, e.target.value)} style={{ fontSize: '10px', padding: '2px 4px' }}>
                                  <option value="">Status...</option>
                                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <button onClick={() => handleDeleteDCI(doc.docNum)} className="btn-outline" style={{ color: 'var(--red)', borderColor: 'var(--red)', padding: '2px 6px', fontSize: '10px' }} title="Delete">✕</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                  {dci.length > 100 && <p style={{ color: 'var(--text3)', fontSize: '11px', padding: '6px', textAlign: 'center' }}>Showing 100 of {dci.length}</p>}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'deliverables' && (
          <div className="card" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div className="sec-title" style={{ marginBottom: 0 }}>Deliverable Control Index</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input 
                  type="text" 
                  placeholder="Search Doc Number..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  style={{ 
                    background: 'var(--bg)', 
                    border: '1px solid var(--border)', 
                    borderRadius: '5px', 
                    padding: '4px 8px', 
                    color: 'var(--accent)', 
                    fontSize: '12px', 
                    width: '180px',
                    outline: 'none'
                  }} 
                />
                <select id="dciDiscFilter" onChange={handleDCIFilterChange}><option value="">All Disciplines</option>{data.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}</select>
                <select id="dciStatusFilter" onChange={handleDCIFilterChange}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <select id="dciCatFilter" onChange={handleDCIFilterChange}><option value="">All Categories</option><option value="A">Cat A</option><option value="R">Cat R</option><option value="I">Cat I</option></select>
              </div>
            </div>
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {dci.length === 0 ? (
                <p style={{ color: 'var(--text3)', padding: '20px', textAlign: 'center' }}>Use filters above to load deliverables</p>
              ) : (
                <table style={{ fontSize: '12px' }}>
                  <thead><tr><th>Doc Number</th><th>Description</th><th>Cat</th><th>Status</th><th>Rev</th><th>Wtg</th><th>Action</th></tr></thead>
                  <tbody>
                    {dci
                      .filter(doc => (doc.docNum || '').toLowerCase().includes(searchTerm.toLowerCase()))
                      .slice(0, 100).map((doc, idx) => {
                      const sc = SC[doc.latestStatus] || 'var(--text3)';
                      return (
                        <tr key={`${doc.docNum}-${idx}`}>
                          <td style={{ fontSize: '11px', fontFamily: 'IBM Plex Mono' }}>{doc.docNum}</td>
                          <td style={{ fontSize: '11px', textAlign: 'left', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.docDesc}>{doc.docDesc}</td>
                          <td>{doc.approvalCat}</td>
                          <td><span className="status-badge" style={{ background: `${sc}18`, color: sc }}>{doc.latestStatus || '—'}</span></td>
                          <td style={{ fontSize: '11px' }}>{doc.latestRev}</td>
                          <td className="mono" style={{ fontSize: '11px' }}>{doc.weitage ? doc.weitage.toFixed(4) : ''}</td>
                          <td style={{ display: 'flex', gap: '4px', justifyContent: 'center', alignItems: 'center' }}>
                            <select value={doc.latestStatus} onChange={e => updateDCIStatus(doc.docNum, e.target.value)} style={{ fontSize: '10px', padding: '2px 4px' }}>
                              <option value="">Status...</option>
                              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <button onClick={() => handleDeleteDCI(doc.docNum)} className="btn-outline" style={{ color: 'var(--red)', borderColor: 'var(--red)', padding: '2px 6px', fontSize: '10px' }} title="Delete">✕</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <>
            <div className="card" style={{ marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div className="sec-title" style={{ marginBottom: 0 }}>{editMode ? 'Edit Data' : 'Status Matrix'}</div>
                {!editMode ? <button className="btn btn-outline" onClick={() => setEditMode(true)}>✏ Edit</button>
                  : <div style={{ display: 'flex', gap: '4px' }}><button className="btn btn-accent" onClick={saveEdits}>✓ Save</button><button className="btn btn-outline" onClick={() => setEditMode(false)} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>✕ Cancel</button></div>}
              </div>
              <table>
                <thead>
                  <tr><th style={{ textAlign: 'left' }}>Discipline</th>{STATUSES.map(s => <th key={s} style={{ color: SC[s] }}>{s}</th>)}<th>Total</th><th style={{ color: 'var(--cyan)' }}>Compl.</th></tr>
                </thead>
                <tbody>
                  {[...filtered].sort((a, b) => b.total - a.total).map((d, i) => {
                    const p = d.completionPct;
                    return (
                      <tr key={d.name} style={{ background: i % 2 ? 'rgba(12,18,32,.5)' : 'transparent' }}>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        {STATUSES.map(s => editMode ? <td key={s}><input className="edit-input" type="number" min="0" defaultValue={d[s] || 0} data-disc={d.name} data-status={s} style={{ color: SC[s] }} /></td>
                          : <td key={s} className="mono" style={{ fontWeight: 600, color: d[s] > 0 ? SC[s] : 'var(--text3)' }}>{d[s] > 0 ? d[s] : '—'}</td>)}
                        <td className="mono" style={{ fontWeight: 700 }}>{d.total}</td>
                        <td><span className="status-badge" style={{ background: pctBg(p), color: pctColor(p) }}>{p.toFixed(1)}%</span></td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'rgba(76,154,255,.05)' }}><td style={{ fontWeight: 800, color: 'var(--blue)' }}>TOTAL</td>
                    {STATUSES.map(s => <td key={s} className="mono" style={{ fontWeight: 800, color: SC[s] }}>{totals.status[s]}</td>)}
                    <td className="mono" style={{ fontWeight: 800 }}>{totals.docs}</td>
                    <td><span className="status-badge" style={{ background: 'rgba(34,211,238,.12)', color: 'var(--cyan)' }}>{totals.pct.toFixed(1)}%</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid g2">
              <div className="card"><div className="sec-title">Radar</div><div className="chart-wrap" style={{ height: '260px' }}><canvas ref={chartRefs.radar}></canvas></div></div>
              <div className="card"><div className="sec-title">Risk Assessment</div>
                {[...filtered].sort((a, b) => a.completionPct - b.completionPct).slice(0, 5).map(d => {
                  const p = d.completionPct;
                  const sev = p < 50 ? 'CRITICAL' : p < 65 ? 'HIGH' : p < 75 ? 'MEDIUM' : 'LOW';
                  const sc = sev === 'CRITICAL' ? 'var(--red)' : sev === 'HIGH' ? 'var(--amber)' : sev === 'MEDIUM' ? '#f97316' : 'var(--accent)';
                  return (
                    <div key={d.name} style={{ padding: '10px', background: `${sc}10`, borderRadius: '8px', border: `1px solid ${sc}30`, marginBottom: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}><span style={{ fontSize: '14px', fontWeight: 700 }}>{d.name}</span><span className="mono" style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: `${sc}25`, color: sc }}>{sev}</span></div>
                      <div className="bar-track" style={{ marginBottom: '4px' }}><div className="bar-fill" style={{ width: `${Math.min(p, 100)}%`, background: sc }}></div></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text2)' }}><span>{p.toFixed(1)}%</span><span>{d.DUE || 0} DUE · {d.IFR || 0} IFR</span></div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {activeTab === 'history' && (
          <>
            {snapshots.length > 1 && <div className="card" style={{ marginBottom: '10px' }}><div className="sec-title">Weekly Trend</div><div className="chart-wrap" style={{ height: '250px' }}><canvas ref={chartRefs.trend}></canvas></div></div>}
            <div className="card" style={{ marginBottom: '10px' }}>
              <div className="sec-title">Snapshots</div>
              {snapshots.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text3)' }}><div style={{ fontSize: '36px', marginBottom: '8px' }}>📸</div><p style={{ fontSize: '15px', fontWeight: 600 }}>No snapshots yet</p><p style={{ fontSize: '13px' }}>Click "Snapshot" to save current state</p></div>
              ) : snapshots.map(s => (
                <div key={s.date} className="snap-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '42px', height: '42px', borderRadius: '8px', background: 'rgba(0,212,170,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 800, color: 'var(--accent)' }}>W{s.week}</div>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: 700 }}>{s.date.split(' ')[0]} — Week {s.week}, {s.year}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text3)', fontFamily: 'IBM Plex Mono' }}>ID: {s.date.split(' ')[1] || s.date}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{s.totals?.docs || 0} docs · {(s.totals?.pct || 0).toFixed(1)}%</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-outline" onClick={() => {
                        const headers = ['Discipline', 'AFC', 'IFC', 'IFA', 'IFR', 'IDC', 'DUE', 'Total', 'PlannedWtg', 'EarnedWtg', 'Completion%'];
                        const escapeCSV = (val) => {
                        const s = String(val);
                        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                            return `"${s.replace(/"/g, '""')}"`;
                        }
                        return s;
                        };
                        const rows = s.disciplines.map(d => [
                        d.name, d.AFC, d.IFC, d.IFA, d.IFR, d.IDC, d.DUE, d.total, 
                        d.plannedWtg.toFixed(4), d.earnedWtg.toFixed(4), (d.completionPct || 0).toFixed(2)
                        ]);
                        rows.push([
                        'TOTAL', s.totals?.status?.AFC || 0, s.totals?.status?.IFC || 0, s.totals?.status?.IFA || 0, 
                        s.totals?.status?.IFR || 0, s.totals?.status?.IDC || 0, s.totals?.status?.DUE || 0, s.totals?.docs || 0,
                        (s.totals?.wt || 0).toFixed(4), (s.totals?.ew || 0).toFixed(4), (s.totals?.pct || 0).toFixed(2)
                        ]);
                        const csvContent = [
                        headers.map(escapeCSV).join(','), 
                        ...rows.map(row => row.map(escapeCSV).join(','))
                        ].join('\n');
                        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.setAttribute('download', `Snapshot_${s.date}_W${s.week}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        notify(`Downloaded Snapshot ${s.date}`);
                    }} title="Download as CSV">
                        ⬇ CSV
                    </button>
                    <button className="btn btn-outline" style={{ borderColor: 'var(--red)', color: 'var(--red)' }} onClick={() => deleteSnapshot(s.date)}>
                        ✕ Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {snapshots.length >= 2 && (
              <div className="card" style={{ marginBottom: '10px' }}>
                <div className="sec-title">Week-over-Week</div>
                <table>
                  <thead>
                    <tr><th>Wk</th><th>Date</th>{STATUSES.map(s => <th key={s} style={{ color: SC[s] }}>{s}</th>)}<th>Total</th><th style={{ color: 'var(--cyan)' }}>%</th></tr>
                  </thead>
                  <tbody>
                    {snapshots.slice(0, 8).map((s, i) => (
                      <tr key={s.date} style={{ background: i % 2 ? 'rgba(12,18,32,.5)' : 'transparent' }}>
                        <td style={{ fontWeight: 700, color: 'var(--accent)' }}>W{s.week}</td><td style={{ color: 'var(--text2)' }}>{s.date}</td>{STATUSES.map(st => <td key={st} className="mono" style={{ color: SC[st] }}>{s.totals?.status?.[st] || 0}</td>)}<td className="mono" style={{ fontWeight: 700 }}>{s.totals?.docs || 0}</td><td><span className="status-badge" style={{ background: pctBg(s.totals?.pct || 0), color: pctColor(s.totals?.pct || 0) }}>{(s.totals?.pct || 0).toFixed(1)}%</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'input' && (
          <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div className="sec-title">Add New Deliverable</div>
            <form onSubmit={handleInputSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Discipline</label>
                <select value={inputData.discipline} onChange={e => setInputData({...inputData, discipline: e.target.value})} required style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }}>
                  <option value="">Select Discipline...</option>
                  {data.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Document Number</label>
                <input type="text" value={inputData.docNum} onChange={e => setInputData({...inputData, docNum: e.target.value})} required style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', gridColumn: 'span 2' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Description</label>
                <input type="text" value={inputData.docDesc} onChange={e => setInputData({...inputData, docDesc: e.target.value})} required style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Sub Format</label>
                <input type="text" value={inputData.subFormat} onChange={e => setInputData({...inputData, subFormat: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Approval Category</label>
                <select value={inputData.approvalCat} onChange={e => setInputData({...inputData, approvalCat: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }}>
                  <option value="A">Cat A</option>
                  <option value="R">Cat R</option>
                  <option value="I">Cat I</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Weightage (0.00 - 1.00)</label>
                <input type="number" step="0.0001" min="0" max="1" value={inputData.weitage} onChange={e => setInputData({...inputData, weitage: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Initial Schedule</label>
                <input type="date" value={inputData.initSchedule} onChange={e => setInputData({...inputData, initSchedule: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Initial Revision</label>
                <input type="text" value={inputData.latestRev} onChange={e => setInputData({...inputData, latestRev: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Initial Status</label>
                <select value={inputData.latestStatus} onChange={e => setInputData({...inputData, latestStatus: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)' }}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', gridColumn: 'span 2' }}>
                <label style={{ fontSize: '12px', color: 'var(--text3)' }}>Remarks</label>
                <textarea value={inputData.remarks} onChange={e => setInputData({...inputData, remarks: e.target.value})} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '5px', padding: '8px', color: 'var(--text)', minHeight: '80px' }} />
              </div>
              <div style={{ gridColumn: 'span 2', display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="submit" className="btn btn-accent" style={{ flex: 1, padding: '12px' }}>Save Deliverable</button>
                <button type="button" className="btn btn-outline" onClick={() => setActiveTab('overview')} style={{ flex: 1, padding: '12px' }}>Cancel</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

export default App

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import {
  Canvas,
  PencilBrush,
  Line,
  Rect,
  Ellipse,
} from 'fabric'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'

// ─── Tool constants ────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT:  'select',
  PEN:     'pen',
  LINE:    'line',

}

const TOOL_META = [
  { id: TOOLS.SELECT, label: 'Select',  icon: '↖' },
  { id: TOOLS.PEN,    label: 'Pen',     icon: '✎' },
  { id: TOOLS.LINE,   label: 'Line',    icon: '╱' },
]

const PRESET_COLORS = [
  '#1a2f45', '#1a8fe3', '#ef4444', '#22c55e',
  '#f59e0b', '#7c3aed', '#ec4899', '#000000', '#ffffff',
]

const STROKE_WIDTHS = [1, 2, 4, 8, 16]

// ─── Teach / Grid panel constants ─────────────────────────────────────────────
const POSE_LABELS  = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz']
const JOG_POS_AXES = ['x', 'y', 'z']
const JOG_ROT_AXES = ['rx', 'ry', 'rz']
const JOG_SPEED    = 10

const axisLabel = (a) => a.charAt(0).toUpperCase() + a.slice(1)
const clampInt  = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)))

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getCanvasPathData(fc) {
  return fc.getObjects().map((obj) => {
    const type = obj.type
    const base = { type, left: obj.left, top: obj.top }
    if (type === 'path')    return { ...base, path: obj.path, stroke: obj.stroke, strokeWidth: obj.strokeWidth }
    if (type === 'line')    return { ...base, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2, stroke: obj.stroke, strokeWidth: obj.strokeWidth }
    if (type === 'rect')    return { ...base, width: obj.width, height: obj.height, stroke: obj.stroke, strokeWidth: obj.strokeWidth, fill: obj.fill }
    if (type === 'ellipse') return { ...base, rx: obj.rx, ry: obj.ry, stroke: obj.stroke, strokeWidth: obj.strokeWidth, fill: obj.fill }
    return base
  })
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DrawingModePage = () => {
  const canvasElRef   = useRef(null)
  const dmViewportRef = useRef(null)
  const fabricRef     = useRef(null)
  const isDrawingRef  = useRef(false)
  const tempObjRef    = useRef(null)
  const startPtRef    = useRef({ x: 0, y: 0 })
  const mouseDownRef  = useRef(null)
  const mouseMoveRef  = useRef(null)
  const mouseUpRef    = useRef(null)

  const [activeTool,  setActiveTool]  = useState(TOOLS.PEN)
  const [strokeColor, setStrokeColor] = useState('#1a2f45')
  const [fillColor,   setFillColor]   = useState('transparent')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [canUndo,     setCanUndo]     = useState(false)
  const [canRedo,     setCanRedo]     = useState(false)
  const [status,      setStatus]      = useState('Ready')
  const [objectCount, setObjectCount] = useState(0)
  const [isSending,   setIsSending]   = useState(false)

  // 3D Robot Model Floating Viewer
  const viewerKey = useRef(Date.now())
  const [is3DMinimized, setIs3DMinimized] = useState(false)
  const [is3DExpanded, setIs3DExpanded]   = useState(false)

  // Teach / Grid Floating Panel
  const [isTeachMinimized, setIsTeachMinimized] = useState(false)
  const [teachStatus, setTeachStatus]           = useState(null)
  const [posStep, setPosStep]                   = useState(5)
  const [rotStep, setRotStep]                   = useState(2)
  const [gridRows, setGridRows]                 = useState(2)
  const [gridCols, setGridCols]                 = useState(2)
  const [teachMsg, setTeachMsg]                 = useState(null)
  const teachMsgTimerRef = useRef(null)

  // Refs for latest state values (avoid stale closures)
  const strokeColorRef = useRef(strokeColor)
  const fillColorRef   = useRef(fillColor)
  const strokeWidthRef = useRef(strokeWidth)
  const activeToolRef  = useRef(activeTool)
  useEffect(() => { strokeColorRef.current = strokeColor }, [strokeColor])
  useEffect(() => { fillColorRef.current   = fillColor   }, [fillColor])
  useEffect(() => { strokeWidthRef.current = strokeWidth }, [strokeWidth])
  useEffect(() => { activeToolRef.current  = activeTool  }, [activeTool])

  // History stacks
  const historyRef    = useRef([])
  const historyIdxRef = useRef(-1)

  // ── Save state to history ──────────────────────────────────────────────────
  const saveHistory = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    const json = fc.toJSON()
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(json)
    historyIdxRef.current = historyRef.current.length - 1
    setCanUndo(historyIdxRef.current > 0)
    setCanRedo(false)
    setObjectCount(fc.getObjects().length)
  }, [])

  const updateCounts = useCallback(() => {
    const fc = fabricRef.current
    if (fc) setObjectCount(fc.getObjects().length)
  }, [])

  // ── Initialize Fabric canvas ───────────────────────────────────────────────
  useEffect(() => {
    const el = canvasElRef.current
    if (!el) return

    const fc = new Canvas(el, {
      backgroundColor: null,   // transparent — shows camera behind
      selection: true,
      isDrawingMode: false,
    })
    fabricRef.current = fc

    // Initial history snapshot
    historyRef.current = [fc.toJSON()]
    historyIdxRef.current = 0

    fc.on('object:added',   updateCounts)
    fc.on('object:removed', updateCounts)

    // Handle resize
    const handleResize = () => {
      const wrap = el.parentElement
      if (!wrap) return
      fc.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight })
      fc.renderAll()
    }
    const ro = new ResizeObserver(handleResize)
    ro.observe(el.parentElement)
    handleResize()

    return () => {
      ro.disconnect()
      fc.dispose()
    }
  }, [updateCounts])

  // ── Detach shape mouse listeners helper ───────────────────────────────────
  const detachMouseListeners = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    if (mouseDownRef.current) { fc.off('mouse:down', mouseDownRef.current); mouseDownRef.current = null }
    if (mouseMoveRef.current) { fc.off('mouse:move', mouseMoveRef.current); mouseMoveRef.current = null }
    if (mouseUpRef.current)   { fc.off('mouse:up',   mouseUpRef.current);   mouseUpRef.current   = null }
    // also remove path:created listener
    fc.off('path:created')
  }, [])

  // ── Apply Tool ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc) return

    // Detach previous listeners
    detachMouseListeners()

    if (activeTool === TOOLS.SELECT) {
      fc.isDrawingMode = false
      fc.selection = true
      fc.getObjects().forEach((o) => { o.selectable = true; o.evented = true })
      fc.renderAll()
      return
    }

    if (activeTool === TOOLS.PEN) {
      fc.isDrawingMode = true
      fc.selection = false
      fc.freeDrawingBrush = new PencilBrush(fc)
      fc.freeDrawingBrush.color = strokeColor
      fc.freeDrawingBrush.width = strokeWidth

      const onPathCreated = () => saveHistory()
      fc.on('path:created', onPathCreated)
      return
    }

    if (activeTool === TOOLS.ERASER) {
      fc.isDrawingMode = false
      fc.selection = false
      fc.getObjects().forEach((o) => { o.selectable = false; o.evented = true })

      const onDown = (opt) => {
        const target = fc.findTarget(opt.e)
        if (target) { fc.remove(target); fc.renderAll(); saveHistory() }
      }
      fc.on('mouse:down', onDown)
      mouseDownRef.current = onDown
      return
    }

    // Shape tools
    fc.isDrawingMode = false
    fc.selection = false
    fc.getObjects().forEach((o) => { o.selectable = false; o.evented = false })

    const onDown = (opt) => {
      isDrawingRef.current = true
      const ptr = fc.getScenePoint(opt.e)
      startPtRef.current = { x: ptr.x, y: ptr.y }
      const sc = strokeColorRef.current
      const sw = strokeWidthRef.current
      const fc2 = fillColorRef.current
      const tool = activeToolRef.current

      if (tool === TOOLS.LINE) {
        const line = new Line([ptr.x, ptr.y, ptr.x, ptr.y], {
          stroke: sc, strokeWidth: sw, selectable: false, evented: false,
        })
        fc.add(line)
        tempObjRef.current = line

      } else if (tool === TOOLS.RECT) {
        const rect = new Rect({
          left: ptr.x, top: ptr.y, width: 1, height: 1,
          stroke: sc, strokeWidth: sw,
          fill: fc2 === 'transparent' ? 'transparent' : fc2,
          selectable: false, evented: false,
        })
        fc.add(rect)
        tempObjRef.current = rect

      } else if (tool === TOOLS.CIRCLE) {
        const ellipse = new Ellipse({
          left: ptr.x, top: ptr.y, rx: 1, ry: 1,
          stroke: sc, strokeWidth: sw,
          fill: fc2 === 'transparent' ? 'transparent' : fc2,
          selectable: false, evented: false,
        })
        fc.add(ellipse)
        tempObjRef.current = ellipse
      }
    }

    const onMove = (opt) => {
      if (!isDrawingRef.current || !tempObjRef.current) return
      const ptr = fc.getScenePoint(opt.e)
      const { x: sx, y: sy } = startPtRef.current
      const obj = tempObjRef.current
      const tool = activeToolRef.current

      if (tool === TOOLS.LINE) {
        obj.set({ x2: ptr.x, y2: ptr.y })

      } else if (tool === TOOLS.RECT) {
        const w = ptr.x - sx
        const h = ptr.y - sy
        obj.set({
          left:   w < 0 ? ptr.x : sx,
          top:    h < 0 ? ptr.y : sy,
          width:  Math.max(1, Math.abs(w)),
          height: Math.max(1, Math.abs(h)),
        })

      } else if (tool === TOOLS.CIRCLE) {
        const rx = Math.max(1, Math.abs(ptr.x - sx) / 2)
        const ry = Math.max(1, Math.abs(ptr.y - sy) / 2)
        obj.set({
          left: Math.min(sx, ptr.x),
          top:  Math.min(sy, ptr.y),
          rx, ry,
        })
      }
      fc.renderAll()
    }

    const onUp = () => {
      if (!isDrawingRef.current) return
      isDrawingRef.current = false
      tempObjRef.current = null
      saveHistory()
    }

    fc.on('mouse:down', onDown)
    fc.on('mouse:move', onMove)
    fc.on('mouse:up',   onUp)
    mouseDownRef.current = onDown
    mouseMoveRef.current = onMove
    mouseUpRef.current   = onUp

  }, [activeTool, detachMouseListeners, saveHistory, strokeColor, strokeWidth, fillColor])

  // Sync free drawing brush when color/width change (PEN tool)
  useEffect(() => {
    const fc = fabricRef.current
    if (!fc || activeTool !== TOOLS.PEN || !fc.freeDrawingBrush) return
    fc.freeDrawingBrush.color = strokeColor
    fc.freeDrawingBrush.width = strokeWidth
  }, [activeTool, strokeColor, strokeWidth])

  // ── Undo ──────────────────────────────────────────────────────────────────
  const undo = useCallback(() => {
    const fc = fabricRef.current
    if (!fc || historyIdxRef.current <= 0) return
    historyIdxRef.current -= 1
    fc.loadFromJSON(historyRef.current[historyIdxRef.current]).then(() => {
      fc.renderAll()
      setCanUndo(historyIdxRef.current > 0)
      setCanRedo(true)
      setObjectCount(fc.getObjects().length)
    })
  }, [])

  // ── Redo ──────────────────────────────────────────────────────────────────
  const redo = useCallback(() => {
    const fc = fabricRef.current
    if (!fc || historyIdxRef.current >= historyRef.current.length - 1) return
    historyIdxRef.current += 1
    fc.loadFromJSON(historyRef.current[historyIdxRef.current]).then(() => {
      fc.renderAll()
      setCanUndo(true)
      setCanRedo(historyIdxRef.current < historyRef.current.length - 1)
      setObjectCount(fc.getObjects().length)
    })
  }, [])

  // ── Clear ─────────────────────────────────────────────────────────────────
  const clearCanvas = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    fc.clear()
    fc.backgroundColor = null   // keep transparent
    fc.renderAll()
    saveHistory()
    setStatus('Canvas cleared')
  }, [saveHistory])

  // ── Delete selected ───────────────────────────────────────────────────────
  const deleteSelected = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    const active = fc.getActiveObjects()
    if (active.length === 0) return
    active.forEach((o) => fc.remove(o))
    fc.discardActiveObject()
    fc.renderAll()
    saveHistory()
  }, [saveHistory])

  // ── Export PNG ────────────────────────────────────────────────────────────
  const exportPNG = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    const url = fc.toDataURL({ format: 'png', multiplier: 2 })
    const a = document.createElement('a')
    a.href = url
    a.download = `drawing_${Date.now()}.png`
    a.click()
    setStatus('Exported PNG')
  }, [])

  // ── Send to Robot ─────────────────────────────────────────────────────────
  const sendToRobot = useCallback(async () => {
    const fc = fabricRef.current
    if (!fc) return
    const pathData = getCanvasPathData(fc)
    if (pathData.length === 0) { setStatus('⚠ No objects to send'); return }
    setIsSending(true)
    setStatus('Sending to robot…')
    try {
      // Normalize pixel coords to [0,1] for backend grid_pose()
      const cw = fc.getWidth()
      const ch = fc.getHeight()

      const strokes = pathData.map((obj) => {
        const points = []
        if (obj.type === 'path' && obj.path) {
          obj.path.forEach((cmd) => {
            if (cmd[0] === 'M' || cmd[0] === 'L') {
              points.push([cmd[1] / cw, cmd[2] / ch])
            }
          })
        } else if (obj.type === 'line') {
          points.push([obj.x1 / cw, obj.y1 / ch], [obj.x2 / cw, obj.y2 / ch])
        }
        return { tool: 'pen', points }
      }).filter(s => s.points.length > 0)

      if (strokes.length === 0) {
        setStatus('⚠ No drawable paths found')
        return
      }

      const res = await apiFetch('/api/map/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes }),
      })
      const data = await res.json()
      if (data.ok) {
        setStatus(`✓ Sent ${strokes.length} stroke(s)`)
      } else {
        setStatus(`✗ ${data.error || 'Draw failed'}`)
      }
    } catch {
      setStatus('✗ Failed — robot offline?')
    } finally {
      setIsSending(false)
    }
  }, [])

  // ── Emergency Stop ────────────────────────────────────────────────────────
  const handleEmergency = () => {
    apiFetch('/api/map/error', { method: 'POST' }).catch(() => {})
    setStatus('EMERGENCY STOP sent')
    alert('EMERGENCY STOP!')
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, deleteSelected])

  useEffect(() => {
    const dock = document.getElementById('camera-stream-dock')
    const el = document.getElementById('global-camera-stream')
    const vp = dmViewportRef.current
    if (el && vp) {
      el.classList.add('dm-camera-bg')
      vp.insertBefore(el, vp.firstChild)
    }
    return () => {
      if (el) el.classList.remove('dm-camera-bg')
      if (el && dock) dock.appendChild(el)
    }
  }, [])

  // ── Teach / Grid: poll robot + grid status every 1s ──────────────────────
  const fetchTeachStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/status')
      if (!res.ok) return
      setTeachStatus(await res.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchTeachStatus()
    const interval = setInterval(fetchTeachStatus, 1000)
    return () => clearInterval(interval)
  }, [fetchTeachStatus])

  // ── Teach / Grid: transient inline message (auto-clear ~3s) ──────────────
  const showTeachMsg = useCallback((text, kind = 'ok') => {
    setTeachMsg({ text, kind })
    if (teachMsgTimerRef.current) clearTimeout(teachMsgTimerRef.current)
    teachMsgTimerRef.current = setTimeout(() => setTeachMsg(null), 3000)
  }, [])

  useEffect(() => () => {
    if (teachMsgTimerRef.current) clearTimeout(teachMsgTimerRef.current)
  }, [])

  // ── Teach / Grid: jog ────────────────────────────────────────────────────
  const handleJog = useCallback(async (axis, sign) => {
    if (!teachStatus || !teachStatus.connected) return
    const rawStep = axis.startsWith('r') ? rotStep : posStep
    const amount = sign * Math.max(0.1, Number(rawStep) || 0.1)
    try {
      const res = await apiFetch('/api/map/jog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ axis, amount, speed: JOG_SPEED }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || (data && data.ok === false)) {
        showTeachMsg((data && data.error) || 'Jog rejected', 'error')
      }
    } catch {
      showTeachMsg('Jog request failed', 'error')
    }
    setTimeout(fetchTeachStatus, 500)
  }, [teachStatus, posStep, rotStep, showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: set grid size ──────────────────────────────────────────
  const handleSetGrid = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: gridRows, cols: gridCols }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Grid set to ${data.rows}x${data.cols}`)
      } else {
        showTeachMsg((data && data.error) || 'Set grid failed', 'error')
      }
    } catch {
      showTeachMsg('Set grid request failed', 'error')
    }
    fetchTeachStatus()
  }, [gridRows, gridCols, showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: reset grid ─────────────────────────────────────────────
  const handleResetGrid = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/reset', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg('Grid reset')
      } else {
        showTeachMsg((data && data.error) || 'Reset grid failed', 'error')
      }
    } catch {
      showTeachMsg('Reset grid request failed', 'error')
    }
    fetchTeachStatus()
  }, [showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: record current pose into a cell (1-based row/col) ──────
  const handleMarkCell = useCallback(async (row, col) => {
    if (!teachStatus || !teachStatus.connected) return
    try {
      const res = await apiFetch('/api/map/grid/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row, col }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(data.message || `Marked R${row}C${col}`)
      } else {
        showTeachMsg((data && data.error) || `Mark R${row}C${col} failed`, 'error')
      }
    } catch {
      showTeachMsg('Mark request failed', 'error')
    }
    fetchTeachStatus()
  }, [teachStatus, showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: derived view data ──────────────────────────────────────
  const teachConnected = !!(teachStatus && teachStatus.connected)
  const teachPose      = (teachStatus && Array.isArray(teachStatus.pose)) ? teachStatus.pose : null
  const gRows          = (teachStatus && teachStatus.grid_rows) || gridRows
  const gCols          = (teachStatus && teachStatus.grid_cols) || gridCols
  const gridPoints     = teachStatus ? teachStatus.grid_points    : null
  const gridValidate   = teachStatus ? teachStatus.grid_validate  : null
  const gridShape2d    = teachStatus ? teachStatus.grid_shape_2d  : null

  let markedCount = 0
  if (Array.isArray(gridPoints)) {
    gridPoints.forEach((row) => {
      if (Array.isArray(row)) row.forEach((p) => { if (p) markedCount += 1 })
    })
  }

  // Grid shape preview geometry — port of the legacy 200x200 / 20px-padding scaling
  let gridShapeEls = null
  if (Array.isArray(gridShape2d) && gridShape2d.length > 0) {
    const byKey = {}
    const pts = []
    gridShape2d.forEach((row, i) => {
      if (!Array.isArray(row)) return
      row.forEach((p, j) => {
        if (Array.isArray(p) && p.length >= 2) {
          const pt = { i, j, x: p[0], y: p[1] }
          pts.push(pt)
          byKey[`${i},${j}`] = pt
        }
      })
    })
    if (pts.length > 0) {
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const spanX = (maxX - minX) || 1
      const spanY = (maxY - minY) || 1
      const scale = Math.min(160 / spanX, 160 / spanY)
      const offX  = (200 - spanX * scale) / 2
      const offY  = (200 - spanY * scale) / 2
      const toXY  = (p) => [offX + (p.x - minX) * scale, offY + (p.y - minY) * scale]
      const lines = []
      pts.forEach((p) => {
        const [x1, y1] = toXY(p)
        const right = byKey[`${p.i},${p.j + 1}`]
        const below = byKey[`${p.i + 1},${p.j}`]
        if (right) {
          const [x2, y2] = toXY(right)
          lines.push(<line key={`h-${p.i}-${p.j}`} x1={x1} y1={y1} x2={x2} y2={y2} />)
        }
        if (below) {
          const [x2, y2] = toXY(below)
          lines.push(<line key={`v-${p.i}-${p.j}`} x1={x1} y1={y1} x2={x2} y2={y2} />)
        }
      })
      gridShapeEls = (
        <>
          <g stroke="#2f8a5b" strokeWidth="1.5">{lines}</g>
          {pts.map((p) => {
            const [cx, cy] = toXY(p)
            return <circle key={`p-${p.i}-${p.j}`} cx={cx} cy={cy} r="3" fill="#a8e8c5" stroke="#2f8a5b" />
          })}
        </>
      )
    }
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Drawing Mode" onEmergency={handleEmergency} />
        <div className="page-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          <div className="dm-ipad-shell">

            {/* ── Camera + Canvas overlay (fills all remaining space) ── */}
            <div className="dm-viewport" ref={dmViewportRef}>

              {/* Fallback label when camera is offline */}
              <div className="dm-camera-offline">
                <span>Camera 1 — offline</span>
              </div>

              {/* Fabric.js canvas — transparent overlay */}
              <div className="dm-canvas-wrap" ref={(el) => {
                // keep the wrap ref in sync so ResizeObserver targets correct element
                if (el && canvasElRef.current) {
                  const fc = fabricRef.current
                  if (fc) {
                    fc.setDimensions({ width: el.clientWidth, height: el.clientHeight })
                    fc.renderAll()
                  }
                }
              }}>
                <canvas ref={canvasElRef} id="drawing-canvas" />
              </div>

              {/* ── Floating 3D Robot Arm Model (Top-Right) ── */}
              <div
                className={`dm-3d-floating${is3DMinimized ? ' dm-3d-floating--minimized' : ''}${is3DExpanded ? ' dm-3d-floating--expanded' : ''}`}
              >
                {is3DMinimized ? (
                  <button
                    className="dm-3d-minimized-btn"
                    onClick={() => setIs3DMinimized(false)}
                    title="Show 3D Robot Model"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </button>
                ) : (
                  <>
                    {/* Header bar */}
                    <div className="dm-3d-header">
                      <div className="dm-3d-title-wrap">
                        <span className="dm-3d-title-dot" />
                        <span className="dm-3d-title-text">3D Robot Arm</span>
                      </div>
                      <div className="dm-3d-actions">
                        <button
                          className="dm-3d-btn"
                          onClick={() => setIs3DExpanded(!is3DExpanded)}
                          title={is3DExpanded ? 'Compact size' : 'Expand size'}
                        >
                          {is3DExpanded ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="4 14 10 14 10 20" />
                              <polyline points="20 10 14 10 14 4" />
                              <line x1="14" y1="10" x2="21" y2="3" />
                              <line x1="3" y1="21" x2="10" y2="14" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 3 21 3 21 9" />
                              <polyline points="9 21 3 21 3 15" />
                              <line x1="21" y1="3" x2="14" y2="10" />
                              <line x1="3" y1="21" x2="10" y2="14" />
                            </svg>
                          )}
                        </button>
                        <button
                          className="dm-3d-btn dm-3d-btn--close"
                          onClick={() => setIs3DMinimized(true)}
                          title="Minimize"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* 3D Model iframe */}
                    <div className="dm-3d-frame-wrap">
                      <iframe
                        src={`/robot-viewer.html?v=${viewerKey.current}`}
                        title="Robot Arm 3D Viewer"
                        className="dm-3d-frame"
                        allow="accelerometer"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* ── Floating Teach / Grid Panel (Top-Left) ── */}
              <div
                className={`dm-teach-floating${isTeachMinimized ? ' dm-teach-floating--minimized' : ''}`}
              >
                {isTeachMinimized ? (
                  <button
                    className="dm-teach-minimized-btn"
                    onClick={() => setIsTeachMinimized(false)}
                    title="Show Teach / Grid panel"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <line x1="9" y1="3" x2="9" y2="21" />
                      <line x1="15" y1="3" x2="15" y2="21" />
                      <line x1="3" y1="9" x2="21" y2="9" />
                      <line x1="3" y1="15" x2="21" y2="15" />
                    </svg>
                  </button>
                ) : (
                  <>
                    {/* Header bar */}
                    <div className="dm-teach-header">
                      <div className="dm-teach-title-wrap">
                        <span className={`dm-teach-title-dot${teachConnected ? '' : ' dm-teach-title-dot--off'}`} />
                        <span className="dm-teach-title-text">Teach / Grid</span>
                      </div>
                      <div className="dm-teach-actions">
                        <button
                          className="dm-teach-btn dm-teach-btn--close"
                          onClick={() => setIsTeachMinimized(true)}
                          title="Minimize"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="dm-teach-body">
                      {/* Live pose readout */}
                      <div className="dm-teach-pose">
                        {teachConnected && teachPose && teachPose.length === 6 ? (
                          POSE_LABELS.map((lbl, i) => (
                            <div className="dm-teach-pose-item" key={lbl}>
                              <span className="dm-teach-pose-label">{lbl}</span>
                              <span className="dm-teach-pose-value">{Number(teachPose[i]).toFixed(1)}</span>
                            </div>
                          ))
                        ) : (
                          <span className="dm-teach-offline">not connected</span>
                        )}
                      </div>

                      {/* Jog — Position */}
                      <div className="dm-teach-section">
                        <div className="dm-teach-label-row">
                          <span className="dm-teach-label">Jog — Position</span>
                          <span className="dm-teach-step-wrap">
                            <input
                              type="number"
                              className="dm-teach-step-input"
                              value={posStep}
                              min={0.1}
                              step={0.5}
                              onChange={(e) => setPosStep(Math.max(0.1, Number(e.target.value) || 0.1))}
                            />
                            <span className="dm-teach-unit">mm</span>
                          </span>
                        </div>
                        {JOG_POS_AXES.map((axis) => (
                          <div className="dm-teach-jog-row" key={axis}>
                            <span className="dm-teach-axis">{axisLabel(axis)}</span>
                            <button
                              className="dm-teach-jog-btn"
                              disabled={!teachConnected}
                              title={teachConnected ? `Jog ${axisLabel(axis)} −${posStep}mm` : 'Robot not connected'}
                              onClick={() => handleJog(axis, -1)}
                            >−</button>
                            <button
                              className="dm-teach-jog-btn"
                              disabled={!teachConnected}
                              title={teachConnected ? `Jog ${axisLabel(axis)} +${posStep}mm` : 'Robot not connected'}
                              onClick={() => handleJog(axis, 1)}
                            >+</button>
                          </div>
                        ))}
                      </div>

                      {/* Jog — Orientation */}
                      <div className="dm-teach-section">
                        <div className="dm-teach-label-row">
                          <span className="dm-teach-label">Jog — Orientation</span>
                          <span className="dm-teach-step-wrap">
                            <input
                              type="number"
                              className="dm-teach-step-input"
                              value={rotStep}
                              min={0.1}
                              step={0.5}
                              onChange={(e) => setRotStep(Math.max(0.1, Number(e.target.value) || 0.1))}
                            />
                            <span className="dm-teach-unit">deg</span>
                          </span>
                        </div>
                        {JOG_ROT_AXES.map((axis) => (
                          <div className="dm-teach-jog-row" key={axis}>
                            <span className="dm-teach-axis">{axisLabel(axis)}</span>
                            <button
                              className="dm-teach-jog-btn"
                              disabled={!teachConnected}
                              title={teachConnected ? `Jog ${axisLabel(axis)} −${rotStep}deg` : 'Robot not connected'}
                              onClick={() => handleJog(axis, -1)}
                            >−</button>
                            <button
                              className="dm-teach-jog-btn"
                              disabled={!teachConnected}
                              title={teachConnected ? `Jog ${axisLabel(axis)} +${rotStep}deg` : 'Robot not connected'}
                              onClick={() => handleJog(axis, 1)}
                            >+</button>
                          </div>
                        ))}
                      </div>

                      {/* Grid size */}
                      <div className="dm-teach-section">
                        <span className="dm-teach-label">Grid size</span>
                        <div className="dm-teach-grid-size-row">
                          <label className="dm-teach-grid-field">
                            <span>Rows</span>
                            <input
                              type="number"
                              className="dm-teach-grid-input"
                              value={gridRows}
                              min={2}
                              max={7}
                              onChange={(e) => setGridRows(clampInt(e.target.value, 2, 7))}
                            />
                          </label>
                          <label className="dm-teach-grid-field">
                            <span>Cols</span>
                            <input
                              type="number"
                              className="dm-teach-grid-input"
                              value={gridCols}
                              min={2}
                              max={7}
                              onChange={(e) => setGridCols(clampInt(e.target.value, 2, 7))}
                            />
                          </label>
                        </div>
                        <div className="dm-teach-grid-actions">
                          <button
                            className="dm-teach-action-btn"
                            disabled={!teachConnected}
                            title={teachConnected ? 'Apply grid size' : 'Robot not connected'}
                            onClick={handleSetGrid}
                          >Set Grid</button>
                          <button
                            className="dm-teach-action-btn dm-teach-action-btn--danger"
                            disabled={!teachConnected}
                            title={teachConnected ? 'Clear all taught points' : 'Robot not connected'}
                            onClick={handleResetGrid}
                          >Reset Grid</button>
                        </div>
                      </div>

                      {/* Grid cells */}
                      <div className="dm-teach-section">
                        <span className="dm-teach-label">Grid cells</span>
                        <div className="dm-teach-cells" style={{ gridTemplateColumns: `repeat(${gCols}, 1fr)` }}>
                          {Array.from({ length: gRows }).map((_, i) =>
                            Array.from({ length: gCols }).map((_, j) => {
                              const marked = !!(gridPoints && gridPoints[i] && gridPoints[i][j])
                              return (
                                <button
                                  key={`${i}-${j}`}
                                  className={`dm-teach-cell${marked ? ' dm-teach-cell--marked' : ''}`}
                                  disabled={!teachConnected}
                                  title={teachConnected ? `Record current pose into R${i + 1}C${j + 1}` : 'Robot not connected'}
                                  onClick={() => handleMarkCell(i + 1, j + 1)}
                                >
                                  {`R${i + 1}C${j + 1}`}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>

                      {/* Grid status line */}
                      <div className="dm-teach-grid-status">
                        {`grid ${gRows}x${gCols} — ${markedCount}/${gRows * gCols} marked`}
                        {gridValidate && ` · rmse=${gridValidate.rmse_mm}mm`}
                        {gridValidate && Array.isArray(gridValidate.warnings) && gridValidate.warnings.length > 0 &&
                          ` · ${gridValidate.warnings.join('; ')}`}
                      </div>

                      {/* Grid shape preview */}
                      <svg viewBox="0 0 200 200" className="dm-teach-shape-svg">
                        {gridShapeEls || (
                          <text x="100" y="104" textAnchor="middle" className="dm-teach-shape-empty">
                            mark all corners to preview shape
                          </text>
                        )}
                      </svg>

                      {/* Inline action message */}
                      {teachMsg && (
                        <div className={`dm-teach-msg dm-teach-msg--${teachMsg.kind}`}>
                          {teachMsg.text}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Bottom Toolbar ── */}
            <div className="dm-bottom-bar">

              {/* Tools */}
              <div className="dm-bar-group">
                {TOOL_META.map((t) => (
                  <button
                    key={t.id}
                    id={`tool-${t.id}`}
                    className={`dm-bar-btn ${activeTool === t.id ? 'dm-bar-btn--active' : ''}`}
                    title={t.label}
                    onClick={() => setActiveTool(t.id)}
                  >
                    <span style={{ fontSize: 20 }}>{t.icon}</span>
                    <span style={{ fontSize: 9, fontWeight: 700 }}>{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="dm-bar-sep" />

              {/* Colors */}
              <div className="dm-bar-group">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`dm-dot ${strokeColor === c ? 'dm-dot--active' : ''}`}
                    style={{ background: c, border: c === '#ffffff' ? '1.5px solid #aac8e8' : `1.5px solid ${c}` }}
                    title={c}
                    onClick={() => setStrokeColor(c)}
                  />
                ))}
                <input
                  id="stroke-color-picker"
                  type="color"
                  value={strokeColor}
                  onChange={(e) => setStrokeColor(e.target.value)}
                  className="dm-bar-color-input"
                  title="Custom color"
                />
              </div>

              <div className="dm-bar-sep" />

              {/* Widths */}
              <div className="dm-bar-group">
                {STROKE_WIDTHS.map((w) => (
                  <button
                    key={w}
                    id={`stroke-width-${w}`}
                    className={`dm-bar-w-btn ${strokeWidth === w ? 'dm-bar-btn--active' : ''}`}
                    title={`${w}px`}
                    onClick={() => setStrokeWidth(w)}
                  >{w}</button>
                ))}
              </div>

              <div className="dm-bar-sep" />

              {/* Actions */}
              <div className="dm-bar-group">
                <button id="btn-undo"        className="dm-bar-btn" onClick={undo}         disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
                <button id="btn-redo"        className="dm-bar-btn" onClick={redo}         disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
                <button id="btn-clear"       className="dm-bar-btn dm-bar-btn--danger" onClick={clearCanvas}  title="Clear all">✕</button>
                <button id="btn-export-png"  className="dm-bar-btn" onClick={exportPNG}    title="Export PNG">⬇</button>
                <button
                  id="btn-send-robot"
                  className={`dm-bar-send ${isSending ? 'dm-bar-send--busy' : ''}`}
                  onClick={sendToRobot}
                  disabled={isSending}
                  title="Send paths to Robot"
                >
                   {isSending ? '…' : 'Send'}
                </button>
              </div>

              {/* Status */}
              <div className="dm-bar-sep" />
              <span className="dm-bottom-status">
                <span className="dm-status-bar-tool">{activeTool}</span>
                &nbsp;·&nbsp;{objectCount} obj&nbsp;·&nbsp;{status}
              </span>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default DrawingModePage

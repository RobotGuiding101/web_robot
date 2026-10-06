import React, { useEffect, useRef, useState, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import {
  Canvas,
  PencilBrush,
  Line,
  Point,
  Polyline,
} from 'fabric'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import { setStreamMode } from '../components/CameraStream'
import { backendToolFor, evaluateReportGate } from './reportGate'
import { shapePoints } from '../lib/shapes'

// ─── Tool constants ────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT: 'select',
  PEN: 'pen',
  LINE: 'line',
  RECTANGLE: 'rectangle',
  TRIANGLE: 'triangle',
  CIRCLE: 'circle',
}

const TOOL_META = [
  { id: TOOLS.SELECT, label: 'Select', icon: '↖' },
  { id: TOOLS.PEN, label: 'Pen', icon: '✎' },
  { id: TOOLS.LINE, label: 'Line', icon: '╱' },
  { id: TOOLS.RECTANGLE, label: 'Rectangle', icon: '□' },
  { id: TOOLS.TRIANGLE, label: 'Triangle', icon: '△' },
  { id: TOOLS.CIRCLE, label: 'Circle', icon: '○' },
]

const PRESET_COLORS = [
  '#1a2f45', '#1a8fe3', '#ef4444', '#22c55e',
  '#f59e0b', '#7c3aed', '#ec4899', '#000000', '#ffffff',
]

const STROKE_WIDTHS = [1, 2, 4, 8, 16]

// Grid Mapping test points, as fractions of the taught area. The four corners
// are deliberately absent: those are the taught poses themselves, so their
// error is zero by construction and testing them proves nothing. What is left
// is the plus-shaped interior, which is exactly where bilinear interpolation
// has to be right.
const TEST_POINT_POSITIONS = [
  { u: 0.25, v: 0.5, label: 'ซ้ายกลาง' },
  { u: 0.5, v: 0.25, label: 'บนกลาง' },
  { u: 0.5, v: 0.5, label: 'กลาง' },
  { u: 0.5, v: 0.75, label: 'ล่างกลาง' },
  { u: 0.75, v: 0.5, label: 'ขวากลาง' },
]

// ─── Teach / Grid panel constants ─────────────────────────────────────────────
const POSE_LABELS = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz']
const JOG_POS_AXES = ['x', 'y', 'z']
const JOG_ROT_AXES = ['rx', 'ry', 'rz']
const JOG_JOINT_AXES = [1, 2, 3, 4, 5, 6]
const JOG_SPEED = 10

const axisLabel = (a) => a.charAt(0).toUpperCase() + a.slice(1)
const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)))

const JogPillRow = ({ label, onMinus, onPlus, disabled, titleMinus, titlePlus }) => (
  <div className="jog-row">
    <button className="jog-pill jog-pill--minus" onClick={onMinus} disabled={disabled} title={titleMinus}>
      <span className="jog-axis-badge">{label}</span>
      <span className="jog-sign">−</span>
    </button>
    <button className="jog-pill jog-pill--plus" onClick={onPlus} disabled={disabled} title={titlePlus}>
      <span className="jog-axis-badge">{label}</span>
      <span className="jog-sign">+</span>
    </button>
  </div>
)

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pathObjectPoints(obj) {
  const matrix = obj.calcTransformMatrix()
  const offset = obj.pathOffset || new Point(0, 0)
  const points = []
  let current = new Point(0, 0)
  let subpathStart = current

  const addPoint = (x, y) => {
    const localX = x - offset.x
    const localY = y - offset.y
    points.push(new Point(
      matrix[0] * localX + matrix[2] * localY + matrix[4],
      matrix[1] * localX + matrix[3] * localY + matrix[5],
    ))
  }

  for (const command of obj.path || []) {
    const [rawType, ...values] = command
    const type = rawType.toUpperCase()
    const relative = rawType !== type
    const value = (index, base) => (relative ? base : 0) + Number(values[index])

    if (type === 'M' || type === 'L') {
      current = new Point(value(0, current.x), value(1, current.y))
      if (type === 'M') subpathStart = current
      addPoint(current.x, current.y)
    } else if (type === 'H') {
      current = new Point(value(0, current.x), current.y)
      addPoint(current.x, current.y)
    } else if (type === 'V') {
      current = new Point(current.x, value(0, current.y))
      addPoint(current.x, current.y)
    } else if (type === 'Q') {
      const control = new Point(value(0, current.x), value(1, current.y))
      const end = new Point(value(2, current.x), value(3, current.y))
      const start = current
      for (let step = 1; step <= 4; step += 1) {
        const t = step / 4
        const inverse = 1 - t
        addPoint(
          inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
          inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
        )
      }
      current = end
    } else if (type === 'C') {
      const control1 = new Point(value(0, current.x), value(1, current.y))
      const control2 = new Point(value(2, current.x), value(3, current.y))
      const end = new Point(value(4, current.x), value(5, current.y))
      const start = current
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8
        const inverse = 1 - t
        addPoint(
          inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
          inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
        )
      }
      current = end
    } else if (type === 'Z') {
      current = subpathStart
      addPoint(current.x, current.y)
    }
  }
  return points
}

function getCanvasPathData(fc) {
  return fc.getObjects().map((obj) => {
    const type = obj.type
    const base = { type, left: obj.left, top: obj.top }
    if (type === 'path') return { ...base, points: pathObjectPoints(obj), stroke: obj.stroke, strokeWidth: obj.strokeWidth }
    if (type === 'line') return { ...base, x1: obj.x1, y1: obj.y1, x2: obj.x2, y2: obj.y2, stroke: obj.stroke, strokeWidth: obj.strokeWidth }
    if (type === 'polyline' && obj.pathOffset) {
      const matrix = obj.calcTransformMatrix()
      return {
        ...base,
        intendedTool: obj.intendedTool,
        points: obj.points.map((point) => {
          const x = point.x - obj.pathOffset.x
          const y = point.y - obj.pathOffset.y
          return new Point(
            matrix[0] * x + matrix[2] * y + matrix[4],
            matrix[1] * x + matrix[3] * y + matrix[5],
          )
        }),
      }
    }
    return base
  })
}

// ─── Server Log Panel ─────────────────────────────────────────────────────────
const SERVER_LOG_MAX = 200
const SERVER_LOG_POLL_MS = 700

const ServerLogPanel = () => {
  const [lines, setLines] = useState([])
  const [paused, setPaused] = useState(false)
  const [lastId, setLastId] = useState(0)
  const bottomRef = useRef(null)
  const pausedRef = useRef(false)
  const pendingRef = useRef([])
  const lastIdRef = useRef(0)
  pausedRef.current = paused

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, paused])

  useEffect(() => {
    let dead = false

    const fmt = (entry) => {
      const d = new Date(entry.t * 1000)
      const t = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      return { t, msg: entry.msg }
    }

    const poll = () => {
      if (dead) return
      apiFetch(`/api/map/logs?since=${lastIdRef.current}`)
        .then((r) => r.json())
        .then((data) => {
          if (dead || !Array.isArray(data.entries) || data.entries.length === 0) return
          if (typeof data.latest === 'number') lastIdRef.current = data.latest
          const newLines = data.entries.map(fmt)
          if (pausedRef.current) {
            pendingRef.current.push(...newLines)
            return
          }
          setLines((prev) => {
            const next = [...prev, ...newLines]
            return next.length > SERVER_LOG_MAX ? next.slice(-SERVER_LOG_MAX) : next
          })
        })
        .catch(() => {})
    }

    // initial full load
    apiFetch('/api/map/logs')
      .then((r) => r.json())
      .then((data) => {
        if (!dead && Array.isArray(data.entries)) {
          if (typeof data.latest === 'number') lastIdRef.current = data.latest
          const initial = data.entries.map(fmt)
          setLines(initial.length > SERVER_LOG_MAX ? initial.slice(-SERVER_LOG_MAX) : initial)
        }
      })
      .catch(() => {})

    const interval = setInterval(poll, SERVER_LOG_POLL_MS)
    return () => { dead = true; clearInterval(interval) }
  }, [])

  const handleResume = useCallback(() => {
    setPaused(false)
    if (pendingRef.current.length) {
      setLines((prev) => {
        const next = [...prev, ...pendingRef.current]
        pendingRef.current = []
        return next.length > SERVER_LOG_MAX ? next.slice(-SERVER_LOG_MAX) : next
      })
    }
  }, [])

  const handleClear = useCallback(() => {
    setLines([])
    pendingRef.current = []
  }, [])

  return (
    <div className="log-panel-box log-panel-box--server">
      <div className="log-panel-header">
        <span className="log-panel-title">Server Log</span>
        <div className="log-panel-actions">
          {paused
            ? <button className="log-btn log-btn--resume" onClick={handleResume}>Resume</button>
            : <button className="log-btn log-btn--pause" onClick={() => setPaused(true)}>Pause</button>
          }
          <button className="log-btn log-btn--clear" onClick={handleClear}>Clear</button>
        </div>
      </div>
      <div className="log-panel-body" id="log-server">
        {lines.length === 0
          ? <span className="log-empty">No log entries yet…</span>
          : lines.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{l.t}</span>
              <span className="log-msg">{l.msg}</span>
            </div>
          ))
        }
        <div ref={bottomRef} />
      </div>
      {paused && pendingRef.current.length > 0 && (
        <div className="log-paused-banner">
          Paused — {pendingRef.current.length} new line{pendingRef.current.length > 1 ? 's' : ''} waiting
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DrawingModePage = () => {
  const canvasElRef = useRef(null)
  const dmViewportRef = useRef(null)
  const fabricRef = useRef(null)
  const isDrawingRef = useRef(false)
  const tempObjRef = useRef(null)
  const startPtRef = useRef({ x: 0, y: 0 })
  const mouseDownRef = useRef(null)
  const mouseMoveRef = useRef(null)
  const mouseUpRef = useRef(null)

  const [activeTool, setActiveTool] = useState(TOOLS.PEN)
  const [strokeColor, setStrokeColor] = useState('#1a2f45')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [objectCount, setObjectCount] = useState(0)
  const [isSending, setIsSending] = useState(false)

  // 3D Robot Model Floating Viewer
  const viewerKey = useRef(Date.now())
  const [is3DMinimized, setIs3DMinimized] = useState(false)
  const [is3DExpanded, setIs3DExpanded] = useState(false)
  const [floating3DPos, setFloating3DPos] = useState(null)
  const [isDragging3D, setIsDragging3D] = useState(false)
  const floating3DRef = useRef(null)
  const dragRef = useRef({ startX: 0, startY: 0, startLeft: 0, startTop: 0, hasMoved: false })

  const handle3DDragStart = (e) => {
    if (e.target.closest('button.dm-3d-btn')) return
    e.preventDefault()

    const floatingEl = floating3DRef.current
    const viewportEl = dmViewportRef.current
    if (!floatingEl || !viewportEl) return

    const fRect = floatingEl.getBoundingClientRect()
    const vRect = viewportEl.getBoundingClientRect()

    const currentLeft = fRect.left - vRect.left
    const currentTop = fRect.top - vRect.top

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: currentLeft,
      startTop: currentTop,
      hasMoved: false,
    }
    setIsDragging3D(true)

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - dragRef.current.startX
      const dy = moveEvent.clientY - dragRef.current.startY
      if (!dragRef.current.hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        dragRef.current.hasMoved = true
      }

      const curViewportEl = dmViewportRef.current
      const curFloatingEl = floating3DRef.current
      if (!curViewportEl || !curFloatingEl) return

      const vpW = curViewportEl.clientWidth
      const vpH = curViewportEl.clientHeight
      const boxW = curFloatingEl.offsetWidth
      const boxH = curFloatingEl.offsetHeight

      const nextX = Math.max(0, Math.min(vpW - boxW, dragRef.current.startLeft + dx))
      const nextY = Math.max(0, Math.min(vpH - boxH, dragRef.current.startTop + dy))

      setFloating3DPos({ x: nextX, y: nextY })
    }

    const onPointerUp = () => {
      setIsDragging3D(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
  }

  // Keep floating 3D viewer in bounds when expanding
  useEffect(() => {
    if (!floating3DPos || !dmViewportRef.current || !floating3DRef.current) return
    const vpW = dmViewportRef.current.clientWidth
    const vpH = dmViewportRef.current.clientHeight
    const boxW = is3DExpanded ? 340 : 220
    const boxH = is3DExpanded ? 280 : 180
    setFloating3DPos((prev) => {
      if (!prev) return prev
      const clampedX = Math.max(0, Math.min(vpW - boxW, prev.x))
      const clampedY = Math.max(0, Math.min(vpH - boxH, prev.y))
      if (clampedX === prev.x && clampedY === prev.y) return prev
      return { x: clampedX, y: clampedY }
    })
  }, [is3DExpanded])

  // Camera mode switcher
  const [cameraMode,  setCameraMode]  = useState('rgb')
  const [modeLoading, setModeLoading] = useState(false)

  // Teach / Grid Floating Panel
  const [panelTab, setPanelTab] = useState('align') // 'align' | 'jog' | 'grid' | 'draw'
  const [jogMode, setJogMode] = useState('pos')   // 'pos' | 'rot' | 'joint'
  const [isTeachMinimized, setIsTeachMinimized] = useState(false)
  const [teachStatus, setTeachStatus] = useState(null)
  const [posStep, setPosStep] = useState(5)
  const [rotStep, setRotStep] = useState(2)
  const [gridRows, setGridRows] = useState(2)
  const [gridCols, setGridCols] = useState(2)
  const [teachMsg, setTeachMsg] = useState(null)
  const teachMsgTimerRef = useRef(null)
const [markMode, setMarkMode] = useState(false)
const [markClickMode, setMarkClickMode] = useState('mark')
const [testPoints, setTestPoints] = useState([])
  const [testAggregates, setTestAggregates] = useState(null)
  const [reportGate, setReportGate] = useState(null)
const [testReportBusy, setTestReportBusy] = useState(false)
  const [alignBusy, setAlignBusy] = useState(false)
  const [markGeom, setMarkGeom] = useState(null)
  const [jointStep, setJointStep] = useState(2)
  const [jogBusy, setJogBusy] = useState(false)
  const [toolIndex, setToolIndex] = useState(0)
  const [userIndex, setUserIndex] = useState(0)
  const [frameMsg, setFrameMsg] = useState(null)
  const frameDirtyRef = useRef(false)

  // ── Clear Error / Init / Home ─────────────────────────────────────────────
  const [errorStatus, setErrorStatus] = useState(null) // 'ok' | 'error' | null
  const [initLoading, setInitLoading] = useState(false)
  const [initStatus,  setInitStatus]  = useState(null)
  const [homeLoading, setHomeLoading] = useState(false)
  const [homeStatus,  setHomeStatus]  = useState(null)

  // Refs for latest state values (avoid stale closures)
  const strokeColorRef = useRef(strokeColor)
  const strokeWidthRef = useRef(strokeWidth)
  useEffect(() => { strokeColorRef.current = strokeColor }, [strokeColor])
  useEffect(() => { strokeWidthRef.current = strokeWidth }, [strokeWidth])

  // History stacks
  const historyRef = useRef([])
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

    const updateSelection = () => setHasSelection(fc.getActiveObjects().length > 0)
    fc.on('selection:created', updateSelection)
    fc.on('selection:updated', updateSelection)
    fc.on('selection:cleared', updateSelection)

    // Initial history snapshot
    historyRef.current = [fc.toJSON()]
    historyIdxRef.current = 0

    fc.on('object:added', updateCounts)
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
      fc.off('selection:created', updateSelection)
      fc.off('selection:updated', updateSelection)
      fc.off('selection:cleared', updateSelection)
      fc.dispose()
    }
  }, [updateCounts])

  // ── Detach shape mouse listeners helper ───────────────────────────────────
  const detachMouseListeners = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    if (mouseDownRef.current) { fc.off('mouse:down', mouseDownRef.current); mouseDownRef.current = null }
    if (mouseMoveRef.current) { fc.off('mouse:move', mouseMoveRef.current); mouseMoveRef.current = null }
    if (mouseUpRef.current) { fc.off('mouse:up', mouseUpRef.current); mouseUpRef.current = null }
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

    // Shape tools create one object per stroke so the robot follows a continuous path.
    fc.isDrawingMode = false
    fc.selection = false
    fc.getObjects().forEach((o) => { o.selectable = false; o.evented = false })

    const onDown = (opt) => {
      isDrawingRef.current = true
      const ptr = fc.getScenePoint(opt.e)
      startPtRef.current = { x: ptr.x, y: ptr.y }
      const sc = strokeColorRef.current
      const sw = strokeWidthRef.current

      if (activeTool === TOOLS.LINE) {
        const line = new Line([ptr.x, ptr.y, ptr.x, ptr.y], {
          stroke: sc, strokeWidth: sw, selectable: false, evented: false,
        })
        fc.add(line)
        tempObjRef.current = line
      }
    }

    const onMove = (opt) => {
      if (!isDrawingRef.current) return
      const ptr = fc.getScenePoint(opt.e)
      if (activeTool === TOOLS.LINE) {
        if (!tempObjRef.current) return
        tempObjRef.current.set({ x2: ptr.x, y2: ptr.y })
      } else {
        if (tempObjRef.current) fc.remove(tempObjRef.current)
        const polyline = new Polyline(shapePoints(activeTool, startPtRef.current, ptr), {
          fill: 'rgba(0,0,0,0)',
          stroke: strokeColorRef.current,
          strokeWidth: strokeWidthRef.current,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          selectable: false,
          evented: false,
          objectCaching: false,
        })
        // Fabric's own type cannot tell a rectangle from a circle — both are
        // Polyline — so the tool that produced it is stashed here for
        // backendToolFor() to send. Without it every shape is reported as
        // freehand and reaches the backend's Douglas-Peucker simplifier.
        polyline.intendedTool = activeTool
        fc.add(polyline)
        tempObjRef.current = polyline
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
    fc.on('mouse:up', onUp)
    mouseDownRef.current = onDown
    mouseMoveRef.current = onMove
    mouseUpRef.current = onUp

  }, [activeTool, detachMouseListeners, saveHistory, strokeColor, strokeWidth])

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
    setHasSelection(false)
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
    setHasSelection(false)
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
        if (obj.type === 'path' && obj.points) {
          obj.points.forEach((point) => points.push([point.x / cw, point.y / ch]))
        } else if (obj.type === 'line') {
          points.push([obj.x1 / cw, obj.y1 / ch], [obj.x2 / cw, obj.y2 / ch])
        } else if (obj.type === 'polyline' && obj.points) {
          obj.points.forEach((point) => points.push([point.x / cw, point.y / ch]))
        }
        return { tool: backendToolFor(obj), points }
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

  const stopDraw = useCallback(async () => {
    try {
      await apiFetch('/api/map/draw/stop', { method: 'POST' })
      setStatus('Stop requested')
    } catch {
      setStatus('Stop request failed')
    }
  }, [])

  // ── Camera mode switcher ──────────────────────────────────────────────────
  const handleModeChange = useCallback(async (newMode) => {
    if (cameraMode === newMode || modeLoading) return
    setModeLoading(true)
    try {
      const res = await apiFetch('/api/camera/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok) {
          setCameraMode(data.mode)
          setStreamMode(data.mode)
        }
      }
    } catch { /* ignore */ }
    finally { setModeLoading(false) }
  }, [cameraMode, modeLoading])

  // ── Emergency Stop ────────────────────────────────────────────────────────
  const handleEmergency = () => {
    apiFetch('/api/map/error', { method: 'POST' }).catch(() => { })
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
      const data = await res.json()
      setTeachStatus(data)
      if (!frameDirtyRef.current) {
        if (data.tool_index !== undefined && data.tool_index !== null) setToolIndex(data.tool_index)
        if (data.user_index !== undefined && data.user_index !== null) setUserIndex(data.user_index)
      }
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
    setJogBusy(true)
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
    } finally {
      setJogBusy(false)
    }
    setTimeout(fetchTeachStatus, 500)
  }, [teachStatus, posStep, rotStep, showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: set grid size ──────────────────────────────────────────
  const handleSetGrid = useCallback(async () => {
    const curRows = (teachStatus && teachStatus.grid_rows) || 2
    const curCols = (teachStatus && teachStatus.grid_cols) || 2
    if (gridRows === curRows && gridCols === curCols) {
      showTeachMsg(`Grid ${curRows}x${curCols} unchanged — marks kept`)
      return
    }
    const gp = (teachStatus && teachStatus.grid_points) || []
    const marked = gp.flat().filter(Boolean).length
    if (marked > 0 && !window.confirm(
      `เปลี่ยนขนาด grid เป็น ${gridRows}x${gridCols} จะล้าง ${marked} ช่องที่ mark ไว้ — ยืนยัน?`
    )) return
    try {
      const res = await apiFetch('/api/map/grid/size', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: gridRows, cols: gridCols }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Grid set to ${data.rows}x${data.cols} (marks cleared)`)
      } else {
        showTeachMsg((data && data.error) || 'Set grid failed', 'error')
      }
    } catch {
      showTeachMsg('Set grid request failed', 'error')
    }
    fetchTeachStatus()
  }, [gridRows, gridCols, teachStatus, showTeachMsg, fetchTeachStatus])

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

  const teachConnected = !!(teachStatus && teachStatus.connected)

  const refreshReportGate = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/test-report')
      const data = await res.json()
      setReportGate(evaluateReportGate({ report: data, positions: TEST_POINT_POSITIONS }))
    } catch {
      setReportGate(null)
    }
  }, [])

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
    refreshReportGate()
  }, [teachStatus, showTeachMsg, fetchTeachStatus, refreshReportGate])

  useEffect(() => {
    if (panelTab === 'grid' && teachConnected) refreshReportGate()
  }, [panelTab, teachConnected, testPoints.length, refreshReportGate])

  // ── Grid Mapping test points + experiment-record download ────────────────
  const handleRecordTestPoint = useCallback(async (u, v, measuredText) => {
    const payload = { u, v }
    const typed = String(measuredText || '').trim()
    if (typed) {
      const parts = typed.split(',').map((n) => Number(n.trim()))
      if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
        showTeachMsg('ค่าที่วัดเองต้องเป็นตัวเลข 3 ตัวคั่นด้วยจุลภาค เช่น -142.4, -436.5, 145.6', 'error')
        return
      }
      payload.actual = parts
    }
    // Only the robot's own reading needs the link; a value the operator
    // measured is already here and must be recordable either way.
    if (!payload.actual && (!teachStatus || !teachStatus.connected)) return
    try {
      const res = await apiFetch('/api/map/grid/test-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        setTestPoints((prev) => [...prev, data.test_point])
        setTestAggregates(data.aggregates || null)
        refreshReportGate()
      } else {
        showTeachMsg((data && data.error) || 'Record test point failed', 'error')
      }
    } catch {
      showTeachMsg('Record test point request failed', 'error')
    }
  }, [teachStatus, showTeachMsg, refreshReportGate])

  const handleResetTestPoints = useCallback(async () => {
    try {
      await apiFetch('/api/map/grid/test-reset', { method: 'POST' })
      setTestPoints([])
      showTeachMsg('Test points cleared')
    } catch {
      showTeachMsg('Reset test points failed', 'error')
    }
    refreshReportGate()
  }, [showTeachMsg, refreshReportGate])

  const [measured, setMeasured] = useState({})
  const [verifyBusy, setVerifyBusy] = useState(false)
  const verifySawBusy = useRef(false)

  const handleVerifyGrid = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/verify', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        showTeachMsg((data && data.error) || 'เริ่มวัดความแม่นยำไม่สำเร็จ', 'error')
        return
      }
      setVerifyBusy(true)
      showTeachMsg('กำลังวัด 5 จุด — อย่าขยับแขน กด E-Stop ได้ทันที')
    } catch {
      showTeachMsg('เริ่มวัดความแม่นยำไม่สำเร็จ', 'error')
    }
  }, [showTeachMsg])

  useEffect(() => {
    if (!verifyBusy) {
      verifySawBusy.current = false
      return
    }
    if (teachStatus && teachStatus.draw_running) {
      verifySawBusy.current = true
      return
    }
    // Wait for busy=true first: the next status poll can land before the
    // worker thread has set the flag, and treating that as "finished" would
    // report a result for a run that never started.
    if (!verifySawBusy.current) return
    verifySawBusy.current = false
    setVerifyBusy(false)
    setTestPoints([])
    setTestAggregates(null)
    refreshReportGate()
    showTeachMsg('วัดความแม่นยำเสร็จแล้ว')
  }, [verifyBusy, teachStatus, refreshReportGate, showTeachMsg])

  const handleDownloadReport = useCallback(async () => {
    setTestReportBusy(true)
    try {
      const res = await apiFetch('/api/map/test-report')
      const data = await res.json()
      const gate = evaluateReportGate({ report: data, positions: TEST_POINT_POSITIONS })
      setReportGate(gate)
      if (!gate.canDownload) {
        showTeachMsg(`ยังบันทึกไม่ได้ — ${gate.reasons.join(' / ')}`, 'error')
        return
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const stamp = String(data.generated_at || '').replace(/\D/g, '') || 'report'
      const a = document.createElement('a')
      a.href = url
      a.download = `grid_test_report_${stamp}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus('✓ บันทึกไฟล์ผลการทดสอบแล้ว')
    } catch {
      setStatus('✗ บันทึกไฟล์ไม่สำเร็จ')
    } finally {
      setTestReportBusy(false)
    }
  }, [showTeachMsg])

  const markCamW = (teachStatus && teachStatus.cam_w) || 848
  const markCamH = (teachStatus && teachStatus.cam_h) || 480
  const markPoints = (teachStatus && Array.isArray(teachStatus.points)) ? teachStatus.points : []
  const teachRobotEnabled = !!(teachStatus && teachStatus.robot_enabled)
  const teachRobotCanMove = teachConnected && teachRobotEnabled
  const cameraReady = !!(teachStatus && teachStatus.camera_running)
  const robotBusy = !!(teachStatus && (
    teachStatus.align_running || teachStatus.draw_running || teachStatus.sequence_running
  ))
  const markReady = teachConnected && cameraReady
  const canMark = !!(markReady && markGeom && markMode && !robotBusy
    && (markClickMode !== 'goto' || teachRobotEnabled))
  const fmtMark = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d))

  const measureMark = useCallback(() => {
    const el = document.getElementById('global-camera-stream')
    const vp = dmViewportRef.current
    if (!el || !vp) return null
    const r = el.getBoundingClientRect()
    const vr = vp.getBoundingClientRect()
    const sw = el.width || 640
    const sh = el.height || 360
    if (!r.width || !r.height || !sw || !sh) return null
    const scale = Math.min(r.width / sw, r.height / sh)
    return {
      sw, sh, scale, vr,
      left: r.left - vr.left + (r.width - sw * scale) / 2,
      top: r.top - vr.top + (r.height - sh * scale) / 2,
    }
  }, [])

  const computeMarkGeom = useCallback(() => {
    const m = measureMark()
    setMarkGeom(m ? { sw: m.sw, sh: m.sh, scale: m.scale, left: m.left, top: m.top } : null)
  }, [measureMark])

  useEffect(() => {
    computeMarkGeom()
    const t = setTimeout(computeMarkGeom, 400)
    window.addEventListener('resize', computeMarkGeom)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', computeMarkGeom)
    }
  }, [computeMarkGeom, markCamW, markCamH, markMode])

  const handleMarkClick = useCallback(async (e) => {
    if (!markMode) return
    const m = measureMark()
    if (!m || !teachStatus || !teachStatus.connected || !teachStatus.camera_running) return
    const sx = (e.clientX - m.vr.left - m.left) / m.scale
    const sy = (e.clientY - m.vr.top - m.top) / m.scale
    if (sx < 0 || sy < 0 || sx > m.sw || sy > m.sh) return
    const x = Math.round(sx * markCamW / m.sw)
    const y = Math.round(sy * markCamH / m.sh)
    try {
      const res = await apiFetch(markClickMode === 'goto' ? '/api/map/goto' : '/api/map/point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok !== false) {
        showTeachMsg(markClickMode === 'goto' ? `Goto (${x}, ${y})` : `Marked (${x}, ${y})`)
        if (markClickMode === 'mark') {
          setTeachStatus((s) => {
            if (!s) return s
            const prev = Array.isArray(s.points) ? s.points : []
            return { ...s, points: [...(prev.length >= 4 ? [] : prev), [x, y]] }
          })
        }
      } else {
        showTeachMsg((data && data.error) || 'Request failed', 'error')
      }
    } catch {
      showTeachMsg('Request failed', 'error')
    }
    fetchTeachStatus()
  }, [markMode, measureMark, teachStatus, markCamW, markCamH, markClickMode, showTeachMsg, fetchTeachStatus])

  const alignAction = useCallback(async (url, okText) => {
    setAlignBusy(true)
    try {
      const res = await apiFetch(url, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok !== false) {
        showTeachMsg(okText)
        if (url.endsWith('/reset_points')) {
          setTeachStatus((s) => (s ? { ...s, points: [] } : s))
        }
      } else showTeachMsg((data && data.error) || 'Request failed', 'error')
    } catch {
      showTeachMsg('Request failed', 'error')
    } finally {
      setAlignBusy(false)
      fetchTeachStatus()
    }
  }, [showTeachMsg, fetchTeachStatus])

  const handleJogJoint = useCallback(async (joint, sign) => {
    if (!teachStatus || !teachStatus.connected) return
    const amount = sign * Math.max(0.1, Number(jointStep) || 0.1)
    setJogBusy(true)
    try {
      const res = await apiFetch('/api/map/jog_joint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joint, amount, speed: JOG_SPEED }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || (data && data.ok === false)) {
        showTeachMsg((data && data.error) || 'Joint jog rejected', 'error')
      }
    } catch {
      showTeachMsg('Joint jog request failed', 'error')
    } finally {
      setJogBusy(false)
    }
    setTimeout(fetchTeachStatus, 500)
  }, [teachStatus, jointStep, showTeachMsg, fetchTeachStatus])

  const handleApplyFrame = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool_index: Number(toolIndex), user_index: Number(userIndex) }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok !== false) {
        setFrameMsg({ kind: 'ok', text: `Tool ${data.tool_index} / User ${data.user_index}` })
        frameDirtyRef.current = false
      } else {
        setFrameMsg({ kind: 'error', text: (data && data.error) || 'Frame failed' })
      }
    } catch {
      setFrameMsg({ kind: 'error', text: 'Frame request failed' })
    }
    setTimeout(() => setFrameMsg(null), 3000)
    fetchTeachStatus()
  }, [toolIndex, userIndex, fetchTeachStatus])

  // ── Clear Error / Init / Home callbacks ───────────────────────────────────
  const handleClearError = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/error', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setErrorStatus('ok')
      } else {
        setErrorStatus('error')
      }
    } catch {
      setErrorStatus('error')
    } finally {
      setTimeout(() => setErrorStatus(null), 3000)
    }
  }, [])

  const handleInit = useCallback(async () => {
    if (initLoading) return
    setInitLoading(true); setInitStatus(null)
    try {
      await apiFetch('/api/map/connect', { method: 'POST' })
      const res = await apiFetch('/api/map/init', { method: 'POST' })
      if (!res.ok) throw new Error()
      setInitStatus('ok')
    } catch { setInitStatus('error') }
    finally {
      setInitLoading(false)
      setTimeout(() => setInitStatus(null), 3000)
      fetchTeachStatus()
    }
  }, [initLoading, fetchTeachStatus])

  const handleGoHome = useCallback(async () => {
    if (homeLoading) return
    setHomeLoading(true); setHomeStatus(null)
    try {
      const res = await apiFetch('/api/map/home', { method: 'POST' })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Home move failed')
      setHomeStatus('ok')
    } catch { setHomeStatus('error') }
    finally {
      setHomeLoading(false)
      setTimeout(() => setHomeStatus(null), 3000)
      fetchTeachStatus()
    }
  }, [homeLoading, fetchTeachStatus])

  const robotAction = useCallback(async (url, okText) => {
    try {
      const res = await apiFetch(url, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok !== false) showTeachMsg(okText)
      else showTeachMsg((data && data.error) || 'Request failed', 'error')
    } catch {
      showTeachMsg('Request failed', 'error')
    }
    fetchTeachStatus()
  }, [showTeachMsg, fetchTeachStatus])

  const handleAutoFillGrid = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/autofill', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Auto-filled from 4 points (span=${Number(data.span_mm).toFixed(1)}mm)`)
      } else {
        showTeachMsg((data && data.error) || 'Auto-fill failed', 'error')
      }
    } catch {
      showTeachMsg('Auto-fill request failed', 'error')
    }
    fetchTeachStatus()
  }, [showTeachMsg, fetchTeachStatus])

  const handleSetGridZ = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/setz', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Grid Z set to ${Number(data.z).toFixed(1)}mm`)
      } else {
        showTeachMsg((data && data.error) || 'Set grid Z failed', 'error')
      }
    } catch {
      showTeachMsg('Set grid Z request failed', 'error')
    }
    fetchTeachStatus()
  }, [showTeachMsg, fetchTeachStatus])

  const handleSetGridZSurface = useCallback(async () => {
    if (!teachStatus || typeof teachStatus.z_surface !== 'number') return
    try {
      const res = await apiFetch('/api/map/grid/setz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ z: teachStatus.z_surface }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Grid Z = surface ${Number(data.z).toFixed(1)}mm`)
      } else {
        showTeachMsg((data && data.error) || 'Set surface Z failed', 'error')
      }
    } catch {
      showTeachMsg('Set surface Z request failed', 'error')
    }
    fetchTeachStatus()
  }, [teachStatus, showTeachMsg, fetchTeachStatus])

  const handleGridSurfaceZ = useCallback(async () => {
    try {
      const res = await apiFetch('/api/map/grid/surfacez', { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (res.ok && data && data.ok) {
        showTeachMsg(`Grid Z = surface ${Number(data.z).toFixed(1)}mm (depth ${Number(data.depth).toFixed(0)}mm)`)
      } else {
        showTeachMsg((data && data.error) || 'Surface-Z failed', 'error')
      }
    } catch {
      showTeachMsg('Surface-Z request failed', 'error')
    }
    fetchTeachStatus()
  }, [showTeachMsg, fetchTeachStatus])

  // ── Teach / Grid: derived view data ──────────────────────────────────────
  const teachPose = (teachStatus && Array.isArray(teachStatus.pose)) ? teachStatus.pose : null
  const gRows = (teachStatus && teachStatus.grid_rows) || gridRows
  const gCols = (teachStatus && teachStatus.grid_cols) || gridCols
  const gridPoints = teachStatus ? teachStatus.grid_points : null
  const gridValidate = teachStatus ? teachStatus.grid_validate : null
  const gridShape2d = teachStatus ? teachStatus.grid_shape_2d : null

  let markedCount = 0
  if (Array.isArray(gridPoints)) {
    gridPoints.forEach((row) => {
      if (Array.isArray(row)) row.forEach((p) => { if (p) markedCount += 1 })
    })
  }
  const gridComplete = Array.isArray(gridPoints)
    && gridPoints.length === gRows
    && gridPoints.every((row) => Array.isArray(row) && row.length === gCols && row.every(Boolean))
  const gridTooSmall = !!(gridComplete && gridValidate && Array.isArray(gridValidate.warnings)
    && gridValidate.warnings.some((warning) => /no size/i.test(warning)))
  const drawPrerequisite = !teachConnected
    ? 'Connect and initialize the robot first.'
    : !teachRobotEnabled
      ? 'Robot is connected but disabled; press Init/Enable before drawing.'
    : !gridComplete
      ? `Mark all ${gRows * gCols} grid cells first (${markedCount}/${gRows * gCols}).`
      : gridTooSmall
        ? 'Grid span is too small; teach points farther apart.'
        : objectCount === 0
          ? 'Draw at least one path on the canvas first.'
          : robotBusy
            ? 'Wait until the current robot motion finishes.'
            : 'Ready to send.'
  const alignPrerequisite = !teachConnected || !cameraReady
    ? 'Connect the robot and start the camera before marking or aligning.'
    : !teachRobotEnabled
      ? 'Enable the robot before alignment can move it.'
    : markPoints.length < 4
      ? `Mark 4 image corners before Align (${markPoints.length}/4).`
      : robotBusy
        ? 'Wait until the current robot motion finishes.'
        : 'Ready to align.'
  const autoFillPrerequisite = !teachConnected || !cameraReady
    ? 'Robot and camera must be connected.'
    : markPoints.length < 4
      ? `Mark 4 image corners first (${markPoints.length}/4).`
      : robotBusy
        ? 'Wait until robot motion finishes.'
      : 'Requires valid depth and camera intrinsics at all 4 corners.'
  const surfaceZPrerequisite = !teachConnected || !cameraReady
    ? 'Robot and camera must be connected.'
    : !gridComplete
      ? `Mark all ${gRows * gCols} grid cells first (${markedCount}/${gRows * gCols}).`
      : !(teachStatus && Number(teachStatus.last_center_depth) > 0)
        ? 'Mark the object in the live image to obtain a valid depth reading.'
        : robotBusy
          ? 'Wait until robot motion finishes.'
          : 'For accurate surface Z, align the camera square to the work surface first.'

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
      const offX = (200 - spanX * scale) / 2
      const offY = (200 - spanY * scale) / 2
      const toXY = (p) => [offX + (p.x - minX) * scale, offY + (p.y - minY) * scale]
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

            <div className="dm-main-row">

              {/* ── Camera + Canvas overlay (fills all remaining space) ── */}
              <div className="dm-viewport" ref={dmViewportRef}>

                {/* Fallback label when camera is offline */}
                <div className="dm-camera-offline">
                  <span>Camera 1 — offline</span>
                </div>

                {/* Fabric.js canvas — moved to Draw tab, kept in DOM always */}

                <div
                  className="dm-mark-hit"
                  style={{
                    pointerEvents: canMark && !robotBusy ? 'auto' : 'none',
                    cursor: canMark && !robotBusy ? 'crosshair' : 'default',
                  }}
                  onClick={handleMarkClick}
                  title={markMode
                    ? (robotBusy ? 'Wait for current robot motion to finish' : !markReady ? 'Robot and camera must be ready' : (markClickMode === 'mark' ? 'Click to add an image corner point' : 'Click to move robot to that pixel'))
                    : undefined}
                />
                {markMode && markGeom && markPoints.map(([px, py], i) => (
                  <div
                    key={i}
                    className="dm-mark-marker"
                    style={{
                      left: markGeom.left + (px * markGeom.sw / markCamW) * markGeom.scale,
                      top: markGeom.top + (py * markGeom.sh / markCamH) * markGeom.scale,
                    }}
                  >
                    {i + 1}
                  </div>
                ))}

                {/* ── Camera Mode Switcher (Top-Right) ── */}
                <div
                  style={{
                    position: 'absolute',
                    top: '14px',
                    right: '14px',
                    zIndex: 20,
                    display: 'flex',
                    background: 'rgba(0,0,0,0.68)',
                    borderRadius: '10px',
                    padding: '3px',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}
                >
                  {[
                    { id: 'rgb',   label: 'RGB',   active: '#2563eb' },
                    { id: 'gray',  label: 'Gray',  active: '#4b5563' },
                    { id: 'depth', label: 'Depth', active: '#dc2626' },
                  ].map(({ id, label, active }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleModeChange(id)}
                      disabled={modeLoading}
                      style={{
                        background: cameraMode === id ? active : 'transparent',
                        color: cameraMode === id ? '#fff' : '#aaa',
                        border: 'none',
                        borderRadius: '7px',
                        padding: '6px 14px',
                        fontSize: '13px',
                        fontWeight: cameraMode === id ? 700 : 500,
                        cursor: modeLoading ? 'not-allowed' : 'pointer',
                        transition: 'all 0.18s ease',
                      }}
                      title={`Switch to ${label}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* ── Floating 3D Robot Arm Model (Draggable) ── */}
                <div
                  ref={floating3DRef}
                  className={`dm-3d-floating${is3DMinimized ? ' dm-3d-floating--minimized' : ''}${is3DExpanded ? ' dm-3d-floating--expanded' : ''}${isDragging3D ? ' dm-3d-floating--dragging' : ''}`}
                  style={floating3DPos ? {
                    left: `${floating3DPos.x}px`,
                    top: `${floating3DPos.y}px`,
                    bottom: 'auto',
                    right: 'auto',
                  } : undefined}
                >
                  {is3DMinimized ? (
                    <button
                      className="dm-3d-minimized-btn"
                      onPointerDown={handle3DDragStart}
                      onClick={() => {
                        if (dragRef.current?.hasMoved) return
                        setIs3DMinimized(false)
                      }}
                      title="Show 3D Robot Model (ลากย้ายตำแหน่งได้)"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                    </button>
                  ) : (
                    <>
                      {/* Header bar (Drag Handle) */}
                      <div
                        className="dm-3d-header"
                        onPointerDown={handle3DDragStart}
                        onDoubleClick={() => setFloating3DPos(null)}
                        title="คลิกค้างเพื่อลากย้ายตำแหน่ง (ดับเบิลคลิกเพื่อรีเซ็ตกลับมุมเดิม)"
                      >
                        <div className="dm-3d-title-wrap">
                          <span className="dm-3d-drag-handle">⋮⋮</span>
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
                        {isDragging3D && <div className="dm-3d-drag-overlay" />}
                        <iframe
                          src={`/robot-viewer.html?v=${viewerKey.current}_all`}
                          title="Robot Arm 3D Viewer"
                          className="dm-3d-frame"
                          allow="accelerometer"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div
                className={`dm-teach-col${isTeachMinimized ? ' dm-teach-col--minimized' : ''}`}
              >
                {/* Side toggle button on the edge of the menu */}
                <button
                  type="button"
                  className="dm-teach-side-toggle"
                  onClick={() => setIsTeachMinimized(!isTeachMinimized)}
                  title={isTeachMinimized ? 'Open Robot & Teach Panel' : 'Fold Panel'}
                  aria-label={isTeachMinimized ? 'Open Robot & Teach Panel' : 'Fold Panel'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {isTeachMinimized ? (
                      <polyline points="15 18 9 12 15 6" />
                    ) : (
                      <polyline points="9 18 15 12 9 6" />
                    )}
                  </svg>
                </button>

                {!isTeachMinimized && (
                  <>
                    {/* Header bar */}
                    <div className="dm-teach-header">
                      <div className="dm-teach-title-wrap">
                        <span className={`dm-teach-title-dot${teachConnected ? '' : ' dm-teach-title-dot--off'}`} />
                        <span className="dm-teach-title-text">Robot & Teach Panel</span>
                        <span className={`dm-teach-status-pill${teachConnected ? ' dm-teach-status-pill--ready' : ''}`}>
                          {teachConnected ? (teachStatus?.robot_mode_label || 'Ready') : 'Offline'}
                        </span>
                      </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="dm-panel-tabs">
                      <button
                        type="button"
                        className={`dm-panel-tab${panelTab === 'align' ? ' active' : ''}`}
                        onClick={() => setPanelTab('align')}
                        title="Corner Alignment & Coordinate Frame"
                      >
                        Align
                      </button>
                      <button
                        type="button"
                        className={`dm-panel-tab${panelTab === 'jog' ? ' active' : ''}`}
                        onClick={() => setPanelTab('jog')}
                        title="Manual Robot Arm Motion"
                      >
                        Jog
                      </button>
                      <button
                        type="button"
                        className={`dm-panel-tab${panelTab === 'grid' ? ' active' : ''}`}
                        onClick={() => setPanelTab('grid')}
                        title="Grid Layout & Surface Z"
                      >
                        Grid
                      </button>
                      <button
                        type="button"
                        className={`dm-panel-tab${panelTab === 'draw' ? ' active' : ''}`}
                        onClick={() => setPanelTab('draw')}
                        title="Send drawing to Robot"
                      >
                        Draw
                      </button>
                    </div>

                    <div className="dm-teach-body">
                      {/* Pinned Quick Status Strip & Hardware Actions */}
                      <div className="dm-panel-card" style={{ padding: '8px 10px', gap: '8px' }}>
        
                        {/* Quick Hardware Actions */}
                        <div className="dm-quick-actions">
                          <button
                            type="button"
                            className={`dm-quick-btn dm-quick-btn--secondary${errorStatus === 'ok' ? ' dm-quick-btn--ok' : ''}${errorStatus === 'error' ? ' dm-quick-btn--error' : ''}`}
                            onClick={handleClearError}
                            disabled={!teachConnected}
                            title={!teachConnected ? 'Connect to the robot controller first' : 'Clear controller errors and reset alarms'}
                          >
                            {errorStatus === 'ok' ? 'Cleared' : errorStatus === 'error' ? 'Error' : 'Clear Error'}
                          </button>
                          <button
                            type="button"
                            className={`dm-quick-btn${initLoading ? ' dm-quick-btn--loading' : ''}${initStatus === 'ok' ? ' dm-quick-btn--ok' : ''}${initStatus === 'error' ? ' dm-quick-btn--error' : ''}`}
                            onClick={handleInit}
                            disabled={initLoading || robotBusy}
                            title={robotBusy ? 'Wait until robot motion finishes before Init' : 'Connect, power on, and enable robot motors'}
                          >
                            {initLoading ? <><span className="init-btn-spinner" /> Initing…</> : initStatus === 'ok' ? 'Ready' : initStatus === 'error' ? 'Error' : 'Init'}
                          </button>
                          <button
                            type="button"
                            className={`dm-quick-btn${homeLoading ? ' dm-quick-btn--loading' : ''}${homeStatus === 'ok' ? ' dm-quick-btn--ok' : ''}${homeStatus === 'error' ? ' dm-quick-btn--error' : ''}`}
                            onClick={handleGoHome}
                            disabled={homeLoading || !teachRobotCanMove || robotBusy}
                            title={!teachConnected ? 'Connect and initialize the robot first' : !teachRobotEnabled ? 'Enable robot servos first' : robotBusy ? 'Wait until robot motion finishes' : 'Requires a Home pose configured in settings'}
                          >
                            {homeLoading ? <><span className="init-btn-spinner" /> Homing…</> : homeStatus === 'ok' ? 'Homed' : homeStatus === 'error' ? 'Error' : 'Home'}
                          </button>
                        </div>
                        <div className="dm-action-prereq">
                          {!teachConnected
                            ? 'Before robot actions: press Init to connect, power on, and enable the robot.'
                            : !teachRobotEnabled
                              ? 'Robot is connected but disabled. Jog, Goto, Align, Home, and Draw require Init/Enable first.'
                            : robotBusy
                              ? 'Robot is busy; wait for the current motion to finish before Init, Home, Jog, Align, or Draw.'
                              : 'Robot connected. Home additionally needs a Home pose configured in settings.'}
                        </div>
                      </div>

                      {/* ── TAB: Align & Frame ─────────────────────────────── */}
                      {(panelTab === 'align') && (
                        <>
                          <div className="dm-panel-card">
                            <div className="dm-panel-card-head">
                              <span className="dm-panel-card-title">Corner Alignment (4 Points)</span>
                              <button
                                type="button"
                                className={`dm-mark-toggle${markMode ? ' active' : ''}`}
                                onClick={() => setMarkMode((v) => !v)}
                                disabled={!markReady || robotBusy}
                                title={!markReady ? 'Robot and camera must be ready' : robotBusy ? 'Wait for current robot motion to finish' : 'Enable/disable image point marking'}
                              >
                                {markMode ? 'Mark ON' : 'Mark OFF'}
                              </button>
                            </div>

                            <div className="dm-mark-modes">
                              <button
                                type="button"
                                className={`dm-mark-mode${markClickMode === 'mark' ? ' active' : ''}`}
                                onClick={() => setMarkClickMode('mark')}
                                disabled={!markReady || robotBusy}
                                title="Requires connected robot and running camera"
                              >
                                Mark Corners
                              </button>
                              <button
                                type="button"
                                className={`dm-mark-mode${markClickMode === 'goto' ? ' active' : ''}`}
                                onClick={() => setMarkClickMode('goto')}
                                disabled={!markReady || !teachRobotEnabled || robotBusy}
                                title={!markReady ? 'Connect robot and start camera first' : !teachRobotEnabled ? 'Enable robot servos before Goto' : robotBusy ? 'Wait for current motion to finish' : 'Moves arm to clicked pixel'}
                              >
                                Goto Position
                              </button>
                            </div>

                            <div className="dm-mark-hint">
                              {!markReady
                                ? 'Prerequisite: connect and initialize robot, then start camera.'
                                : !teachRobotEnabled
                                  ? 'Prerequisite: enable robot servos before Align or Goto.'
                                : robotBusy
                                  ? 'Prerequisite: wait for current robot motion to finish.'
                                : markMode
                                  ? (markClickMode === 'mark'
                                    ? 'คลิกบนภาพ 4 จุด (มุมวัตถุ) แล้วกด Align · วาดภาพถูกปิดชั่วคราว'
                                    : 'คลิกบนภาพ = สั่งหุ่นไปจุดนั้น')
                                  : 'กด Mark ON แล้วคลิกจุดบนภาพ'}
                            </div>

                            <div className="dm-mark-actions">
                              <button
                                type="button"
                                className="dm-mark-btn"
                                onClick={() => alignAction('/api/map/reset_points', 'Points cleared')}
                                disabled={robotBusy || alignBusy || markPoints.length === 0}
                                title={robotBusy ? 'Wait for current robot motion to finish' : markPoints.length === 0 ? 'No alignment points to clear' : 'Clear the alignment image points; no robot/camera connection required'}
                              >
                                Reset
                              </button>
                              <button
                                type="button"
                                className="dm-mark-btn dm-mark-btn--primary"
                                onClick={() => alignAction('/api/map/align', 'Align started')}
                                disabled={!markReady || !teachRobotEnabled || alignBusy || robotBusy || markPoints.length < 4}
                                title={alignPrerequisite}
                              >
                                Align
                              </button>
                              <button
                                type="button"
                                className="dm-mark-btn dm-mark-btn--danger"
                                onClick={() => alignAction('/api/map/align/stop', 'Stop requested')}
                                disabled={alignBusy || !(teachStatus && teachStatus.align_running)}
                                title={teachStatus && teachStatus.align_running ? 'Stop the running alignment' : 'Available only while Align is running'}
                              >
                                Stop
                              </button>
                            </div>
                            <div className="dm-action-prereq">{alignPrerequisite}</div>

                            <div className="dm-align-stats dm-align-stats--rmse">
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Points</span>
                                <span className="dm-align-stat-val">{markPoints.length} / 4</span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Align Status</span>
                                <span className={`dm-align-stat-val${teachStatus && teachStatus.align_running ? ' running' : ''}`}>
                                  {teachStatus && teachStatus.align_running ? 'Running' : 'Idle'}
                                </span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Plane Tilt</span>
                                <span className="dm-align-stat-val">{fmtMark(teachStatus && teachStatus.last_tilt)}°</span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Fit RMSE</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.final_rmse != null
                                    ? `${fmtMark(teachStatus.final_rmse)} mm`
                                    : `${fmtMark(teachStatus && teachStatus.last_rmse)} mm`}
                                </span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">RMSE After</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.final_rmse != null
                                    ? `${fmtMark(teachStatus.final_rmse)} mm`
                                    : '—'}
                                </span>
                              </div>
                            </div>

                            {/* ── 3 ช่องใหม่ tilt derived ── */}
                            <div className="dm-align-stats" style={{ marginTop: '6px' }}>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Final Tilt</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.final_tilt != null ? `${fmtMark(teachStatus.final_tilt)}°` : '—'}
                                </span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Final Tilt 90°</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.final_tilt != null ? `${fmtMark(90 - teachStatus.final_tilt)}°` : '—'}
                                </span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Live Tilt 90°</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.last_tilt != null ? `${fmtMark(90 - teachStatus.last_tilt)}°` : '—'}
                                </span>
                              </div>
                              <div className="dm-align-stat-box">
                                <span className="dm-align-stat-lbl">Depth</span>
                                <span className="dm-align-stat-val">
                                  {teachStatus && teachStatus.last_center_depth != null ? `${fmtMark(teachStatus.last_center_depth, 0)} mm` : '—'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="dm-panel-card">
                            <div className="dm-panel-card-head">
                              <span className="dm-panel-card-title">Coordinate Frame</span>
                            </div>
                            <div className="frame-wrap">
                              <label className="frame-field">
                                <span>Tool</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="19"
                                  value={toolIndex}
                                  onChange={(e) => { frameDirtyRef.current = true; setToolIndex(e.target.value) }}
                                  disabled={!teachConnected}
                                />
                              </label>
                              <label className="frame-field">
                                <span>User</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="9"
                                  value={userIndex}
                                  onChange={(e) => { frameDirtyRef.current = true; setUserIndex(e.target.value) }}
                                  disabled={!teachConnected}
                                />
                              </label>
                              <button
                                type="button"
                                className="frame-apply"
                                onClick={handleApplyFrame}
                                disabled={!teachConnected || robotBusy}
                                title={!teachConnected ? 'Connect and initialize the robot first' : robotBusy ? 'Wait until robot motion finishes before changing frames' : 'Apply selected Tool/User frame'}
                              >
                                Apply
                              </button>
                            </div>
                            {frameMsg && (
                              <span className={`frame-msg frame-msg--${frameMsg.kind}`}>{frameMsg.text}</span>
                            )}
                          </div>

                          {/* ── Server Log ─────────────────────────────────── */}
                          <div className="dm-panel-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <ServerLogPanel />
                          </div>
                        </>
                      )}

                      {/* ── TAB: Grid & Surface ───────────────────────────── */}
                      {(panelTab === 'grid') && (
                        <>
                          <div className="dm-panel-card">
                            <div className="dm-panel-card-head">
                              <span className="dm-panel-card-title">Grid Setup ({gRows}×{gCols})</span>
                            </div>

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
                            <div className="dm-action-prereq">
                              Set Grid only applies the selected dimensions; changing size clears existing marks and asks for confirmation. Reset Grid clears all marks. Neither action moves the robot or requires a connection.
                            </div>

                            <div className="dm-teach-grid-actions">
                              <button
                                type="button"
                                className="dm-teach-action-btn"
                                disabled={robotBusy}
                                title={robotBusy ? 'Wait until robot motion finishes before changing the grid' : 'Apply selected rows/columns; changing size clears existing marks. No robot connection required'}
                                onClick={handleSetGrid}
                              >
                                Set Grid
                              </button>
                              <button
                                type="button"
                                className="dm-teach-action-btn dm-teach-action-btn--danger"
                                disabled={robotBusy}
                                title={robotBusy ? 'Wait until robot motion finishes before resetting the grid' : 'Clear all taught grid points. No robot connection required'}
                                onClick={handleResetGrid}
                              >
                                Reset Grid
                              </button>
                            </div>

                            <button
                              type="button"
                              className="dm-teach-autofill-btn"
                              disabled={!teachConnected || !cameraReady || markPoints.length < 4 || robotBusy}
                              title={autoFillPrerequisite}
                              onClick={handleAutoFillGrid}
                            >
                              Auto-fill grid from 4 mark points
                            </button>

                            <button
                              type="button"
                              className="dm-teach-surfacez-btn"
                              disabled={!teachConnected || !cameraReady || !gridComplete || !(teachStatus && Number(teachStatus.last_center_depth) > 0) || robotBusy}
                              title={surfaceZPrerequisite}
                              onClick={handleGridSurfaceZ}
                            >
                              {`↧ Grid Z = measured surface (auto)${teachStatus && teachStatus.last_center_depth ? ` · depth ${Number(teachStatus.last_center_depth).toFixed(0)}mm` : ''}`}
                            </button>

                            <button
                              type="button"
                              className="dm-teach-setz-btn"
                              disabled={!teachConnected || !gridComplete || robotBusy}
                              title={!teachConnected ? 'Connect and initialize the robot first' : !gridComplete ? `Mark all ${gRows * gCols} grid cells first (${markedCount}/${gRows * gCols})` : robotBusy ? 'Wait until robot motion finishes' : 'Jog Z until the pen touches the surface, then apply current Z to all grid cells'}
                              onClick={handleSetGridZ}
                            >
                              ↧ Grid Z = current Z (jog to surface first)
                            </button>

                            {teachStatus && typeof teachStatus.z_surface === 'number' && (
                              <button
                                type="button"
                                className="dm-teach-surfacez-btn"
                                disabled={!teachConnected || !gridComplete || robotBusy}
                                title={!teachConnected ? 'Connect and initialize the robot first' : !gridComplete ? `Mark all ${gRows * gCols} grid cells first (${markedCount}/${gRows * gCols})` : robotBusy ? 'Wait until robot motion finishes' : 'Apply configured Z_SURFACE to all grid cells'}
                                onClick={handleSetGridZSurface}
                              >
                                {`↧ Grid Z = surface (${teachStatus.z_surface.toFixed(1)}mm, configured)`}
                              </button>
                            )}

                            <div className="dm-action-prereq">
                              Auto-fill: {autoFillPrerequisite} Current/Configured Grid Z: connect robot and mark all {gRows * gCols} cells. Surface Z additionally needs camera + live depth, and camera alignment is recommended.
                            </div>
                          </div>

                          <div className="dm-panel-card">
                            <div className="dm-panel-card-head">
                              <span className="dm-panel-card-title">Cells Matrix & Shape</span>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669' }}>
                                {markedCount}/{gRows * gCols} marked
                              </span>
                            </div>

                            <div className="dm-teach-cells" style={{ gridTemplateColumns: `repeat(${gCols}, 1fr)` }}>
                              {Array.from({ length: gRows }).map((_, i) =>
                                Array.from({ length: gCols }).map((_, j) => {
                                  const marked = !!(gridPoints && gridPoints[i] && gridPoints[i][j])
                                  return (
                                    <button
                                      key={`${i}-${j}`}
                                      type="button"
                                      className={`dm-teach-cell${marked ? ' dm-teach-cell--marked' : ''}`}
                                      disabled={!teachConnected || robotBusy}
                                      title={!teachConnected ? 'Connect and initialize the robot first' : robotBusy ? 'Wait until robot motion finishes' : `Jog pen to R${i + 1}C${j + 1}, then record the current pose`}
                                      onClick={() => handleMarkCell(i + 1, j + 1)}
                                    >
                                      {`R${i + 1}C${j + 1}`}
                                    </button>
                                  )
                                })
                              )}
                            </div>

                            <div className={`dm-teach-grid-status${gridValidate && Array.isArray(gridValidate.warnings) && gridValidate.warnings.length ? ' dm-teach-grid-status--warn' : ''}`}>
                              {`grid ${gRows}x${gCols} — ${markedCount}/${gRows * gCols} marked`}
                              {gridPoints && gridPoints[0] && gridPoints[0][0] &&
                                ` · Z=${Number(gridPoints[0][0][2]).toFixed(1)}mm`}
                              {gridValidate && gridValidate.span_mm !== undefined &&
                                ` · span=${Number(gridValidate.span_mm).toFixed(1)}mm`}
                              {gridValidate && ` · rmse=${gridValidate.rmse_mm}mm`}
                              {gridValidate && Array.isArray(gridValidate.warnings) && gridValidate.warnings.length > 0 &&
                                ` · ${gridValidate.warnings.join('; ')}`}
                            </div>

                            <svg viewBox="0 0 200 200" className="dm-teach-shape-svg">
                              {gridShapeEls || (
                                <text x="100" y="104" textAnchor="middle" className="dm-teach-shape-empty">
                                  mark grid cells ({gRows}×{gCols})
                                </text>
                              )}
                            </svg>
                          </div>

                          <div className="dm-panel-card">
                            <div className="dm-panel-card-head">
                              <span className="dm-panel-card-title">Test Points &amp; Report</span>
                              <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669' }}>
                                {reportGate ? `${reportGate.coverage.matchedCount}/${TEST_POINT_POSITIONS.length}` : `${testPoints.length}`} recorded
                              </span>
                            </div>

                            <div className="dm-teach-hint">
                              Prerequisite: mark all {gRows * gCols} grid cells. Jog to each test location, then either record the robot's own reading or type the position you measured yourself — leave the box empty to use the robot reading.
                            </div>

                            {TEST_POINT_POSITIONS.map((p, i) => (
                              <div key={`row-${p.u}-${p.v}`} className="dm-teach-grid-actions">
                                <button
                                  type="button"
                                  className="dm-teach-action-btn"
                                  disabled={!gridComplete || robotBusy || (!teachConnected && !String(measured[`${p.u},${p.v}`] || '').trim())}
                                  title={!gridComplete ? `Mark all ${gRows * gCols} grid cells first (${markedCount}/${gRows * gCols})` : robotBusy ? 'Wait until robot motion finishes' : teachConnected ? `Record u=${p.u}, v=${p.v}` : 'Type the position you measured to record without the robot'}
                                  onClick={() => handleRecordTestPoint(p.u, p.v, measured[`${p.u},${p.v}`])}
                                >
                                  {reportGate?.coverage?.matched?.[i] ? '✓ ' : ''}{p.label}
                                </button>
                                <input
                                  className="dm-teach-measured-input"
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="X, Y, Z"
                                  aria-label={`Measured position for ${p.label}`}
                                  value={measured[`${p.u},${p.v}`] || ''}
                                  onChange={(e) => setMeasured((prev) => ({
                                    ...prev,
                                    [`${p.u},${p.v}`]: e.target.value,
                                  }))}
                                />
                              </div>
                            ))}

                            {reportGate && (
                              <div className="dm-teach-grid-status">
                                {reportGate.canDownload
                                  ? `✓ ครบ ${reportGate.coverage.matchedCount}/${TEST_POINT_POSITIONS.length} จุด — บันทึกไฟล์ได้`
                                  : reportGate.reasons.map((reason) => (
                                    <div key={reason}>{`✗ ${reason}`}</div>
                                  ))}
                              </div>
                            )}

                            {testPoints.length > 0 && (
                              <div className="dm-teach-grid-status">
                                {testPoints.map((t) => (
                                  <div key={t.index}>
                                    {`#${t.index} u=${t.u.toFixed(2)} v=${t.v.toFixed(2)} — `}
                                    {`ΔX=${t.error[0].toFixed(2)} ΔY=${t.error[1].toFixed(2)} ΔZ=${t.error[2].toFixed(2)} mm`}
                                  </div>
                                ))}
                              </div>
                            )}

                            {testAggregates && testAggregates.count > 0 && (
                              <div className="dm-teach-grid-status">
                                <div>
                                  {`n=${testAggregates.count} · Max Δ ${fmtMm(testAggregates.max_error)}mm`
                                    + ` · Mean ${fmtMm(testAggregates.mean_error)}mm`
                                    + ` · RMSE ${fmtMm(testAggregates.rmse)}mm`}
                                </div>
                              </div>
                            )}

                            <div className="dm-teach-grid-actions">
                              <button
                                type="button"
                                className="dm-teach-autofill-btn"
                                disabled={verifyBusy || robotBusy || !teachConnected || markedCount !== gRows * gCols}
                                title={
                                  markedCount !== gRows * gCols
                                    ? 'Mark every grid cell first'
                                    : robotBusy
                                      ? 'Wait until robot motion finishes'
                                      : 'Move the arm to all five test positions and record each one'
                                }
                                onClick={handleVerifyGrid}
                              >
                                {verifyBusy ? 'กำลังวัด 5 จุด…' : 'วัดความแม่นยำ 5 จุด'}
                              </button>
                              <button
                                type="button"
                                className="dm-teach-action-btn dm-teach-action-btn--danger"
                                disabled={testPoints.length === 0}
                                title={testPoints.length ? 'Clear recorded test points; no robot connection required' : 'No test points to clear'}
                                onClick={handleResetTestPoints}
                              >
                                Reset test points
                              </button>
                              <button
                                type="button"
                                className="dm-teach-autofill-btn"
                                disabled={testReportBusy}
                                onClick={handleDownloadReport}
                                title="Download the current grid/test-point report; test points are optional"
                              >
                                {testReportBusy ? 'กำลังบันทึก…' : 'บันทึกผลการทดสอบ (ชีต 05 + 09)'}
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ── TAB: Jog Motion ───────────────────────────────── */}
                      {(panelTab === 'jog') && (
                        <div className="dm-panel-card">
                          <div className="dm-panel-card-head">
                            <span className="dm-panel-card-title">Motion Jog Control</span>
                          </div>
                          <div className="dm-teach-hint">
                            {!teachConnected
                              ? 'Prerequisite: connect and initialize the robot.'
                              : robotBusy
                                ? 'Jog is unavailable while Align, Draw, or a motion sequence is running.'
                                : 'Jog requires a connected, enabled robot; step values are in mm or degrees.'}
                          </div>

                          {/* Submode Switcher */}
                          <div className="dm-jog-submodes">
                            <button
                              type="button"
                              className={`dm-jog-submode-btn${jogMode === 'pos' ? ' active' : ''}`}
                              onClick={() => setJogMode('pos')}
                            >
                              <span className="dm-jog-submode-main">Linear</span>
                              <span className="dm-jog-submode-sub">XYZ (mm)</span>
                            </button>
                            <button
                              type="button"
                              className={`dm-jog-submode-btn${jogMode === 'rot' ? ' active' : ''}`}
                              onClick={() => setJogMode('rot')}
                            >
                              <span className="dm-jog-submode-main">Rotation</span>
                              <span className="dm-jog-submode-sub">Rx-Rz (deg)</span>
                            </button>
                            <button
                              type="button"
                              className={`dm-jog-submode-btn${jogMode === 'joint' ? ' active' : ''}`}
                              onClick={() => setJogMode('joint')}
                            >
                              <span className="dm-jog-submode-main">Joints</span>
                              <span className="dm-jog-submode-sub">J1-J6 (deg)</span>
                            </button>
                          </div>

                          {/* Step chips + input */}
                          <div className="dm-step-chips-row">
                            <span className="dm-step-label">Step:</span>
                            <div className="dm-step-chips">
                              {(jogMode === 'pos' ? [0.5, 1, 5, 10, 20] : [0.5, 1, 2, 5, 15]).map((s) => {
                                const curVal = jogMode === 'pos' ? posStep : (jogMode === 'rot' ? rotStep : jointStep)
                                return (
                                  <button
                                    key={s}
                                    type="button"
                                    className={`dm-step-chip${curVal === s ? ' active' : ''}`}
                                    onClick={() => {
                                      if (jogMode === 'pos') setPosStep(s)
                                      else if (jogMode === 'rot') setRotStep(s)
                                      else setJointStep(s)
                                    }}
                                  >
                                    {s}
                                  </button>
                                )
                              })}
                              <input
                                type="number"
                                className="dm-teach-step-input"
                                value={jogMode === 'pos' ? posStep : (jogMode === 'rot' ? rotStep : jointStep)}
                                min={0.1}
                                step={0.5}
                                onChange={(e) => {
                                  const val = Math.max(0.1, Number(e.target.value) || 0.1)
                                  if (jogMode === 'pos') setPosStep(val)
                                  else if (jogMode === 'rot') setRotStep(val)
                                  else setJointStep(val)
                                }}
                              />
                              <span className="dm-step-unit">{jogMode === 'pos' ? 'mm' : 'deg'}</span>
                            </div>
                          </div>

                          {/* Direction Buttons */}
                          <div className="jog-panel">
                            {jogMode === 'pos' && JOG_POS_AXES.map((axis) => (
                              <JogPillRow
                                key={axis}
                                label={axisLabel(axis)}
                                disabled={!teachRobotCanMove || jogBusy || robotBusy}
                                titleMinus={`Jog ${axisLabel(axis)} −${posStep}mm`}
                                titlePlus={`Jog ${axisLabel(axis)} +${posStep}mm`}
                                onMinus={() => handleJog(axis, -1)}
                                onPlus={() => handleJog(axis, 1)}
                              />
                            ))}

                            {jogMode === 'rot' && JOG_ROT_AXES.map((axis) => (
                              <JogPillRow
                                key={axis}
                                label={axisLabel(axis)}
                                disabled={!teachRobotCanMove || jogBusy || robotBusy}
                                titleMinus={`Jog ${axisLabel(axis)} −${rotStep}deg`}
                                titlePlus={`Jog ${axisLabel(axis)} +${rotStep}deg`}
                                onMinus={() => handleJog(axis, -1)}
                                onPlus={() => handleJog(axis, 1)}
                              />
                            ))}

                            {jogMode === 'joint' && JOG_JOINT_AXES.map((j) => (
                              <JogPillRow
                                key={j}
                                label={`J${j}`}
                                disabled={!teachRobotCanMove || jogBusy || robotBusy}
                                titleMinus={`Jog J${j} −${jointStep}deg`}
                                titlePlus={`Jog J${j} +${jointStep}deg`}
                                onMinus={() => handleJogJoint(j, -1)}
                                onPlus={() => handleJogJoint(j, 1)}
                              />
                            ))}
                          </div>

                          {jogMode === 'joint' && (
                            <div className="dm-teach-joints">
                              {teachStatus && Array.isArray(teachStatus.angles) && teachStatus.angles.length === 6
                                ? teachStatus.angles.map((a, i) => (
                                  <span key={i}>{`J${i + 1} ${Number(a).toFixed(1)}°`}</span>
                                ))
                                : <span>J1-J6 —</span>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Inline feedback message */}
                      {teachMsg && (
                        <div className={`dm-teach-msg dm-teach-msg--${teachMsg.kind}`}>
                          {teachMsg.text}
                        </div>
                      )}

                      {/* ── TAB: Draw ─────────────────────────────────────── */}
                      {/* canvas อยู่ใน DOM ตลอด ซ่อน/แสดงด้วย display เพื่อไม่ให้ Fabric destroy */}
                      <div
                        className="dm-canvas-wrap dm-canvas-wrap--tab"
                        style={{ display: panelTab === 'draw' ? 'flex' : 'none' }}
                        ref={(el) => {
                          if (el && canvasElRef.current) {
                            const fc = fabricRef.current
                            if (fc) {
                              fc.setDimensions({ width: el.clientWidth, height: el.clientHeight })
                              fc.renderAll()
                            }
                          }
                        }}
                      >
                        <canvas ref={canvasElRef} id="drawing-canvas" />
                      </div>

                      {panelTab === 'draw' && (
                        <div className="dm-panel-card">
                          <div className="dm-panel-card-head">
                            <span className="dm-panel-card-title">Draw Tools</span>
                          </div>

                          <div className="dm-draw-tool-row">
                            {TOOL_META.map((tool) => (
                              <button
                                key={tool.id}
                                id={`tool-${tool.id}`}
                                className={`dm-bar-btn ${activeTool === tool.id ? 'dm-bar-btn--active' : ''}`}
                                title={tool.label}
                                onClick={() => setActiveTool(tool.id)}
                              >
                                <span style={{ fontSize: 20 }}>{tool.icon}</span>
                                <span style={{ fontSize: 9, fontWeight: 700 }}>{tool.label}</span>
                              </button>
                            ))}
                          </div>

                          <div className="dm-draw-options-row">
                            <div className="dm-draw-colors">
                              {PRESET_COLORS.map((color) => (
                                <button
                                  key={color}
                                  className={`dm-dot ${strokeColor === color ? 'dm-dot--active' : ''}`}
                                  style={{ background: color, border: color === '#ffffff' ? '1.5px solid #aac8e8' : `1.5px solid ${color}` }}
                                  title={color}
                                  aria-label={`Set drawing color ${color}`}
                                  onClick={() => setStrokeColor(color)}
                                />
                              ))}
                              <input
                                id="stroke-color-picker"
                                type="color"
                                value={strokeColor}
                                onChange={(event) => setStrokeColor(event.target.value)}
                                className="dm-bar-color-input"
                                title="Custom color"
                              />
                            </div>
                            <div className="dm-draw-widths">
                              {STROKE_WIDTHS.map((width) => (
                                <button
                                  key={width}
                                  id={`stroke-width-${width}`}
                                  className={`dm-bar-w-btn ${strokeWidth === width ? 'dm-bar-btn--active' : ''}`}
                                  title={`${width}px`}
                                  onClick={() => setStrokeWidth(width)}
                                >{width}</button>
                              ))}
                            </div>
                          </div>

                          <div className="dm-draw-actions-row">
                            <button id="btn-undo" className="dm-bar-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↩</button>
                            <button id="btn-redo" className="dm-bar-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↪</button>
                            <button
                              id="btn-delete-selected"
                              className="dm-bar-btn"
                              onClick={deleteSelected}
                              disabled={!hasSelection}
                              aria-label="Delete selected objects"
                              title="Delete selected object(s) (Delete)"
                            >⌫</button>
                            <button id="btn-clear" className="dm-bar-btn dm-bar-btn--danger" onClick={clearCanvas} title="Clear all objects">✕</button>
                            <button
                              id="btn-export-png"
                              className="dm-bar-btn"
                              onClick={exportPNG}
                              disabled={objectCount === 0}
                              title={objectCount === 0 ? 'Draw something before exporting' : 'Export the current canvas as PNG'}
                            >⬇</button>
                          </div>

                          {/* Status */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                              fontSize: '11px', fontWeight: 700,
                              padding: '3px 10px', borderRadius: '10px',
                              background: teachConnected ? 'rgba(74,222,128,0.12)' : 'rgba(239,68,68,0.10)',
                              color: teachConnected ? '#16a34a' : '#ef4444',
                              border: `1px solid ${teachConnected ? 'rgba(74,222,128,0.4)' : 'rgba(239,68,68,0.3)'}`,
                            }}>
                              {teachConnected ? 'Robot Connected' : 'Robot Disconnected'}
                            </span>
                            {teachStatus && teachStatus.draw_running && (
                              <span style={{
                                fontSize: '11px', fontWeight: 700,
                                padding: '3px 10px', borderRadius: '10px',
                                background: 'rgba(245,158,11,0.12)',
                                color: '#d97706',
                                border: '1px solid rgba(245,158,11,0.35)',
                              }}>
                                ✎ Drawing…
                              </span>
                            )}
                          </div>

                          {/* Object count */}
                          <div style={{ fontSize: '12px', color: '#64748b' }}>
                            {objectCount > 0
                              ? `${objectCount} object${objectCount > 1 ? 's' : ''} on canvas`
                              : 'Canvas is empty — draw something first'}
                            <span style={{ display: 'block', color: drawPrerequisite === 'Ready to send.' ? '#16a34a' : '#b45309' }}>
                              Before Send: {drawPrerequisite} Grid {markedCount}/{gRows * gCols} marked.
                            </span>
                            {gridValidate && Array.isArray(gridValidate.warnings) && gridValidate.warnings.length > 0 && (
                              <span className="dm-prereq-warning">Grid warning: {gridValidate.warnings.join('; ')}</span>
                            )}
                          </div>

                          {/* Send + Stop */}
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className={`dm-quick-btn dm-quick-btn--ok${isSending ? ' dm-quick-btn--loading' : ''}`}
                              style={{ flex: 1 }}
                              onClick={sendToRobot}
                              disabled={isSending || !teachRobotCanMove || objectCount === 0 || !gridComplete || gridTooSmall || robotBusy}
                              title={drawPrerequisite}
                            >
                              {isSending ? '…Sending' : '▶ Send to Robot'}
                            </button>
                            <button
                              type="button"
                              className="dm-quick-btn dm-quick-btn--error"
                              onClick={stopDraw}
                              disabled={!isSending && !(teachStatus && teachStatus.draw_running)}
                              title={teachStatus && teachStatus.draw_running ? 'Stop the active drawing motion' : 'Available only while Draw is running'}
                            >
                              ■ Stop
                            </button>
                          </div>

                          {/* Status text */}
                          {status && status !== 'Ready' && (
                            <div style={{
                              fontSize: '11px', fontWeight: 600,
                              color: status.startsWith('✓') ? '#16a34a' : status.startsWith('✗') ? '#dc2626' : '#64748b',
                            }}>
                              {status}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}

export default DrawingModePage

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
import { setStreamMode } from '../components/CameraStream'

// ─── Tool constants ────────────────────────────────────────────────────────────
const TOOLS = {
  SELECT:  'select',
  PEN:     'pen',
  LINE:    'line',
  RECT:    'rect',
  CIRCLE:  'circle',
}

const TOOL_META = [
  { id: TOOLS.SELECT, label: 'Select',  icon: '↖' },
  { id: TOOLS.PEN,    label: 'Pen',     icon: '✎' },
  { id: TOOLS.LINE,   label: 'Line',    icon: '╱' },
  { id: TOOLS.RECT,   label: 'Rect',    icon: '▭' },
  { id: TOOLS.CIRCLE, label: 'Circle',  icon: '◯' },
]

const PRESET_COLORS = [
  '#1a2f45', '#1a8fe3', '#ef4444', '#22c55e',
  '#f59e0b', '#7c3aed', '#ec4899', '#000000', '#ffffff',
]

const STROKE_WIDTHS = [1, 2, 4, 8, 16]

// ─── Teach / Grid panel constants ─────────────────────────────────────────────
const POSE_LABELS  = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz']
const clampInt  = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)))

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Do NOT read points back from obj.path: PencilBrush emits a smoothed bezier
// (M + Q… + L), so command-reading keeps only 2 points per stroke. Capturing
// each mousemove instead is what preserves the shape. Value: [u, v] fractions.
const _freehandPoints = new WeakMap()

// loadFromJSON rebuilds new Path objects, so _freehandPoints loses every
// stroke. Each history snapshot also stores the samples in path order, and
// _rekeyFreehandPoints() re-attaches them by that index after a load.
function _snapshotFreehand(fc) {
  return fc.getObjects()
    .filter((o) => o.type === 'path')
    .map((o) => _freehandPoints.get(o) || null)
}

function _rekeyFreehandPoints(fc, stored) {
  const paths = fc.getObjects().filter((o) => o.type === 'path')
  paths.forEach((o, i) => {
    const pts = stored && stored[i]
    if (pts && pts.length >= 2) _freehandPoints.set(o, pts)
  })
}

// Inverse of planegrid.grid_pose's bilinear (u,v) -> plane map. Given a point
// p and a quad's four corners in canvas px (c00=(u0,v0), c10=(u1,v0),
// c01=(u0,v1), c11=(u1,v1)), returns [u, v] so a stroke drawn on the rendered
// grid-shape quad maps back to exactly the (u,v) the robot should draw at.
function inverseBilinear(p, c00, c10, c01, c11) {
  const cross = (ax, ay, bx, by) => ax * by - ay * bx
  const ex = c00[0] - c10[0] - c01[0] + c11[0]
  const ey = c00[1] - c10[1] - c01[1] + c11[1]
  const fx = c10[0] - c00[0], fy = c10[1] - c00[1]
  const gx = c01[0] - c00[0], gy = c01[1] - c00[1]
  const ddx = p[0] - c00[0], ddy = p[1] - c00[1]
  if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) {
    // parallelogram — pure affine solve
    const det = cross(fx, fy, gx, gy)
    if (Math.abs(det) < 1e-12) return [0, 0]
    return [cross(ddx, ddy, gx, gy) / det, cross(fx, fy, ddx, ddy) / det]
  }
  const k1 = cross(ddx, ddy, gx, gy)     // (p-c00) x g
  const k2 = cross(ddx, ddy, fx, fy)     // (p-c00) x f
  const a1 = cross(fx, fy, gx, gy)       // f x g
  const a2 = cross(ex, ey, gx, gy)       // e x g
  const b2 = cross(ex, ey, fx, fy)       // e x f
  const A = -a1 * a2
  const B = -a1 * a1 + k1 * b2 - k2 * a2
  const C = -k2 * a1
  let v
  if (Math.abs(A) < 1e-12) {
    v = Math.abs(B) < 1e-12 ? 0 : -C / B
  } else {
    const disc = B * B - 4 * A * C
    if (disc < 0) return [0, 0]
    const s = Math.sqrt(disc)
    const v1 = (-B + s) / (2 * A), v2 = (-B - s) / (2 * A)
    v = (v1 >= -0.001 && v1 <= 1.001) ? v1 : v2
  }
  const denom = a1 + v * a2
  const u = Math.abs(denom) < 1e-12 ? 0 : k1 / denom
  return [u, v]
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DrawingModePage = () => {
  const canvasElRef   = useRef(null)
  const dmViewportRef = useRef(null)
  const fabricRef     = useRef(null)
  const toUvRef       = useRef(null)
  const isDrawingRef  = useRef(false)
  const tempObjRef    = useRef(null)
  const startPtRef    = useRef({ x: 0, y: 0 })
  const mouseDownRef  = useRef(null)
  const mouseMoveRef  = useRef(null)
  const mouseUpRef    = useRef(null)
  const pendingFreehandSamples = useRef(null)
  const pathCreatedRef = useRef(null)

  const [activeTool,  setActiveTool]  = useState(TOOLS.PEN)
  const [strokeColor, setStrokeColor] = useState('#1a2f45')
  const [fillColor,   setFillColor]   = useState('transparent')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [canUndo,     setCanUndo]     = useState(false)
  const [canRedo,     setCanRedo]     = useState(false)
  const [status,      setStatus]      = useState('Ready')
  const [objectCount, setObjectCount] = useState(0)
  const [isSending,   setIsSending]   = useState(false)

  // 3D Robot Model
  const viewerKey = useRef(Date.now())
  const [is3DMinimized, setIs3DMinimized] = useState(false)
  const [is3DExpanded, setIs3DExpanded]   = useState(true)

  // Teach / Grid Panel
  const [isTeachMinimized, setIsTeachMinimized] = useState(false)
  const [teachStatus, setTeachStatus]           = useState(null)
  const [cameraMode, setCameraMode]             = useState('rgb')
  const [modeLoading, setModeLoading]           = useState(false)
  const [gridRows, setGridRows]                 = useState(2)
  const [gridCols, setGridCols]                 = useState(2)
  const [teachMsg, setTeachMsg]                 = useState(null)
  const teachMsgTimerRef = useRef(null)
  const [markMode, setMarkMode]                 = useState(false)
  const [markClickMode, setMarkClickMode]       = useState('mark')
  const [alignBusy, setAlignBusy]               = useState(false)
  const [markGeom, setMarkGeom]                 = useState(null)
  const [vpSize, setVpSize]                     = useState({ w: 0, h: 0 })

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
  const historyFreehandRef = useRef([])

  // ── Save state to history ──────────────────────────────────────────────────
  const saveHistory = useCallback(() => {
    const fc = fabricRef.current
    if (!fc) return
    const json = fc.toJSON()
    const freehand = _snapshotFreehand(fc)
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(json)
    historyFreehandRef.current = historyFreehandRef.current.slice(0, historyIdxRef.current + 1)
    historyFreehandRef.current.push(freehand)
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
    historyFreehandRef.current = [null]
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
    if (pathCreatedRef.current) { fc.off('path:created', pathCreatedRef.current); pathCreatedRef.current = null }
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

      const onPenDown = (opt) => {
        const p = fc.getScenePoint(opt.e)
        pendingFreehandSamples.current = [p]
      }
      const onPenMove = (opt) => {
        const samples = pendingFreehandSamples.current
        if (!samples) return
        const p = fc.getScenePoint(opt.e)
        const last = samples[samples.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return
        samples.push(p)
      }
      const onPathCreated = (e) => {
        const samples = pendingFreehandSamples.current || []
        pendingFreehandSamples.current = null
        if (e.path && samples.length >= 2) {
          // Map straight through the rendered grid-shape quad -> (u,v).
          _freehandPoints.set(e.path, samples.map((p) => (
            toUvRef.current ? toUvRef.current(p.x, p.y)
                            : [p.x / fc.getWidth(), p.y / fc.getHeight()])))
        }
        saveHistory()
      }
      fc.on('mouse:down', onPenDown)
      fc.on('mouse:move', onPenMove)
      fc.on('path:created', onPathCreated)
      mouseDownRef.current = onPenDown
      mouseMoveRef.current = onPenMove
      pathCreatedRef.current = onPathCreated
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
      _rekeyFreehandPoints(fc, historyFreehandRef.current[historyIdxRef.current])
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
      _rekeyFreehandPoints(fc, historyFreehandRef.current[historyIdxRef.current])
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
  // Three distinct pixel spaces: getScenePoint() gives CANVAS-space (527-wide
  // backing store), the camera <img> is CSS-scaled to the viewport (422-wide),
  // and the backend needs fractions of the CAMERA IMAGE (640x360). Collapsing
  // any of these steps yields a ~25% stretch/offset.
  const sendToRobot = useCallback(async () => {
    const fc = fabricRef.current
    if (!fc) return
    const objs = fc.getObjects()
    if (objs.length === 0) { setStatus('⚠ No objects to send'); return }
    setIsSending(true)
    setStatus('Sending to robot…')
    try {
      // (u,v) is derived from the rendered grid-shape quad, so anything drawn
      // on the quad maps 1:1 onto the taught plane (planegrid.grid_pose).
      const toUv = (x, y) => (toUvRef.current
        ? toUvRef.current(x, y)
        : [x / fc.getWidth(), y / fc.getHeight()])

      const strokes = []
      for (const obj of objs) {
        if (obj.type === 'path') {
          const pts = _freehandPoints.get(obj)
          if (pts && pts.length >= 2) strokes.push({ tool: 'pen', points: pts })
          continue
        }
        if (obj.type === 'line') {
          strokes.push({ tool: 'line', points: [toUv(obj.x1, obj.y1), toUv(obj.x2, obj.y2)] })
          continue
        }
        if (obj.type === 'rect') {
          const x1 = obj.left
          const y1 = obj.top
          const x2 = obj.left + obj.width
          const y2 = obj.top + obj.height
          strokes.push({ tool: 'rect', points: [toUv(x1, y1), toUv(x2, y1), toUv(x2, y2), toUv(x1, y2), toUv(x1, y1)] })
          continue
        }
        if (obj.type === 'ellipse') {
          const cx = obj.left + obj.rx
          const cy = obj.top + obj.ry
          const n = 36
          const points = []
          for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2
            points.push(toUv(cx + obj.rx * Math.cos(a), cy + obj.ry * Math.sin(a)))
          }
          strokes.push({ tool: 'circle', points })
        }
      }

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

  // ── Emergency Stop ────────────────────────────────────────────────────────
  const handleEmergency = () => {
    apiFetch('/api/map/emergency', { method: 'POST' }).catch(() => {})
    apiFetch('/api/map/draw/stop', { method: 'POST' }).catch(() => {})
    apiFetch('/api/map/align/stop', { method: 'POST' }).catch(() => {})
    setStatus('EMERGENCY STOP sent')
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
      if (data.camera_mode) {
        setCameraMode(data.camera_mode)
      }
    } catch { /* ignore */ }
  }, [])

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
    finally {
      setModeLoading(false)
    }
  }, [cameraMode, modeLoading])

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

  const markCamW    = (teachStatus && teachStatus.cam_w) || 848
  const markCamH    = (teachStatus && teachStatus.cam_h) || 480
  const markPoints  = (teachStatus && Array.isArray(teachStatus.points)) ? teachStatus.points : []
  const markReady   = !!(teachStatus && teachStatus.connected && teachStatus.camera_running)
  const canMark     = !!(markReady && markGeom && markMode)
  const fmtMark     = (v, d = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(d))

  // The drawable region is the taught grid's ACTUAL shape (grid_shape_2d = the
  // marked corners projected onto the fitted plane), fitted into the viewport.
  // toUvRef maps a stroke point on that quad back to (u,v) for grid_pose.
  const gridShape = teachStatus && teachStatus.grid_shape_2d
  const gridQuad = (() => {
    if (!Array.isArray(gridShape) || gridShape.length < 2 || !vpSize.w) return null
    const rows = gridShape.length, cols = gridShape[0].length
    if (!cols || cols < 2) return null
    const pts = gridShape.flat()
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 44
    const spanX = Math.max(maxX - minX, 1e-6), spanY = Math.max(maxY - minY, 1e-6)
    const scale = Math.min((vpSize.w - 2 * pad) / spanX, (vpSize.h - 2 * pad) / spanY)
    const offX = pad + (vpSize.w - 2 * pad - spanX * scale) / 2
    const offY = pad + (vpSize.h - 2 * pad - spanY * scale) / 2
    const toC = ([x, y]) => [offX + (x - minX) * scale, offY + (y - minY) * scale]
    return {
      rows, cols, shape: gridShape, toC,
      c00: toC(gridShape[0][0]), c10: toC(gridShape[0][cols - 1]),
      c01: toC(gridShape[rows - 1][0]), c11: toC(gridShape[rows - 1][cols - 1]),
    }
  })()

  useEffect(() => {
    toUvRef.current = (x, y) => {
      if (gridQuad) {
        const [u, v] = inverseBilinear([x, y], gridQuad.c00, gridQuad.c10, gridQuad.c01, gridQuad.c11)
        return [Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))]
      }
      const fc = fabricRef.current
      const w = fc ? fc.getWidth() : 1
      const h = fc ? fc.getHeight() : 1
      return [x / w, y / h]
    }
  }, [gridQuad])

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
      top:  r.top  - vr.top  + (r.height - sh * scale) / 2,
    }
  }, [])

  const computeMarkGeom = useCallback(() => {
    const m = measureMark()
    setMarkGeom(m ? { sw: m.sw, sh: m.sh, scale: m.scale, left: m.left, top: m.top } : null)
  }, [measureMark])

  const onViewportChange = useCallback(() => {
    computeMarkGeom()
    const vp = dmViewportRef.current
    if (vp) setVpSize({ w: vp.clientWidth, h: vp.clientHeight })
  }, [computeMarkGeom])

  useEffect(() => {
    onViewportChange()
    const t = setTimeout(onViewportChange, 400)
    window.addEventListener('resize', onViewportChange)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [onViewportChange, markCamW, markCamH, markMode])

  // Collapsing the teach panel resizes the viewport without a window resize
  // event, which would leave markGeom / vpSize (mark markers + grid overlay)
  // stale.
  useEffect(() => {
    const vp = dmViewportRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => onViewportChange())
    ro.observe(vp)
    return () => ro.disconnect()
  }, [onViewportChange])

  const handleMarkClick = useCallback(async (e) => {
    if (!markMode) return
    const m = measureMark()
    if (!m || !teachStatus || !teachStatus.connected || !teachStatus.camera_running) return
    const sx = (e.clientX - m.vr.left - m.left) / m.scale
    const sy = (e.clientY - m.vr.top  - m.top)  / m.scale
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
  const teachConnected = !!(teachStatus && teachStatus.connected)
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

  // Grid shape preview geometry
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

            <div className="dm-main-row">

            {/* ── Camera + Canvas overlay (fills all remaining space) ── */}
            <div className="dm-viewport" ref={dmViewportRef}>

              {/* Status indicator & Active Mode Tag (Top-Left) */}
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  left: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '20px',
                    padding: '5px 14px',
                    fontSize: '12px',
                    color: '#fff',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: (teachStatus && teachStatus.camera_running) ? '#4ade80' : '#22c55e',
                      boxShadow: '0 0 8px #4ade80',
                    }}
                  />
                  LIVE
                </div>

                <div
                  style={{
                    background:
                      cameraMode === 'rgb'
                        ? 'rgba(37, 99, 235, 0.8)'
                        : cameraMode === 'depth'
                          ? 'rgba(220, 38, 38, 0.8)'
                          : 'rgba(75, 85, 99, 0.8)',
                    borderRadius: '20px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: '700',
                    color: '#fff',
                    backdropFilter: 'blur(8px)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                  }}
                >
                  {cameraMode}
                </div>
              </div>

              {/* Controls inside camera: Segmented Mode Switcher (Top-Right) */}
              <div
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    background: 'rgba(0, 0, 0, 0.7)',
                    borderRadius: '10px',
                    padding: '3px',
                    backdropFilter: 'blur(8px)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleModeChange('rgb')
                    }}
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'rgb' ? '#2563eb' : 'transparent',
                      color: cameraMode === 'rgb' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'rgb' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to RGB Color"
                  >
                    RGB
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleModeChange('gray')
                    }}
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'gray' ? '#4b5563' : 'transparent',
                      color: cameraMode === 'gray' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'gray' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to Grayscale"
                  >
                    Gray
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleModeChange('depth')
                    }}
                    disabled={modeLoading}
                    style={{
                      background: cameraMode === 'depth' ? '#dc2626' : 'transparent',
                      color: cameraMode === 'depth' ? '#fff' : '#aaa',
                      border: 'none',
                      borderRadius: '7px',
                      padding: '6px 14px',
                      fontSize: '13px',
                      fontWeight: cameraMode === 'depth' ? '700' : '500',
                      cursor: modeLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.18s ease',
                    }}
                    title="Switch to Depth Heatmap"
                  >
                    Depth
                  </button>
                </div>
              </div>

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

              <div
                className="dm-mark-hit"
                style={{
                  pointerEvents: markMode ? 'auto' : 'none',
                  cursor: canMark ? 'crosshair' : 'default',
                }}
                onClick={handleMarkClick}
                title={markMode ? (markClickMode === 'mark' ? 'คลิกเพื่อเพิ่มจุดมุมวัตถุ' : 'คลิกเพื่อสั่งหุ่นไปจุดนั้น') : undefined}
              />
              {markMode && markGeom && markPoints.map(([px, py], i) => (
                <div
                  key={i}
                  className="dm-mark-marker"
                  style={{
                    left: markGeom.left + (px * markGeom.sw / markCamW) * markGeom.scale,
                    top:  markGeom.top  + (py * markGeom.sh / markCamH) * markGeom.scale,
                  }}
                >
                  {i + 1}
                </div>
              ))}

              {/* Grid overlay: the drawable region is the taught grid's ACTUAL
                  shape (grid_shape_2d fitted into the viewport). Draw on this
                  quad and it maps 1:1 to the plane via toUvRef. A dashed
                  full-viewport box shows until the grid is fully marked. */}
              {vpSize.w > 0 && (() => {
                if (!gridQuad) {
                  const poly = [[0, 0], [1, 0], [1, 1], [0, 1]]
                    .map(([u, v]) => [u * vpSize.w, v * vpSize.h]
                      .map((n) => n.toFixed(1)).join(',')).join(' ')
                  return (
                    <svg className="dm-grid-overlay">
                      <polygon points={poly} fill="rgba(148,163,184,0.05)"
                        stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="7 5" />
                    </svg>
                  )
                }
                const { shape, rows, cols, toC } = gridQuad
                const lines = []
                for (let i = 0; i < rows; i++) {
                  lines.push(<polyline key={`gr-${i}`} points={
                    shape[i].map((p) => { const [x, y] = toC(p); return `${x.toFixed(1)},${y.toFixed(1)}` }).join(' ')
                  } />)
                }
                for (let j = 0; j < cols; j++) {
                  lines.push(<polyline key={`gc-${j}`} points={
                    shape.map((row) => { const [x, y] = toC(row[j]); return `${x.toFixed(1)},${y.toFixed(1)}` }).join(' ')
                  } />)
                }
                const cornerLabels = [
                  ['R1C1', 0, 0, 'start', 5, -6],
                  [`R1C${cols}`, 0, cols - 1, 'end', -5, -6],
                  [`R${rows}C1`, rows - 1, 0, 'start', 5, 14],
                  [`R${rows}C${cols}`, rows - 1, cols - 1, 'end', -5, 14],
                ].map(([t, i, j, anchor, dx, dy]) => {
                  const [x, y] = toC(shape[i][j])
                  return (
                    <text key={t} x={x + dx} y={y + dy} textAnchor={anchor}
                      fill="#22c55e" fontSize={11} fontWeight={700}>{t}</text>
                  )
                })
                const outerPts = [shape[0][0], shape[0][cols - 1], shape[rows - 1][cols - 1], shape[rows - 1][0]]
                  .map((p) => { const [x, y] = toC(p); return `${x.toFixed(1)},${y.toFixed(1)}` }).join(' ')
                return (
                  <svg className="dm-grid-overlay">
                    <polygon points={outerPts} fill="rgba(34,197,94,0.08)"
                      stroke="#22c55e" strokeWidth={2} />
                    <g stroke="#22c55e" strokeWidth={1} opacity={0.6} fill="none">{lines}</g>
                    {cornerLabels}
                  </svg>
                )
              })()}

            </div>

            {/* ── Right panel: toggle tab + content ── */}
            <div className={`dm-teach-col${isTeachMinimized ? ' dm-teach-col--minimized' : ''}`}>

              {/* Toggle tab — sticks to left edge, collapses/opens entire panel */}
              <button
                className="dm-teach-collapse-tab"
                onClick={() => setIsTeachMinimized((v) => !v)}
                title={isTeachMinimized ? 'เปิดเมนู' : 'พับเมนู'}
              >
                <svg
                  width="12" height="12" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 0.25s', transform: isTeachMinimized ? 'rotate(180deg)' : 'rotate(0deg)' }}
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              {!isTeachMinimized && (
                <div className="dm-teach-body">

                  {/* ── 3D Robot Arm ── */}
                  <div className="dm-teach-section dm-teach-3d-section">
                    <div className="dm-teach-3d-header">
                      <div className="dm-teach-3d-title-wrap">
                        <span className="dm-3d-title-dot" />
                        <span className="dm-3d-title-text">3D Robot Arm</span>
                      </div>
                    </div>
                    {is3DExpanded && (
                      <div className="dm-teach-3d-frame-wrap">
                        <iframe
                          src={`/robot-viewer.html?v=${viewerKey.current}&mode=display`}
                          title="Robot Arm 3D Viewer"
                          className="dm-3d-frame"
                          allow="accelerometer"
                        />
                      </div>
                    )}
                  </div>

                  {/* ── Align Points ── */}
                  <div className="dm-teach-section">
                    <div className="dm-teach-label-row">
                      <span className="ctrl-section-head">Align Points</span>
                      <button
                        className={`dm-mark-toggle${markMode ? ' active' : ''}`}
                        onClick={() => setMarkMode((v) => !v)}
                        disabled={!markReady}
                      >
                        {markMode ? 'Mark ON' : 'Mark OFF'}
                      </button>
                    </div>

                    <div className="dm-mark-modes">
                      <button
                        className={`dm-mark-mode${markClickMode === 'mark' ? ' active' : ''}`}
                        onClick={() => setMarkClickMode('mark')}
                        disabled={!markReady}
                      >
                        Mark
                      </button>
                      <button
                        className={`dm-mark-mode${markClickMode === 'goto' ? ' active' : ''}`}
                        onClick={() => setMarkClickMode('goto')}
                        disabled={!markReady}
                      >
                        Goto
                      </button>
                    </div>

                    <div className="dm-mark-hint">
                      {!markReady
                        ? 'Robot / Camera ไม่พร้อมใช้งาน'
                        : markMode
                          ? (markClickMode === 'mark'
                            ? 'คลิกบนภาพ 4 จุด (มุมวัตถุ) แล้วกด Align · วาดภาพถูกปิดชั่วคราว'
                            : 'คลิกบนภาพ = สั่งหุ่นไปจุดนั้น')
                          : 'กด Mark ON แล้วคลิกจุดบนภาพ'}
                    </div>

                    <div className="dm-mark-actions">
                      <button
                        className="dm-mark-btn"
                        onClick={() => alignAction('/api/map/reset_points', 'Points cleared')}
                        disabled={!markReady || alignBusy}
                      >
                        Reset
                      </button>
                      <button
                        className="dm-mark-btn dm-mark-btn--primary"
                        onClick={() => alignAction('/api/map/align', 'Align started')}
                        disabled={!markReady || alignBusy || !!(teachStatus && teachStatus.align_running) || markPoints.length < 4}
                      >
                        Align
                      </button>
                      <button
                        className="dm-mark-btn dm-mark-btn--danger"
                        onClick={() => alignAction('/api/map/align/stop', 'Stop requested')}
                        disabled={!markReady || alignBusy || !(teachStatus && teachStatus.align_running)}
                      >
                        Stop
                      </button>
                    </div>

                    <div className="dm-mark-readout">
                      <span>points</span><b>{markPoints.length}/4</b>
                      <span>align</span><b>{teachStatus && teachStatus.align_running ? 'running' : 'idle'}</b>
                      <span>tilt</span><b>{fmtMark(teachStatus && teachStatus.last_tilt)}°</b>
                      <span>rmse</span><b>{fmtMark(teachStatus && teachStatus.last_rmse)} mm</b>
                    </div>
                  </div>

                  {/* ── Grid ── */}
                  <div className="dm-teach-section">
                    <div className="ctrl-section-head">Grid (N×M taught points)</div>
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
                    <button
                      className="dm-teach-autofill-btn"
                      disabled={!teachConnected || markPoints.length < 4}
                      title={markPoints.length < 4
                        ? 'Mark 4 corner points on the image (Align Points) first'
                        : 'Jog Z down until the pen touches the surface FIRST, then click — the grid inherits the current Z'}
                      onClick={handleAutoFillGrid}
                    >
                      Auto-fill grid from 4 mark points
                    </button>
                    <button
                      className="dm-teach-surfacez-btn"
                      disabled={!teachConnected || markedCount === 0}
                      title="Compute the surface Z from the LIVE camera depth (run Align first) and drop the grid onto it — no jogging. The next Send descends ~that far."
                      onClick={handleGridSurfaceZ}
                    >
                      {`↧ Grid Z = measured surface (auto)${teachStatus && teachStatus.last_center_depth ? ` · depth ${Number(teachStatus.last_center_depth).toFixed(0)}mm` : ''}`}
                    </button>
                    <button
                      className="dm-teach-setz-btn"
                      disabled={!teachConnected || markedCount === 0}
                      title="Jog Z down until the pen touches the surface FIRST, then press — keeps the grid X/Y and takes this Z"
                      onClick={handleSetGridZ}
                    >
                      ↧ Grid Z = current Z  (jog to surface first)
                    </button>
                    {teachStatus && typeof teachStatus.z_surface === 'number' && (
                      <button
                        className="dm-teach-surfacez-btn"
                        disabled={!teachConnected || markedCount === 0}
                        title="Apply the surface Z configured in backend/.maps_point.env (Z_SURFACE) to every grid cell — no jogging needed"
                        onClick={handleSetGridZSurface}
                      >
                        {`↧ Grid Z = surface (${teachStatus.z_surface.toFixed(1)}mm, configured)`}
                      </button>
                    )}
                    <div className="dm-teach-hint">
                      jog Z ลงให้ปากกาแตะผิวงานก่อน แล้วกด Auto-fill · หรือ jog ไปมุมจริงแล้วกดปุ่มช่องนั้น
                    </div>
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
                          mark all 4 corners
                        </text>
                      )}
                    </svg>
                  </div>

                  {/* Inline action message */}
                  {teachMsg && (
                    <div className={`dm-teach-msg dm-teach-msg--${teachMsg.kind}`}>
                      {teachMsg.text}
                    </div>
                  )}
                </div>
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
                <button
                  id="btn-draw-stop"
                  className="dm-bar-btn dm-bar-btn--danger"
                  onClick={stopDraw}
                  disabled={!isSending && !(teachStatus && teachStatus.draw_running)}
                  title="Stop the running draw (ClearError + ResetRobot)"
                >■</button>
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

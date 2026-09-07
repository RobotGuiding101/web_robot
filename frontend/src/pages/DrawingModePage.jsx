import React, { useEffect, useRef, useState, useCallback } from 'react'
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
      // Use /api/map/draw with strokes format
      const strokes = pathData.map((obj) => {
        // Convert fabric objects to stroke points
        const points = []
        if (obj.type === 'path' && obj.path) {
          obj.path.forEach((cmd) => {
            if (cmd[0] === 'M' || cmd[0] === 'L') {
              points.push([cmd[1], cmd[2]])
            }
          })
        } else if (obj.type === 'line') {
          points.push([obj.x1, obj.y1], [obj.x2, obj.y2])
        }
        return { tool: 'pen', points }
      }).filter(s => s.points.length > 0)

      if (strokes.length === 0) {
        setStatus('⚠ No drawable paths found')
        return
      }

      await fetch('/api/map/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strokes }),
      })
      setStatus(`✓ Sent ${strokes.length} stroke(s)`)
    } catch {
      setStatus('✗ Failed — robot offline?')
    } finally {
      setIsSending(false)
    }
  }, [])

  // ── Emergency Stop ────────────────────────────────────────────────────────
  const handleEmergency = () => {
    fetch('/api/map/error', { method: 'POST' }).catch(() => {})
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

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar title="Drawing Mode" onEmergency={handleEmergency} />
        <div className="page-content" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          <div className="dm-ipad-shell">

            {/* ── Camera + Canvas overlay (fills all remaining space) ── */}
            <div className="dm-viewport">

              {/* Camera feed — MJPEG stream from backend (use /api/map/video_feed) */}
              <img
                src="/api/map/video_feed"
                alt="Camera 1"
                className="dm-camera-bg"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />

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

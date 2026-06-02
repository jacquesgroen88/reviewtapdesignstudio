import { useRef, useCallback } from 'react'

// Simple undo/redo stack for Fabric.js canvas state (JSON snapshots)
export function useHistory(fabricRef) {
  const stack  = useRef([])
  const cursor = useRef(-1)
  const paused = useRef(false)

  const snapshot = useCallback(() => {
    if (!fabricRef.current || paused.current) return
    const json = fabricRef.current.toJSON(['id', 'selectable', 'evented', 'lockMovementX', 'lockMovementY', 'hasControls', 'hasBorders', 'isBackground', 'snapZoneId'])
    // Truncate forward history
    stack.current = stack.current.slice(0, cursor.current + 1)
    stack.current.push(JSON.stringify(json))
    cursor.current = stack.current.length - 1
  }, [fabricRef])

  const undo = useCallback(() => {
    if (!fabricRef.current || cursor.current <= 0) return
    cursor.current -= 1
    const state = JSON.parse(stack.current[cursor.current])
    paused.current = true
    fabricRef.current.loadFromJSON(state, () => {
      fabricRef.current.renderAll()
      paused.current = false
    })
  }, [fabricRef])

  const redo = useCallback(() => {
    if (!fabricRef.current || cursor.current >= stack.current.length - 1) return
    cursor.current += 1
    const state = JSON.parse(stack.current[cursor.current])
    paused.current = true
    fabricRef.current.loadFromJSON(state, () => {
      fabricRef.current.renderAll()
      paused.current = false
    })
  }, [fabricRef])

  const canUndo = () => cursor.current > 0
  const canRedo = () => cursor.current < stack.current.length - 1

  const clear = useCallback(() => {
    stack.current = []
    cursor.current = -1
  }, [])

  return { snapshot, undo, redo, canUndo, canRedo, clear }
}

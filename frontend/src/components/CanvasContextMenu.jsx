import { useEffect, useRef } from 'react'

// Fixed-position right-click menu for a canvas asset. `x`/`y` are viewport
// coordinates (from the native MouseEvent); `items` is [{label, onClick, danger}]
// or {divider:true}. Dismisses on outside click, Escape, or scroll (position
// would otherwise go stale as the canvas pans).
export default function CanvasContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) onClose() }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  // Keep the menu on-screen near the right/bottom edges
  const style = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - (items.length * 36 + 16)),
  }

  return (
    <div ref={ref} style={style} className="z-50 min-w-[11rem] bg-white border border-gray-100 rounded-xl shadow-lg p-1 fade-in">
      {items.map((it, i) => it.divider ? (
        <div key={i} className="my-1 border-t border-gray-100" />
      ) : (
        <button key={i} disabled={it.disabled}
          onClick={() => { onClose(); it.onClick?.() }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed
            ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
          {it.icon}
          <span className="flex-1">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

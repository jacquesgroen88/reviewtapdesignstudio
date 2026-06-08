import { useState, useRef, useEffect } from 'react'

// Lightweight dropdown menu. `label` is the trigger content; `items` is an array
// of { label, icon, onClick, disabled, danger } or { divider:true }.
export default function Menu({ label, items, align = 'right', direction = 'up', className = '', disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button className={className} disabled={disabled} onClick={() => setOpen(o => !o)}>
        {label}
      </button>
      {open && (
        <div className={`absolute z-50 ${direction === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} ${align === 'right' ? 'right-0' : 'left-0'}
          min-w-[11rem] bg-white border border-gray-100 rounded-xl shadow-lg p-1 fade-in`}>
          {items.map((it, i) => it.divider ? (
            <div key={i} className="my-1 border-t border-gray-100" />
          ) : it.heading ? (
            <p key={i} className="px-3 pt-2 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">{it.heading}</p>
          ) : (
            <button key={i} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.() }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
              {it.icon}
              <span className="flex-1">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CanvasToolbar({
  canUndo, canRedo, onUndo, onRedo,
  selectedObj, onBringForward, onSendBackward, onDeleteSelected,
  zoom, onZoomIn, onZoomOut, onZoomReset, onFitScreen,
}) {
  const hasSelection = !!selectedObj && !selectedObj.isBackground
  const zoomPct = Math.round((zoom ?? 1) * 100)

  return (
    <div className="flex-1 px-3 py-2 flex items-center gap-1">
      {/* Undo / Redo */}
      <ToolBtn title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6"/><path d="M3 13C5.5 6 14 4 20 8"/>
        </svg>
      </ToolBtn>
      <ToolBtn title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6"/><path d="M21 13C18.5 6 10 4 4 8"/>
        </svg>
      </ToolBtn>

      <Divider />

      {/* Layer order */}
      <ToolBtn title="Bring forward" disabled={!hasSelection} onClick={onBringForward}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="1"/><rect x="3" y="3" width="12" height="12" rx="1" fill="white" stroke="currentColor"/>
          <polyline points="12 6 12 1 17 6"/>
        </svg>
      </ToolBtn>
      <ToolBtn title="Send backward" disabled={!hasSelection} onClick={onSendBackward}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="12" height="12" rx="1"/><rect x="3" y="3" width="12" height="12" rx="1" fill="white" stroke="currentColor"/>
          <polyline points="12 18 12 23 7 18"/>
        </svg>
      </ToolBtn>

      <Divider />

      {/* Delete */}
      <ToolBtn title="Delete selected (Delete key)" disabled={!hasSelection} onClick={onDeleteSelected} danger>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </ToolBtn>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Safe area legend */}
      <span className="hidden md:flex items-center gap-1.5 text-xs text-gray-400 mr-3 whitespace-nowrap shrink-0">
        <span className="w-4 h-px border-t border-dashed border-brand-400/60" />
        Safe area
      </span>

      <Divider />

      {/* Zoom controls */}
      <ToolBtn title="Zoom out" onClick={onZoomOut} disabled={zoom <= 0.4}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </ToolBtn>

      <button
        onClick={onZoomReset}
        title="Reset zoom (100%)"
        className="min-w-[3rem] px-2 py-1 text-xs font-mono font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      >
        {zoomPct}%
      </button>

      <ToolBtn title="Zoom in" onClick={onZoomIn} disabled={zoom >= 4.0}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </ToolBtn>

      <Divider />

      {/* Fit to screen */}
      <ToolBtn title="Fit to screen (reset zoom)" onClick={onFitScreen}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M8 21H5a2 2 0 0 1-2-2v-3M21 16v3a2 2 0 0 1-2 2h-3"/>
        </svg>
      </ToolBtn>

      {/* Pan hint */}
      <span className="hidden xl:block text-xs text-gray-300 ml-2 select-none whitespace-nowrap shrink-0">Ctrl+scroll zoom · Space-drag pan</span>
    </div>
  )
}

function ToolBtn({ children, title, disabled, onClick, danger }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed
        ${danger
          ? 'text-gray-400 hover:text-red-500 hover:bg-red-50'
          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
        }`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-4 bg-gray-100 mx-1 shrink-0" />
}

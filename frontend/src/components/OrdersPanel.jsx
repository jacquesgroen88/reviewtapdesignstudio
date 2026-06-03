import { useState, useEffect, useCallback } from 'react'

const STATUS_LABELS = {
  pending:          { label: 'Pending',          color: 'bg-amber-100 text-amber-700' },
  pending_approval: { label: 'Pending Approval',  color: 'bg-blue-100 text-blue-700' },
  pending_print:    { label: 'Pending Print',     color: 'bg-purple-100 text-purple-700' },
  done:             { label: 'Done',              color: 'bg-brand-100 text-brand-700' },
  skipped:          { label: 'Skipped',           color: 'bg-gray-100 text-gray-500' },
  not_needed:       { label: 'No design',         color: 'bg-gray-100 text-gray-400' },
  // legacy alias
  in_progress:      { label: 'Pending Approval',  color: 'bg-blue-100 text-blue-700' },
}

const STATUS_OPTIONS = [
  { value: 'pending',          label: 'Pending' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'pending_print',    label: 'Pending Print' },
  { value: 'done',             label: 'Done' },
  { value: 'skipped',          label: 'Skip' },
]

const FILTER_TABS = [
  { id: 'needs_design', label: 'Needs designing' },
  { id: 'all',          label: 'All orders' },
  { id: 'done',         label: 'Done' },
]

export default function OrdersPanel({ onDesignOrder }) {
  const [orders,   setOrders]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [filter,   setFilter]   = useState('needs_design')
  const [page,     setPage]     = useState(1)
  const [total,    setTotal]    = useState(0)
  const [updating, setUpdating] = useState(null)   // rowSlug being status-updated
  const [search,      setSearch]      = useState('')   // input value
  const [searchTerm,  setSearchTerm]  = useState('')   // debounced, sent to backend
  const PAGE_SIZE = 30

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = `filter=${filter}&page=${page}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(searchTerm)}`
      const res = await fetch(`/api/orders?${qs}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setOrders(data.orders)
      setTotal(data.count)
    } catch (e) {
      setError(e.message.includes('FORMALOO') || e.message.includes('500')
        ? 'Backend not running or Formaloo credentials not configured.'
        : e.message)
    } finally { setLoading(false) }
  }, [filter, page, searchTerm])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filter, searchTerm])

  // Debounce the search input → searchTerm
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  async function updateStatus(rowSlug, status) {
    setUpdating(rowSlug)
    try {
      await fetch(`/api/orders/${rowSlug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setOrders(prev => prev.map(o => o.rowSlug === rowSlug ? { ...o, status } : o))
    } finally { setUpdating(null) }
  }

  const pendingCount = orders.filter(o => o.status === 'pending').length

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            Orders
            {pendingCount > 0 && (
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                {pendingCount} pending
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">From Formaloo — {total} total submissions</p>
        </div>
        <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            className={loading ? 'animate-spin' : ''}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          className="input-field pl-10"
          placeholder="Search by company name or order number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-100">
        {FILTER_TABS.map(tab => (
          <button key={tab.id} onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px
              ${filter === tab.id
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
        {searchTerm && (
          <span className="ml-auto self-center text-xs text-gray-400">
            {total} result{total === 1 ? '' : 's'} for “{searchTerm}”
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-4">
          {error}
          {error.includes('Backend') && (
            <p className="mt-1 text-xs text-red-400">Run <code className="bg-red-100 px-1 rounded">cd backend && npm run dev</code> to start the backend.</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <svg className="animate-spin w-6 h-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No orders found for this filter.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {orders.map(order => (
              <OrderCard
                key={order.rowSlug}
                order={order}
                onDesign={() => onDesignOrder(order)}
                onStatusChange={s => updateStatus(order.rowSlug, s)}
                isUpdating={updating === order.rowSlug}
              />
            ))}
          </div>

          {/* Pagination */}
          {!searchTerm && total > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button className="btn-ghost text-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span className="text-sm text-gray-500">Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
              <button className="btn-ghost text-sm" disabled={page >= Math.ceil(total / PAGE_SIZE)} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OrderCard({ order, onDesign, onStatusChange, isUpdating }) {
  const [expanded, setExpanded] = useState(false)
  const status = STATUS_LABELS[order.status] ?? STATUS_LABELS.pending
  const canDesign = order.orderedStand || order.orderedCard

  return (
    <div className={`card p-4 space-y-3 ${order.status === 'done' ? 'border-brand-100' : ''}`}>
      {/* Top row: company + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 truncate">{order.companyName || '(no name)'}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            #{order.orderNumber}
            {order.submittedAt && (
              <> · {new Date(order.submittedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
            {status.label}
          </span>
          {order.hasDesign && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              saved
            </span>
          )}
        </div>
      </div>

      {/* Products ordered */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {order.orderedStand && <ProductTag label="Stand" icon="📋" />}
        {order.orderedCard  && <ProductTag label="Card"  icon="💳" />}
        {!order.orderedStand && !order.orderedCard && (
          <span className="text-xs text-gray-400">No custom design ordered</span>
        )}
      </div>

      {/* Designs created */}
      {order.designedProducts?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap items-center">
          <span className="text-xs text-gray-400">Designed:</span>
          {order.designedProducts.map(pid => (
            <span key={pid} className="inline-flex items-center gap-1 text-xs font-medium bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              {pid === 'stand' ? 'Stand' : pid === 'card' ? 'Card' : pid}
            </span>
          ))}
        </div>
      )}

      {/* Logo preview */}
      {order.logoUrl && (
        <div className="flex items-center gap-2.5 p-2 bg-gray-50 rounded-xl">
          <img
            src={order.logoUrl}
            alt="Logo"
            className="w-12 h-10 object-contain rounded border border-gray-100 bg-white"
            onError={e => { e.target.style.display = 'none' }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-600">Logo uploaded</p>
            <p className="text-xs text-gray-400 truncate">{order.logoUrl.split('/').pop()?.slice(0, 24)}</p>
          </div>
          <button
            onClick={() => editLogoInCanva(order)}
            title="Download the original logo and open Canva to edit it"
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            Canva
          </button>
        </div>
      )}

      {/* Google review link */}
      {order.googleReviewUrl && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-brand-400">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <a href={order.googleReviewUrl} target="_blank" rel="noopener noreferrer"
            className="truncate hover:text-brand-600 transition-colors">
            {order.googleReviewUrl.replace('https://', '')}
          </a>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="text-xs text-gray-500 space-y-1 pt-1 border-t border-gray-50">
          {order.cardEmail    && <p><span className="text-gray-400">Email:</span> {order.cardEmail}</p>}
          {order.cardPhone    && <p><span className="text-gray-400">Phone:</span> {order.cardPhone}</p>}
          {order.whatsapp     && <p><span className="text-gray-400">WhatsApp:</span> {order.whatsapp}</p>}
          {order.cardAddress  && <p><span className="text-gray-400">Address:</span> {order.cardAddress.slice(0, 80)}</p>}
          {order.landingPageText && <p><span className="text-gray-400">Landing text:</span> {order.landingPageText.slice(0, 100)}</p>}
        </div>
      )}

      <button onClick={() => setExpanded(e => !e)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        {expanded ? '▲ Less detail' : '▼ More detail'}
      </button>

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-gray-50">
        {canDesign && (
          <button
            className="btn-primary flex-1 text-sm py-2"
            onClick={onDesign}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            {order.hasDesign || order.status === 'done' ? 'Edit' : 'Design'}
          </button>
        )}
        <StatusDropdown
          current={order.status}
          onChange={onStatusChange}
          loading={isUpdating}
        />
      </div>
    </div>
  )
}

// Download the original-quality logo (via same-origin proxy so the download
// attribute is honoured), then open Canva so it can be dragged in to edit.
async function editLogoInCanva(order) {
  try {
    const proxied = `/api/proxy-image?url=${encodeURIComponent(order.logoUrl)}`
    const ext = (order.logoUrl.split('.').pop() || 'png').split('?')[0].slice(0, 4)
    const name = (order.companyName || 'logo').replace(/[^a-z0-9]/gi, '_')
    const resp = await fetch(proxied)
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${name}_logo.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  } catch (err) {
    console.error('logo download failed', err)
  }
  window.open('https://www.canva.com/', '_blank', 'noopener')
}

function ProductTag({ label, icon }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
      <span>{icon}</span>{label}
    </span>
  )
}

function StatusDropdown({ current, onChange, loading }) {
  const options = STATUS_OPTIONS
  // Map legacy / not_needed onto a valid option
  const normalized = current === 'in_progress' ? 'pending_approval'
    : current === 'not_needed' ? 'skipped'
    : (current || 'pending')
  return (
    <div className="relative">
      <select
        value={normalized}
        onChange={e => onChange(e.target.value)}
        disabled={loading}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-400 disabled:opacity-50"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

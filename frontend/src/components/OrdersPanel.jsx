import { useState, useEffect, useCallback } from 'react'
import Menu from './Menu.jsx'
import { apiFetch } from '../lib/api.js'
import { createApprovalRequest } from '../lib/approvals.js'
import { createLogoRequest } from '../lib/logoRequest.js'
import ApprovalShareModal from './ApprovalShareModal.jsx'
import LogoRequestShareModal from './LogoRequestShareModal.jsx'
import ManualOrderModal from './ManualOrderModal.jsx'

const STATUS_LABELS = {
  pending:          { label: 'Pending',          color: 'bg-amber-100 text-amber-700' },
  ready:            { label: 'Ready',             color: 'bg-teal-100 text-teal-700' },
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
  { value: 'ready',            label: 'Ready' },
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

export default function OrdersPanel({ onNewDesign, onOpenDesign }) {
  const [orders,   setOrders]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [filter,   setFilter]   = useState('needs_design')
  const [page,     setPage]     = useState(1)
  const [total,    setTotal]    = useState(0)
  const [updating, setUpdating] = useState(null)   // rowSlug being status-updated
  const [sendingApproval, setSendingApproval] = useState(null)   // rowSlug being rendered/sent
  const [approvalResult,  setApprovalResult]  = useState(null)   // {result, clientName} → share modal
  const [search,      setSearch]      = useState('')   // input value
  const [searchTerm,  setSearchTerm]  = useState('')   // debounced, sent to backend
  const [manualModal, setManualModal] = useState(null)   // {mode:'new'} | {mode:'edit', order} | null
  const [missingLogo, setMissingLogo] = useState([])
  const [missingLogoOpen, setMissingLogoOpen] = useState(false)
  const [logoRequestResult, setLogoRequestResult] = useState(null)   // {result, companyName, hasPhone} → share modal
  const [requestingLogo, setRequestingLogo] = useState(null)   // orderNumber (banner) or rowSlug (order card) in flight
  const PAGE_SIZE = 30

  const refreshMissingLogo = useCallback(() => {
    apiFetch('/api/orders/missing-logo')
      .then(res => res.ok ? res.json() : { orders: [] })
      .then(data => setMissingLogo(data.orders || []))
      .catch(() => {})
  }, [])

  // Shopify orders that need a logo but never came through Formaloo or manual
  // entry — checked once on load, not tied to the filter/search/page state.
  useEffect(() => { refreshMissingLogo() }, [refreshMissingLogo])

  // Banner row → one click creates the manual order (company name is a
  // placeholder — we don't have it without customer PII from Shopify) and
  // the logo-request link in the same motion. No known phone yet, so the
  // share modal falls back to copy-link only.
  async function requestLogoFromBanner(o) {
    setRequestingLogo(o.orderNumber)
    setError(null)
    try {
      const createRes = await apiFetch('/api/orders/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: `Order #${o.orderNumber}`, orderNumber: o.orderNumber, orderedStand: o.requiresStand, orderedCard: o.requiresCard }),
      })
      if (!createRes.ok) throw new Error((await createRes.json().catch(() => ({}))).error || 'could not create the order')
      const manual = await createRes.json()
      const result = await createLogoRequest(manual.rowSlug)
      setLogoRequestResult({ result, companyName: manual.companyName, hasPhone: false })
      load(); refreshMissingLogo()
    } catch (err) {
      setError(`Logo request failed: ${err.message || 'network error'}`)
    } finally { setRequestingLogo(null) }
  }

  // Order-card version — the order already exists, so just (re)generate its link.
  async function requestLogoForOrder(order) {
    setRequestingLogo(order.rowSlug)
    setError(null)
    try {
      const result = await createLogoRequest(order.rowSlug)
      setLogoRequestResult({ result, companyName: order.companyName, hasPhone: !!(order.whatsapp) })
    } catch (err) {
      setError(`Logo request failed: ${err.message || 'network error'}`)
    } finally { setRequestingLogo(null) }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = `filter=${filter}&page=${page}&pageSize=${PAGE_SIZE}&search=${encodeURIComponent(searchTerm)}`
      const res = await apiFetch(`/api/orders?${qs}`)
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
      const res = await apiFetch(`/api/orders/${rowSlug}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await res.text())
      setOrders(prev => prev.map(o => o.rowSlug === rowSlug ? { ...o, status } : o))
      setError(null)
    } catch (err) {
      // Status stays unchanged in the UI — never show a state the backend didn't accept
      setError(`Could not update the order status: ${err.message || 'network error'}`)
    } finally { setUpdating(null) }
  }

  // One approval link covering every design on the order (stand + card together)
  async function sendApproval(order) {
    setSendingApproval(order.rowSlug)
    setError(null)
    try {
      const designs = []
      for (const meta of order.designs) {
        const res = await apiFetch(`/api/designs/${meta.id}`)
        if (!res.ok) throw new Error(`could not load design "${meta.name}"`)
        designs.push(await res.json())
      }
      const result = await createApprovalRequest({
        designs,
        ownerSlug: order.rowSlug,
        clientName: order.companyName,
        whatsapp: order.whatsapp,
        orderNumber: order.orderNumber,
      })
      setApprovalResult({ result, clientName: order.companyName })
      setOrders(prev => prev.map(o => o.rowSlug === order.rowSlug ? { ...o, status: 'pending_approval' } : o))
    } catch (err) {
      setError(`Approval link failed: ${err.message || 'unknown error'}`)
    } finally { setSendingApproval(null) }
  }

  async function deleteManualOrder(order) {
    if (!confirm(`Delete this manually-entered order for "${order.companyName}"? Any designs already made stay in the library.`)) return
    try {
      const res = await apiFetch(`/api/orders/manual/${order.rowSlug}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      load()
    } catch (err) {
      setError(`Delete failed: ${err.message || 'network error'}`)
    }
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
          <p className="text-sm text-gray-400 mt-0.5">From Formaloo (+ manual entries) — {total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setManualModal({ mode: 'new' })} className="btn-secondary text-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New order
          </button>
          <button onClick={load} className="btn-ghost text-sm" disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
              className={loading ? 'animate-spin' : ''}>
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {manualModal && (
        <ManualOrderModal
          initial={manualModal.order || null}
          onClose={() => setManualModal(null)}
          onSaved={() => { setManualModal(null); load(); refreshMissingLogo() }}
        />
      )}

      {logoRequestResult && (
        <LogoRequestShareModal
          result={logoRequestResult.result}
          companyName={logoRequestResult.companyName}
          hasPhone={logoRequestResult.hasPhone}
          onClose={() => setLogoRequestResult(null)}
        />
      )}

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

      {missingLogo.length > 0 && (
        <div className="bg-orange-50 border border-orange-100 rounded-xl mb-4 overflow-hidden">
          <button onClick={() => setMissingLogoOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="text-sm font-medium text-orange-800">
              {missingLogo.length} paid Shopify order{missingLogo.length === 1 ? '' : 's'} with no logo submission
            </span>
            <span className="text-xs text-orange-500">{missingLogoOpen ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {missingLogoOpen && (
            <div className="px-4 pb-3 space-y-1.5">
              {missingLogo.map(o => (
                <div key={o.orderNumber} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-orange-100">
                  <span className="text-xs font-semibold text-gray-700">#{o.orderNumber}</span>
                  <span className="text-xs text-gray-400">× {o.quantity}</span>
                  <span className="flex-1" />
                  <button
                    className="text-xs font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50"
                    onClick={() => requestLogoFromBanner(o)}
                    disabled={requestingLogo === o.orderNumber}
                    title="Creates the order and gives you a link the customer can upload their logo through"
                  >
                    {requestingLogo === o.orderNumber ? 'Creating…' : 'Request logo'}
                  </button>
                  <button
                    className="text-xs font-medium text-gray-400 hover:text-gray-600"
                    onClick={() => setManualModal({ mode: 'new', order: { orderNumber: o.orderNumber, orderedStand: o.requiresStand, orderedCard: o.requiresCard } })}
                  >
                    + Log manually
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                onNewDesign={() => onNewDesign(order)}
                onOpenDesign={onOpenDesign}
                onStatusChange={s => updateStatus(order.rowSlug, s)}
                isUpdating={updating === order.rowSlug}
                onSendApproval={() => sendApproval(order)}
                isSendingApproval={sendingApproval === order.rowSlug}
                onEditManual={() => setManualModal({ mode: 'edit', order })}
                onDeleteManual={() => deleteManualOrder(order)}
                onRequestLogo={() => requestLogoForOrder(order)}
                isRequestingLogo={requestingLogo === order.rowSlug}
              />
            ))}
          </div>

          {approvalResult && (
            <ApprovalShareModal
              result={approvalResult.result}
              clientName={approvalResult.clientName}
              onClose={() => { setApprovalResult(null); load() }}
            />
          )}

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

// Chip describing where a design's latest approval link stands
function ApprovalChip({ approval }) {
  if (!approval) return null
  const days = Math.floor((Date.now() - new Date(approval.sent_at)) / 86400000)
  const ago = days === 0 ? 'today' : `${days}d ago`
  let cls, text, title
  if (approval.superseded)                { cls = 'bg-gray-100 text-gray-500';   text = 'link outdated';            title = 'The design changed after this link was sent' }
  else if (approval.response === 'approved') { cls = 'bg-brand-100 text-brand-700'; text = '✓ approved';             title = `Client approved ${approval.responded_at ? new Date(approval.responded_at).toLocaleDateString('en-ZA') : ''}` }
  else if (approval.response === 'changes')  { cls = 'bg-orange-100 text-orange-700'; text = 'changes requested';   title = approval.comment || 'Client requested changes' }
  else if (approval.viewed_at)            { cls = 'bg-blue-100 text-blue-700';   text = `seen · sent ${ago}`;       title = 'Client opened the link but has not answered yet' }
  else                                    { cls = 'bg-amber-100 text-amber-700'; text = `sent ${ago}`;              title = 'Client has not opened the link yet' }
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 ${cls}`} title={title}>{text}</span>
}

function OrderCard({ order, onNewDesign, onOpenDesign, onStatusChange, isUpdating, onSendApproval, isSendingApproval, onEditManual, onDeleteManual, onRequestLogo, isRequestingLogo }) {
  const [expanded, setExpanded] = useState(false)
  const status = STATUS_LABELS[order.status] ?? STATUS_LABELS.pending
  const canDesign = order.orderedStand || order.orderedCard
  const isManual = order.source === 'manual'
  const needsLogo = isManual && !order.logoUrl

  return (
    <div className={`card p-4 space-y-3 ${order.status === 'done' ? 'border-brand-100' : ''}`}>
      {/* Top row: logo thumb + company + status */}
      <div className="flex items-start gap-2.5">
        {order.logoUrl && (
          <img src={order.logoUrl} alt="" onError={e => { e.target.style.display = 'none' }}
            className="w-9 h-9 object-contain rounded-lg border border-gray-100 bg-white shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate">
            {order.companyName || '(no name)'}
            {isManual && <span className="ml-1.5 text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 align-middle">Manual</span>}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {order.orderNumber ? <>#{order.orderNumber}</> : (isManual ? 'no order #' : null)}
            {order.submittedAt && <> · {new Date(order.submittedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</>}
            {(order.orderedStand || order.orderedCard) && (
              <> · ordered {[order.orderedStand && 'Stand', order.orderedCard && 'Card'].filter(Boolean).join(' + ')}</>
            )}
          </p>
          {order.shopify && (
            <p className="text-xs text-gray-400 mt-0.5" title="Live from Shopify">
              Shopify: × {order.shopify.quantity}
              {' · '}{order.shopify.fulfillmentStatus.replace(/_/g, ' ').toLowerCase()}
              {order.shopify.financialStatus !== 'PAID' && <span className="text-orange-500"> · {order.shopify.financialStatus.toLowerCase()}</span>}
            </p>
          )}
        </div>
        {isManual && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEditManual} title="Edit this order" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button onClick={onDeleteManual} title="Delete this order" className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            </button>
          </div>
        )}
        <div className="shrink-0">
          <StatusDropdown current={order.status} onChange={onStatusChange} loading={isUpdating} />
        </div>
      </div>

      {/* Designs for this order — the actionable focus */}
      {order.designs?.length > 0 && (
        <div className="space-y-1">
          {order.designs.map(d => (
            <div key={d.id}>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-brand-500 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                <span className="flex-1 min-w-0 text-xs font-medium text-gray-700 truncate">{d.name}</span>
                <ApprovalChip approval={d.approval} />
                {d.created_by_name && <span className="text-xs text-gray-400 shrink-0" title={`Created by ${d.created_by_name}`}>by {d.created_by_name}</span>}
                <span className="text-xs text-gray-400 shrink-0">{d.product_id === 'stand' ? 'Stand' : 'Card'}</span>
                {d.approval?.token && !d.approval.superseded && (
                  <a href={`${window.location.origin}/approve/${d.approval.token}`} target="_blank" rel="noopener noreferrer"
                    title="Open the exact link the client received"
                    className="shrink-0 text-xs font-medium text-gray-500 hover:text-gray-700">View</a>
                )}
                <button onClick={() => onOpenDesign({ ...d, ownerName: order.companyName, logoUrl: order.logoUrl, googleReviewUrl: order.googleReviewUrl })}
                  className="shrink-0 text-xs font-medium text-brand-600 hover:text-brand-700">Edit</button>
              </div>
              {/* Client's change request, shown inline (not just on hover) */}
              {d.approval?.response === 'changes' && d.approval?.comment && (
                <div className="mt-1 ml-4 mr-1 px-3 py-2 rounded-lg bg-orange-50 border border-orange-100">
                  <p className="text-xs text-orange-800">
                    <span className="font-semibold">Client requested changes:</span> “{d.approval.comment}”
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {needsLogo && (
          <button className="btn-primary flex-1 text-sm py-2 !bg-orange-500 hover:!bg-orange-600" onClick={onRequestLogo} disabled={isRequestingLogo}
            title="Get a link the customer can upload their logo through">
            {isRequestingLogo ? 'Creating…' : 'Request logo'}
          </button>
        )}
        {canDesign && !needsLogo && (
          <button className="btn-primary flex-1 text-sm py-2" onClick={onNewDesign}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New design
          </button>
        )}
        {order.designs?.length > 0 && (
          <button className="btn-secondary flex-1 text-sm py-2" onClick={onSendApproval} disabled={isSendingApproval}
            title="Create one approval link covering every design on this order">
            {isSendingApproval ? 'Rendering…' : 'Send for approval'}
          </button>
        )}
      </div>

      <button onClick={() => setExpanded(e => !e)} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
        {expanded ? '▲ Hide details' : '▼ Logo, review link & contact'}
      </button>

      {/* Expanded reference details */}
      {expanded && (
        <div className="space-y-2 pt-1 border-t border-gray-50">
          {order.logoUrl && (
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-gray-400 shrink-0">Logo:</span>
              <span className="flex-1 min-w-0 text-xs text-gray-500 truncate">{order.logoUrl.split('/').pop()?.slice(0, 28)}</span>
              <button onClick={() => editLogoInCanva(order)} title="Download the logo and open Canva to edit it"
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 transition-colors">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                Canva
              </button>
            </div>
          )}
          {order.googleReviewUrl && (
            <p className="text-xs text-gray-500 truncate">
              <span className="text-gray-400">Review:</span>{' '}
              <a href={order.googleReviewUrl} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">{order.googleReviewUrl.replace('https://', '')}</a>
            </p>
          )}
          {order.cardEmail    && <p className="text-xs text-gray-500"><span className="text-gray-400">Email:</span> {order.cardEmail}</p>}
          {order.cardPhone    && <p className="text-xs text-gray-500"><span className="text-gray-400">Phone:</span> {order.cardPhone}</p>}
          {order.whatsapp     && <p className="text-xs text-gray-500"><span className="text-gray-400">WhatsApp:</span> {order.whatsapp}</p>}
          {order.cardAddress  && <p className="text-xs text-gray-500"><span className="text-gray-400">Address:</span> {order.cardAddress.slice(0, 80)}</p>}
          {order.landingPageText && <p className="text-xs text-gray-500"><span className="text-gray-400">Landing text:</span> {order.landingPageText.slice(0, 100)}</p>}
        </div>
      )}
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
  const normalized = current === 'in_progress' ? 'pending_approval'
    : current === 'not_needed' ? 'skipped'
    : (current || 'pending')
  const cur = STATUS_LABELS[normalized] ?? STATUS_LABELS.pending
  return (
    <Menu
      direction="down"
      align="right"
      disabled={loading}
      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 transition-opacity disabled:opacity-50 ${cur.color}`}
      label={<>{loading ? 'Saving…' : cur.label}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg></>}
      items={STATUS_OPTIONS.map(o => ({ label: o.label, onClick: () => onChange(o.value) }))}
    />
  )
}

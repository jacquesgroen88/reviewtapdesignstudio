import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { apiFetch } from '../lib/api.js'
import { readFileAsDataURL } from '../lib/logoPipeline.js'

// Create or edit an order that didn't come through Formaloo (a walk-in client,
// a one-off job, anything you need in the pipeline without a form submission).
// Same fields Formaloo orders carry, so the rest of the studio can't tell
// the difference once it exists.
export default function ManualOrderModal({ initial, onClose, onSaved }) {
  const isEdit = !!initial
  const [companyName,      setCompanyName]      = useState(initial?.companyName || '')
  const [orderNumber,      setOrderNumber]      = useState(initial?.orderNumber || '')
  const [googleReviewUrl,  setGoogleReviewUrl]  = useState(initial?.googleReviewUrl || '')
  const [whatsapp,         setWhatsapp]         = useState(initial?.whatsapp || '')
  const [email,            setEmail]            = useState(initial?.cardEmail || '')
  const [phone,            setPhone]            = useState(initial?.cardPhone || '')
  const [address,          setAddress]          = useState(initial?.cardAddress || '')
  const [orderedStand,     setOrderedStand]     = useState(initial?.orderedStand ?? true)
  const [orderedCard,      setOrderedCard]      = useState(initial?.orderedCard ?? false)
  const [logoPreview,      setLogoPreview]      = useState(initial?.logoUrl || null)
  const [logoDataUrl,      setLogoDataUrl]      = useState(null)   // only set if a NEW file was dropped
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')

  const onDrop = async ([file]) => {
    if (!file) return
    const dataUrl = await readFileAsDataURL(file)
    setLogoDataUrl(dataUrl)
    setLogoPreview(dataUrl)
  }
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: { 'image/png': [], 'image/jpeg': [], 'image/svg+xml': [], 'image/webp': [] }, multiple: false,
  })

  async function handleSave() {
    if (!companyName.trim()) { setErr('Company / client name is required.'); return }
    setSaving(true); setErr('')
    try {
      const body = {
        companyName: companyName.trim(), orderNumber: orderNumber.trim(),
        googleReviewUrl: googleReviewUrl.trim(), whatsapp: whatsapp.trim(),
        email: email.trim(), phone: phone.trim(), address: address.trim(),
        orderedStand, orderedCard,
        ...(logoDataUrl ? { logo: logoDataUrl } : {}),
      }
      const res = await apiFetch(isEdit ? `/api/orders/manual/${initial.rowSlug}` : '/api/orders/manual', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'save failed')
      onSaved()
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-lg p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit order' : 'New order'}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {!isEdit && <p className="text-xs text-gray-400 -mt-2">For jobs that didn't come through the Formaloo form — walk-ins, one-off orders, anything you need in the pipeline directly.</p>}

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Company / client name</label>
            <input className="input-field" value={companyName} onChange={e => setCompanyName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Order # <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input-field" value={orderNumber} onChange={e => setOrderNumber(e.target.value)} placeholder="e.g. 1900" />
          </div>
          <div>
            <label className="label">WhatsApp</label>
            <input className="input-field" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="082 555 1234" />
          </div>
        </div>

        <div>
          <label className="label">Logo <span className="text-gray-400 font-normal">(optional)</span></label>
          <div {...getRootProps()} className={`border-2 border-dashed rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors
            ${isDragActive ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300'}`}>
            <input {...getInputProps()} />
            {logoPreview
              ? <img src={logoPreview} alt="Logo" className="w-10 h-10 object-contain rounded-lg bg-white border border-gray-100" />
              : <div className="w-10 h-10 rounded-lg bg-gray-50 border border-gray-100" />}
            <p className="text-xs text-gray-500">{logoPreview ? 'Drop to replace' : 'Drop a logo file, or click to choose'}</p>
          </div>
        </div>

        <div>
          <label className="label">Google review URL <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input-field" type="url" value={googleReviewUrl} onChange={e => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/..." />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Email <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input-field" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Phone <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="input-field" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Address <span className="text-gray-400 font-normal">(optional)</span></label>
          <input className="input-field" value={address} onChange={e => setAddress(e.target.value)} />
        </div>

        <div>
          <label className="label">Ordered</label>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={orderedStand} onChange={e => setOrderedStand(e.target.checked)} /> Stand
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={orderedCard} onChange={e => setOrderedCard(e.target.checked)} /> Card
            </label>
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create order')}
          </button>
        </div>
      </div>
    </div>
  )
}

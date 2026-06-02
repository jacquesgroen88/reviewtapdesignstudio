export default function CompletionScreen({ session, results }) {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-64px)] p-6 fade-in">
      <div className="w-full max-w-lg text-center">
        {/* Success icon */}
        <div className="inline-flex items-center justify-center w-20 h-20 bg-brand-50 rounded-full mb-6">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">You're all done!</h1>
        <p className="text-gray-500 text-base leading-relaxed mb-8">
          Your artwork has been sent directly to print. There's nothing more you need to do — we'll take it from here.
        </p>

        {/* Summary card */}
        <div className="card p-6 text-left mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Files submitted</p>
              <p className="text-xs text-gray-400">{session.businessName} · Order {session.orderNumber}</p>
            </div>
          </div>

          <ul className="space-y-2">
            {results.map(({ product }) => (
              <li key={product.id} className="flex items-center gap-2.5 text-sm text-gray-600">
                <div className="w-5 h-5 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-brand-600"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <span className="font-medium text-gray-800">{product.name}</span>
                <span className="text-gray-400 text-xs ml-auto">{session.businessName}_{product.name}_Design.tiff</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 leading-relaxed">
          <p>Questions about your order? Contact us at <span className="text-brand-600 font-medium">hello@reviewtap.com</span></p>
        </div>
      </div>
    </div>
  )
}

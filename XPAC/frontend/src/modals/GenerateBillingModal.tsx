import React, { useState, useEffect, useRef } from 'react';
import { X, Zap, ChevronDown, DollarSign, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { getBillingRecords, generateCustomBilling, BillingRecord } from '../services/billingService';

interface GenerateBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  colorPalette?: { primary: string; secondary?: string; accent?: string } | null;
  isDarkMode?: boolean;
}

interface AlertState {
  show: boolean;
  type: 'success' | 'error';
  title: string;
  message: string;
  details?: {
    soa?: any;
    invoice?: any;
    notifications?: any;
  };
}

const GenerateBillingModal: React.FC<GenerateBillingModalProps> = ({
  isOpen,
  onClose,
  colorPalette,
  isDarkMode = true,
}) => {
  const [accounts, setAccounts] = useState<BillingRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountNo, setSelectedAccountNo] = useState('');
  const [serviceCharge, setServiceCharge] = useState('0.00');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [alert, setAlert] = useState<AlertState>({ show: false, type: 'success', title: '', message: '' });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const primary = colorPalette?.primary || '#7c3aed';
  const accent = colorPalette?.accent || primary;

  /* ── theme-aware colours ────────────────────────────────────────── */
  const bg = isDarkMode ? '#111827' : '#ffffff';
  const surface = isDarkMode ? '#1f2937' : '#f9fafb';
  const border = isDarkMode ? '#374151' : '#e5e7eb';
  const text = isDarkMode ? '#f9fafb' : '#111827';
  const subtext = isDarkMode ? '#9ca3af' : '#6b7280';
  const inputBg = isDarkMode ? '#111827' : '#ffffff';

  /* ── load accounts on open ──────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) return;
    setLoadingAccounts(true);

    const fetchAllAccounts = async () => {
      const allRecords: BillingRecord[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const { data, hasMore: more } = await getBillingRecords(page, 500);
        allRecords.push(...data);
        hasMore = more;
        page++;
      }

      setAccounts(allRecords);
    };

    fetchAllAccounts()
      .catch(console.error)
      .finally(() => setLoadingAccounts(false));
  }, [isOpen]);

  /* ── close dropdown when clicking outside ───────────────────────── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  /* ── reset on close ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      setSelectedAccountNo('');
      setServiceCharge('0.00');
      setDropdownOpen(false);
      setSearchQuery('');
      setAlert({ show: false, type: 'success', title: '', message: '' });
      setLoadingPct(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredAccounts = accounts.filter(a => {
    const q = searchQuery.toLowerCase();
    return (
      a.customerName?.toLowerCase().includes(q) ||
      a.accountNo?.toLowerCase().includes(q) ||
      a.account_no?.toLowerCase().includes(q)
    );
  });

  const selectedAccount = accounts.find(
    a => (a.accountNo || a.account_no) === selectedAccountNo
  );

  const handleServiceChargeChange = (val: string) => {
    // allow only numeric + decimal
    const cleaned = val.replace(/[^0-9.]/g, '');
    setServiceCharge(cleaned);
  };

  const handleServiceChargeBlur = () => {
    const num = parseFloat(serviceCharge) || 0;
    setServiceCharge(num.toFixed(2));
  };

  const startProgress = () => {
    setLoadingPct(0);
    progressIntervalRef.current = setInterval(() => {
      setLoadingPct(prev => {
        if (prev >= 90) return Math.min(99, prev + 0.5);
        return Math.min(90, prev + 8);
      });
    }, 300);
  };

  const finishProgress = (success: boolean) => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setLoadingPct(success ? 100 : 0);
  };

  const handleGenerate = async () => {
    if (!selectedAccountNo) {
      setAlert({ show: true, type: 'error', title: 'Validation Error', message: 'Please select a customer account.' });
      return;
    }

    setIsGenerating(true);
    setAlert({ show: false, type: 'success', title: '', message: '' });
    startProgress();

    const charge = parseFloat(serviceCharge) || 0;

    try {
      const result = await generateCustomBilling(selectedAccountNo, charge);
      finishProgress(result.success);

      if (result.success) {
        const data = result.data || {};
        const soaId = data.soa?.id ? `#${data.soa.id}` : '';
        const invId = data.invoice?.id ? `#${data.invoice.id}` : '';
        const emailStatus = data.notifications?.email_queued ? '✓ Email queued' : '✗ Email not sent';
        const smsStatus = data.notifications?.sms_sent ? '✓ SMS sent' : '✗ SMS not sent';
        const chargeNote = charge > 0 ? `\nService Charge Applied: ₱${charge.toFixed(2)}` : '';

        setAlert({
          show: true,
          type: 'success',
          title: 'Billing Generated Successfully!',
          message: `Customer: ${data.customer_name || selectedAccountNo}${chargeNote}\nSOA ${soaId} & Invoice ${invId} created.\n${emailStatus} · ${smsStatus}`,
          details: data,
        });
      } else {
        setAlert({ show: true, type: 'error', title: 'Generation Failed', message: result.message || 'An unexpected error occurred.' });
      }
    } catch (err: any) {
      finishProgress(false);
      setAlert({ show: true, type: 'error', title: 'Error', message: err?.message || 'Unexpected error occurred.' });
    } finally {
      setTimeout(() => setIsGenerating(false), 400);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998]"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        onClick={() => { if (!isGenerating) onClose(); }}
      />

      {/* Drawer panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-[9999] flex flex-col"
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: bg,
          borderLeft: `1px solid ${border}`,
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
          animation: 'slideInRight 0.3s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '24px',
            borderBottom: `1px solid ${border}`,
            background: `linear-gradient(135deg, ${primary}18 0%, transparent 60%)`,
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center rounded-xl"
                style={{ width: 44, height: 44, backgroundColor: `${primary}20` }}
              >
                <Zap size={22} style={{ color: primary }} />
              </div>
              <div>
                <h2 className="font-bold text-lg" style={{ color: text }}>
                  Generate Billing
                </h2>
                <p className="text-sm" style={{ color: subtext }}>
                  Manual custom billing generation
                </p>
              </div>
            </div>
            <button
              onClick={() => { if (!isGenerating) onClose(); }}
              disabled={isGenerating}
              className="rounded-lg p-2 transition-colors"
              style={{ backgroundColor: `${border}80`, color: subtext }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = border; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = `${border}80`; }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '24px' }}>

          {/* Alert banner */}
          {alert.show && (
            <div
              className="mb-5 rounded-xl p-4 flex items-start gap-3"
              style={{
                backgroundColor: alert.type === 'success' ? '#065f4620' : '#7f1d1d20',
                border: `1px solid ${alert.type === 'success' ? '#10b981' : '#ef4444'}40`,
              }}
            >
              {alert.type === 'success'
                ? <CheckCircle size={20} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                : <XCircle size={20} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
              }
              <div>
                <p className="font-semibold text-sm" style={{ color: alert.type === 'success' ? '#10b981' : '#ef4444' }}>
                  {alert.title}
                </p>
                <p className="text-xs mt-1 whitespace-pre-line" style={{ color: subtext }}>
                  {alert.message}
                </p>
              </div>
            </div>
          )}

          {/* ── Customer Dropdown ── */}
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2" style={{ color: text }}>
              Customer Account <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div ref={dropdownRef} className="relative">
              <button
                id="billing-customer-select"
                onClick={() => !loadingAccounts && setDropdownOpen(p => !p)}
                disabled={loadingAccounts || isGenerating}
                className="w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-all"
                style={{
                  backgroundColor: inputBg,
                  border: `1.5px solid ${dropdownOpen ? primary : border}`,
                  color: selectedAccount ? text : subtext,
                  boxShadow: dropdownOpen ? `0 0 0 3px ${primary}25` : 'none',
                  cursor: loadingAccounts ? 'wait' : 'pointer',
                }}
              >
                <span className="truncate">
                  {loadingAccounts
                    ? 'Loading accounts…'
                    : selectedAccount
                      ? `${selectedAccount.customerName} — ${selectedAccount.accountNo || selectedAccount.account_no}`
                      : 'Select a customer…'}
                </span>
                {loadingAccounts
                  ? <Loader2 size={16} className="animate-spin" style={{ color: primary }} />
                  : <ChevronDown size={16} style={{ color: subtext, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                }
              </button>

              {dropdownOpen && (
                <div
                  className="absolute z-10 w-full mt-1 rounded-xl overflow-hidden"
                  style={{
                    backgroundColor: surface,
                    border: `1.5px solid ${primary}50`,
                    boxShadow: `0 8px 32px rgba(0,0,0,0.3)`,
                    maxHeight: '280px',
                  }}
                >
                  {/* Search */}
                  <div style={{ padding: '8px', borderBottom: `1px solid ${border}` }}>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search by name or account no…"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full text-sm rounded-lg px-3 py-2 outline-none"
                      style={{ backgroundColor: inputBg, border: `1px solid ${border}`, color: text }}
                    />
                  </div>
                  {/* List */}
                  <div className="overflow-y-auto" style={{ maxHeight: '210px' }}>
                    {filteredAccounts.length === 0 ? (
                      <div className="px-4 py-3 text-sm" style={{ color: subtext }}>
                        No accounts found
                      </div>
                    ) : (
                      filteredAccounts.map(account => {
                        const accNo = account.accountNo || account.account_no || '';
                        const isSelected = accNo === selectedAccountNo;
                        return (
                          <button
                            key={accNo}
                            className="w-full text-left flex items-center justify-between px-4 py-3 text-sm transition-colors"
                            style={{
                              backgroundColor: isSelected ? `${primary}20` : 'transparent',
                              color: text,
                              borderLeft: isSelected ? `3px solid ${primary}` : '3px solid transparent',
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = `${border}60`; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
                            onClick={() => {
                              setSelectedAccountNo(accNo);
                              setDropdownOpen(false);
                              setSearchQuery('');
                            }}
                          >
                            <span className="font-medium truncate">{account.customerName}</span>
                            <span className="text-xs ml-2 shrink-0" style={{ color: subtext }}>{accNo}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedAccount && (
              <div className="mt-2 text-xs flex items-center gap-1" style={{ color: subtext }}>
                <span>Plan:</span>
                <span style={{ color: primary }}>{selectedAccount.plan || selectedAccount.desiredPlan || 'N/A'}</span>
                <span className="ml-3">Status:</span>
                <span style={{ color: '#10b981' }}>{selectedAccount.billingStatus || 'Active'}</span>
              </div>
            )}
          </div>

          {/* ── Service Charge ── */}
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-2" style={{ color: text }}>
              Service Charge <span className="font-normal text-xs" style={{ color: subtext }}>(optional · ₱)</span>
            </label>
            <div className="relative">
              <div
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: subtext }}
              >
                <DollarSign size={16} />
              </div>
              <input
                id="billing-service-charge"
                type="text"
                inputMode="decimal"
                value={serviceCharge}
                onChange={e => handleServiceChargeChange(e.target.value)}
                onFocus={() => { if (serviceCharge === '0.00') setServiceCharge(''); }}
                onBlur={handleServiceChargeBlur}
                disabled={isGenerating}
                className="w-full pl-9 pr-4 py-3 text-sm rounded-xl outline-none transition-all"
                style={{
                  backgroundColor: inputBg,
                  border: `1.5px solid ${parseFloat(serviceCharge) > 0 ? primary : border}`,
                  color: text,
                  boxShadow: parseFloat(serviceCharge) > 0 ? `0 0 0 3px ${primary}25` : 'none',
                }}
              />
            </div>
            <p className="text-xs mt-2" style={{ color: subtext }}>
              {parseFloat(serviceCharge) > 0
                ? `₱${parseFloat(serviceCharge).toFixed(2)} will be added as a service charge to this billing cycle.`
                : 'Leave at 0.00 to generate billing without an additional service charge.'}
            </p>
          </div>

          {/* ── Info box ── */}
          <div
            className="rounded-xl p-4 mb-6"
            style={{ backgroundColor: `${primary}10`, border: `1px solid ${primary}30` }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: primary }}>What will happen?</p>
            <ul className="text-xs space-y-1" style={{ color: subtext }}>
              <li>• A Statement of Account (SOA) will be generated</li>
              <li>• An Invoice will be generated for the selected account</li>
              <li>• PDFs will be saved to Google Drive automatically</li>
              <li>• Email &amp; SMS notifications will be sent immediately</li>
              {parseFloat(serviceCharge) > 0 && (
                <li style={{ color: primary }}>• ₱{parseFloat(serviceCharge).toFixed(2)} service charge will be applied to the SOA</li>
              )}
            </ul>
          </div>
        </div>

        {/* ── Footer / Progress / Generate button ── */}
        <div style={{ padding: '20px 24px', borderTop: `1px solid ${border}` }}>
          {isGenerating && (
            <div className="mb-4">
              {/* Progress bar */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium" style={{ color: subtext }}>Generating billing…</span>
                <span className="text-xs font-bold" style={{ color: primary }}>{Math.round(loadingPct)}%</span>
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ height: 6, backgroundColor: `${primary}20` }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${loadingPct}%`,
                    background: `linear-gradient(90deg, ${primary}, ${accent})`,
                  }}
                />
              </div>
              <p className="text-xs mt-2 text-center" style={{ color: subtext }}>
                {loadingPct < 30 ? 'Inserting service charge log…'
                  : loadingPct < 55 ? 'Generating Statement of Account…'
                  : loadingPct < 80 ? 'Generating Invoice…'
                  : loadingPct < 95 ? 'Sending notifications…'
                  : 'Finalizing…'}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              id="cancel-generate-billing"
              onClick={onClose}
              disabled={isGenerating}
              className="flex-1 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{
                backgroundColor: `${border}80`,
                color: text,
                border: `1px solid ${border}`,
                opacity: isGenerating ? 0.5 : 1,
                cursor: isGenerating ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={e => { if (!isGenerating) e.currentTarget.style.backgroundColor = border; }}
              onMouseLeave={e => { if (!isGenerating) e.currentTarget.style.backgroundColor = `${border}80`; }}
            >
              Cancel
            </button>

            <button
              id="confirm-generate-billing"
              onClick={handleGenerate}
              disabled={isGenerating || !selectedAccountNo}
              className="flex-1 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
              style={{
                background: isGenerating || !selectedAccountNo
                  ? `${primary}60`
                  : `linear-gradient(135deg, ${primary}, ${accent})`,
                color: '#ffffff',
                cursor: isGenerating || !selectedAccountNo ? 'not-allowed' : 'pointer',
                boxShadow: !isGenerating && selectedAccountNo ? `0 4px 16px ${primary}50` : 'none',
              }}
              onMouseEnter={e => {
                if (!isGenerating && selectedAccountNo) {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = `0 6px 20px ${primary}60`;
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = !isGenerating && selectedAccountNo ? `0 4px 16px ${primary}50` : 'none';
              }}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Zap size={16} />
                  Generate Billing
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);   opacity: 1; }
        }
      `}</style>
    </>
  );
};

export default GenerateBillingModal;

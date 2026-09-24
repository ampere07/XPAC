import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Upload, FileText, Trash2 } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import {
  MonthlyPayable,
  PaymentPayload,
  PayablePayment,
  STATUS_STYLES,
} from '../services/monthlyPayableService';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: PaymentPayload) => Promise<void>;
  onDeletePayment?: (payment: PayablePayment) => Promise<void>;
  payable: MonthlyPayable | null;
}

const today = () => new Date().toISOString().slice(0, 10);

const peso = (value: number) =>
  `₱${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const emptyForm = (): PaymentPayload => ({
  amount: '',
  payment_date: today(),
  payment_method: '',
  reference_no: '',
  notes: '',
  receipt: null,
});

const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDeletePayment,
  payable,
}) => {
  const [form, setForm] = useState<PaymentPayload>(emptyForm());
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') !== 'light');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    const applyTheme = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    paymentMethodService.getAll().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setMethods(res.data.filter((m) => m.is_active !== false));
      }
    });
  }, [isOpen]);

  // Pre-fill with the full remaining balance: settling in full is the common case, and a
  // partial payment is one keystroke away from there.
  useEffect(() => {
    if (!isOpen || !payable) return;

    setErrors({});
    setSubmitError(null);
    setForm({ ...emptyForm(), amount: payable.balance > 0 ? payable.balance : '' });
  }, [isOpen, payable]);

  const setField = useCallback(
    <K extends keyof PaymentPayload>(key: K, value: PaymentPayload[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => (prev[key as string] ? { ...prev, [key as string]: '' } : prev));
    },
    []
  );

  const validate = (): boolean => {
    if (!payable) return false;

    const next: Record<string, string> = {};
    const amount = Number(form.amount);

    if (form.amount === '' || form.amount === null) {
      next.amount = 'Amount is required';
    } else if (Number.isNaN(amount)) {
      next.amount = 'Amount must be a number';
    } else if (amount <= 0) {
      next.amount = 'Amount must be greater than zero';
    } else if (amount > payable.balance + 0.005) {
      // Mirrors the server's guard so the user sees it before the round trip.
      next.amount = `Only ${peso(payable.balance)} is still outstanding`;
    }

    if (!form.payment_date) next.payment_date = 'Payment date is required';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    setSubmitError(null);

    try {
      await onSave({ ...form, amount: Number(form.amount) });
      onClose();
    } catch (error: any) {
      const apiErrors = error?.response?.data?.errors;
      if (apiErrors && typeof apiErrors === 'object') {
        const mapped: Record<string, string> = {};
        Object.entries(apiErrors).forEach(([key, messages]) => {
          mapped[key] = Array.isArray(messages) ? String(messages[0]) : String(messages);
        });
        setErrors(mapped);
      }
      setSubmitError(
        error?.response?.data?.message || error?.message || 'Failed to record payment. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePayment = async (payment: PayablePayment) => {
    if (!onDeletePayment) return;
    if (!window.confirm(`Remove the ${peso(payment.amount)} payment logged on ${payment.paymentDate}?`)) {
      return;
    }

    setRemovingId(payment.id);
    setSubmitError(null);

    try {
      await onDeletePayment(payment);
    } catch (error: any) {
      setSubmitError(
        error?.response?.data?.message || error?.message || 'Failed to remove payment.'
      );
    } finally {
      setRemovingId(null);
    }
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  if (!isOpen || !payable) return null;

  const accent = colorPalette?.primary || '#7c3aed';
  const busy = saving || removingId !== null;

  const labelClass = `block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const inputClass = (field?: string) =>
    `w-full px-4 py-3 border rounded focus:outline-none disabled:cursor-not-allowed ${
      field && errors[field]
        ? 'border-red-500'
        : isDarkMode
        ? 'border-gray-700'
        : 'border-gray-300'
    } ${isDarkMode ? 'bg-gray-900 text-white disabled:bg-gray-800' : 'bg-white text-gray-900 disabled:bg-gray-100'}`;

  const stat = (label: string, value: string, tone?: string) => (
    <div>
      <div className={`text-[11px] font-semibold uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        {label}
      </div>
      <div className={`text-lg font-bold ${tone || (isDarkMode ? 'text-white' : 'text-gray-900')}`}>
        {value}
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div
          className={`h-full w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col ${
            isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}
        >
          {/* Header */}
          <div
            className={`px-6 py-4 flex items-center justify-between flex-shrink-0 ${
              isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
            }`}
          >
            <div className="flex items-center space-x-4">
              <button
                onClick={handleClose}
                disabled={busy}
                className={`transition-colors disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'text-gray-400 hover:text-white disabled:text-gray-600'
                    : 'text-gray-600 hover:text-gray-900 disabled:text-gray-400'
                }`}
              >
                <X size={24} />
              </button>
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Record Payment
              </h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={busy}
                className={`px-6 py-2 border rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'
                    : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                }`}
              >
                Close
              </button>
              <button
                onClick={handleSave}
                disabled={busy || payable.balance <= 0}
                className="px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
                style={{ backgroundColor: accent }}
                title={payable.balance <= 0 ? 'Nothing left to pay' : undefined}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Log Payment
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            {submitError && (
              <div className="p-4 rounded border border-red-500/40 bg-red-500/10 text-red-500 text-sm">
                {submitError}
              </div>
            )}

            {/* Payable header */}
            <div
              className={`rounded-xl border p-5 ${
                isDarkMode ? 'bg-gray-950 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <div className={`text-base font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {payable.title}
                  </div>
                  <div className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {payable.categoryName}
                    {payable.vendorName ? ` · ${payable.vendorName}` : ''}
                    {payable.accountNumber ? ` · ${payable.accountNumber}` : ''}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider flex-shrink-0 ${
                    STATUS_STYLES[payable.status]
                  }`}
                >
                  {payable.status}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {stat('Billing', payable.billingMonth)}
                {stat(
                  'Due Date',
                  payable.dueDate,
                  payable.isPastDue ? 'text-red-500' : undefined
                )}
                {stat('Amount Due', peso(payable.amountDue))}
                {stat(
                  'Balance',
                  peso(payable.balance),
                  payable.balance > 0 ? 'text-amber-500' : 'text-emerald-500'
                )}
              </div>
            </div>

            {payable.balance <= 0 && (
              <div className="p-4 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-sm">
                This payable is fully settled. Remove a logged payment below if you need to correct it.
              </div>
            )}

            {/* Payment form */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>
                  Amount (₱)<span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  disabled={busy || payable.balance <= 0}
                  className={inputClass('amount')}
                />
                {errors.amount ? (
                  <p className="text-red-500 text-xs mt-1">{errors.amount}</p>
                ) : (
                  payable.balance > 0 && (
                    <button
                      type="button"
                      onClick={() => setField('amount', payable.balance)}
                      className="text-xs mt-1 hover:underline"
                      style={{ color: accent }}
                    >
                      Pay full balance ({peso(payable.balance)})
                    </button>
                  )
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Payment Date<span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.payment_date}
                  onChange={(e) => setField('payment_date', e.target.value)}
                  disabled={busy || payable.balance <= 0}
                  className={inputClass('payment_date')}
                />
                {errors.payment_date && (
                  <p className="text-red-500 text-xs mt-1">{errors.payment_date}</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Payment Method</label>
                <select
                  value={form.payment_method}
                  onChange={(e) => setField('payment_method', e.target.value)}
                  disabled={busy || payable.balance <= 0}
                  className={inputClass('payment_method')}
                >
                  <option value="">— Select method —</option>
                  {methods.map((method) => (
                    <option key={method.id} value={method.payment_method}>
                      {method.payment_method}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass}>Reference No.</label>
                <input
                  type="text"
                  placeholder="OR number, transfer ref, cheque no."
                  value={form.reference_no}
                  onChange={(e) => setField('reference_no', e.target.value)}
                  disabled={busy || payable.balance <= 0}
                  className={inputClass('reference_no')}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  disabled={busy || payable.balance <= 0}
                  className={inputClass('notes')}
                />
              </div>
            </div>

            {/* Receipt */}
            <div>
              <label className={labelClass}>Receipt</label>
              <label
                className={`flex items-center gap-3 px-4 py-3 border border-dashed rounded cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-gray-700 hover:border-gray-600 bg-gray-900'
                    : 'border-gray-300 hover:border-gray-400 bg-white'
                } ${busy || payable.balance <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Upload size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {form.receipt ? form.receipt.name : 'Choose an image or PDF (max 10MB)'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={busy || payable.balance <= 0}
                  className="hidden"
                  onChange={(e) => setField('receipt', e.target.files?.[0] ?? null)}
                />
              </label>
              {errors.receipt && <p className="text-red-500 text-xs mt-1">{errors.receipt}</p>}
            </div>

            {/* Payment history — the ledger the balance is summed from. */}
            <div>
              <h3 className={`text-sm font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Payment History ({payable.payments.length})
              </h3>

              {payable.payments.length === 0 ? (
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  No payments logged yet.
                </p>
              ) : (
                <div
                  className={`rounded-lg border divide-y ${
                    isDarkMode ? 'border-gray-700 divide-gray-800' : 'border-gray-200 divide-gray-100'
                  }`}
                >
                  {payable.payments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <div className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {peso(payment.amount)}
                          <span className={`ml-2 font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                            {payment.paymentDate}
                          </span>
                        </div>
                        <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {[payment.paymentMethod, payment.referenceNo, payment.recordedBy]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {payment.receiptPath && (
                          <a
                            href={payment.receiptPath}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded"
                            style={{ color: accent }}
                            title="View receipt"
                          >
                            <FileText size={16} />
                          </a>
                        )}
                        {onDeletePayment && (
                          <button
                            onClick={() => handleRemovePayment(payment)}
                            disabled={busy}
                            className={`p-2 rounded transition-colors disabled:opacity-40 ${
                              isDarkMode
                                ? 'text-gray-400 hover:text-red-400'
                                : 'text-gray-600 hover:text-red-600'
                            }`}
                            title="Remove this payment"
                          >
                            {removingId === payment.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {saving && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60]">
          <div
            className={`rounded-lg p-12 flex flex-col items-center gap-6 ${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}
          >
            <Loader2 className="h-16 w-16 animate-spin" style={{ color: accent }} />
            <p className={`font-bold text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Recording payment…
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default RecordPaymentModal;

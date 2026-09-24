import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Upload, FileText, Repeat } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getExpensesCategories, ExpensesCategory } from '../services/expensesCategoryService';
import {
  MonthlyPayable,
  PayablePayload,
  currentBillingMonth,
} from '../services/monthlyPayableService';

interface MonthlyPayableFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: PayablePayload) => Promise<void>;
  /** Present when editing; omit to create. */
  payable?: MonthlyPayable | null;
  /** Billing month the page is currently showing — the sensible default for a new row. */
  defaultBillingMonth?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Last day of a 'YYYY-MM' period — the usual due date when none is chosen yet. */
const endOfBillingMonth = (billingMonth: string): string => {
  const [year, month] = billingMonth.split('-').map(Number);
  if (!year || !month) return today();
  return new Date(year, month, 0).toISOString().slice(0, 10);
};

const emptyForm = (billingMonth: string): PayablePayload => ({
  title: '',
  category_id: null,
  vendor_name: '',
  account_number: '',
  amount_due: '',
  due_date: endOfBillingMonth(billingMonth),
  billing_month: billingMonth,
  is_recurring: false,
  notes: '',
  receipt: null,
});

const MonthlyPayableFormModal: React.FC<MonthlyPayableFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  payable,
  defaultBillingMonth,
}) => {
  const isEditing = Boolean(payable);
  const fallbackMonth = defaultBillingMonth || currentBillingMonth();

  const [form, setForm] = useState<PayablePayload>(emptyForm(fallbackMonth));
  const [categories, setCategories] = useState<ExpensesCategory[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
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
    getExpensesCategories().then(setCategories);
  }, [isOpen]);

  // Reset on every open, so a cancelled edit never bleeds into the next one.
  useEffect(() => {
    if (!isOpen) return;

    setErrors({});
    setSubmitError(null);

    if (payable) {
      setForm({
        title: payable.title,
        category_id: payable.categoryId ?? null,
        vendor_name: payable.vendorName || '',
        account_number: payable.accountNumber || '',
        amount_due: payable.amountDue ?? '',
        due_date: payable.dueDateRaw || today(),
        billing_month: payable.billingMonth || fallbackMonth,
        is_recurring: payable.isRecurring,
        // Only pending and cancelled are settable; the rest follow the payments.
        status: payable.status === 'cancelled' ? 'cancelled' : undefined,
        notes: payable.notes || '',
        receipt: null,
      });
    } else {
      setForm(emptyForm(fallbackMonth));
    }
  }, [isOpen, payable, fallbackMonth]);

  const setField = useCallback(
    <K extends keyof PayablePayload>(key: K, value: PayablePayload[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => (prev[key as string] ? { ...prev, [key as string]: '' } : prev));
    },
    []
  );

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!form.title.trim()) next.title = 'Title is required';
    if (!form.category_id) next.category_id = 'Category is required';

    const amount = Number(form.amount_due);
    if (form.amount_due === '' || form.amount_due === null) {
      next.amount_due = 'Amount due is required';
    } else if (Number.isNaN(amount)) {
      next.amount_due = 'Amount must be a number';
    } else if (amount <= 0) {
      next.amount_due = 'Amount must be greater than zero';
    } else if (isEditing && payable && amount < payable.amountPaid) {
      // Not fatal server-side — it would just settle the row — but almost always a typo.
      next.amount_due = `Already paid ₱${payable.amountPaid.toLocaleString()}; lowering below that will mark it paid`;
    }

    if (!form.due_date) next.due_date = 'Due date is required';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.billing_month)) {
      next.billing_month = 'Billing month must be YYYY-MM';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    setSubmitError(null);

    try {
      await onSave({ ...form, amount_due: Number(form.amount_due) });
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
        error?.response?.data?.message || error?.message || 'Failed to save payable. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  if (!isOpen) return null;

  const accent = colorPalette?.primary || '#7c3aed';

  const labelClass = `block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const inputClass = (field?: string) =>
    `w-full px-4 py-3 border rounded focus:outline-none disabled:cursor-not-allowed ${
      field && errors[field]
        ? 'border-red-500'
        : isDarkMode
        ? 'border-gray-700'
        : 'border-gray-300'
    } ${isDarkMode ? 'bg-gray-900 text-white disabled:bg-gray-800' : 'bg-white text-gray-900 disabled:bg-gray-100'}`;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div
          className={`h-full w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col ${
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
                disabled={saving}
                className={`transition-colors disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'text-gray-400 hover:text-white disabled:text-gray-600'
                    : 'text-gray-600 hover:text-gray-900 disabled:text-gray-400'
                }`}
              >
                <X size={24} />
              </button>
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {isEditing ? 'Edit Payable' : 'New Monthly Payable'}
              </h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={saving}
                className={`px-6 py-2 border rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'
                    : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
                style={{ backgroundColor: accent }}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isEditing ? 'Update' : 'Save'}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className={labelClass}>
                  Title<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Office Rent — Main Branch"
                  value={form.title}
                  onChange={(e) => setField('title', e.target.value)}
                  disabled={saving}
                  className={inputClass('title')}
                />
                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
              </div>

              <div>
                <label className={labelClass}>
                  Category<span className="text-red-500">*</span>
                </label>
                <select
                  value={form.category_id ?? ''}
                  onChange={(e) =>
                    setField('category_id', e.target.value ? Number(e.target.value) : null)
                  }
                  disabled={saving}
                  className={inputClass('category_id')}
                >
                  <option value="">— Select category —</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {errors.category_id && (
                  <p className="text-red-500 text-xs mt-1">{errors.category_id}</p>
                )}
                {categories.length === 0 && (
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    No categories yet — add one under Expenses Category first.
                  </p>
                )}
              </div>

              <div>
                <label className={labelClass}>Vendor / Provider</label>
                <input
                  type="text"
                  placeholder="e.g. Converge ICT"
                  value={form.vendor_name}
                  onChange={(e) => setField('vendor_name', e.target.value)}
                  disabled={saving}
                  className={inputClass('vendor_name')}
                />
              </div>

              <div>
                <label className={labelClass}>Account Number</label>
                <input
                  type="text"
                  placeholder="Vendor's account / meter number"
                  value={form.account_number}
                  onChange={(e) => setField('account_number', e.target.value)}
                  disabled={saving}
                  className={inputClass('account_number')}
                />
              </div>

              <div>
                <label className={labelClass}>
                  Amount Due (₱)<span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={form.amount_due}
                  onChange={(e) => setField('amount_due', e.target.value)}
                  disabled={saving}
                  className={inputClass('amount_due')}
                />
                {errors.amount_due && (
                  <p className="text-red-500 text-xs mt-1">{errors.amount_due}</p>
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Billing Month<span className="text-red-500">*</span>
                </label>
                <input
                  type="month"
                  value={form.billing_month}
                  onChange={(e) => setField('billing_month', e.target.value)}
                  disabled={saving}
                  className={inputClass('billing_month')}
                />
                {errors.billing_month && (
                  <p className="text-red-500 text-xs mt-1">{errors.billing_month}</p>
                )}
              </div>

              <div>
                <label className={labelClass}>
                  Due Date<span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.due_date}
                  onChange={(e) => setField('due_date', e.target.value)}
                  disabled={saving}
                  className={inputClass('due_date')}
                />
                {errors.due_date && <p className="text-red-500 text-xs mt-1">{errors.due_date}</p>}
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  May fall outside the billing month — a June bill can be due in July.
                </p>
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Notes</label>
                <textarea
                  rows={3}
                  placeholder="Contract terms, meter readings, anything worth remembering next month."
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  disabled={saving}
                  className={inputClass('notes')}
                />
              </div>
            </div>

            {/* Recurring template flag */}
            <button
              type="button"
              disabled={saving}
              onClick={() => setField('is_recurring', !form.is_recurring)}
              className={`w-full p-4 rounded border text-left transition-all disabled:cursor-not-allowed ${
                form.is_recurring
                  ? 'border-transparent'
                  : isDarkMode
                  ? 'border-gray-700 hover:border-gray-600'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              style={
                form.is_recurring ? { backgroundColor: `${accent}1a`, borderColor: accent } : undefined
              }
            >
              <div className="flex items-center gap-2 mb-1">
                <Repeat size={16} style={{ color: form.is_recurring ? accent : undefined }} />
                <span
                  className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                  style={form.is_recurring ? { color: accent } : undefined}
                >
                  Recurring
                </span>
              </div>
              <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Carry this bill forward when generating the next billing month. Amounts reset to
                unpaid and the due date shifts by one month.
              </p>
            </button>

            {/* Cancelled toggle — only offered on edit, since a brand-new cancelled bill is
                not a thing anyone means to create. */}
            {isEditing && (
              <div
                className={`p-4 rounded border ${
                  isDarkMode ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-white'
                }`}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.status === 'cancelled'}
                    disabled={saving}
                    onChange={(e) => setField('status', e.target.checked ? 'cancelled' : 'pending')}
                    className="h-4 w-4"
                  />
                  <div>
                    <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      Cancelled
                    </span>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Drops this bill out of every total and blocks new payments. Unchecking hands
                      it back to the normal lifecycle.
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Receipt */}
            <div>
              <label className={labelClass}>Bill / Statement Attachment</label>
              <label
                className={`flex items-center gap-3 px-4 py-3 border border-dashed rounded cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-gray-700 hover:border-gray-600 bg-gray-900'
                    : 'border-gray-300 hover:border-gray-400 bg-white'
                } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Upload size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {form.receipt ? form.receipt.name : 'Choose an image or PDF (max 10MB)'}
                </span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={saving}
                  className="hidden"
                  onChange={(e) => setField('receipt', e.target.files?.[0] ?? null)}
                />
              </label>
              {errors.receipt && <p className="text-red-500 text-xs mt-1">{errors.receipt}</p>}
              {isEditing && payable?.receiptPath && !form.receipt && (
                <a
                  href={payable.receiptPath}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs mt-2 hover:underline"
                  style={{ color: accent }}
                >
                  <FileText size={14} /> View current attachment
                </a>
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
              Saving payable…
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default MonthlyPayableFormModal;

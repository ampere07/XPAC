import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Loader2,
  Upload,
  FileText,
  CalendarDays,
  CalendarRange,
  Building2,
  HardDrive,
} from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getExpensesCategories, ExpensesCategory } from '../services/expensesCategoryService';
import {
  Expense,
  ExpensePayload,
  ExpenseType,
  ExpenseFrequency,
  EXPENSE_TYPES,
  EXPENSE_FREQUENCIES,
} from '../services/expensesService';

interface ExpensesFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: ExpensePayload) => Promise<void>;
  /** Present when editing; omit to record a new expense. */
  expense?: Expense | null;
}

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (): ExpensePayload => ({
  date: today(),
  amount: '',
  // OPEX and Daily are the common case by a wide margin — most of an ISP's
  // ledger is day-to-day operating spend — so a one-off purchase is the entry
  // that costs an extra click, not the routine one.
  expense_type: 'OPEX',
  frequency: 'Daily',
  category_id: null,
  payee: '',
  description: '',
  invoice_no: '',
  reference_no: '',
  provider: '',
  supplier: '',
  location: '',
  barangay: '',
  city: '',
  received_date: '',
  receipt: null,
});

/**
 * One choice in a two-up selector.
 *
 * Extracted because the type and frequency rows are the same control twice over,
 * and duplicating forty lines of selected-state styling is how the two drift
 * apart the first time either is touched.
 */
const OptionCard: React.FC<{
  label: string;
  hint: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  selected: boolean;
  disabled: boolean;
  accent: string;
  isDarkMode: boolean;
  onSelect: () => void;
}> = ({ label, hint, icon: Icon, selected, disabled, accent, isDarkMode, onSelect }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onSelect}
    aria-pressed={selected}
    className={`p-4 rounded border text-left transition-all disabled:cursor-not-allowed ${
      selected
        ? 'border-transparent'
        : isDarkMode
        ? 'border-gray-700 hover:border-gray-600'
        : 'border-gray-300 hover:border-gray-400'
    }`}
    style={selected ? { backgroundColor: `${accent}1a`, borderColor: accent } : undefined}
  >
    <div className="flex items-center gap-2 mb-1">
      <Icon size={16} style={{ color: selected ? accent : undefined }} />
      <span
        className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
        style={selected ? { color: accent } : undefined}
      >
        {label}
      </span>
    </div>
    <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{hint}</p>
  </button>
);

const ExpensesFormModal: React.FC<ExpensesFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  expense,
}) => {
  const isEditing = Boolean(expense);

  const [form, setForm] = useState<ExpensePayload>(emptyForm());
  const [categories, setCategories] = useState<ExpensesCategory[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const modifiedBy = (() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.email || authData.user?.email || authData.email_address || '';
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
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

  // Reset whenever the modal opens, so a cancelled edit never bleeds into the next open.
  useEffect(() => {
    if (!isOpen) return;

    setErrors({});
    setSubmitError(null);

    if (expense) {
      setForm({
        date: expense.dateRaw || today(),
        amount: expense.amount ?? '',
        expense_type: expense.expenseType || 'OPEX',
        frequency: expense.frequency || 'Daily',
        category_id: expense.categoryId ?? null,
        payee: expense.payee || '',
        description: expense.description || '',
        invoice_no: expense.invoiceNo || '',
        reference_no: expense.referenceNo || '',
        provider: expense.provider || '',
        supplier: expense.supplier || '',
        location: expense.location || '',
        barangay: expense.barangay || '',
        city: expense.city === 'All' ? '' : expense.city || '',
        received_date: expense.receivedDateRaw || '',
        receipt: null,
      });
    } else {
      setForm(emptyForm());
    }
  }, [isOpen, expense]);

  const setField = useCallback(<K extends keyof ExpensePayload>(key: K, value: ExpensePayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key as string] ? { ...prev, [key as string]: '' } : prev));
  }, []);

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (!form.date) next.date = 'Date is required';

    const amount = Number(form.amount);
    if (form.amount === '' || form.amount === null) {
      next.amount = 'Amount is required';
    } else if (Number.isNaN(amount)) {
      next.amount = 'Amount must be a number';
    } else if (amount < 0) {
      next.amount = 'Amount cannot be negative';
    }

    if (!form.expense_type) next.expense_type = 'Select OPEX or CAPEX';
    if (!form.frequency) next.frequency = 'Select daily or monthly';
    if (!form.category_id) next.category_id = 'Category is required';

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
        error?.response?.data?.message || error?.message || 'Failed to save expense. Please try again.'
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
                {isEditing ? 'Edit Expense' : 'Expenses Form'}
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

            {/* Expense type (OPEX/CAPEX) and frequency (Daily/Monthly).
                Two separate choices, because they are two independent facts: a
                leased vehicle is Monthly OPEX and a fibre reel is Daily CAPEX.
                Presenting them as one control would force a false choice — which
                is exactly what the single field used to do. */}
            <div>
              <label className={labelClass}>
                Expense Type<span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {EXPENSE_TYPES.map((type) => (
                  <OptionCard
                    key={type.value}
                    label={type.label}
                    hint={type.hint}
                    icon={type.value === 'OPEX' ? Building2 : HardDrive}
                    selected={form.expense_type === type.value}
                    disabled={saving}
                    accent={accent}
                    isDarkMode={isDarkMode}
                    onSelect={() => setField('expense_type', type.value as ExpenseType)}
                  />
                ))}
              </div>
              {errors.expense_type && (
                <p className="text-red-500 text-xs mt-1">{errors.expense_type}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>
                Frequency<span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {EXPENSE_FREQUENCIES.map((frequency) => (
                  <OptionCard
                    key={frequency.value}
                    label={frequency.label}
                    hint={frequency.hint}
                    icon={frequency.value === 'Daily' ? CalendarDays : CalendarRange}
                    selected={form.frequency === frequency.value}
                    disabled={saving}
                    accent={accent}
                    isDarkMode={isDarkMode}
                    onSelect={() => setField('frequency', frequency.value as ExpenseFrequency)}
                  />
                ))}
              </div>
              {errors.frequency && <p className="text-red-500 text-xs mt-1">{errors.frequency}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className={labelClass}>
                  Date<span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  disabled={saving}
                  className={inputClass('date')}
                />
                {errors.date && <p className="text-red-500 text-xs mt-1">{errors.date}</p>}
              </div>

              <div>
                <label className={labelClass}>
                  Amount (₱)<span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  disabled={saving}
                  className={inputClass('amount')}
                />
                {errors.amount && <p className="text-red-500 text-xs mt-1">{errors.amount}</p>}
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
                <label className={labelClass}>Payee</label>
                <input
                  type="text"
                  value={form.payee}
                  onChange={(e) => setField('payee', e.target.value)}
                  disabled={saving}
                  className={inputClass('payee')}
                />
              </div>

              <div className="md:col-span-2">
                <label className={labelClass}>Description</label>
                <textarea
                  rows={3}
                  placeholder="What exactly was this for?"
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  disabled={saving}
                  className={inputClass('description')}
                />
              </div>

              <div>
                <label className={labelClass}>Invoice No.</label>
                <input
                  type="text"
                  value={form.invoice_no}
                  onChange={(e) => setField('invoice_no', e.target.value)}
                  disabled={saving}
                  className={inputClass('invoice_no')}
                />
              </div>

              <div>
                <label className={labelClass}>Reference No.</label>
                <input
                  type="text"
                  value={form.reference_no}
                  onChange={(e) => setField('reference_no', e.target.value)}
                  disabled={saving}
                  className={inputClass('reference_no')}
                />
              </div>

              <div>
                <label className={labelClass}>Provider</label>
                <input
                  type="text"
                  value={form.provider}
                  onChange={(e) => setField('provider', e.target.value)}
                  disabled={saving}
                  className={inputClass('provider')}
                />
              </div>

              <div>
                <label className={labelClass}>Supplier</label>
                <input
                  type="text"
                  value={form.supplier}
                  onChange={(e) => setField('supplier', e.target.value)}
                  disabled={saving}
                  className={inputClass('supplier')}
                />
              </div>

              <div>
                <label className={labelClass}>Received Date</label>
                <input
                  type="date"
                  value={form.received_date}
                  onChange={(e) => setField('received_date', e.target.value)}
                  disabled={saving}
                  className={inputClass('received_date')}
                />
              </div>

              <div>
                <label className={labelClass}>City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setField('city', e.target.value)}
                  disabled={saving}
                  className={inputClass('city')}
                />
              </div>

              <div>
                <label className={labelClass}>Barangay</label>
                <input
                  type="text"
                  value={form.barangay}
                  onChange={(e) => setField('barangay', e.target.value)}
                  disabled={saving}
                  className={inputClass('barangay')}
                />
              </div>

              <div>
                <label className={labelClass}>Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setField('location', e.target.value)}
                  disabled={saving}
                  className={inputClass('location')}
                />
              </div>
            </div>

            {/* Receipt */}
            <div>
              <label className={labelClass}>Receipt / Photo Proof</label>
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
              {isEditing && expense?.photo && !form.receipt && (
                <a
                  href={expense.photo}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs mt-2 hover:underline"
                  style={{ color: accent }}
                >
                  <FileText size={14} /> View current receipt
                </a>
              )}
            </div>

            <div>
              <label className={labelClass}>Modified By</label>
              <div
                className={`inline-block px-4 py-2 border rounded-full text-sm ${
                  isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}
              >
                {modifiedBy || 'System'}
              </div>
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
              Saving expense…
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default ExpensesFormModal;

import React, { useState } from 'react';
import { Filter, X } from 'lucide-react';
import type { User } from '../types/api';
import { getUserDisplayName } from '../utils/userDisplay';
import { isTechnicianUser } from '../utils/technicianQueue';

/**
 * Technician filter for the Job Order and Service Order sidebars: one technician (matched on the
 * record's assigned email) and an optional date range, picked in a modal. Modelled on
 * TransactionList's Collector Filter so the pages read the same.
 */

export interface TechnicianOption {
  /** Lowercased — compared against the record's assigned email. */
  email: string;
  label: string;
}

export interface TechnicianFilterValue {
  technician: TechnicianOption;
  /** "YYYY-MM-DD"; '' = no bound. */
  dateFrom: string;
  dateTo: string;
}

/**
 * Technicians assigned on at least one of the given records, A–Z by name. Other roles are left
 * out even when one was assigned, and so is anyone not on these records — the records are
 * already scoped to the viewer's organisation, so this never offers another org's technicians.
 */
export const buildTechnicianOptions = (users: User[], assignedEmails: Iterable<string>): TechnicianOption[] => {
  const assigned = new Set<string>();
  for (const raw of Array.from(assignedEmails)) {
    const email = String(raw || '').trim().toLowerCase();
    if (email) assigned.add(email);
  }

  const options = new Map<string, TechnicianOption>();
  users.forEach(user => {
    if (!isTechnicianUser(user.role?.role_name, user.role_id)) return;
    const email = (user.email_address || '').trim().toLowerCase();
    if (!email || !assigned.has(email) || options.has(email)) return;
    options.set(email, { email, label: getUserDisplayName(user, email) });
  });
  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * Does a record pass the filter? The timestamp is read by its date part as written
 * ("YYYY-MM-DD HH:MM:SS", Manila time), so a timezone can never move it into the next day, and
 * those strings compare in date order.
 */
export const matchesTechnicianFilter = (
  filter: TechnicianFilterValue | null,
  assignedEmail?: string | null,
  timestamp?: string | null
): boolean => {
  if (!filter) return true;
  if (String(assignedEmail || '').trim().toLowerCase() !== filter.technician.email) return false;

  if (filter.dateFrom || filter.dateTo) {
    const day = String(timestamp || '').slice(0, 10);
    if (!day) return false;
    if (filter.dateFrom && day < filter.dateFrom) return false;
    if (filter.dateTo && day > filter.dateTo) return false;
  }
  return true;
};

const formatDay = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const describeRange = ({ dateFrom, dateTo }: TechnicianFilterValue): string => {
  if (dateFrom && dateTo) return dateFrom === dateTo ? formatDay(dateFrom) : `${formatDay(dateFrom)} – ${formatDay(dateTo)}`;
  if (dateFrom) return `From ${formatDay(dateFrom)}`;
  if (dateTo) return `Until ${formatDay(dateTo)}`;
  return 'All dates';
};

interface SidebarProps {
  value: TechnicianFilterValue | null;
  /** How many records the page shows with the filter on. */
  count: number;
  /** Plural noun for the count, e.g. "Job Orders". */
  recordLabel: string;
  onOpen: () => void;
  onClear: () => void;
  isDarkMode: boolean;
  primaryColor: string;
}

/** The sidebar button, plus a summary of the applied filter once there is one. */
export const TechnicianFilterSidebar: React.FC<SidebarProps> = ({
  value, count, recordLabel, onOpen, onClear, isDarkMode, primaryColor
}) => (
  <div className={`px-4 py-3 border-b space-y-2 ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs font-medium border transition-colors ${value
        ? 'text-white'
        : isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
        }`}
      style={value ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}
    >
      <span className="flex items-center gap-2"><Filter size={14} /> Technician Filter</span>
      {value && <span className="text-[10px] uppercase tracking-wider">On</span>}
    </button>

    {value && (
      <div className={`rounded border p-3 text-xs space-y-1 ${isDarkMode ? 'border-gray-700 bg-gray-800 text-gray-300' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
        <div className="flex items-start justify-between gap-2">
          <span className={`font-medium break-all ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value.technician.label}</span>
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] font-bold uppercase tracking-wider hover:underline flex-shrink-0"
            style={{ color: primaryColor }}
          >
            Clear
          </button>
        </div>
        {value.technician.label !== value.technician.email && (
          <div className="break-all">{value.technician.email}</div>
        )}
        <div>{describeRange(value)}</div>
        <div className="pt-1">
          <span>Total {recordLabel}</span>
          <div className="text-base font-bold" style={{ color: primaryColor }}>{count}</div>
        </div>
      </div>
    )}
  </div>
);

interface ModalProps {
  /** The filter in force, which the modal opens on. */
  initial: TechnicianFilterValue | null;
  technicians: TechnicianOption[];
  isLoading: boolean;
  /** What the dates are compared against, shown under the date fields. */
  dateHint: string;
  onApply: (value: TechnicianFilterValue) => void;
  onClose: () => void;
  isDarkMode: boolean;
  primaryColor: string;
}

/** Mount only while open: the draft starts from `initial` each time it opens. */
export const TechnicianFilterModal: React.FC<ModalProps> = ({
  initial, technicians, isLoading, dateHint, onApply, onClose, isDarkMode, primaryColor
}) => {
  const [draftTechnician, setDraftTechnician] = useState<TechnicianOption | null>(initial?.technician ?? null);
  const [draftDateFrom, setDraftDateFrom] = useState(initial?.dateFrom ?? '');
  const [draftDateTo, setDraftDateTo] = useState(initial?.dateTo ?? '');
  const [query, setQuery] = useState('');
  const [isListOpen, setIsListOpen] = useState(false);

  const isRangeInvalid = !!draftDateFrom && !!draftDateTo && draftDateFrom > draftDateTo;
  const inputClass = `w-full px-3 py-2 rounded border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`;
  const labelClass = `block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;
  const mutedClass = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  const q = query.trim().toLowerCase();
  const shown = technicians.filter(t => !q || t.label.toLowerCase().includes(q) || t.email.includes(q));

  return (
    <div className="fixed inset-0 z-[10040] flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div
        className={`w-full max-w-md rounded-lg shadow-xl ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <h3 className="text-lg font-semibold">Technician Filter</h3>
          <button aria-label="Close" type="button" onClick={onClose} className={isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'}>
            <X size={20} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Assigned Tech — technicians only */}
          <div className="relative">
            <label className={labelClass}>
              Assigned Tech<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={isListOpen ? query : (draftTechnician?.label ?? query)}
              onChange={(e) => { setQuery(e.target.value); setIsListOpen(true); }}
              onFocus={() => { setQuery(''); setIsListOpen(true); }}
              placeholder={isLoading ? 'Loading…' : 'Search technician…'}
              className={inputClass}
            />
            {isListOpen && (
              <div className={`absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded border shadow-lg ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                {isLoading ? (
                  <p className={`px-3 py-2 text-sm ${mutedClass}`}>Loading…</p>
                ) : shown.length === 0 ? (
                  <p className={`px-3 py-2 text-sm ${mutedClass}`}>No technicians found</p>
                ) : shown.map(t => (
                  <button
                    aria-label={`Select technician ${t.label}`}
                    key={t.email}
                    type="button"
                    onClick={() => { setDraftTechnician(t); setIsListOpen(false); setQuery(''); }}
                    className={`w-full flex flex-col px-3 py-2 text-left text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${draftTechnician?.email === t.email ? (isDarkMode ? 'bg-gray-700' : 'bg-gray-100') : ''}`}
                  >
                    <span className="break-all">{t.label}</span>
                    {t.label !== t.email && <span className={`text-xs break-all ${mutedClass}`}>{t.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date range (optional) */}
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Date From</label>
                <input
                  aria-label="Date From"
                  type="date"
                  value={draftDateFrom}
                  max={draftDateTo || undefined}
                  onChange={(e) => setDraftDateFrom(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Date To</label>
                <input
                  aria-label="Date To"
                  type="date"
                  value={draftDateTo}
                  min={draftDateFrom || undefined}
                  onChange={(e) => setDraftDateTo(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{dateHint} Leave empty for all dates.</p>
            {isRangeInvalid && (
              <p className="text-xs mt-1 text-red-500">Date From must be on or before Date To.</p>
            )}
          </div>
        </div>

        <div className={`flex justify-end gap-2 px-5 py-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 rounded text-sm ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!draftTechnician || isRangeInvalid}
            onClick={() => {
              if (!draftTechnician) return;
              onApply({ technician: draftTechnician, dateFrom: draftDateFrom, dateTo: draftDateTo });
            }}
            className="px-4 py-2 rounded text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: primaryColor }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

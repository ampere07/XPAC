import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, Layers, Palette, Plus, RotateCcw, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import type { GroupableColumn, ViewOptions } from '../../services/viewOptionsService';
import { BLANK_GROUP_LABEL } from '../../services/viewOptionsService';
import type { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * "View Options" — the operator's control over how a list is grouped, sorted and
 * coloured, in the AppSheet idiom.
 *
 * Three tabs because they are three separate decisions and mixing them into one long
 * form is how the AppSheet original became hard to use: Group By builds a hierarchy,
 * Sort By orders what is inside it, and Colors decides what each distinct value looks
 * like. Edits are held locally until Save, so Cancel is a real cancel.
 */

const SWATCHES = [
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6',
  '#0ea5e9', '#06b6d4', '#14b8a6', '#64748b', '#94a3b8', '#6b7280',
];

type Tab = 'group' | 'sort' | 'color';

const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'group', label: 'Group By', icon: Layers },
  { id: 'sort', label: 'Sort By', icon: SlidersHorizontal },
  { id: 'color', label: 'Colors', icon: Palette },
];

interface ViewOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  /** Module title, so an operator with several screens open knows which they are editing. */
  title: string;
  columns: GroupableColumn[];
  options: ViewOptions;
  /** Distinct values present in the rows on screen, for the colour editor. */
  distinctValues: (columnKey: string) => string[];
  /** The colour a value currently resolves to, chosen or auto-assigned. */
  colorFor: (column: string, value: string) => string;
  onSave: (next: ViewOptions) => Promise<boolean>;
  onReset: () => Promise<void>;
}

const ViewOptionsModal: React.FC<ViewOptionsModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  colorPalette,
  title,
  columns,
  options,
  distinctValues,
  colorFor,
  onSave,
  onReset,
}) => {
  const [tab, setTab] = useState<Tab>('group');
  const [draft, setDraft] = useState<ViewOptions>(options);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [colorColumn, setColorColumn] = useState<string>(columns[0]?.key ?? '');
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const accent = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    if (!isOpen) return;
    setDraft(options);
    setError(null);
    setPickerFor(null);
    setColorColumn((current) => (columns.some((c) => c.key === current) ? current : columns[0]?.key ?? ''));
  }, [isOpen, options, columns]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const labelOf = useMemo(() => {
    const map = new Map(columns.map((column) => [column.key, column.label]));
    return (key: string) => map.get(key) ?? key;
  }, [columns]);

  const ungroupedColumns = columns.filter((column) => !draft.groupBy.includes(column.key));
  const unsortedColumns = columns.filter((column) => !draft.sortBy.some((rule) => rule.column === column.key));

  // ---- Group by ----------------------------------------------------------

  const addLevel = (key: string) => {
    if (!key) return;
    setDraft((prev) => ({ ...prev, groupBy: [...prev.groupBy, key] }));
  };

  const moveLevel = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.groupBy.length) return prev;
      const next = prev.groupBy.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, groupBy: next };
    });
  };

  const removeLevel = (key: string) => {
    setDraft((prev) => ({ ...prev, groupBy: prev.groupBy.filter((entry) => entry !== key) }));
  };

  // ---- Sort by -----------------------------------------------------------

  const addSort = (key: string) => {
    if (!key) return;
    setDraft((prev) => ({ ...prev, sortBy: [...prev.sortBy, { column: key, direction: 'asc' }] }));
  };

  const toggleDirection = (key: string) => {
    setDraft((prev) => ({
      ...prev,
      sortBy: prev.sortBy.map((rule) =>
        rule.column === key ? { ...rule, direction: rule.direction === 'asc' ? 'desc' : 'asc' } : rule
      ),
    }));
  };

  const moveSort = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.sortBy.length) return prev;
      const next = prev.sortBy.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...prev, sortBy: next };
    });
  };

  const removeSort = (key: string) => {
    setDraft((prev) => ({ ...prev, sortBy: prev.sortBy.filter((rule) => rule.column !== key) }));
  };

  // ---- Colors ------------------------------------------------------------

  const recolor = (value: string, color: string) => {
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, [colorColumn]: { ...(prev.colors[colorColumn] ?? {}), [value]: color } },
    }));
  };

  const clearColor = (value: string) => {
    setDraft((prev) => {
      const perColumn = { ...(prev.colors[colorColumn] ?? {}) };
      delete perColumn[value];
      const colors = { ...prev.colors };
      if (Object.keys(perColumn).length === 0) delete colors[colorColumn];
      else colors[colorColumn] = perColumn;
      return { ...prev, colors };
    });
  };

  /** The colour shown in the editor: this draft's choice, else the resolved default. */
  const draftColor = (value: string): string => draft.colors[colorColumn]?.[value] ?? colorFor(colorColumn, value);

  // ---- Save / reset ------------------------------------------------------

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const ok = await onSave(draft);
    setSaving(false);
    if (!ok) {
      setError('Saved on this device only — the server did not accept the change.');
      return;
    }
    onClose();
  };

  const handleReset = async () => {
    setSaving(true);
    await onReset();
    setSaving(false);
    onClose();
  };

  if (!isOpen) return null;

  const surface = isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200';
  const text = isDarkMode ? 'text-white' : 'text-gray-900';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const rowHover = isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50';
  const divider = isDarkMode ? 'border-gray-800' : 'border-gray-200';
  const input = isDarkMode
    ? 'bg-gray-950 border-gray-800 text-gray-100'
    : 'bg-white border-gray-300 text-gray-900';

  const values = colorColumn ? distinctValues(colorColumn) : [];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className={`relative w-full max-w-lg rounded-xl border shadow-2xl flex flex-col max-h-[85vh] ${surface}`}>
        <div className={`flex items-start justify-between gap-3 p-4 border-b ${divider}`}>
          <div>
            <h3 className={`text-base font-semibold flex items-center gap-2 ${text}`}>
              <SlidersHorizontal className="h-4 w-4" style={{ color: accent }} />
              View Options
            </h3>
            <p className={`text-xs mt-0.5 ${muted}`}>{title} — this layout is yours alone.</p>
          </div>
          <button onClick={onClose} className={`p-1 rounded ${muted} hover:opacity-70`} title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filled pills, matching the tab strips on the tools and in the sidebar.
            An underlined tab was the only one of its kind in the app, and pairing a
            top radius with a bottom accent border put the rounding and the emphasis at
            opposite edges of the same control. */}
        <div className={`flex items-center gap-1 p-3 border-b ${divider}`}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                tab === id ? 'text-white' : `${muted} ${rowHover}`
              }`}
              style={tab === id ? { backgroundColor: accent } : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'group' && (
            <div className="space-y-2">
              <p className={`text-xs ${muted}`}>
                Levels apply outermost first. Level 1 becomes the top of the sidebar tree, level 2 nests inside it,
                and so on.
              </p>

              {draft.groupBy.length === 0 && (
                <div className={`text-xs italic py-4 text-center ${muted}`}>
                  No grouping — the sidebar shows its default slices.
                </div>
              )}

              {draft.groupBy.map((key, index) => (
                <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${surface} ${rowHover}`}>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 text-white"
                    style={{ backgroundColor: accent }}
                  >
                    L{index + 1}
                  </span>
                  <span className={`flex-1 text-sm truncate ${text}`}>{labelOf(key)}</span>
                  <button
                    onClick={() => moveLevel(index, -1)}
                    disabled={index === 0}
                    title="Move up a level"
                    className={`p-1 rounded ${muted} disabled:opacity-20`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveLevel(index, 1)}
                    disabled={index === draft.groupBy.length - 1}
                    title="Move down a level"
                    className={`p-1 rounded ${muted} disabled:opacity-20`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeLevel(key)}
                    title="Remove this level"
                    className="p-1 rounded text-red-500 hover:opacity-70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {ungroupedColumns.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <Plus className={`h-3.5 w-3.5 shrink-0 ${muted}`} />
                  <select
                    value=""
                    onChange={(event) => addLevel(event.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm ${input}`}
                  >
                    <option value="">Add a group level…</option>
                    {ungroupedColumns.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {tab === 'sort' && (
            <div className="space-y-2">
              <p className={`text-xs ${muted}`}>
                Rules apply in order: the first is the primary sort, the rest break ties. Clicking a column header in
                the table still overrides this for the session.
              </p>

              {draft.sortBy.length === 0 && (
                <div className={`text-xs italic py-4 text-center ${muted}`}>
                  No sort configured — the table keeps its own default order.
                </div>
              )}

              {draft.sortBy.map((rule, index) => (
                <div
                  key={rule.column}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${surface} ${rowHover}`}
                >
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${muted}`}>{index + 1}</span>
                  <span className={`flex-1 text-sm truncate ${text}`}>{labelOf(rule.column)}</span>
                  <button
                    onClick={() => toggleDirection(rule.column)}
                    title={rule.direction === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                    className="px-2 py-1 rounded border text-[11px] font-medium flex items-center gap-1"
                    style={{ borderColor: `${accent}66`, color: accent }}
                  >
                    {rule.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {rule.direction === 'asc' ? 'Asc' : 'Desc'}
                  </button>
                  <button
                    onClick={() => moveSort(index, -1)}
                    disabled={index === 0}
                    title="Higher priority"
                    className={`p-1 rounded ${muted} disabled:opacity-20`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => moveSort(index, 1)}
                    disabled={index === draft.sortBy.length - 1}
                    title="Lower priority"
                    className={`p-1 rounded ${muted} disabled:opacity-20`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeSort(rule.column)}
                    title="Remove this rule"
                    className="p-1 rounded text-red-500 hover:opacity-70"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}

              {unsortedColumns.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <Plus className={`h-3.5 w-3.5 shrink-0 ${muted}`} />
                  <select
                    value=""
                    onChange={(event) => addSort(event.target.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm ${input}`}
                  >
                    <option value="">Add a sort rule…</option>
                    {unsortedColumns.map((column) => (
                      <option key={column.key} value={column.key}>
                        {column.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {tab === 'color' && (
            <div className="space-y-2">
              <select
                value={colorColumn}
                onChange={(event) => {
                  setColorColumn(event.target.value);
                  setPickerFor(null);
                }}
                aria-label="Column to colour"
                className={`w-full px-3 py-2 rounded-lg border text-sm ${input}`}
              >
                {columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}
                  </option>
                ))}
              </select>

              <p className={`text-xs ${muted}`}>
                Values are read from the rows currently loaded. A value with no colour of its own gets a stable one
                derived from its name, so it does not change between sessions.
              </p>

              {values.length === 0 && (
                <div className={`text-xs italic py-4 text-center ${muted}`}>
                  No values to colour — this column is empty in the rows on screen.
                </div>
              )}

              {values.map((value) => (
                <div key={value} className={`relative flex items-center gap-3 px-3 py-2 rounded-lg ${rowHover}`}>
                  <button
                    onClick={() => setPickerFor((current) => (current === value ? null : value))}
                    title="Change this colour"
                    className="h-5 w-5 rounded-full shrink-0 border border-black/20 shadow-inner"
                    style={{ backgroundColor: draftColor(value) }}
                  />
                  <span
                    className={`flex-1 text-sm truncate ${value === BLANK_GROUP_LABEL ? muted : text}`}
                    title={value}
                  >
                    {value}
                  </span>
                  {draft.colors[colorColumn]?.[value] && (
                    <button onClick={() => clearColor(value)} className={`text-[11px] ${muted} hover:underline`}>
                      Reset
                    </button>
                  )}

                  {pickerFor === value && (
                    <div className={`absolute left-3 right-3 top-full z-10 rounded-lg border p-3 shadow-xl ${surface}`}>
                      <div className="flex flex-wrap gap-1.5">
                        {SWATCHES.map((swatch) => (
                          <button
                            key={swatch}
                            onClick={() => {
                              recolor(value, swatch);
                              setPickerFor(null);
                            }}
                            title={swatch}
                            className="h-6 w-6 rounded-full border border-black/20 transition-transform hover:scale-110"
                            style={{ backgroundColor: swatch }}
                          />
                        ))}
                      </div>
                      <div className={`mt-3 pt-3 border-t flex items-center gap-2 ${divider}`}>
                        <input
                          type="color"
                          value={draftColor(value)}
                          onChange={(event) => recolor(value, event.target.value)}
                          className="h-7 w-10 rounded cursor-pointer bg-transparent"
                          title="Pick any colour"
                        />
                        <div className="flex-1" />
                        <button onClick={() => setPickerFor(null)} className={`text-xs ${muted} hover:underline`}>
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-amber-500 bg-amber-500/10 border-t border-amber-500/30">{error}</div>
        )}

        <div className={`p-3 border-t flex items-center gap-2 ${divider}`}>
          <button
            onClick={handleReset}
            disabled={saving}
            title="Forget this configuration and go back to the defaults"
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${muted} ${rowHover}`}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset all
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={saving}
            className={`px-4 py-2 rounded-lg border text-sm disabled:opacity-50 ${surface} ${text}`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: accent }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ViewOptionsModal;

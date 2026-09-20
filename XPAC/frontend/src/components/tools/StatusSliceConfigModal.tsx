import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Palette, RotateCcw, X } from 'lucide-react';
import type { SliceDefinition, StatusSlice } from '../../services/statusSliceService';
import type { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * "Configure Slices & Colors" — the per-user status-slice editor.
 *
 * Opened from the foot of the status sidebar on every reconciliation tool. Three
 * decisions and nothing else: which slices appear, in what order, and what color each
 * dot is. It never touches what a slice *means* — the states behind it are the
 * server's vocabulary and are not the operator's to redefine.
 *
 * Edits are held locally until Save, so an operator who reorders four slices and then
 * changes their mind closes the dialog and loses only their own edits. Cancel is a
 * real cancel.
 */

/**
 * The swatches offered before the full picker.
 *
 * Chosen to stay legible as a 10px dot in both themes and to be distinguishable from
 * each other at that size — which rules out the neighbouring shades a continuous
 * picker would happily offer. The native color input is still there underneath for an
 * operator who wants something specific.
 */
const SWATCHES = [
  '#10b981', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316',
  '#ef4444', '#ec4899', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6',
  '#0ea5e9', '#06b6d4', '#14b8a6', '#64748b', '#94a3b8', '#6b7280',
];

interface StatusSliceConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  /** Module title, so an operator with several tools open knows which they are editing. */
  title: string;
  slices: StatusSlice[];
  definitions: SliceDefinition[];
  /** Resolves false when neither the server nor localStorage accepted the write. */
  onSave: (next: StatusSlice[]) => Promise<boolean>;
  onReset: () => Promise<void>;
}

const StatusSliceConfigModal: React.FC<StatusSliceConfigModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  colorPalette,
  title,
  slices,
  definitions,
  onSave,
  onReset,
}) => {
  const [draft, setDraft] = useState<StatusSlice[]>(slices);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const accent = colorPalette?.primary || '#7c3aed';

  // Re-seed from the live configuration each time the dialog opens, so a previously
  // cancelled edit is never presented as the current state.
  useEffect(() => {
    if (isOpen) {
      setDraft(slices);
      setError(null);
      setPickerFor(null);
    }
  }, [isOpen, slices]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const defaultColors = useMemo(
    () => new Map(definitions.map((definition) => [definition.id, definition.color])),
    [definitions]
  );

  const visibleCount = draft.filter((slice) => !slice.hidden).length;

  const move = (index: number, delta: -1 | 1) => {
    setDraft((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const toggle = (id: string) => {
    setDraft((prev) =>
      prev.map((slice) => (slice.id === id && !slice.locked ? { ...slice, hidden: !slice.hidden } : slice))
    );
  };

  const recolor = (id: string, color: string) => {
    setDraft((prev) => prev.map((slice) => (slice.id === id ? { ...slice, color } : slice)));
  };

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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className={`relative w-full max-w-lg rounded-xl border shadow-2xl flex flex-col max-h-[85vh] ${surface}`}>
        <div className={`flex items-start justify-between gap-3 p-4 border-b ${divider}`}>
          <div>
            <h3 className={`text-base font-semibold flex items-center gap-2 ${text}`}>
              <Palette className="h-4 w-4" style={{ color: accent }} />
              Configure Slices &amp; Colors
            </h3>
            <p className={`text-xs mt-0.5 ${muted}`}>
              {title} — {visibleCount} of {draft.length} shown. This layout is yours alone.
            </p>
          </div>
          <button onClick={onClose} className={`p-1 rounded ${muted} hover:opacity-70`} title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {draft.map((slice, index) => (
            <div key={slice.id} className={`relative px-4 py-2.5 flex items-center gap-3 ${rowHover}`}>
              <button
                onClick={() => toggle(slice.id)}
                disabled={slice.locked}
                title={
                  slice.locked
                    ? 'This slice cannot be hidden.'
                    : slice.hidden
                      ? 'Show this slice'
                      : 'Hide this slice'
                }
                className={`p-1 rounded shrink-0 disabled:opacity-30 disabled:cursor-not-allowed ${slice.hidden ? muted : ''}`}
                style={slice.hidden || slice.locked ? undefined : { color: accent }}
              >
                {slice.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>

              <button
                onClick={() => setPickerFor((current) => (current === slice.id ? null : slice.id))}
                title="Change the color of this dot"
                className="h-5 w-5 rounded-full shrink-0 border border-black/20 shadow-inner"
                style={{ backgroundColor: slice.color }}
              />

              <span className={`flex-1 text-sm truncate ${slice.hidden ? muted : text}`} title={slice.label}>
                {slice.label}
              </span>

              <div className="flex items-center shrink-0">
                <button
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  title="Move up"
                  className={`p-1 rounded ${muted} disabled:opacity-20`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(index, 1)}
                  disabled={index === draft.length - 1}
                  title="Move down"
                  className={`p-1 rounded ${muted} disabled:opacity-20`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {pickerFor === slice.id && (
                <div className={`absolute left-4 right-4 top-full z-10 rounded-lg border p-3 shadow-xl ${surface}`}>
                  <div className="flex flex-wrap gap-1.5">
                    {SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        onClick={() => {
                          recolor(slice.id, swatch);
                          setPickerFor(null);
                        }}
                        title={swatch}
                        className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                          slice.color.toLowerCase() === swatch ? 'ring-2 ring-offset-1 ring-offset-transparent' : 'border-black/20'
                        }`}
                        style={{ backgroundColor: swatch, borderColor: swatch }}
                      />
                    ))}
                  </div>
                  <div className={`mt-3 pt-3 border-t flex items-center gap-2 ${divider}`}>
                    <input
                      type="color"
                      value={slice.color}
                      onChange={(event) => recolor(slice.id, event.target.value)}
                      className="h-7 w-10 rounded cursor-pointer bg-transparent"
                      title="Pick any color"
                    />
                    <button
                      onClick={() => recolor(slice.id, defaultColors.get(slice.id) ?? slice.color)}
                      className={`text-xs ${muted} hover:underline`}
                    >
                      Reset this color
                    </button>
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

        {error && (
          <div className="px-4 py-2 text-xs text-amber-500 bg-amber-500/10 border-t border-amber-500/30">{error}</div>
        )}

        <div className={`p-3 border-t flex items-center gap-2 ${divider}`}>
          <button
            onClick={handleReset}
            disabled={saving}
            className={`px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 ${muted} ${rowHover}`}
            title="Forget this configuration and go back to the defaults"
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

export default StatusSliceConfigModal;

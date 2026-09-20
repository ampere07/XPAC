import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  statusSliceService,
  type SliceDefinition,
  type StatusSlice,
} from '../services/statusSliceService';

/**
 * Load, hold and persist one module's status slices.
 *
 * The four reconciliation tools all render the same left pane over different data, so
 * the mechanics of "what does this operator want to see, in what order, in what
 * colour" live here once rather than four times.
 *
 * Optimistic by design. A save updates the screen immediately and writes in the
 * background: the operator has already seen the result they asked for, and making
 * them wait on a round trip to see their own colour change would be worse than the
 * rare case of a write that fails and is reported after the fact.
 */
export function useStatusSlices(moduleKey: string, definitions: SliceDefinition[]) {
  // The code's defaults, applied until the operator's preferences arrive. Rendering
  // an empty sidebar for the length of one request reads as a broken screen.
  const [slices, setSlices] = useState<StatusSlice[]>(() =>
    definitions.map((definition) => ({ ...definition, hidden: false }))
  );
  const [loaded, setLoaded] = useState(false);

  // Definitions are declared at module scope in every caller, but a caller that built
  // them inline would otherwise re-run the load on every render.
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loadedSlices = await statusSliceService.load(moduleKey, definitionsRef.current);
      if (cancelled) return;
      setSlices(loadedSlices);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [moduleKey]);

  const save = useCallback(
    async (next: StatusSlice[]): Promise<boolean> => {
      setSlices(next);
      return statusSliceService.save(moduleKey, next, definitionsRef.current);
    },
    [moduleKey]
  );

  const reset = useCallback(async () => {
    const defaults = definitionsRef.current.map((definition) => ({ ...definition, hidden: false }));
    setSlices(defaults);
    await statusSliceService.reset(moduleKey);
  }, [moduleKey]);

  /** What the sidebar actually lists — configuration order, hidden ones removed. */
  const visibleSlices = useMemo(() => slices.filter((slice) => !slice.hidden), [slices]);

  /** Dot colour by slice id, for cells and badges that must match the sidebar. */
  const colorOf = useMemo(() => {
    const map = new Map(slices.map((slice) => [slice.id, slice.color]));
    return (id: string): string | undefined => map.get(id);
  }, [slices]);

  return { slices, visibleSlices, colorOf, loaded, save, reset };
}

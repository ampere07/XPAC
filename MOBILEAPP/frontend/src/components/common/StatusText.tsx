import React from 'react';
import { Text, TextStyle } from 'react-native';
import { getStatusColor } from './statusColors';

/**
 * Colored status label, for use outside RecordCard's own status column —
 * inside a detail panel, a summary row, a custom card body.
 *
 * Colours come from the shared table in statusColors.ts, so a status word looks
 * the same here as it does on a list card. `colorMap` overrides it for a
 * page-specific vocabulary; prefer adding the word to the shared table when the
 * meaning is not page-specific.
 */

export interface StatusTextProps {
  status?: string | null;
  /** Extra / overriding status-to-colour entries (keys matched case-insensitively). */
  colorMap?: Record<string, string>;
  /** Optional label overrides, e.g. { inprogress: 'In Progress' }. */
  labelMap?: Record<string, string>;
  style?: TextStyle;
  /** Shown when status is empty. Defaults to "-". */
  placeholder?: string;
}

const NEUTRAL = '#9ca3af';

const StatusText = React.memo(({ status, colorMap, labelMap, style, placeholder = '-' }: StatusTextProps) => {
  if (!status) return <Text style={[{ color: NEUTRAL }, style]}>{placeholder}</Text>;

  const key = status.toLowerCase().trim();
  const color = colorMap?.[key] ?? getStatusColor(status);
  const label = labelMap?.[key] ?? (key === 'inprogress' ? 'In Progress' : status);

  return <Text style={[{ fontWeight: 'bold', textTransform: 'uppercase', color }, style]}>{label}</Text>;
});

StatusText.displayName = 'StatusText';

export default StatusText;

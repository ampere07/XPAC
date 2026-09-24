import React from 'react';
import { Text, TextStyle } from 'react-native';

/**
 * Colored status label used inside standard list cards.
 *
 * Ships with sensible default colors for the common ISP-app statuses, and
 * accepts a `colorMap` override for page-specific vocabularies. Matches the
 * look of JobOrder.tsx's inline StatusText.
 */

const DEFAULT_COLOR_MAP: Record<string, string> = {
  // green — success / good standing
  done: '#4ade80',
  completed: '#4ade80',
  active: '#4ade80',
  paid: '#22c55e',
  approved: '#4ade80',
  success: '#4ade80',
  // blue — in-flight
  reschedule: '#60a5fa',
  inprogress: '#60a5fa',
  'in progress': '#60a5fa',
  'in-progress': '#60a5fa',
  processing: '#60a5fa',
  // orange — waiting
  pending: '#fb923c',
  // red — bad / terminal-negative
  failed: '#ef4444',
  cancelled: '#ef4444',
  canceled: '#ef4444',
  suspended: '#ef4444',
  overdue: '#ef4444',
  unpaid: '#ef4444',
  rejected: '#ef4444',
  declined: '#ef4444',
};

const NEUTRAL = '#9ca3af';

export interface StatusTextProps {
  status?: string | null;
  /** Extra / overriding status→color entries (keys matched case-insensitively). */
  colorMap?: Record<string, string>;
  /** Optional label overrides, e.g. { inprogress: 'In Progress' }. */
  labelMap?: Record<string, string>;
  style?: TextStyle;
  /** Shown when status is empty. Defaults to "-". */
  placeholder?: string;
}

const StatusText = React.memo(({ status, colorMap, labelMap, style, placeholder = '-' }: StatusTextProps) => {
  if (!status) return <Text style={[{ color: NEUTRAL }, style]}>{placeholder}</Text>;

  const key = status.toLowerCase().trim();
  const color = colorMap?.[key] ?? DEFAULT_COLOR_MAP[key] ?? NEUTRAL;
  const label = labelMap?.[key] ?? (key === 'inprogress' ? 'In Progress' : status);

  return (
    <Text style={[{ fontWeight: 'bold', textTransform: 'uppercase', color }, style]}>
      {label}
    </Text>
  );
});

StatusText.displayName = 'StatusText';

export default StatusText;

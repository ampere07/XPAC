import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { getStatusColor, getStatusLabel } from './statusColors';

/**
 * The standard list row — a card, never a table cell.
 *
 * This is ApplicationManagement.tsx's card, lifted so every list page draws the
 * same thing: a title line, an optional badge strip, a two-line summary, and the
 * status on the right. Nothing horizontally scrolls and nothing is measured in
 * column widths, which is the point — a phone cannot show a twelve-column table
 * without hiding eleven of them off-screen.
 *
 * A page that needs more than `subtitle` can pass `children` (rendered under the
 * summary) or `right` (rendered under the status). Reach for those before
 * building a bespoke row: the shared shape is what makes the app look like one
 * app.
 */

export interface RecordCardProps {
  /** Primary line. Truncated to one line. */
  title: string;
  /** Secondary line, up to two lines. The reference page joins date and address with " | ". */
  subtitle?: string;
  /** Status word shown on the right. Blank renders as "Empty", as on the reference page. */
  status?: string | null;
  /** Overrides the shared status→colour table for a page-specific vocabulary. */
  statusColor?: string;
  /** Hides the status column entirely (for lists that have no status). */
  showStatus?: boolean;

  /** Badge strip between title and subtitle — e.g. "someone is viewing". */
  badges?: React.ReactNode;
  /** Extra content under the status, right-aligned (counts, amounts, row actions). */
  right?: React.ReactNode;
  /** Leading content — a checkbox or avatar, before the text column. */
  leading?: React.ReactNode;
  /** Extra content under the subtitle, full width. */
  children?: React.ReactNode;

  onPress?: () => void;
  onLongPress?: () => void;
  /** Tints the row, marking the record whose detail is open. */
  selected?: boolean;

  /** The reference page lower-cases names and capitalises them back for a consistent look. */
  normalizeTitle?: boolean;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
  style?: ViewStyle;
  /** Dims the row while a write is in flight. */
  disabled?: boolean;
}

const RecordCard = React.memo(function RecordCard({
  title,
  subtitle,
  status,
  statusColor,
  showStatus = true,
  badges,
  right,
  leading,
  children,
  onPress,
  onLongPress,
  selected = false,
  normalizeTitle = true,
  titleStyle,
  subtitleStyle,
  style,
  disabled = false,
}: RecordCardProps) {
  const label = getStatusLabel(status);
  const color = statusColor ?? getStatusColor(status);
  const hasStatus = showStatus && (status !== undefined && status !== null);

  const body = (
    <View style={styles.row}>
      {leading != null && <View style={styles.leading}>{leading}</View>}

      <View style={styles.textCol}>
        <Text
          style={[styles.title, normalizeTitle && styles.titleCapitalized, titleStyle]}
          numberOfLines={1}
        >
          {normalizeTitle ? (title || '').toLowerCase() : title}
        </Text>

        {badges}

        {!!subtitle && (
          <Text style={[styles.subtitle, subtitleStyle]} numberOfLines={2}>
            {subtitle}
          </Text>
        )}

        {children}
      </View>

      {(hasStatus || right != null) && (
        <View style={styles.rightCol}>
          {hasStatus && <Text style={[styles.status, { color }]}>{label}</Text>}
          {right}
        </View>
      )}
    </View>
  );

  const container = [
    styles.card,
    selected && styles.cardSelected,
    disabled && styles.cardDisabled,
    style,
  ];

  // A row with nothing to open is not a button — rendering it as one gives it a
  // press highlight and an accessibility role it does not deserve.
  if (!onPress && !onLongPress) {
    return <View style={container}>{body}</View>;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      activeOpacity={0.7}
      style={container}
    >
      {body}
    </TouchableOpacity>
  );
});

export default RecordCard;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: 'transparent',
  },
  cardSelected: { backgroundColor: '#f3f4f6' },
  cardDisabled: { opacity: 0.5 },

  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  leading: { marginRight: 12, paddingTop: 2, flexShrink: 0 },

  // minWidth 0 is what lets numberOfLines truncate instead of pushing the
  // status column off the right edge.
  textCol: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '500', color: '#111827', marginBottom: 4 },
  titleCapitalized: { textTransform: 'capitalize' },
  subtitle: { fontSize: 12, color: '#4b5563' },

  rightCol: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 },
  status: { fontWeight: 'bold', textTransform: 'uppercase' },
});

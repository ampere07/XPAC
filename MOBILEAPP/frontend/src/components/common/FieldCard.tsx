import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { getStatusColor, getStatusLabel } from './statusColors';

/**
 * The card a table row becomes.
 *
 * Where the web build shows a related record as a row of columns, this shows
 * the same record as a card of labelled fields: the first field is the card's
 * heading and the rest are label/value pairs that wrap. Nothing scrolls
 * sideways, so no column is hidden off the right edge of a phone.
 *
 * Use this for record shapes that are configuration-driven (a column set from
 * `relatedDataColumns`, a log row, an arbitrary related list). Use RecordCard
 * instead when the page knows its own fields and wants the standard
 * title / summary / status shape.
 */

export interface FieldCardField {
  label: string;
  /** Already-formatted value. Empty, null and undefined all render as "-". */
  value: React.ReactNode;
  /** Give this field the full card width — for addresses and remarks. */
  wide?: boolean;
}

export interface FieldCardProps {
  /** Heading line. Omit to let the fields speak for themselves. */
  title?: string;
  fields: FieldCardField[];
  /** Status word shown top-right, coloured from the shared table. */
  status?: string | null;
  statusColor?: string;
  onPress?: () => void;
  selected?: boolean;
  /** Right-aligned actions under the status. */
  right?: React.ReactNode;
  style?: ViewStyle;
}

const isBlank = (v: React.ReactNode) =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const FieldCard = React.memo(function FieldCard({
  title,
  fields,
  status,
  statusColor,
  onPress,
  selected = false,
  right,
  style,
}: FieldCardProps) {
  const hasStatus = status !== undefined && status !== null;

  const body = (
    <>
      {(!!title || hasStatus || right != null) && (
        <View style={styles.headerRow}>
          {!!title && (
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          )}
          {(hasStatus || right != null) && (
            <View style={styles.headerRight}>
              {hasStatus && (
                <Text style={[styles.status, { color: statusColor ?? getStatusColor(status) }]}>
                  {getStatusLabel(status)}
                </Text>
              )}
              {right}
            </View>
          )}
        </View>
      )}

      <View style={styles.fieldWrap}>
        {fields.map((field, i) => (
          <View key={`${field.label}-${i}`} style={[styles.field, field.wide && styles.fieldWide]}>
            <Text style={styles.fieldLabel} numberOfLines={1}>
              {field.label}
            </Text>
            {typeof field.value === 'string' || typeof field.value === 'number' || isBlank(field.value) ? (
              <Text style={styles.fieldValue} numberOfLines={3}>
                {isBlank(field.value) ? '-' : String(field.value)}
              </Text>
            ) : (
              field.value
            )}
          </View>
        ))}
      </View>
    </>
  );

  const container = [styles.card, selected && styles.cardSelected, style];

  if (!onPress) return <View style={container}>{body}</View>;

  return (
    <TouchableOpacity style={container} onPress={onPress} activeOpacity={0.7}>
      {body}
    </TouchableOpacity>
  );
});

export default FieldCard;

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  cardSelected: { backgroundColor: '#f3f4f6' },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', color: '#111827' },
  headerRight: { alignItems: 'flex-end', gap: 4, marginLeft: 12, flexShrink: 0 },
  status: { fontWeight: 'bold', textTransform: 'uppercase', fontSize: 12 },

  // Two fields per row on anything phone-width or wider, one row each when a
  // field asks for the full width.
  fieldWrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8, columnGap: 12 },
  field: { minWidth: 120, flexGrow: 1, flexBasis: '45%' },
  fieldWide: { flexBasis: '100%' },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  fieldValue: { fontSize: 13, color: '#111827', marginTop: 1 },
});

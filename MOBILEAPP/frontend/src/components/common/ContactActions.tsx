import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Linking, Platform } from 'react-native';
import { Phone, MessageSquare } from 'lucide-react-native';
import * as SMS from 'expo-sms';
import { TECH_SPIEL_SMS } from '../../services/smsTemplateRegistry';

/**
 * A subscriber phone number with Call and SMS beside it.
 *
 * Replaces selecting a number, copying it, leaving the app and pasting it into
 * the dialer — four steps a technician repeats at every stop, standing outside
 * a gate. Both buttons hand off to the device's own apps through `tel:` and
 * `sms:`, so nothing is dialled or sent by us: the technician still sees the
 * dialer and still presses send. That matters for the SMS in particular — the
 * template is prefilled, not dispatched.
 *
 * Renders as plain selectable text when there is no usable number, rather than
 * showing buttons that would open an empty dialer.
 */

interface ContactActionsProps {
  /** The number as recorded. Formatting is stripped before it reaches the OS. */
  value?: string | null;
  /** Message prefilled into the SMS composer. Defaults to the tech spiel. */
  smsBody?: string;
  valueStyle?: any;
  /** Shown when no number is recorded. */
  emptyLabel?: string;
  /** Icon colour. Defaults to the same neutral the address pin uses. */
  accent?: string;
}

/**
 * Reduces a recorded number to something `tel:` and `sms:` will accept.
 *
 * Keeps a leading '+' — Philippine numbers are stored both as 09xxxxxxxxx and
 * +639xxxxxxxxx, and dropping the plus turns an international number into an
 * unroutable one. Everything else non-numeric goes: the column is free text and
 * carries spaces, dashes, brackets and the occasional '/' between two numbers.
 */
export const toDialable = (value?: string | null): string => {
  if (!value) return '';

  const trimmed = String(value).trim();
  if (trimmed === '') return '';

  // Only the first number when two were typed into one field ("0917… / 0918…").
  // Dialling a concatenation of both would fail silently.
  const [first] = trimmed.split(/[\/,;]|\s+or\s+/i);

  const digits = (first ?? '').replace(/[^\d+]/g, '');

  // A '+' anywhere but the front is a typo, not a country code.
  const normalised = digits.startsWith('+')
    ? '+' + digits.slice(1).replace(/\+/g, '')
    : digits.replace(/\+/g, '');

  // Shorter than this is a truncated record, not a number worth dialling.
  return normalised.replace(/\D/g, '').length >= 7 ? normalised : '';
};

const ContactActions: React.FC<ContactActionsProps> = ({
  value,
  smsBody = TECH_SPIEL_SMS.body,
  valueStyle,
  emptyLabel = 'Not provided',
  accent = '#4b5563',
}) => {
  const dialable = toDialable(value);

  const openUrl = useCallback(async (url: string): Promise<boolean> => {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleCall = useCallback(
    () => openUrl(`tel:${dialable}`),
    [openUrl, dialable]
  );

  const handleSms = useCallback(async () => {
    // Primary method: expo-sms native composer
    try {
      const isAvailable = await SMS.isAvailableAsync();
      if (isAvailable) {
        await SMS.sendSMSAsync([dialable], smsBody);
        return;
      }
    } catch {
      // Fall through to URL scheme fallbacks if native SMS module fails
    }

    const separator = Platform.OS === 'ios' ? '&' : '?';
    const encodedBody = encodeURIComponent(smsBody);

    // Fallback 1: standard sms: schema with body
    let ok = await openUrl(`sms:${dialable}${separator}body=${encodedBody}`);
    if (ok) return;

    // Fallback 2: smsto: schema (Android alternative)
    ok = await openUrl(`smsto:${dialable}?body=${encodedBody}`);
    if (ok) return;

    // Fallback 3: plain sms: without body
    ok = await openUrl(`sms:${dialable}`);
    if (ok) return;

    // Fallback 4: dialer
    await openUrl(`tel:${dialable}`);
  }, [openUrl, dialable, smsBody]);

  if (!dialable) {
    return (
      <Text style={valueStyle} selectable={true}>
        {value?.trim() ? value : emptyLabel}
      </Text>
    );
  }

  return (
    <View style={styles.row}>
      <Text style={[valueStyle, styles.number]} selectable={true}>
        {value}
      </Text>

      <View style={styles.actions}>
        <Pressable
          onPress={handleCall}
          accessibilityRole="button"
          accessibilityLabel={`Call ${dialable}`}
          // Generous hit area: these are tapped one-handed, outdoors, often in
          // gloves. The icon stays small so the row does not grow.
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Phone width={20} height={20} color={accent} />
        </Pressable>

        <Pressable
          onPress={handleSms}
          accessibilityRole="button"
          accessibilityLabel={`Send SMS to ${dialable}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <MessageSquare width={20} height={20} color={accent} />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
  },
  number: { flex: 1, flexShrink: 1 },
  // Without labels the icons need their own breathing room, or two adjacent
  // 20px glyphs read as one control.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

export default ContactActions;

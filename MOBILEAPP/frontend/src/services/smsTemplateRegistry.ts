/**
 * Canned SMS bodies a technician can fire from a contact row.
 *
 * These are deliberately local constants rather than a fetch from
 * `sms_templates`. A technician taps the SMS button standing at a subscriber's
 * gate, frequently on a bad connection or none at all — a template that has to
 * be fetched first is a button that does nothing exactly when it is needed. The
 * same templates are seeded into the `sms_templates` table so they remain
 * manageable from the SMS Templates page; this file is the offline-safe copy the
 * quick action uses.
 *
 * Nothing here is sent by the server. These populate the device's own SMS
 * composer through an `sms:` link, so the technician sees the message and
 * presses send — the app never dispatches on their behalf.
 */

export interface SmsTemplate {
  /** Stable key for lookups; not shown to the user. */
  key: string;
  /** Matches `sms_templates.template_name` for the seeded row. */
  name: string;
  /** Matches `sms_templates.template_type`. */
  type: string;
  body: string;
}

/**
 * The installation-confirmation spiel.
 *
 * Wording is fixed and must not be "improved" locally: it is the script the
 * business agreed on, and it is seeded server-side under the same name. Edit it
 * in the SMS Templates page, not here — a divergence between the two is a
 * technician sending something nobody approved.
 */
export const TECH_SPIEL_SMS: SmsTemplate = {
  key: 'tech_spiel',
  name: 'Tech Spiel SMS',
  type: 'Technician',
  body:
    'Hi, This is from Go Wiser. I am your assigned technician for your installation today. ' +
    'May I Confirm if you are available right now for the installation? Thank you',
};

export const SMS_TEMPLATES: SmsTemplate[] = [TECH_SPIEL_SMS];

/** Looks a template up by key, falling back to the tech spiel. */
export const getSmsTemplate = (key: string): SmsTemplate =>
  SMS_TEMPLATES.find((template) => template.key === key) ?? TECH_SPIEL_SMS;

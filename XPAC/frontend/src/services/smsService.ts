import apiClient from '../config/api';

/**
 * Sending a single SMS.
 *
 * The endpoint is the same POST /sms/send the SMS test route and the blast
 * already go through, so an SMS raised from a customer record is delivered,
 * retried and written to sms_logs by exactly the same code path as every other
 * message the system sends — there is no second sender to keep in step.
 *
 * `account_no`, `source` and `raw_message` are optional and only reach the log:
 * they are what let a message be traced back to the account it was about, the
 * screen it was sent from, and the message as it was composed before the
 * variables were replaced.
 */
export interface SendSmsPayload {
  contact_no: string;
  /** Final text, variables already replaced. This is what the subscriber receives. */
  message: string;
  account_no?: string;
  source?: string;
  /** Composed text with `{{variables}}` left intact. */
  raw_message?: string;
}

export interface SendSmsResult {
  success: boolean;
  message?: string;
  error?: string;
  response?: unknown;
}

/**
 * Resolves rather than throws: the caller decides what to show for a failure,
 * and a rejected promise here would lose the provider's own error text, which
 * is the only useful part of "SMS not sent".
 */
export const sendSms = async (payload: SendSmsPayload): Promise<SendSmsResult> => {
  try {
    const response = await apiClient.post<SendSmsResult>('/sms/send', payload);
    return response.data;
  } catch (error: any) {
    const data = error?.response?.data;

    // A 422 carries per-field messages; everything else carries one string.
    if (data?.errors) {
      const detail = Object.values(data.errors as Record<string, string[] | string>)
        .map(messages => (Array.isArray(messages) ? messages.join(', ') : String(messages)))
        .join('\n');
      return { success: false, error: detail || data.message || 'Validation failed' };
    }

    return {
      success: false,
      error: data?.error || data?.message || error?.message || 'Failed to send SMS',
    };
  }
};

export const smsService = { sendSms };

export default smsService;

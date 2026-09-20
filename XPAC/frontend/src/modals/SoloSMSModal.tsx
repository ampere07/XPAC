import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Loader2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { sendSms } from '../services/smsService';

/**
 * One SMS to one subscriber, composed by hand.
 *
 * Deliberately knows nothing about where it was opened from: it is handed the
 * five values its variables can resolve and returns to its caller once the
 * message is away. The customer panel is the first caller, but a message about
 * an invoice or a service order is the same act, so the panel does not own it.
 */
export interface SoloSMSCustomer {
  accountNo: string;
  /** contact_number_primary. Sending is blocked when it is missing or unusable. */
  contactNumber?: string;
  customerName?: string;
  accountBalance?: number | string | null;
  emailAddress?: string;
  plan?: string;
}

interface SoloSMSModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: SoloSMSCustomer;
  /** Called after a send the provider accepted, with the text that went out. */
  onSent?: (finalMessage: string) => void;
  /** Recorded on the log row so a message can be traced back to its screen. */
  source?: string;
}

/**
 * What LoadingModalGlobal is showing: the send in flight, or how it ended.
 * The same component the rest of the system uses for a blocking operation, so
 * sending an SMS looks like saving an attachment or a payout does.
 */
interface ProgressState {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error';
  title: string;
  message: string;
  percentage: number;
  /** Dismissing a success closes the whole panel; an error leaves the draft up. */
  closeOnDismiss?: boolean;
}

/** The variables offered as buttons, in the order they are shown. */
const MESSAGE_VARIABLES: Array<{ token: string; label: string }> = [
  { token: '{{account_no}}', label: 'Account No.' },
  { token: '{{contact_number}}', label: 'Contact Number' },
  { token: '{{account_balance}}', label: 'Account Balance' },
  { token: '{{email_address}}', label: 'Email Address' },
  { token: '{{plan}}', label: 'Plan' },
];

const MAX_MESSAGE_LENGTH = 1000;

/**
 * A Philippine mobile number in the form the SMS providers accept, or '' when
 * the value cannot be one. 0917..., 9171..., 639... and +639... all normalise
 * to 09XXXXXXXXX; anything else is refused rather than sent and charged for.
 */
export const normalizeContactNumber = (raw?: string | null): string => {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');

  if (/^639\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;

  return '';
};

/** Balance as it should read in a text: 1,234.50, no currency sign. */
const formatBalance = (value?: number | string | null): string => {
  if (value === null || value === undefined || value === '') return '';

  const amount = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[^\d.-]/g, ''));

  if (!Number.isFinite(amount)) return '';

  return amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** What each token resolves to for this customer. Empty means "no data". */
const resolveValues = (customer: SoloSMSCustomer): Record<string, string> => ({
  '{{account_no}}': String(customer.accountNo ?? '').trim(),
  '{{contact_number}}': String(customer.contactNumber ?? '').trim(),
  '{{account_balance}}': formatBalance(customer.accountBalance),
  '{{email_address}}': String(customer.emailAddress ?? '').trim(),
  '{{plan}}': String(customer.plan ?? '').trim(),
});

/**
 * The message as the subscriber will receive it. Exported so a caller that
 * wants to show or store the resolved text resolves it exactly one way.
 */
export const applyVariables = (message: string, customer: SoloSMSCustomer): string => {
  const values = resolveValues(customer);

  return Object.entries(values).reduce(
    (text, [token, value]) => text.split(token).join(value),
    message
  );
};

const SoloSMSModal: React.FC<SoloSMSModalProps> = ({
  isOpen,
  onClose,
  customer,
  onSent,
  source = 'customer_details',
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Collapsed to start with: most messages are typed plainly, and five buttons
  // sitting above the box are noise until someone actually wants one.
  const [showVariables, setShowVariables] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: '',
    percentage: 0,
  });

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  // A fresh message every time the panel opens, so a half-typed draft meant for
  // the previous customer can never be sent to this one.
  useEffect(() => {
    if (isOpen) {
      setMessage('');
      setError('');
      setSending(false);
      setShowVariables(false);
      setProgress(prev => ({ ...prev, isOpen: false }));
    }
  }, [isOpen, customer.accountNo]);

  const recipient = useMemo(
    () => normalizeContactNumber(customer.contactNumber),
    [customer.contactNumber]
  );
  const values = useMemo(() => resolveValues(customer), [customer]);
  const finalMessage = useMemo(() => applyVariables(message, customer), [message, customer]);

  const insertVariable = (token: string) => {
    const el = messageRef.current;
    const current = message;

    if (el && typeof el.selectionStart === 'number') {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      setMessage(current.slice(0, start) + token + current.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    } else {
      setMessage(current + token);
    }

    if (error) setError('');
  };

  const validate = (): string => {
    if (!recipient) {
      return customer.contactNumber
        ? `${customer.contactNumber} is not a mobile number this system can text, so nothing was sent.`
        : 'This customer has no primary contact number on record.';
    }

    if (!message.trim()) {
      return 'Message is required';
    }

    // A variable with nothing behind it would go out as a gap in the sentence.
    const empty = MESSAGE_VARIABLES.filter(
      variable => message.includes(variable.token) && !values[variable.token]
    );

    if (empty.length > 0) {
      const names = empty.map(variable => variable.label).join(', ');
      const those = empty.length > 1 ? 'those variables' : 'that variable';
      return `No data on record for: ${names}. Remove ${those} or fill the customer record in first.`;
    }

    if (!finalMessage.trim()) {
      return 'Message is required';
    }

    if (finalMessage.length > MAX_MESSAGE_LENGTH) {
      return `The message resolves to ${finalMessage.length} characters. The limit is ${MAX_MESSAGE_LENGTH}.`;
    }

    return '';
  };

  const handleSend = async () => {
    // Guards the double click as well as the disabled attribute does: a second
    // click can land before React has re-rendered the button.
    if (sending) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setSending(true);
    setProgress({
      isOpen: true,
      type: 'loading',
      title: 'Sending SMS',
      message: `Sending message to ${recipient}...`,
      percentage: 10,
    });

    // The provider is given three attempts with a wait between them, so a send
    // can take several seconds. The bar climbs to 90 and waits there rather
    // than pretending to know how far along the provider is.
    const progressInterval = setInterval(() => {
      setProgress(prev => ({
        ...prev,
        percentage: prev.percentage >= 90 ? 90 : prev.percentage + 5,
      }));
    }, 300);

    try {
      const sent = finalMessage;

      const result = await sendSms({
        contact_no: recipient,
        message: sent,
        account_no: customer.accountNo || undefined,
        source,
        // Kept for the log only, and only when it differs from what went out.
        raw_message: message !== sent ? message : undefined,
      });

      clearInterval(progressInterval);

      if (result.success) {
        setProgress({
          isOpen: true,
          type: 'success',
          title: 'SMS Sent',
          message: `Message sent to ${recipient}.`,
          percentage: 100,
          closeOnDismiss: true,
        });
        setMessage('');
        if (onSent) onSent(sent);
      } else {
        setProgress({
          isOpen: true,
          type: 'error',
          title: 'SMS Not Sent',
          message: result.error || result.message || 'The message could not be sent.',
          percentage: 0,
        });
      }
    } catch (err: any) {
      // sendSms resolves its own failures; this is for the genuinely unexpected.
      clearInterval(progressInterval);
      setProgress({
        isOpen: true,
        type: 'error',
        title: 'SMS Not Sent',
        message: err?.message || 'The message could not be sent.',
        percentage: 0,
      });
    } finally {
      clearInterval(progressInterval);
      setSending(false);
    }
  };

  const handleClose = () => {
    if (sending) return;
    setMessage('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  const primary = colorPalette?.primary || '#7c3aed';
  const canSend = !sending && !!recipient && message.trim().length > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Send SMS</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={sending}
                className={`px-4 py-2 rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center transition-colors"
                style={{ backgroundColor: primary }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent && canSend) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = primary;
                }}
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    Sending...
                  </>
                ) : 'Send'}
              </button>
              <button
                onClick={handleClose}
                disabled={sending}
                className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Who this is going to */}
            <div className={`rounded border p-4 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'
              }`}>
              <div className="flex justify-between items-center gap-4">
                <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Recipient</span>
                <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {customer.customerName || customer.accountNo || '-'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4 mt-2">
                <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Contact Number</span>
                <span className={`font-medium truncate text-right min-w-0 ${recipient
                  ? isDarkMode ? 'text-white' : 'text-gray-900'
                  : 'text-red-500'
                  }`}>
                  {recipient || customer.contactNumber || 'None on record'}
                </span>
              </div>
              <div className="flex justify-between items-center gap-4 mt-2">
                <span className={`text-sm flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Account No.</span>
                <span className={`font-medium truncate text-right min-w-0 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  {customer.accountNo || '-'}
                </span>
              </div>
            </div>

            {!recipient && (
              <div className={`flex items-start gap-3 rounded border p-3 ${isDarkMode ? 'bg-red-900/20 border-red-900/40' : 'bg-red-50 border-red-200'
                }`}>
                <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className={`text-xs ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                  {customer.contactNumber
                    ? `The primary contact number on this record (${customer.contactNumber}) is not a mobile number this system can text. Correct it in Customer Details first.`
                    : 'This customer has no primary contact number on record, so no SMS can be sent. Add one in Customer Details first.'}
                </p>
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Message<span className="text-red-500">*</span>
              </label>

              {/* Insertable message variables, behind a disclosure so the default
                  view is just the message box. */}
              <div className="mb-2">
                <button
                  type="button"
                  onClick={() => setShowVariables(prev => !prev)}
                  aria-expanded={showVariables}
                  className={`text-xs flex items-center gap-1 transition-colors ${isDarkMode
                    ? 'text-gray-400 hover:text-gray-200'
                    : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {showVariables ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {showVariables ? 'Hide variables' : 'Insert variable'}
                </button>

                {showVariables && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {MESSAGE_VARIABLES.map(variable => {
                      const hasValue = !!values[variable.token];
                      return (
                        <button
                          key={variable.token}
                          type="button"
                          onClick={() => insertVariable(variable.token)}
                          disabled={sending}
                          title={hasValue
                            ? `${variable.token} to ${values[variable.token]}`
                            : `${variable.token} - no data on this record`}
                          className={`text-xs font-medium px-2 py-1 rounded border transition-colors disabled:cursor-not-allowed ${isDarkMode
                            ? 'border-gray-700 text-gray-200 hover:bg-gray-800'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                          style={{
                            borderColor: hasValue ? primary : undefined,
                            color: hasValue ? primary : undefined,
                            opacity: hasValue ? 1 : 0.6,
                          }}
                        >
                          + {variable.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <textarea
                ref={messageRef}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (error) setError('');
                }}
                disabled={sending}
                placeholder={'Type your message here... Click a variable above to insert it, e.g. Hello, your account {{account_no}} has a balance of {{account_balance}}.'}
                rows={6}
                className={`w-full px-3 py-2 border rounded focus:outline-none disabled:opacity-60 ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  } ${error ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                style={{
                  borderColor: error ? '#ef4444' : (colorPalette && message ? colorPalette.primary : ''),
                }}
              />

              <div className="flex items-start justify-between mt-1 gap-4">
                <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Variables are replaced with this customer's own details before the message is sent.
                </p>
                <span className={`text-xs flex-shrink-0 ${finalMessage.length > MAX_MESSAGE_LENGTH
                  ? 'text-red-500'
                  : isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}>
                  {finalMessage.length}/{MAX_MESSAGE_LENGTH}
                </span>
              </div>

              {error && <p className="text-red-500 text-xs mt-1 whitespace-pre-line">{error}</p>}
            </div>

            {/* What will actually go out */}
            {message.trim().length > 0 && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Preview
                </label>
                <div className={`rounded border p-3 text-sm whitespace-pre-wrap break-words ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-gray-200'
                  : 'bg-gray-50 border-gray-200 text-gray-800'
                  }`}>
                  {finalMessage}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <LoadingModalGlobal
        isOpen={progress.isOpen}
        type={progress.type}
        title={progress.title}
        message={progress.message}
        loadingPercentage={progress.percentage}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        onConfirm={() => {
          const shouldClose = progress.closeOnDismiss;
          setProgress(prev => ({ ...prev, isOpen: false }));
          if (shouldClose) onClose();
        }}
      />
    </>
  );
};

export default SoloSMSModal;

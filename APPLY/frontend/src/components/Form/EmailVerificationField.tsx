import React, { useEffect, useRef, useState } from 'react';

/**
 * Email address input with "Send" and a verification-code input, used by both
 * application form layouts (pages/Form.tsx and components/MultiStepForm.tsx).
 *
 * The code itself never reaches the browser: the backend emails it, and the
 * verify endpoint answers with an opaque token when the typed code matches.
 * This component only holds that token and hands it to the parent, which sends
 * it with the application — the backend refuses a submission without it.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_LENGTH = 6;

type Status = { kind: 'success' | 'error' | 'info'; text: string } | null;

interface EmailVerificationFieldProps {
  apiBaseUrl: string;
  email: string;
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The parent's copy of the token; clearing it (e.g. after submit) resets the field. */
  verificationToken: string | null;
  /** Called with the token once verified, and with null whenever it stops being valid. */
  onVerifiedChange: (token: string | null) => void;
  required?: boolean;
  buttonColor: string;
  labelColor: string;
  mutedColor: string;
  inputClassName: string;
  inputStyle: React.CSSProperties;
}

const EmailVerificationField: React.FC<EmailVerificationFieldProps> = ({
  apiBaseUrl,
  email,
  onEmailChange,
  verificationToken,
  onVerifiedChange,
  required = true,
  buttonColor,
  labelColor,
  mutedColor,
  inputClassName,
  inputStyle,
}) => {
  const [code, setCode] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<Status>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const normalized = email.trim().toLowerCase();
  const isVerified = !!verificationToken && verifiedEmail !== null && verifiedEmail === normalized;

  // The parent dropped the token (application submitted, or the server said it had
  // expired): go back to the "Send" state so the applicant can verify again.
  useEffect(() => {
    if (!verificationToken && verifiedEmail !== null) {
      setVerifiedEmail(null);
      setCodeSent(false);
      setCode('');
      setStatus(null);
    }
  }, [verificationToken, verifiedEmail]);

  // Changing the address after verifying (or after a send) starts over: the
  // token and any code in flight belong to the old address.
  useEffect(() => {
    if (verifiedEmail !== null && verifiedEmail !== normalized) {
      setVerifiedEmail(null);
      onVerifiedChange(null);
    }
    setCodeSent(false);
    setCode('');
    setStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const readJson = async (response: Response) => {
    try {
      return await response.json();
    } catch {
      return {};
    }
  };

  const handleSend = async () => {
    if (!email.trim()) {
      setStatus({ kind: 'error', text: 'Please enter your email address first.' });
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setStatus({ kind: 'error', text: 'Please enter a valid email address.' });
      return;
    }

    setIsSending(true);
    setStatus(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/email-verification/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await readJson(response);

      if (typeof data.retry_after === 'number' && data.retry_after > 0) {
        setCooldown(data.retry_after);
      }

      if (!response.ok || !data.success) {
        setStatus({ kind: 'error', text: data.message || 'Could not send the verification code. Please try again.' });
        return;
      }

      setCodeSent(true);
      setCode('');
      setStatus({ kind: 'info', text: data.message || 'A verification code was sent to your email.' });
      codeInputRef.current?.focus();
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server. Please check your connection and try again.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleVerify = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== CODE_LENGTH) {
      setStatus({ kind: 'error', text: `Please enter the ${CODE_LENGTH}-character code from the email.` });
      return;
    }

    setIsVerifying(true);
    setStatus(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/email-verification/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: trimmed }),
      });
      const data = await readJson(response);

      if (!response.ok || !data.success || !data.verification_token) {
        setStatus({ kind: 'error', text: data.message || 'Incorrect code. Please try again.' });
        return;
      }

      setVerifiedEmail(normalized);
      onVerifiedChange(data.verification_token);
      setStatus({ kind: 'success', text: 'Email address verified.' });
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server. Please check your connection and try again.' });
    } finally {
      setIsVerifying(false);
    }
  };

  const sendDisabled = isSending || cooldown > 0 || isVerified;
  const sendLabel = isSending
    ? 'Sending...'
    : cooldown > 0
      ? `Resend (${cooldown}s)`
      : codeSent ? 'Resend' : 'Send';

  const statusColor = status?.kind === 'success' ? '#16A34A' : status?.kind === 'error' ? '#DC2626' : mutedColor;

  return (
    <div className="mb-4">
      <label className="block font-medium mb-2" htmlFor="email" style={{ color: labelColor }}>
        Email {required && <span className="text-red-500">*</span>}
      </label>

      <div className="flex gap-2">
        <input
          type="email"
          id="email"
          name="email"
          value={email}
          onChange={onEmailChange}
          required={required}
          placeholder="Enter your email address"
          title="Please enter a valid email address"
          autoComplete="email"
          className={`${inputClassName} min-w-0 flex-1`}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={sendDisabled}
          className="shrink-0 px-4 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          style={{ backgroundColor: isVerified ? '#16A34A' : buttonColor }}
        >
          {isVerified ? 'Verified' : sendLabel}
        </button>
      </div>

      {!isVerified && (codeSent || code) && (
        <div className="mt-3">
          <label className="block text-sm font-medium mb-1" htmlFor="emailVerificationCode" style={{ color: labelColor }}>
            Verification code
          </label>
          <div className="flex gap-2">
            <input
              ref={codeInputRef}
              type="text"
              id="emailVerificationCode"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, CODE_LENGTH))}
              onKeyDown={(e) => {
                // Enter here verifies the code rather than submitting the whole form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleVerify();
                }
              }}
              placeholder="Enter 6-character code"
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={CODE_LENGTH}
              className={`${inputClassName} min-w-0 flex-1 font-mono tracking-widest uppercase`}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={handleVerify}
              disabled={isVerifying || code.length !== CODE_LENGTH}
              className="shrink-0 px-4 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              style={{ backgroundColor: buttonColor }}
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </button>
          </div>
          <p className="text-xs mt-1" style={{ color: mutedColor }}>
            Check your inbox (and spam folder) for the code we sent to {email.trim()}.
          </p>
        </div>
      )}

      {status && (
        <p className="text-sm mt-2" role={status.kind === 'error' ? 'alert' : 'status'} style={{ color: statusColor }}>
          {status.kind === 'success' && '✓ '}{status.text}
        </p>
      )}

      {!isVerified && !codeSent && !status && (
        <p className="text-xs mt-1" style={{ color: mutedColor }}>
          Click Send to receive a verification code at this address.
        </p>
      )}
    </div>
  );
};

export default EmailVerificationField;

import React, { useState, useEffect } from 'react';
import { login, forgotPassword } from '../services/api';
import { UserData } from '../types/api';
import { formUIService } from '../services/formUIService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { trackPixelEvent } from '../utils/metaPixel';

interface LoginProps {
  onLogin: (userData: UserData) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [accountNo, setAccountNo] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [cooldownTime, setCooldownTime] = useState<number>(0);
  const [showSuspendedModal, setShowSuspendedModal] = useState(false);
  const [showForceLoginModal, setShowForceLoginModal] = useState(false);
  const [forceLoginMessage, setForceLoginMessage] = useState('');

  useEffect(() => {
    const savedCooldown = sessionStorage.getItem('forgotPasswordCooldown');
    if (savedCooldown) {
      const endTime = parseInt(savedCooldown, 10);
      const now = Date.now();
      if (endTime > now) {
        setCooldownTime(Math.ceil((endTime - now) / 1000));
      } else {
        sessionStorage.removeItem('forgotPasswordCooldown');
      }
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldownTime > 0) {
      timer = setInterval(() => {
        setCooldownTime((prev) => {
          if (prev <= 1) {
            sessionStorage.removeItem('forgotPasswordCooldown');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownTime]);

  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    const apiUrl = process.env.REACT_APP_API_BASE_URL;
    return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
  };

  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const config = await formUIService.getConfig();
        if (config && config.logo_url) {
          setLogoUrl(convertGoogleDriveUrl(config.logo_url));
        }
      } catch (error) {
        console.error('[Logo] Error fetching logo:', error);
      }
    };

    fetchLogo();
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

  /**
   * Shared by the form submit and by the takeover confirmation, so the confirmed retry goes
   * through exactly the same path as a first attempt — only force_login differs.
   */
  const submitLogin = async (forceLogin: boolean) => {
    setIsLoading(true);
    setError('');

    try {
      const response = await login(accountNo, mobileNo, forceLogin);
      if (response.status === 'success') {
        const userData: UserData = {
          id: response.data.user.id,
          username: response.data.user.username,
          email: response.data.user.email,
          full_name: response.data.user.full_name,
          role: response.data.user.role,
          role_id: response.data.user.role_id,
          // The role's effective keys, as the server resolved them.
          permissions: response.data.user.permissions || null,
          // The section this role lands on, so the client does not infer it
          // from the first key in the list.
          home: response.data.user.home || null,
          // Only a backend with the permission table sends `home` (null for a
          // standalone custom role). An older one sends a custom role's raw
          // stored row as `permissions`, which config/permissions.ts then
          // resolves itself.
          permissions_resolved: Object.prototype.hasOwnProperty.call(response.data.user, 'home'),
          // A custom role saved before per-action keys existed (bell shortcuts).
          permissions_legacy: response.data.user.permissions_legacy === true,
          organization: response.data.user.organization
        };
        setShowForceLoginModal(false);

        /*
         * Meta Pixel — fired only where the server has actually authenticated the
         * credentials: status 'success' carrying the user record. A 401, a 403
         * suspension and the 409 force-login prompt all land in the catch below
         * instead, so none of them report a login.
         *
         * Deliberately NOT in App.tsx's handleLogin or its session-restore branch:
         * that path re-runs from cached authData on every page refresh, which would
         * count each reload as a fresh sign-in.
         */
        trackPixelEvent('Login', {}, {
          eventID: `login-${userData.id}-${Date.now()}`,
        });

        onLogin(userData);
      } else {
        setError('Login failed. Please try again.');
      }
    } catch (err: any) {
      if (err.response?.status === 403 && err.response?.data?.status === 'suspended') {
        setShowSuspendedModal(true);
      } else if (err.response?.status === 409 && err.response?.data?.require_confirmation) {
        // Technician already signed in elsewhere. Nothing has been authenticated yet — the
        // login only completes if they confirm and it is re-sent with force_login.
        setForceLoginMessage(err.response?.data?.message || '');
        setShowForceLoginModal(true);
      } else {
        setShowForceLoginModal(false);
        setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountNo || !mobileNo) {
      setError('Please enter your account number and mobile number');
      return;
    }

    await submitLogin(false);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownTime > 0) return;

    if (!forgotEmail) {
      setError('Please enter your email or account number');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await forgotPassword(forgotEmail);
      if (response.status === 'success') {
        setForgotMessage(response.message);
        const endTime = Date.now() + 3 * 60 * 1000;
        sessionStorage.setItem('forgotPasswordCooldown', endTime.toString());
        setCooldownTime(180);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <style>{`
        * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        @media (max-width: 768px) {
          .login-container {
            flex-direction: column !important;
            background-color: #f8fafc !important;
            padding: 20px !important;
            box-shadow: none !important;
            min-height: 100vh !important;
            border-radius: 0 !important;
          }
          .login-left {
            order: 2 !important;
            background: linear-gradient(135deg, ${colorPalette?.primary || '#7c3aed'} 0%, ${colorPalette?.secondary || '#7c3aed'} 100%) !important;
            border-radius: 30px !important;
            padding: 40px 25px !important;
            margin-bottom: 40px !important;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4) !important;
            width: 100% !important;
            border-top-right-radius: 30px !important;
            border-bottom-right-radius: 30px !important;
          }
          .login-right {
            order: 1 !important;
            display: contents !important;
          }
          .logo-section {
            order: 1 !important;
            width: 100% !important;
            padding: 40px 0 20px 0 !important;
            background: transparent !important;
          }
          .apply-section {
            order: 3 !important;
            width: 100% !important;
            padding: 0 0 40px 0 !important;
            background: transparent !important;
          }
          .login-input {
            border-radius: 50px !important;
            padding: 16px 25px !important;
            font-size: 16px !important;
            border: none !important;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1) !important;
          }
          .login-button {
            border-radius: 50px !important;
            padding: 16px !important;
            font-size: 16px !important;
            text-transform: uppercase !important;
            letter-spacing: 1px !important;
            color: ${colorPalette?.primary || '#7c3aed'} !important;
          }
          .login-button:disabled {
            color: #ffffff !important;
            background-color: #6b7280 !important;
          }
          .apply-button {
            border-radius: 50px !important;
            padding: 16px 60px !important;
            background-color: ${colorPalette?.primary || '#7c3aed'} !important;
            width: 100% !important;
            max-width: 280px !important;
          }
          .new-here-text {
            color: ${colorPalette?.primary || '#7c3aed'} !important;
            font-size: 32px !important;
          }
        }
      `}</style>
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: '#f3f4f6'
      }}>
        <div style={{
          display: 'flex',
          width: '100%',
          maxWidth: '1200px',
          margin: 'auto',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
        }} className="login-container">

          <div style={{
            flex: 1,
            background: `linear-gradient(135deg, ${colorPalette?.primary || '#7c3aed'} 0%, ${colorPalette?.secondary || '#7c3aed'} 100%)`,
            padding: '60px 50px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            borderTopRightRadius: '16px',
            borderBottomRightRadius: '16px',
            boxShadow: '4px 0 15px rgba(0, 0, 0, 0.1)'
          }} className="login-left">

            {showForgotPassword ? (
              <>
                <div style={{ marginBottom: '40px' }}>
                  <h1 style={{
                    fontSize: '32px',
                    fontWeight: '700',
                    color: '#ffffff',
                    marginBottom: '10px'
                  }}>
                    Retrieve Credentials
                  </h1>
                  <p style={{
                    fontSize: '14px',
                    color: '#ffffff',
                    opacity: 0.9,
                    fontWeight: '700'
                  }}>
                    {forgotMessage ? 'Successfully sent!' : 'Enter your details to recover your account.'}
                  </p>
                </div>

                {forgotMessage ? (
                  <div>
                    <div style={{
                      color: '#ffffff',
                      textAlign: 'center',
                      marginBottom: '20px',
                      padding: '15px',
                      backgroundColor: 'rgba(255, 255, 255, 0.2)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      backdropFilter: 'blur(10px)',
                      fontWeight: '600'
                    }}>
                      {forgotMessage}
                    </div>
                    <button
                      onClick={() => {
                        setShowForgotPassword(false);
                        setForgotMessage('');
                        setForgotEmail('');
                        setError('');
                      }}
                      className="login-button"
                      style={{
                        width: '100%',
                        padding: '16px',
                        backgroundColor: '#ffffff',
                        color: colorPalette?.primary || '#7c3aed',
                        border: 'none',
                        borderRadius: '30px',
                        fontSize: '16px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      BACK TO LOGIN
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword}>
                    <div style={{ marginBottom: '24px' }}>
                      <input
                        type="text"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        className="login-input"
                        style={{
                          width: '100%',
                          padding: '14px',
                          backgroundColor: '#ffffff',
                          border: '1px solid #d1d5db',
                          borderRadius: '8px',
                          color: '#111827',
                          fontSize: '15px',
                          outline: 'none',
                          fontWeight: '600'
                        }}
                        placeholder="Enter your email or account number"
                      />
                    </div>

                    {error && (
                      <div style={{
                        color: '#dc2626',
                        marginBottom: '20px',
                        fontSize: '14px',
                        backgroundColor: '#fee2e2',
                        padding: '12px',
                        borderRadius: '6px'
                      }}>
                        {error}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading || cooldownTime > 0}
                      className="login-button"
                      style={{
                        width: '100%',
                        padding: '16px',
                        backgroundColor: (isLoading || cooldownTime > 0) ? '#6b7280' : '#ffffff',
                        color: (isLoading || cooldownTime > 0) ? '#ffffff' : (colorPalette?.primary || '#7c3aed'),
                        border: 'none',
                        borderRadius: '30px',
                        fontSize: '16px',
                        fontWeight: '700',
                        cursor: (isLoading || cooldownTime > 0) ? 'not-allowed' : 'pointer',
                        marginBottom: '20px',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (!isLoading && cooldownTime === 0) {
                          e.currentTarget.style.transform = 'translateY(-2px)';
                          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isLoading && cooldownTime === 0) {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                        }
                      }}
                    >
                      {isLoading
                        ? 'SENDING...'
                        : cooldownTime > 0
                          ? `WAIT ${Math.floor(cooldownTime / 60)}:${String(cooldownTime % 60).padStart(2, '0')}`
                          : 'SEND CREDENTIALS'}
                    </button>

                    <div style={{ textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(false);
                          setError('');
                        }}
                        style={{
                          backgroundColor: 'transparent',
                          color: '#ffffff',
                          border: 'none',
                          fontSize: '14px',
                          cursor: 'pointer',
                          fontWeight: '700',
                          textDecoration: 'underline'
                        }}
                      >
                        Back to Login
                      </button>
                    </div>
                  </form>
                )}
              </>
            ) : (
              <>
                <div style={{ marginBottom: '40px' }}>
                  <h1 style={{
                    fontSize: '32px',
                    fontWeight: '700',
                    color: '#ffffff',
                    marginBottom: '10px'
                  }}>
                    Welcome Back
                  </h1>
                  <p style={{
                    fontSize: '14px',
                    color: '#ffffff',
                    opacity: 0.9,
                    fontWeight: '700'
                  }}>
                    Please login to your account.
                  </p>
                </div>

                <form onSubmit={handleSubmit}>
                  <div style={{ marginBottom: '24px' }}>
                    <input
                      type="text"
                      value={accountNo}
                      onChange={(e) => setAccountNo(e.target.value)}
                      className="login-input"
                      style={{
                        width: '100%',
                        padding: '14px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        color: '#111827',
                        fontSize: '15px',
                        outline: 'none',
                        fontWeight: '600'
                      }}
                      placeholder="Account No./Username/Email"
                    />
                  </div>

                  <div style={{ marginBottom: '32px', position: 'relative' }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={mobileNo}
                      onChange={(e) => setMobileNo(e.target.value)}
                      className="login-input"
                      style={{
                        width: '100%',
                        padding: '14px',
                        paddingRight: '50px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        color: '#111827',
                        fontSize: '15px',
                        outline: 'none',
                        fontWeight: '600'
                      }}
                      placeholder="Password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '20px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10
                      }}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>

                  {error && (
                    <div style={{
                      color: '#dc2626',
                      marginBottom: '20px',
                      fontSize: '14px',
                      backgroundColor: '#fee2e2',
                      padding: '12px',
                      borderRadius: '6px'
                    }}>
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="login-button"
                    style={{
                      width: '100%',
                      padding: '16px',
                      backgroundColor: isLoading ? '#6b7280' : '#ffffff',
                      color: isLoading ? '#ffffff' : (colorPalette?.primary || '#7c3aed'),
                      border: 'none',
                      borderRadius: '30px',
                      fontSize: '16px',
                      fontWeight: '700',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.2s',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoading) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.15)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isLoading) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                      }
                    }}
                  >
                    {isLoading ? 'LOGGING IN...' : 'SECURE LOGIN'}
                    {!isLoading && <ArrowRight size={20} />}
                  </button>

                  <div style={{
                    textAlign: 'center',
                    marginTop: '20px'
                  }}>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotPassword(true);
                        setError('');
                      }}
                      style={{
                        backgroundColor: 'transparent',
                        color: '#ffffff',
                        border: 'none',
                        fontSize: '14px',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        fontWeight: '700',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        margin: '0 auto'
                      }}
                    >
                      Forgot Password?
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>

          <div style={{
            flex: 1,
            backgroundColor: '#ffffff',
            padding: '60px 50px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }} className="login-right">
            <div className="logo-section" style={{
              textAlign: 'center',
              marginBottom: '40px'
            }}>
              {logoUrl && (
                <img
                  src={logoUrl}
                  alt="Logo"
                  style={{
                    height: '120px',
                    // Tailwind Preflight makes <img> display:block, so the parent's
                    // text-align:center does not centre it — auto margins do. Without this the
                    // logo hugs the left edge on mobile, where the media query forces
                    // .logo-section to width:100% instead of letting it shrink-wrap.
                    display: 'block',
                    maxWidth: '100%',
                    objectFit: 'contain',
                    margin: '0 auto 10px'
                  }}
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              <p style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#6b7280',
                marginTop: '10px'
              }}>
                Powered by <span style={{ color: colorPalette?.primary || '#7c3aed' }}>SYNC</span>
              </p>
            </div>

            <div className="apply-section" style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}>
              <div style={{ marginBottom: '30px' }}>
                <h2 className="new-here-text" style={{
                  fontSize: '36px',
                  fontWeight: '700',
                  marginBottom: '15px',
                  color: colorPalette?.primary || '#7c3aed'
                }}>
                  New Here?
                </h2>
                <p style={{
                  fontSize: '16px',
                  color: '#6b7280'
                }}>
                  Apply online in just 2 minutes.
                </p>
              </div>

              <button
                type="button"
                className="apply-button"
                onClick={() => {
                  window.open('https://apply.gowiser.ph', '_blank');
                }}
                style={{
                  padding: '16px 48px',
                  backgroundColor: colorPalette?.primary || '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '30px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'transform 0.2s',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
                  if (colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
                  e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                }}
              >
                APPLY NOW
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSuspendedModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#fee2e2',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              <svg style={{ width: '32px', height: '32px', color: '#dc2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: '700',
              color: '#111827',
              marginBottom: '12px'
            }}>Account Suspended</h3>
            <p style={{
              fontSize: '16px',
              color: '#4b5563',
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              Your account has been suspended. Please contact support for assistance.
            </p>
            <button
              onClick={() => setShowSuspendedModal(false)}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: colorPalette?.primary || '#7c3aed',
                color: '#ffffff',
                border: 'none',
                borderRadius: '30px',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
              }}
            >
              CONFIRM
            </button>
          </div>
        </div>
      )}

      {showForceLoginModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '420px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#fef3c7',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              <svg style={{ width: '32px', height: '32px', color: '#d97706' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: '700',
              color: '#111827',
              marginBottom: '12px'
            }}>Account Active Elsewhere</h3>
            <p style={{
              fontSize: '16px',
              color: '#4b5563',
              marginBottom: '24px',
              lineHeight: '1.5'
            }}>
              {forceLoginMessage || 'Account active on another device. Proceed and log out previous session?'}
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setShowForceLoginModal(false);
                  setForceLoginMessage('');
                  setError('');
                }}
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#ffffff',
                  color: '#4b5563',
                  border: '1px solid #d1d5db',
                  borderRadius: '30px',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: isLoading ? 'not-allowed' : 'pointer'
                }}
              >
                CANCEL
              </button>
              <button
                onClick={() => submitLogin(true)}
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: isLoading ? '#6b7280' : (colorPalette?.primary || '#7c3aed'),
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '30px',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                }}
              >
                {isLoading ? 'LOGGING IN...' : 'PROCEED & LOG IN'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Login;

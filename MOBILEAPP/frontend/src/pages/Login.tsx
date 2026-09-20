import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  Dimensions,
  Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { login as loginUser, forgotPassword } from '../services/api';
import { UserData } from '../types/api';
import { formUIService } from '../services/formUIService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { ArrowRight, Eye, EyeOff } from 'lucide-react-native';


interface LoginProps {
  onLogin: (userData: UserData) => void;
}

const { width } = Dimensions.get('window');

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [accountNo, setAccountNo] = useState('');
  const [mobileNo, setMobileNo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotAccountNo, setForgotAccountNo] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPasswordTimer, setForgotPasswordTimer] = useState(0);
  const [showSuspendedModal, setShowSuspendedModal] = useState(false);



  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    // Use the native environment variable logic or fallback
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
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

  useEffect(() => {
    const checkCooldown = async () => {
      try {
        const storedExpiry = await AsyncStorage.getItem('forgot_password_expiry');
        if (storedExpiry) {
          const remaining = Math.round((parseInt(storedExpiry) - Date.now()) / 1000);
          if (remaining > 0) {
            setForgotPasswordTimer(remaining);
          } else {
            await AsyncStorage.removeItem('forgot_password_expiry');
          }
        }
      } catch (err) {
        console.error('Error checking forgot password cooldown:', err);
      }
    };
    checkCooldown();
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (forgotPasswordTimer > 0) {
      interval = setInterval(() => {
        setForgotPasswordTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            AsyncStorage.removeItem('forgot_password_expiry').catch(console.error);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [forgotPasswordTimer]);


  const handleSubmit = async () => {
    // Trimmed before anything looks at them. A mobile keyboard's autocomplete
    // and a pasted account number both bring a trailing space along, and the
    // server compares the password character for character - so an untrimmed
    // space reads as a wrong password against a number that looks correct.
    const account = accountNo.trim();
    const mobile = mobileNo.trim();

    if (!account || !mobile) {
      setError('Please enter your account number and mobile number');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await loginUser(account, mobile);
      if (response.status === 'success') {
        const userData: UserData = {
          id: response.data.user.id,
          username: response.data.user.username,
          email: response.data.user.email,
          full_name: response.data.user.full_name,
          role: response.data.user.role,
          role_id: response.data.user.role_id,
          // The role's effective permission keys, as the server resolved them.
          // These were dropped here before, so a custom role signed in with no
          // permissions at all and the app fell back to whatever its role name
          // happened to match.
          permissions: response.data.user.permissions || null,
          // The section this role lands on.
          home: response.data.user.home || null,
          organization: response.data.user.organization
        };
        // No token, no sign-in.
        //
        // This used to store the token only if one came back and sign the customer
        // in either way, which meant a response missing it produced an app that
        // believed it was authenticated and held nothing to prove it: the dashboard
        // rendered name and account number from authData while every request 401'd.
        // The server always issues one today, so this guards a path that cannot
        // currently fire — but it is what makes "signed in without a credential"
        // impossible by construction rather than by coincidence.
        if (!response.data.token) {
          setError('Login failed. Please try again.');
          return;
        }

        await AsyncStorage.setItem('authToken', response.data.token);
        onLogin(userData);
      } else if (response.status === 'suspended') {
        setShowSuspendedModal(true);
      } else {
        setError('Login failed. Please try again.');
      }


    } catch (err: any) {
      if (err.response?.data?.status === 'suspended') {
        setShowSuspendedModal(true);
      } else {
        setError(err.response?.data?.message || 'Invalid credentials. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (forgotPasswordTimer > 0) return;

    if (!forgotAccountNo) {
      setError('Please enter your account number');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await forgotPassword(forgotAccountNo);
      if (response.status === 'success') {
        setForgotMessage(response.message);

        // Set 3-minute cooldown
        const expiryTime = Date.now() + (3 * 60 * 1000);
        await AsyncStorage.setItem('forgot_password_expiry', expiryTime.toString());
        setForgotPasswordTimer(180);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send reset instructions.');
    } finally {
      setIsLoading(false);
    }
  };


  // Moved forgot password logic into a Modal below

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }} showsVerticalScrollIndicator={false}>
          {/* Logo Section */}
          <View style={{ alignItems: 'center', marginBottom: 30, marginTop: 20 }}>
            {logoUrl && (
              <Image
                source={{ uri: logoUrl }}
                style={{ height: 100, width: 200, marginBottom: 10 }}
                resizeMode="contain"
              />
            )}
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#6b7280', marginTop: 5 }}>
              Powered by <Text style={{ color: '#6d28d9' }}>Sync</Text>
            </Text>
          </View>

          {/* Login Form Section */}
          <View style={{
            borderRadius: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.1,
            shadowRadius: 20,
            elevation: 8,
            marginBottom: 30,
            overflow: 'hidden'
          }}>
            <LinearGradient
              colors={[colorPalette?.primary || '#6d28d9', '#000000']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 30 }}
            >
              <View style={{ marginBottom: 30 }}>
                <Text style={{ fontSize: 32, fontWeight: '700', color: '#ffffff', marginBottom: 8 }}>Welcome Back</Text>
                <Text style={{ fontSize: 14, color: '#ffffff', opacity: 0.9, fontWeight: '600' }}>Please login to your account.</Text>
              </View>

              <View style={{ width: '100%' }}>
                <View style={{ marginBottom: 16 }}>
                  <TextInput
                    style={{
                      width: '100%',
                      padding: 14,
                      backgroundColor: '#ffffff',
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 12,
                      color: '#111827',
                      fontSize: 16,
                    }}
                    value={accountNo}
                    onChangeText={setAccountNo}
                    placeholder="Account No./Username/Email"
                    placeholderTextColor="#6b7280"
                    autoCapitalize="none"
                  />
                </View>

                <View style={{ marginBottom: 16, position: 'relative' }}>
                  <TextInput
                    style={{
                      width: '100%',
                      padding: 14,
                      paddingRight: 50,
                      backgroundColor: '#ffffff',
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 12,
                      color: '#111827',
                      fontSize: 16,
                    }}
                    value={mobileNo}
                    onChangeText={setMobileNo}
                    placeholder="Password"
                    placeholderTextColor="#6b7280"
                    keyboardType="default"
                    autoComplete="password"
                    textContentType="password"
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: 14,
                      top: 14,
                    }}
                  >
                    {showPassword ? (
                      <EyeOff size={20} color="#6b7280" />
                    ) : (
                      <Eye size={20} color="#6b7280" />
                    )}
                  </TouchableOpacity>
                </View>

                {error ? (
                  <View style={{
                    backgroundColor: '#fee2e2',
                    padding: 12,
                    borderRadius: 6,
                    marginBottom: 20,
                  }}>
                    <Text style={{ color: '#dc2626', fontSize: 14 }}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    padding: 16,
                    backgroundColor: isLoading ? '#6b7280' : '#ffffff',
                    borderRadius: 30,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 2,
                  }}
                >
                  <Text style={{
                    color: isLoading ? '#ffffff' : (colorPalette?.primary || '#6d28d9'),
                    fontSize: 16,
                    fontWeight: '700',
                  }}>
                    {isLoading ? 'LOGGING IN...' : 'SECURE LOGIN'}
                  </Text>
                  {!isLoading && <ArrowRight color={isLoading ? '#ffffff' : (colorPalette?.primary || '#6d28d9')} size={20} />}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowForgotPassword(true);
                    setError('');
                  }}
                  style={{ alignItems: 'center', marginTop: 20 }}
                >
                  <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>

          {/* New Here Section */}
          <View style={{ alignItems: 'center', marginBottom: 40, paddingHorizontal: 20 }}>
            <Text style={{
              fontSize: 30,
              fontWeight: '700',
              marginBottom: 10,
              color: colorPalette?.primary || '#6d28d9',
              textAlign: 'center',
            }}>New Here?</Text>
            <Text style={{
              fontSize: 16,
              color: '#6b7280',
              marginBottom: 20,
              textAlign: 'center',
            }}>Apply online in just 2 minutes.</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL('https://apply.atssfiber.ph')}
              style={{
                paddingVertical: 16,
                paddingHorizontal: 48,
                backgroundColor: colorPalette?.primary || '#6d28d9',
                borderRadius: 30,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 6,
                elevation: 4,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>APPLY NOW</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showForgotPassword}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowForgotPassword(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            padding: 30,
            borderRadius: 24,
            width: '100%',
            maxWidth: 400,
            elevation: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 10
          }}>
            <Text style={{
              fontSize: 24,
              fontWeight: '700',
              color: colorPalette?.primary || '#6d28d9',
              marginBottom: 20,
              textAlign: 'center'
            }}>Recover Account</Text>

            {forgotMessage ? (
              <>
                <View style={{
                  backgroundColor: '#f0fdf4',
                  padding: 15,
                  borderRadius: 12,
                  marginBottom: 20,
                  borderWidth: 1,
                  borderColor: '#bbf7d0'
                }}>
                  <Text style={{ color: '#16a34a', textAlign: 'center', fontWeight: '500' }}>{forgotMessage}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowForgotPassword(false);
                    setForgotMessage('');
                    setForgotAccountNo('');
                    setError('');
                  }}
                  style={{
                    backgroundColor: colorPalette?.primary || '#6d28d9',
                    padding: 16,
                    borderRadius: 30,
                    alignItems: 'center'
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>DONE</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={{ marginBottom: 20 }}>
                  <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 8, fontWeight: '600' }}>ACCOUNT NO / EMAIL / USERNAME</Text>
                  <TextInput
                    style={{
                      width: '100%',
                      padding: 14,
                      backgroundColor: '#f9fafb',
                      borderWidth: 1,
                      borderColor: '#d1d5db',
                      borderRadius: 12,
                      color: '#111827',
                      fontSize: 16,
                    }}
                    value={forgotAccountNo}
                    onChangeText={setForgotAccountNo}
                    placeholder="Enter account no, email, or username"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                  />
                </View>

                {error ? (
                  <View style={{ backgroundColor: '#fee2e2', padding: 10, borderRadius: 8, marginBottom: 20 }}>
                    <Text style={{ color: '#dc2626', textAlign: 'center', fontSize: 14 }}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  onPress={handleForgotPassword}
                  disabled={isLoading || forgotPasswordTimer > 0}
                  style={{
                    backgroundColor: (isLoading || forgotPasswordTimer > 0) ? '#9ca3af' : (colorPalette?.primary || '#6d28d9'),
                    padding: 16,
                    borderRadius: 30,
                    alignItems: 'center',
                    marginBottom: 12
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>
                    {isLoading ? 'SENDING...' : forgotPasswordTimer > 0 ? `RESEND IN ${forgotPasswordTimer}s` : 'SEND ACCOUNT INFO'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowForgotPassword(false);
                    setError('');
                  }}
                  style={{ padding: 10, alignItems: 'center' }}
                >
                  <Text style={{ color: '#6b7280', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Account Suspended Modal */}
      <Modal
        visible={showSuspendedModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSuspendedModal(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20
        }}>
          <View style={{
            backgroundColor: '#ffffff',
            padding: 30,
            borderRadius: 24,
            width: '100%',
            maxWidth: 400,
            elevation: 10,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.25,
            shadowRadius: 10,
            alignItems: 'center'
          }}>
            <View style={{
              width: 60,
              height: 60,
              borderRadius: 30,
              backgroundColor: '#fee2e2',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 20
            }}>
              <Text style={{ fontSize: 30 }}>⚠️</Text>
            </View>

            <Text style={{
              fontSize: 22,
              fontWeight: '700',
              color: '#111827',
              marginBottom: 12,
              textAlign: 'center'
            }}>Account Suspended</Text>

            <Text style={{
              fontSize: 16,
              color: '#4b5563',
              marginBottom: 24,
              textAlign: 'center',
              lineHeight: 24
            }}>
              your account is suspended contact a support
            </Text>

            <TouchableOpacity
              onPress={() => setShowSuspendedModal(false)}
              style={{
                backgroundColor: colorPalette?.primary || '#6d28d9',
                paddingVertical: 14,
                paddingHorizontal: 40,
                borderRadius: 30,
                width: '100%',
                alignItems: 'center'
              }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 16 }}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>


  );
};

export default Login;

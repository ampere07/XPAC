import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Dimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Save, Edit2, Trash2, Plus, X, Router, CheckCircle } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { pppoeService, UsernamePattern, SequenceItem } from '../services/pppoeService';

const usernameComponents = [
  { type: 'first_name', label: 'First Name' },
  { type: 'first_name_capitalized', label: 'First Name (Capitalized)' },
  { type: 'first_name_initial', label: 'First Name Initial' },
  { type: 'middle_name', label: 'Middle Name' },
  { type: 'middle_name_capitalized', label: 'Middle Name (Capitalized)' },
  { type: 'middle_name_initial', label: 'Middle Name Initial' },
  { type: 'last_name', label: 'Last Name' },
  { type: 'last_name_capitalized', label: 'Last Name (Capitalized)' },
  { type: 'last_name_initial', label: 'Last Name Initial' },
  { type: 'mobile_number', label: 'Mobile Number' },
  { type: 'mobile_number_last_4', label: 'Mobile (Last 4)' },
  { type: 'mobile_number_last_6', label: 'Mobile (Last 6)' },
  { type: 'lcp', label: 'LCP' },
  { type: 'nap', label: 'NAP' },
  { type: 'port', label: 'Port' },
  { type: 'tech_input', label: 'Tech Input' },
];

const passwordComponents = [
  { type: 'first_name', label: 'First Name' },
  { type: 'first_name_capitalized', label: 'First Name (Capitalized)' },
  { type: 'first_name_initial', label: 'First Name Initial' },
  { type: 'middle_name', label: 'Middle Name' },
  { type: 'middle_name_capitalized', label: 'Middle Name (Capitalized)' },
  { type: 'middle_name_initial', label: 'Middle Name Initial' },
  { type: 'last_name', label: 'Last Name' },
  { type: 'last_name_capitalized', label: 'Last Name (Capitalized)' },
  { type: 'last_name_initial', label: 'Last Name Initial' },
  { type: 'mobile_number', label: 'Mobile Number' },
  { type: 'mobile_number_last_4', label: 'Mobile (Last 4)' },
  { type: 'mobile_number_last_6', label: 'Mobile (Last 6)' },
  { type: 'lcp', label: 'LCP' },
  { type: 'nap', label: 'NAP' },
  { type: 'port', label: 'Port' },
  { type: 'random_4_digits', label: 'Random 4 Digits' },
  { type: 'random_6_digits', label: 'Random 6 Digits' },
  { type: 'random_letters_4', label: 'Random 4 Letters' },
  { type: 'random_letters_6', label: 'Random 6 Letters' },
  { type: 'random_alphanumeric_4', label: 'Random 4 Chars' },
  { type: 'random_alphanumeric_6', label: 'Random 6 Chars' },
  { type: 'custom_password', label: 'Custom Password' },
];

const PPPoESetup: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;
  const [patterns, setPatterns] = useState<UsernamePattern[]>([]);
  const [currentSequence, setCurrentSequence] = useState<SequenceItem[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [patternName, setPatternName] = useState('');
  const [patternType, setPatternType] = useState<'username' | 'password'>('username');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [customPasswordValue, setCustomPasswordValue] = useState('');
  const idCounter = useRef(0);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

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
    fetchPatterns();
  }, []);

  const fetchPatterns = async () => {
    try {
      setShowLoading(true);
      const data = await pppoeService.getPatterns();
      setPatterns(Array.isArray(data) ? data : []);
    } catch (error: any) {
      console.error('Failed to fetch patterns:', error);
      setErrorMessage(error.response?.data?.message || 'Failed to load patterns. Please make sure the database is set up correctly.');
      setShowError(true);
      setTimeout(() => setShowError(false), 4000);
    } finally {
      setShowLoading(false);
    }
  };

  const hasCustomPassword = () => currentSequence.some((item) => item.type === 'custom_password');
  const hasTechInput = () => currentSequence.some((item) => item.type === 'tech_input');

  // Tap-to-add replaces the web drag-and-drop (RN has no HTML5 DnD). Exclusivity
  // rules are preserved: custom_password (password) and tech_input (username) are
  // exclusive — selecting one replaces the whole sequence and blocks others.
  const addComponent = (component: { type: string; label: string }) => {
    const newItem: SequenceItem = {
      id: `${++idCounter.current}`,
      type: component.type,
      label: component.label,
      value: component.type === 'custom_password' ? customPasswordValue : undefined,
    };

    if (patternType === 'password') {
      if (hasCustomPassword()) return;
      if (component.type === 'custom_password') {
        setCurrentSequence([newItem]);
        return;
      }
    }
    if (patternType === 'username') {
      if (hasTechInput()) return;
      if (component.type === 'tech_input') {
        setCurrentSequence([newItem]);
        return;
      }
    }
    setCurrentSequence((prev) => [...prev, newItem]);
  };

  const removeFromSequence = (id: string) => {
    setCurrentSequence((prev) => prev.filter((item) => item.id !== id));
  };

  const updateCustomPasswordValue = (value: string) => {
    setCustomPasswordValue(value);
    setCurrentSequence((prev) => prev.map((item) => (item.type === 'custom_password' ? { ...item, value } : item)));
  };

  const flashError = (msg: string, ms = 3000) => {
    setErrorMessage(msg);
    setShowError(true);
    setTimeout(() => setShowError(false), ms);
  };

  const handleSave = async () => {
    if (!patternName.trim()) return flashError('Please enter a pattern name', 2000);
    if (currentSequence.length === 0) return flashError('Please add at least one component to the sequence', 2000);
    if (hasCustomPassword() && !customPasswordValue.trim()) return flashError('Please enter a custom password value', 2000);

    try {
      setShowLoading(true);

      let currentUserEmail = '';
      try {
        const authData = await AsyncStorage.getItem('authData');
        if (authData) {
          const userData = JSON.parse(authData);
          currentUserEmail = userData.email || userData.email_address || '';
        }
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }

      if (!currentUserEmail) {
        setShowLoading(false);
        return flashError('User session not found or invalid. Please re-login to perform this action.');
      }

      const payload = {
        pattern_name: patternName,
        pattern_type: patternType,
        sequence: currentSequence,
        created_by: currentUserEmail,
        updated_by: currentUserEmail,
      };

      const response = await pppoeService.savePattern(payload);

      if (response.action === 'updated') {
        setMessage(`${patternType} pattern updated successfully`);
        setPatterns((prev) => prev.map((p) => (p.pattern_type === patternType ? response.data : p)));
      } else {
        setMessage(`${patternType} pattern created successfully`);
        setPatterns((prev) => [...prev.filter((p) => p.pattern_type !== patternType), response.data]);
      }

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
      setIsEditing(false);
      setCurrentSequence([]);
      setPatternName('');
      setPatternType('username');
      setCustomPasswordValue('');
    } catch (error: any) {
      console.error('Failed to save pattern:', error);
      flashError(error.response?.data?.message || 'Failed to save pattern');
    } finally {
      setShowLoading(false);
    }
  };

  const handleEdit = (pattern: UsernamePattern) => {
    setPatternName(pattern.pattern_name);
    setPatternType(pattern.pattern_type as 'username' | 'password');
    setCurrentSequence(Array.isArray(pattern.sequence) ? pattern.sequence : []);
    const customPwdItem = (pattern.sequence || []).find((item) => item.type === 'custom_password');
    if (customPwdItem?.value) setCustomPasswordValue(customPwdItem.value);
    setIsEditing(true);
  };

  const handleDelete = (id: number, type: string) => {
    Alert.alert('Delete Pattern', `Are you sure you want to delete this ${type} pattern?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await pppoeService.deletePattern(id);
            setPatterns((prev) => prev.filter((p) => p.id !== id));
            setMessage('Pattern deleted successfully');
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 2000);
          } catch (error) {
            console.error('Failed to delete pattern:', error);
            flashError('Failed to delete pattern');
          }
        },
      },
    ]);
  };

  const handleNewPattern = () => {
    setIsEditing(true);
    setCurrentSequence([]);
    setPatternName('');
    setPatternType('username');
    setCustomPasswordValue('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setCurrentSequence([]);
    setPatternName('');
    setPatternType('username');
    setCustomPasswordValue('');
  };

  const getPreviewText = (sequence: SequenceItem[]) =>
    (Array.isArray(sequence) ? sequence : [])
      .map((item) => {
        if (item.type === 'custom_password' && item.value) return item.value;
        if (item.type === 'tech_input') return '[Manual Input]';
        return `[${item.label}]`;
      })
      .join('');

  const getAvailableComponents = () => (patternType === 'username' ? usernameComponents : passwordComponents);

  const isComponentDisabled = (componentType: string) => {
    if (patternType === 'password') return hasCustomPassword();
    if (patternType === 'username') return hasTechInput();
    return false;
  };

  const usernamePattern = patterns.find((p) => p.pattern_type === 'username');
  const passwordPattern = patterns.find((p) => p.pattern_type === 'password');

  const fmt = (value?: string) => {
    if (!value) return 'N/A';
    try {
      return new Date(value)
        .toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
        .replace(',', '');
    } catch {
      return value;
    }
  };

  const renderPatternCard = (title: string, pattern: UsernamePattern | undefined, typeKey: string) => (
    <View style={{ backgroundColor: '#ffffff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#e5e7eb' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>{title}</Text>
        {!!pattern && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={() => handleEdit(pattern)}>
              <Edit2 size={16} color="#2563eb" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDelete(pattern.id, typeKey)}>
              <Trash2 size={16} color="#dc2626" />
            </TouchableOpacity>
          </View>
        )}
      </View>
      {pattern ? (
        <View>
          <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>{pattern.pattern_name}</Text>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 13, color: '#15803d' }}>{getPreviewText(pattern.sequence)}</Text>
          </View>
          <View style={{ marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6', gap: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#9ca3af' }}>Updated By</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#111827' }}>{pattern.updated_by || 'ADMIN'}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#9ca3af' }}>Updated At</Text>
              <Text style={{ fontSize: 10, color: '#6b7280' }}>{fmt(pattern.updated_at)}</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <Text style={{ color: '#9ca3af' }}>No {typeKey} pattern configured</Text>
          <Text style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Tap "Create/Edit Pattern" to set up</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#f9fafb' }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 56 }}>
        {/* Header */}
        <View style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Router size={22} color={primaryColor} />
            <Text style={{ fontSize: 20, fontWeight: '600', color: '#111827' }}>PPPoE Setup — Pattern Builder</Text>
          </View>
          <Text style={{ fontSize: 13, color: '#6b7280' }}>Tap components to add them to a username or password pattern</Text>
        </View>

        {!isEditing ? (
          <View style={{ gap: 16 }}>
            <TouchableOpacity onPress={handleNewPattern} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor }}>
              <Plus size={18} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontWeight: '500' }}>Create/Edit Pattern</Text>
            </TouchableOpacity>
            {renderPatternCard('Username Pattern', usernamePattern, 'username')}
            {renderPatternCard('Password Pattern', passwordPattern, 'password')}
          </View>
        ) : (
          <View style={{ backgroundColor: '#ffffff', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#e5e7eb', gap: 16 }}>
            {/* Pattern type + name */}
            <View style={{ gap: 12 }}>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
                  Pattern Type <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
                  <Picker
                    selectedValue={patternType}
                    onValueChange={(v) => {
                      setPatternType(v as 'username' | 'password');
                      setCurrentSequence([]);
                      setCustomPasswordValue('');
                    }}
                    style={{ color: '#111827' }}
                    dropdownIconColor="#6b7280"
                  >
                    <Picker.Item label="Username" value="username" />
                    <Picker.Item label="Password" value="password" />
                  </Picker>
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6 }}>
                  Pattern Name <Text style={{ color: '#ef4444' }}>*</Text>
                </Text>
                <TextInput
                  value={patternName}
                  onChangeText={setPatternName}
                  placeholder={`Enter ${patternType} pattern name...`}
                  placeholderTextColor="#9ca3af"
                  style={{ width: '100%', paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#ffffff', color: '#111827' }}
                />
              </View>
            </View>

            {/* Available components */}
            <View>
              <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>Available Components (tap to add)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {getAvailableComponents().map((component) => {
                  const disabled = isComponentDisabled(component.type) && !(component.type === 'custom_password' || component.type === 'tech_input');
                  const exclusiveActive = isComponentDisabled(component.type);
                  const isDisabled = exclusiveActive;
                  return (
                    <TouchableOpacity
                      key={component.type}
                      disabled={isDisabled}
                      onPress={() => addComponent(component)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1.5,
                        borderStyle: 'dashed',
                        borderColor: '#d1d5db',
                        backgroundColor: isDisabled ? '#e5e7eb' : '#f9fafb',
                        opacity: isDisabled ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 13, color: isDisabled ? '#9ca3af' : '#374151' }}>{component.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Sequence */}
            <View>
              <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 }}>
                {patternType === 'username' ? 'Username' : 'Password'} Sequence
              </Text>
              <View style={{ minHeight: 96, padding: 12, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#d1d5db', backgroundColor: '#f9fafb' }}>
                {currentSequence.length === 0 ? (
                  <Text style={{ textAlign: 'center', paddingVertical: 24, color: '#9ca3af' }}>
                    Tap components above to build your {patternType} pattern
                  </Text>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {currentSequence.map((item) => (
                      <View key={item.id} style={{ width: item.type === 'custom_password' ? '100%' : undefined }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 8,
                            alignSelf: 'flex-start',
                            backgroundColor:
                              item.type === 'custom_password' ? '#f3e8ff' : item.type === 'tech_input' ? '#ffedd5' : '#dbeafe',
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: '500', color: item.type === 'custom_password' ? '#6b21a8' : item.type === 'tech_input' ? '#9a3412' : '#1e40af' }}>
                            {item.label}
                          </Text>
                          <TouchableOpacity onPress={() => removeFromSequence(item.id)}>
                            <X size={14} color="#6b7280" />
                          </TouchableOpacity>
                        </View>
                        {item.type === 'custom_password' && (
                          <TextInput
                            value={customPasswordValue}
                            onChangeText={updateCustomPasswordValue}
                            placeholder="Enter custom password..."
                            placeholderTextColor="#9ca3af"
                            style={{ marginTop: 8, width: '100%', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#ffffff', color: '#111827' }}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>

              {currentSequence.length > 0 && (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Preview</Text>
                  <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#f3f4f6' }}>
                    <Text style={{ fontFamily: 'monospace', fontSize: 13, color: '#15803d' }}>{getPreviewText(currentSequence)}</Text>
                  </View>
                </View>
              )}
            </View>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={handleSave} disabled={showLoading} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: primaryColor, opacity: showLoading ? 0.5 : 1 }}>
                {showLoading ? <ActivityIndicator size="small" color="#ffffff" /> : <Save size={18} color="#ffffff" />}
                <Text style={{ color: '#ffffff', fontWeight: '500' }}>Save Pattern</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCancel} disabled={showLoading} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
                <Text style={{ color: '#111827' }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Success toast */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end', padding: 16 }} pointerEvents="box-none">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#ffffff', borderRadius: 8, padding: 16, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
            <CheckCircle size={20} color="#22c55e" />
            <Text style={{ fontWeight: '500', color: '#111827' }}>{message}</Text>
          </View>
        </View>
      </Modal>

      {/* Error modal */}
      <Modal visible={showError} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, alignItems: 'center', gap: 12, maxWidth: 360 }}>
            <X size={48} color="#ef4444" />
            <Text style={{ fontWeight: '500', fontSize: 16, color: '#111827', textAlign: 'center' }}>{errorMessage}</Text>
          </View>
        </View>
      </Modal>

      {/* Loading overlay */}
      <Modal visible={showLoading} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, alignItems: 'center', gap: 12 }}>
            <ActivityIndicator size="large" color={primaryColor} />
            <Text style={{ fontWeight: '500', fontSize: 16, color: '#111827' }}>Please wait...</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default PPPoESetup;

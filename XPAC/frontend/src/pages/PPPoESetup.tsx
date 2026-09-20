import React, { useState, useEffect } from 'react';
import { Save, Edit2, Trash2, GripVertical, Plus, X, Router, Loader2, CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { pppoeService, UsernamePattern, SequenceItem } from '../services/pppoeService';
import { usePageActions } from '../hooks/usePageActions';

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
  { type: 'date_installed', label: 'Date Installed' },
  { type: 'tech_input', label: 'Tech Input' }
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
  { type: 'custom_password', label: 'Custom Password' }
];

const PPPoESetup: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('pppoe-setup');

  const [patterns, setPatterns] = useState<UsernamePattern[]>([]);
  const [currentSequence, setCurrentSequence] = useState<SequenceItem[]>([]);
  const [draggedItem, setDraggedItem] = useState<SequenceItem | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [patternName, setPatternName] = useState('');
  const [patternType, setPatternType] = useState<'username' | 'password'>('username');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [customPasswordValue, setCustomPasswordValue] = useState('');

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
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
    fetchPatterns();
  }, []);

  const fetchPatterns = async () => {
    try {
      setShowLoading(true);
      const data = await pppoeService.getPatterns();
      setPatterns(data);
    } catch (error: any) {
      console.error('Failed to fetch patterns:', error);
      setErrorMessage(error.response?.data?.message || 'Failed to load patterns. Please make sure the database is set up correctly.');
      setShowError(true);
      setTimeout(() => setShowError(false), 4000);
    } finally {
      setShowLoading(false);
    }
  };

  const hasCustomPassword = () => {
    return currentSequence.some(item => item.type === 'custom_password');
  };

  const hasTechInput = () => {
    return currentSequence.some(item => item.type === 'tech_input');
  };

  const handleDragStart = (item: SequenceItem | { type: string; label: string }) => {
    if (patternType === 'password' && item.type === 'custom_password' && hasCustomPassword()) {
      return;
    }

    if (patternType === 'password' && hasCustomPassword() && item.type !== 'custom_password') {
      return;
    }

    if (patternType === 'username' && item.type === 'tech_input' && hasTechInput()) {
      return;
    }

    if (patternType === 'username' && hasTechInput() && item.type !== 'tech_input') {
      return;
    }

    const dragItem: SequenceItem = 'id' in item ? item : {
      id: Date.now().toString(),
      type: item.type,
      label: item.label,
      value: item.type === 'custom_password' ? customPasswordValue : undefined
    };
    setDraggedItem(dragItem);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex?: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    if (patternType === 'password' && draggedItem.type === 'custom_password') {
      if (hasCustomPassword()) return;
      setCurrentSequence([draggedItem]);
      setDraggedItem(null);
      return;
    }

    if (patternType === 'password' && hasCustomPassword()) {
      return;
    }

    if (patternType === 'username' && draggedItem.type === 'tech_input') {
      if (hasTechInput()) return;
      setCurrentSequence([draggedItem]);
      setDraggedItem(null);
      return;
    }

    if (patternType === 'username' && hasTechInput()) {
      return;
    }

    const newSequence = [...currentSequence];
    const existingIndex = newSequence.findIndex(item => item.id === draggedItem.id);

    if (existingIndex !== -1) {
      newSequence.splice(existingIndex, 1);
    }

    if (targetIndex !== undefined) {
      newSequence.splice(targetIndex, 0, draggedItem);
    } else {
      newSequence.push(draggedItem);
    }

    setCurrentSequence(newSequence);
    setDraggedItem(null);
  };

  const removeFromSequence = (id: string) => {
    setCurrentSequence(prev => prev.filter(item => item.id !== id));
  };

  const updateCustomPasswordValue = (value: string) => {
    setCustomPasswordValue(value);
    setCurrentSequence(prev => prev.map(item =>
      item.type === 'custom_password' ? { ...item, value } : item
    ));
  };

  const handleSave = async () => {
    if (!patternName.trim()) {
      setErrorMessage('Please enter a pattern name');
      setShowError(true);
      setTimeout(() => setShowError(false), 2000);
      return;
    }

    if (currentSequence.length === 0) {
      setErrorMessage('Please add at least one component to the sequence');
      setShowError(true);
      setTimeout(() => setShowError(false), 2000);
      return;
    }

    if (hasCustomPassword() && !customPasswordValue.trim()) {
      setErrorMessage('Please enter a custom password value');
      setShowError(true);
      setTimeout(() => setShowError(false), 2000);
      return;
    }

    try {
      setShowLoading(true);

      const authData = localStorage.getItem('authData');
      let currentUserEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          currentUserEmail = userData.email || userData.email_address || '';
        } catch (error) {
          console.error('Error parsing auth data:', error);
        }
      }

      if (!currentUserEmail) {
        setErrorMessage('User session not found or invalid. Please re-login to perform this action.');
        setShowError(true);
        setTimeout(() => setShowError(false), 3000);
        setShowLoading(false);
        return;
      }

      const payload = {
        pattern_name: patternName,
        pattern_type: patternType,
        sequence: currentSequence,
        created_by: currentUserEmail,
        updated_by: currentUserEmail
      };

      const response = await pppoeService.savePattern(payload);

      if (response.action === 'updated') {
        setMessage(`${patternType} pattern updated successfully`);
        setPatterns(prev => prev.map(p =>
          p.pattern_type === patternType ? response.data : p
        ));
      } else {
        setMessage(`${patternType} pattern created successfully`);
        setPatterns(prev => [...prev.filter(p => p.pattern_type !== patternType), response.data]);
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
      setErrorMessage(error.response?.data?.message || 'Failed to save pattern');
      setShowError(true);
      setTimeout(() => setShowError(false), 3000);
    } finally {
      setShowLoading(false);
    }
  };

  const handleEdit = (pattern: UsernamePattern) => {
    if (!actions.canEdit) return;
    setPatternName(pattern.pattern_name);
    setPatternType(pattern.pattern_type as 'username' | 'password');
    setCurrentSequence(pattern.sequence);

    const customPwdItem = pattern.sequence.find(item => item.type === 'custom_password');
    if (customPwdItem?.value) {
      setCustomPasswordValue(customPwdItem.value);
    }

    setIsEditing(true);
  };

  const handleDelete = async (id: number, type: string) => {
    if (!actions.canDelete) return;
    if (!window.confirm(`Are you sure you want to delete this ${type} pattern?`)) return;

    try {
      await pppoeService.deletePattern(id);
      setPatterns(prev => prev.filter(p => p.id !== id));
      setMessage('Pattern deleted successfully');
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error('Failed to delete pattern:', error);
      setErrorMessage('Failed to delete pattern');
      setShowError(true);
      setTimeout(() => setShowError(false), 3000);
    }
  };

  const handleNewPattern = () => {
    if (!actions.canCreate) return;
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

  const getPreviewText = (sequence: SequenceItem[]) => {
    return sequence.map(item => {
      if (item.type === 'custom_password' && item.value) {
        return item.value;
      }
      if (item.type === 'tech_input') {
        return '[Manual Input]';
      }
      return `[${item.label}]`;
    }).join('');
  };

  const getAvailableComponents = () => {
    return patternType === 'username' ? usernameComponents : passwordComponents;
  };

  const isComponentDisabled = (componentType: string) => {
    if (patternType === 'password') {
      const hasCustomPwd = hasCustomPassword();

      if (componentType === 'custom_password') {
        return hasCustomPwd;
      }

      return hasCustomPwd;
    }

    if (patternType === 'username') {
      const hasTechInp = hasTechInput();

      if (componentType === 'tech_input') {
        return hasTechInp;
      }

      return hasTechInp;
    }

    return false;
  };

  const usernamePattern = patterns.find(p => p.pattern_type === 'username');
  const passwordPattern = patterns.find(p => p.pattern_type === 'password');

  return (
    <div className={`p-6 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'} min-h-screen`}>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Router className="h-6 w-6" style={{ color: colorPalette?.primary || '#7c3aed' }} />
          <h1 className={`text-2xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            PPPoE Setup - Pattern Builder
          </h1>
        </div>
        <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          Create username and password patterns by dragging and dropping components
        </p>
      </div>

      {!isEditing ? (
        <div>
          <div className="mb-4">
            {actions.canCreate && (
            <button
              onClick={handleNewPattern}
              className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
              style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
            >
              <Plus className="h-5 w-5" />
              Create/Edit Pattern
            </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-6`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Username Pattern
                </h2>
                {usernamePattern && (
                  <div className="flex gap-2">
                    {actions.canEdit && (
                    <button
                      onClick={() => handleEdit(usernamePattern)}
                      className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-900'}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    )}
                    {actions.canDelete && (
                    <button
                      onClick={() => handleDelete(usernamePattern.id, 'username')}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                )}
              </div>

              {usernamePattern ? (
                <div>
                  <div className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {usernamePattern.pattern_name}
                  </div>
                  <code className={`block px-4 py-3 rounded-lg font-mono text-sm ${isDarkMode ? 'bg-gray-700 text-green-400' : 'bg-gray-100 text-green-700'
                    }`}>
                    {getPreviewText(usernamePattern.sequence)}
                  </code>

                  <div className={`mt-5 pt-3 border-t ${isDarkMode ? 'border-gray-700/50' : 'border-gray-100'} space-y-1.5`}>
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tight">
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>Last Updated By:</span>
                      <span className={isDarkMode ? 'text-white' : 'text-black'}>
                        {usernamePattern.updated_by || 'ADMIN'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tight">
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>Updated At:</span>
                      <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                        {usernamePattern.updated_at ? new Date(usernamePattern.updated_at).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        }).replace(',', '') : 'N/A'}
                      </span>
                    </div>
                    
                    <div className={`pt-2 flex flex-col gap-0.5 border-t border-dashed ${isDarkMode ? 'border-gray-700' : 'border-gray-50'}`}>
                      <div className="flex justify-between text-[9px] uppercase font-medium tracking-wider opacity-60">
                        <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Created By: {usernamePattern.created_by || 'SYSTEM'}</span>
                        <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                        {usernamePattern.created_at ? new Date(usernamePattern.created_at).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        }).replace(',', '') : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  <p>No username pattern configured</p>
                  <p className="text-xs mt-2">Click "Create/Edit Pattern" to set up</p>
                </div>
              )}
            </div>

            <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-6`}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Password Pattern
                </h2>
                {passwordPattern && (
                  <div className="flex gap-2">
                    {actions.canEdit && (
                    <button
                      onClick={() => handleEdit(passwordPattern)}
                      className={`${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-900'}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    )}
                    {actions.canDelete && (
                    <button
                      onClick={() => handleDelete(passwordPattern.id, 'password')}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                )}
              </div>

              {passwordPattern ? (
                <div>
                  <div className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {passwordPattern.pattern_name}
                  </div>
                  <code className={`block px-4 py-3 rounded-lg font-mono text-sm ${isDarkMode ? 'bg-gray-700 text-green-400' : 'bg-gray-100 text-green-700'
                    }`}>
                    {getPreviewText(passwordPattern.sequence)}
                  </code>

                  <div className={`mt-5 pt-3 border-t ${isDarkMode ? 'border-gray-700/50' : 'border-gray-100'} space-y-1.5`}>
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tight">
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>Last Updated By:</span>
                      <span className={isDarkMode ? 'text-white' : 'text-black'}>
                        {passwordPattern.updated_by || 'ADMIN'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-tight">
                      <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>Updated At:</span>
                      <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                        {passwordPattern.updated_at ? new Date(passwordPattern.updated_at).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        }).replace(',', '') : 'N/A'}
                      </span>
                    </div>
                    
                    <div className={`pt-2 flex flex-col gap-0.5 border-t border-dashed ${isDarkMode ? 'border-gray-700' : 'border-gray-50'}`}>
                      <div className="flex justify-between text-[9px] uppercase font-medium tracking-wider opacity-60">
                        <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Created By: {passwordPattern.created_by || 'SYSTEM'}</span>
                        <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                        {passwordPattern.created_at ? new Date(passwordPattern.created_at).toLocaleString('en-US', {
                          month: '2-digit',
                          day: '2-digit',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: true
                        }).replace(',', '') : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  <p>No password pattern configured</p>
                  <p className="text-xs mt-2">Click "Create/Edit Pattern" to set up</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'} rounded-lg shadow-sm p-6`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Pattern Type <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={patternType}
                    onChange={(e) => {
                      setPatternType(e.target.value as 'username' | 'password');
                      setCurrentSequence([]);
                      setCustomPasswordValue('');
                    }}
                    className={`w-full px-4 py-2 border rounded-lg appearance-none ${isDarkMode
                      ? 'bg-gray-700 border-gray-600 text-white'
                      : 'bg-white border-gray-300 text-gray-900'
                      }`}
                  >
                    <option value="username">Username</option>
                    <option value="password">Password</option>
                  </select>
                  <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`} size={20} />
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Pattern Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={patternName}
                  onChange={(e) => setPatternName(e.target.value)}
                  placeholder={`Enter ${patternType} pattern name...`}
                  className={`w-full px-4 py-2 border rounded-lg ${isDarkMode
                    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    }`}
                />
              </div>
            </div>

            <div className="mb-4">
              <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Available Components
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {getAvailableComponents().map((component) => {
                  const disabled = isComponentDisabled(component.type);
                  return (
                    <div
                      key={component.type}
                      draggable={!disabled}
                      onDragStart={() => !disabled && handleDragStart(component)}
                      className={`px-3 py-2 rounded-lg border-2 border-dashed text-center text-sm transition-colors ${disabled
                        ? isDarkMode
                          ? 'bg-gray-800 border-gray-700 text-gray-600 cursor-not-allowed opacity-50'
                          : 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                        : isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 cursor-move'
                          : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100 cursor-move'
                        }`}
                    >
                      <GripVertical className="h-4 w-4 mx-auto mb-1" />
                      {component.label}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {patternType === 'username' ? 'Username' : 'Password'} Sequence (Drag components here)
              </h3>
              <div
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e)}
                className={`min-h-32 p-4 rounded-lg border-2 border-dashed ${isDarkMode
                  ? 'bg-gray-700 border-gray-600'
                  : 'bg-gray-50 border-gray-300'
                  }`}
              >
                {currentSequence.length === 0 ? (
                  <div className={`text-center py-8 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                    Drop components here to build your {patternType} pattern
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {currentSequence.map((item, index) => (
                        <div key={item.id}>
                          <div
                            draggable={item.type !== 'custom_password' && item.type !== 'tech_input'}
                            onDragStart={() => (item.type !== 'custom_password' && item.type !== 'tech_input') && handleDragStart(item)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, index)}
                            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${item.type === 'custom_password'
                              ? isDarkMode
                                ? 'bg-purple-900 text-white'
                                : 'bg-purple-100 text-purple-900'
                              : item.type === 'tech_input'
                                ? isDarkMode
                                  ? 'bg-orange-900 text-white'
                                  : 'bg-orange-100 text-orange-900'
                                : isDarkMode
                                  ? 'bg-gray-600 text-white cursor-move'
                                  : 'bg-blue-100 text-blue-900 cursor-move'
                              }`}
                          >
                            {(item.type !== 'custom_password' && item.type !== 'tech_input') && <GripVertical className="h-4 w-4" />}
                            <span className="text-sm font-medium">{item.label}</span>
                            <button
                              onClick={() => removeFromSequence(item.id)}
                              className="ml-1 hover:text-red-500"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          {item.type === 'custom_password' && (
                            <div className="mt-2">
                              <input
                                type="text"
                                value={customPasswordValue}
                                onChange={(e) => updateCustomPasswordValue(e.target.value)}
                                placeholder="Enter custom password..."
                                className={`w-full px-3 py-2 border rounded-lg ${isDarkMode
                                  ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400'
                                  : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                                  }`}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {currentSequence.length > 0 && (
                <div className="mt-4">
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                    Preview
                  </label>
                  <div className={`px-4 py-3 rounded-lg font-mono text-sm ${isDarkMode ? 'bg-gray-700 text-green-400' : 'bg-gray-100 text-green-700'
                    }`}>
                    {getPreviewText(currentSequence)}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSave}
                disabled={showLoading}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                {showLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Save className="h-5 w-5" />
                )}
                Save Pattern
              </button>
              <button
                onClick={handleCancel}
                disabled={showLoading}
                className={`px-4 py-2 rounded-lg transition-colors disabled:opacity-50 ${isDarkMode
                  ? 'bg-gray-700 text-white hover:bg-gray-600'
                  : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                  }`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="fixed bottom-4 right-4 z-50">
          <div className={`${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
            } rounded-lg shadow-lg p-4 flex items-center gap-3`}>
            <CheckCircle className="h-5 w-5 text-green-500" />
            <p className="font-medium">{message}</p>
          </div>
        </div>
      )}

      {showError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'
            } rounded-lg p-8 flex flex-col items-center gap-4`}>
            <XCircle className="h-16 w-16 text-red-500" />
            <p className={`font-medium text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{errorMessage}</p>
          </div>
        </div>
      )}

      {showLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-white'
            } rounded-lg p-8 flex flex-col items-center gap-4`}>
            <Loader2 className="h-16 w-16 animate-spin" style={{ color: colorPalette?.primary || '#7c3aed' }} />
            <p className={`font-medium text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Saving pattern...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PPPoESetup;

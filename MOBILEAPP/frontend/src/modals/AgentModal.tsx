import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Agent } from '../types/api';
import { agentService } from '../services/agentService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (agent: Agent) => void;
  agent?: Agent | null;
}

const AgentForm: React.FC<{
  formData: { team_name: string };
  handleInputChange: (name: string, value: string) => void;
  errors: Record<string, string>;
}> = ({ formData, handleInputChange, errors }) => {
  const { isDarkMode } = useModalTheme();

  const labelColor = isDarkMode ? '#9ca3af' : '#6b7280';
  const inputBg = isDarkMode ? '#1f2937' : '#ffffff';
  const inputText = isDarkMode ? '#ffffff' : '#111827';
  const borderColor = (error?: string) =>
    error ? '#ef4444' : isDarkMode ? '#374151' : '#e5e7eb';

  return (
    <View style={{ gap: 24 }}>
      {errors.general ? (
        <View
          style={{
            padding: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isDarkMode ? 'rgba(153,27,27,0.3)' : '#fecaca',
            backgroundColor: isDarkMode ? 'rgba(127,29,29,0.2)' : '#fef2f2',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '500', color: isDarkMode ? '#f87171' : '#dc2626' }}>
            {errors.general}
          </Text>
        </View>
      ) : null}

      <View>
        <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
          Team Name
        </Text>
        <TextInput
          value={formData.team_name}
          onChangeText={(text) => handleInputChange('team_name', text)}
          placeholder="Enter team name"
          placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
          style={{
            width: '100%',
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: borderColor(errors.team_name),
            backgroundColor: inputBg,
            color: inputText,
            fontSize: 14,
          }}
        />
        {errors.team_name ? (
          <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6, marginLeft: 4, fontWeight: '500' }}>
            {errors.team_name}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const AgentModal: React.FC<AgentModalProps> = ({ isOpen, onClose, onSave, agent }) => {
  const isEditMode = !!agent;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    team_name: '',
  });

  useEffect(() => {
    if (isOpen) {
      if (agent) {
        setFormData({ team_name: agent.team_name || '' });
      } else {
        setFormData({ team_name: '' });
      }
      setErrors({});
    }
  }, [isOpen, agent]);

  const handleInputChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.team_name.trim()) newErrors.team_name = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getUserEmail = async (): Promise<string> => {
    try {
      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        const user = JSON.parse(authData);
        return user.email || user.email_address || 'system';
      }
    } catch (e) {
      console.error('Error getting user email:', e);
    }
    return 'system';
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const userEmail = await getUserEmail();
      const payload = {
        ...formData,
        created_by: userEmail,
      };

      let response: any;
      if (isEditMode && agent) {
        response = await agentService.updateAgent(agent.id, payload);
      } else {
        response = await agentService.createAgent(payload as Omit<Agent, 'id' | 'created_at'>);
      }

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        setErrors({ general: response.message || 'Action failed' });
      }
    } catch (err: any) {
      setErrors({ general: err.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Agent' : 'Add New Agent'}
      loading={loading}
      maxWidth="max-w-md"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading,
      }}
    >
      <AgentForm formData={formData} handleInputChange={handleInputChange} errors={errors} />
    </ModalUITemplate>
  );
};

export default AgentModal;

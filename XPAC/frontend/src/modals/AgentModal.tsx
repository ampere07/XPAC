import React, { useState, useEffect } from 'react';
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
  formData: any;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  errors: Record<string, string>;
}> = ({ formData, handleInputChange, errors }) => {
  const { isDarkMode } = useModalTheme();

  const inputClass = (error?: string) => `w-full px-4 py-2.5 rounded-lg border transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50 
    ${isDarkMode
      ? `bg-gray-800 text-white ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-700 focus:ring-blue-500/20'}`
      : `bg-white text-gray-900 ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:ring-blue-500/20'}`
    }`;

  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

  return (
    <div className="space-y-6">
      {errors.general && (
        <div className={`p-4 border rounded-xl text-sm font-medium ${isDarkMode ? 'bg-red-900/20 border-red-800/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {errors.general}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={labelClass}>Team Name</label>
          <input
            name="team_name"
            value={formData.team_name}
            onChange={handleInputChange}
            className={inputClass(errors.team_name)}
            placeholder="Enter team name"
          />
          {errors.team_name && <p className="text-red-500 text-xs mt-1.5 font-medium ml-1">{errors.team_name}</p>}
        </div>
      </div>
    </div>
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
        setFormData({
          team_name: agent.team_name || '',
        });
      } else {
        setFormData({
          team_name: '',
        });
      }
      setErrors({});
    }
  }, [isOpen, agent]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.team_name.trim()) newErrors.team_name = 'Required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getUserEmail = () => {
    try {
      const authData = localStorage.getItem('authData');
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
      const userEmail = getUserEmail();
      const payload = {
        ...formData,
        created_by: userEmail
      };

      let response: any;
      if (isEditMode && agent) {
        response = await agentService.updateAgent(agent.id, payload);
      } else {
        response = await agentService.createAgent(payload);
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
        disabled: loading
      }}
    >
      <AgentForm
        formData={formData}
        handleInputChange={handleInputChange}
        errors={errors}
      />
    </ModalUITemplate>
  );
};

export default AgentModal;

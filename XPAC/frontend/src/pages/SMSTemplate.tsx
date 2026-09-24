import React, { useState, useEffect } from 'react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { MessageSquare, Plus, Edit2, Trash2, Save, X, Eye, EyeOff } from 'lucide-react';
import { usePageActions } from '../hooks/usePageActions';

interface SMSTemplateData {
  id: number;
  template_name: string;
  template_type: string;
  message_content: string;
  variables: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

interface SMSTemplateResponse {
  success: boolean;
  data: SMSTemplateData[];
  count: number;
  message?: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const SMSTemplate: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('sms-template');

  const [templates, setTemplates] = useState<SMSTemplateData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});

  const [formData, setFormData] = useState({
    template_name: '',
    template_type: '',
    message_content: '',
    is_active: true
  });

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<SMSTemplateResponse>('/sms-templates');
      if (response.data.success && response.data.data) {
        setTemplates(response.data.data);
      } else {
        setTemplates([]);
      }
    } catch (error) {
      console.error('Error fetching SMS templates:', error);
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

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
    fetchTemplates();
  }, []);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const resetForm = () => {
    setFormData({
      template_name: '',
      template_type: '',
      message_content: '',
      is_active: true
    });
    setEditingId(null);
    setIsCreating(false);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      }).replace(',', '');
    } catch (e) {
      return dateString;
    }
  };

  const handleCreate = () => {
    if (!actions.canCreate) return;
    setFormData({
      template_name: '',
      template_type: '',
      message_content: '',
      is_active: true
    });
    setEditingId(null);
    setIsCreating(true);
  };

  const handleEdit = (template: SMSTemplateData) => {
    if (!actions.canEdit) return;
    setFormData({
      template_name: template.template_name,
      template_type: template.template_type,
      message_content: template.message_content,
      is_active: template.is_active
    });
    setEditingId(template.id);
    setIsCreating(false);
  };

  const handleSave = async () => {
    try {
      const variablesInMessage = formData.message_content.match(/\{\{[^}]+\}\}/g) || [];
      const uniqueVariables = Array.from(new Set(variablesInMessage));

      const authData = localStorage.getItem('authData');
      let userEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.user?.email || '';
        } catch (error) {
          console.error('Error parsing auth data:', error);
        }
      }

      const dataToSave: any = {
        ...formData,
        variables: uniqueVariables,
        updated_by: userEmail
      };

      if (isCreating) {
        dataToSave.created_by = userEmail;
        await apiClient.post('/sms-templates', dataToSave);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'SMS template created successfully'
        });
      } else if (editingId) {
        await apiClient.put(`/sms-templates/${editingId}`, dataToSave);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'SMS template updated successfully'
        });
      }
      resetForm();
      fetchTemplates();
    } catch (error: any) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error.response?.data?.message || 'Failed to save SMS template'
      });
    }
  };

  const handleDelete = (id: number) => {
    if (!actions.canDelete) return;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirm Delete',
      message: 'Are you sure you want to delete this SMS template?',
      onConfirm: () => confirmDelete(id),
      onCancel: () => setModal({ ...modal, isOpen: false })
    });
  };

  const confirmDelete = async (id: number) => {
    try {
      await apiClient.delete(`/sms-templates/${id}`);
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'SMS template deleted successfully'
      });
      fetchTemplates();
    } catch (error: any) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error.response?.data?.message || 'Failed to delete SMS template'
      });
    }
  };

  const toggleRowExpand = (id: number) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const closeModal = () => {
    setModal({ ...modal, isOpen: false });
  };

  const getPrimaryColor = () => {
    return colorPalette?.primary || '#7c3aed';
  };

  const templateTypes = [
    'Overdue',
    'DCNotice',
    'StatementofAccount',
    'Disconnected',
    'Reconnect',
    'Application',
    'Welcome',
    'Paid',
    'Due',
    'PrepaidPreExpiry'
  ];

  const availableVariables = [
    '{{account_no}}',
    '{{customer_name}}',
    '{{amount}}',
    '{{due_date}}',
    '{{balance}}',
    '{{plan_name}}',
    '{{payment_date}}',
    '{{installation_date}}',
    '{{mobile_number}}',
    '{{soa_date}}',
    '{{portal_url}}',
    '{{company_name}}',
    // Substituted by BillingNotificationService for every billing-side template, including the
    // prepaid pre-expiry notice — it just was never listed here to insert.
    '{{payment_link}}'
  ];

  const insertVariable = (variable: string) => {
    const currentContent = formData.message_content;
    const needsSpace = currentContent.length > 0 && currentContent.charAt(currentContent.length - 1) !== ' ';
    const newContent = currentContent + (needsSpace ? ' ' : '') + variable;
    setFormData({ ...formData, message_content: newContent });
  };

  return (
    <div className={`p-6 ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center">
          <MessageSquare className="h-8 w-8 mr-3" style={{ color: getPrimaryColor() }} />
          <h1 className="text-3xl font-bold">SMS Templates</h1>
        </div>
        {actions.canCreate && !isCreating && !editingId && (
          <button
            onClick={handleCreate}
            className="flex items-center px-4 py-2 rounded text-white transition-colors"
            style={{ backgroundColor: getPrimaryColor() }}
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Template
          </button>
        )}
      </div>

      {(isCreating || editingId) && (
        <div className={`mb-6 p-6 rounded-lg border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
          <h2 className="text-xl font-semibold mb-4">
            {isCreating ? 'Create New Template' : 'Edit Template'}
          </h2>

          <div className="mb-4">
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Available Variables
            </label>
            <div className="flex flex-wrap gap-2">
              {availableVariables.map(variable => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => insertVariable(variable)}
                  className={`px-3 py-1 rounded text-xs font-mono transition-colors ${isDarkMode
                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                >
                  {variable}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Template Name
              </label>
              <input
                type="text"
                value={formData.template_name}
                onChange={(e) => setFormData({ ...formData, template_name: e.target.value })}
                className={`w-full px-3 py-2 rounded border ${isDarkMode
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
                placeholder="Enter template name"
              />
            </div>
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Template Type
              </label>
              <select
                value={formData.template_type}
                onChange={(e) => setFormData({ ...formData, template_type: e.target.value })}
                className={`w-full px-3 py-2 rounded border ${isDarkMode
                  ? 'bg-gray-700 border-gray-600 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
              >
                <option value="">Select type</option>
                {templateTypes
                  .filter(type =>
                    formData.template_type === type ||
                    !templates.some(t => t.template_type === type)
                  )
                  .map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Message Content
            </label>
            <textarea
              value={formData.message_content}
              onChange={(e) => setFormData({ ...formData, message_content: e.target.value })}
              className={`w-full px-3 py-2 rounded border ${isDarkMode
                ? 'bg-gray-700 border-gray-600 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
              placeholder="Enter message content. Click variables above to insert them."
              rows={4}
            />
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Click on the variable buttons above to insert them into your message
            </p>
          </div>

          <div className="mb-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="mr-2"
                style={{ accentColor: getPrimaryColor() }}
              />
              <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Active
              </span>
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="flex items-center px-4 py-2 rounded text-white transition-colors"
              style={{ backgroundColor: getPrimaryColor() }}
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </button>
            <button
              onClick={resetForm}
              className={`flex items-center px-4 py-2 rounded border transition-colors ${isDarkMode
                ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
          <p className="mt-2">Loading templates...</p>
        </div>
      ) : (
        <div className={`rounded-lg border ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}>
                <tr>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Template Name
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Type
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Status
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Created Info
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Updated Info
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${isDarkMode ? 'text-gray-300' : 'text-gray-500'
                    }`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDarkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
                {templates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      No SMS templates found
                    </td>
                  </tr>
                ) : (
                  templates.map((template) => (
                    <React.Fragment key={template.id}>
                      <tr className={isDarkMode ? 'bg-gray-800 hover:bg-gray-750' : 'bg-white hover:bg-gray-50'}>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <button
                              onClick={() => toggleRowExpand(template.id)}
                              className={`mr-2 ${isDarkMode ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-900'}`}
                            >
                              {expandedRows[template.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                            <span className="font-medium">{template.template_name}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-700'
                            }`}>
                            {template.template_type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded ${template.is_active
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
                            }`}>
                            {template.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{template.created_by || 'Unknown'}</span>
                            <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{formatDate(template.created_at)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{template.updated_by || 'Unknown'}</span>
                            <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{formatDate(template.updated_at)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-2">
                            {actions.canEdit && (
                            <button
                              onClick={() => handleEdit(template)}
                              className={`p-2 rounded transition-colors ${isDarkMode
                                ? 'text-blue-400 hover:bg-gray-700'
                                : 'text-blue-600 hover:bg-blue-50'
                                }`}
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            )}
                            {actions.canDelete && (
                            <button
                              onClick={() => handleDelete(template.id)}
                              className={`p-2 rounded transition-colors ${isDarkMode
                                ? 'text-red-400 hover:bg-gray-700'
                                : 'text-red-600 hover:bg-red-50'
                                }`}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedRows[template.id] && (
                        <tr className={isDarkMode ? 'bg-gray-750' : 'bg-gray-50'}>
                          <td colSpan={6} className="px-6 py-4">
                            <div className="space-y-2">
                              <div>
                                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                  Message Content:
                                </span>
                                <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {template.message_content}
                                </p>
                              </div>
                              {template.variables && template.variables.length > 0 && (
                                <div>
                                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Variables:
                                  </span>
                                  <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {Array.isArray(template.variables) ? template.variables.join(', ') : template.variables}
                                  </p>
                                </div>
                              )}
                              <div>
                                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                  Last Updated:
                                </span>
                                <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {formatDate(template.updated_at)}
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Created By:
                                  </span>
                                  <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {template.created_by || 'Unknown'}
                                  </p>
                                </div>
                                <div>
                                  <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Last Updated By:
                                  </span>
                                  <p className={`mt-1 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {template.updated_by || 'Unknown'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`rounded-lg p-6 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <h3 className={`text-lg font-semibold mb-2 ${modal.type === 'error' ? 'text-red-600' :
              modal.type === 'warning' ? 'text-yellow-600' :
                modal.type === 'success' ? 'text-green-600' : ''
              }`}>
              {modal.title}
            </h3>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {modal.message}
            </p>
            <div className="flex gap-2 justify-end">
              {modal.type === 'confirm' ? (
                <>
                  <button
                    onClick={modal.onCancel}
                    className={`px-4 py-2 rounded border transition-colors ${isDarkMode
                      ? 'border-gray-600 text-gray-300 hover:bg-gray-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={modal.onConfirm}
                    className="px-4 py-2 rounded text-white transition-colors"
                    style={{ backgroundColor: getPrimaryColor() }}
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={closeModal}
                  className="px-4 py-2 rounded text-white transition-colors"
                  style={{ backgroundColor: getPrimaryColor() }}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SMSTemplate;

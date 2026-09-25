import React, { useState, useEffect, useRef } from 'react';
import { Editor } from '@tinymce/tinymce-react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePageActions } from '../hooks/usePageActions';

interface EmailTemplateData {
  Template_Code: string;
  Subject_Line: string;
  Body_HTML: string;
  Description: string;
  Is_Active: boolean;
  email_body: string;
  cc: string;
  bcc: string;
  email_sender: string;
  sender_name: string;
  reply_to: string;
  Page_Margin?: string;
  Image_Margin?: string;
  modified_by?: string;
  modifiet_at?: string;
}

interface EmailTemplateResponse {
  success: boolean;
  data: EmailTemplateData[];
  count: number;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const EmailTemplates: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('email-templates');

  const [templates, setTemplates] = useState<EmailTemplateData[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplateData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [operationLoading, setOperationLoading] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState<boolean>(false);
  const tinymceRef = useRef<any>(null);
  const [paperPadding, setPaperPadding] = useState('1in');
  const [imageMargin, setImageMargin] = useState('0px');
  const [borderModal, setBorderModal] = useState<{
    isOpen: boolean;
    side: 'top' | 'bottom' | 'left' | 'right';
    width: string;
    style: string;
    color: string;
  } | null>(null);
  const targetCellsRef = useRef<any[]>([]);


  const [formData, setFormData] = useState({
    Template_Code: '',
    Subject_Line: '',
    cc: '',
    bcc: '',
    email_sender: '',
    sender_name: '',
    reply_to: '',
    Body_HTML: '',
    Description: '',
    Is_Active: true,
    email_body: '',
    Page_Margin: '1in',
    Image_Margin: '0px'
  });

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
    '{{company_name}}'
  ];

  const insertVariableToBody = (variable: string) => {
    const currentContent = formData.email_body || '';
    const needsSpace = currentContent.length > 0 && currentContent.charAt(currentContent.length - 1) !== ' ';
    const newContent = currentContent + (needsSpace ? ' ' : '') + variable;
    setFormData({ ...formData, email_body: newContent });
  };


  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<EmailTemplateResponse>('/email-templates');
      if (response.data.success && response.data.data) {
        setTemplates(response.data.data);
        if (response.data.data.length > 0 && !selectedTemplate) {
          setSelectedTemplate(response.data.data[0]);
          setFormData({
            Template_Code: response.data.data[0].Template_Code,
            Subject_Line: response.data.data[0].Subject_Line,
            cc: response.data.data[0].cc || '',
            bcc: response.data.data[0].bcc || '',
            email_sender: response.data.data[0].email_sender || '',
            sender_name: response.data.data[0].sender_name || '',
            reply_to: response.data.data[0].reply_to || '',
            Body_HTML: response.data.data[0].Body_HTML,
            Description: response.data.data[0].Description || '',
            Is_Active: response.data.data[0].Is_Active,
            email_body: response.data.data[0].email_body || '',
            Page_Margin: response.data.data[0].Page_Margin || '1in',
            Image_Margin: response.data.data[0].Image_Margin || '0px'
          });
          setPaperPadding(response.data.data[0].Page_Margin || '1in');
          setImageMargin(response.data.data[0].Image_Margin || '0px');
        }
      }
    } catch (error) {
      console.error('Error fetching email templates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleTemplateSelect = (template: EmailTemplateData) => {
    setSelectedTemplate(template);
    setPaperPadding('1in'); // Reset to default when switching
    setFormData({
      Template_Code: template.Template_Code,
      Subject_Line: template.Subject_Line,
      cc: template.cc || '',
      bcc: template.bcc || '',
      email_sender: template.email_sender || '',
      sender_name: template.sender_name || '',
      reply_to: template.reply_to || '',
      Body_HTML: template.Body_HTML,
      Description: template.Description || '',
      Is_Active: template.Is_Active,
      email_body: template.email_body || '',
      Page_Margin: template.Page_Margin || '1in',
      Image_Margin: template.Image_Margin || '0px'
    });
    setPaperPadding(template.Page_Margin || '1in');
    setImageMargin(template.Image_Margin || '0px');
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleStartEdit = () => {
    if (!actions.canEdit) return;
    setIsEditing(true);
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    if (!actions.canCreate) return;
    setIsCreating(true);
    setIsEditing(false);
    setSelectedTemplate(null);
    setFormData({
      Template_Code: '',
      Subject_Line: '',
      cc: '',
      bcc: '',
      email_sender: '',
      sender_name: '',
      reply_to: '',
      Body_HTML: '',
      Description: '',
      Is_Active: true,
      email_body: '',
      Page_Margin: '1in',
      Image_Margin: '0px'
    });
    setPaperPadding('1in');
    setImageMargin('0px');
  };

  const handleSave = async () => {
    try {
      setOperationLoading(true);

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
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Authentication Required',
          message: 'Your user session has expired or is invalid. Please re-login to perform this action.'
        });
        setOperationLoading(false);
        return;
      }

      let currentBodyHtml = formData.Body_HTML;
      if (formData.Template_Code === 'SOA_TEMPLATE' && tinymceRef.current) {
        currentBodyHtml = tinymceRef.current.getContent();
      }

      const payload = {
        ...formData,
        Body_HTML: currentBodyHtml,
        Page_Margin: paperPadding,
        Image_Margin: imageMargin,
        modified_by: currentUserEmail
      };

      if (isCreating) {
        await apiClient.post('/email-templates', payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Email template created successfully'
        });
        setIsCreating(false);
      } else if (selectedTemplate) {
        await apiClient.put(`/email-templates/${selectedTemplate.Template_Code}`, payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Email template updated successfully'
        });
        setIsEditing(false);
      }

      await fetchTemplates();
    } catch (error: any) {
      console.error('Error saving template:', error);
      let errorMessage = error.response?.data?.message || error.message;

      if (error.response?.data?.errors) {
        const validationErrors = Object.values(error.response.data.errors).flat().join('\n');
        errorMessage += `:\n${validationErrors}`;
      }

      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save: ${errorMessage}`
      });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleDelete = async (templateCode: string) => {
    if (!actions.canDelete) return;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Confirm Deletion',
      message: 'Are you sure you want to delete this email template?',
      onConfirm: async () => {
        try {
          setModal({ ...modal, isOpen: false });
          setOperationLoading(true);
          await apiClient.delete(`/email-templates/${templateCode}`);
          setModal({
            isOpen: true,
            type: 'success',
            title: 'Success',
            message: 'Email template deleted successfully'
          });
          setSelectedTemplate(null);
          await fetchTemplates();
        } catch (error: any) {
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Error',
            message: `Failed to delete: ${error.response?.data?.message || error.message}`
          });
        } finally {
          setOperationLoading(false);
        }
      },
      onCancel: () => {
        setModal({ ...modal, isOpen: false });
      }
    });
  };

  const handleCancel = () => {
    if (selectedTemplate) {
      setFormData({
        Template_Code: selectedTemplate.Template_Code,
        Subject_Line: selectedTemplate.Subject_Line,
        cc: selectedTemplate.cc || '',
        bcc: selectedTemplate.bcc || '',
        email_sender: selectedTemplate.email_sender || '',
        sender_name: selectedTemplate.sender_name || '',
        reply_to: selectedTemplate.reply_to || '',
        Body_HTML: selectedTemplate.Body_HTML,
        Description: selectedTemplate.Description || '',
        Is_Active: selectedTemplate.Is_Active,
        email_body: selectedTemplate.email_body || '',
        Page_Margin: selectedTemplate.Page_Margin || '1in',
        Image_Margin: selectedTemplate.Image_Margin || '0px'
      });
      setPaperPadding(selectedTemplate.Page_Margin || '1in');
      setImageMargin(selectedTemplate.Image_Margin || '0px');
    }
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleToggleActive = async (template: EmailTemplateData) => {
    try {
      setOperationLoading(true);

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

      await apiClient.post(`/email-templates/${template.Template_Code}/toggle-active`, {
        modified_by: currentUserEmail
      });
      await fetchTemplates();
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Template status updated successfully'
      });
    } catch (error: any) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to update status: ${error.response?.data?.message || error.message}`
      });
    } finally {
      setOperationLoading(false);
    }
  };

  const insertTag = (tag: string) => {
    if (formData.Template_Code === 'SOA_TEMPLATE' && (isEditing || isCreating) && tinymceRef.current) {
      tinymceRef.current.insertContent(tag);
    } else {
      insertVariableToBody(tag);
    }
  };

  const handleApplyBorder = () => {
    if (!borderModal || !tinymceRef.current) return;

    const { side, width, style, color } = borderModal;
    const editor = tinymceRef.current;

    editor.undoManager.transact(() => {
      const targetCells = targetCellsRef.current.length > 0
        ? targetCellsRef.current
        : [editor.dom.getParent(editor.selection.getStart(), 'td,th')];

      targetCells.forEach((cell: HTMLElement) => {
        if (!cell) return;

        // Ensure we have a reference to the parent table
        const table = editor.dom.getParent(cell, 'table') as HTMLElement | null;

        if (style === 'none') {
          // If the table has a legacy 'border' attribute, it will override cell-level 'none' for edge borders.
          // We convert the table-wide border to individual cell borders to allow specific side removal.
          if (table && table.hasAttribute('border')) {
            table.removeAttribute('border');
            table.style.borderCollapse = 'collapse';

            // Apply a default border to other cells if they don't have one, to maintain the table's look
            const allCells = editor.dom.select('td,th', table);
            allCells.forEach((c: any) => {
              if (!c.style.border && !targetCells.includes(c)) {
                c.style.border = '1px solid black';
              }
            });
          }

          // Directly set individual properties with !important to ensure removal
          // This targets the specific side requested by the user
          cell.style.setProperty(`border-${side}-width`, '0px', 'important');
          cell.style.setProperty(`border-${side}-style`, 'none', 'important');
          cell.style.setProperty(`border-${side}-color`, 'transparent', 'important');

          // Set the shorthand as a final override
          cell.style.setProperty(`border-${side}`, '0px none transparent', 'important');

          // Also remove any legacy attribute from the cell itself
          cell.removeAttribute('border');
        } else {
          // When setting a border, we use the standard helper
          editor.dom.setStyle(cell, `border-${side}`, `${width} ${style} ${color}`);
        }
      });
    });

    setBorderModal(null);
    targetCellsRef.current = [];
  };

  const insertHeader = () => {
    const html = '<img src="https://via.placeholder.com/800x150?text=FULL+BLEED+HEADER" alt="Header" style="width: 100%; height: auto; display: block; margin: 0; border: 0;">';
    if (formData.Template_Code === 'SOA_TEMPLATE' && (isEditing || isCreating) && tinymceRef.current) {
      tinymceRef.current.insertContent(html);
    } else {
      insertVariableToBody(html);
    }
  };

  const insertFooter = () => {
    const html = '<img src="https://via.placeholder.com/800x100?text=FULL+BLEED+FOOTER" alt="Footer" style="width: 100%; height: auto; display: block; margin: 0; border: 0;">';
    if (formData.Template_Code === 'SOA_TEMPLATE' && (isEditing || isCreating) && tinymceRef.current) {
      tinymceRef.current.insertContent(html);
    } else {
      insertVariableToBody(html);
    }
  };

  const canEdit = selectedTemplate && !isCreating;
  const canSave = (isEditing || isCreating);

  return (
    <div className={`flex h-screen ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      {/* Sidebar */}
      <div className={`w-72 border-r overflow-y-auto ${isDarkMode
        ? 'bg-gray-800 border-gray-700'
        : 'bg-white border-gray-300'
        }`}>
        <div className={`p-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
          }`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Email Templates</h2>
            {actions.canCreate && (
            <button
              onClick={handleStartCreate}
              className="px-3 py-1.5 text-white text-sm rounded transition-colors"
              style={{
                backgroundColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
              }}
              disabled={isCreating}
            >
              New
            </button>
            )}
          </div>
        </div>

        {/* Template List */}
        <div className="p-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
            </div>
          ) : (
            templates.map((template) => (
              <div
                key={template.Template_Code}
                onClick={() => handleTemplateSelect(template)}
                className={`p-3 mb-2 rounded cursor-pointer transition-colors ${selectedTemplate?.Template_Code === template.Template_Code
                  ? isDarkMode
                    ? 'bg-opacity-20 border-l-2'
                    : 'border-l-2'
                  : isDarkMode
                    ? 'bg-gray-700 hover:bg-gray-600'
                    : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                style={selectedTemplate?.Template_Code === template.Template_Code ? {
                  backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                  borderColor: colorPalette?.primary || '#7c3aed'
                } : {}}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>{template.Template_Code}</p>
                    <p className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>{template.Subject_Line}</p>
                    {template.modified_by && (
                      <div className="mt-1 flex flex-col gap-0.5">
                        <p className={`text-[9px] uppercase font-bold tracking-tight ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          Last Editor: <span className={isDarkMode ? 'text-white' : 'text-black'}>{template.modified_by}</span>
                        </p>
                        {template.modifiet_at && (
                          <p className={`text-[9px] uppercase font-bold tracking-tight ${isDarkMode ? 'text-gray-600' : 'text-gray-500'}`}>
                            {new Date(template.modifiet_at).toLocaleString('en-US', {
                              month: '2-digit',
                              day: '2-digit',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              second: '2-digit',
                              hour12: true
                            }).replace(',', '')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <span
                      className={`w-2 h-2 rounded-full ${template.Is_Active ? 'bg-green-500' : 'bg-gray-500'
                        }`}
                      title={template.Is_Active ? 'Active' : 'Inactive'}
                    ></span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Variable Tags */}
        <div className={`p-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
          }`}>
          {formData.Template_Code === 'SOA_TEMPLATE' && (
            <>
              <h3 className={`text-xs font-semibold mb-2 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Design Elements</h3>
              <button
                onClick={insertHeader}
                className={`w-full text-left px-2 py-1 mb-1 text-xs rounded transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600'
                  : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                style={{ color: colorPalette?.primary || '#7c3aed' }}
              >
                [+] Header (Full Bleed)
              </button>
              <button
                onClick={insertFooter}
                className={`w-full text-left px-2 py-1 mb-3 text-xs rounded transition-colors ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600'
                  : 'bg-gray-100 hover:bg-gray-200'
                  }`}
                style={{ color: colorPalette?.primary || '#7c3aed' }}
              >
                [+] Footer (Full Bleed)
              </button>

              <h3 className={`text-xs font-semibold mb-2 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Smart Rows</h3>
              {['Row_Discounts', 'Row_Rebates', 'Row_Service', 'Row_Staggered', 'Row_Install'].map(tag => (
                <button
                  key={tag}
                  onClick={() => insertTag(`{{${tag}}}`)}
                  className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-green-500 ${isDarkMode
                    ? 'text-green-400 bg-gray-700 hover:bg-gray-600'
                    : 'text-green-600 bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                  {`{{${tag}}}`}
                </button>
              ))}
            </>
          )}

          {formData.Template_Code === 'SOA_TEMPLATE' && (
            <>
              <h3 className={`text-xs font-semibold mb-2 mt-3 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Others & Basic Charges</h3>
              <div className="mb-2">
                <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`}>Labels (always show):</p>
                <button
                  onClick={() => insertTag('{{Label_Discounts}}')}
                  className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-purple-500 ${isDarkMode
                    ? 'text-purple-400 bg-gray-700 hover:bg-gray-600'
                    : 'text-purple-600 bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                  {'{{Label_Discounts}}'}
                </button>
                <button
                  onClick={() => insertTag('{{Label_Rebates}}')}
                  className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-purple-500 ${isDarkMode
                    ? 'text-purple-400 bg-gray-700 hover:bg-gray-600'
                    : 'text-purple-600 bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                  {'{{Label_Rebates}}'}
                </button>
                <button
                  onClick={() => insertTag('{{Label_Service}}')}
                  className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-purple-500 ${isDarkMode
                    ? 'text-purple-400 bg-gray-700 hover:bg-gray-600'
                    : 'text-purple-600 bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                  {'{{Label_Service}}'}
                </button>
                <button
                  onClick={() => insertTag('{{Label_Staggered}}')}
                  className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-purple-500 ${isDarkMode
                    ? 'text-purple-400 bg-gray-700 hover:bg-gray-600'
                    : 'text-purple-600 bg-gray-100 hover:bg-gray-200'
                    }`}
                >
                  {'{{Label_Staggered}}'}
                </button>
              </div>
              <div className="mb-3">
                <p className={`text-xs mb-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                  }`}>Amounts (always show):</p>
                {['Amount_Discounts', 'Amount_Rebates', 'Amount_Service', 'Amount_Install'].map(tag => (
                  <button
                    key={tag}
                    onClick={() => insertTag(`{{${tag}}}`)}
                    className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 border-yellow-500 ${isDarkMode
                      ? 'text-yellow-400 bg-gray-700 hover:bg-gray-600'
                      : 'text-yellow-600 bg-gray-100 hover:bg-gray-200'
                      }`}
                  >
                    {`{{${tag}}}`}
                  </button>
                ))}
              </div>
            </>
          )}

          <h3 className={`text-xs font-semibold mb-2 mt-3 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Customer</h3>
          {['Full_Name', 'Address', 'Account_No', 'Contact_No', 'Email', 'Plan'].map(tag => (
            <button
              key={tag}
              onClick={() => insertTag(`{{${tag}}}`)}
              className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 transition-colors ${isDarkMode
                ? 'bg-gray-700 hover:bg-gray-600'
                : 'bg-gray-100 hover:bg-gray-200'
                }`}
              style={{
                color: colorPalette?.primary || '#7c3aed',
                borderColor: colorPalette?.primary || '#7c3aed'
              }}
            >
              {`{{${tag}}}`}
            </button>
          ))}

          <h3 className={`text-xs font-semibold mb-2 mt-3 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Financials</h3>
          {['Prev_Balance', 'Monthly_Fee', 'VAT', 'Amount_Due', 'Total_Due'].map(tag => (
            <button
              key={tag}
              onClick={() => insertTag(`{{${tag}}}`)}
              className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 transition-colors ${isDarkMode
                ? 'bg-gray-700 hover:bg-gray-600'
                : 'bg-gray-100 hover:bg-gray-200'
                }`}
              style={{
                color: colorPalette?.primary || '#7c3aed',
                borderColor: colorPalette?.primary || '#7c3aed'
              }}
            >
              {`{{${tag}}}`}
            </button>
          ))}

          <h3 className={`text-xs font-semibold mb-2 mt-3 uppercase ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Global Variables</h3>
          <button
            onClick={() => insertTag('{{portal_url}}')}
            className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 transition-colors ${isDarkMode
              ? 'bg-gray-700 hover:bg-gray-600'
              : 'bg-gray-100 hover:bg-gray-200'
              }`}
            style={{
              color: colorPalette?.primary || '#7c3aed',
              borderColor: colorPalette?.primary || '#7c3aed'
            }}
          >
            {'{{portal_url}}'}
          </button>
          <button
            onClick={() => insertTag('{{company_name}}')}
            className={`w-full text-left px-2 py-1 mb-1 text-xs font-mono rounded border-l-2 transition-colors ${isDarkMode
              ? 'bg-gray-700 hover:bg-gray-600'
              : 'bg-gray-100 hover:bg-gray-200'
              }`}
            style={{
              color: colorPalette?.primary || '#7c3aed',
              borderColor: colorPalette?.primary || '#7c3aed'
            }}
          >
            {'{{company_name}}'}
          </button>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className={`flex-1 flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
        }`}>
        {/* Header */}
        <div className={`border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-white border-gray-300'
          }`}>
          {/* Collapse toggle bar — only shown for SOA_TEMPLATE */}
          {(formData.Template_Code === 'SOA_TEMPLATE' || selectedTemplate?.Template_Code === 'SOA_TEMPLATE') && (
            <div className={`flex items-center justify-between px-4 py-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <span className={`text-xs font-semibold uppercase tracking-wide ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                SOA_TEMPLATE — Header
              </span>
              <button
                onClick={() => setIsHeaderCollapsed(prev => !prev)}
                className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                title={isHeaderCollapsed ? 'Expand header' : 'Collapse header'}
              >
                {isHeaderCollapsed ? (
                  /* ChevronDown */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                ) : (
                  /* ChevronUp */
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                )}
              </button>
            </div>
          )}
          {/* Main header content — hidden when collapsed for SOA_TEMPLATE */}
          {!(isHeaderCollapsed && (formData.Template_Code === 'SOA_TEMPLATE' || selectedTemplate?.Template_Code === 'SOA_TEMPLATE')) && (
            <div className="flex items-center justify-between p-4">
              <div className="flex-1">
                {isCreating || isEditing ? (
                  <div className="space-y-2">
                    <select
                      value={formData.Template_Code}
                      onChange={(e) => handleInputChange('Template_Code', e.target.value)}
                      className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      disabled={!isCreating}
                    >
                      <option value="">Select Template Code</option>
                      {[
                        'WELCOME',
                        'SOA_TEMPLATE',
                        'RECONNECT',
                        'PAID',
                        'OVERDUE_DESIGN',
                        'DISCONNECTED',
                        'DCNOTICE_DESIGN',
                        'APPLICATION'
                      ]
                        .filter(choice =>
                          isEditing ||
                          selectedTemplate?.Template_Code === choice ||
                          !templates.some(t => t.Template_Code === choice)
                        )
                        .map(choice => (
                          <option key={choice} value={choice}>{choice}</option>
                        ))
                      }
                    </select>
                    {/* Warning: Template Code cannot be changed after creation */}
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={formData.Subject_Line}
                        onChange={(e) => handleInputChange('Subject_Line', e.target.value)}
                        placeholder="Subject Line"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                      <input
                        type="text"
                        value={formData.sender_name}
                        onChange={(e) => handleInputChange('sender_name', e.target.value)}
                        placeholder="Sender Name"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={formData.email_sender}
                        onChange={(e) => handleInputChange('email_sender', e.target.value)}
                        placeholder="Email Sender"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                      <input
                        type="text"
                        value={formData.reply_to}
                        onChange={(e) => handleInputChange('reply_to', e.target.value)}
                        placeholder="Reply To"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={formData.cc}
                        onChange={(e) => handleInputChange('cc', e.target.value)}
                        placeholder="CC"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                      <input
                        type="text"
                        value={formData.bcc}
                        onChange={(e) => handleInputChange('bcc', e.target.value)}
                        placeholder="BCC"
                        className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                          ? 'bg-gray-700 border-gray-600 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                    </div>
                    <input
                      type="text"
                      value={formData.Description}
                      onChange={(e) => handleInputChange('Description', e.target.value)}
                      placeholder="Description"
                      className={`w-full px-3 py-2 text-sm border rounded ${isDarkMode
                        ? 'bg-gray-700 border-gray-600 text-white'
                        : 'bg-white border-gray-300 text-gray-900'
                        }`}
                    />

                  </div>
                ) : selectedTemplate ? (
                  <div>
                    <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>{selectedTemplate.Template_Code}</h2>
                    <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>{selectedTemplate.Subject_Line}</p>
                    {selectedTemplate.Description && (
                      <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'
                        }`}>{selectedTemplate.Description}</p>
                    )}
                    {selectedTemplate.modified_by && (
                      <div className="flex gap-4 mt-2 pt-2 border-t border-dashed border-gray-700">
                        <p className={`text-[10px] uppercase font-bold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          Last Modified By: <span className={isDarkMode ? 'text-white' : 'text-black'}>{selectedTemplate.modified_by}</span>
                        </p>
                        {selectedTemplate.modifiet_at && (
                          <p className={`text-[10px] uppercase font-bold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            Modified At: <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                              {new Date(selectedTemplate.modifiet_at).toLocaleString()}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-4 mt-1">
                      {(selectedTemplate.email_sender || selectedTemplate.sender_name) && (
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-semibold">From:</span> {selectedTemplate.sender_name ? `${selectedTemplate.sender_name} <${selectedTemplate.email_sender}>` : selectedTemplate.email_sender}
                        </p>
                      )}
                      {selectedTemplate.reply_to && (
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-semibold">Reply To:</span> {selectedTemplate.reply_to}
                        </p>
                      )}
                      {selectedTemplate.cc && (
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-semibold">CC:</span> {selectedTemplate.cc}
                        </p>
                      )}
                      {selectedTemplate.bcc && (
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          <span className="font-semibold">BCC:</span> {selectedTemplate.bcc}
                        </p>
                      )}
                    </div>
                    {selectedTemplate.email_body && (
                      <p className={`text-xs mt-1 italic ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>Preview: {selectedTemplate.email_body}</p>
                    )}
                  </div>
                ) : (
                  <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Select a template or create a new one</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {canSave && (
                  <>
                    <button
                      onClick={handleSave}
                      className="px-4 py-2 text-white text-sm rounded transition-colors"
                      style={{
                        backgroundColor: colorPalette?.primary || '#7c3aed'
                      }}
                      onMouseEnter={(e) => {
                        if (colorPalette?.accent) {
                          e.currentTarget.style.backgroundColor = colorPalette.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancel}
                      className={`px-4 py-2 text-white text-sm rounded transition-colors ${isDarkMode
                        ? 'bg-gray-700 hover:bg-gray-600'
                        : 'bg-gray-300 hover:bg-gray-400'
                        }`}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {canEdit && !isEditing && (
                  <>
                    {actions.canEdit && (
                    <button
                      onClick={handleStartEdit}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                    >
                      Edit
                    </button>
                    )}
                    <button
                      onClick={() => selectedTemplate && handleToggleActive(selectedTemplate)}
                      className={`px-4 py-2 text-white text-sm rounded transition-colors ${selectedTemplate?.Is_Active
                        ? 'bg-yellow-600 hover:bg-yellow-700'
                        : 'bg-green-600 hover:bg-green-700'
                        }`}
                    >
                      {selectedTemplate?.Is_Active ? 'Deactivate' : 'Activate'}
                    </button>
                    {actions.canDelete && (
                    <button
                      onClick={() => selectedTemplate && handleDelete(selectedTemplate.Template_Code)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
                    >
                      Delete
                    </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-auto p-4">
          {(selectedTemplate || isCreating) ? (
            <div className="max-w-5xl mx-auto h-full flex flex-col">
              {formData.Template_Code === 'SOA_TEMPLATE' ? (
                <div className="flex-1 flex flex-col">
                  {isEditing || isCreating ? (
                    <div className="flex-1 min-h-[600px] border rounded overflow-hidden">
                      <Editor
                        key="main-editor"
                        tinymceScriptSrc={`${process.env.PUBLIC_URL}/tinymce/tinymce.min.js`}
                        licenseKey="gpl"
                        onInit={(evt, editor) => tinymceRef.current = editor}
                        initialValue={formData.Body_HTML}
                        disabled={false}
                        init={{
                          height: '100%',
                          menubar: true,
                          plugins: [
                            'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'preview',
                            'anchor', 'searchreplace', 'visualblocks', 'code', 'fullscreen',
                            'insertdatetime', 'media', 'table', 'help', 'wordcount'
                          ],
                          toolbar: 'undo redo | custom_fontsize | ' +
                            'bold italic forecolor | alignleft aligncenter ' +
                            'alignright alignjustify | bullist numlist outdent indent | ' +
                            'removeformat cell_props | blocks table page_margins image_margins | image | help',
                          fontsize_formats: '8pt 10pt 12pt 14pt 18pt 24pt 36pt 48pt',
                          content_style: `
                            body { 
                              font-family:Helvetica,Arial,sans-serif; 
                              font-size:14px;
                              width: 8.5in;
                              min-height: 11in;
                              margin: 2cm auto;
                              padding: ${paperPadding};
                              background: white;
                              box-shadow: 0 0 20px rgba(0,0,0,0.15);
                            }
                            /* Full Bleed Logic: Images with margin: 0 ignore body padding */
                            img[style*="margin: 0"], img[style*="margin:0"] {
                              margin-left: calc(-1 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              margin-right: calc(-1 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              width: calc(100% + 2 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              max-width: none !important;
                              display: block;
                            }
                            /* If it's the very first element, also bleed top */
                            body > img[style*="margin: 0"]:first-child, 
                            body > p:first-child > img[style*="margin: 0"] {
                              margin-top: calc(-1 * ${paperPadding.split(' ')[0]}) !important;
                            }
                            img:not([style*="margin: 0"]):not([style*="margin:0"]) {
                              margin: ${imageMargin};
                            }
                            img.absolute-image {
                              position: absolute;
                              cursor: move;
                            }
                            html {
                              background-color: #f0f0f0;
                            }
                          `,
                          branding: false,
                          contextmenu: 'link image table custom_image_margin absolute_pos',
                          table_cell_advtab: true,
                          table_advtab: true,
                          table_row_advtab: true,
                          image_advtab: true,
                          image_description: true,
                          image_dimensions: true,
                          image_class_list: [
                            { title: 'None', value: '' },
                            { title: 'Absolute Position', value: 'absolute-image' }
                          ],
                          table_cell_styles: [
                            { title: 'Black Top Border', value: { 'border-top': '1px solid black' } },
                            { title: 'White Top Border', value: { 'border-top': '1px solid white' } },
                            { title: 'Black Bottom Border', value: { 'border-bottom': '1px solid black' } },
                            { title: 'White Bottom Border', value: { 'border-bottom': '1px solid white' } },
                            { title: 'Black Left Border', value: { 'border-left': '1px solid black' } },
                            { title: 'White Left Border', value: { 'border-left': '1px solid white' } },
                            { title: 'Black Right Border', value: { 'border-right': '1px solid black' } },
                            { title: 'White Right Border', value: { 'border-right': '1px solid white' } },
                            { title: 'All White Borders', value: { 'border': '1px solid white' } },
                            { title: 'All Black Borders', value: { 'border': '1px solid black' } }
                          ],
                          setup: (editor: any) => {
                            editor.ui.registry.addMenuButton('page_margins', {
                              text: 'Page Margins',
                              tooltip: 'Adjust Paper Margins',
                              fetch: (callback: (items: any[]) => void) => {
                                const setMargin = (padding: string) => {
                                  setPaperPadding(padding);
                                  editor.dom.setStyle(editor.getBody(), 'padding', padding);
                                };

                                const items = [
                                  { type: 'menuitem', text: 'Normal (1 inch)', onAction: () => setMargin('1in') },
                                  { type: 'menuitem', text: 'Narrow (0.5 inch)', onAction: () => setMargin('0.5in') },
                                  { type: 'menuitem', text: 'Moderate (0.75 inch)', onAction: () => setMargin('0.75in') },
                                  { type: 'menuitem', text: 'Wide (2 inches)', onAction: () => setMargin('2in') },
                                  { type: 'menuitem', text: 'None', onAction: () => setMargin('0in') },
                                  {
                                    type: 'menuitem',
                                    text: 'Custom...',
                                    onAction: () => {
                                      editor.windowManager.open({
                                        title: 'Custom Page Margins',
                                        body: {
                                          type: 'panel',
                                          items: [
                                            { type: 'input', name: 'top', label: 'Top (e.g., 1in, 20px)' },
                                            { type: 'input', name: 'left', label: 'Left' },
                                            { type: 'input', name: 'right', label: 'Right' },
                                            { type: 'input', name: 'bottom', label: 'Bottom' }
                                          ]
                                        },
                                        buttons: [
                                          { type: 'cancel', text: 'Cancel' },
                                          { type: 'submit', text: 'Apply', primary: true }
                                        ],
                                        onSubmit: (api: any) => {
                                          const data = api.getData();
                                          // CSS shorthand order: top right bottom left
                                          const marginStr = `${data.top || '0'} ${data.right || '0'} ${data.bottom || '0'} ${data.left || '0'}`;
                                          setMargin(marginStr);
                                          api.close();
                                        }
                                      });
                                    }
                                  }
                                ];
                                callback(items as any);
                              }
                            });

                            editor.ui.registry.addMenuButton('image_margins', {
                              text: 'Image Margins',
                              tooltip: 'Adjust Image Margins',
                              fetch: (callback: (items: any[]) => void) => {
                                const setImgMargin = (margin: string) => {
                                  setImageMargin(margin);
                                  const images = editor.dom.select('img');
                                  images.forEach((img: any) => {
                                    const currentStyle = img.getAttribute('style') || '';
                                    if (!currentStyle.includes('margin: 0') && !currentStyle.includes('margin:0')) {
                                      editor.dom.setStyle(img, 'margin', margin);
                                    }
                                  });
                                };

                                const items = [
                                  { type: 'menuitem', text: 'None (0px)', onAction: () => setImgMargin('0px') },
                                  { type: 'menuitem', text: 'Small (5px)', onAction: () => setImgMargin('5px') },
                                  { type: 'menuitem', text: 'Medium (10px)', onAction: () => setImgMargin('10px') },
                                  { type: 'menuitem', text: 'Large (20px)', onAction: () => setImgMargin('20px') },
                                  {
                                    type: 'menuitem',
                                    text: 'Custom...',
                                    onAction: () => {
                                      editor.windowManager.open({
                                        title: 'Custom Image Margins',
                                        body: {
                                          type: 'panel',
                                          items: [
                                            { type: 'input', name: 'top', label: 'Top (e.g., 10px, 1em)' },
                                            { type: 'input', name: 'left', label: 'Left' },
                                            { type: 'input', name: 'right', label: 'Right' },
                                            { type: 'input', name: 'bottom', label: 'Bottom' }
                                          ]
                                        },
                                        buttons: [
                                          { type: 'cancel', text: 'Cancel' },
                                          { type: 'submit', text: 'Apply', primary: true }
                                        ],
                                        onSubmit: (api: any) => {
                                          const data = api.getData();
                                          // User order: top left right bottom. CSS standard: top right bottom left
                                          const marginStr = `${data.top || '0'} ${data.right || '0'} ${data.bottom || '0'} ${data.left || '0'}`;
                                          setImgMargin(marginStr);
                                          api.close();
                                        }
                                      });
                                    }
                                  },
                                ];
                                callback(items as any);
                              }
                            });

                            editor.ui.registry.addMenuItem('custom_image_margin', {
                              text: 'Set Image Margin...',
                              icon: 'image',
                              onAction: () => {
                                const node = editor.selection.getNode();
                                if (node.nodeName === 'IMG') {
                                  editor.windowManager.open({
                                    title: 'Set Image Margin',
                                    body: {
                                      type: 'panel',
                                      items: [
                                        { type: 'input', name: 'top', label: 'Top (e.g. 10px, 1in)' },
                                        { type: 'input', name: 'left', label: 'Left' },
                                        { type: 'input', name: 'right', label: 'Right' },
                                        { type: 'input', name: 'bottom', label: 'Bottom' }
                                      ]
                                    },
                                    buttons: [
                                      { type: 'cancel', text: 'Cancel' },
                                      { type: 'submit', text: 'Apply', primary: true }
                                    ],
                                    onSubmit: (api: any) => {
                                      const data = api.getData();
                                      // User order: top left right bottom. CSS standard: top right bottom left
                                      const marginStr = `${data.top || '0'} ${data.right || '0'} ${data.bottom || '0'} ${data.left || '0'}`;
                                      editor.dom.setStyle(node, 'margin', marginStr);
                                      api.close();
                                    }
                                  });
                                }
                              }
                            });

                            editor.ui.registry.addMenuItem('absolute_pos', {
                              text: 'Toggle Absolute Position',
                              icon: 'move',
                              onAction: () => {
                                const node = editor.selection.getNode();
                                if (node.nodeName === 'IMG') {
                                  const isAbs = editor.dom.getStyle(node, 'position') === 'absolute';
                                  if (isAbs) {
                                    editor.dom.setStyle(node, 'position', 'static');
                                    editor.dom.removeClass(node, 'absolute-image');
                                  } else {
                                    editor.dom.setStyle(node, 'position', 'absolute');
                                    editor.dom.addClass(node, 'absolute-image');
                                  }
                                }
                              }
                            });

                            editor.ui.registry.addMenuButton('custom_fontsize', {
                              text: 'Size',
                              tooltip: 'Font Size',
                              fetch: (callback: (items: any[]) => void) => {
                                const items = [
                                  { type: 'menuitem', text: '8pt', onAction: () => editor.execCommand('FontSize', false, '8pt') },
                                  { type: 'menuitem', text: '10pt', onAction: () => editor.execCommand('FontSize', false, '10pt') },
                                  { type: 'menuitem', text: '12pt', onAction: () => editor.execCommand('FontSize', false, '12pt') },
                                  { type: 'menuitem', text: '14pt', onAction: () => editor.execCommand('FontSize', false, '14pt') },
                                  { type: 'menuitem', text: '18pt', onAction: () => editor.execCommand('FontSize', false, '18pt') },
                                  { type: 'menuitem', text: '24pt', onAction: () => editor.execCommand('FontSize', false, '24pt') },
                                  { type: 'menuitem', text: '36pt', onAction: () => editor.execCommand('FontSize', false, '36pt') },
                                  { type: 'menuitem', text: '48pt', onAction: () => editor.execCommand('FontSize', false, '48pt') },
                                  { type: 'separator' },
                                  {
                                    type: 'menuitem',
                                    text: 'Custom...',
                                    onAction: () => {
                                      editor.windowManager.open({
                                        title: 'Custom Font Size',
                                        body: {
                                          type: 'panel',
                                          items: [{ type: 'input', name: 'size', label: 'Size (e.g. 15, 20px, 1.5rem)' }]
                                        },
                                        buttons: [
                                          { type: 'cancel', text: 'Cancel' },
                                          { type: 'submit', text: 'Apply', primary: true }
                                        ],
                                        onSubmit: (api: any) => {
                                          const data = api.getData();
                                          let size = data.size;
                                          if (size && !isNaN(Number(size))) size = `${size}pt`;
                                          if (size) {
                                            editor.execCommand('FontSize', false, size);
                                          }
                                          api.close();
                                        }
                                      });
                                    }
                                  }
                                ];
                                callback(items as any);
                              }
                            });

                            editor.ui.registry.addMenuButton('cell_props', {
                              text: 'Cell Props',
                              tooltip: 'Table Cell Borders',
                              fetch: (callback: (items: any[]) => void) => {
                                // Capture selection state as soon as menu is opened
                                const getCells = (): any[] => {
                                  // 1. Check for standard TinyMCE table selection markers
                                  const selectedByAttr = editor.dom.select('td[data-mce-selected], th[data-mce-selected], td[data-mce-first-selected], th[data-mce-first-selected]');
                                  if (selectedByAttr.length > 0) return Array.from(selectedByAttr);

                                  // 2. Check for blocks in selection
                                  const selectedByBlocks = editor.selection.getSelectedBlocks().filter((b: any) => b.nodeName === 'TD' || b.nodeName === 'TH');
                                  if (selectedByBlocks.length > 0) return selectedByBlocks;

                                  // 3. Fallback: Check for parents of selected blocks (e.g. if text inside cell is selected)
                                  const fromParents: any[] = [];
                                  editor.selection.getSelectedBlocks().forEach((block: any) => {
                                    const cell = editor.dom.getParent(block, 'td,th');
                                    if (cell && !fromParents.includes(cell)) {
                                      fromParents.push(cell);
                                    }
                                  });
                                  if (fromParents.length > 0) return fromParents;

                                  // 4. Final Fallback: Single cell under cursor
                                  const singleCell = editor.dom.getParent(editor.selection.getStart(), 'td,th');
                                  return singleCell ? [singleCell] : [];
                                };

                                const targetCells = getCells();
                                targetCellsRef.current = Array.from(new Set(targetCells)); // De-duplicate

                                const openBorderModal = (side: 'top' | 'bottom' | 'left' | 'right') => {
                                  if (targetCellsRef.current.length === 0) return;

                                  const firstCell = targetCellsRef.current[0];
                                  const styleName = `border-${side}`;
                                  const currentBorder = editor.dom.getStyle(firstCell, styleName) || '1px solid #000000';

                                  // Parse current border (e.g., "1px solid rgb(0, 0, 0)")
                                  const parts = currentBorder.split(' ');
                                  const width = parts[0] || '1px';
                                  const style = parts[1] || 'solid';
                                  const color = parts.slice(2).join(' ') || '#000000';

                                  setBorderModal({
                                    isOpen: true,
                                    side,
                                    width,
                                    style,
                                    color
                                  });
                                };

                                const items = [
                                  { type: 'menuitem', text: 'Top Border', onAction: () => openBorderModal('top') },
                                  { type: 'menuitem', text: 'Bottom Border', onAction: () => openBorderModal('bottom') },
                                  { type: 'menuitem', text: 'Left Border', onAction: () => openBorderModal('left') },
                                  { type: 'menuitem', text: 'Right Border', onAction: () => openBorderModal('right') },
                                ];
                                callback(items as any);
                              }
                            });
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className={`w-full flex-1 border rounded shadow-sm overflow-hidden flex flex-col ${isDarkMode
                      ? 'bg-gray-900 border-gray-700'
                      : 'bg-gray-100 border-gray-300'
                      }`}>
                      <Editor
                        key={`preview-${selectedTemplate?.Template_Code}-${paperPadding}`}
                        tinymceScriptSrc={`${process.env.PUBLIC_URL}/tinymce/tinymce.min.js`}
                        licenseKey="gpl"
                        value={selectedTemplate?.Body_HTML || ''}
                        disabled={true}
                        init={{
                          height: '100%',
                          menubar: false,
                          toolbar: false,
                          statusbar: false,
                          plugins: [],
                          content_style: `
                            body { 
                              font-family:Helvetica,Arial,sans-serif; 
                              font-size:14px;
                              width: 8.5in;
                              min-height: 11in;
                              margin: 2cm auto;
                              padding: ${paperPadding};
                              background: white;
                              box-shadow: 0 0 20px rgba(0,0,0,0.15);
                            }
                            /* Full Bleed Logic */
                            img[style*="margin: 0"], img[style*="margin:0"] {
                              margin-left: calc(-1 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              margin-right: calc(-1 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              width: calc(100% + 2 * ${paperPadding.includes(' ') ? paperPadding.split(' ')[1] || paperPadding.split(' ')[0] : paperPadding}) !important;
                              max-width: none !important;
                              display: block;
                            }
                            body > img[style*="margin: 0"]:first-child, 
                            body > p:first-child > img[style*="margin: 0"] {
                              margin-top: calc(-1 * ${paperPadding.split(' ')[0]}) !important;
                            }
                            img:not([style*="margin: 0"]):not([style*="margin:0"]) {
                              margin: ${imageMargin};
                            }
                            img.absolute-image {
                              position: absolute;
                            }
                            html {
                              background-color: #f0f0f0;
                            }
                          `,
                        }}
                      />
                    </div>
                  )}
                </div>
              ) : (
                isEditing || isCreating ? (
                  <div className="flex flex-col flex-1">
                    <div className="mb-4">
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Available Variables
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {availableVariables.map(variable => (
                          <button
                            key={variable}
                            type="button"
                            onClick={() => insertVariableToBody(variable)}
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
                    <div className="flex-1 flex flex-col">
                      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Email Content
                      </label>
                      <textarea
                        value={formData.email_body}
                        onChange={(e) => handleInputChange('email_body', e.target.value)}
                        placeholder="Email Body. Click variables in the sidebar or above to insert them."
                        className={`w-full flex-1 p-4 text-sm border rounded min-h-[400px] resize-none font-mono ${isDarkMode
                          ? 'bg-gray-800 border-gray-700 text-white'
                          : 'bg-white border-gray-300 text-gray-900'
                          }`}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`w-full flex-1 p-6 border rounded shadow-sm ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}>
                    <h3 className="text-sm font-semibold mb-4 border-b pb-2 uppercase tracking-wide">Email Body Preview</h3>
                    <div className="whitespace-pre-wrap font-mono text-sm leading-relaxed">
                      {selectedTemplate?.email_body || 'No content defined for this template.'}
                    </div>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className={`text-lg ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                }`}>Select a template to view or edit</p>
            </div>
          )}
        </div>
      </div>

      {/* Loading Modal */}
      {operationLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className={`border rounded-lg p-6 max-w-sm w-full mx-4 ${isDarkMode
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mb-4"></div>
              <p className={`text-base font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Processing...</p>
              <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>Please wait</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`border rounded-lg p-4 max-w-md w-full mx-4 ${isDarkMode
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-base font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{modal.title}</h3>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{modal.message}</p>
            <div className="flex items-center justify-end gap-2">
              {modal.type === 'confirm' ? (
                <>
                  <button
                    onClick={modal.onCancel}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={modal.onConfirm}
                    className="px-3 py-1.5 text-sm text-white rounded transition-colors"
                    style={{
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    }}
                    onMouseEnter={(e) => {
                      if (colorPalette?.accent) {
                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                    }}
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setModal({ ...modal, isOpen: false })}
                  className="px-3 py-1.5 text-sm text-white rounded transition-colors"
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    if (colorPalette?.accent) {
                      e.currentTarget.style.backgroundColor = colorPalette.accent;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                  }}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Border Properties Modal */}
      {borderModal?.isOpen && (
        <div className="fixed top-20 right-4 w-72 z-50 animate-in fade-in slide-in-from-right-4">
          <div className={`p-4 border rounded-lg shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
            }`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider">
                {borderModal.side} Border
              </h3>
              <button
                onClick={() => setBorderModal(null)}
                className={`p-1 rounded-full hover:bg-opacity-10 ${isDarkMode ? 'hover:bg-white' : 'hover:bg-black'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1 opacity-70">Style (Pattern)</label>
                <select
                  value={borderModal.style}
                  onChange={(e) => setBorderModal({ ...borderModal, style: e.target.value })}
                  className={`w-full px-2 py-1.5 text-sm border rounded ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}
                >
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="double">Double</option>
                  <option value="none">None</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 opacity-70">Color</label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={borderModal.color.startsWith('#') ? borderModal.color : '#000000'}
                    onChange={(e) => setBorderModal({ ...borderModal, color: e.target.value })}
                    className="w-8 h-8 rounded border-0 cursor-pointer p-0 bg-transparent"
                  />
                  <input
                    type="text"
                    value={borderModal.color}
                    onChange={(e) => setBorderModal({ ...borderModal, color: e.target.value })}
                    className={`flex-1 px-2 py-1 text-sm border rounded ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'}`}
                    placeholder="#000000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1 opacity-70">Width</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={parseInt(borderModal.width) || 1}
                    onChange={(e) => setBorderModal({ ...borderModal, width: `${e.target.value}px` })}
                    className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm w-8 text-right font-mono truncate">{borderModal.width}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-opacity-10 border-white">
                <button
                  onClick={handleApplyBorder}
                  className="w-full py-2 px-4 rounded text-sm font-semibold text-white transition-all shadow-lg active:scale-95"
                  style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                >
                  Apply {borderModal.side} Border
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailTemplates;

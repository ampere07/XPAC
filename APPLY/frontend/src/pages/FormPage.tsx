import React, { useState, useEffect, useRef } from 'react';
import Form, { FormRef } from './Form';
import MultiStepForm, { MultiStepFormRef } from '../components/MultiStepForm';
import LoadingScreen from '../components/Loading/LoadingScreen';

const FormPage: React.FC = () => {
  const apiBaseUrl = process.env.REACT_APP_API_URL || "https://backend1.atssfiber.ph";
  const formRef = useRef<FormRef>(null);
  const multiStepFormRef = useRef<MultiStepFormRef>(null);
  const [formLayout, setFormLayout] = useState<'original' | 'multistep'>('original');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);

  useEffect(() => {
    const fetchLayoutSettings = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/form-ui/settings`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            const multiStepValue = result.data.multi_step;
            if (multiStepValue === 'active') {
              setFormLayout('multistep');
            } else {
              setFormLayout('original');
            }
          }
        }
      } catch (error) {
        console.error('Error fetching layout settings:', error);
      } finally {
        setIsLoadingLayout(false);
      }
    };

    fetchLayoutSettings();
  }, [apiBaseUrl]);

  const handleLayoutChange = async (layout: 'original' | 'multistep') => {
    console.log('=== LAYOUT CHANGE TRIGGERED ===');
    console.log('New layout:', layout);
    setFormLayout(layout);

    const multiStepValue = layout === 'multistep' ? 'active' : 'inactive';
    console.log('Setting multi_step to:', multiStepValue);

    try {
      const formData = new FormData();
      formData.append('multi_step', multiStepValue);

      console.log('Sending request to:', `${apiBaseUrl}/api/form-ui/settings`);

      const response = await fetch(`${apiBaseUrl}/api/form-ui/settings`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        body: formData
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Response data:', result);
        if (result.success) {
          console.log('Layout saved successfully to database');
        }
      } else {
        console.error('Failed to save layout preference - response not OK');
        const errorText = await response.text();
        console.error('Error response:', errorText);
      }
    } catch (error) {
      console.error('Error saving layout preference:', error);
    }
  };

  if (isLoadingLayout) {
    return <LoadingScreen />;
  }

  return (
    <>
      {formLayout === 'original' ? (
        <Form
          ref={formRef}
          showEditButton={false}
          onLayoutChange={handleLayoutChange}
          currentLayout={formLayout}
          isEditMode={isEditMode}
          onEditModeChange={setIsEditMode}
        />
      ) : (
        <MultiStepForm
          ref={multiStepFormRef}
          showEditButton={false}
          onLayoutChange={handleLayoutChange}
          currentLayout={formLayout}
          isEditMode={isEditMode}
          onEditModeChange={setIsEditMode}
        />
      )}
    </>
  );
};

export default FormPage;

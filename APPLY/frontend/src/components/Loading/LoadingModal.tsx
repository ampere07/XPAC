import React from 'react';

interface LoadingModalProps {
  message: string;
  submessage?: string;
  spinnerColor?: 'blue' | 'green';
}

const LoadingModal: React.FC<LoadingModalProps> = ({ 
  message, 
  submessage, 
  spinnerColor = 'blue' 
}) => {
  const spinnerClass = spinnerColor === 'green' 
    ? 'border-green-600' 
    : 'border-blue-600';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
        <div className="flex items-center justify-center mb-4">
          <div className={`animate-spin rounded-full h-8 w-8 border-b-2 ${spinnerClass}`}></div>
        </div>
        <p className="text-center font-medium text-gray-900">{message}</p>
        {submessage && (
          <p className="text-center text-sm mt-2 text-gray-600">{submessage}</p>
        )}
      </div>
    </div>
  );
};

export default LoadingModal;

import React from 'react';
import { CheckCircle, XCircle, X } from 'lucide-react';

interface PaymentResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  success: boolean;
  referenceNo: string;
  isDarkMode?: boolean;
}

const PaymentResultModal: React.FC<PaymentResultModalProps> = ({
  isOpen,
  onClose,
  success,
  referenceNo,
  isDarkMode = true
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`${
        isDarkMode ? 'bg-gray-800 text-gray-100' : 'bg-white text-gray-900'
      } rounded-lg shadow-xl max-w-md w-full p-6 relative`}>
        {/* Close button */}
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 ${
            isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Icon and Title */}
        <div className="text-center mb-6">
          {success ? (
            <div className="flex justify-center mb-4">
              <CheckCircle className="w-16 h-16 text-green-500" />
            </div>
          ) : (
            <div className="flex justify-center mb-4">
              <XCircle className="w-16 h-16 text-red-500" />
            </div>
          )}
          
          <h2 className="text-2xl font-bold mb-2">
            {success ? 'Payment Successful!' : 'Payment Failed'}
          </h2>
          
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            {success 
              ? 'Your payment has been received and is being processed.'
              : 'We were unable to process your payment. Please try again.'
            }
          </p>
        </div>

        {/* Reference Number */}
        <div className={`${
          isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
        } rounded-lg p-4 mb-6`}>
          <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} mb-1`}>
            Reference Number
          </p>
          <p className="font-mono text-sm font-medium break-all">
            {referenceNo}
          </p>
        </div>

        {/* Message */}
        <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} mb-6`}>
          {success ? (
            <>
              <p className="mb-2">
                ✓ Payment confirmation sent
              </p>
              <p className="mb-2">
                ✓ Account balance will be updated shortly
              </p>
              <p>
                ✓ You can check your transaction history for details
              </p>
            </>
          ) : (
            <>
              <p className="mb-2">
                If you encountered any issues, please contact support or try again.
              </p>
            </>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
            success
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-red-600 hover:bg-red-700 text-white'
          }`}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default PaymentResultModal;

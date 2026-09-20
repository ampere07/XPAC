import React, { useState, useRef, useEffect } from 'react';

interface TermsModalProps {
  onClose: () => void;
  buttonColor: string;
  termsAndCondition?: string;
  privacyPolicy?: string;
  contactInformation?: string;
  brandName?: string;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => {
  return (
    <div className="border-b border-gray-200">
      <div className="w-full py-4 px-6 bg-gray-50/50">
        <h5 className="font-semibold text-gray-800 text-left uppercase tracking-wider text-xs">{title}</h5>
      </div>
      <div className="px-6 py-4 text-gray-600 text-sm leading-relaxed whitespace-pre-wrap bg-white">
        {children}
      </div>
    </div>
  );
};

const TermsModal: React.FC<TermsModalProps> = ({ onClose, buttonColor, termsAndCondition, privacyPolicy, contactInformation, brandName }) => {
  const [canClose, setCanClose] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      // Check if we are near the bottom (5px threshold)
      if (scrollTop + clientHeight >= scrollHeight - 5) {
        setCanClose(true);
      }
    }
  };

  // Also check if content is short enough that it doesn't need scrolling
  useEffect(() => {
    if (scrollRef.current) {
      const { scrollHeight, clientHeight } = scrollRef.current;
      if (scrollHeight <= clientHeight) {
        setCanClose(true);
      }
    }
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <h3 className="text-xl font-semibold text-gray-900">Terms & Conditions and Privacy Policy</h3>
          <p className="text-sm text-gray-500 mt-1">Please review our policies carefully</p>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-auto flex-1 scroll-smooth"
        >
          <div className="p-6 bg-gray-50 border-b border-gray-200">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Welcome to {brandName || 'SYNC'}</h4>
            <p className="text-gray-600 text-sm leading-relaxed">
              By using our internet services, you agree to the Terms and Conditions and Privacy Policy outlined below.
              These ensure your protection, quality service, and secure network operations.
            </p>
          </div>

          <div className="bg-white">
            {/* 1. Terms and Conditions Section */}
            <Section title="Terms and Conditions">
              <div className="whitespace-pre-wrap py-2">
                {termsAndCondition || `Please refer to ${brandName || 'SYNC'}'s official terms and conditions documentation.`}
              </div>
            </Section>

            {/* 2. Privacy Policy Section */}
            <Section title="Privacy Policy">
              <div className="whitespace-pre-wrap py-2">
                {privacyPolicy || `${brandName || 'SYNC'} is committed to protecting your personal data in accordance with the Data Privacy Act of 2012.`}
              </div>
            </Section>

            {/* 3. Contact Information Section */}
            <Section title="Contact Information">
              <div className="whitespace-pre-wrap py-2">
                {contactInformation || `For any inquiries, please contact ${brandName || 'SYNC'} customer support.`}
              </div>
            </Section>
          </div>

          <div className="p-6 bg-gray-50 border-t border-gray-200">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded mb-4">
              <p className="text-sm text-gray-800 font-semibold leading-relaxed text-center">
                I confirm that I have read, understood, and agree to the {brandName || 'SYNC'} Terms & Conditions and Privacy Policy.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center p-6 border-t border-gray-200 bg-gray-50 gap-4">
          {!canClose && (
            <p className="text-sm text-red-500 font-medium animate-pulse">
              Please scroll to the bottom to enable the close button
            </p>
          )}
          <div className="flex justify-end w-full">
            <button
              onClick={onClose}
              disabled={!canClose}
              className={`px-8 py-2.5 text-white rounded font-medium transition-all shadow-sm ${canClose ? 'hover:opacity-90 cursor-pointer' : 'opacity-50 cursor-not-allowed bg-gray-400'
                }`}
              style={{ backgroundColor: canClose ? buttonColor : undefined }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsModal;

import React from 'react';
import { ShieldAlert } from 'lucide-react';

/**
 * What a user sees when they reach a section their role does not hold.
 *
 * Reaching this is not a normal outcome — the sidebar does not list what the
 * role cannot open — so it is worded as a wrong turn rather than as an error,
 * and it offers the way back to the page the role does land on.
 */
interface AccessDeniedProps {
  /** The section that was refused, shown so a support call has something to quote. */
  section?: string;
  /** Send the user to the landing page their role does have. */
  onGoHome?: () => void;
}

const AccessDenied: React.FC<AccessDeniedProps> = ({ section, onGoHome }) => {
  const isDarkMode = localStorage.getItem('theme') !== 'light';

  return (
    <div
      className={`h-full flex flex-col items-center justify-center px-6 text-center ${
        isDarkMode ? 'bg-gray-950 text-gray-300' : 'bg-gray-50 text-gray-700'
      }`}
    >
      <div
        className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 ${
          isDarkMode ? 'bg-gray-900 text-amber-400' : 'bg-amber-50 text-amber-500'
        }`}
      >
        <ShieldAlert size={30} />
      </div>

      <h1 className="text-lg font-semibold mb-2">You do not have access to this page</h1>

      <p className={`text-sm max-w-md ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
        Your role does not include
        {section ? <span className="font-medium"> {section}</span> : ' this section'}.
        If you think it should, ask an administrator to update your role.
      </p>

      {onGoHome && (
        <button
          onClick={onGoHome}
          className={`mt-6 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isDarkMode
              ? 'bg-gray-800 hover:bg-gray-700 text-gray-200'
              : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'
          }`}
        >
          Back to my dashboard
        </button>
      )}
    </div>
  );
};

export default AccessDenied;

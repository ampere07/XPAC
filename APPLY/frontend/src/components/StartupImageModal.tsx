import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import dpoxpacImage from '../assets/dpoxpac.png';

interface StartupImageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Image announcement shown once when the app is first opened (see App.tsx).
 * Closed with the X button, the Escape key, or a click on the dimmed backdrop.
 */
const StartupImageModal: React.FC<StartupImageModalProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Announcement"
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-800 shadow-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          <X size={20} />
        </button>
        <img
          src={dpoxpacImage}
          alt="Announcement"
          className="block max-h-[85vh] max-w-[90vw] w-auto rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
};

export default StartupImageModal;

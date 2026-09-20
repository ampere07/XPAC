import React, { useEffect, useState } from 'react';
import { X, Bell, CheckCircle, AlertCircle, Info } from 'lucide-react';

export interface ToastProps {
    isVisible: boolean;
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
    onClose: () => void;
    onClick?: () => void;
}

const NotificationToast: React.FC<ToastProps> = ({
    isVisible,
    title,
    message,
    type = 'info',
    onClose,
    onClick
}) => {
    const [show, setShow] = useState(isVisible);
    const [isClosing, setIsClosing] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(false);

    useEffect(() => {
        const checkTheme = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches));
        };

        checkTheme();
        const observer = new MutationObserver(checkTheme);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (isVisible) {
            setShow(true);
            setIsClosing(false);
            const timer = setTimeout(() => {
                handleClose();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [isVisible]);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setShow(false);
            onClose();
        }, 300);
    };

    if (!show) return null;

    const getIcon = () => {
        switch (type) {
            case 'success':
                return (
                    <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded-full ring-1 ring-green-500/20">
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                );
            case 'warning':
                return (
                    <div className="bg-yellow-100 dark:bg-yellow-900/30 p-2 rounded-full ring-1 ring-yellow-500/20">
                        <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                    </div>
                );
            case 'error':
                return (
                    <div className="bg-red-100 dark:bg-red-900/30 p-2 rounded-full ring-1 ring-red-500/20">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                );
            default:
                return (
                    <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full ring-1 ring-blue-500/20">
                        <Bell className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                );
        }
    };

    return (
        <div
            className={`fixed top-20 right-4 z-[9999] max-w-sm w-full 
                ${isDarkMode
                    ? 'bg-slate-800/95 border-slate-700 shadow-[0_0_15px_rgba(0,0,0,0.5)]'
                    : 'bg-white/95 border-gray-200 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)]'
                } 
                backdrop-blur-sm rounded-xl border pointer-events-auto 
                transition-all duration-300 ease-out transform 
                ${isClosing ? 'translate-x-full opacity-0 scale-95' : 'translate-x-0 opacity-100 scale-100'}
            `}
            role="alert"
        >
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 animate-in fade-in zoom-in duration-300">
                        {getIcon()}
                    </div>
                    <div
                        className="flex-1 min-w-0 pt-1 cursor-pointer group"
                        onClick={() => {
                            if (onClick) onClick();
                            handleClose();
                        }}
                    >
                        <p className={`text-sm font-bold truncate transition-colors ${isDarkMode ? 'text-white group-hover:text-blue-400' : 'text-slate-900 group-hover:text-blue-600'
                            }`}>
                            {title}
                        </p>
                        <p className={`mt-1 text-sm leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'
                            }`}>
                            {message}
                        </p>
                    </div>
                    <div className="flex-shrink-0 -mr-1">
                        <button
                            className={`rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${isDarkMode
                                    ? 'text-slate-400 hover:text-white hover:bg-slate-700'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                                }`}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClose();
                            }}
                        >
                            <span className="sr-only">Close</span>
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
            {/* Progress bar */}
            <div className={`h-1 w-full rounded-b-xl overflow-hidden ${isDarkMode ? 'bg-slate-700' : 'bg-slate-100'
                }`}>
                <div className={`h-full animate-[progress_5s_linear_forwards] ${type === 'success' ? 'bg-green-500' :
                        type === 'warning' ? 'bg-yellow-500' :
                            type === 'error' ? 'bg-red-500' :
                                'bg-blue-500'
                    }`} />
            </div>
        </div>
    );
};

export default NotificationToast;

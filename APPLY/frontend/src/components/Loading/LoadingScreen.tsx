import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ message }) => {
  return (
    <div className="fixed top-0 left-0 w-full h-full bg-white flex justify-center items-center z-[9999]">
      <div className="text-center">
        <div className="w-[60px] h-[60px] border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin mx-auto mb-5"></div>
        {message && <p className="text-black text-lg font-medium m-0 tracking-wide">{message}</p>}
      </div>
    </div>
  );
};

export default LoadingScreen;

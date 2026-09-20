import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';

interface CameraFileInputProps {
  label: string;
  name: string;
  required?: boolean;
  accept?: string;
  value: File | null;
  onChange: (file: File | null) => void;
  labelColor: string;
  borderColor: string;
  backgroundColor: string;
  textColor: string;
}

const CameraFileInput: React.FC<CameraFileInputProps> = ({
  label,
  name,
  required = false,
  accept = '.jpg,.jpeg,.png',
  value,
  onChange,
  labelColor,
  borderColor,
  backgroundColor,
  textColor,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('Maximum of 10MB');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      setError(null);
      onChange(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemove = () => {
    setError(null);
    onChange(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="mb-4">
      <label className="block font-medium mb-2" style={{ color: labelColor }}>
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      
      {!value ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            name={name}
            onChange={handleFileChange}
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
          />
          
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 border rounded px-4 py-3 hover:opacity-80 transition-all"
            style={{ borderColor, backgroundColor, color: textColor }}
          >
            <Upload className="w-5 h-5" />
            <span className="text-sm">Upload File</span>
          </button>
          {error && (
            <p className="mt-1 text-xs text-red-500 font-medium">{error}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {preview && (
            <div className="relative w-full h-48 border rounded overflow-hidden" style={{ borderColor }}>
              <img 
                src={preview} 
                alt="Preview" 
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div className="flex items-center justify-between p-3 border rounded" style={{ borderColor, backgroundColor }}>
            <span className="text-sm truncate flex-1" style={{ color: textColor }}>
              {value.name}
            </span>
            <button
              type="button"
              onClick={handleRemove}
              className="ml-2 p-1 hover:bg-red-100 rounded transition-colors"
            >
              <X className="w-5 h-5 text-red-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraFileInput;

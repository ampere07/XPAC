import apiClient from '../config/api';

export interface ImageSizeSetting {
  id: number;
  image_size: string;
  image_size_value: number;
  status: 'active' | 'inactive';
}

export const getActiveImageSize = async (): Promise<ImageSizeSetting | null> => {
  try {
    const response = await apiClient.get<{ success: boolean; data: ImageSizeSetting[] }>('/settings/image-size');
    if (response.data.success && Array.isArray(response.data.data)) {
      const activeSetting = response.data.data.find(setting => setting.status === 'active');
      return activeSetting || null;
    }
    return null;
  } catch (error) {
    return null;
  }
};

export const resizeImage = (file: File, resizePercentage: number): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scaleFactor = resizePercentage / 100;
        
        canvas.width = Math.floor(img.width * scaleFactor);
        canvas.height = Math.floor(img.height * scaleFactor);
        
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const outputType = file.type === 'image/png' ? 'image/jpeg' : file.type;
        const outputQuality = 0.85;
        
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to create blob'));
              return;
            }
            
            const extension = outputType === 'image/jpeg' ? '.jpg' : file.name.split('.').pop();
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const outputFileName = `${baseName}.${extension}`;
            
            const resizedFile = new File([blob], outputFileName, {
              type: outputType,
              lastModified: Date.now(),
            });
            
            resolve(resizedFile);
          },
          outputType,
          outputQuality
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

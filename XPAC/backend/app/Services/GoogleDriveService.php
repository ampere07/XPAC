<?php

namespace App\Services;

use Google\Client as GoogleClient;
use Google\Service\Drive as GoogleDrive;
use Illuminate\Support\Facades\Log;
use App\Models\SettingsImageSize;

class GoogleDriveService
{
    private $service;
    private $parentFolderId;

    public function __construct()
    {
        $this->service = $this->initializeGoogleDriveService();
        $this->parentFolderId = env('GOOGLE_DRIVE_FOLDER_ID');
    }

    private function getActiveImageSizePercentage()
    {
        try {
            $activeSettings = SettingsImageSize::where('status', 'active')->first();
            
            if ($activeSettings && $activeSettings->image_size_value) {
                Log::info('Retrieved active image size setting', [
                    'size' => $activeSettings->image_size,
                    'percentage' => $activeSettings->image_size_value
                ]);
                return $activeSettings->image_size_value;
            }
            
            Log::info('No active image size setting found, using 100%');
            return 100;
        } catch (\Exception $e) {
            Log::error('Error retrieving image size setting, defaulting to 100%', [
                'error' => $e->getMessage()
            ]);
            return 100;
        }
    }

    private function resizeImage($imageContent, $mimeType, $percentage)
    {
        if ($percentage >= 100) {
            return $imageContent;
        }

        try {
            $image = imagecreatefromstring($imageContent);
            
            if ($image === false) {
                Log::warning('Failed to create image from string, uploading original');
                return $imageContent;
            }

            $originalWidth = imagesx($image);
            $originalHeight = imagesy($image);

            $newWidth = round($originalWidth * ($percentage / 100));
            $newHeight = round($originalHeight * ($percentage / 100));

            $resizedImage = imagecreatetruecolor($newWidth, $newHeight);

            if (strpos($mimeType, 'png') !== false) {
                imagealphablending($resizedImage, false);
                imagesavealpha($resizedImage, true);
                $transparent = imagecolorallocatealpha($resizedImage, 255, 255, 255, 127);
                imagefilledrectangle($resizedImage, 0, 0, $newWidth, $newHeight, $transparent);
            }

            imagecopyresampled(
                $resizedImage,
                $image,
                0, 0, 0, 0,
                $newWidth,
                $newHeight,
                $originalWidth,
                $originalHeight
            );

            ob_start();
            
            if (strpos($mimeType, 'png') !== false) {
                imagepng($resizedImage, null, 9);
            } elseif (strpos($mimeType, 'gif') !== false) {
                imagegif($resizedImage);
            } else {
                imagejpeg($resizedImage, null, 85);
            }
            
            $resizedContent = ob_get_clean();

            imagedestroy($image);
            imagedestroy($resizedImage);

            $originalSize = strlen($imageContent);
            $resizedSize = strlen($resizedContent);
            $reduction = round((($originalSize - $resizedSize) / $originalSize) * 100, 2);

            Log::info('Image resized successfully', [
                'original_dimensions' => "{$originalWidth}x{$originalHeight}",
                'new_dimensions' => "{$newWidth}x{$newHeight}",
                'percentage' => $percentage,
                'original_size' => $originalSize,
                'resized_size' => $resizedSize,
                'size_reduction' => "{$reduction}%"
            ]);

            return $resizedContent;
        } catch (\Exception $e) {
            Log::error('Error resizing image, uploading original', [
                'error' => $e->getMessage()
            ]);
            return $imageContent;
        }
    }

    private function initializeGoogleDriveService()
    {
        $tempDir = storage_path('app/temp');
        if (!file_exists($tempDir)) {
            @mkdir($tempDir, 0775, true);
        }
        
        // Fallback to system temp directory if storage/app/temp is not writable
        if (!is_writable($tempDir)) {
            $tempDir = sys_get_temp_dir();
        }
        
        // Use config() instead of env() to ensure values are found even if config is cached
        $rawKey = config('services.google.drive.private_key') ?? env('GOOGLE_DRIVE_PRIVATE_KEY');
        $clientEmail = config('services.google.drive.client_email') ?? env('GOOGLE_DRIVE_CLIENT_EMAIL');
        $projectId = config('services.google.drive.project_id') ?? env('GOOGLE_DRIVE_PROJECT_ID');
        $clientId = config('services.google.drive.client_id') ?? env('GOOGLE_DRIVE_CLIENT_ID');
        $privateKeyId = config('services.google.drive.private_key_id') ?? env('GOOGLE_DRIVE_PRIVATE_KEY_ID');

        // Handle literal backslash+n and ensure actual newlines
        $privateKey = str_replace(['\\n', '\n'], "\n", $rawKey);
        
        // Remove any surrounding quotes that might have been preserved by environment loaders
        $privateKey = trim($privateKey, '"\'');
        
        // Ensure it starts and ends correctly by trimming any whitespace
        $privateKey = trim($privateKey);

        // Create a unique filename for this application to avoid collisions
        $currentUser = function_exists('posix_getpwuid') && function_exists('posix_geteuid') 
            ? posix_getpwuid(posix_geteuid())['name'] 
            : get_current_user();
            
        $tempKeyFile = $tempDir . '/google_drive_keys_' . $currentUser . '_' . substr(md5($clientEmail), 0, 10) . '.json';

        // Create the credentials array
        $credentials = [
            'type' => 'service_account',
            'project_id' => $projectId,
            'private_key_id' => $privateKeyId,
            'private_key' => $privateKey,
            'client_email' => $clientEmail,
            'client_id' => $clientId,
            'auth_uri' => 'https://accounts.google.com/o/oauth2/auth',
            'token_uri' => 'https://oauth2.googleapis.com/token',
            'auth_provider_x509_cert_url' => 'https://www.googleapis.com/oauth2/v1/certs',
            'client_x509_cert_url' => 'https://www.googleapis.com/robot/v1/metadata/x509/' . urlencode($clientEmail)
        ];

        // Ensure the temporary file exists and has the current credentials
        try {
            $success = @file_put_contents($tempKeyFile, json_encode($credentials));
            
            if ($success === false) {
                // If primary file fails, try a unique one in system temp as absolute fallback
                $tempKeyFile = tempnam(sys_get_temp_dir(), 'google_drive_keys_');
                file_put_contents($tempKeyFile, json_encode($credentials));
                Log::info('Used fallback temporary Google credentials file', ['path' => $tempKeyFile]);
            }
            
            @chmod($tempKeyFile, 0600);
        } catch (\Exception $e) {
            Log::error('Failed to create temporary Google credentials file', [
                'path' => $tempKeyFile,
                'error' => $e->getMessage()
            ]);
        }

        // Set environment variables to guide the Google SDK
        putenv('GOOGLE_APPLICATION_CREDENTIALS=' . $tempKeyFile);
        putenv('HOME=' . $tempDir);

        $client = new GoogleClient();
        
        // Use the array directly to be certain no file-loading issues occur
        $client->setAuthConfig($credentials);
        $client->addScope(GoogleDrive::DRIVE_FILE);
        
        return new GoogleDrive($client);
    }





    public function getService()
    {
        return $this->service;
    }

    public function getParentFolderId()
    {
        return $this->parentFolderId;
    }

    public function findFolder($folderName, $parentFolderId = null)
    {
        try {
            $parentId = $parentFolderId ?? $this->parentFolderId;
            
            $query = "name='{$folderName}' and mimeType='application/vnd.google-apps.folder' and '{$parentId}' in parents and trashed=false";
            
            $response = $this->service->files->listFiles([
                'q' => $query,
                'fields' => 'files(id, name)',
                'supportsAllDrives' => true,
                'includeItemsFromAllDrives' => true
            ]);
            
            $files = $response->getFiles();
            
            if (count($files) > 0) {
                Log::info('Found existing Google Drive folder', [
                    'folder_name' => $folderName,
                    'folder_id' => $files[0]->id,
                    'parent_id' => $parentId
                ]);
                return $files[0]->id;
            }
            
            return null;
        } catch (\Exception $e) {
            Log::error('Failed to search for Google Drive folder', [
                'folder_name' => $folderName,
                'error' => $e->getMessage()
            ]);
            return null;
        }
    }

    public function createFolder($folderName, $parentFolderId = null)
    {
        try {
            $parentId = $parentFolderId ?? $this->parentFolderId;
            
            $existingFolderId = $this->findFolder($folderName, $parentId);
            if ($existingFolderId) {
                Log::info('Using existing Google Drive folder', [
                    'folder_name' => $folderName,
                    'folder_id' => $existingFolderId
                ]);
                return $existingFolderId;
            }
            
            $fileMetadata = new GoogleDrive\DriveFile([
                'name' => $folderName,
                'mimeType' => 'application/vnd.google-apps.folder',
                'parents' => [$parentId]
            ]);
            
            $folder = $this->service->files->create($fileMetadata, [
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);
            
            $this->makeFileViewable($folder->id);
            
            Log::info('Google Drive folder created', [
                'folder_name' => $folderName,
                'folder_id' => $folder->id,
                'parent_id' => $parentId
            ]);
            
            return $folder->id;
        } catch (\Exception $e) {
            Log::error('Failed to create Google Drive folder', [
                'folder_name' => $folderName,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    /**
     * Upload content already held in memory, with no file on disk.
     *
     * uploadFile() takes a path or an UploadedFile and reads it, which means
     * whatever is being uploaded has to be written somewhere first. A document
     * generated in memory has no reason to touch the filesystem at all — and on
     * a server where the storage directory is not writable by the web user, it
     * cannot. This is the same upload, given the bytes directly.
     *
     * No image resizing here: this path exists for generated documents, and
     * resizing is uploadFile()'s concern for photographs.
     *
     * @return string  the shareable Drive URL
     */
    public function uploadContent(string $content, $folderId, string $fileName, string $mimeType = 'application/octet-stream')
    {
        try {
            $fileMetadata = new GoogleDrive\DriveFile([
                'name' => $fileName,
                'parents' => [$folderId]
            ]);

            $uploadedFile = $this->service->files->create($fileMetadata, [
                'data' => $content,
                'mimeType' => $mimeType,
                'uploadType' => 'multipart',
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);

            $this->makeFileViewable($uploadedFile->id);

            $fileUrl = 'https://drive.google.com/file/d/' . $uploadedFile->id . '/view';

            Log::info('Content uploaded to Google Drive', [
                'file_name' => $fileName,
                'file_id'   => $uploadedFile->id,
                'folder_id' => $folderId,
                'bytes'     => strlen($content),
                'url'       => $fileUrl,
            ]);

            return $fileUrl;
        } catch (\Exception $e) {
            Log::error('Failed to upload content to Google Drive', [
                'file_name' => $fileName,
                'folder_id' => $folderId,
                'error'     => $e->getMessage()
            ]);
            throw $e;
        }
    }

    public function uploadFile($file, $folderId, $fileName, $mimeType = null)
    {
        try {
            $fileMetadata = new GoogleDrive\DriveFile([
                'name' => $fileName,
                'parents' => [$folderId]
            ]);
            
            if (is_string($file)) {
                $content = file_get_contents($file);
                $detectedMimeType = $mimeType ?? mime_content_type($file);
            } else {
                $content = file_get_contents($file->getRealPath());
                $detectedMimeType = $mimeType ?? $file->getMimeType();
            }

            if ($this->isImageMimeType($detectedMimeType)) {
                $percentage = $this->getActiveImageSizePercentage();
                $content = $this->resizeImage($content, $detectedMimeType, $percentage);
            }
            
            $uploadedFile = $this->service->files->create($fileMetadata, [
                'data' => $content,
                'mimeType' => $detectedMimeType,
                'uploadType' => 'multipart',
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);
            
            $this->makeFileViewable($uploadedFile->id);
            
            $fileUrl = 'https://drive.google.com/file/d/' . $uploadedFile->id . '/view';
            
            Log::info('File uploaded to Google Drive', [
                'file_name' => $fileName,
                'file_id' => $uploadedFile->id,
                'folder_id' => $folderId,
                'url' => $fileUrl
            ]);
            
            return $fileUrl;
        } catch (\Exception $e) {
            Log::error('Failed to upload file to Google Drive', [
                'file_name' => $fileName,
                'folder_id' => $folderId,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    private function isImageMimeType($mimeType)
    {
        $imageMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        return in_array($mimeType, $imageMimeTypes);
    }

    private function makeFileViewable($fileId)
    {
        try {
            $permission = new GoogleDrive\Permission([
                'type' => 'anyone',
                'role' => 'reader'
            ]);

            $this->service->permissions->create($fileId, $permission, [
                'supportsAllDrives' => true
            ]);
            
            Log::info("Set file {$fileId} to viewable by anyone with link");

        } catch (\Exception $e) {
            Log::warning('Could not set file permissions (may inherit from parent): ' . $e->getMessage());
        }
    }

    public function deleteFile($fileId)
    {
        try {
            $this->service->files->delete($fileId, [
                'supportsAllDrives' => true
            ]);
            
            Log::info('File deleted from Google Drive', [
                'file_id' => $fileId
            ]);
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to delete file from Google Drive', [
                'file_id' => $fileId,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    public function getFileMetadata($fileId)
    {
        try {
            $file = $this->service->files->get($fileId, [
                'fields' => 'id, name, mimeType, size, createdTime, modifiedTime',
                'supportsAllDrives' => true
            ]);
            
            return $file;
        } catch (\Exception $e) {
            Log::error('Failed to get file metadata from Google Drive', [
                'file_id' => $fileId,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    public function listFilesInFolder($folderId)
    {
        try {
            $response = $this->service->files->listFiles([
                'q' => "'{$folderId}' in parents and trashed=false",
                'fields' => 'files(id, name, mimeType, size, createdTime, modifiedTime)',
                'supportsAllDrives' => true,
                'includeItemsFromAllDrives' => true
            ]);
            
            return $response->getFiles();
        } catch (\Exception $e) {
            Log::error('Failed to list files in Google Drive folder', [
                'folder_id' => $folderId,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    public function moveFile($fileId, $newFolderId)
    {
        try {
            $file = $this->service->files->get($fileId, [
                'fields' => 'parents',
                'supportsAllDrives' => true
            ]);
            $previousParents = implode(',', $file->parents);
            
            $file = $this->service->files->update($fileId, new GoogleDrive\DriveFile(), [
                'addParents' => $newFolderId,
                'removeParents' => $previousParents,
                'fields' => 'id, parents',
                'supportsAllDrives' => true
            ]);
            
            Log::info('File moved in Google Drive', [
                'file_id' => $fileId,
                'new_folder_id' => $newFolderId
            ]);
            
            return true;
        } catch (\Exception $e) {
            Log::error('Failed to move file in Google Drive', [
                'file_id' => $fileId,
                'new_folder_id' => $newFolderId,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }

    public function searchFiles($query)
    {
        try {
            $response = $this->service->files->listFiles([
                'q' => $query,
                'fields' => 'files(id, name, mimeType, size, createdTime, modifiedTime)',
                'supportsAllDrives' => true,
                'includeItemsFromAllDrives' => true
            ]);
            
            return $response->getFiles();
        } catch (\Exception $e) {
            Log::error('Failed to search files in Google Drive', [
                'query' => $query,
                'error' => $e->getMessage()
            ]);
            throw $e;
        }
    }
}



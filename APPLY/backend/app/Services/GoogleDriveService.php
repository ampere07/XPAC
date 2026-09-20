<?php

namespace App\Services;

use Google\Client;
use Google\Service\Drive;
use Google\Service\Drive\DriveFile;
use Google\Service\Drive\Permission;
use Illuminate\Support\Facades\Log;
use App\Services\ImageResizeService;

class GoogleDriveService
{
    private $client;
    private $driveService;
    private $folderId;

    public function __construct()
    {
        $this->client = new Client();
        $this->client->setApplicationName('AmpereCBMS');
        $this->client->setScopes([Drive::DRIVE_FILE]);
        $this->client->setAuthConfig([
            'type' => 'service_account',
            'project_id' => config('services.google.project_id'),
            'private_key_id' => config('services.google.private_key_id'),
            'private_key' => config('services.google.private_key'),
            'client_email' => config('services.google.client_email'),
            'client_id' => config('services.google.client_id'),
            'auth_uri' => 'https://accounts.google.com/o/oauth2/auth',
            'token_uri' => 'https://oauth2.googleapis.com/token',
            'auth_provider_x509_cert_url' => 'https://www.googleapis.com/oauth2/v1/certs',
        ]);

        $this->driveService = new Drive($this->client);
        $this->folderId = config('services.google.folder_id');
    }

    public function uploadApplicationDocuments($fullName, $files)
    {
        try {
            Log::info('=== STEP 2: STARTING GOOGLE DRIVE UPLOAD ===', [
                'applicant' => $fullName,
                'parent_folder_id' => $this->folderId,
                'note' => 'All images have already been resized in Step 1'
            ]);

            $applicantFolderId = $this->createApplicantFolder($fullName);
            
            if (!$applicantFolderId) {
                throw new \Exception('Failed to create applicant folder');
            }

            Log::info('Applicant folder created in Google Drive', ['folder_id' => $applicantFolderId]);

            $uploadedUrls = [];

            $fieldMapping = [
                'proofOfBilling' => 'proof_of_billing_url',
                'governmentIdPrimary' => 'government_valid_id_url',
                'governmentIdSecondary' => 'second_government_valid_id_url',
                'houseFrontPicture' => 'house_front_picture_url',
                'promoProof' => 'promo_url',
            ];

            foreach ($files as $fieldName => $filePath) {
                if (empty($filePath) || !file_exists($filePath)) {
                    Log::warning("File not found for {$fieldName}: {$filePath}");
                    continue;
                }

                try {
                    $dbFieldName = $fieldMapping[$fieldName] ?? null;
                    if (!$dbFieldName) {
                        Log::warning("No database field mapping for {$fieldName}");
                        continue;
                    }

                    $fileId = $this->uploadFile($filePath, $applicantFolderId, $fieldName);
                    if ($fileId) {
                        $viewUrl = "https://drive.google.com/file/d/{$fileId}/view";
                        $uploadedUrls[$dbFieldName] = $viewUrl;
                        Log::info("Successfully uploaded to Google Drive: {$fieldName}", [
                            'file_id' => $fileId,
                            'url' => $viewUrl
                        ]);
                    }
                } catch (\Exception $e) {
                    Log::error("Failed to upload {$fieldName}: " . $e->getMessage());
                }
            }

            Log::info('=== STEP 2 COMPLETED: ALL RESIZED IMAGES UPLOADED TO GOOGLE DRIVE ===', [
                'applicant' => $fullName,
                'folder_id' => $applicantFolderId,
                'files_uploaded' => count($uploadedUrls)
            ]);

            return $uploadedUrls;

        } catch (\Exception $e) {
            Log::error('Google Drive upload error: ' . $e->getMessage());
            throw $e;
        }
    }

    private function createApplicantFolder($fullName)
    {
        try {
            Log::info('Creating applicant folder', [
                'name' => $fullName,
                'parent' => $this->folderId
            ]);

            $folderMetadata = new DriveFile([
                'name' => $fullName,
                'mimeType' => 'application/vnd.google-apps.folder',
                'parents' => [$this->folderId]
            ]);

            $folder = $this->driveService->files->create($folderMetadata, [
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);

            Log::info("Folder created successfully", [
                'folder_id' => $folder->id,
                'folder_name' => $fullName
            ]);

            return $folder->id;

        } catch (\Exception $e) {
            Log::error('Failed to create folder: ' . $e->getMessage());
            throw $e;
        }
    }

    private function uploadFile($filePath, $folderId, $fieldName)
    {
        try {
            $fileName = $this->generateFileName($fieldName, $filePath);
            $mimeType = mime_content_type($filePath);
            $fileSize = filesize($filePath);
            
            $isImage = ImageResizeService::isImageFile($mimeType);
            
            if ($isImage) {
                Log::info('Uploading RESIZED image to Google Drive', [
                    'field' => $fieldName,
                    'file_name' => $fileName,
                    'folder_id' => $folderId,
                    'mime_type' => $mimeType,
                    'resized_file_size' => $fileSize . ' bytes',
                    'note' => 'This image was already resized in Step 1 based on active settings from settings_image_size table'
                ]);
            } else {
                Log::info('Uploading file to Google Drive', [
                    'field' => $fieldName,
                    'file_name' => $fileName,
                    'folder_id' => $folderId,
                    'mime_type' => $mimeType,
                    'file_size' => $fileSize . ' bytes',
                    'note' => 'PDF file - no resizing applied'
                ]);
            }

            $fileMetadata = new DriveFile([
                'name' => $fileName,
                'parents' => [$folderId]
            ]);

            $content = file_get_contents($filePath);

            $file = $this->driveService->files->create($fileMetadata, [
                'data' => $content,
                'mimeType' => $mimeType,
                'uploadType' => 'multipart',
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);

            $this->makeFileViewable($file->id);

            return $file->id;

        } catch (\Exception $e) {
            Log::error('Failed to upload file: ' . $e->getMessage());
            throw $e;
        }
    }

    private function makeFileViewable($fileId)
    {
        try {
            $permission = new Permission([
                'type' => 'anyone',
                'role' => 'reader'
            ]);

            $this->driveService->permissions->create($fileId, $permission, [
                'supportsAllDrives' => true
            ]);
            
            Log::info("Set file {$fileId} to viewable by anyone with link");

        } catch (\Exception $e) {
            Log::error('Failed to set file permissions: ' . $e->getMessage());
        }
    }

    private function generateFileName($fieldName, $filePath)
    {
        $extension = pathinfo($filePath, PATHINFO_EXTENSION);
        
        $nameMap = [
            'proofOfBilling' => 'Proof_of_Billing',
            'governmentIdPrimary' => 'Government_ID_Primary',
            'governmentIdSecondary' => 'Government_ID_Secondary',
            'houseFrontPicture' => 'House_Front_Picture',
            'promoProof' => 'Promo_Proof',
        ];

        $documentType = $nameMap[$fieldName] ?? $fieldName;
        
        return $documentType . '.' . $extension;
    }

    public function uploadFormLogo($filePath, $brandName = null)
    {
        try {
            $folderName = $brandName ? "Logo - {$brandName}" : "Logo";
            
            Log::info('Starting form logo upload', [
                'folder_name' => $folderName,
                'parent_folder_id' => $this->folderId
            ]);

            $logoFolderId = $this->findOrCreateFolder($folderName);
            
            if (!$logoFolderId) {
                throw new \Exception('Failed to create or find logo folder');
            }

            Log::info('Logo folder ready', ['folder_id' => $logoFolderId]);

            $fileName = 'logo_' . time() . '.' . pathinfo($filePath, PATHINFO_EXTENSION);
            $mimeType = mime_content_type($filePath);
            $fileSize = filesize($filePath);
            
            $isImage = ImageResizeService::isImageFile($mimeType);
            
            if ($isImage) {
                Log::info('Uploading resized logo image to Google Drive', [
                    'name' => $fileName,
                    'folder_id' => $logoFolderId,
                    'mime' => $mimeType,
                    'size' => $fileSize,
                    'note' => 'Logo was resized based on active settings before upload'
                ]);
            } else {
                Log::info('Uploading logo file', [
                    'name' => $fileName,
                    'folder_id' => $logoFolderId,
                    'mime' => $mimeType,
                    'size' => $fileSize
                ]);
            }

            $fileMetadata = new DriveFile([
                'name' => $fileName,
                'parents' => [$logoFolderId]
            ]);

            $content = file_get_contents($filePath);

            $file = $this->driveService->files->create($fileMetadata, [
                'data' => $content,
                'mimeType' => $mimeType,
                'uploadType' => 'multipart',
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);

            $this->makeFileViewable($file->id);

            $viewUrl = "https://drive.google.com/file/d/{$file->id}/view";
            
            Log::info('Logo uploaded successfully', [
                'file_id' => $file->id,
                'url' => $viewUrl
            ]);

            return $viewUrl;

        } catch (\Exception $e) {
            Log::error('Failed to upload logo: ' . $e->getMessage());
            throw $e;
        }
    }

    private function findOrCreateFolder($folderName)
    {
        try {
            $query = "name = '{$folderName}' and mimeType = 'application/vnd.google-apps.folder' and '{$this->folderId}' in parents and trashed = false";
            
            $response = $this->driveService->files->listFiles([
                'q' => $query,
                'fields' => 'files(id, name)',
                'supportsAllDrives' => true,
                'includeItemsFromAllDrives' => true
            ]);

            if (count($response->files) > 0) {
                Log::info('Found existing folder', [
                    'folder_name' => $folderName,
                    'folder_id' => $response->files[0]->id
                ]);
                return $response->files[0]->id;
            }

            Log::info('Creating new folder', [
                'name' => $folderName,
                'parent' => $this->folderId
            ]);

            $folderMetadata = new DriveFile([
                'name' => $folderName,
                'mimeType' => 'application/vnd.google-apps.folder',
                'parents' => [$this->folderId]
            ]);

            $folder = $this->driveService->files->create($folderMetadata, [
                'fields' => 'id',
                'supportsAllDrives' => true
            ]);

            Log::info('Folder created successfully', [
                'folder_id' => $folder->id,
                'folder_name' => $folderName
            ]);

            return $folder->id;

        } catch (\Exception $e) {
            Log::error('Failed to find or create folder: ' . $e->getMessage());
            throw $e;
        }
    }
}

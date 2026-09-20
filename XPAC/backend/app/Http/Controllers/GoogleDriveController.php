<?php

namespace App\Http\Controllers;

use App\Services\GoogleDriveService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class GoogleDriveController extends Controller
{
    private $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;
    }

    public function upload(Request $request): JsonResponse
    {
        try {
            $validator = Validator::make($request->all(), [
                'file' => 'required|file|mimes:jpg,jpeg,png,gif,webp|max:10240'
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'success' => false,
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $file = $request->file('file');
            $folderName = 'ServiceOrderImages';
            $folderId = $this->googleDriveService->findFolder($folderName);

            if (!$folderId) {
                $folderId = $this->googleDriveService->createFolder($folderName);
            }

            $fileName = time() . '_' . $file->getClientOriginalName();
            $fileUrl = $this->googleDriveService->uploadFile($file, $folderId, $fileName);

            Log::info('Image uploaded successfully via GoogleDriveController', [
                'file_name' => $fileName,
                'url' => $fileUrl
            ]);

            return response()->json([
                'success' => true,
                'data' => [
                    'url' => $fileUrl
                ],
                'message' => 'Image uploaded successfully'
            ]);

        } catch (\Exception $e) {
            Log::error('Error uploading image to Google Drive', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to upload image: ' . $e->getMessage()
            ], 500);
        }
    }
}

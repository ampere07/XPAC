<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Services\GoogleDriveService;

class ApplicationVisitImageController extends Controller
{
    private $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;
    }

    public function uploadImages(Request $request, $id)
    {
        try {
            Log::info('Starting image upload for application visit', [
                'visit_id' => $id,
                'first_name' => $request->input('first_name'),
                'last_name' => $request->input('last_name')
            ]);

            $request->validate([
                'first_name' => 'required|string',
                'middle_initial' => 'nullable|string|max:1',
                'last_name' => 'required|string',
                'image1' => 'nullable|image|max:10240',
                'image2' => 'nullable|image|max:10240',
                'image3' => 'nullable|image|max:10240'
            ]);

            $firstName = $request->input('first_name');
            $middleInitial = $request->input('middle_initial', '');
            $lastName = $request->input('last_name');
            
            $folderName = '(applicationvisit)' . $firstName;
            if (!empty($middleInitial)) {
                $folderName .= ' ' . strtoupper($middleInitial);
            }
            $folderName .= ' ' . $lastName;

            Log::info('Creating folder', ['folder_name' => $folderName]);
            $folderId = $this->googleDriveService->createFolder($folderName);
            Log::info('Folder created', ['folder_id' => $folderId]);

            $imageUrls = [];

            if ($request->hasFile('image1')) {
                Log::info('Uploading image1');
                $imageUrls['image1_url'] = $this->googleDriveService->uploadFile(
                    $request->file('image1'),
                    $folderId,
                    'image1'
                );
            }

            if ($request->hasFile('image2')) {
                Log::info('Uploading image2');
                $imageUrls['image2_url'] = $this->googleDriveService->uploadFile(
                    $request->file('image2'),
                    $folderId,
                    'image2'
                );
            }

            if ($request->hasFile('image3')) {
                Log::info('Uploading image3');
                $imageUrls['image3_url'] = $this->googleDriveService->uploadFile(
                    $request->file('image3'),
                    $folderId,
                    'image3'
                );
            }

            $visit = \App\Models\ApplicationVisit::findOrFail($id);
            $visit->update($imageUrls);

            Log::info('Images uploaded successfully', ['image_urls' => $imageUrls]);

            return response()->json([
                'success' => true,
                'message' => 'Images uploaded successfully',
                'data' => $imageUrls
            ]);

        } catch (\Illuminate\Validation\ValidationException $e) {
            Log::error('Validation error', ['errors' => $e->errors()]);
            return response()->json([
                'success' => false,
                'message' => 'Validation error',
                'errors' => $e->errors()
            ], 422);
        } catch (\Exception $e) {
            Log::error('Error uploading images', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
            
            return response()->json([
                'success' => false,
                'message' => 'Failed to upload images: ' . $e->getMessage()
            ], 500);
        }
    }
}

<?php

namespace App\Http\Controllers;

use App\Models\ApplicationDocument;
use App\Services\TableCheckService;
use App\Services\ImageResizeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;

class ApplicationDocumentController extends Controller
{
    /**
     * Store a newly uploaded document
     *
     * @param  \Illuminate\Http\Request  $request
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
        // Ensure all required tables exist
        $tableResults = TableCheckService::ensureAllRequiredTablesExist();
        
        // Check for any failures
        $allTablesExist = !in_array(false, $tableResults, true);
        
        if (!$allTablesExist) {
            Log::error('One or more required tables could not be created. Document upload failed.');
            return response()->json([
                'message' => 'Document upload failed due to database error.'
            ], 500);
        }
        
        $validator = Validator::make($request->all(), [
            'document_type' => 'required|string|max:255',
            'document' => 'required|file|mimes:jpeg,png,jpg,pdf,doc,docx|max:10240',
            'application_id' => 'required|exists:APP_APPLICATIONS,id'
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $file = $request->file('document');
        $originalName = $file->getClientOriginalName();
        $fileType = $file->getClientMimeType();
        $fileSize = $file->getSize();
        
        // Generate a unique filename
        $fileName = time() . '_' . uniqid() . '.' . $file->getClientOriginalExtension();
        
        // Make sure the directory exists
        $destinationPath = public_path('assets/documents');
        if (!file_exists($destinationPath)) {
            mkdir($destinationPath, 0755, true);
        }
        
        $finalPath = $destinationPath . '/' . $fileName;
        
        // Check if file is an image and resize if needed
        if (ImageResizeService::isImageFile($fileType)) {
            Log::info('Image detected - applying active resize settings', [
                'file_name' => $originalName,
                'mime_type' => $fileType,
                'destination' => 'backend'
            ]);
            
            $tempPath = $file->getPathname();
            $resized = ImageResizeService::resizeImage($tempPath, $finalPath);
            
            if ($resized) {
                Log::info('Image successfully resized for backend storage', [
                    'file_name' => $fileName,
                    'original_size' => $fileSize,
                    'resized_size' => filesize($finalPath)
                ]);
            } else {
                Log::warning('Image resize failed, saving original', ['file_name' => $fileName]);
                // If resize fails, fallback to normal file move
                $file->move($destinationPath, $fileName);
            }
            
            // Update file size after resize
            if (file_exists($finalPath)) {
                $fileSize = filesize($finalPath);
            }
        } else {
            // Not an image, move as normal
            $file->move($destinationPath, $fileName);
        }
        
        // Create the document record
        $document = ApplicationDocument::create([
            'application_id' => $request->application_id,
            'document_type' => $request->document_type,
            'document_name' => $originalName,
            'file_path' => 'assets/documents/' . $fileName,
            'file_type' => $fileType,
            'file_size' => $fileSize,
            'verification_status' => 'pending',
        ]);

        return response()->json([
            'message' => 'Document uploaded successfully',
            'document' => $document
        ], 201);
    }

    /**
     * Get all documents for an application
     *
     * @param  int  $applicationId
     * @return \Illuminate\Http\Response
     */
    public function getUserDocuments($applicationId = null)
    {
        if ($applicationId) {
            $documents = ApplicationDocument::where('application_id', $applicationId)->get();
        } else {
            // If no application ID is provided, return error
            return response()->json([
                'message' => 'Application ID is required'
            ], 400);
        }
        
        return response()->json([
            'documents' => $documents
        ]);
    }

    /**
     * Get a specific document
     *
     * @param  int  $id
     * @return \Illuminate\Http\Response
     */
    public function show($id)
    {
        $document = ApplicationDocument::findOrFail($id);
        
        // No authentication check needed as we're not using users table
        
        return response()->json([
            'document' => $document
        ]);
    }

    /**
     * Update document verification status (admin only)
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  int  $id
     * @return \Illuminate\Http\Response
     */
    public function updateVerification(Request $request, $id)
    {
        // This should be protected by admin middleware in routes
        $validator = Validator::make($request->all(), [
            'verification_status' => 'required|string|in:pending,verified,rejected',
            'verification_notes' => 'nullable|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        $document = ApplicationDocument::findOrFail($id);
        
        $document->verification_status = $request->verification_status;
        $document->verification_notes = $request->verification_notes;
        
        if ($request->verification_status === 'verified') {
            $document->is_verified = true;
            $document->verified_at = now();
            // No auth()->id() since we're not using users table
            $document->verified_by = null;
        } else {
            $document->is_verified = false;
            $document->verified_at = null;
            $document->verified_by = null;
        }
        
        $document->save();
        
        return response()->json([
            'message' => 'Document verification status updated',
            'document' => $document
        ]);
    }

    /**
     * Delete a document
     *
     * @param  int  $id
     * @return \Illuminate\Http\Response
     */
    public function destroy($id)
    {
        $document = ApplicationDocument::findOrFail($id);
        
        // No authentication check needed as we're not using users table
        
        // Delete the file
        $filePath = public_path($document->file_path);
        if (file_exists($filePath)) {
            unlink($filePath);
        }
        
        // Delete the record
        $document->delete();
        
        return response()->json([
            'message' => 'Document deleted successfully'
        ]);
    }
}

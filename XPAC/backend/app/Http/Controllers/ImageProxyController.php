<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ImageProxyController extends Controller
{
    public function proxyGoogleDriveImage(Request $request)
    {
        $url = $request->query('url');
        
        if (!$url) {
            return response()->json(['error' => 'URL parameter is required'], 400);
        }

        try {
            // Extract file ID from Google Drive URL
            $fileId = null;
            if (preg_match('/\/d\/([a-zA-Z0-9_-]+)/', $url, $matches)) {
                $fileId = $matches[1];
            } elseif (preg_match('/id=([a-zA-Z0-9_-]+)/', $url, $matches)) {
                $fileId = $matches[1];
            }

            if (!$fileId) {
                return response()->json(['error' => 'Invalid Google Drive URL'], 400);
            }

            // Construct direct download URL
            $directUrl = "https://drive.google.com/uc?export=download&id={$fileId}";
            
            // Fetch the image from Google Drive
            $response = Http::timeout(10)->get($directUrl);

            if ($response->failed()) {
                Log::error('Failed to fetch image from Google Drive', [
                    'url' => $directUrl,
                    'status' => $response->status()
                ]);
                return response()->json(['error' => 'Failed to fetch image'], 500);
            }

            // Get content type from response
            $contentType = $response->header('Content-Type') ?? 'image/png';

            // Return the image with proper headers
            return response($response->body())
                ->header('Content-Type', $contentType)
                ->header('Cache-Control', 'public, max-age=86400') // Cache for 24 hours
                ->header('Access-Control-Allow-Origin', '*');

        } catch (\Exception $e) {
            Log::error('Error proxying Google Drive image', [
                'error' => $e->getMessage(),
                'url' => $url
            ]);
            return response()->json(['error' => 'Internal server error'], 500);
        }
    }
}


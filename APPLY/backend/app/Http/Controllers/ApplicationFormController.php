<?php

namespace App\Http\Controllers;

use App\Models\Application;
use App\Services\GoogleDriveService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

class ApplicationFormController extends Controller
{
    protected $googleDriveService;

    public function __construct(GoogleDriveService $googleDriveService)
    {
        $this->googleDriveService = $googleDriveService;
    }

    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'email' => 'required|email|max:255',
                'mobile' => 'required|string|max:20',
                'firstName' => 'required|string|max:255',
                'lastName' => 'required|string|max:255',
                'middleInitial' => 'nullable|string|max:10',
                'secondaryMobile' => 'nullable|string|max:20',
                'region' => 'required|string|max:255',
                'city' => 'required|string|max:255',
                'barangay' => 'required|string|max:255',
                'installationAddress' => 'required|string',
                'landmark' => 'required|string|max:255',
                'referredBy' => 'nullable|string|max:255',
                'plan' => 'required|string|max:255',
                'promo' => 'nullable|string|max:255',

                'proofOfBilling' => 'required|file|mimes:jpeg,jpg,png,pdf|max:2048',
                'governmentIdPrimary' => 'required|file|mimes:jpeg,jpg,png,pdf|max:2048',
                'governmentIdSecondary' => 'nullable|file|mimes:jpeg,jpg,png,pdf|max:2048',
                'houseFrontPicture' => 'required|file|mimes:jpeg,jpg,png|max:2048',
                'promoProof' => 'nullable|file|mimes:jpeg,jpg,png,pdf|max:2048',
            ]);

            if ($validator->fails()) {
                return response()->json(['errors' => $validator->errors()], 422);
            }

            $existingApplication = Application::where('email_address', $request->email)->first();
                
            if ($existingApplication) {
                return response()->json([
                    'message' => 'An application with this email already exists.',
                    'errors' => ['email' => ['This email is already registered. Please use a different email or contact support.']]
                ], 422);
            }

            $fullName = trim($request->firstName . ' ' . ($request->middleInitial ? $request->middleInitial . '. ' : '') . $request->lastName);

            $localDocumentPaths = $this->handleLocalDocumentUploads($request);
            
            $googleDriveUrls = [];
            try {
                $filesToUpload = [];
                
                foreach ($localDocumentPaths as $fieldName => $localPath) {
                    if ($localPath) {
                        $fullPath = public_path($localPath);
                        $filesToUpload[$fieldName] = $fullPath;
                    }
                }

                $googleDriveUrls = $this->googleDriveService->uploadApplicationDocuments($fullName, $filesToUpload);
                
                Log::info('Google Drive upload completed', ['urls' => $googleDriveUrls]);
                
            } catch (\Exception $e) {
                Log::error('Google Drive upload failed: ' . $e->getMessage());
            }
            
            $applicationData = [
                'timestamp' => now()->timezone('Asia/Manila'),
                'email_address' => $request->email,
                'mobile_number' => $request->mobile,
                'first_name' => $request->firstName,
                'last_name' => $request->lastName,
                'middle_initial' => $request->middleInitial,
                'secondary_mobile_number' => $request->secondaryMobile,
                'region' => $request->region,
                'city' => $request->city,
                'barangay' => $request->barangay,
                'installation_address' => $request->installationAddress,
                'landmark' => $request->landmark,
                'referred_by' => $request->referredBy,
                'desired_plan' => $request->plan,
                'promo' => $request->promo ?? 'None',
                'status' => 'pending',
                'terms_agreed' => true,
            ];

            $applicationData = array_merge($applicationData, $googleDriveUrls);

            Log::info('Attempting to create application:', $applicationData);

            $application = Application::create($applicationData);
            
            if ($application) {
                Log::info('Application created successfully with ID: ' . $application->id);
                
                return response()->json([
                    'message' => 'Application submitted successfully',
                    'application_id' => $application->id,
                    'application' => $application
                ], 201);
            } else {
                throw new \Exception('Failed to create application');
            }
            
        } catch (\Exception $e) {
            Log::error('Application submission error: ' . $e->getMessage());
            Log::error('Stack trace: ' . $e->getTraceAsString());
            
            return response()->json([
                'message' => 'Application submission failed: ' . $e->getMessage()
            ], 500);
        }
    }

    private function handleLocalDocumentUploads(Request $request)
    {
        $documentPaths = [];

        $documentMappings = [
            'proofOfBilling' => 'proofOfBilling',
            'governmentIdPrimary' => 'governmentIdPrimary',
            'governmentIdSecondary' => 'governmentIdSecondary',
            'houseFrontPicture' => 'houseFrontPicture',

            'promoProof' => 'promoProof',
        ];

        $documentsPath = public_path('assets/documents');
        if (!file_exists($documentsPath)) {
            mkdir($documentsPath, 0755, true);
        }

        foreach ($documentMappings as $requestKey => $fieldKey) {
            if ($request->hasFile($requestKey)) {
                try {
                    $file = $request->file($requestKey);
                    $fileName = time() . '_' . uniqid() . '.' . $file->getClientOriginalExtension();
                    
                    if ($file->move($documentsPath, $fileName)) {
                        $documentPaths[$fieldKey] = 'assets/documents/' . $fileName;
                        Log::info("Successfully uploaded locally: {$fileName} for {$requestKey}");
                    }
                } catch (\Exception $e) {
                    Log::error("Failed to upload locally {$requestKey}: " . $e->getMessage());
                    $documentPaths[$fieldKey] = null;
                }
            }
        }

        return $documentPaths;
    }

    public function index()
    {
        try {
            $applications = Application::orderBy('id', 'desc')->paginate(10);
            
            return response()->json(['applications' => $applications]);
            
        } catch (\Exception $e) {
            Log::error('Error fetching applications: ' . $e->getMessage());
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    public function show($id)
    {
        try {
            $application = Application::where('id', $id)->first();

            if (!$application) {
                return response()->json(['error' => 'Application not found'], 404);
            }
            
            return response()->json(['application' => $application]);
            
        } catch (\Exception $e) {
            Log::error('Error fetching application: ' . $e->getMessage());
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    public function debug()
    {
        try {
            $applicationCount = Application::count();
            $sampleApplication = Application::first();
            $recentApplications = Application::orderBy('id', 'desc')->limit(3)->get();

            return response()->json([
                'application_count' => $applicationCount,
                'sample_application' => $sampleApplication,
                'recent_applications' => $recentApplications,
                'php_version' => phpversion(),
                'laravel_version' => app()->version(),
                'database_connection' => DB::connection()->getName()
            ]);
            
        } catch (\Exception $e) {
            Log::error('Debug endpoint error: ' . $e->getMessage());
            return response()->json([
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);
        }
    }

    public function resetTable()
    {
        try {
            Application::query()->delete();
            Log::info('All applications deleted successfully');
            
            return response()->json(['message' => 'Table reset successfully']);
        } catch (\Exception $e) {
            Log::error('Error resetting table: ' . $e->getMessage());
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}


<?php

namespace App\Http\Controllers;

use App\Models\Application;
use App\Models\ImageQueue;
use App\Models\Plan;
use App\Models\PromoList;
use App\Services\ImageResizeService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use App\Models\SMSTemplate;
use App\Services\EmailQueueService;
use App\Services\ItexmoSmsService;

class ApplicationController extends Controller
{
    public function store(Request $request)
    {
        try {
            $validator = Validator::make($request->all(), [
                'email' => 'required|email|max:255',
                'mobile' => 'required|string|regex:/^09[0-9]{9}$/',
                'firstName' => 'required|string|max:255',
                'lastName' => 'required|string|max:255',
                'middleInitial' => 'nullable|string|max:1',
                'secondaryMobile' => 'nullable|string|regex:/^09[0-9]{9}$/',
                'region' => 'required|string|max:255',
                'city' => 'required|string|max:255',
                'barangay' => 'required|string|max:255',
                'location' => 'nullable|string|max:255',
                'installationAddress' => 'required|string',
                'coordinates' => 'nullable|string|max:255',
                'landmark' => 'required|string|max:255',
                'referredBy' => 'nullable|string|max:255',
                'plan' => 'required|string|max:255',
                'promo' => 'nullable|string|max:255',
                'proofOfBilling' => 'required|file|mimes:jpg,jpeg,png,pdf|max:10240',
                'governmentIdPrimary' => 'required|file|mimes:jpg,jpeg,png,pdf|max:10240',
                'governmentIdSecondary' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:10240',
                'houseFrontPicture' => 'required|file|mimes:jpg,jpeg,png|max:10240',
                'promoProof' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:10240',
                'created_by_email' => 'nullable|email|max:255',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $fullName = trim($request->firstName . ' ' . ($request->middleInitial ? $request->middleInitial . '. ' : '') . $request->lastName);

            Log::info('=== APPLICATION FORM SUBMITTED ===', [
                'applicant' => $fullName,
                'email' => $request->email
            ]);

            DB::beginTransaction();

            try {
                $application = new Application();
                
                $application->timestamp = now()->timezone('Asia/Manila');
                $application->email_address = $request->email;
                $application->mobile_number = $request->mobile;
                $application->first_name = $request->firstName;
                $application->last_name = $request->lastName;
                $application->middle_initial = $request->middleInitial;
                $application->secondary_mobile_number = $request->secondaryMobile;
                $application->region = $request->region;
                $application->city = $request->city;
                $application->barangay = $request->barangay;
                $application->location = $request->location;
                $application->installation_address = $request->installationAddress;
                $application->long_lat = $request->coordinates;
                $application->landmark = $request->landmark;
                $application->referred_by = $request->referredBy;
                
                $plan = Plan::find($request->plan);
                if ($plan) {
                    $application->desired_plan = $plan->plan_name . ' - ' . number_format($plan->price, 2);
                } else {
                    $application->desired_plan = $request->plan;
                }
                
                if ($request->promo && $request->promo !== '') {
                    $application->promo = $request->promo;
                } else {
                    $application->promo = 'None';
                }
                
                $application->terms_agreed = true;
                $application->status = 'pending';
                
                $application->proof_of_billing_url = 'processing';
                $application->government_valid_id_url = 'processing';
                $application->house_front_picture_url = 'processing';
                
                if ($request->has('created_by_email')) {
                    $user = DB::table('users')->where('email_address', $request->created_by_email)->first();
                    if ($user) {
                        $application->created_by_user_id = $user->id;
                    }
                }

                $application->save();

                Log::info('Application record created', ['application_id' => $application->id]);

                $imagePath = public_path('storage/images');
                if (!file_exists($imagePath)) {
                    mkdir($imagePath, 0755, true);
                    Log::info('Created images directory', ['path' => $imagePath]);
                }

                $imageFieldMapping = [
                    'proofOfBilling' => 'proof_of_billing_url',
                    'governmentIdPrimary' => 'government_valid_id_url',
                    'governmentIdSecondary' => 'second_government_valid_id_url',
                    'houseFrontPicture' => 'house_front_picture_url',
                    'promoProof' => 'promo_url',
                ];

                foreach ($imageFieldMapping as $requestKey => $dbField) {
                    if ($request->hasFile($requestKey)) {
                        try {
                            $file = $request->file($requestKey);
                            $originalName = $file->getClientOriginalName();
                            $fileName = $application->id . '_' . $dbField . '_' . time() . '_' . uniqid() . '.' . $file->getClientOriginalExtension();
                            $localPath = $imagePath . '/' . $fileName;
                            
                            $file->move($imagePath, $fileName);
                            
                            Log::info("Saved image to local storage", [
                                'field' => $dbField,
                                'file_name' => $fileName,
                                'path' => $localPath
                            ]);

                            ImageQueue::create([
                                'application_id' => $application->id,
                                'field_name' => $dbField,
                                'local_path' => $localPath,
                                'original_filename' => $originalName,
                                'status' => 'pending',
                            ]);

                            Log::info("Added to image queue", ['field' => $dbField, 'application_id' => $application->id]);

                        } catch (\Exception $e) {
                            Log::error("Failed to save image locally: {$requestKey}", [
                                'error' => $e->getMessage(),
                                'application_id' => $application->id
                            ]);
                            throw $e;
                        }
                    }
                }

                DB::commit();

                Log::info('Application submitted successfully with queued images', [
                    'application_id' => $application->id,
                    'email' => $application->email_address,
                    'queued_images' => ImageQueue::where('application_id', $application->id)->count()
                ]);

                try {
                    $emailQueueService = app(EmailQueueService::class);
                    $variables = [
                        'recipient_email' => $application->email_address,
                        'account_no' => $application->id,
                        'first_name' => $application->first_name,
                        'last_name' => $application->last_name,
                        'middle_initial' => $application->middle_initial,
                        'mobile_number' => $application->mobile_number,
                        'desired_plan' => $application->desired_plan,
                        'portal_url' => config('app.url'),
                        'company_name' => config('app.name', 'Ampere'),
                        'application_id' => $application->id,
                        'status' => $application->status,
                    ];
                    
                    $emailQueueService->queueFromTemplate('APPLICATION', $variables);
                    Log::info('Successfully queued Application email to ' . $application->email_address);

                    $smsTemplate = SMSTemplate::where('template_type', 'Application')
                        ->where('is_active', true)
                        ->first();

                    if ($smsTemplate && $application->mobile_number) {
                        $smsService = app(ItexmoSmsService::class);
                        
                        $message = $smsTemplate->message_content;
                        
                        foreach ($variables as $key => $value) {
                            $message = str_replace('{{' . $key . '}}', $value ?? '', $message);
                        }
                        
                        $smsService->send([
                            'contact_no' => $application->mobile_number,
                            'message' => $message
                        ]);
                        Log::info('Successfully sent Application SMS to ' . $application->mobile_number);
                    }
                } catch (\Throwable $notifyException) {
                    Log::error('Failed to send application notification (Email/SMS)', [
                        'application_id' => $application->id,
                        'error' => $notifyException->getMessage()
                    ]);
                }

                return response()->json([
                    'message' => 'Application submitted successfully. Images will be processed shortly.',
                    'application' => $application
                ], 201);

            } catch (\Exception $e) {
                DB::rollBack();
                throw $e;
            }

        } catch (\Throwable $e) {
            Log::error('Application submission failed', [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString()
            ]);

            return response()->json([
                'message' => 'Failed to submit application',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function index(Request $request)
    {
        try {
            $status = $request->query('status');
            
            $query = Application::query();
            
            if ($status) {
                $query->where('status', $status);
            }
            
            $applications = $query->orderBy('created_at', 'desc')->get();
            
            return response()->json([
                'applications' => $applications
            ]);

        } catch (\Exception $e) {
            Log::error('Failed to retrieve applications', [
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'message' => 'Failed to retrieve applications',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function show($id)
    {
        try {
            $application = Application::findOrFail($id);
            
            return response()->json([
                'application' => $application
            ]);

        } catch (\Exception $e) {
            Log::error('Application not found', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'message' => 'Application not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function updateStatus(Request $request, $id)
    {
        try {
            $validator = Validator::make($request->all(), [
                'status' => 'required|string|in:pending,approved,rejected',
            ]);

            if ($validator->fails()) {
                return response()->json([
                    'message' => 'Validation failed',
                    'errors' => $validator->errors()
                ], 422);
            }

            $application = Application::findOrFail($id);
            $application->status = $request->status;
            $application->save();

            return response()->json([
                'message' => 'Application status updated successfully',
                'application' => $application
            ]);

        } catch (\Exception $e) {
            Log::error('Failed to update application status', [
                'id' => $id,
                'error' => $e->getMessage()
            ]);

            return response()->json([
                'message' => 'Failed to update application status',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}


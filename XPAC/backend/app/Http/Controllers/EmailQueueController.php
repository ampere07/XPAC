<?php

namespace App\Http\Controllers;

use App\Models\EmailQueue;
use App\Services\EmailQueueService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class EmailQueueController extends Controller
{
    protected EmailQueueService $emailQueueService;

    public function __construct(EmailQueueService $emailQueueService)
    {
        $this->emailQueueService = $emailQueueService;
    }

    public function index(Request $request): JsonResponse
    {
        $query = EmailQueue::query();

        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        if ($request->has('account_no')) {
            $query->where('account_no', $request->account_no);
        }

        $emails = $query->orderBy('created_at', 'desc')
            ->paginate($request->get('per_page', 50));

        return response()->json($emails);
    }

    public function show(int $id): JsonResponse
    {
        $email = EmailQueue::findOrFail($id);
        return response()->json($email);
    }

    public function queueEmail(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'recipient_email' => 'required|email',
            'subject' => 'required|string|max:200',
            'body_html' => 'required|string',
            'account_no' => 'nullable|string|max:50',
            'cc' => 'nullable|string',
            'bcc' => 'nullable|string',
            'attachment_path' => 'nullable|string|max:255'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        $email = $this->emailQueueService->queueEmail($request->all());

        return response()->json([
            'success' => true,
            'message' => 'Email queued successfully',
            'data' => $email
        ], 201);
    }

    public function queueFromTemplate(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'template_code' => 'required|string',
            'recipient_email' => 'required|email',
            'data' => 'required|array',
            'attachment_path' => 'nullable|string'
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'errors' => $validator->errors()
            ], 422);
        }

        $data = array_merge($request->data, [
            'recipient_email' => $request->recipient_email,
            'attachment_path' => $request->attachment_path
        ]);

        $email = $this->emailQueueService->queueFromTemplate(
            $request->template_code,
            $data
        );

        if (!$email) {
            return response()->json([
                'success' => false,
                'message' => 'Template not found or inactive'
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Email queued from template successfully',
            'data' => $email
        ], 201);
    }

    public function processQueue(Request $request): JsonResponse
    {
        $batchSize = $request->get('batch_size', 50);
        $stats = $this->emailQueueService->processPendingEmails($batchSize);

        return response()->json([
            'success' => true,
            'message' => 'Queue processed',
            'stats' => $stats
        ]);
    }

    public function retryFailed(Request $request): JsonResponse
    {
        $maxAttempts = $request->get('max_attempts', 3);
        $batchSize = $request->get('batch_size', 20);
        
        $stats = $this->emailQueueService->retryFailedEmails($maxAttempts, $batchSize);

        return response()->json([
            'success' => true,
            'message' => 'Failed emails retry completed',
            'stats' => $stats
        ]);
    }

    public function retry(int $id): JsonResponse
    {
        $email = EmailQueue::findOrFail($id);
        
        if ($email->status === 'sent') {
            return response()->json([
                'success' => false,
                'message' => 'Email already sent'
            ], 400);
        }

        $email->resetToPending();

        return response()->json([
            'success' => true,
            'message' => 'Email reset to pending and will be retried'
        ]);
    }

    public function delete(int $id): JsonResponse
    {
        $email = EmailQueue::findOrFail($id);
        $email->delete();

        return response()->json([
            'success' => true,
            'message' => 'Email deleted from queue'
        ]);
    }

    public function stats(): JsonResponse
    {
        $stats = [
            'pending' => EmailQueue::pending()->count(),
            'sent' => EmailQueue::sent()->count(),
            'failed' => EmailQueue::failed()->count(),
            'retryable' => EmailQueue::retryable()->count(),
            'total' => EmailQueue::count()
        ];

        return response()->json($stats);
    }

    /**
     * Send credentials to a specific user.
     * 
     * @param int $userId
     * @return JsonResponse
     */
    public function sendUserCredentials(int $userId): JsonResponse
    {
        try {
            $user = \App\Models\User::findOrFail($userId);
            
            if (!$user->email_address) {
                return response()->json([
                    'success' => false,
                    'message' => 'User does not have an email address'
                ], 400);
            }

            $email = $this->emailQueueService->sendUserCredentials($user);

            return response()->json([
                'success' => true,
                'message' => 'Credentials email queued successfully',
                'data' => $email
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to queue credentials email',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}

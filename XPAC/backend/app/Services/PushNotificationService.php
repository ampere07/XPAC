<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class PushNotificationService
{
    /**
     * Send a push notification to a specific user by email.
     *
     * @param string $email The assigned_email of the user.
     * @param string $title The notification title.
     * @param string $body The notification body text.
     * @param array $data Optional extra data payload.
     * @return bool True if successfully sent, false otherwise.
     */
    public function sendToUserByEmail(string $email, string $title, string $body, array $data = [], string $soundType = 'default'): bool
    {
        try {
            $user = User::where('email_address', $email)->first();

            if (!$user) {
                Log::warning("Push Notification failed: User not found with email {$email}");
                return false;
            }

            $pushToken = $user->push_token;

            if (empty($pushToken)) {
                Log::info("Push Notification skipped: User {$email} does not have a push token registered.");
                return false;
            }

            return $this->sendExpoPushNotification($pushToken, $title, $body, $data, $soundType);
        } catch (\Exception $e) {
            Log::error("Error in PushNotificationService: " . $e->getMessage());
            return false;
        }
    }

    /**
     * Send a push notification using Expo's Push API.
     *
     * @param string $expoPushToken The Expo Push Token (e.g. ExponentPushToken[xxxxxxxxx])
     * @param string $title The title
     * @param string $body The body
     * @param array $data Any extra data
     * @param string $soundType 'JO', 'SO', 'WO', or 'default'
     * @return bool
     */
    private function sendExpoPushNotification(string $expoPushToken, string $title, string $body, array $data = [], string $soundType = 'default'): bool
    {
        // Only attempt to send if it looks like a valid Expo push token
        if (!str_starts_with($expoPushToken, 'ExponentPushToken[') && !str_starts_with($expoPushToken, 'ExpoPushToken[')) {
             // For raw FCM tokens if used directly instead of Expo push tokens
             // If you later decide to use kreait/firebase-php, you'd integrate it here.
             Log::warning("Invalid Expo Push Token format for token: {$expoPushToken}");
             return false;
        }

        $sound = 'default';
        $channelId = 'default';

        if ($soundType === 'JO') {
            $sound = 'jo.mp3';
            $channelId = 'jo_channel';
        } elseif ($soundType === 'SO') {
            $sound = 'so.mp3';
            $channelId = 'so_channel';
        } elseif ($soundType === 'WO') {
            $sound = 'wo.mp3';
            $channelId = 'wo_channel';
        }

        $message = [
            'to' => $expoPushToken,
            'sound' => $sound,
            'categoryId' => $channelId,
            'channelId' => $channelId,
            'title' => $title,
            'body' => $body,
            'data' => empty($data) ? new \stdClass() : (object) $data,
        ];

        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json',
                'Accept-encoding' => 'gzip, deflate',
                'Content-Type' => 'application/json',
            ])->post('https://exp.host/--/api/v2/push/send', [$message]);

            if ($response->successful()) {
                Log::info("Push notification sent successfully to {$expoPushToken}");
                return true;
            } else {
                Log::error("Failed to send Expo push notification: " . $response->body());
                return false;
            }
        } catch (\Exception $e) {
            Log::error("Exception while sending Expo push notification: " . $e->getMessage());
            return false;
        }
    }
}


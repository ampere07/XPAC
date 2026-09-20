<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ApiResponseServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     *
     * @return void
     */
    public function register()
    {
        //
    }

    /**
     * Bootstrap services.
     *
     * @return void
     */
    public function boot()
    {
        // Add consistent response macro for success
        Response::macro('success', function ($data = [], $message = 'Success', $statusCode = 200) {
            return Response::json([
                'success' => true,
                'message' => $message,
                'data' => $data
            ], $statusCode);
        });

        // Add consistent response macro for error
        Response::macro('error', function ($message = 'Error', $errors = null, $statusCode = 400) {
            $response = [
                'success' => false,
                'message' => $message
            ];

            if ($errors !== null) {
                $response['errors'] = $errors;
            }

            return Response::json($response, $statusCode);
        });

        // Log all API requests in debug mode
        if (config('app.debug')) {
            $this->app->singleton('api.logger', function () {
                return function (Request $request, $response) {
                    Log::debug('API Request', [
                        'method' => $request->method(),
                        'url' => $request->fullUrl(),
                        'headers' => $request->headers->all(),
                        'params' => $request->all(),
                        'response' => $response
                    ]);
                };
            });
        }
    }
}

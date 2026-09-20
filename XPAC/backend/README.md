# CBMS Backend - Quick Start

## Installation

### 1. Install Dependencies
```bash
composer install
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
Edit `.env` and configure your database settings.

### 3. Run Migrations
```bash
php artisan migrate
```

## Running the Server

### Single Command (Recommended)
```bash
php artisan serve:all
```

This will start both:
- Laravel API on http://127.0.0.1:8000
- Socket.IO server on http://127.0.0.1:3001

### Alternative: Traditional Method
If the above doesn't work, use:
```bash
php artisan serve
```

Then in another terminal:
```bash
node socket-server.js
```

## Add API Routes

Add these routes to `routes/api.php` (at the end of the file):

```php
// Notification routes
Route::prefix('notifications')->group(function () {
    Route::get('/recent-applications', [\App\Http\Controllers\NotificationController::class, 'getRecentApplications']);
    Route::get('/unread-count', [\App\Http\Controllers\NotificationController::class, 'getUnreadCount']);
});
```

## Verify It's Working

- Laravel API: http://127.0.0.1:8000
- Socket.IO Health Check: http://127.0.0.1:3001/health

## That's It!

Now when you run `php artisan serve:all`, both the Laravel API and Socket.IO server will start automatically. When you stop the server (Ctrl+C), both will stop together.

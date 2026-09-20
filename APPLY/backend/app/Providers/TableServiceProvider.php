<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Services\TableCheckService;

class TableServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     *
     * @return void
     */
    public function register()
    {
        $this->app->singleton('table.service', function ($app) {
            return new TableCheckService();
        });
    }

    /**
     * Bootstrap services.
     *
     * @return void
     */
    public function boot()
    {
        // You can add any boot logic here if needed
    }
}

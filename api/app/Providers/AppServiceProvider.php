<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Las respuestas tienen exactamente la forma del contrato, sin envolver en "data".
        JsonResource::withoutWrapping();

        // Registro, inicio de sesión y recuperación de contraseña: por correo + IP y por IP.
        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by(Str::lower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(30)->by($request->ip()),
        ]);

        // El link del correo abre la PWA, que llama a POST /api/auth/reset-password.
        ResetPassword::createUrlUsing(fn (User $user, string $token) => config('rifa.frontend_url')
            .'/restablecer-clave?'.http_build_query(['token' => $token, 'email' => $user->getEmailForPasswordReset()]));
    }
}

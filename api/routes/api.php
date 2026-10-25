<?php

use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\PasswordController;
use App\Http\Controllers\InvitationController;
use App\Http\Controllers\MemberController;
use App\Http\Controllers\RaffleController;
use App\Http\Controllers\ReceiptController;
use App\Http\Controllers\SyncController;
use Illuminate\Support\Facades\Route;

/*
| API de sync de la PWA. Contrato: docs/sync-protocolo.md (en la raíz del repo).
| Todas las rutas van con el prefijo /api.
*/

Route::prefix('auth')->group(function () {
    Route::middleware('throttle:auth')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login']);
        Route::post('forgot-password', [PasswordController::class, 'forgot']);
        Route::post('reset-password', [PasswordController::class, 'reset']);
    });

    Route::get('email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('me', [AuthController::class, 'me']);
        Route::post('email/resend', [EmailVerificationController::class, 'resend'])->middleware('throttle:6,1');
    });
});

Route::get('invitations/{token}', [InvitationController::class, 'show']);

Route::middleware('auth:sanctum')->group(function () {
    Route::post('invitations/{token}/accept', [InvitationController::class, 'accept']);

    Route::get('raffles', [RaffleController::class, 'index']);
    Route::post('raffles', [RaffleController::class, 'store']);

    // Las rutas de una rifa la encuentran aunque esté borrada, para responder 410 (y no 404).
    Route::delete('raffles/{raffle}', [RaffleController::class, 'destroy'])->withTrashed();
    Route::patch('raffles/{raffle}/me', [RaffleController::class, 'archive'])->withTrashed();

    Route::get('raffles/{raffle}/snapshot', [SyncController::class, 'snapshot'])->withTrashed();
    Route::get('raffles/{raffle}/changes', [SyncController::class, 'changes'])->withTrashed();
    Route::post('raffles/{raffle}/ops', [SyncController::class, 'ops'])->withTrashed();

    Route::get('raffles/{raffle}/sales/{saleId}/receipt', [ReceiptController::class, 'show'])->withTrashed();
    Route::put('raffles/{raffle}/sales/{saleId}/receipt', [ReceiptController::class, 'update'])->withTrashed();
    Route::delete('raffles/{raffle}/sales/{saleId}/receipt', [ReceiptController::class, 'destroy'])->withTrashed();

    Route::get('raffles/{raffle}/members', [MemberController::class, 'index'])->withTrashed();
    Route::patch('raffles/{raffle}/members/{userId}', [MemberController::class, 'update'])->withTrashed();
    Route::delete('raffles/{raffle}/members/{userId}', [MemberController::class, 'destroy'])->withTrashed();

    Route::post('raffles/{raffle}/invitations', [InvitationController::class, 'store'])->withTrashed();
});

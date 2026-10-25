<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/** Verificación de correo: se envía al registrarse, pero no es obligatoria. */
class EmailVerificationController extends Controller
{
    public function resend(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Tu correo ya está verificado.']);
        }
        $user->sendEmailVerificationNotification();

        return response()->json(['message' => 'Te mandamos otro correo para verificar tu cuenta.']);
    }

    /** Link firmado del correo (se abre en el navegador, sin token). */
    public function verify(Request $request, string $id, string $hash): JsonResponse|RedirectResponse
    {
        $user = User::find($id);
        abort_if(! $user || ! hash_equals(sha1($user->getEmailForVerification()), $hash), 403, 'El link de verificación no es válido.');

        if (! $user->hasVerifiedEmail() && $user->markEmailAsVerified()) {
            event(new Verified($user));
        }

        if ($request->expectsJson()) {
            return response()->json(['message' => 'Listo, tu correo quedó verificado.']);
        }

        return redirect()->away(config('rifa.frontend_url').'/?correo=verificado');
    }
}

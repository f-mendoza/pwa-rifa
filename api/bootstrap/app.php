<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // API sólo con tokens Bearer: sin sesión ni cookies (no se usa statefulApi()).
        // Sin sesión, `auth:sanctum` no puede redirigir a un login: responde 401.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Tenés que iniciar sesión.'], 401);
            }
        });

        // Mensajes en castellano para los errores HTTP que trae Laravel en inglés.
        $exceptions->render(function (HttpExceptionInterface $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }
            $status = $e->getStatusCode();
            $defaults = [
                401 => 'Tenés que iniciar sesión.',
                403 => 'No tenés permiso para hacer esto.',
                404 => $e->getPrevious() instanceof ModelNotFoundException ? 'La rifa no existe.' : 'No encontramos lo que buscabas.',
                405 => 'Esa acción no existe.',
                410 => 'La rifa fue borrada.',
                413 => 'El archivo es demasiado grande.',
                429 => 'Demasiados intentos. Esperá un momento y probá de nuevo.',
            ];
            $message = $e->getMessage();
            $english = $message === ''
                || $e->getPrevious() instanceof ModelNotFoundException
                || in_array($message, ['This action is unauthorized.', 'Too Many Attempts.', 'Invalid signature.'], true)
                || str_starts_with($message, 'The route ');
            if ($english) {
                $message = $defaults[$status] ?? 'Algo salió mal en el servidor.';
            }

            return response()->json(['message' => $message], $status, $e->getHeaders());
        });
    })->create();

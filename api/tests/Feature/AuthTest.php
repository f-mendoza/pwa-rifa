<?php

use App\Models\User;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;

it('registra una cuenta, devuelve el token y manda el correo de verificación', function () {
    Notification::fake();

    $response = $this->postJson('/api/auth/register', [
        'name' => 'Facu',
        'email' => 'Facu@Example.com',
        'password' => 'secreto123',
        'passwordConfirmation' => 'secreto123',
        'deviceName' => 'Pixel 7',
    ]);

    $response->assertCreated()
        ->assertJsonPath('user.name', 'Facu')
        ->assertJsonPath('user.email', 'facu@example.com')
        ->assertJsonPath('user.emailVerifiedAt', null);
    expect($response->json('token'))->toBeString()->not->toBeEmpty();

    $user = User::where('email', 'facu@example.com')->sole();
    expect($user->tokens()->first()->name)->toBe('Pixel 7');
    Notification::assertSentTo($user, VerifyEmail::class);
});

it('valida el registro con mensajes en castellano', function () {
    User::factory()->create(['email' => 'ana@example.com']);

    $this->postJson('/api/auth/register', [
        'name' => '',
        'email' => 'ana@example.com',
        'password' => 'secreto123',
        'passwordConfirmation' => 'otra',
    ])->assertUnprocessable()
        ->assertJsonPath('errors.name.0', 'Falta el nombre.')
        ->assertJsonPath('errors.email.0', 'Ya hay una cuenta con ese correo.')
        ->assertJsonPath('errors.password.0', 'Las contraseñas no coinciden.');
});

it('inicia sesión y rechaza una contraseña incorrecta', function () {
    User::factory()->create(['email' => 'ana@example.com', 'password' => Hash::make('secreto123')]);

    $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'secreto123'])
        ->assertOk()
        ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'emailVerifiedAt']]);

    $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'mal'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.email.0', 'El correo o la contraseña no son correctos.');
});

it('devuelve la cuenta con me y revoca el token con logout', function () {
    $user = User::factory()->create();
    $token = $user->createToken('PWA')->plainTextToken;

    $this->withToken($token)->getJson('/api/auth/me')
        ->assertOk()
        ->assertJsonPath('user.id', $user->id)
        ->assertJsonPath('user.emailVerifiedAt', $user->email_verified_at->getTimestampMs());

    $this->withToken($token)->postJson('/api/auth/logout')->assertNoContent();
    expect($user->tokens()->count())->toBe(0);

    app('auth')->forgetGuards();
    $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
});

it('responde 401 sin token o con un token inválido', function () {
    $this->getJson('/api/auth/me')->assertUnauthorized()->assertJsonPath('message', 'Tenés que iniciar sesión.');
    $this->getJson('/api/raffles')->assertUnauthorized();
    $this->withToken('1|inventado')->postJson('/api/raffles/'.uuid().'/ops', ['ops' => []])->assertUnauthorized();
});

it('pide el link para recuperar la contraseña sin revelar si la cuenta existe', function () {
    Notification::fake();
    $user = User::factory()->create(['email' => 'ana@example.com']);

    $this->postJson('/api/auth/forgot-password', ['email' => 'ana@example.com'])
        ->assertOk()->assertJsonStructure(['message']);
    $this->postJson('/api/auth/forgot-password', ['email' => 'nadie@example.com'])
        ->assertOk()->assertJsonStructure(['message']);

    Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use ($user) {
        $url = $notification->toMail($user)->actionUrl;

        return str_starts_with($url, config('rifa.frontend_url').'/restablecer-clave?token=');
    });
});

it('cambia la contraseña con el token del correo y cierra las otras sesiones', function () {
    Notification::fake();
    $user = User::factory()->create(['email' => 'ana@example.com']);
    $user->createToken('viejo');
    $this->postJson('/api/auth/forgot-password', ['email' => 'ana@example.com'])->assertOk();

    $token = null;
    Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $n) use (&$token) {
        $token = $n->token;

        return true;
    });

    $this->postJson('/api/auth/reset-password', [
        'token' => 'cualquiera',
        'email' => 'ana@example.com',
        'password' => 'nueva-clave',
        'passwordConfirmation' => 'nueva-clave',
    ])->assertUnprocessable()->assertJsonValidationErrors('email');

    $this->postJson('/api/auth/reset-password', [
        'token' => $token,
        'email' => 'ana@example.com',
        'password' => 'nueva-clave',
        'passwordConfirmation' => 'nueva-clave',
    ])->assertOk()->assertJsonPath('message', 'Listo, cambiaste tu contraseña.');

    expect(Hash::check('nueva-clave', $user->fresh()->password))->toBeTrue()
        ->and($user->tokens()->count())->toBe(0);
});

it('verifica el correo con el link firmado y reenvía el correo', function () {
    Notification::fake();
    $user = User::factory()->unverified()->create();

    actingAsUser($user)->postJson('/api/auth/email/resend')->assertOk();
    Notification::assertSentTo($user, VerifyEmail::class);

    $url = URL::temporarySignedRoute('verification.verify', now()->addHour(), [
        'id' => $user->id,
        'hash' => sha1($user->email),
    ]);
    $this->getJson($url)->assertOk();
    expect($user->fresh()->hasVerifiedEmail())->toBeTrue();

    $this->getJson(str_replace('signature=', 'signature=x', $url))->assertForbidden();
});

it('limita los intentos de inicio de sesión', function () {
    foreach (range(1, 10) as $_) {
        $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'mal'])->assertUnprocessable();
    }
    $this->postJson('/api/auth/login', ['email' => 'ana@example.com', 'password' => 'mal'])
        ->assertTooManyRequests()
        ->assertJsonPath('message', 'Demasiados intentos. Esperá un momento y probá de nuevo.');
});

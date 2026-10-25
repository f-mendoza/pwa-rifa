<?php

use App\Models\RaffleMember;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature');
pest()->extend(TestCase::class)->in('Unit');

/*
| Ayudas para los tests de sync. Las operaciones tienen la forma del outbox del cliente
| (docs/sync-protocolo.md).
*/

function uuid(): string
{
    return (string) Str::uuid7();
}

/** Actúa como ese usuario (token de Sanctum) en los pedidos siguientes. */
function actingAsUser(User $user): mixed
{
    Sanctum::actingAs($user);

    return test();
}

/** Crea una rifa en la nube como `$owner` y devuelve su id. */
function createRaffle(User $owner, array $config = []): string
{
    return actingAsUser($owner)
        ->postJson('/api/raffles', ['config' => ['title' => 'Rifa del club', 'total' => 100, ...$config]])
        ->assertCreated()
        ->json('raffle.id');
}

function addMember(string $raffleId, User $user, string $role, ?array $ranges = null): RaffleMember
{
    return RaffleMember::create(['raffle_id' => $raffleId, 'user_id' => $user->id, 'role' => $role, 'ranges' => $ranges]);
}

function op(string $type, array $payload, ?string $opId = null): array
{
    return ['opId' => $opId ?? uuid(), 'type' => $type, 'payload' => $payload, 'createdAt' => 1729850000000];
}

function personData(string $name, ?string $id = null, array $extra = []): array
{
    return ['id' => $id ?? uuid(), 'name' => $name, 'phone' => '', 'email' => '', 'referrer' => '', ...$extra];
}

/** `numbers.assign` con una venta nueva. */
function assignOp(array $numbers, string|array $person, array $extra = []): array
{
    return op('numbers.assign', [
        'saleId' => uuid(),
        'seq' => 1,
        'numbers' => $numbers,
        'person' => is_string($person) ? personData($person) : $person,
        'amount' => null,
        'createdAt' => 1729850000000,
        ...$extra,
    ]);
}

function sendOps(User $user, string $raffleId, array $ops): TestResponse
{
    return actingAsUser($user)->postJson("/api/raffles/{$raffleId}/ops", ['ops' => $ops])->assertOk();
}

/** Manda una sola operación y devuelve su resultado. */
function sendOp(User $user, string $raffleId, array $op): array
{
    return sendOps($user, $raffleId, [$op])->json('results.0');
}

function snapshot(User $user, string $raffleId): array
{
    return actingAsUser($user)->getJson("/api/raffles/{$raffleId}/snapshot")->assertOk()->json();
}

function changes(User $user, string $raffleId, int $since): array
{
    return actingAsUser($user)->getJson("/api/raffles/{$raffleId}/changes?since={$since}")->assertOk()->json();
}

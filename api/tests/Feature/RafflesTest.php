<?php

use App\Models\Raffle;
use App\Models\User;

it('crea una rifa con id del servidor y devuelve el snapshot con rol owner', function () {
    $owner = User::factory()->create(['name' => 'Facu']);
    $fakeId = uuid();

    $response = actingAsUser($owner)->postJson('/api/raffles', [
        'id' => $fakeId,
        'config' => ['title' => '  Rifa del club  ', 'total' => 200, 'price' => 1000, 'prizes' => [' TV ', '', 'Pava']],
        'share' => ['mode' => 'crossed', 'palette' => 'inexistente', 'titleFont' => 'anton'],
    ]);

    $response->assertCreated()
        ->assertJsonPath('role', 'owner')
        ->assertJsonPath('ranges', null)
        ->assertJsonPath('raffle.config.title', 'Rifa del club')
        ->assertJsonPath('raffle.config.total', 200)
        ->assertJsonPath('raffle.config.prizes', ['TV', 'Pava'])
        ->assertJsonPath('raffle.config.packSize', 2)
        ->assertJsonPath('raffle.share.mode', 'crossed')
        ->assertJsonPath('raffle.share.palette', 'app')
        ->assertJsonPath('raffle.share.titleFont', 'anton')
        ->assertJsonPath('raffle.lastSeq', 0)
        ->assertJsonPath('raffle.ownerId', $owner->id)
        ->assertJsonPath('raffle.deleted', false)
        ->assertJsonPath('people', [])
        ->assertJsonPath('numbers', []);

    $id = $response->json('raffle.id');
    expect($id)->not->toBe($fakeId)
        ->and(Raffle::find($fakeId))->toBeNull()
        ->and(substr($id, 14, 1))->toBe('7') // UUIDv7
        ->and($response->json('version'))->toBeGreaterThan(0)
        ->and($response->json('raffle.createdAt'))->toBeGreaterThan(1_700_000_000_000);
});

it('valida la configuración al crear la rifa', function () {
    $owner = User::factory()->create();

    actingAsUser($owner)->postJson('/api/raffles', ['config' => ['total' => 5000]])
        ->assertUnprocessable()
        ->assertJsonPath('errors.config.0', 'La cantidad de números tiene que estar entre 1 y 1000');
    actingAsUser($owner)->postJson('/api/raffles', ['config' => ['price' => 'caro']])
        ->assertUnprocessable()
        ->assertJsonPath('errors.config.0', 'Los precios tienen que ser números enteros');
    actingAsUser($owner)->postJson('/api/raffles', [])
        ->assertUnprocessable()->assertJsonValidationErrors('config');
});

it('lista las rifas a las que el usuario tiene acceso', function () {
    $owner = User::factory()->create(['name' => 'Facu']);
    $seller = User::factory()->create();
    $other = User::factory()->create();
    $id = createRaffle($owner, ['title' => 'Compartida']);
    createRaffle($other, ['title' => 'Ajena']);
    addMember($id, $seller, 'seller');

    actingAsUser($seller)->getJson('/api/raffles')
        ->assertOk()
        ->assertJsonCount(1)
        ->assertJsonPath('0.id', $id)
        ->assertJsonPath('0.title', 'Compartida')
        ->assertJsonPath('0.role', 'seller')
        ->assertJsonPath('0.ownerName', 'Facu')
        ->assertJsonPath('0.archivedAt', null)
        ->assertJsonPath('0.deleted', false);

    actingAsUser($seller)->patchJson("/api/raffles/{$id}/me", ['archived' => true])->assertNoContent();
    expect(actingAsUser($seller)->getJson('/api/raffles')->json('0.archivedAt'))->toBeInt();
    expect(actingAsUser($owner)->getJson('/api/raffles')->json('0.archivedAt'))->toBeNull();
});

it('el snapshot sólo trae filas vivas', function () {
    $owner = User::factory()->create(['name' => 'Facu']);
    $id = createRaffle($owner);
    sendOps($owner, $id, [assignOp([1, 2], 'Ana'), assignOp([3], 'Beto')]);
    sendOp($owner, $id, op('number.release', ['number' => 3])); // Beto queda sin nada: se borra.
    sendOp($owner, $id, op('number.release', ['number' => 2]));

    $snap = snapshot($owner, $id);

    expect(collect($snap['people'])->pluck('name')->all())->toBe(['Ana'])
        ->and(collect($snap['numbers'])->pluck('number')->all())->toBe([1])
        ->and($snap['sales'])->toHaveCount(1)
        ->and($snap['sales'][0])->toMatchArray(['seq' => 1, 'createdBy' => ['id' => $owner->id, 'name' => 'Facu'], 'deleted' => false])
        ->and($snap['numbers'][0])->toMatchArray(['saleId' => $snap['sales'][0]['id'], 'createdAt' => 1729850000000])
        ->and($snap['raffle']['lastSeq'])->toBe(2)
        ->and(collect([...$snap['people'], ...$snap['sales'], ...$snap['numbers']])->pluck('deleted')->unique()->all())->toBe([false]);
});

it('borra la rifa: 410 para los miembros, 403 para el resto y sólo el dueño puede', function () {
    $owner = User::factory()->create();
    $seller = User::factory()->create();
    $stranger = User::factory()->create();
    $id = createRaffle($owner);
    addMember($id, $seller, 'seller');

    actingAsUser($stranger)->getJson("/api/raffles/{$id}/snapshot")->assertForbidden();
    actingAsUser($seller)->deleteJson("/api/raffles/{$id}")->assertForbidden();
    actingAsUser($stranger)->deleteJson("/api/raffles/{$id}")->assertForbidden();

    actingAsUser($owner)->deleteJson("/api/raffles/{$id}")->assertNoContent();

    expect(Raffle::withTrashed()->find($id)->trashed())->toBeTrue();
    foreach ([$owner, $seller] as $member) {
        actingAsUser($member)->getJson("/api/raffles/{$id}/snapshot")->assertStatus(410)->assertJsonPath('message', 'La rifa fue borrada.');
        actingAsUser($member)->getJson("/api/raffles/{$id}/changes?since=0")->assertStatus(410);
        actingAsUser($member)->postJson("/api/raffles/{$id}/ops", ['ops' => [assignOp([1], 'Ana')]])->assertStatus(410);
    }
    actingAsUser($stranger)->getJson("/api/raffles/{$id}/snapshot")->assertForbidden();
    actingAsUser($stranger)->getJson("/api/raffles/{$id}/changes?since=0")->assertForbidden();
    actingAsUser($owner)->getJson('/api/raffles')->assertJsonCount(0);
});

it('responde 404 para una rifa que no existe', function () {
    $user = User::factory()->create();

    actingAsUser($user)->getJson('/api/raffles/'.uuid().'/snapshot')->assertNotFound()->assertJsonPath('message', 'La rifa no existe.');
    actingAsUser($user)->getJson('/api/raffles/no-es-un-uuid/snapshot')->assertNotFound();
});

it('permite CORS desde la PWA con Bearer y sin credenciales', function () {
    $this->call('OPTIONS', '/api/raffles', server: [
        'HTTP_ORIGIN' => 'http://localhost:5173',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization,content-type',
    ])->assertNoContent()
        ->assertHeader('Access-Control-Allow-Origin', '*')
        ->assertHeaderMissing('Access-Control-Allow-Credentials');
});

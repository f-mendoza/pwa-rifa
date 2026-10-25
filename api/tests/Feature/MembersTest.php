<?php

use App\Models\Invitation;
use App\Models\User;

beforeEach(function () {
    $this->owner = User::factory()->create(['name' => 'Facu']);
    $this->raffle = createRaffle($this->owner, ['title' => 'Rifa del club']);
});

it('crea una invitación, se ve sin sesión y se acepta', function () {
    $response = actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/invitations", ['role' => 'seller'])
        ->assertCreated()
        ->assertJsonPath('role', 'seller');
    $token = $response->json('token');
    expect($response->json('expiresAt'))->toBeGreaterThan(now()->addDays(6)->getTimestampMs());

    app('auth')->forgetGuards();
    $this->getJson("/api/invitations/{$token}")->assertOk()->assertExactJson([
        'raffleId' => $this->raffle,
        'raffleTitle' => 'Rifa del club',
        'role' => 'seller',
        'invitedBy' => 'Facu',
        'expired' => false,
        'accepted' => false,
    ]);
    $this->postJson("/api/invitations/{$token}/accept")->assertUnauthorized();

    $guest = User::factory()->create();
    actingAsUser($guest)->postJson("/api/invitations/{$token}/accept")
        ->assertOk()->assertExactJson(['raffleId' => $this->raffle, 'role' => 'seller']);
    expect(snapshot($guest, $this->raffle)['role'])->toBe('seller');
    $this->getJson("/api/invitations/{$token}")->assertJsonPath('accepted', true);

    // Si ya es miembro devuelve su rol actual; otra persona ya no puede usarla.
    actingAsUser($this->owner)->postJson("/api/invitations/{$token}/accept")->assertOk()->assertJsonPath('role', 'owner');
    actingAsUser(User::factory()->create())->postJson("/api/invitations/{$token}/accept")->assertUnprocessable();
    $this->getJson('/api/invitations/no-existe')->assertNotFound();
});

it('sólo el dueño invita, y una invitación vencida no se acepta', function () {
    $seller = User::factory()->create();
    addMember($this->raffle, $seller, 'seller');

    actingAsUser($seller)->postJson("/api/raffles/{$this->raffle}/invitations", ['role' => 'viewer'])->assertForbidden();
    actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/invitations", ['role' => 'owner'])
        ->assertUnprocessable()->assertJsonValidationErrors('role');

    $token = actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/invitations", ['role' => 'viewer'])->json('token');
    Invitation::query()->update(['expires_at' => now()->subMinute()]);

    $this->getJson("/api/invitations/{$token}")->assertJsonPath('expired', true);
    actingAsUser(User::factory()->create())->postJson("/api/invitations/{$token}/accept")
        ->assertUnprocessable()->assertJsonPath('message', 'Esta invitación venció. Pedile a quien organiza que te mande otra.');
});

it('una invitación con correo sólo la acepta esa cuenta', function () {
    $token = actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/invitations", ['role' => 'viewer', 'email' => 'Ana@Example.com'])->json('token');

    actingAsUser(User::factory()->create(['email' => 'otro@example.com']))->postJson("/api/invitations/{$token}/accept")->assertForbidden();
    actingAsUser(User::factory()->create(['email' => 'ana@example.com']))->postJson("/api/invitations/{$token}/accept")
        ->assertOk()->assertJsonPath('role', 'viewer');
});

it('lista los miembros y el dueño cambia roles y talonarios', function () {
    $seller = User::factory()->create(['name' => 'Juli', 'email' => 'juli@example.com']);
    addMember($this->raffle, $seller, 'viewer');

    actingAsUser($seller)->getJson("/api/raffles/{$this->raffle}/members")
        ->assertOk()
        ->assertJsonCount(2)
        ->assertJsonPath('0.role', 'owner')
        ->assertJsonPath('1', ['userId' => $seller->id, 'name' => 'Juli', 'email' => 'juli@example.com', 'role' => 'viewer', 'ranges' => null]);

    actingAsUser($this->owner)->patchJson("/api/raffles/{$this->raffle}/members/{$seller->id}", ['role' => 'seller', 'ranges' => [[1, 50], [80, 90]]])
        ->assertOk()->assertJsonPath('role', 'seller')->assertJsonPath('ranges', [[1, 50], [80, 90]]);
    expect(snapshot($seller, $this->raffle))->toMatchArray(['role' => 'seller', 'ranges' => [[1, 50], [80, 90]]]);
    expect(sendOp($seller, $this->raffle, assignOp([60], 'Ana'))['reason'])->toBe('outside_ranges');

    actingAsUser($this->owner)->patchJson("/api/raffles/{$this->raffle}/members/{$seller->id}", ['ranges' => null])
        ->assertOk()->assertJsonPath('ranges', null);
    actingAsUser($this->owner)->patchJson("/api/raffles/{$this->raffle}/members/{$seller->id}", ['ranges' => [[50, 10]]])
        ->assertUnprocessable()->assertJsonValidationErrors('ranges');
    actingAsUser($this->owner)->patchJson("/api/raffles/{$this->raffle}/members/{$this->owner->id}", ['role' => 'seller'])
        ->assertUnprocessable()->assertJsonPath('errors.role.0', 'No podés quitarte el rol de dueño de la rifa.');
    actingAsUser($seller)->patchJson("/api/raffles/{$this->raffle}/members/{$seller->id}", ['role' => 'viewer'])->assertForbidden();
});

it('el dueño quita a un miembro, cualquiera sale con me y el dueño no puede salir', function () {
    $seller = User::factory()->create();
    $viewer = User::factory()->create();
    addMember($this->raffle, $seller, 'seller');
    addMember($this->raffle, $viewer, 'viewer');

    actingAsUser($viewer)->deleteJson("/api/raffles/{$this->raffle}/members/{$seller->id}")->assertForbidden();
    actingAsUser($this->owner)->deleteJson("/api/raffles/{$this->raffle}/members/{$seller->id}")->assertNoContent();
    actingAsUser($seller)->getJson("/api/raffles/{$this->raffle}/changes?since=0")->assertForbidden();

    actingAsUser($viewer)->deleteJson("/api/raffles/{$this->raffle}/members/me")->assertNoContent();
    actingAsUser($viewer)->getJson("/api/raffles/{$this->raffle}/snapshot")->assertForbidden();

    actingAsUser($this->owner)->deleteJson("/api/raffles/{$this->raffle}/members/me")->assertUnprocessable();
    actingAsUser($this->owner)->deleteJson("/api/raffles/{$this->raffle}/members/{$this->owner->id}")->assertUnprocessable();
    actingAsUser($this->owner)->deleteJson("/api/raffles/{$this->raffle}/members/999")->assertNotFound();
    actingAsUser($this->owner)->getJson("/api/raffles/{$this->raffle}/members")->assertJsonCount(1);
});

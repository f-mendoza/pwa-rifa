<?php

use App\Models\User;

beforeEach(function () {
    $this->owner = User::factory()->create(['name' => 'Facu']);
    $this->raffle = createRaffle($this->owner);
});

it('trae sólo lo que cambió después de since, con raffle null si no cambió', function () {
    $base = snapshot($this->owner, $this->raffle)['version'];
    $first = assignOp([1], 'Ana');
    $v1 = sendOps($this->owner, $this->raffle, [$first])->json('version');

    $changes = changes($this->owner, $this->raffle, $v1);
    expect($changes)->toMatchArray(['raffle' => null, 'people' => [], 'sales' => [], 'numbers' => [], 'receipts' => [], 'aliases' => [], 'role' => 'owner', 'ranges' => null, 'version' => $v1]);

    $second = assignOp([2], 'Beto');
    $v2 = sendOps($this->owner, $this->raffle, [$second])->json('version');
    $changes = changes($this->owner, $this->raffle, $v1);

    expect($v2)->toBeGreaterThan($v1)
        ->and($changes['version'])->toBe($v2)
        ->and(collect($changes['people'])->pluck('name')->all())->toBe(['Beto'])
        ->and(collect($changes['numbers'])->pluck('number')->all())->toBe([2])
        ->and(collect($changes['sales'])->pluck('id')->all())->toBe([$second['payload']['saleId']])
        // last_seq cambió: la rifa viene entera.
        ->and($changes['raffle']['lastSeq'])->toBe(2);

    // Desde el principio viene todo.
    $all = changes($this->owner, $this->raffle, $base);
    expect(collect($all['numbers'])->pluck('number')->all())->toBe([1, 2]);
});

it('incluye las bajas con deleted true', function () {
    $assign = assignOp([1, 2], 'Ana');
    $v1 = sendOps($this->owner, $this->raffle, [$assign])->json('version');

    sendOps($this->owner, $this->raffle, [op('sale.void', ['saleId' => $assign['payload']['saleId']])]);
    $changes = changes($this->owner, $this->raffle, $v1);

    expect(collect($changes['numbers'])->map(fn ($n) => [$n['number'], $n['deleted']])->all())->toBe([[1, true], [2, true]])
        ->and($changes['sales'][0])->toMatchArray(['id' => $assign['payload']['saleId'], 'deleted' => true])
        ->and($changes['people'][0])->toMatchArray(['id' => $assign['payload']['person']['id'], 'deleted' => true])
        // Anular no toca la fila de la rifa.
        ->and($changes['raffle'])->toBeNull();

    expect(snapshot($this->owner, $this->raffle)['numbers'])->toBe([]);
});

it('incluye los alias de personas unificadas después de since', function () {
    $ana = personData('Ana');
    $v1 = sendOps($this->owner, $this->raffle, [assignOp([1], $ana)])->json('version');
    $otherAna = personData('ana');
    sendOps($this->owner, $this->raffle, [assignOp([2], $otherAna)]);

    $changes = changes($this->owner, $this->raffle, $v1);
    expect($changes['aliases'])->toBe([['entity' => 'person', 'from' => $otherAna['id'], 'to' => $ana['id']]]);

    $later = changes($this->owner, $this->raffle, $changes['version']);
    expect($later['aliases'])->toBe([]);
});

it('trae el rol y el talonario de quien pide', function () {
    $seller = User::factory()->create();
    addMember($this->raffle, $seller, 'seller', [[1, 50]]);

    expect(changes($seller, $this->raffle, 0))->toMatchArray(['role' => 'seller', 'ranges' => [[1, 50]]]);
    actingAsUser($seller)->getJson("/api/raffles/{$this->raffle}/changes")->assertUnprocessable()->assertJsonValidationErrors('since');
});

it('la versión es global y crece en cada cambio de cualquier rifa', function () {
    $other = createRaffle($this->owner);
    $a = sendOps($this->owner, $this->raffle, [assignOp([1], 'Ana')])->json('version');
    $b = sendOps($this->owner, $other, [assignOp([1], 'Ana')])->json('version');
    $c = sendOps($this->owner, $this->raffle, [assignOp([2], 'Beto')])->json('version');

    expect($b)->toBeGreaterThan($a)->and($c)->toBeGreaterThan($b)
        ->and(snapshot($this->owner, $other)['version'])->toBe($b);
});

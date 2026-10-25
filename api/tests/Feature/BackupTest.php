<?php

use App\Models\Person;
use App\Models\RaffleNumber;
use App\Models\Sale;
use App\Models\User;

function backupPayload(): array
{
    $ana = personData('Ana', extra: ['createdAt' => 1000]);
    $beto = personData('Beto', extra: ['createdAt' => 1001]);
    $sale = ['id' => uuid(), 'participantId' => $ana['id'], 'seq' => 5, 'amount' => 7100, 'createdAt' => 1002];

    return [
        'config' => ['title' => 'Restaurada', 'total' => 200, 'price' => 5000],
        'share' => ['format' => 'post'],
        'people' => [$ana, $beto], 'sales' => [$sale],
        'numbers' => [
            ['number' => 5, 'participantId' => $ana['id'], 'saleId' => $sale['id'], 'createdAt' => 1002],
            ['number' => 8, 'participantId' => $beto['id'], 'saleId' => $sale['id'], 'createdAt' => 1002],
        ],
        'receipts' => [['saleId' => $sale['id'], 'meta' => ['name' => 'pago.pdf', 'type' => 'application/pdf', 'size' => 10, 'addedAt' => 1003]]],
    ];
}

beforeEach(function () {
    $this->owner = User::factory()->create();
    $this->raffle = createRaffle($this->owner);
});

it('el creador importa una rifa completa y sus miembros reciben los cambios', function () {
    $seller = User::factory()->create();
    addMember($this->raffle, $seller, 'seller');
    $version = snapshot($seller, $this->raffle)['version'];
    $data = backupPayload();
    $import = op('raffle.importBackup', $data);
    expect(sendOp($this->owner, $this->raffle, $import)['status'])->toBe('accepted');
    $snap = snapshot($seller, $this->raffle);
    expect($snap['raffle'])->toMatchArray(['id' => $this->raffle, 'lastSeq' => 5])
        ->and($snap['raffle']['config']['title'])->toBe('Restaurada')
        ->and($snap['sales'][0])->toMatchArray(['amount' => 7100, 'seq' => 5, 'createdBy' => ['id' => $this->owner->id, 'name' => $this->owner->name]])
        ->and($snap['numbers'])->toHaveCount(2)
        ->and($snap['receipts'][0])->toMatchArray(['name' => 'pago.pdf', 'hasFile' => false]);
    expect(changes($seller, $this->raffle, $version)['numbers'])->toHaveCount(2);
    // Respuesta perdida: el mismo opId no se aplica dos veces.
    expect(sendOp($this->owner, $this->raffle, $import)['status'])->toBe('accepted')
        ->and(Sale::count())->toBe(1);
    $next = sendOp($this->owner, $this->raffle, assignOp([9], 'Otra persona'));
    expect($next['result']['seq'])->toBe(6);
});

it('vendedores y observadores no pueden importar aunque llamen directamente a la API', function () {
    foreach (['seller', 'viewer'] as $role) {
        $member = User::factory()->create();
        addMember($this->raffle, $member, $role);
        expect(sendOp($member, $this->raffle, op('raffle.importBackup', backupPayload()))['reason'])->toBe('forbidden');
    }
    expect(Person::count())->toBe(0);
});

it('no reemplaza ventas existentes ni permite restaurar tras anularlas', function () {
    $sale = assignOp([9], 'Existente');
    sendOp($this->owner, $this->raffle, $sale);
    expect(sendOp($this->owner, $this->raffle, op('raffle.importBackup', backupPayload()))['reason'])->toBe('raffle_not_empty')
        ->and(RaffleNumber::pluck('number')->all())->toBe([9]);
    sendOp($this->owner, $this->raffle, op('sale.void', ['saleId' => $sale['payload']['saleId']]));
    expect(sendOp($this->owner, $this->raffle, op('raffle.importBackup', backupPayload()))['reason'])->toBe('raffle_not_empty');
});

it('un error al final del respaldo deshace toda la carga y su versión', function () {
    $before = snapshot($this->owner, $this->raffle);
    $data = backupPayload();
    $data['receipts'][0]['saleId'] = uuid();
    expect(sendOp($this->owner, $this->raffle, op('raffle.importBackup', $data))['reason'])->toBe('invalid')
        ->and(snapshot($this->owner, $this->raffle))->toBe($before)
        ->and(Person::count())->toBe(0)
        ->and(Sale::count())->toBe(0);
});

it('rechaza referencias ajenas, números repetidos, secuencias repetidas y formatos incorrectos', function () {
    foreach (['reference', 'number', 'seq', 'shape', 'range', 'name'] as $invalid) {
        $data = backupPayload();
        match ($invalid) {
            'reference' => $data['numbers'][1]['participantId'] = uuid(),
            'number' => $data['numbers'][1]['number'] = 5,
            'seq' => $data['sales'][] = [...$data['sales'][0], 'id' => uuid()],
            'shape' => $data['people'] = 'incorrecto',
            'range' => $data['numbers'][1]['number'] = 500,
            'name' => $data['people'][1]['name'] = '  ÁNA ',
        };
        expect(sendOp($this->owner, $this->raffle, op('raffle.importBackup', $data))['reason'])->toBe('invalid')
            ->and(Person::count())->toBe(0);
    }
});

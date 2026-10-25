<?php

use App\Models\Alias;
use App\Models\Operation;
use App\Models\Person;
use App\Models\RaffleNumber;
use App\Models\Receipt;
use App\Models\Sale;
use App\Models\User;

beforeEach(function () {
    $this->owner = User::factory()->create(['name' => 'Facu']);
    $this->seller = User::factory()->create(['name' => 'Juli']);
    $this->raffle = createRaffle($this->owner);
    addMember($this->raffle, $this->seller, 'seller');
});

describe('numbers.assign', function () {
    it('acepta la venta y asigna el seq del servidor', function () {
        $first = assignOp([5, 6], personData('Ana', extra: ['phone' => '221 555']), ['seq' => 99]);
        $response = sendOps($this->seller, $this->raffle, [$first, assignOp([7], 'Beto', ['seq' => 99])]);

        $response->assertJsonPath('results.0.status', 'accepted')
            ->assertJsonPath('results.0.opId', $first['opId'])
            ->assertJsonPath('results.0.result.seq', 1)
            ->assertJsonPath('results.0.result.participantId', $first['payload']['person']['id'])
            ->assertJsonPath('results.1.result.seq', 2);
        expect($response->json('version'))->toBeGreaterThan(0);

        $sale = Sale::find($first['payload']['saleId']);
        expect($sale->seq)->toBe(1)
            ->and($sale->created_by)->toBe($this->seller->id)
            ->and(RaffleNumber::where('sale_id', $sale->id)->pluck('number')->all())->toBe([5, 6])
            ->and(Person::find($first['payload']['person']['id'])->only('name', 'key', 'phone'))
            ->toBe(['name' => 'Ana', 'key' => 'ana', 'phone' => '221 555']);
    });

    it('rechaza el mismo número vendido desde otro teléfono nombrando a la persona', function () {
        expect(sendOp($this->owner, $this->raffle, assignOp([7], 'Juan'))['status'])->toBe('accepted');

        $result = sendOp($this->seller, $this->raffle, assignOp([7, 8], 'Ana'));

        expect($result['status'])->toBe('rejected')
            ->and($result['reason'])->toBe('number_taken')
            ->and($result['message'])->toBe('El número 7 ya lo había vendido Facu a Juan desde otro teléfono')
            ->and(RaffleNumber::where('number', 8)->exists())->toBeFalse() // Se rechaza la operación entera.
            ->and(Person::where('name', 'Ana')->exists())->toBeFalse();
    });

    it('rechaza números fuera del total y datos inválidos', function () {
        $out = sendOp($this->owner, $this->raffle, assignOp([100, 101], 'Ana'));
        expect($out)->toMatchArray(['status' => 'rejected', 'reason' => 'out_of_range'])
            ->and($out['message'])->toBe('El número 101 no existe en esta rifa: los números van del 1 al 100');

        expect(sendOp($this->owner, $this->raffle, assignOp([1], personData('  ')))['message'])->toBe('El nombre es obligatorio')
            ->and(sendOp($this->owner, $this->raffle, assignOp([1], 'Ana', ['amount' => -5]))['reason'])->toBe('invalid')
            ->and(sendOp($this->owner, $this->raffle, assignOp([1, 1], 'Ana'))['reason'])->toBe('invalid')
            ->and(sendOp($this->owner, $this->raffle, assignOp([], 'Ana'))['reason'])->toBe('invalid')
            ->and(sendOp($this->owner, $this->raffle, assignOp([1], 'Ana', ['saleId' => 'x']))['reason'])->toBe('invalid');
    });

    it('es idempotente: reenviar el mismo opId no duplica y devuelve el mismo resultado', function () {
        $op = assignOp([3], 'Ana');
        $first = sendOps($this->seller, $this->raffle, [$op])->json();
        $again = sendOps($this->seller, $this->raffle, [$op, $op])->json();

        expect($again['results'][0])->toBe($first['results'][0])
            ->and($again['results'][1])->toBe($first['results'][0])
            ->and($again['version'])->toBe($first['version'])
            ->and(Sale::count())->toBe(1)
            ->and(Operation::count())->toBe(1);

        // También un rechazo se repite igual.
        $taken = assignOp([3], 'Beto');
        $rejected = sendOp($this->owner, $this->raffle, $taken);
        RaffleNumber::query()->delete(); // Aunque ahora el número esté libre...
        expect(sendOp($this->owner, $this->raffle, $taken))->toBe($rejected); // ...se devuelve lo guardado.
    });

    it('revende un número liberado reactivando su fila', function () {
        sendOp($this->owner, $this->raffle, assignOp([9], 'Ana'));
        $row = RaffleNumber::where('number', 9)->sole();
        sendOp($this->owner, $this->raffle, op('number.release', ['number' => 9]));
        expect(RaffleNumber::where('number', 9)->exists())->toBeFalse();

        $result = sendOp($this->seller, $this->raffle, assignOp([9], 'Beto'));

        expect($result['status'])->toBe('accepted')
            ->and($result['result']['seq'])->toBe(2);
        $again = RaffleNumber::withTrashed()->where('number', 9)->sole();
        expect($again->id)->toBe($row->id)
            ->and($again->trashed())->toBeFalse()
            ->and($again->participant_id)->toBe($result['result']['participantId'])
            ->and($again->created_by)->toBe($this->seller->id);
    });

    it('rechaza ventas fuera del talonario del vendedor', function () {
        $other = User::factory()->create();
        addMember($this->raffle, $other, 'seller', [[1, 10], [20, 25]]);

        expect(sendOp($other, $this->raffle, assignOp([5, 21], 'Ana'))['status'])->toBe('accepted');
        $result = sendOp($other, $this->raffle, assignOp([10, 11, 30], 'Beto'));
        expect($result)->toMatchArray(['status' => 'rejected', 'reason' => 'outside_ranges'])
            ->and($result['message'])->toBe('Los números 11 y 30 están fuera de tu talonario');

        expect(sendOp($other, $this->raffle, op('number.release', ['number' => 50]))['reason'])->toBe('outside_ranges');
        expect(sendOp($this->owner, $this->raffle, assignOp([50], 'Carla'))['status'])->toBe('accepted');
    });
});

it('rechaza cualquier operación de un viewer y los tipos desconocidos', function () {
    $viewer = User::factory()->create();
    addMember($this->raffle, $viewer, 'viewer');

    $results = sendOps($viewer, $this->raffle, [assignOp([1], 'Ana'), op('raffle.updateShare', ['share' => []])])->json('results');
    expect(collect($results)->pluck('reason')->all())->toBe(['forbidden', 'forbidden'])
        ->and(RaffleNumber::count())->toBe(0);

    expect(sendOp($this->owner, $this->raffle, op('raffle.delete', []))['reason'])->toBe('unknown_type');
});

it('un rechazo no corta el lote', function () {
    sendOp($this->owner, $this->raffle, assignOp([1], 'Juan'));

    $results = sendOps($this->seller, $this->raffle, [
        assignOp([2], 'Ana'),
        assignOp([1], 'Beto'),
        op('foo.bar', []),
        assignOp([3], 'Carla'),
    ])->json('results');

    expect(collect($results)->pluck('status')->all())->toBe(['accepted', 'rejected', 'rejected', 'accepted'])
        ->and($results[3]['result']['seq'])->toBe(3)
        ->and(RaffleNumber::orderBy('number')->pluck('number')->all())->toBe([1, 2, 3]);
});

describe('number.release y number.transfer', function () {
    it('libera números en cascada: venta, comprobante y persona huérfana', function () {
        $assign = assignOp([1, 2], 'Ana');
        $saleId = $assign['payload']['saleId'];
        sendOp($this->owner, $this->raffle, $assign);
        sendOp($this->owner, $this->raffle, op('receipt.set', ['saleId' => $saleId, 'meta' => ['name' => 'pago.jpg', 'type' => 'image/jpeg', 'size' => 10, 'addedAt' => 1]]));

        sendOp($this->owner, $this->raffle, op('number.release', ['number' => 1]));
        expect(Sale::find($saleId))->not->toBeNull();

        expect(sendOp($this->owner, $this->raffle, op('number.release', ['number' => 2]))['status'])->toBe('accepted');
        expect(Sale::find($saleId))->toBeNull()
            ->and(Person::count())->toBe(0)
            ->and(Receipt::count())->toBe(0);

        // Liberar un número libre se acepta sin cambios.
        $version = snapshot($this->owner, $this->raffle)['version'];
        expect(sendOp($this->owner, $this->raffle, op('number.release', ['number' => 2]))['status'])->toBe('accepted')
            ->and(snapshot($this->owner, $this->raffle)['version'])->toBe($version);
    });

    it('transfiere un número: el pago queda en la venta original y se borra la persona huérfana', function () {
        $assign = assignOp([4], 'Ana');
        sendOp($this->owner, $this->raffle, $assign);
        $beto = personData('Beto');

        $result = sendOp($this->seller, $this->raffle, op('number.transfer', ['number' => 4, 'person' => $beto]));

        expect($result['result']['participantId'])->toBe($beto['id']);
        $number = RaffleNumber::where('number', 4)->sole();
        expect($number->participant_id)->toBe($beto['id'])
            ->and($number->sale_id)->toBe($assign['payload']['saleId'])
            ->and(Sale::find($assign['payload']['saleId'])->participant_id)->toBe($assign['payload']['person']['id'])
            ->and(Person::find($assign['payload']['person']['id']))->not->toBeNull(); // Todavía tiene la venta.

        expect(sendOp($this->owner, $this->raffle, op('number.transfer', ['number' => 50, 'person' => $beto])))
            ->toMatchArray(['reason' => 'number_not_taken', 'message' => 'El número 50 no está vendido']);
    });
});

describe('sale.void y sale.setAmount', function () {
    it('el vendedor no puede anular una venta ajena, el dueño sí', function () {
        $assign = assignOp([1, 2], 'Ana');
        sendOp($this->owner, $this->raffle, $assign);
        $void = op('sale.void', ['saleId' => $assign['payload']['saleId']]);

        expect(sendOp($this->seller, $this->raffle, $void))
            ->toMatchArray(['status' => 'rejected', 'reason' => 'not_yours']);

        expect(sendOp($this->owner, $this->raffle, op('sale.void', ['saleId' => $assign['payload']['saleId']]))['status'])->toBe('accepted')
            ->and(RaffleNumber::count())->toBe(0)
            ->and(Sale::count())->toBe(0)
            ->and(Person::count())->toBe(0);

        // Ya no existe: se acepta sin cambios.
        expect(sendOp($this->seller, $this->raffle, op('sale.void', ['saleId' => $assign['payload']['saleId']]))['status'])->toBe('accepted');
    });

    it('el vendedor anula sus propias ventas', function () {
        $assign = assignOp([1], 'Ana');
        sendOp($this->seller, $this->raffle, $assign);

        expect(sendOp($this->seller, $this->raffle, op('sale.void', ['saleId' => $assign['payload']['saleId']]))['status'])->toBe('accepted');
    });

    it('corrige el monto de una venta', function () {
        $assign = assignOp([1], 'Ana');
        $saleId = $assign['payload']['saleId'];
        sendOp($this->owner, $this->raffle, $assign);

        sendOp($this->seller, $this->raffle, op('sale.setAmount', ['saleId' => $saleId, 'amount' => 4500]));
        expect(Sale::find($saleId)->amount)->toBe(4500);
        sendOp($this->seller, $this->raffle, op('sale.setAmount', ['saleId' => $saleId, 'amount' => null]));
        expect(Sale::find($saleId)->amount)->toBeNull();

        expect(sendOp($this->owner, $this->raffle, op('sale.setAmount', ['saleId' => $saleId, 'amount' => 1.5]))['reason'])->toBe('invalid')
            ->and(sendOp($this->owner, $this->raffle, op('sale.setAmount', ['saleId' => uuid(), 'amount' => 1]))['reason'])->toBe('sale_not_found');
    });
});

describe('raffle.updateConfig y raffle.updateShare', function () {
    it('no deja bajar el total por debajo de un número vendido', function () {
        sendOp($this->owner, $this->raffle, assignOp([80], 'Ana'));

        $result = sendOp($this->owner, $this->raffle, op('raffle.updateConfig', ['config' => ['title' => 'Rifa', 'total' => 50]]));

        expect($result)->toMatchArray([
            'status' => 'rejected',
            'reason' => 'total_below_sold',
            'message' => 'No podés bajar el total a 50: el número 80 está vendido',
        ]);
        expect(sendOp($this->owner, $this->raffle, op('raffle.updateConfig', ['config' => ['title' => 'Nueva', 'total' => 80]]))['status'])->toBe('accepted');
        expect(snapshot($this->owner, $this->raffle)['raffle']['config'])->toMatchArray(['title' => 'Nueva', 'total' => 80]);
    });

    it('sólo el dueño cambia la configuración y valida los datos', function () {
        expect(sendOp($this->seller, $this->raffle, op('raffle.updateConfig', ['config' => ['total' => 10]]))['reason'])->toBe('forbidden')
            ->and(sendOp($this->owner, $this->raffle, op('raffle.updateConfig', ['config' => ['total' => 0]]))['reason'])->toBe('invalid');
    });

    it('guarda el estilo de la imagen normalizado', function () {
        sendOp($this->seller, $this->raffle, op('raffle.updateShare', ['share' => [
            'format' => 'post', 'palette' => 'custom', 'textFont' => 'comic-sans',
            'colors' => ['bg1' => '#AABBCC', 'bg2' => '#000000', 'bg3' => '#ffffff', 'accent' => '#123456', 'ink' => '#654321', 'card' => '#abcdef'],
        ]]));

        expect(snapshot($this->owner, $this->raffle)['raffle']['share'])->toMatchArray([
            'format' => 'post', 'palette' => 'custom', 'textFont' => 'outfit', 'mode' => 'available',
        ])->and(snapshot($this->owner, $this->raffle)['raffle']['share']['colors']['bg1'])->toBe('#aabbcc');
        expect(sendOp($this->owner, $this->raffle, op('raffle.updateShare', ['share' => 'x']))['reason'])->toBe('invalid');
    });
});

describe('personas y alias', function () {
    it('assign con la misma persona e id distinto la reutiliza y registra el alias', function () {
        $ana = personData('Ana', extra: ['phone' => '111']);
        sendOp($this->owner, $this->raffle, assignOp([1], $ana));
        $otherAna = personData('  ÁNA ', extra: ['email' => 'ana@example.com']);

        $result = sendOp($this->seller, $this->raffle, assignOp([2], $otherAna));

        expect($result['result']['participantId'])->toBe($ana['id'])
            ->and(Person::count())->toBe(1)
            ->and(Person::find($ana['id'])->only('name', 'phone', 'email'))->toBe(['name' => 'Ana', 'phone' => '111', 'email' => 'ana@example.com'])
            ->and(Alias::sole()->only('from_id', 'to_id'))->toBe(['from_id' => $otherAna['id'], 'to_id' => $ana['id']]);

        // Una operación posterior con el id viejo se resuelve contra el alias.
        $update = sendOp($this->seller, $this->raffle, op('person.update', [
            'personId' => $otherAna['id'],
            'data' => ['name' => 'Ana López', 'phone' => '222', 'email' => '', 'referrer' => 'Juli'],
        ]));
        expect($update['status'])->toBe('accepted')
            ->and(Person::find($ana['id'])->only('name', 'key', 'phone', 'email', 'referrer'))
            ->toBe(['name' => 'Ana López', 'key' => 'ana lopez', 'phone' => '222', 'email' => '', 'referrer' => 'Juli']);

        $transfer = sendOp($this->owner, $this->raffle, op('number.transfer', ['number' => 1, 'person' => personData('Ana López', $otherAna['id'])]));
        expect($transfer['result']['participantId'])->toBe($ana['id']);
    });

    it('person.update con el nombre de otra persona las unifica y resuelve el id viejo después', function () {
        $ana = personData('Ana', extra: ['phone' => '111']);
        $anita = personData('Anita', extra: ['email' => 'anita@example.com', 'referrer' => 'Juli']);
        $saleAnita = assignOp([2, 3], $anita);
        sendOps($this->owner, $this->raffle, [assignOp([1], $ana), $saleAnita]);

        $result = sendOp($this->seller, $this->raffle, op('person.update', [
            'personId' => $anita['id'],
            'data' => ['name' => 'ana', 'phone' => '999', 'email' => 'anita@example.com', 'referrer' => ''],
        ]));

        expect($result['result']['personId'])->toBe($ana['id'])
            ->and(Person::find($anita['id']))->toBeNull()
            ->and(Person::withTrashed()->find($anita['id'])->trashed())->toBeTrue()
            ->and(Person::find($ana['id'])->only('phone', 'email', 'referrer'))
            // Ana completa sólo sus campos vacíos con los datos editados.
            ->toBe(['phone' => '111', 'email' => 'anita@example.com', 'referrer' => ''])
            ->and(RaffleNumber::pluck('participant_id')->unique()->values()->all())->toBe([$ana['id']])
            ->and(Sale::find($saleAnita['payload']['saleId'])->participant_id)->toBe($ana['id'])
            ->and(Alias::sole()->only('from_id', 'to_id'))->toBe(['from_id' => $anita['id'], 'to_id' => $ana['id']]);

        // Operación offline que todavía usa el id de Anita: se resuelve a Ana.
        $edit = sendOp($this->owner, $this->raffle, op('person.update', [
            'personId' => $anita['id'],
            'data' => ['name' => 'Ana', 'phone' => '333', 'email' => '', 'referrer' => ''],
        ]));
        expect($edit['result']['personId'])->toBe($ana['id'])
            ->and(Person::find($ana['id'])->phone)->toBe('333');
    });

    it('rechaza editar una persona que no existe o con datos inválidos', function () {
        $ana = personData('Ana');
        sendOp($this->owner, $this->raffle, assignOp([1], $ana));

        expect(sendOp($this->owner, $this->raffle, op('person.update', ['personId' => uuid(), 'data' => ['name' => 'X']]))['reason'])->toBe('person_not_found')
            ->and(sendOp($this->owner, $this->raffle, op('person.update', ['personId' => $ana['id'], 'data' => ['name' => str_repeat('a', 81)]])))
            ->toMatchArray(['reason' => 'invalid', 'message' => 'El nombre puede tener hasta 80 caracteres'])
            ->and(sendOp($this->owner, $this->raffle, op('person.update', ['personId' => $ana['id'], 'data' => ['name' => 'Ana', 'email' => 'no']]))['message'])
            ->toBe('El correo no parece válido');
    });

    it('reactiva una persona borrada si vuelve con su mismo id', function () {
        $ana = personData('Ana');
        sendOp($this->owner, $this->raffle, assignOp([1], $ana));
        sendOp($this->owner, $this->raffle, op('number.release', ['number' => 1]));
        expect(Person::find($ana['id']))->toBeNull();

        $result = sendOp($this->seller, $this->raffle, assignOp([2], $ana));

        expect($result['result']['participantId'])->toBe($ana['id'])
            ->and(Person::find($ana['id']))->not->toBeNull()
            ->and(Alias::count())->toBe(0);
    });
});

describe('receipt.set y receipt.remove', function () {
    it('guarda y quita la metadata del comprobante', function () {
        $assign = assignOp([1], 'Ana');
        $saleId = $assign['payload']['saleId'];
        sendOp($this->owner, $this->raffle, $assign);

        sendOp($this->seller, $this->raffle, op('receipt.set', ['saleId' => $saleId, 'meta' => [
            'name' => 'pago.jpg', 'type' => 'image/jpeg', 'size' => 1234, 'thumb' => 'data:image/jpeg;base64,AAA', 'addedAt' => 1729850000001,
        ]]));
        expect(snapshot($this->owner, $this->raffle)['receipts'][0])->toBe([
            'saleId' => $saleId, 'name' => 'pago.jpg', 'type' => 'image/jpeg', 'size' => 1234,
            'thumb' => 'data:image/jpeg;base64,AAA', 'addedAt' => 1729850000001, 'hasFile' => false, 'deleted' => false,
        ]);

        expect(sendOp($this->owner, $this->raffle, op('receipt.remove', ['saleId' => $saleId]))['status'])->toBe('accepted')
            ->and(snapshot($this->owner, $this->raffle)['receipts'])->toBe([])
            ->and(sendOp($this->owner, $this->raffle, op('receipt.remove', ['saleId' => $saleId]))['status'])->toBe('accepted')
            ->and(sendOp($this->owner, $this->raffle, op('receipt.set', ['saleId' => uuid(), 'meta' => []]))['reason'])->toBe('sale_not_found');
    });
});

it('valida el sobre del lote', function () {
    actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/ops", ['ops' => [['type' => 'x']]])
        ->assertUnprocessable()->assertJsonValidationErrors('ops.0.opId');
    actingAsUser($this->owner)->postJson("/api/raffles/{$this->raffle}/ops", ['ops' => array_fill(0, 101, assignOp([1], 'Ana'))])
        ->assertUnprocessable()->assertJsonValidationErrors('ops');
    actingAsUser(User::factory()->create())->postJson("/api/raffles/{$this->raffle}/ops", ['ops' => []])->assertForbidden();
});

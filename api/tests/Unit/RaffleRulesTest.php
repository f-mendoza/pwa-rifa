<?php

use App\Sync\InvalidData;
use App\Sync\RaffleRules;

it('calcula la key de una persona igual que personKey del cliente', function (string $name, string $key) {
    expect(RaffleRules::personKey($name))->toBe($key);
})->with([
    ['Ana', 'ana'],
    ['  María   José  ', 'maria jose'],
    ['ÑANDÚ', 'nandu'],
    ["Ana\u{00A0}Paula", 'ana paula'],
    ['Zoë Łukasz', 'zoe łukasz'],
]);

it('limpia y valida los datos de una persona como cleanPerson', function () {
    expect(RaffleRules::cleanPerson(['name' => '  Ana   López ', 'phone' => ' 221 ', 'referrer' => ' Juli  P ']))
        ->toBe(['name' => 'Ana López', 'phone' => '221', 'email' => '', 'referrer' => 'Juli P']);

    expect(fn () => RaffleRules::cleanPerson(['name' => ' ']))->toThrow(InvalidData::class, 'El nombre es obligatorio');
    expect(fn () => RaffleRules::cleanPerson(['name' => 'Ana', 'phone' => str_repeat('1', 31)]))
        ->toThrow(InvalidData::class, 'El teléfono puede tener hasta 30 caracteres');
    expect(fn () => RaffleRules::cleanPerson(['name' => 'Ana', 'email' => 'ana@']))->toThrow(InvalidData::class, 'El correo no parece válido');
});

it('normaliza la configuración como normalizeConfig', function () {
    $config = RaffleRules::normalizeConfig(['title' => str_repeat('x', 50), 'total' => '150', 'prizes' => ['  A ', null, 'B'], 'drawText' => 7]);

    expect($config)->toBe([
        'title' => str_repeat('x', 40),
        'total' => 150,
        'price' => 5000,
        'packSize' => 2,
        'packPrice' => 8000,
        'prizes' => ['A', 'B'],
        'drawText' => '7',
    ]);
    expect(fn () => RaffleRules::normalizeConfig(['total' => 1001]))->toThrow(InvalidData::class);
    expect(fn () => RaffleRules::normalizeConfig(['price' => 1.5]))->toThrow(InvalidData::class);
    expect(fn () => RaffleRules::normalizeConfig(['prizes' => 'TV']))->toThrow(InvalidData::class);
});

it('normaliza el estilo de la imagen: lo desconocido vuelve al valor por defecto', function () {
    expect(RaffleRules::normalizeShare(['mode' => 'crossed', 'format' => 'cuadrado', 'palette' => 'noche', 'colors' => ['bg1' => '#fff']]))
        ->toBe(['mode' => 'crossed', 'format' => 'story', 'palette' => 'noche', 'colors' => null, 'titleFont' => 'big-shoulders', 'textFont' => 'outfit']);
});

it('valida montos y talonarios', function () {
    expect(RaffleRules::normalizeAmount(null))->toBeNull()
        ->and(RaffleRules::normalizeAmount(''))->toBeNull()
        ->and(RaffleRules::normalizeAmount(0))->toBe(0)
        ->and(RaffleRules::normalizeRanges([[1, 10], [20, 20]]))->toBe([[1, 10], [20, 20]])
        ->and(RaffleRules::normalizeRanges(null))->toBeNull();
    expect(fn () => RaffleRules::normalizeAmount(-1))->toThrow(InvalidData::class);
    expect(fn () => RaffleRules::normalizeRanges([[0, 10]]))->toThrow(InvalidData::class);
    expect(fn () => RaffleRules::normalizeRanges([[1, 2, 3]]))->toThrow(InvalidData::class);
});

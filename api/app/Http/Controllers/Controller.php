<?php

namespace App\Http\Controllers;

use App\Models\Raffle;
use App\Models\RaffleMember;
use Illuminate\Support\Facades\Gate;

abstract class Controller
{
    /**
     * Membresía del usuario en la rifa, con el permiso pedido (`view`, `sell` o `manage`, ver RafflePolicy).
     * Orden de los errores: 404 si la rifa no existe (lo resuelve el binding), 403 sin acceso, 410 si fue borrada.
     */
    protected function member(Raffle $raffle, string $ability = 'view'): RaffleMember
    {
        Gate::authorize($ability, $raffle);
        abort_if($raffle->trashed(), 410, 'La rifa fue borrada.');

        return $raffle->membershipFor(request()->user());
    }
}

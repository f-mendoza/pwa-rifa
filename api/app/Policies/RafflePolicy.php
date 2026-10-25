<?php

namespace App\Policies;

use App\Models\Raffle;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Roles en una rifa: `owner` (todo), `seller` (vender, comprobantes) y `viewer` (sólo leer).
 * Lo fino de cada operación de sync (talonarios, anular ventas propias) está en `OperationApplier`.
 */
class RafflePolicy
{
    /** Leer: cualquier miembro. */
    public function view(User $user, Raffle $raffle): Response
    {
        return $raffle->membershipFor($user)
            ? Response::allow()
            : Response::deny('No tenés acceso a esta rifa.');
    }

    /** Vender y adjuntar comprobantes: owner o seller. */
    public function sell(User $user, Raffle $raffle): Response
    {
        $member = $raffle->membershipFor($user);
        if (! $member) {
            return Response::deny('No tenés acceso a esta rifa.');
        }

        return $member->canSell()
            ? Response::allow()
            : Response::deny('Tu rol en esta rifa es sólo de lectura.');
    }

    /** Configurar, invitar, administrar miembros y borrar: sólo owner. */
    public function manage(User $user, Raffle $raffle): Response
    {
        $member = $raffle->membershipFor($user);
        if (! $member) {
            return Response::deny('No tenés acceso a esta rifa.');
        }

        return $member->isOwner()
            ? Response::allow()
            : Response::deny('Sólo quien organiza la rifa puede hacer esto.');
    }
}

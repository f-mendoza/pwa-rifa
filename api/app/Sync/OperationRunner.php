<?php

namespace App\Sync;

use App\Models\Operation;
use App\Models\Raffle;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Procesa un lote de `POST /raffles/{id}/ops`: en orden, cada operación en su propia transacción
 * con la rifa bloqueada. Un rechazo no corta el lote.
 *
 * Idempotencia: el resultado de cada operación (aceptada o rechazada) queda en `operations`;
 * si llega otra vez el mismo `opId`, se devuelve ese resultado sin volver a aplicarla.
 */
final class OperationRunner
{
    public function __construct(private readonly OperationApplier $applier) {}

    /**
     * @param  list<array{opId: string, type: string, payload?: mixed, createdAt?: ?int}>  $ops
     * @return array{results: list<array>, version: int}
     */
    public function run(Raffle $raffle, User $user, array $ops): array
    {
        $results = [];
        foreach ($ops as $op) {
            $results[] = DB::transaction(fn () => $this->runOne($raffle->id, $user, $op));
        }

        $version = (int) Raffle::withTrashed()->whereKey($raffle->id)->value('head_version');

        return ['results' => $results, 'version' => $version];
    }

    private function runOne(string $raffleId, User $user, array $op): array
    {
        $ctx = SyncContext::lock($raffleId, $user);

        $stored = Operation::find($op['opId']);
        if ($stored) {
            if ($stored->raffle_id !== $raffleId || $stored->user_id !== $user->id) {
                return ['opId' => $op['opId'], 'status' => 'rejected', 'reason' => 'invalid', 'message' => 'Esa operación ya se usó en otra rifa o por otra cuenta'];
            }

            return $stored->toResult();
        }

        $payload = $op['payload'] ?? null;
        if (is_array($payload) && ! isset($payload['createdAt']) && isset($op['createdAt'])) {
            $payload['createdAt'] = $op['createdAt'];
        }

        $operation = new Operation([
            'op_id' => $op['opId'],
            'raffle_id' => $raffleId,
            'user_id' => $user->id,
            'type' => $op['type'],
            'payload' => $op['payload'] ?? null,
            'client_created_at' => $op['createdAt'] ?? null,
        ]);

        try {
            // Transacción anidada (savepoint): si la operación se rechaza a mitad de camino, se deshace
            // lo que hubiera escrito, pero el rechazo igual queda guardado.
            $result = DB::transaction(function () use ($ctx, $op, $payload) {
                $result = $this->applier->apply($ctx, $op['type'], $payload);
                $ctx->finish();

                return $result;
            });
            $operation->fill(['status' => 'accepted', 'result' => $result]);
        } catch (Rejected $rejection) {
            $operation->fill(['status' => 'rejected', 'reason' => $rejection->reason, 'message' => $rejection->getMessage()]);
        }

        $operation->save();

        return $operation->toResult();
    }
}

<?php

namespace App\Sync;

use App\Http\Resources\NumberResource;
use App\Http\Resources\PersonResource;
use App\Http\Resources\RaffleResource;
use App\Http\Resources\ReceiptResource;
use App\Http\Resources\SaleResource;
use App\Models\Alias;
use App\Models\Person;
use App\Models\Raffle;
use App\Models\RaffleMember;
use App\Models\RaffleNumber;
use App\Models\Receipt;
use App\Models\Sale;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Lecturas de sync: el estado completo (`snapshot`) y lo que cambió desde una versión (`changes`).
 *
 * Primero se lee `head_version` y después sólo filas con versión <= head: lo que se confirme en el
 * medio tiene versión mayor y llega en el próximo pull, así el cliente nunca se saltea un cambio.
 */
final class RaffleFeed
{
    public function snapshot(Raffle $raffle, RaffleMember $member): array
    {
        return DB::transaction(function () use ($raffle, $member) {
            $raffle->refresh();

            return [
                'raffle' => new RaffleResource($raffle),
                ...$this->rows($raffle, fn (Builder $q) => $q),
                'role' => $member->role,
                'ranges' => $member->ranges,
                'version' => $raffle->head_version,
            ];
        });
    }

    public function changes(Raffle $raffle, RaffleMember $member, int $since): array
    {
        return DB::transaction(function () use ($raffle, $member, $since) {
            $raffle->refresh();
            $head = $raffle->head_version;
            $window = fn (Builder $q) => $q->withTrashed()->where('version', '>', $since)->where('version', '<=', $head);

            return [
                'raffle' => $raffle->version > $since ? new RaffleResource($raffle) : null,
                ...$this->rows($raffle, $window),
                'aliases' => Alias::where('raffle_id', $raffle->id)
                    ->where('version', '>', $since)->where('version', '<=', $head)
                    ->orderBy('version')->orderBy('id')->get()
                    ->map(fn (Alias $a) => ['entity' => $a->entity, 'from' => $a->from_id, 'to' => $a->to_id])
                    ->all(),
                'role' => $member->role,
                'ranges' => $member->ranges,
                'version' => $head,
            ];
        });
    }

    /** @param  callable(Builder): Builder  $scope */
    private function rows(Raffle $raffle, callable $scope): array
    {
        $query = fn (string $model) => $scope($model::query()->where('raffle_id', $raffle->id));

        return [
            'people' => PersonResource::collection($query(Person::class)->orderBy('created_at')->get()),
            'sales' => SaleResource::collection($query(Sale::class)->with('creator:id,name')->orderBy('seq')->get()),
            'numbers' => NumberResource::collection($query(RaffleNumber::class)->with('creator:id,name')->orderBy('number')->get()),
            'receipts' => ReceiptResource::collection($query(Receipt::class)->orderBy('sale_id')->get()),
        ];
    }
}

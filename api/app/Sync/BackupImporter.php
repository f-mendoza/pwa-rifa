<?php

namespace App\Sync;

use App\Models\Person;
use App\Models\RaffleNumber;
use App\Models\Receipt;
use App\Models\Sale;
use Illuminate\Support\Facades\Validator;

/** Carga inicial atómica, dentro de la transacción y el bloqueo de OperationRunner. */
final class BackupImporter
{
    public function apply(SyncContext $ctx, array $data): void
    {
        if (! $ctx->member->isOwner() || $ctx->raffle->owner_id !== $ctx->user->id) {
            throw new Rejected('forbidden', 'Sólo quien creó la rifa puede cargar un respaldo');
        }
        if ($ctx->raffle->last_seq > 0 || Person::withTrashed()->where('raffle_id', $ctx->raffleId())->exists()) {
            throw new Rejected('raffle_not_empty', 'Sólo podés cargar un respaldo en una rifa en la nube que todavía esté vacía');
        }

        $rules = [
            'config' => ['required', 'array'],
            'share' => ['present', 'array'],
            'people' => ['present', 'array', 'list', 'max:10000'],
            'sales' => ['present', 'array', 'list', 'max:10000'],
            'numbers' => ['present', 'array', 'list', 'max:'.config('rifa.max_total')],
            'receipts' => ['present', 'array', 'list', 'max:10000'],
            'people.*.id' => ['required', 'uuid', 'distinct:ignore_case'],
            'sales.*.id' => ['required', 'uuid', 'distinct:ignore_case'],
            'sales.*.seq' => ['required', 'integer', 'min:1', 'distinct'],
            'sales.*.participantId' => ['required', 'uuid'],
            'numbers.*.number' => ['required', 'integer', 'min:1', 'distinct'],
            'numbers.*.participantId' => ['required', 'uuid'],
            'numbers.*.saleId' => ['required', 'uuid'],
            'receipts.*.saleId' => ['required', 'uuid', 'distinct:ignore_case'],
            'receipts.*.meta' => ['required', 'array'],
        ];
        foreach (['people', 'sales', 'numbers', 'receipts'] as $list) {
            $rules["{$list}.*"] = ['required', 'array'];
            if ($list !== 'receipts') {
                $rules["{$list}.*.createdAt"] = ['required', 'integer', 'min:0'];
            }
        }
        if (Validator::make($data, $rules)->fails()) {
            throw Rejected::invalid('El respaldo tiene datos inválidos o repetidos');
        }

        $config = RaffleRules::normalizeConfig($data['config']);
        $share = RaffleRules::normalizeShare($data['share']);
        $people = [];
        $keys = [];
        foreach ($data['people'] as $p) {
            $id = strtolower($p['id']);
            $person = RaffleRules::cleanPerson($p);
            $key = RaffleRules::personKey($person['name']);
            if (isset($keys[$key]) || Person::withTrashed()->whereKey($id)->exists()) {
                throw Rejected::invalid('El respaldo tiene personas repetidas o con un id en uso');
            }
            $keys[$key] = true;
            $people[$id] = true;
            $ctx->save(new Person([
                ...$person, 'id' => $id, 'raffle_id' => $ctx->raffleId(),
                'key' => $key, 'unique_key' => $key, 'created_at' => $p['createdAt'],
            ]));
        }
        $sales = [];
        $lastSeq = 0;
        foreach ($data['sales'] as $s) {
            $id = strtolower($s['id']);
            $personId = strtolower($s['participantId']);
            if (! isset($people[$personId]) || Sale::withTrashed()->whereKey($id)->exists()) {
                throw Rejected::invalid('Una venta del respaldo no tiene persona o su id ya está en uso');
            }
            $sales[$id] = true;
            $lastSeq = max($lastSeq, $s['seq']);
            $ctx->save(new Sale([
                'id' => $id, 'raffle_id' => $ctx->raffleId(), 'participant_id' => $personId,
                'seq' => $s['seq'], 'amount' => RaffleRules::normalizeAmount($s['amount'] ?? null),
                'created_by' => $ctx->user->id, 'created_at' => $s['createdAt'],
            ]));
        }
        foreach ($data['numbers'] as $n) {
            $personId = strtolower($n['participantId']);
            $saleId = strtolower($n['saleId']);
            if (! isset($people[$personId], $sales[$saleId]) || $n['number'] > $config['total']) {
                throw Rejected::invalid('Un número del respaldo está fuera de rango o no tiene persona y venta');
            }
            $ctx->save(new RaffleNumber([
                'raffle_id' => $ctx->raffleId(), 'number' => $n['number'],
                'participant_id' => $personId, 'sale_id' => $saleId,
                'created_by' => $ctx->user->id, 'created_at' => $n['createdAt'],
            ]));
        }
        foreach ($data['receipts'] as $r) {
            $saleId = strtolower($r['saleId']);
            if (! isset($sales[$saleId])) {
                throw Rejected::invalid('Un comprobante del respaldo no tiene venta');
            }
            $ctx->save(new Receipt([
                'sale_id' => $saleId, 'raffle_id' => $ctx->raffleId(),
                ...OperationApplier::receiptMeta($r['meta']),
            ]));
        }
        $ctx->raffle->fill(['config' => $config, 'share' => $share, 'last_seq' => $lastSeq]);
        $ctx->save($ctx->raffle);
    }
}

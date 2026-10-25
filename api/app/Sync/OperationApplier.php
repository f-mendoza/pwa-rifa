<?php

namespace App\Sync;

use App\Models\Alias;
use App\Models\Person;
use App\Models\RaffleNumber;
use App\Models\Receipt;
use App\Models\Sale;
use Illuminate\Support\Collection;

/**
 * Aplica una operación del outbox sobre una rifa ya bloqueada (ver `OperationRunner`).
 *
 * Un método por tipo. Cada uno valida primero y escribe después; si rechaza, lanza `Rejected`
 * (y el runner deshace lo que hubiera escrito). Devuelve el `result` de la operación, o null.
 * La semántica es la de `docs/sync-protocolo.md` y la de las funciones equivalentes de `src/db.js`.
 */
final class OperationApplier
{
    private const HANDLERS = [
        'numbers.assign' => 'assignNumbers',
        'number.release' => 'releaseNumber',
        'number.transfer' => 'transferNumber',
        'sale.void' => 'voidSale',
        'sale.setAmount' => 'setSaleAmount',
        'person.update' => 'updatePerson',
        'raffle.updateConfig' => 'updateConfig',
        'raffle.updateShare' => 'updateShare',
        'receipt.set' => 'setReceipt',
        'receipt.remove' => 'removeReceipt',
    ];

    public function apply(SyncContext $ctx, string $type, mixed $payload): ?array
    {
        $handler = self::HANDLERS[$type] ?? null;
        if (! $handler) {
            throw new Rejected('unknown_type', 'El servidor no conoce este tipo de cambio. Actualizá la app.');
        }
        if (! $ctx->member->canSell()) {
            throw new Rejected('forbidden', 'Sólo podés ver esta rifa: no podés hacer cambios');
        }
        if (! is_array($payload)) {
            throw Rejected::invalid();
        }

        try {
            return $this->{$handler}($ctx, $payload);
        } catch (InvalidData $e) {
            throw Rejected::invalid($e->getMessage());
        }
    }

    // ---------- Números y ventas ----------

    private function assignNumbers(SyncContext $ctx, array $p): array
    {
        $saleId = $this->uuid($p['saleId'] ?? null, 'La venta no tiene un id válido');
        $numbers = $p['numbers'] ?? null;
        if (! is_array($numbers) || $numbers === [] || ! array_is_list($numbers)) {
            throw Rejected::invalid('No hay números para asignar');
        }
        foreach ($numbers as $n) {
            if (! is_int($n)) {
                throw Rejected::invalid('Los números tienen que ser enteros');
            }
        }
        if (count(array_unique($numbers)) !== count($numbers)) {
            throw Rejected::invalid('Hay números repetidos en la venta');
        }
        sort($numbers);
        $amount = RaffleRules::normalizeAmount($p['amount'] ?? null);
        RaffleRules::cleanPerson($p['person'] ?? null); // Valida antes de mirar los números.
        if (Sale::withTrashed()->whereKey($saleId)->exists()) {
            throw Rejected::invalid('Esa venta ya existe');
        }

        $total = (int) $ctx->raffle->config['total'];
        $outside = array_filter($numbers, fn ($n) => $n < 1 || $n > $total);
        if ($outside) {
            throw new Rejected('out_of_range', $this->numbersPhrase($outside, 'no existe', 'no existen')
                ." en esta rifa: los números van del 1 al {$total}");
        }
        $this->ensureCovered($ctx, $numbers);

        $taken = RaffleNumber::with(['participant:id,name', 'creator:id,name'])
            ->where('raffle_id', $ctx->raffleId())->whereIn('number', $numbers)->orderBy('number')->get();
        if ($taken->isNotEmpty()) {
            throw new Rejected('number_taken', $this->takenMessage($taken));
        }

        $person = $this->upsertPerson($ctx, $p['person'], $this->createdAt($p));
        $createdAt = $this->createdAt($p);
        $seq = $ctx->raffle->last_seq + 1;
        $ctx->raffle->last_seq = $seq;
        $ctx->save($ctx->raffle);

        $sale = new Sale([
            'id' => $saleId,
            'raffle_id' => $ctx->raffleId(),
            'seq' => $seq,
            'participant_id' => $person->id,
            'amount' => $amount,
            'created_by' => $ctx->user->id,
            'created_at' => $createdAt,
        ]);
        $ctx->save($sale);

        // Los números liberados conservan su fila con baja: se reactivan en vez de insertar otra.
        $previous = RaffleNumber::onlyTrashed()->where('raffle_id', $ctx->raffleId())
            ->whereIn('number', $numbers)->get()->keyBy('number');
        foreach ($numbers as $number) {
            $row = $previous->get($number) ?? new RaffleNumber(['raffle_id' => $ctx->raffleId(), 'number' => $number]);
            $row->fill([
                'participant_id' => $person->id,
                'sale_id' => $saleId,
                'created_by' => $ctx->user->id,
                'created_at' => $createdAt,
                'deleted_at' => null,
            ]);
            $ctx->save($row);
        }

        return ['seq' => $seq, 'participantId' => $person->id];
    }

    private function releaseNumber(SyncContext $ctx, array $p): ?array
    {
        $number = $this->number($p);
        $this->ensureCovered($ctx, [$number]);
        $row = $this->liveNumber($ctx, $number);
        if (! $row) {
            return null; // Ya estaba libre.
        }
        $ctx->remove($row);
        $this->dropSaleIfEmpty($ctx, $row->sale_id);
        $this->dropIfOrphan($ctx, $row->participant_id);

        return null;
    }

    private function transferNumber(SyncContext $ctx, array $p): array
    {
        $number = $this->number($p);
        RaffleRules::cleanPerson($p['person'] ?? null);
        $this->ensureCovered($ctx, [$number]);
        $row = $this->liveNumber($ctx, $number);
        if (! $row) {
            throw new Rejected('number_not_taken', "El número {$number} no está vendido");
        }
        $person = $this->upsertPerson($ctx, $p['person'], $this->createdAt($p));
        if ($person->id !== $row->participant_id) {
            $previous = $row->participant_id;
            $row->participant_id = $person->id;
            $ctx->save($row);
            $this->dropIfOrphan($ctx, $previous);
        }

        return ['participantId' => $person->id];
    }

    private function voidSale(SyncContext $ctx, array $p): ?array
    {
        $saleId = $this->uuid($p['saleId'] ?? null, 'La venta no tiene un id válido');
        $sale = $this->liveSale($ctx, $saleId);
        if (! $sale) {
            return null; // Ya no existe.
        }
        if (! $ctx->member->isOwner() && $sale->created_by !== $ctx->user->id) {
            throw new Rejected('not_yours', "Sólo podés anular las ventas que hiciste vos (el comprobante #{$sale->seq} lo cargó otra persona)");
        }
        $numbers = RaffleNumber::where('sale_id', $sale->id)->get();
        foreach ($numbers as $row) {
            $ctx->remove($row);
        }
        $ctx->remove($sale);
        $this->dropReceipt($ctx, $sale->id);
        foreach ($numbers->pluck('participant_id')->push($sale->participant_id)->unique() as $personId) {
            $this->dropIfOrphan($ctx, $personId);
        }

        return null;
    }

    private function setSaleAmount(SyncContext $ctx, array $p): ?array
    {
        $saleId = $this->uuid($p['saleId'] ?? null, 'La venta no tiene un id válido');
        $amount = RaffleRules::normalizeAmount($p['amount'] ?? null);
        $sale = $this->liveSale($ctx, $saleId) ?? throw new Rejected('sale_not_found', 'La venta ya no existe');
        $sale->amount = $amount;
        $ctx->save($sale);

        return null;
    }

    // ---------- Personas ----------

    private function updatePerson(SyncContext $ctx, array $p): array
    {
        $id = $this->resolve($ctx, $this->uuid($p['personId'] ?? null, 'La persona no tiene un id válido'));
        $data = RaffleRules::cleanPerson($p['data'] ?? null);
        $person = Person::where('raffle_id', $ctx->raffleId())->find($id)
            ?? throw new Rejected('person_not_found', 'La persona ya no existe');
        $key = RaffleRules::personKey($data['name']);

        $clash = Person::where('raffle_id', $ctx->raffleId())->where('key', $key)->whereKeyNot($person->id)->first();
        if (! $clash) {
            $person->fill([...$data, 'key' => $key, 'unique_key' => $key]);
            $ctx->save($person);

            return ['personId' => $person->id];
        }

        // Mismo nombre que otra persona: se unifican en la otra.
        $moved = $ctx->stamp(['participant_id' => $clash->id]);
        RaffleNumber::where('raffle_id', $ctx->raffleId())->where('participant_id', $person->id)->update($moved);
        Sale::where('raffle_id', $ctx->raffleId())->where('participant_id', $person->id)->update($moved);
        // La otra persona completa sólo sus campos vacíos con los datos editados.
        foreach (['phone', 'email', 'referrer'] as $field) {
            if ($clash->{$field} === '' && $data[$field] !== '') {
                $clash->{$field} = $data[$field];
            }
        }
        $ctx->save($clash);
        $ctx->remove($person);
        $this->addAlias($ctx, $person->id, $clash->id);

        return ['personId' => $clash->id];
    }

    /**
     * Devuelve la persona de la rifa con ese nombre, creándola si no existe (como `upsertParticipant`).
     * Si ya existía con otro id, registra el alias `id del cliente → id existente`.
     */
    private function upsertPerson(SyncContext $ctx, array $raw, int $createdAt): Person
    {
        $data = RaffleRules::cleanPerson($raw);
        $id = $this->resolve($ctx, $this->uuid($raw['id'] ?? null, 'La persona no tiene un id válido'));
        $key = RaffleRules::personKey($data['name']);

        $existing = Person::where('raffle_id', $ctx->raffleId())->where('key', $key)->first();
        if ($existing) {
            $this->completeContact($ctx, $existing, $data);
            $isOtherPerson = Person::where('raffle_id', $ctx->raffleId())->whereKey($id)->exists();
            if ($existing->id !== $id && ! $isOtherPerson) {
                $this->addAlias($ctx, $id, $existing->id);
            }

            return $existing;
        }

        $row = Person::withTrashed()->find($id);
        if ($row && $row->raffle_id !== $ctx->raffleId()) {
            throw Rejected::invalid('El id de la persona ya está en uso');
        }
        if ($row && ! $row->trashed()) {
            // La persona existe con otro nombre (la renombraron desde otro teléfono): es la misma.
            $this->completeContact($ctx, $row, $data);

            return $row;
        }

        $row ??= new Person(['id' => $id, 'raffle_id' => $ctx->raffleId(), 'created_at' => $createdAt]);
        $row->fill([...$data, 'key' => $key, 'unique_key' => $key, 'deleted_at' => null]);
        $ctx->save($row);

        return $row;
    }

    /** Completa sólo los campos de contacto que vienen no vacíos. */
    private function completeContact(SyncContext $ctx, Person $person, array $data): void
    {
        foreach (['phone', 'email', 'referrer'] as $field) {
            if ($data[$field] !== '') {
                $person->{$field} = $data[$field];
            }
        }
        $ctx->save($person);
    }

    private function addAlias(SyncContext $ctx, string $from, string $to): void
    {
        $alias = Alias::firstOrNew(['raffle_id' => $ctx->raffleId(), 'entity' => 'person', 'from_id' => $from]);
        $alias->fill(['to_id' => $to, 'version' => $ctx->version()])->save();
    }

    /** Sigue los alias de un id de persona hasta el actual. */
    private function resolve(SyncContext $ctx, string $id): string
    {
        for ($hops = 0; $hops < 20; $hops++) {
            $to = Alias::where('raffle_id', $ctx->raffleId())->where('entity', 'person')->where('from_id', $id)->value('to_id');
            if (! $to || $to === $id) {
                break;
            }
            $id = $to;
        }

        return $id;
    }

    // ---------- Rifa ----------

    private function updateConfig(SyncContext $ctx, array $p): ?array
    {
        if (! $ctx->member->isOwner()) {
            throw new Rejected('forbidden', 'Sólo quien organiza la rifa puede cambiar la configuración');
        }
        if (! is_array($p['config'] ?? null)) {
            throw Rejected::invalid('Falta la configuración');
        }
        $config = RaffleRules::normalizeConfig($p['config']);
        $highest = RaffleNumber::where('raffle_id', $ctx->raffleId())->max('number');
        if ($highest && $highest > $config['total']) {
            throw new Rejected('total_below_sold', "No podés bajar el total a {$config['total']}: el número {$highest} está vendido");
        }
        $ctx->raffle->config = $config;
        $ctx->save($ctx->raffle);

        return null;
    }

    private function updateShare(SyncContext $ctx, array $p): ?array
    {
        if (! is_array($p['share'] ?? null)) {
            throw Rejected::invalid('Faltan las preferencias de la imagen');
        }
        $ctx->raffle->share = RaffleRules::normalizeShare($p['share']);
        $ctx->save($ctx->raffle);

        return null;
    }

    // ---------- Comprobantes ----------

    private function setReceipt(SyncContext $ctx, array $p): ?array
    {
        $saleId = $this->uuid($p['saleId'] ?? null, 'La venta no tiene un id válido');
        $meta = is_array($p['meta'] ?? null) ? $p['meta'] : [];
        $this->liveSale($ctx, $saleId) ?? throw new Rejected('sale_not_found', 'La venta ya no existe');
        $fields = self::receiptMeta($meta);

        $receipt = Receipt::withTrashed()->find($saleId)
            ?? new Receipt(['sale_id' => $saleId, 'raffle_id' => $ctx->raffleId()]);
        // Metadata nueva = comprobante nuevo: el archivo anterior se descarta hasta que suban el nuevo.
        ReceiptFiles::deleteAfterCommit($receipt->path);
        $receipt->path = null;
        $receipt->fill([...$fields, 'deleted_at' => null]);
        $ctx->save($receipt);

        return null;
    }

    private function removeReceipt(SyncContext $ctx, array $p): ?array
    {
        $saleId = $this->uuid($p['saleId'] ?? null, 'La venta no tiene un id válido');
        $this->dropReceipt($ctx, $saleId);

        return null;
    }

    /**
     * Metadata de un comprobante, limpia: lo que no tiene la forma esperada queda vacío.
     *
     * @return array{name: string, type: string, size: int, thumb: ?string, added_at: int}
     */
    public static function receiptMeta(array $meta): array
    {
        $thumb = $meta['thumb'] ?? null;

        return [
            'name' => mb_substr(is_string($meta['name'] ?? null) ? $meta['name'] : '', 0, 255),
            'type' => mb_substr(is_string($meta['type'] ?? null) ? $meta['type'] : '', 0, 100),
            'size' => RaffleRules::toCount($meta['size'] ?? 0) ?? 0,
            'thumb' => is_string($thumb) && str_starts_with($thumb, 'data:image/') && strlen($thumb) <= 300_000 ? $thumb : null,
            'added_at' => RaffleRules::toCount($meta['addedAt'] ?? null) ?? Person::nowMs(),
        ];
    }

    // ---------- Bajas en cascada ----------

    /** Borra la venta (y su comprobante) si ya no le queda ningún número. */
    private function dropSaleIfEmpty(SyncContext $ctx, string $saleId): void
    {
        $sale = $this->liveSale($ctx, $saleId);
        if (! $sale || RaffleNumber::where('sale_id', $saleId)->exists()) {
            return;
        }
        $ctx->remove($sale);
        $this->dropReceipt($ctx, $saleId);
        $this->dropIfOrphan($ctx, $sale->participant_id);
    }

    /** Borra la persona si no tiene números ni ventas. */
    private function dropIfOrphan(SyncContext $ctx, string $personId): void
    {
        $owns = RaffleNumber::where('participant_id', $personId)->exists() || Sale::where('participant_id', $personId)->exists();
        $person = $owns ? null : Person::where('raffle_id', $ctx->raffleId())->find($personId);
        if ($person) {
            $ctx->remove($person);
        }
    }

    private function dropReceipt(SyncContext $ctx, string $saleId): void
    {
        $receipt = Receipt::where('raffle_id', $ctx->raffleId())->find($saleId);
        if (! $receipt) {
            return;
        }
        ReceiptFiles::deleteAfterCommit($receipt->path);
        $receipt->path = null;
        $ctx->remove($receipt);
    }

    // ---------- Ayudas ----------

    private function liveNumber(SyncContext $ctx, int $number): ?RaffleNumber
    {
        return RaffleNumber::where('raffle_id', $ctx->raffleId())->where('number', $number)->first();
    }

    private function liveSale(SyncContext $ctx, string $saleId): ?Sale
    {
        return Sale::where('raffle_id', $ctx->raffleId())->find($saleId);
    }

    /** Rechaza si algún número está fuera del talonario del vendedor. */
    private function ensureCovered(SyncContext $ctx, array $numbers): void
    {
        $outside = array_filter($numbers, fn ($n) => ! $ctx->member->covers($n));
        if ($outside) {
            throw new Rejected('outside_ranges', $this->numbersPhrase($outside, 'está', 'están').' fuera de tu talonario');
        }
    }

    private function takenMessage(Collection $taken): string
    {
        $first = $taken->first();
        if ($taken->count() === 1) {
            $seller = $first->creator?->name;

            return $seller
                ? "El número {$first->number} ya lo había vendido {$seller} a {$first->participant?->name} desde otro teléfono"
                : "El número {$first->number} ya estaba vendido a {$first->participant?->name}";
        }
        $detail = $taken->map(fn ($row) => "el {$row->number} a {$row->participant?->name}")->all();

        return 'Los números '.RaffleRules::listing($taken->pluck('number')->all())
            .' ya estaban vendidos desde otro teléfono ('.RaffleRules::listing($detail).')';
    }

    /** "El número 7 está" / "Los números 7 y 8 están". */
    private function numbersPhrase(array $numbers, string $singular, string $plural): string
    {
        return count($numbers) === 1
            ? 'El número '.reset($numbers)." {$singular}"
            : 'Los números '.RaffleRules::listing($numbers)." {$plural}";
    }

    private function number(array $p): int
    {
        $number = $p['number'] ?? null;
        if (! is_int($number)) {
            throw Rejected::invalid('Falta el número');
        }

        return $number;
    }

    private function uuid(mixed $value, string $message): string
    {
        if (! RaffleRules::isUuid($value)) {
            throw Rejected::invalid($message);
        }

        return strtolower($value);
    }

    private function createdAt(array $p): int
    {
        return RaffleRules::toCount($p['createdAt'] ?? null) ?? Person::nowMs();
    }
}

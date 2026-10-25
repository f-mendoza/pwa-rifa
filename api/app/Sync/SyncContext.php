<?php

namespace App\Sync;

use App\Models\Person;
use App\Models\Raffle;
use App\Models\RaffleMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Una escritura sobre una rifa, dentro de su transacción y con la fila de la rifa bloqueada.
 *
 * Todas las filas que toca reciben la misma versión nueva, que se pide al contador recién en el
 * primer cambio real (una operación sin efecto no consume versión). Al terminar, `finish()` deja
 * esa versión como `head_version` de la rifa.
 */
final class SyncContext
{
    private ?int $version = null;

    public function __construct(
        public readonly Raffle $raffle,
        public readonly User $user,
        public readonly RaffleMember $member,
    ) {}

    /** Bloquea la rifa (aunque esté borrada) para escribir en ella. */
    public static function lock(string $raffleId, User $user): self
    {
        $raffle = Raffle::withTrashed()->lockForUpdate()->find($raffleId);
        abort_if(! $raffle, 404, 'La rifa no existe.');
        $member = $raffle->membershipFor($user);
        abort_if(! $member, 403, 'No tenés acceso a esta rifa.');
        abort_if($raffle->trashed(), 410, 'La rifa fue borrada.');

        return new self($raffle, $user, $member);
    }

    public function version(): int
    {
        return $this->version ??= VersionCounter::next();
    }

    public function raffleId(): string
    {
        return $this->raffle->id;
    }

    /** Guarda la fila con una versión nueva, si algo cambió. */
    public function save(Model $row): void
    {
        if ($row->exists && ! $row->isDirty()) {
            return;
        }
        $row->setAttribute('version', $this->version());
        $row->save();
    }

    /** Baja lógica (llega a los clientes en el pull). */
    public function remove(Model $row): void
    {
        if ($row->getAttribute('deleted_at') !== null) {
            return;
        }
        $row->setAttribute('deleted_at', $row->freshTimestamp());
        if ($row instanceof Person) {
            $row->unique_key = null;
        }
        $this->save($row);
    }

    /** Campos para las actualizaciones masivas (`query->update(...)`). */
    public function stamp(array $values = []): array
    {
        return [...$values, 'version' => $this->version()];
    }

    public function finish(): void
    {
        if ($this->version === null) {
            return;
        }
        $this->raffle->head_version = $this->version;
        $this->raffle->save();
    }
}

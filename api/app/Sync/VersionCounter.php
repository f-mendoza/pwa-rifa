<?php

namespace App\Sync;

use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Contador global de versiones (fila `version` de `sync_counters`). Portable: un SELECT … FOR UPDATE
 * y un UPDATE dentro de la transacción de quien escribe, sin secuencias propias de un motor.
 *
 * La fila queda bloqueada hasta el commit, así que las escrituras se ordenan: dentro de una rifa
 * (que además se bloquea antes) las versiones crecen en el mismo orden en que se confirman.
 */
final class VersionCounter
{
    public static function next(): int
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('La versión se pide dentro de una transacción.');
        }
        $current = DB::table('sync_counters')->where('name', 'version')->lockForUpdate()->value('value');
        $next = (int) $current + 1;
        DB::table('sync_counters')->where('name', 'version')->update(['value' => $next]);

        return $next;
    }
}

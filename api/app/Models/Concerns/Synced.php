<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Fila que se sincroniza: tiene `version` y baja lógica (`deleted_at`), y su `created_at`
 * está en milisegundos epoch (lo maneja la app, no Eloquent).
 *
 * Las escrituras pasan por `App\Sync\SyncContext`, que les asigna la versión.
 */
trait Synced
{
    use SoftDeletes;

    public function initializeSynced(): void
    {
        $this->timestamps = false;
        $this->mergeCasts([
            'created_at' => 'integer',
            'version' => 'integer',
            'deleted_at' => 'datetime',
        ]);
    }

    public static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }
}

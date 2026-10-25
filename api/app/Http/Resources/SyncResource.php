<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Resources\Json\JsonResource;

/** Base de las filas que se sincronizan (camelCase, fechas en ms). */
abstract class SyncResource extends JsonResource
{
    protected function userRef(?User $user): ?array
    {
        return $user ? ['id' => $user->id, 'name' => $user->name] : null;
    }

    protected function isDeleted(): bool
    {
        return $this->resource->deleted_at !== null;
    }
}

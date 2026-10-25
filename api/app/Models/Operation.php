<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Operación ya procesada: da la idempotencia por `op_id` y sirve de auditoría. */
class Operation extends Model
{
    public const UPDATED_AT = null;

    protected $primaryKey = 'op_id';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['payload' => 'array', 'result' => 'array', 'client_created_at' => 'integer', 'user_id' => 'integer'];
    }

    /** El resultado tal como se devuelve en `results`. */
    public function toResult(): array
    {
        return array_filter([
            'opId' => $this->op_id,
            'status' => $this->status,
            'reason' => $this->reason,
            'message' => $this->message,
            'result' => $this->result,
        ], fn ($value) => $value !== null);
    }
}

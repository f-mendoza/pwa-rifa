<?php

namespace App\Models;

use App\Models\Concerns\Synced;
use Illuminate\Database\Eloquent\Model;

/** Metadata del comprobante de una venta. El archivo (si ya se subió) está en `path`. */
class Receipt extends Model
{
    use Synced;

    protected $primaryKey = 'sale_id';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['size' => 'integer', 'added_at' => 'integer'];
    }
}

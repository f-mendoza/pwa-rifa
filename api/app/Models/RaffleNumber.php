<?php

namespace App\Models;

use App\Models\Concerns\Synced;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Un número vendido. Uno libre no tiene fila viva (puede tener una con baja, que se reactiva). */
class RaffleNumber extends Model
{
    use Synced;

    protected $table = 'numbers';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['number' => 'integer', 'created_by' => 'integer'];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function participant(): BelongsTo
    {
        return $this->belongsTo(Person::class, 'participant_id')->withTrashed();
    }
}

<?php

namespace App\Models;

use App\Models\Concerns\Synced;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Sale extends Model
{
    use Synced;

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['seq' => 'integer', 'amount' => 'integer', 'created_by' => 'integer'];
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

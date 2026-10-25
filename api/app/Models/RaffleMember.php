<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Fila de `raffle_user`: el rol de un usuario en una rifa y su talonario (`ranges`). */
class RaffleMember extends Model
{
    public const OWNER = 'owner';

    public const SELLER = 'seller';

    public const VIEWER = 'viewer';

    protected $table = 'raffle_user';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            'ranges' => 'array',
            'archived_at' => 'datetime',
        ];
    }

    public function raffle(): BelongsTo
    {
        return $this->belongsTo(Raffle::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isOwner(): bool
    {
        return $this->role === self::OWNER;
    }

    public function canSell(): bool
    {
        return in_array($this->role, [self::OWNER, self::SELLER], true);
    }

    /** ¿El número está dentro de su talonario? Sólo los vendedores tienen talonario. */
    public function covers(int $number): bool
    {
        if ($this->role !== self::SELLER || $this->ranges === null) {
            return true;
        }
        foreach ($this->ranges as [$from, $to]) {
            if ($number >= $from && $number <= $to) {
                return true;
            }
        }

        return false;
    }
}

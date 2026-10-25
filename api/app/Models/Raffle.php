<?php

namespace App\Models;

use App\Models\Concerns\Synced;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Raffle extends Model
{
    use HasUuids, Synced;

    protected $guarded = [];

    protected $attributes = ['last_seq' => 0, 'version' => 0, 'head_version' => 0];

    /** @var array<int, RaffleMember|null> */
    private array $memberships = [];

    protected function casts(): array
    {
        return [
            'owner_id' => 'integer',
            'config' => 'array',
            'share' => 'array',
            'last_seq' => 'integer',
            'head_version' => 'integer',
        ];
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class);
    }

    public function members(): HasMany
    {
        return $this->hasMany(RaffleMember::class);
    }

    /** La membresía del usuario en esta rifa (se recuerda durante el pedido). */
    public function membershipFor(?User $user): ?RaffleMember
    {
        if (! $user) {
            return null;
        }

        return $this->memberships[$user->id] ??= $this->members()->where('user_id', $user->id)->first();
    }

    public function forgetMemberships(): void
    {
        $this->memberships = [];
    }

    public function title(): string
    {
        return (string) ($this->config['title'] ?? '');
    }
}

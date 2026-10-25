<?php

namespace App\Http\Resources;

use App\Models\Raffle;
use Illuminate\Http\Request;

/** @mixin Raffle */
class RaffleResource extends SyncResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'config' => $this->config,
            'share' => $this->share,
            'lastSeq' => $this->last_seq,
            'createdAt' => $this->created_at,
            'ownerId' => $this->owner_id,
            'deleted' => $this->isDeleted(),
        ];
    }
}

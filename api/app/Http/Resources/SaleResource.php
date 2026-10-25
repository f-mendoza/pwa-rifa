<?php

namespace App\Http\Resources;

use App\Models\Sale;
use Illuminate\Http\Request;

/** @mixin Sale */
class SaleResource extends SyncResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'seq' => $this->seq,
            'participantId' => $this->participant_id,
            'amount' => $this->amount,
            'createdAt' => $this->created_at,
            'createdBy' => $this->userRef($this->creator),
            'deleted' => $this->isDeleted(),
        ];
    }
}

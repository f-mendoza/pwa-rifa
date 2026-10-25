<?php

namespace App\Http\Resources;

use App\Models\RaffleNumber;
use Illuminate\Http\Request;

/** @mixin RaffleNumber */
class NumberResource extends SyncResource
{
    public function toArray(Request $request): array
    {
        return [
            'number' => $this->number,
            'participantId' => $this->participant_id,
            'saleId' => $this->sale_id,
            'createdAt' => $this->created_at,
            'createdBy' => $this->userRef($this->creator),
            'deleted' => $this->isDeleted(),
        ];
    }
}

<?php

namespace App\Http\Resources;

use App\Models\Person;
use Illuminate\Http\Request;

/** @mixin Person */
class PersonResource extends SyncResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'key' => $this->key,
            'phone' => $this->phone,
            'email' => $this->email,
            'referrer' => $this->referrer,
            'createdAt' => $this->created_at,
            'deleted' => $this->isDeleted(),
        ];
    }
}

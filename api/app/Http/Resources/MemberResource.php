<?php

namespace App\Http\Resources;

use App\Models\RaffleMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin RaffleMember */
class MemberResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'userId' => $this->user_id,
            'name' => $this->user->name,
            'email' => $this->user->email,
            'role' => $this->role,
            'ranges' => $this->ranges,
        ];
    }
}

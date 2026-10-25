<?php

namespace App\Http\Resources;

use App\Models\Receipt;
use Illuminate\Http\Request;

/** @mixin Receipt */
class ReceiptResource extends SyncResource
{
    public function toArray(Request $request): array
    {
        return [
            'saleId' => $this->sale_id,
            'name' => $this->name,
            'type' => $this->type,
            'size' => $this->size,
            'thumb' => $this->thumb,
            'addedAt' => $this->added_at,
            'hasFile' => $this->path !== null,
            'deleted' => $this->isDeleted(),
        ];
    }
}

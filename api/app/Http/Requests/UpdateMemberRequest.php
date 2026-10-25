<?php

namespace App\Http\Requests;

use App\Sync\InvalidData;
use App\Sync\RaffleRules;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/** `PATCH /raffles/{id}/members/{userId} { role?, ranges? }`. */
class UpdateMemberRequest extends FormRequest
{
    private ?array $ranges = null;

    public function rules(): array
    {
        return [
            'role' => ['sometimes', 'string', 'in:owner,seller,viewer'],
            'ranges' => ['sometimes', 'nullable', 'array'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty() || ! $this->has('ranges')) {
                return;
            }
            try {
                $this->ranges = RaffleRules::normalizeRanges($this->input('ranges'));
            } catch (InvalidData $e) {
                $validator->errors()->add('ranges', $e->getMessage());
            }
        }];
    }

    public function ranges(): ?array
    {
        return $this->ranges;
    }
}

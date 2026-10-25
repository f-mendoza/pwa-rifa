<?php

namespace App\Http\Requests;

use App\Sync\InvalidData;
use App\Sync\RaffleRules;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/** `POST /raffles { config, share }`. Un `id` en el cuerpo se ignora: lo genera el servidor. */
class StoreRaffleRequest extends FormRequest
{
    private array $normalized = [];

    public function rules(): array
    {
        return [
            'config' => ['required', 'array'],
            'share' => ['nullable', 'array'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            foreach (['config' => 'normalizeConfig', 'share' => 'normalizeShare'] as $field => $normalize) {
                try {
                    $this->normalized[$field] = RaffleRules::$normalize($this->input($field));
                } catch (InvalidData $e) {
                    $validator->errors()->add($field, $e->getMessage());
                }
            }
        }];
    }

    /** @return array{config: array, share: array} */
    public function normalized(): array
    {
        return $this->normalized;
    }
}

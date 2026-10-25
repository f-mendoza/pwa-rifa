<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * `POST /raffles/{id}/ops`. Acá se valida sólo el sobre del lote; el contenido de cada `payload`
 * lo valida `OperationApplier` y, si está mal, esa operación se rechaza con `invalid`.
 */
class OpsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'ops' => ['present', 'array', 'list', 'max:'.config('rifa.max_ops_per_batch')],
            'ops.*' => ['array'],
            'ops.*.opId' => ['required', 'string', 'max:64'],
            'ops.*.type' => ['required', 'string', 'max:64'],
            'ops.*.payload' => ['nullable'],
            'ops.*.createdAt' => ['nullable', 'integer', 'min:0'],
        ];
    }

    /** @return list<array> */
    public function ops(): array
    {
        return array_map(fn (array $op) => [
            'opId' => $op['opId'],
            'type' => $op['type'],
            'payload' => $op['payload'] ?? null,
            'createdAt' => isset($op['createdAt']) ? (int) $op['createdAt'] : null,
        ], $this->input('ops'));
    }
}

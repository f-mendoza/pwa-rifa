<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** `PUT /raffles/{id}/sales/{saleId}/receipt`: multipart con `file` (+ name, thumb, addedAt). */
class UploadReceiptRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'file' => [
                'required', 'file',
                'max:'.config('rifa.receipt_max_kb'),
                'mimetypes:'.implode(',', config('rifa.receipt_mimetypes')),
            ],
            'name' => ['nullable', 'string', 'max:255'],
            'thumb' => ['nullable', 'string', 'max:300000'],
            'addedAt' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.max' => 'El comprobante puede pesar hasta 10 MB.',
            'file.mimetypes' => 'El comprobante tiene que ser una imagen o un PDF.',
        ];
    }
}

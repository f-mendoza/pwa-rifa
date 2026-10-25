<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ChangesRequest extends FormRequest
{
    public function rules(): array
    {
        return ['since' => ['required', 'integer', 'min:0']];
    }
}

<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ArchiveRaffleRequest extends FormRequest
{
    public function rules(): array
    {
        return ['archived' => ['required', 'boolean']];
    }
}

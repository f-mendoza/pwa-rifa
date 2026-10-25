<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Un id que el servidor unificó con otro (por ahora sólo personas). */
class Alias extends Model
{
    public $timestamps = false;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['version' => 'integer'];
    }
}

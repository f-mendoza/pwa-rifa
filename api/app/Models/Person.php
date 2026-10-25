<?php

namespace App\Models;

use App\Models\Concerns\Synced;
use Illuminate\Database\Eloquent\Model;

class Person extends Model
{
    use Synced;

    protected $table = 'people';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected $attributes = ['phone' => '', 'email' => '', 'referrer' => ''];
}

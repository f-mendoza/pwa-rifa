<?php

namespace App\Sync;

use RuntimeException;

/** Una operación rechazada: `reason` es el código del contrato y el mensaje, el texto para mostrar. */
class Rejected extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }

    public static function invalid(string $message = 'Los datos de la operación no son válidos'): self
    {
        return new self('invalid', $message);
    }
}

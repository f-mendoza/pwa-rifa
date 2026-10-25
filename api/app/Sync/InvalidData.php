<?php

namespace App\Sync;

use RuntimeException;

/** Datos que no pasan las reglas de `RaffleRules`. El mensaje es para mostrar. */
class InvalidData extends RuntimeException {}

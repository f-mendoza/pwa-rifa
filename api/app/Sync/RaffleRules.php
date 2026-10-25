<?php

namespace App\Sync;

use Normalizer;

/**
 * Reglas de negocio de la PWA (`src/db.js`) portadas al servidor:
 * `normalizeConfig`, `normalizeSharePrefs`, `cleanPerson`, `personKey`, `normalizeAmount`.
 */
final class RaffleRules
{
    /** Espacios en blanco como los de `\s` en JavaScript (incluye los de Unicode). */
    private const SPACE = '[\s\p{Z}\x{FEFF}]';

    public static function trim(mixed $value): string
    {
        return (string) preg_replace('/^'.self::SPACE.'+|'.self::SPACE.'+$/u', '', self::text($value));
    }

    /** `cleanName`: recorta y colapsa los espacios. */
    public static function cleanName(mixed $value): string
    {
        return (string) preg_replace('/'.self::SPACE.'+/u', ' ', self::trim($value));
    }

    /** `personKey`: nombre limpio, sin diacríticos y en minúsculas. */
    public static function personKey(mixed $name): string
    {
        $decomposed = Normalizer::normalize(self::cleanName($name), Normalizer::FORM_D);

        return mb_strtolower((string) preg_replace('/\p{Diacritic}/u', '', (string) $decomposed));
    }

    /**
     * `cleanPerson`: limpia y valida los datos de una persona.
     *
     * @return array{name: string, phone: string, email: string, referrer: string}
     */
    public static function cleanPerson(mixed $person): array
    {
        if (! is_array($person)) {
            throw new InvalidData('Faltan los datos de la persona');
        }
        $limits = config('rifa.person_limits');
        $data = [
            'name' => self::cleanName($person['name'] ?? ''),
            'phone' => self::trim($person['phone'] ?? ''),
            'email' => self::trim($person['email'] ?? ''),
            'referrer' => self::cleanName($person['referrer'] ?? ''),
        ];
        if ($data['name'] === '') {
            throw new InvalidData('El nombre es obligatorio');
        }
        $labels = ['name' => 'El nombre', 'phone' => 'El teléfono', 'email' => 'El correo', 'referrer' => 'El referido'];
        foreach ($labels as $field => $label) {
            if (mb_strlen($data[$field]) > $limits[$field]) {
                throw new InvalidData("{$label} puede tener hasta {$limits[$field]} caracteres");
            }
        }
        if ($data['email'] !== '' && ! preg_match('/^[^\s@]+@[^\s@]+$/u', $data['email'])) {
            throw new InvalidData('El correo no parece válido');
        }

        return $data;
    }

    /** `normalizeAmount`: `null`/vacío = usar el calculado; si no, un entero >= 0. */
    public static function normalizeAmount(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $amount = self::toCount($value);
        if ($amount === null) {
            throw new InvalidData('El monto tiene que ser un número entero mayor o igual a 0');
        }

        return $amount;
    }

    /** `normalizeConfig`: valida y completa una configuración. */
    public static function normalizeConfig(mixed $raw): array
    {
        if ($raw !== null && ! is_array($raw)) {
            throw new InvalidData('La configuración no es válida');
        }
        $config = array_merge(config('rifa.default_config'), $raw ?? []);
        $max = config('rifa.max_total');
        $total = self::toCount($config['total'] ?? null, 1, $max);
        if ($total === null) {
            throw new InvalidData("La cantidad de números tiene que estar entre 1 y {$max}");
        }
        [$price, $packSize, $packPrice] = array_map(
            fn ($v) => self::toCount($v),
            [$config['price'] ?? null, $config['packSize'] ?? null, $config['packPrice'] ?? null],
        );
        if (in_array(null, [$price, $packSize, $packPrice], true)) {
            throw new InvalidData('Los precios tienen que ser números enteros');
        }
        if (! is_array($config['prizes'] ?? null) || ! array_is_list($config['prizes'])) {
            throw new InvalidData('Los premios tienen que ser una lista');
        }
        $prizes = array_values(array_filter(
            array_map(fn ($p) => mb_substr(self::trim($p), 0, 60), $config['prizes']),
            fn ($p) => $p !== '',
        ));

        return [
            'title' => mb_substr(self::trim($config['title'] ?? ''), 0, 40),
            'total' => $total,
            'price' => $price,
            'packSize' => $packSize,
            'packPrice' => $packPrice,
            'prizes' => array_slice($prizes, 0, 20),
            'drawText' => mb_substr(self::trim($config['drawText'] ?? ''), 0, 140),
        ];
    }

    /** `normalizeSharePrefs`: lo desconocido vuelve al valor por defecto. */
    public static function normalizeShare(mixed $raw): array
    {
        if ($raw !== null && ! is_array($raw)) {
            throw new InvalidData('Las preferencias de la imagen no son válidas');
        }
        $options = config('rifa.share');
        $defaults = $options['defaults'];
        $prefs = array_merge($defaults, $raw ?? []);
        $oneOf = fn ($value, array $allowed, $fallback) => is_string($value) && in_array($value, $allowed, true) ? $value : $fallback;

        return [
            'mode' => $oneOf($prefs['mode'], $options['modes'], $defaults['mode']),
            'format' => $oneOf($prefs['format'], $options['formats'], $defaults['format']),
            'palette' => $oneOf($prefs['palette'], ['app', 'custom', ...$options['themes']], 'app'),
            'colors' => self::normalizeColors($prefs['colors']),
            'titleFont' => $oneOf($prefs['titleFont'], $options['title_fonts'], $defaults['titleFont']),
            'textFont' => $oneOf($prefs['textFont'], $options['text_fonts'], $defaults['textFont']),
        ];
    }

    /** `normalizeImageColors`: una paleta completa de colores hex, o null. */
    private static function normalizeColors(mixed $colors): ?array
    {
        if (! is_array($colors)) {
            return null;
        }
        $clean = [];
        foreach (config('rifa.share.color_fields') as $field) {
            $value = $colors[$field] ?? null;
            if (! is_string($value) || ! preg_match('/^#[0-9a-f]{6}$/i', $value)) {
                return null;
            }
            $clean[$field] = strtolower($value);
        }

        return $clean;
    }

    /**
     * Talonario: `null` o una lista de pares `[desde, hasta]` dentro del máximo de números.
     *
     * @return list<array{int, int}>|null
     */
    public static function normalizeRanges(mixed $ranges): ?array
    {
        if ($ranges === null) {
            return null;
        }
        $max = config('rifa.max_total');
        if (! is_array($ranges) || ! array_is_list($ranges) || count($ranges) > 100) {
            throw new InvalidData('El talonario tiene que ser una lista de rangos');
        }
        $clean = [];
        foreach ($ranges as $range) {
            $from = is_array($range) && count($range) === 2 && array_is_list($range) ? self::toCount($range[0], 1, $max) : null;
            $to = $from !== null ? self::toCount($range[1], 1, $max) : null;
            if ($from === null || $to === null || $from > $to) {
                throw new InvalidData("Cada rango del talonario tiene que ir de un número a otro mayor o igual, entre 1 y {$max}");
            }
            $clean[] = [$from, $to];
        }

        return $clean;
    }

    /** Un entero dentro del rango, o null (como `toCount` del cliente). */
    public static function toCount(mixed $value, int $min = 0, int $max = PHP_INT_MAX): ?int
    {
        $n = match (true) {
            is_int($value) => $value,
            is_float($value) && floor($value) === $value && abs($value) < 2 ** 53 => (int) $value,
            is_string($value) && preg_match('/^\s*-?\d+\s*$/', $value) === 1 => (int) $value,
            default => null,
        };

        return $n !== null && $n >= $min && $n <= $max ? $n : null;
    }

    /** "7", "7 y 8", "7, 8 y 9". */
    public static function listing(array $items): string
    {
        $items = array_values($items);
        if (count($items) <= 1) {
            return (string) ($items[0] ?? '');
        }
        $last = array_pop($items);

        return implode(', ', $items).' y '.$last;
    }

    public static function isUuid(mixed $value): bool
    {
        return is_string($value) && preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }

    private static function text(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }
}

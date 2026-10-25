<?php

/*
| Reglas de negocio compartidas con la PWA. Los valores tienen que coincidir con los de
| `src/db.js`, `src/lib/shareImage.js`, `src/lib/themes.js` y `src/lib/fonts.js`.
*/

return [

    // Origen de la PWA, para los links de los correos.
    'frontend_url' => rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/'),

    // Disco de `config/filesystems.php` donde se guardan los comprobantes.
    'receipts_disk' => env('RECEIPTS_DISK', 'local'),

    // Tamaño máximo de un comprobante, en kilobytes (10 MB).
    'receipt_max_kb' => 10240,

    'receipt_mimetypes' => [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif',
        'application/pdf',
    ],

    // Días hasta que vence una invitación.
    'invitation_days' => 7,

    // Operaciones por lote en POST /raffles/{id}/ops.
    'max_ops_per_batch' => 100,

    'max_total' => 1000,

    'default_config' => [
        'title' => 'Rifa',
        'total' => 300,
        'price' => 5000,
        'packSize' => 2,
        'packPrice' => 8000,
        'prizes' => [
            'TV de 32"',
            'Pava eléctrica',
            'Kit de librería',
            'Voucher peluquería',
            'Book de fotos en La Plata',
        ],
        'drawText' => 'Sorteamos el 16 de noviembre por Lotería de la Provincia nocturna',
    ],

    // Largos máximos de los datos de una persona (LIMITS en src/db.js).
    'person_limits' => ['name' => 80, 'phone' => 30, 'email' => 120, 'referrer' => 80],

    'share' => [
        'defaults' => [
            'mode' => 'available',
            'format' => 'story',
            'palette' => 'app',
            'colors' => null,
            'titleFont' => 'big-shoulders',
            'textFont' => 'outfit',
        ],
        'modes' => ['available', 'crossed'],
        'formats' => ['story', 'post'],
        'themes' => ['flyer', 'menta', 'atardecer', 'oceano', 'lavanda', 'noche', 'grafito'],
        'color_fields' => ['bg1', 'bg2', 'bg3', 'accent', 'ink', 'card'],
        'title_fonts' => ['big-shoulders', 'anton', 'bebas', 'fredoka', 'dm-serif', 'lobster'],
        'text_fonts' => ['outfit', 'nunito', 'poppins', 'lora', 'atkinson'],
    ],

];

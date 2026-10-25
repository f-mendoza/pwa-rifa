<?php

/*
| Mensajes de validación en castellano rioplatense (sólo las reglas que usa la API y las más comunes).
| Lo que falte cae en el inglés de Laravel.
*/

return [
    'accepted' => 'Tenés que aceptar :attribute.',
    'array' => ':Attribute tiene que ser una lista.',
    'between' => [
        'numeric' => ':Attribute tiene que estar entre :min y :max.',
        'string' => ':Attribute tiene que tener entre :min y :max caracteres.',
        'array' => ':Attribute tiene que tener entre :min y :max elementos.',
        'file' => ':Attribute tiene que pesar entre :min y :max kilobytes.',
    ],
    'boolean' => ':Attribute tiene que ser verdadero o falso.',
    'confirmed' => 'Las contraseñas no coinciden.',
    'distinct' => ':Attribute está repetido.',
    'email' => ':Attribute no parece válido.',
    'exists' => ':Attribute no existe.',
    'file' => ':Attribute tiene que ser un archivo.',
    'image' => ':Attribute tiene que ser una imagen.',
    'in' => ':Attribute no es válido.',
    'integer' => ':Attribute tiene que ser un número entero.',
    'list' => ':Attribute tiene que ser una lista.',
    'max' => [
        'numeric' => ':Attribute no puede ser mayor que :max.',
        'string' => ':Attribute puede tener hasta :max caracteres.',
        'array' => ':Attribute puede tener hasta :max elementos.',
        'file' => ':Attribute puede pesar hasta :max kilobytes.',
    ],
    'mimes' => ':Attribute tiene que ser de tipo :values.',
    'mimetypes' => ':Attribute tiene que ser de tipo :values.',
    'min' => [
        'numeric' => ':Attribute tiene que ser al menos :min.',
        'string' => ':Attribute tiene que tener al menos :min caracteres.',
        'array' => ':Attribute tiene que tener al menos :min elementos.',
        'file' => ':Attribute tiene que pesar al menos :min kilobytes.',
    ],
    'numeric' => ':Attribute tiene que ser un número.',
    'present' => 'Falta :attribute.',
    'required' => 'Falta :attribute.',
    'same' => ':Attribute y :other tienen que coincidir.',
    'string' => ':Attribute tiene que ser un texto.',
    'unique' => ':Attribute ya está en uso.',
    'uploaded' => 'No se pudo subir :attribute.',
    'uuid' => ':Attribute no es un identificador válido.',

    'password' => [
        'letters' => 'La contraseña tiene que tener al menos una letra.',
        'mixed' => 'La contraseña tiene que tener mayúsculas y minúsculas.',
        'numbers' => 'La contraseña tiene que tener al menos un número.',
        'symbols' => 'La contraseña tiene que tener al menos un símbolo.',
        'uncompromised' => 'Esa contraseña apareció en una filtración de datos. Elegí otra.',
    ],

    'custom' => [
        'email' => ['unique' => 'Ya hay una cuenta con ese correo.'],
    ],

    'attributes' => [
        'name' => 'el nombre',
        'email' => 'el correo',
        'password' => 'la contraseña',
        'passwordConfirmation' => 'la confirmación de la contraseña',
        'deviceName' => 'el nombre del dispositivo',
        'token' => 'el código',
        'config' => 'la configuración',
        'share' => 'el estilo de la imagen',
        'ops' => 'la lista de operaciones',
        'ops.*.opId' => 'el id de la operación',
        'ops.*.type' => 'el tipo de operación',
        'ops.*.createdAt' => 'la fecha de la operación',
        'since' => 'la versión',
        'archived' => 'archivada',
        'role' => 'el rol',
        'ranges' => 'el talonario',
        'file' => 'el comprobante',
        'thumb' => 'la miniatura',
        'addedAt' => 'la fecha del comprobante',
    ],
];

<?php

namespace App\Sync;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Archivos de los comprobantes, en el disco configurado (`rifa.receipts_disk`). */
final class ReceiptFiles
{
    public static function disk(): Filesystem
    {
        return Storage::disk(config('rifa.receipts_disk'));
    }

    public static function store(string $raffleId, string $saleId, UploadedFile $file): string
    {
        $extension = $file->guessExtension() ?: 'bin';

        return self::disk()->putFileAs("receipts/{$raffleId}", $file, $saleId.'-'.Str::random(8).'.'.$extension);
    }

    /** Borra el archivo cuando se confirma la transacción en curso (si se deshace, el archivo sigue). */
    public static function deleteAfterCommit(?string $path): void
    {
        if ($path) {
            DB::afterCommit(fn () => self::disk()->delete($path));
        }
    }
}

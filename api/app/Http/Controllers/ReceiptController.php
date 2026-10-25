<?php

namespace App\Http\Controllers;

use App\Http\Requests\UploadReceiptRequest;
use App\Http\Resources\ReceiptResource;
use App\Models\Raffle;
use App\Models\Receipt;
use App\Models\Sale;
use App\Sync\OperationApplier;
use App\Sync\RaffleRules;
use App\Sync\ReceiptFiles;
use App\Sync\SyncContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

/** Archivos de los comprobantes: se suben y bajan aparte del outbox. */
class ReceiptController extends Controller
{
    public function show(Raffle $raffle, string $saleId): StreamedResponse
    {
        $this->member($raffle);
        $receipt = $this->receipt($raffle, $saleId);
        abort_if(! $receipt?->path || ! ReceiptFiles::disk()->exists($receipt->path), 404, 'El comprobante no tiene un archivo subido.');

        return ReceiptFiles::disk()->response($receipt->path, $receipt->name ?: null, [
            'Content-Type' => $receipt->type ?: 'application/octet-stream',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, max-age=0',
        ]);
    }

    /** Sube (o reemplaza) el archivo. Tipo y tamaño salen del archivo mismo. */
    public function update(UploadReceiptRequest $request, Raffle $raffle, string $saleId): JsonResponse
    {
        $this->member($raffle, 'sell');
        $saleId = $this->saleId($saleId);
        $file = $request->file('file');
        $path = ReceiptFiles::store($raffle->id, $saleId, $file);

        try {
            $receipt = DB::transaction(function () use ($request, $raffle, $saleId, $file, $path) {
                $ctx = SyncContext::lock($raffle->id, $request->user());
                abort_if(! Sale::where('raffle_id', $raffle->id)->find($saleId), 404, 'La venta no existe.');

                $receipt = Receipt::withTrashed()->find($saleId)
                    ?? new Receipt(['sale_id' => $saleId, 'raffle_id' => $raffle->id]);
                $previous = $receipt->path;
                $meta = OperationApplier::receiptMeta([
                    'name' => $request->input('name') ?? $file->getClientOriginalName(),
                    'thumb' => $request->input('thumb') ?? ($receipt->trashed() ? null : $receipt->thumb),
                    'addedAt' => $request->input('addedAt') ?? $receipt->added_at,
                ]);
                $receipt->fill([
                    ...$meta,
                    'type' => $file->getMimeType(),
                    'size' => $file->getSize(),
                    'path' => $path,
                    'deleted_at' => null,
                ]);
                $ctx->save($receipt);
                $ctx->finish();
                if ($previous !== $path) {
                    ReceiptFiles::deleteAfterCommit($previous);
                }

                return $receipt;
            });
        } catch (\Throwable $e) {
            ReceiptFiles::disk()->delete($path);
            throw $e;
        }

        return response()->json(new ReceiptResource($receipt));
    }

    public function destroy(Raffle $raffle, string $saleId): Response
    {
        $this->member($raffle, 'sell');
        $saleId = $this->saleId($saleId);
        DB::transaction(function () use ($raffle, $saleId) {
            $ctx = SyncContext::lock($raffle->id, request()->user());
            $receipt = Receipt::where('raffle_id', $raffle->id)->find($saleId);
            if ($receipt) {
                ReceiptFiles::deleteAfterCommit($receipt->path);
                $receipt->path = null;
                $ctx->remove($receipt);
                $ctx->finish();
            }
        });

        return response()->noContent();
    }

    private function receipt(Raffle $raffle, string $saleId): ?Receipt
    {
        return Receipt::where('raffle_id', $raffle->id)->find($this->saleId($saleId));
    }

    private function saleId(string $saleId): string
    {
        abort_unless(RaffleRules::isUuid($saleId), 404, 'La venta no existe.');

        return strtolower($saleId);
    }
}

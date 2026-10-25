<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChangesRequest;
use App\Http\Requests\OpsRequest;
use App\Models\Raffle;
use App\Sync\OperationRunner;
use App\Sync\RaffleFeed;
use Illuminate\Http\JsonResponse;

/** Sync por polling: snapshot, changes y el lote de operaciones del outbox. */
class SyncController extends Controller
{
    public function snapshot(Raffle $raffle, RaffleFeed $feed): JsonResponse
    {
        return response()->json($feed->snapshot($raffle, $this->member($raffle)));
    }

    public function changes(ChangesRequest $request, Raffle $raffle, RaffleFeed $feed): JsonResponse
    {
        $member = $this->member($raffle);

        return response()->json($feed->changes($raffle, $member, (int) $request->validated('since')));
    }

    /** Los permisos finos (viewer, talonarios, ventas ajenas) se rechazan operación por operación. */
    public function ops(OpsRequest $request, Raffle $raffle, OperationRunner $runner): JsonResponse
    {
        $this->member($raffle);

        return response()->json($runner->run($raffle, $request->user(), $request->ops()));
    }
}

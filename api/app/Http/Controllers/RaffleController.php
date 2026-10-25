<?php

namespace App\Http\Controllers;

use App\Http\Requests\ArchiveRaffleRequest;
use App\Http\Requests\StoreRaffleRequest;
use App\Models\Raffle;
use App\Models\RaffleMember;
use App\Sync\RaffleFeed;
use App\Sync\VersionCounter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

class RaffleController extends Controller
{
    /** Rifas (vivas) a las que el usuario tiene acceso. */
    public function index(Request $request): JsonResponse
    {
        $rows = RaffleMember::query()
            ->where('user_id', $request->user()->id)
            ->whereHas('raffle')
            ->with('raffle.owner:id,name')
            ->get()
            ->sortByDesc(fn (RaffleMember $m) => $m->raffle->created_at)
            ->map(fn (RaffleMember $m) => [
                'id' => $m->raffle->id,
                'title' => $m->raffle->title(),
                'role' => $m->role,
                'archivedAt' => $m->archived_at?->getTimestampMs(),
                'ownerName' => $m->raffle->owner?->name,
                'version' => $m->raffle->head_version,
                'deleted' => false,
            ])
            ->values();

        return response()->json($rows);
    }

    /** Crea una rifa en la nube. El id lo genera el servidor (UUIDv7); uno que venga en el cuerpo se ignora. */
    public function store(StoreRaffleRequest $request, RaffleFeed $feed): JsonResponse
    {
        $user = $request->user();
        $raffle = DB::transaction(function () use ($request, $user) {
            $version = VersionCounter::next();
            $raffle = Raffle::create([
                ...$request->normalized(),
                'owner_id' => $user->id,
                'last_seq' => 0,
                'created_at' => Raffle::nowMs(),
                'version' => $version,
                'head_version' => $version,
            ]);
            $raffle->members()->create(['user_id' => $user->id, 'role' => RaffleMember::OWNER]);

            return $raffle;
        });

        return response()->json($feed->snapshot($raffle, $raffle->membershipFor($user)), 201);
    }

    /** Sólo el dueño. Baja lógica: los miembros reciben 410 desde ahora. */
    public function destroy(Raffle $raffle): Response
    {
        $this->member($raffle, 'manage');
        DB::transaction(function () use ($raffle) {
            $locked = Raffle::lockForUpdate()->findOrFail($raffle->id);
            $version = VersionCounter::next();
            $locked->forceFill(['deleted_at' => $locked->freshTimestamp(), 'version' => $version, 'head_version' => $version])->save();
        });

        return response()->noContent();
    }

    /** Archivar es personal: sólo cambia la membresía de quien lo pide. */
    public function archive(ArchiveRaffleRequest $request, Raffle $raffle): Response
    {
        $member = $this->member($raffle);
        $member->update(['archived_at' => $request->boolean('archived') ? now() : null]);

        return response()->noContent();
    }
}

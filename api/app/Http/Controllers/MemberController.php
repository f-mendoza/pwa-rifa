<?php

namespace App\Http\Controllers;

use App\Http\Requests\UpdateMemberRequest;
use App\Http\Resources\MemberResource;
use App\Models\Raffle;
use App\Models\RaffleMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;

class MemberController extends Controller
{
    public function index(Raffle $raffle): JsonResponse
    {
        $this->member($raffle);
        $members = $raffle->members()->with('user:id,name,email')->get()
            ->sortBy(fn (RaffleMember $m) => [$m->isOwner() ? 0 : 1, mb_strtolower($m->user->name)])
            ->values();

        return response()->json(MemberResource::collection($members));
    }

    /** Sólo el dueño. El talonario sólo aplica a vendedores: para otros roles queda en null. */
    public function update(UpdateMemberRequest $request, Raffle $raffle, string $userId): JsonResponse
    {
        $this->member($raffle, 'manage');
        $target = $this->target($raffle, $request, $userId);

        $role = $request->input('role', $target->role);
        if ($target->isOwner() && $role !== RaffleMember::OWNER) {
            throw ValidationException::withMessages(['role' => 'No podés quitarte el rol de dueño de la rifa.']);
        }
        if (! $target->isOwner() && $role === RaffleMember::OWNER) {
            throw ValidationException::withMessages(['role' => 'La rifa tiene un solo dueño: elegí vendedor o lector.']);
        }
        $ranges = $request->has('ranges') ? $request->ranges() : $target->ranges;
        $target->update(['role' => $role, 'ranges' => $role === RaffleMember::SELLER ? $ranges : null]);

        return response()->json(new MemberResource($target->load('user:id,name,email')));
    }

    /** El dueño quita a otro; cualquiera sale con `me`; el dueño no puede salir (puede borrar la rifa). */
    public function destroy(Request $request, Raffle $raffle, string $userId): Response
    {
        $self = $userId === 'me' || (string) $request->user()->id === $userId;
        $this->member($raffle, $self ? 'view' : 'manage');
        $target = $this->target($raffle, $request, $userId);

        if ($target->isOwner()) {
            abort(422, $self
                ? 'Sos quien organiza la rifa: no podés salir. Si ya no la necesitás, podés borrarla.'
                : 'No se puede quitar a quien organiza la rifa.');
        }
        $target->delete();

        return response()->noContent();
    }

    private function target(Raffle $raffle, Request $request, string $userId): RaffleMember
    {
        $id = $userId === 'me' ? $request->user()->id : (ctype_digit($userId) ? (int) $userId : null);
        $member = $id ? $raffle->members()->where('user_id', $id)->first() : null;
        abort_if(! $member, 404, 'Esa persona no es miembro de la rifa.');

        return $member;
    }
}

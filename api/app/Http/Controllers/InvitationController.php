<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreInvitationRequest;
use App\Models\Invitation;
use App\Models\Raffle;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Invitaciones por link: `{origen de la PWA}/invitacion/{token}`. */
class InvitationController extends Controller
{
    /** Sólo el dueño. Vence a los 7 días y sirve una sola vez. */
    public function store(StoreInvitationRequest $request, Raffle $raffle): JsonResponse
    {
        $this->member($raffle, 'manage');
        $token = Str::random(40);
        $invitation = $raffle->invitations()->create([
            'invited_by' => $request->user()->id,
            'email' => $request->input('email'),
            'token_hash' => Invitation::hashToken($token),
            'role' => $request->input('role'),
            'expires_at' => now()->addDays(config('rifa.invitation_days')),
        ]);

        return response()->json([
            'token' => $token,
            'role' => $invitation->role,
            'expiresAt' => $invitation->expires_at->getTimestampMs(),
        ], 201);
    }

    /** Público: lo que muestra la pantalla de invitación antes de iniciar sesión. */
    public function show(string $token): JsonResponse
    {
        $invitation = $this->find($token);

        return response()->json([
            'raffleId' => $invitation->raffle_id,
            'raffleTitle' => $invitation->raffle->title(),
            'role' => $invitation->role,
            'invitedBy' => $invitation->inviter?->name,
            'expired' => $invitation->expired(),
            'accepted' => $invitation->accepted_at !== null,
        ]);
    }

    public function accept(Request $request, string $token): JsonResponse
    {
        $user = $request->user();

        return DB::transaction(function () use ($token, $user) {
            $invitation = $this->find($token, lock: true);
            $current = $invitation->raffle->membershipFor($user);
            if ($current) {
                return response()->json(['raffleId' => $invitation->raffle_id, 'role' => $current->role]);
            }
            abort_if($invitation->accepted_at !== null, 422, 'Esta invitación ya la usó otra persona. Pedile a quien organiza que te mande otra.');
            abort_if($invitation->expired(), 422, 'Esta invitación venció. Pedile a quien organiza que te mande otra.');
            abort_if($invitation->email && $invitation->email !== Str::lower($user->email), 403, 'Esta invitación es para otra cuenta de correo.');

            $invitation->raffle->members()->create(['user_id' => $user->id, 'role' => $invitation->role]);
            $invitation->update(['accepted_by' => $user->id, 'accepted_at' => now()]);

            return response()->json(['raffleId' => $invitation->raffle_id, 'role' => $invitation->role]);
        });
    }

    /** La invitación de una rifa viva; si no existe o la rifa se borró, 404 (no revela nada más). */
    private function find(string $token, bool $lock = false): Invitation
    {
        $query = Invitation::with(['raffle', 'inviter:id,name'])->where('token_hash', Invitation::hashToken($token));
        $invitation = ($lock ? $query->lockForUpdate() : $query)->first();
        abort_if(! $invitation || ! $invitation->raffle || $invitation->raffle->trashed(), 404, 'La invitación no existe o la rifa ya no está.');

        return $invitation;
    }
}

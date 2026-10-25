<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tablas de las rifas en la nube (ver docs/sync-protocolo.md).
 *
 * Las filas sincronizables tienen `version` (contador global, ver `sync_counters`),
 * `deleted_at` (las bajas viajan en el pull) y `created_at` en milisegundos epoch, como en el cliente.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_counters', function (Blueprint $table) {
            $table->string('name', 40)->primary();
            $table->unsignedBigInteger('value')->default(0);
        });
        DB::table('sync_counters')->insert(['name' => 'version', 'value' => 0]);

        Schema::create('raffles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('owner_id')->constrained('users');
            $table->json('config');
            $table->json('share');
            $table->unsignedInteger('last_seq')->default(0);
            $table->unsignedBigInteger('created_at');
            // Versión de la fila de la rifa (config, share, last_seq o baja)...
            $table->unsignedBigInteger('version')->default(0);
            // ...y la máxima de todo lo que tiene adentro: es la que guarda el cliente como `syncedVersion`.
            $table->unsignedBigInteger('head_version')->default(0);
            $table->timestamp('deleted_at')->nullable();
        });

        Schema::create('raffle_user', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 10);
            $table->json('ranges')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();
            $table->unique(['raffle_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('invitations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->foreignId('invited_by')->constrained('users')->cascadeOnDelete();
            $table->string('email')->nullable();
            // Se guarda el hash: el token sólo lo conoce quien recibe el link.
            $table->string('token_hash', 64)->unique();
            $table->string('role', 10);
            $table->timestamp('expires_at');
            $table->foreignId('accepted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();
        });

        Schema::create('people', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('key', 80);
            // `key` mientras la persona existe y null cuando se borra: así UNIQUE(raffle_id, unique_key)
            // vale sólo para las vivas sin depender de índices parciales (que MySQL no tiene).
            $table->string('unique_key', 80)->nullable();
            $table->string('phone', 30)->default('');
            $table->string('email', 120)->default('');
            $table->string('referrer', 80)->default('');
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('version');
            $table->timestamp('deleted_at')->nullable();
            $table->unique(['raffle_id', 'unique_key']);
            $table->index(['raffle_id', 'key']);
            $table->index(['raffle_id', 'version']);
        });

        Schema::create('sales', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->unsignedInteger('seq');
            $table->foreignUuid('participant_id')->constrained('people');
            $table->unsignedBigInteger('amount')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('version');
            $table->timestamp('deleted_at')->nullable();
            $table->unique(['raffle_id', 'seq']);
            $table->index(['raffle_id', 'version']);
            $table->index('participant_id');
        });

        Schema::create('numbers', function (Blueprint $table) {
            // Id interno: en el protocolo un número se identifica por (rifa, número).
            $table->id();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->unsignedSmallInteger('number');
            $table->foreignUuid('participant_id')->constrained('people');
            $table->foreignUuid('sale_id')->constrained('sales');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('version');
            $table->timestamp('deleted_at')->nullable();
            // Un número liberado conserva su fila (con baja) y se reactiva al volver a venderse.
            $table->unique(['raffle_id', 'number']);
            $table->index(['raffle_id', 'version']);
            $table->index('participant_id');
            $table->index('sale_id');
        });

        Schema::create('receipts', function (Blueprint $table) {
            $table->foreignUuid('sale_id')->primary()->constrained('sales');
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->string('path')->nullable();
            $table->string('name')->default('');
            $table->string('type', 100)->default('');
            $table->unsignedBigInteger('size')->default(0);
            $table->mediumText('thumb')->nullable();
            $table->unsignedBigInteger('added_at');
            $table->unsignedBigInteger('version');
            $table->timestamp('deleted_at')->nullable();
            $table->index(['raffle_id', 'version']);
        });

        Schema::create('operations', function (Blueprint $table) {
            $table->string('op_id', 64)->primary();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('type', 64);
            $table->json('payload')->nullable();
            $table->string('status', 10);
            $table->json('result')->nullable();
            $table->string('reason', 40)->nullable();
            $table->text('message')->nullable();
            $table->unsignedBigInteger('client_created_at')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['raffle_id', 'created_at']);
        });

        Schema::create('aliases', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('raffle_id')->constrained('raffles')->cascadeOnDelete();
            $table->string('entity', 20);
            $table->uuid('from_id');
            $table->uuid('to_id');
            $table->unsignedBigInteger('version');
            $table->unique(['raffle_id', 'entity', 'from_id']);
            $table->index(['raffle_id', 'version']);
        });
    }

    public function down(): void
    {
        foreach (['aliases', 'operations', 'receipts', 'numbers', 'sales', 'people', 'invitations', 'raffle_user', 'raffles', 'sync_counters'] as $table) {
            Schema::dropIfExists($table);
        }
    }
};

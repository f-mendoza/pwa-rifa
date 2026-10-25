<?php

use App\Models\Receipt;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('local');
    $this->owner = User::factory()->create();
    $this->raffle = createRaffle($this->owner);
    $assign = assignOp([1], 'Ana');
    $this->saleId = $assign['payload']['saleId'];
    sendOp($this->owner, $this->raffle, $assign);
    $this->url = "/api/raffles/{$this->raffle}/sales/{$this->saleId}/receipt";
});

it('sube, baja y borra el archivo del comprobante', function () {
    $file = UploadedFile::fake()->image('pago.jpg', 40, 40);
    $before = snapshot($this->owner, $this->raffle)['version'];

    $row = actingAsUser($this->owner)->put($this->url, [
        'file' => $file, 'name' => 'pago.jpg', 'thumb' => 'data:image/jpeg;base64,AAA', 'addedAt' => '1729850000000',
    ], ['Accept' => 'application/json'])->assertOk()->json();

    expect($row)->toMatchArray([
        'saleId' => $this->saleId, 'name' => 'pago.jpg', 'type' => 'image/jpeg', 'size' => $file->getSize(),
        'thumb' => 'data:image/jpeg;base64,AAA', 'addedAt' => 1729850000000, 'hasFile' => true, 'deleted' => false,
    ]);
    $path = Receipt::find($this->saleId)->path;
    Storage::disk('local')->assertExists($path);

    // Llega en el pull.
    $changes = changes($this->owner, $this->raffle, $before);
    expect($changes['receipts'][0]['hasFile'])->toBeTrue();

    $download = actingAsUser($this->owner)->get($this->url)->assertOk();
    expect($download->headers->get('Content-Type'))->toBe('image/jpeg')
        ->and($download->streamedContent())->toBe(file_get_contents($file->getPathname()));

    actingAsUser($this->owner)->deleteJson($this->url)->assertNoContent();
    Storage::disk('local')->assertMissing($path);
    actingAsUser($this->owner)->getJson($this->url)->assertNotFound();
    expect(changes($this->owner, $this->raffle, $changes['version'])['receipts'][0])->toMatchArray(['deleted' => true, 'hasFile' => false]);
});

it('acepta un PDF y rechaza otros tipos o archivos de más de 10 MB', function () {
    actingAsUser($this->owner)->put($this->url, ['file' => UploadedFile::fake()->create('pago.pdf', 100, 'application/pdf')], ['Accept' => 'application/json'])
        ->assertOk()->assertJsonPath('type', 'application/pdf');

    actingAsUser($this->owner)->put($this->url, ['file' => UploadedFile::fake()->create('virus.exe', 10, 'application/x-msdownload')], ['Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonPath('errors.file.0', 'El comprobante tiene que ser una imagen o un PDF.');
    actingAsUser($this->owner)->put($this->url, ['file' => UploadedFile::fake()->create('enorme.pdf', 10241, 'application/pdf')], ['Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonPath('errors.file.0', 'El comprobante puede pesar hasta 10 MB.');
    actingAsUser($this->owner)->put($this->url, [], ['Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonPath('errors.file.0', 'Falta el comprobante.');
});

it('los viewers no suben, una venta inexistente da 404 y quien no es miembro recibe 403', function () {
    $viewer = User::factory()->create();
    addMember($this->raffle, $viewer, 'viewer');
    $file = UploadedFile::fake()->image('pago.png');

    actingAsUser($viewer)->put($this->url, ['file' => $file], ['Accept' => 'application/json'])->assertForbidden();
    actingAsUser($this->owner)->put("/api/raffles/{$this->raffle}/sales/".uuid().'/receipt', ['file' => $file], ['Accept' => 'application/json'])->assertNotFound();
    actingAsUser(User::factory()->create())->getJson($this->url)->assertForbidden();
    Storage::disk('local')->assertDirectoryEmpty('receipts/'.$this->raffle);
});

it('un receipt.set posterior descarta el archivo subido', function () {
    actingAsUser($this->owner)->put($this->url, ['file' => UploadedFile::fake()->image('pago.jpg'), 'name' => 'pago.jpg', 'addedAt' => 5], ['Accept' => 'application/json'])->assertOk();
    $path = Receipt::find($this->saleId)->path;

    sendOp($this->owner, $this->raffle, op('receipt.set', ['saleId' => $this->saleId, 'meta' => ['name' => 'otro.jpg', 'type' => 'image/jpeg', 'size' => 9, 'addedAt' => 6]]));

    expect(Receipt::find($this->saleId)->path)->toBeNull();
    Storage::disk('local')->assertMissing($path);
});

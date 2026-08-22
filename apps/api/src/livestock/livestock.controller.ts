import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { schemas } from '@werf/core';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OBJECT_STORAGE, type ObjectStorage } from '../attachments/object-storage';
import {
  LivestockService,
  type CapturedAnimal,
  type CapturedBrandingRegister,
  type CapturedEvent,
  type CapturedIdentifier,
  type CapturedMob,
  type CapturedTheftIncident,
} from './livestock.service';
import { renderEvidencePackPdf } from './evidence-pack.pdf';

/** The farm whose register is being read. RLS decides whether the caller may see it. */
const residueRegisterQuerySchema = z.object({ farmId: schemas.uuidSchema });

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('livestock')
export class LivestockController {
  constructor(
    @Inject(LivestockService) private readonly livestock: LivestockService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Create a registered identification mark offline-first (FR-601), idempotent on its UUIDv7. */
  @Post('branding-registers')
  @HttpCode(HttpStatus.CREATED)
  async createBrandingRegister(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newBrandingRegisterSchema))
    body: schemas.NewBrandingRegister,
  ): Promise<CapturedBrandingRegister> {
    return this.livestock.createBrandingRegister(auth.userId, body);
  }

  /**
   * Create an animal (FR-101). The FK root of the capture graph, so the client flush sends
   * animals before any event that references one. The body carries the client's own UUIDv7 and
   * the fields captured offline; the author is taken from the session, never the body. Idempotent
   * on the id — a re-flushed animal returns the stored row rather than a duplicate.
   */
  @Post('animals')
  @HttpCode(HttpStatus.CREATED)
  async recordAnimal(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordAnimalRequestSchema))
    body: schemas.RecordAnimalRequest,
  ): Promise<CapturedAnimal> {
    return this.livestock.recordAnimal(auth.userId, body);
  }

  /**
   * Create a mob / flock (FR-102) — the group-only model, managed by head count with no individual
   * animal rows behind it. Sent after land units by the flush (a mob can carry `land_unit_id`) and
   * before animals (an animal can carry `mob_id`). Idempotent on the id.
   */
  @Post('mobs')
  @HttpCode(HttpStatus.CREATED)
  async recordMob(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newMobSchema))
    body: schemas.NewMob,
  ): Promise<CapturedMob> {
    return this.livestock.recordMob(auth.userId, body);
  }

  /**
   * Change a mob's head count and say why (FR-102) — births, deaths, sales, theft, home slaughter,
   * or a recount. Sent after its mob by the flush. The body carries a POSITIVE `count`: the sign
   * comes from the reason, server-side, so no client can post a birth that removes head.
   *
   * Idempotent on the id, and it has to be: this capture changes the count its own validation
   * reads, so a re-flush that re-applied the delta would take the same animals off twice.
   */
  @Post('mob-tallies')
  @HttpCode(HttpStatus.CREATED)
  async recordMobTally(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordMobTallyRequestSchema))
    body: schemas.RecordMobTallyRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordMobTally(auth.userId, body);
  }

  /**
   * Attach an identifier to an animal (FR-109) — the tag number a farmer actually calls it by.
   * Sent after its animal by the flush (it references `animals(id)`). Idempotent on the id; a
   * number currently live on a DIFFERENT animal is a refusal, not a silent move.
   */
  @Post('identifiers')
  @HttpCode(HttpStatus.CREATED)
  async recordIdentifier(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newAnimalIdentifierSchema))
    body: schemas.NewAnimalIdentifier,
  ): Promise<CapturedIdentifier> {
    return this.livestock.recordIdentifier(auth.userId, body);
  }

  /**
   * Record a weight (FR-140). The body carries the client's own event id and the farm-local
   * `occurredAt`; the author is taken from the session, never the body. 201 with the persisted
   * event so the client can reconcile its optimistic local row.
   */
  @Post('weights')
  @HttpCode(HttpStatus.CREATED)
  async recordWeight(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordWeightRequestSchema))
    body: schemas.RecordWeightRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordWeight(auth.userId, body);
  }

  /**
   * Record a move (FR-103) — an animal walked to another camp and/or mob. Only the DESTINATION is
   * sent; the server reads where the animal is from its own row. Idempotent on the id.
   */
  @Post('moves')
  @HttpCode(HttpStatus.CREATED)
  async recordMove(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordMoveRequestSchema))
    body: schemas.RecordMoveRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordMove(auth.userId, body, auth.sessionId);
  }

  /**
   * Record a mob-level move (FR-151) — the whole group walks to another camp. Only the destination
   * is sent; the server reads where the mob is from its own row. Sent after its mob by the flush.
   * Idempotent on the id.
   */
  @Post('mob-moves')
  @HttpCode(HttpStatus.CREATED)
  async recordMobMove(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordMobMoveRequestSchema))
    body: schemas.RecordMobMoveRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordMobMove(auth.userId, body, auth.sessionId);
  }

  /**
   * Record a feed-out (Phase 4e, FR-153) — how much of a tracked feed lot went to a mob or a
   * camp. When a mob is named, its camp and enterprise are read from the mob's own row, never
   * trusted from the body. Idempotent on the id.
   */
  @Post('feed')
  @HttpCode(HttpStatus.CREATED)
  async recordFeed(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordFeedRequestSchema))
    body: schemas.RecordFeedRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordFeed(auth.userId, body, auth.sessionId);
  }

  /**
   * Record a birth (FR-104) against the DAM. The calf's `animals` row is created through the
   * ordinary create-animal path and sent first; this event carries the calving facts.
   */
  @Post('births')
  @HttpCode(HttpStatus.CREATED)
  async recordBirth(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordBirthRequestSchema))
    body: schemas.RecordBirthRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordBirth(auth.userId, body, auth.sessionId);
  }

  /** Record a weaning (FR-111): the weight at weaning and, if known, the age. No status change. */
  @Post('weanings')
  @HttpCode(HttpStatus.CREATED)
  async recordWeaning(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordWeaningRequestSchema))
    body: schemas.RecordWeaningRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordWeaning(auth.userId, body);
  }

  /**
   * Record a mating / service (FR-120), against the DAM. Natural service or AI; the sire is an
   * animal on this farm or an external code; a running bull is a bull-in/bull-out WINDOW rather
   * than a day, because that is what an extensive herd actually knows.
   */
  @Post('matings')
  @HttpCode(HttpStatus.CREATED)
  async recordMating(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordMatingRequestSchema))
    body: schemas.RecordMatingRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordMating(auth.userId, body);
  }

  /**
   * Record a pregnancy diagnosis (FR-121), against the DAM. The due date is projected HERE from
   * the species gestation reference table and is not accepted from the body — the client previews
   * one from its cached copy, the server stores the one it can vouch for.
   */
  @Post('pregnancy-tests')
  @HttpCode(HttpStatus.CREATED)
  async recordPregnancyTest(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordPregnancyTestRequestSchema))
    body: schemas.RecordPregnancyTestRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordPregnancyTest(auth.userId, body);
  }

  /**
   * Record a purchase (FR-106) — an acquisition against an animal already in the herd. Unlike a
   * sale it changes no status: the animal arrived alive and stays alive.
   */
  @Post('purchases')
  @HttpCode(HttpStatus.CREATED)
  async recordPurchase(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordPurchaseRequestSchema))
    body: schemas.RecordPurchaseRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordPurchase(auth.userId, body);
  }

  /**
   * Mark an animal missing (FR-605) — COMPLIANCE-GATED. Status → 'missing', timestamped by when it
   * was LAST SEEN and anchored to where. The location is required by the contract: it is the field
   * the stock-theft evidence pack is built around.
   */
  @Post('missing')
  @HttpCode(HttpStatus.CREATED)
  async recordMissing(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordMissingRequestSchema))
    body: schemas.RecordMissingRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordMissing(auth.userId, body);
  }

  /**
   * Record a death (FR-105) → the animal's status becomes 'dead'. An append-only event; the
   * animal it references must already exist (the flush sends animals first). Idempotent on the id.
   */
  @Post('deaths')
  @HttpCode(HttpStatus.CREATED)
  async recordDeath(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordDeathRequestSchema))
    body: schemas.RecordDeathRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordDeath(auth.userId, body, auth.sessionId);
  }

  /**
   * Record a sale (FR-106) → the animal's status becomes 'sold'. An append-only event carrying
   * Money as integer cents; the animal must already exist. Idempotent on the id.
   */
  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  async recordSale(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordSaleRequestSchema))
    body: schemas.RecordSaleRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordSale(auth.userId, body, auth.sessionId);
  }

  /** Record a farmer-entered treatment snapshot and its calculated reminder dates. */
  @Post('treatments')
  @HttpCode(HttpStatus.CREATED)
  async recordTreatment(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordTreatmentRequestSchema))
    body: schemas.RecordTreatmentRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordTreatment(auth.userId, body);
  }

  /** Record a vaccination (FR-132) against a programme. Same withdrawal discipline as a treatment. */
  @Post('vaccinations')
  @HttpCode(HttpStatus.CREATED)
  async recordVaccination(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordVaccinationRequestSchema))
    body: schemas.RecordVaccinationRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordVaccination(auth.userId, body);
  }

  /** Record a farmer-entered dip / tick treatment (FR-133). */
  @Post('dips')
  @HttpCode(HttpStatus.CREATED)
  async recordDip(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.recordDipRequestSchema))
    body: schemas.RecordDipRequest,
  ): Promise<CapturedEvent> {
    return this.livestock.recordDip(auth.userId, body);
  }

  /**
   * Create a stock-theft incident (FR-603/605) — the field record the evidence pack is built from.
   * Facts only; there is no suspect field. Idempotent on the id.
   */
  @Post('theft-incidents')
  @HttpCode(HttpStatus.CREATED)
  async createTheftIncident(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(schemas.newTheftIncidentSchema))
    body: schemas.NewTheftIncident,
  ): Promise<CapturedTheftIncident> {
    return this.livestock.createTheftIncident(auth.userId, body);
  }

  /** Read the farm's private, advisory interval-reminder history across synced devices. */
  @Get('residue-register')
  async residueRegister(
    @CurrentUser() auth: AuthContext,
    @Query(new ZodValidationPipe(residueRegisterQuerySchema))
    query: z.infer<typeof residueRegisterQuerySchema>,
  ): Promise<schemas.ResidueFlag[]> {
    return this.livestock.residueRegister(auth.userId, query.farmId);
  }

  /**
   * The one action: generate the stock-theft evidence pack (FR-603) for an incident as a single
   * PDF — identification, ownership chain, brand certificate, last-seen GPS + timestamp — the
   * document a farmer hands the SAPS Stock Theft Unit. An incident the caller cannot see is a 404.
   */
  @Post('theft-incidents/:id/evidence-pack')
  @HttpCode(HttpStatus.OK)
  async generateEvidencePack(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) incidentId: string,
  ): Promise<StreamableFile> {
    const pack = await this.livestock.buildEvidencePack(auth.userId, incidentId);
    const photosByAnimal = await this.buildPhotoMap(pack);
    const pdf = await renderEvidencePackPdf(pack, photosByAnimal);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'attachment; filename="evidence-pack.pdf"',
    });
  }

  /**
   * Fetches and checksum-verifies each linked animal's finalised photo (P2.5), server-side, so
   * `renderEvidencePackPdf` never has to trust a byte it did not itself verify. `pack.farmId` is
   * already the authorised farm — `buildEvidencePack` only reaches this point via `assertCanCapture`
   * — and every `photoObjectKey` on the pack was itself read from `attachments` scoped to that same
   * farm (`LivestockService.buildEvidencePack`), so no further tenancy check is needed here: the
   * key was never reachable unless it was already this farm's.
   *
   * An animal is simply ABSENT from the returned map — never present with wrong bytes — when the
   * object is missing or its stored checksum no longer matches what the pack recorded at capture.
   * `renderEvidencePackPdf` treats an absent entry as "print the reference, not the image."
   */
  private async buildPhotoMap(pack: schemas.EvidencePack): Promise<Map<string, Buffer>> {
    const photosByAnimal = new Map<string, Buffer>();
    await Promise.all(
      pack.animals.map(async (animal) => {
        if (animal.photoObjectKey === null) return;
        const object = await this.storage.getObject(animal.photoObjectKey);
        if (object !== null && object.checksumSha256Hex === animal.photoChecksumSha256Hex) {
          photosByAnimal.set(animal.animalId, object.bytes);
        }
      }),
    );
    return photosByAnimal;
  }
}

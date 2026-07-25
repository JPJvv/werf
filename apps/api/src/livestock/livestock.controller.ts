import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { schemas } from '@werf/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthContext } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  LivestockService,
  type CapturedAnimal,
  type CapturedEvent,
  type CapturedIdentifier,
  type CapturedMob,
  type CapturedTheftIncident,
} from './livestock.service';
import { renderEvidencePackPdf } from './evidence-pack.pdf';

// No @UseGuards: AuthGuard is registered globally, so every route here is guarded by default.
@Controller('livestock')
export class LivestockController {
  constructor(@Inject(LivestockService) private readonly livestock: LivestockService) {}

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
    return this.livestock.recordMove(auth.userId, body);
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
    return this.livestock.recordDeath(auth.userId, body);
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
    return this.livestock.recordSale(auth.userId, body);
  }

  /**
   * Record a treatment (FR-130/131) — COMPLIANCE-GATED. The body carries a `productId`, not a
   * withdrawal period: the server resolves the registered meat/milk withdrawal from reference data
   * and stores the clear dates on the event at capture. Idempotent on the id.
   */
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

  /** Record a dip / tick treatment (FR-133), required in controlled areas (Animal Diseases Act). */
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
    const pdf = await renderEvidencePackPdf(pack);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'attachment; filename="evidence-pack.pdf"',
    });
  }
}

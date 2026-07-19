import { Controller, Get } from '@nestjs/common';
import { getHealth, type HealthStatus } from './health';
import { Public } from '../auth/auth.guard';

@Controller('health')
export class HealthController {
  /** A load balancer has no session. Health must answer before anyone can log in. */
  @Public()
  @Get()
  check(): HealthStatus {
    return getHealth();
  }
}

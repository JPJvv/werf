import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { getHealth, type HealthStatus } from './health';
import { Public } from '../auth/auth.guard';

@Controller('health')
export class HealthController {
  /** A load balancer has no session. Health must answer before anyone can log in. */
  @Public()
  @SkipThrottle()
  @Get()
  check(): HealthStatus {
    return getHealth();
  }
}

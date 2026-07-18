import { Controller, Get } from '@nestjs/common';
import { getHealth, type HealthStatus } from './health';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthStatus {
    return getHealth();
  }
}

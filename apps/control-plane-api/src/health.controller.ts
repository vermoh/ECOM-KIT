import { Controller, Get } from '@nestjs/common';
import { Permissions } from './auth/permissions.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Permissions('*') // Allow all authenticated users (or anyone if no JwtAuthGuard on top)
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}

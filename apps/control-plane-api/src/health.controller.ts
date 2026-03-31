import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/jwt-auth.guard';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() {
    return { status: 'ok', service: 'control-plane-api' };
  }
}

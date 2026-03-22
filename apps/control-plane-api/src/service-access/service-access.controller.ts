import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ServiceAccessService } from './service-access.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { Permissions } from '../auth/permissions.decorator';

@Controller('services')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ServiceAccessController {
  constructor(private readonly serviceAccessService: ServiceAccessService) {}

  @Get()
  @Permissions('service:read')
  findAll() {
    return this.serviceAccessService.findAllServices();
  }

  @Post(':serviceId/grant')
  @Permissions('service:grant_access')
  grantAccess(@Param('serviceId') serviceId: string, @Body('orgId') orgId: string, @Request() req) {
    return this.serviceAccessService.grantAccess(orgId, serviceId, req.user.userId);
  }

  @Post(':serviceId/token')
  @Permissions('service:read') // Any user with service:read can request a short-lived token for their org
  createToken(@Param('serviceId') serviceId: string, @Body('scopes') scopes: string[], @Request() req) {
    return this.serviceAccessService.createAccessGrant(req.user.orgId, serviceId, scopes);
  }
}

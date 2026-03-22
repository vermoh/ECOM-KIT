import { Module } from '@nestjs/common';
import { ServiceAccessController } from './service-access.controller';
import { ServiceAccessService } from './service-access.service';

@Module({
  controllers: [ServiceAccessController],
  providers: [ServiceAccessService],
  exports: [ServiceAccessService],
})
export class ServiceAccessModule {}

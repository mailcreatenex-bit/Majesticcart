import { Global, Module } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/** Global so SMS, email, the order relay and the courier code can all read the admin-entered settings. */
@Global()
@Module({ providers: [IntegrationsService], exports: [IntegrationsService] })
export class IntegrationsModule {}

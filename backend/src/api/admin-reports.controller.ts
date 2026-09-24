import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/guards';
import { AdminReportsService } from '../reporting/admin-reports.service';

/** The four operating reports on the admin Reports page. */
@RequirePermission('reports.view')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get()
  list() {
    return this.reports.list();
  }

  @Get(':key')
  run(@Param('key') key: string, @Query('days') days?: string) {
    return this.reports.run(key, { days: days ? Number(days) : undefined });
  }
}

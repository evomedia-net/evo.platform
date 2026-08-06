// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, SetAppAccessDto, UpdateTenantDto } from './dto';

@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class TenantsController {
  constructor(private tenants: TenantsService) {}

  @Get()
  list(@Query('includeDeleted') includeDeleted?: string) {
    return this.tenants.list(includeDeleted === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenants.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenants.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tenants.remove(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.tenants.restore(id);
  }

  @Post(':id/suspend')
  suspend(@Param('id') id: string) {
    return this.tenants.suspend(id);
  }

  @Post(':id/activate')
  activate(@Param('id') id: string) {
    return this.tenants.activate(id);
  }

  @Get(':id/apps')
  listApps(@Param('id') id: string) {
    return this.tenants.listApps(id);
  }

  @Put(':id/apps/:appId')
  setAppAccess(
    @Param('id') id: string,
    @Param('appId') appId: string,
    @Body() dto: SetAppAccessDto,
  ) {
    return this.tenants.setAppAccess(id, appId, dto);
  }

  @Delete(':id/apps/:appId')
  removeAppAccess(@Param('id') id: string, @Param('appId') appId: string) {
    return this.tenants.removeAppAccess(id, appId);
  }

  @Get(':id/export')
  exportTenant(@Param('id') id: string) {
    return this.tenants.exportTenant(id);
  }

  @Delete(':id/purge')
  purge(@Param('id') id: string) {
    return this.tenants.purge(id);
  }
}

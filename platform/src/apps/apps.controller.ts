// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { App } from '@prisma/client';
import { ClientGuard } from '../auth/client.guard';
import { AppsService } from './apps.service';
import { BrandService } from './brand.service';
import { AddPriceDto, CreateAppDto, CreateRoleDto, UpdateAppDto, UpdateRoleDto } from './dto';

@Controller('admin/apps')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AppsController {
  constructor(
    private apps: AppsService,
    private brand: BrandService,
  ) {}

  @Get()
  list(@Query('includeDeleted') includeDeleted?: string) {
    return this.apps.list(includeDeleted === 'true');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.apps.get(id);
  }

  @Post()
  create(@Body() dto: CreateAppDto) {
    return this.apps.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.apps.update(id, dto);
  }

  /** Soft delete — reversible, nothing destroyed. */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.apps.remove(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.apps.restore(id);
  }

  /** Erasure. Refuses unless the app is already soft-deleted. */
  @Delete(':id/purge')
  purge(@Param('id') id: string) {
    return this.apps.purge(id);
  }

  @Post(':id/rotate-secret')
  rotateSecret(@Param('id') id: string) {
    return this.apps.rotateSecret(id);
  }

  @Get(':id/tenants')
  listTenants(@Param('id') id: string) {
    return this.apps.listTenants(id);
  }

  @Get(':id/prices')
  listPrices(@Param('id') id: string) {
    return this.apps.listPrices(id);
  }

  @Post(':id/prices')
  addPrice(@Param('id') id: string, @Body() dto: AddPriceDto) {
    return this.apps.addPrice(id, dto);
  }

  @Delete(':id/prices/:priceId')
  removePrice(@Param('id') id: string, @Param('priceId') priceId: string) {
    return this.apps.removePrice(id, priceId);
  }

  @Get(':id/roles')
  listRoles(@Param('id') id: string) {
    return this.apps.listRoles(id);
  }

  @Post(':id/roles')
  addRole(@Param('id') id: string, @Body() dto: CreateRoleDto) {
    return this.apps.addRole(id, dto);
  }

  @Patch(':id/roles/:roleId')
  updateRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.apps.updateRole(id, roleId, dto);
  }

  @Delete(':id/roles/:roleId')
  removeRole(@Param('id') id: string, @Param('roleId') roleId: string) {
    return this.apps.removeRole(id, roleId);
  }

  @Get(':id/brand')
  getBrand(@Param('id') id: string) {
    return this.brand.get(id);
  }

  /** Body is the record itself; `null` clears it. */
  @Patch(':id/brand')
  setBrand(
    @Param('id') id: string,
    @Body() body: { brand?: unknown },
    @Req() req: { user?: { sub?: string } },
  ) {
    return this.brand.set(id, body?.brand ?? null, req.user?.sub);
  }
}


/**
 * What a running app reads. Authenticated by client credentials, so an app
 * gets its own brand and nobody else's — the record names support addresses
 * and a legal entity, which is not something to serve to any caller who knows
 * a client id.
 */
@Controller('brand')
export class BrandController {
  constructor(private brand: BrandService) {}

  @Get()
  @UseGuards(ClientGuard)
  mine(@Req() req: { clientApp: App }) {
    return this.brand.forClient(req.clientApp.clientId);
  }
}

import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import { readFileSync } from 'fs';
import { basename, join } from 'path';

interface SendsFile {
  sendFile(path: string): void;
}

const FONTS = new Set(['outfit.woff2', 'dm-sans.woff2']);

/**
 * Serves the static admin console (no build step, no framework — three files
 * that talk to the existing /admin REST API with the admin's own JWT).
 * All authorization happens in the API guards; this controller only ships
 * static assets.
 */
@Controller()
export class AdminUiController {
  private file(res: SendsFile, name: string) {
    res.sendFile(join(__dirname, 'static', name));
  }

  @Get()
  index(@Res() res: SendsFile) {
    this.file(res, 'index.html');
  }

  @Get('admin-ui.js')
  js(@Res() res: SendsFile) {
    this.file(res, 'admin-ui.js');
  }

  @Get('admin-ui.css')
  css(@Res() res: SendsFile) {
    this.file(res, 'admin-ui.css');
  }

  /** Self-hosted brand fonts. Allow-listed by name (basename strips any path
   *  traversal); returned as a Buffer with immutable long-cache headers. */
  @Get('fonts/:file')
  @Header('Content-Type', 'font/woff2')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  font(@Param('file') file: string): Buffer {
    const name = basename(file);
    if (!FONTS.has(name)) throw new NotFoundException();
    return readFileSync(join(__dirname, 'static', 'fonts', name));
  }
}

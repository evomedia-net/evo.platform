import { Controller, Get, Param, Res } from '@nestjs/common';
import { readFileSync } from 'fs';
import { basename, join } from 'path';

interface SendsFile {
  sendFile(path: string): void;
}

interface FontRes {
  set(field: string, value: string): void;
  status(code: number): { end(): void };
  send(body: Buffer): void;
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
   *  traversal). Sent via res.send so the raw bytes aren't JSON-serialized. */
  @Get('fonts/:file')
  font(@Param('file') file: string, @Res() res: FontRes) {
    const name = basename(file);
    if (!FONTS.has(name)) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', 'font/woff2');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(readFileSync(join(__dirname, 'static', 'fonts', name)));
  }
}

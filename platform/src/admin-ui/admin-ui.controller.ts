import { Controller, Get } from '@nestjs/common';
import { Res } from '@nestjs/common';
import { join } from 'path';

interface SendsFile {
  sendFile(path: string): void;
}

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
}

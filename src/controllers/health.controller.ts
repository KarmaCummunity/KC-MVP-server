import { Controller, Get } from '@nestjs/common';

@Controller('/')
export class HealthController {
  @Get()
  getRoot() {
    return {
      status: 'OK',
      message: 'Karma Community Nest Server is running!',
      timestamp: new Date().toISOString(),
    };
  }
}



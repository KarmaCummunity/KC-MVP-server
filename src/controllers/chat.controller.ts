import { Body, Controller, Post } from '@nestjs/common';

@Controller('api')
export class ChatController {
  @Post('chat')
  async chat(@Body('message') message?: string) {
    if (!message) {
      return { error: 'Missing message' };
    }
    return { reply: `AI says: You sent "${message}"` };
  }
}



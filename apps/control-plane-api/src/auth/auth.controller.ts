import { Controller, Post, Body, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: { email: string; pass: string; orgId: string }) {
    const user = await this.authService.validateUser(body.email, body.pass);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Note: In a real app, orgId should be validated or selected from user memberships if not provided
    return this.authService.login(user, body.orgId);
  }
}

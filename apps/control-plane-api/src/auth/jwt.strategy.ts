import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: (configService && configService.get<string>('JWT_SECRET')) || 'secret',
    });
  }

  async validate(payload: any) {
    // Check temporal access if valid_until is present in token
    if (payload.valid_until && new Date(payload.valid_until) <= new Date()) {
      throw new UnauthorizedException('Access expired');
    }
    
    return { 
      userId: payload.sub, 
      orgId: payload.org_id, 
      role: payload.role, 
      permissions: payload.permissions 
    };
  }
}

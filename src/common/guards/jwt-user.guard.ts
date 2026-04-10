import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtUserGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-token'] || '';

    if (!token) {
      throw new UnauthorizedException('Missing x-token header');
    }

    const secret = this.configService.get<string>('jwtSecret');

    try {
      const payload = jwt.verify(token, secret) as any;
      request.user = {
        userId: payload._id || payload.id,
        email: payload.email,
        roles: payload.flag || [],
        name: payload.name,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired x-token');
    }
  }
}

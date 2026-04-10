import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.headers['x-api-key'] || '';
    const required = this.configService.get<string>('cdnApiKey');

    if (!required || key !== required) {
      throw new UnauthorizedException('Invalid or missing x-api-key');
    }

    return true;
  }
}

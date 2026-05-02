import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { MediaModule } from './media/media.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongo.uri'),
      }),
      inject: [ConfigService],
    }),
    MediaModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}

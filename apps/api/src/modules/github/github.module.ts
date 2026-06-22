import { Module } from '@nestjs/common'
import { GithubController } from './github.controller'
import { GithubService } from './github.service'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [NotificationsModule],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}

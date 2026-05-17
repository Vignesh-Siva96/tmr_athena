import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from './modules/database/database.module'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { AppConfigModule } from './modules/config/config.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { MessagesModule } from './modules/messages/messages.module'
import { AgentsModule } from './modules/agents/agents.module'
import { UsersModule } from './modules/users/users.module'
import { FilesModule } from './modules/files/files.module'
import { EmailModule } from './modules/email/email.module'
import { GithubModule } from './modules/github/github.module'
import { QueueModule } from './modules/queue/queue.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    AppConfigModule,
    TicketsModule,
    MessagesModule,
    AgentsModule,
    UsersModule,
    FilesModule,
    EmailModule,
    GithubModule,
    QueueModule,
    NotificationsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}

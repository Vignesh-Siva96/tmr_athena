import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DatabaseModule } from './modules/database/database.module'
import { QueueModule } from './modules/queue/queue.module'
import { HealthModule } from './modules/health/health.module'
import { AuthModule } from './modules/auth/auth.module'
import { AppConfigModule } from './modules/config/config.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { MessagesModule } from './modules/messages/messages.module'
import { AgentsModule } from './modules/agents/agents.module'
import { UsersModule } from './modules/users/users.module'
import { FilesModule } from './modules/files/files.module'
import { EmailModule } from './modules/email/email.module'
import { EmailOAuthModule } from './modules/email-oauth/email-oauth.module'
import { GithubModule } from './modules/github/github.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { AppEventsModule } from './common/events/app-events.module'
import { AiModule } from './modules/ai/ai.module'
import { EmailSyncModule } from './modules/email-sync/email-sync.module'
import { EventsModule } from './modules/events/events.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    AppEventsModule,
    DatabaseModule,
    QueueModule,
    HealthModule,
    AuthModule,
    AppConfigModule,
    TicketsModule,
    MessagesModule,
    AgentsModule,
    UsersModule,
    FilesModule,
    EmailModule,
    EmailOAuthModule,
    GithubModule,
    NotificationsModule,
    AnalyticsModule,
    AiModule,
    EmailSyncModule,
    EventsModule,
  ],
})
export class AppModule {}

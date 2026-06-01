import { Module } from '@nestjs/common'
import { DatabaseModule } from '../database/database.module'
import { KnowledgeBaseController } from './knowledge-base.controller'
import { CrawlerService } from './crawler.service'
import { ChunkerService } from './chunker.service'
import { ContextBuilderService } from './context-builder.service'
import { EmbeddingService } from './embedding.service'
import { IndexerService } from './indexer.service'
import { CrawlAndIndexWorker } from './workers/crawl-and-index.worker'

@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeBaseController],
  providers: [
    CrawlerService,
    ChunkerService,
    ContextBuilderService,
    EmbeddingService,
    IndexerService,
    CrawlAndIndexWorker,
  ],
  exports: [IndexerService, EmbeddingService],
})
export class KnowledgeBaseModule {}

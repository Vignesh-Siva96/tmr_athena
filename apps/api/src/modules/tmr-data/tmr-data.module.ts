import { Module } from '@nestjs/common'
import { TmrDataService } from './tmr-data.service'
import { FetchTmrMetadataWorker } from './fetch-tmr-metadata.worker'

@Module({
  providers: [TmrDataService, FetchTmrMetadataWorker],
  exports: [TmrDataService],
})
export class TmrDataModule {}

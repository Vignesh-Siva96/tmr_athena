import { Injectable } from '@nestjs/common'
import { Subject, Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { SseEvent } from './event.types'

export interface SseMessageEvent {
  data: string
}

@Injectable()
export class SseService {
  private readonly subject = new Subject<SseEvent>()

  asObservable(): Observable<SseMessageEvent> {
    return this.subject.pipe(
      map(e => ({ data: JSON.stringify(e) }))
    )
  }

  broadcast(event: SseEvent): void {
    this.subject.next(event)
  }
}

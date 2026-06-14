import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

// Metadata key set by Nest's @Sse() decorator (SSE_METADATA in @nestjs/common/constants)
const SSE_METADATA = '__sse__'

@Injectable()
export class TransformResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    // @Sse handlers stream one emission per SSE frame. Wrapping each frame in
    // { data } mangles the wire format (`data: {"data":"{\"type\":…}"}`), so the
    // client parses an envelope with no `type` and silently drops every event.
    if (Reflect.getMetadata(SSE_METADATA, ctx.getHandler())) {
      return next.handle()
    }
    return next.handle().pipe(
      map((data: unknown) => {
        if (data === null || data === undefined) return { data: null }
        return { data }
      }),
    )
  }
}

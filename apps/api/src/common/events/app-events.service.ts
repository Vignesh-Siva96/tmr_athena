import { Injectable } from '@nestjs/common'
import { EventEmitter } from 'events'

export const APP_EVENTS = {
  EMAIL_CONFIG_UPDATED: 'email-config-updated',
} as const

@Injectable()
export class AppEventsService extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(20)
  }

  emitEmailConfigUpdated(): void {
    this.emit(APP_EVENTS.EMAIL_CONFIG_UPDATED)
  }

  onEmailConfigUpdated(listener: () => void): void {
    this.on(APP_EVENTS.EMAIL_CONFIG_UPDATED, listener)
  }

  offEmailConfigUpdated(listener: () => void): void {
    this.off(APP_EVENTS.EMAIL_CONFIG_UPDATED, listener)
  }
}

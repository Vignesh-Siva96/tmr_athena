import { teardown } from './global-setup'

// Jest globalTeardown signature: default-exported async function.
export default async function jestGlobalTeardown(): Promise<void> {
  await teardown()
}

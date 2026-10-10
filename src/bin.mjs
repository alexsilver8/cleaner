// The entry point that `pnpm build` bundles into dist/cleaner.cjs.
import { main } from './main.mjs'

process.exitCode = main()

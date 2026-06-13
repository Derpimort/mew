import { expect, test } from 'bun:test'
import { createSqliteStorage } from '../src/storage/sqlite'
import { storageContract } from '../src/storage/contract'

/* Run the shared StoragePort contract against the SQLite vehicle. The same
   suite will later run against Dexie under vitest — one spec, both impls. */
storageContract(() => createSqliteStorage(':memory:'), { test, expect })

import { KEEP_ALL_ORACLE_CASES } from '../src/test-data.ts'
import { runOracleSuite } from './oracle-check.ts'

await runOracleSuite({ batch: 'keep-all', cases: KEEP_ALL_ORACLE_CASES, compareBreaks: true })

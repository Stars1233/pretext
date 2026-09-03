import { PRE_WRAP_ORACLE_CASES } from '../src/test-data.ts'
import { runOracleSuite } from './oracle-check.ts'

await runOracleSuite({ batch: 'pre-wrap', cases: PRE_WRAP_ORACLE_CASES, compareBreaks: false })

import { SYMBOL_ORACLE_CASES } from '../src/test-data.ts'
import { runOracleSuite } from './oracle-check.ts'

await runOracleSuite({ batch: 'symbol-runs', cases: SYMBOL_ORACLE_CASES, compareBreaks: true })

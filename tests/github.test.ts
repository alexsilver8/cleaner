import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { annotations, errorCommand, summary, writeOutputs } from '../src/github.mjs'

const PROBLEM = {
	path: 'src/web/components/card/card.tsx',
	line: 3,
	column: 1,
	rule: 'no-types-in-components',
	message: 'interface Hover'
}

describe('annotations', () => {
	it('puts each problem on its line with the rule as the title', () => {
		expect(annotations([PROBLEM])).toEqual([
			"::error file=src/web/components/card/card.tsx,line=3,col=1,title=no-types-in-components::interface Hover: Component files can't declare interfaces or types. Move them to <name>.types.ts, next to the component."
		])
	})

	it('escapes characters workflow commands treat as syntax', () => {
		const [line] = annotations([{ ...PROBLEM, path: 'a,b/c:d.tsx', message: '100%\nsure' }])

		expect(line).toMatch(/^::error file=a%2Cb\/c%3Ad\.tsx,line=3/)
		expect(line).toContain('::100%25%0Asure: ')
	})

	it('reports errors without a file', () => {
		expect(errorCommand("src/wbe doesn't exist.")).toBe(
			"::error title=cleaner::src/wbe doesn't exist."
		)
	})
})

describe('summary', () => {
	it('lists problems in a table and explains each rule once', () => {
		expect(summary([PROBLEM, { ...PROBLEM, line: 9, message: 'type Size' }], 12)).toBe(
			[
				'### Cleaner',
				'',
				'✖ **2 problems in 1 file** (12 files checked)',
				'',
				'| File | Line | Problem | Rule |',
				'| --- | --- | --- | --- |',
				'| `src/web/components/card/card.tsx` | 3:1 | interface Hover | `no-types-in-components` |',
				'| `src/web/components/card/card.tsx` | 9:1 | type Size | `no-types-in-components` |',
				'',
				"**`no-types-in-components`**: Component files can't declare interfaces or types. Move them to &lt;name&gt;.types.ts, next to the component.",
				''
			].join('\n')
		)
	})

	it('is one line when there are no problems', () => {
		expect(summary([], 12)).toBe('### Cleaner\n\n✔ No problems in 12 files.\n')
	})
})

describe('writeOutputs', () => {
	const tmp = mkdtempSync(join(tmpdir(), 'cleaner-'))
	afterAll(() => rmSync(tmp, { recursive: true, force: true }))

	it('appends to the summary and output files', () => {
		const env = {
			GITHUB_STEP_SUMMARY: join(tmp, 'summary.md'),
			GITHUB_OUTPUT: join(tmp, 'output')
		}
		writeFileSync(env.GITHUB_OUTPUT, 'earlier=1\n')

		writeOutputs([PROBLEM], 5, env)

		expect(readFileSync(env.GITHUB_OUTPUT, 'utf8')).toBe('earlier=1\nproblems=1\n')
		expect(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('1 problem in 1 file')
	})

	it('does nothing outside GitHub Actions', () => {
		expect(() => writeOutputs([PROBLEM], 5, {})).not.toThrow()
	})
})

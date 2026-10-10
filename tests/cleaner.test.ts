import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createColors } from 'picocolors'
import { afterAll, describe, expect, it } from 'vitest'
import { collectFiles, formatReport, parsePaths } from '../src/cleaner.mjs'

const CLEAN = 'tests/fixtures/clean'
const DIRTY = 'tests/fixtures/dirty'

describe('parsePaths', () => {
	it('splits on spaces and new lines', () => {
		expect(parsePaths('src/web\n  src/app  src/shared\n')).toEqual([
			'src/web',
			'src/app',
			'src/shared'
		])
	})

	it('gives nothing for an empty input', () => {
		expect(parsePaths('  \n')).toEqual([])
	})
})

describe('collectFiles', () => {
	const tmp = mkdtempSync(join(tmpdir(), 'cleaner-'))
	afterAll(() => rmSync(tmp, { recursive: true, force: true }))

	it('searches folders and keeps files, with forward slashes', () => {
		expect(collectFiles([CLEAN, `${DIRTY}/components/menu/menu.tsx`]).sort()).toEqual([
			`${CLEAN}/components/card/card.tsx`,
			`${CLEAN}/components/card/card.types.ts`,
			`${DIRTY}/components/menu/menu.tsx`
		])
	})

	it('lists a file once when paths overlap', () => {
		expect(collectFiles([CLEAN, `${CLEAN}/components/card/card.tsx`])).toHaveLength(2)
	})

	it('skips node_modules and dot folders', () => {
		for (const dir of ['node_modules/pkg', '.cache', 'app'])
			mkdirSync(join(tmp, dir), { recursive: true })
		writeFileSync(join(tmp, 'node_modules/pkg/pkg.tsx'), '')
		writeFileSync(join(tmp, '.cache/cache.tsx'), '')
		writeFileSync(join(tmp, 'app/app.tsx'), '')

		expect(collectFiles([tmp]).map((path) => resolve(path))).toEqual([join(tmp, 'app/app.tsx')])
	})

	it('throws when a path does not exist', () => {
		expect(() => collectFiles([CLEAN, 'src/wbe'])).toThrow("src/wbe doesn't exist.")
	})
})

describe('formatReport', () => {
	const plain = createColors(false)

	it('groups problems by file and explains each rule once', () => {
		const problems = [
			{
				path: 'a/a.tsx',
				line: 3,
				column: 1,
				rule: 'no-types-in-components',
				message: 'interface Hover'
			},
			{
				path: 'a/a.tsx',
				line: 12,
				column: 2,
				rule: 'no-types-in-components',
				message: 'type Mode'
			},
			{
				path: 'b/b.tsx',
				line: 7,
				column: 1,
				rule: 'no-types-in-components',
				message: 'type Size'
			}
		]

		expect(formatReport(problems, 40, plain)).toBe(
			[
				'',
				'a/a.tsx',
				'  3:1   ✖  interface Hover  no-types-in-components',
				'  12:2  ✖  type Mode        no-types-in-components',
				'',
				'b/b.tsx',
				'  7:1  ✖  type Size  no-types-in-components',
				'',
				'no-types-in-components',
				"  Component files can't declare interfaces or types.",
				'  Move them to <name>.types.ts, next to the component.',
				'',
				'✖ 3 problems in 2 files (40 files checked)'
			].join('\n')
		)
	})

	it('says so when there are no problems', () => {
		expect(formatReport([], 1, plain)).toBe('✔ No problems in 1 file.')
	})
})

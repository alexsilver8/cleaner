// Runs the bundled action the way GitHub's runner does: `node dist/cleaner.cjs` in the checked-out
// repository, with the inputs and output files passed as environment variables. Run `pnpm build`
// first after changing src/.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const BUNDLE = resolve('dist/cleaner.cjs')
const tmp = mkdtempSync(join(tmpdir(), 'cleaner-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function runAction(paths: string | undefined, args: string[] = []) {
	const files = { summary: join(tmp, 'summary.md'), output: join(tmp, 'output') }
	writeFileSync(files.summary, '')
	writeFileSync(files.output, '')
	const env: NodeJS.ProcessEnv = {
		...process.env,
		NO_COLOR: '1',
		GITHUB_ACTIONS: 'true',
		GITHUB_STEP_SUMMARY: files.summary,
		GITHUB_OUTPUT: files.output,
		INPUT_PATHS: paths
	}
	if (paths === undefined) delete env.INPUT_PATHS
	const result = spawnSync(process.execPath, [BUNDLE, ...args], { encoding: 'utf8', env })

	return {
		status: result.status,
		stdout: result.stdout,
		summary: readFileSync(files.summary, 'utf8'),
		output: readFileSync(files.output, 'utf8')
	}
}

describe('the bundled action', () => {
	it('passes when there is nothing to fix', () => {
		const run = runAction('tests/fixtures/clean')

		expect(run.status).toBe(0)
		expect(run.stdout).toBe('✔ No problems in 2 files.\n')
		expect(run.output).toBe('problems=0\n')
		expect(run.summary).toContain('No problems in 2 files.')
	})

	it('fails, annotates each problem and fills in the summary', () => {
		const run = runAction('tests/fixtures/clean\ntests/fixtures/dirty')

		expect(run.status).toBe(1)
		expect(run.stdout).toContain('✖ 3 problems in 2 files (4 files checked)')
		expect(run.stdout.split('\n').filter((line) => line.startsWith('::error '))).toEqual([
			expect.stringMatching(
				/^::error file=tests\/fixtures\/dirty\/components\/card\/card\.tsx,line=3,col=1,title=no-types-in-components::interface CardProps: /
			),
			expect.stringMatching(/card\.tsx,line=7,col=1,.*::type Size: /),
			expect.stringMatching(/menu\/menu\.tsx,line=4,col=2,.*::type Entry: /)
		])
		expect(run.output).toBe('problems=3\n')
		expect(run.summary).toContain(
			'| `tests/fixtures/dirty/components/menu/menu.tsx` | 4:2 | type Entry |'
		)
	})

	it('fails on a path that does not exist', () => {
		const run = runAction('tests/fixtures/clean tests/fixtures/missing')

		expect(run.status).toBe(1)
		expect(run.stdout).toContain("::error title=cleaner::tests/fixtures/missing doesn't exist.")
	})

	it('checks src when no paths are given', () => {
		expect(runAction(undefined).stdout).toMatch(/No problems in \d+ files/)
	})

	it('takes paths as arguments when run as a command', () => {
		const run = runAction(undefined, ['tests/fixtures/dirty/components/menu'])

		expect(run.status).toBe(1)
		expect(run.stdout).toContain('✖ 1 problem in 1 file (1 file checked)')
	})
})

describe('action.yml', () => {
	const action = readFileSync('action.yml', 'utf8')

	it('runs the bundle on Node 24', () => {
		expect(action).toMatch(/^ {4}using: node24$/m)
		expect(action).toMatch(/^ {4}main: dist\/cleaner\.cjs$/m)
	})

	it('checks src by default, like the command', () => {
		expect(action).toMatch(/^ {8}default: src$/m)
	})
})

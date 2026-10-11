import { describe, expect, it } from 'vitest'
import { checkFile } from '../src/cleaner.mjs'
import { isComponentFile, isScriptFile } from '../src/rules.mjs'

const CARD = 'src/renderer/src/shelf/shelf-app/components/card/card.tsx'

describe('isComponentFile', () => {
	it.each([CARD, 'src/web/components/icon/icon.tsx'])('counts %s', (path) => {
		expect(isComponentFile(path)).toBe(true)
	})

	it.each([
		'src/renderer/src/shelf/shelf-app/components/card/card.types.ts',
		'src/renderer/src/shelf/shelf-app/components/card/card.utils.ts',
		'src/renderer/src/components/icon/icon.constants.tsx',
		'src/renderer/src/shelf/shelf-app/components/card/index.ts',
		'src/renderer/src/main.tsx',
		'src/renderer/src/lib/highlight.tsx'
	])('skips %s', (path) => {
		expect(isComponentFile(path)).toBe(false)
	})
})

describe('no-types-in-components', () => {
	it('flags interfaces and types anywhere in a component file', () => {
		const source = [
			"import type { CardProps } from './card.types'",
			'',
			'interface Hover {',
			'	x: number',
			'}',
			'',
			'const Card = (props: CardProps) => {',
			"	type Mode = 'a' | 'b'",
			'',
			'	return null',
			'}'
		].join('\n')

		expect(checkFile(CARD, source)).toEqual([
			expect.objectContaining({ line: 3, column: 1, rule: 'no-types-in-components' }),
			expect.objectContaining({ line: 8, column: 2, rule: 'no-types-in-components' })
		])
		expect(checkFile(CARD, source).map((p) => p.message)).toEqual([
			'interface Hover',
			'type Mode'
		])
	})

	it('allows type imports and inline type annotations', () => {
		const source = [
			"import { memo, useState, type MouseEvent } from 'react'",
			"import type { CardProps } from './card.types'",
			'',
			'const Card = (props: CardProps) => {',
			'	const [hover, setHover] = useState<{ x: number } | null>(null)',
			'	const onMove = (e: MouseEvent<HTMLDivElement>) => setHover({ x: e.clientX } as { x: number })',
			'',
			'	return <div onMouseMove={onMove}>{hover?.x}</div>',
			'}',
			'',
			'export default memo(Card)'
		].join('\n')

		expect(checkFile(CARD, source)).toEqual([])
	})

	it('leaves types files alone', () => {
		const source = 'export interface CardProps {\n\tselected: boolean\n}\n'

		expect(checkFile(CARD.replace('card.tsx', 'card.types.ts'), source)).toEqual([])
	})
})

describe('isScriptFile', () => {
	it.each([CARD, 'src/renderer/src/main.ts', 'src/web/lib/format.ts'])('counts %s', (path) => {
		expect(isScriptFile(path)).toBe(true)
	})

	it.each(['src/renderer/src/style.css', 'scripts/build.mjs', 'src/web/data.json'])(
		'skips %s',
		(path) => {
			expect(isScriptFile(path)).toBe(false)
		}
	)
})

describe('no-parent-imports', () => {
	it('flags imports and re-exports that start with ../', () => {
		const source = [
			"import { Button } from '../../components/button'",
			"import { helper } from '../utils'",
			"export { thing } from '../../thing'",
			"export * from '../all'",
			"import { parent } from '..'"
		].join('\n')

		expect(checkFile(CARD, source)).toEqual([
			expect.objectContaining({ line: 1, column: 24, rule: 'no-parent-imports' }),
			expect.objectContaining({ line: 2, column: 24, rule: 'no-parent-imports' }),
			expect.objectContaining({ line: 3, column: 23, rule: 'no-parent-imports' }),
			expect.objectContaining({ line: 4, column: 15, rule: 'no-parent-imports' }),
			expect.objectContaining({ line: 5, column: 24, rule: 'no-parent-imports' })
		])
		expect(checkFile(CARD, source).map((p) => p.message)).toEqual([
			'../../components/button',
			'../utils',
			'../../thing',
			'../all',
			'..'
		])
		expect(checkFile('src/renderer/src/main.ts', "import '../x'\n")).toHaveLength(1)
	})

	it('allows ./ imports, aliases and packages', () => {
		const source = [
			"import { Button } from '@renderer/components/button'",
			"import { BoardTab } from './components/board-tab'",
			"import { Settings } from '@shared/settings'",
			"import { icon } from '@resources/icon'",
			"import { memo } from 'react'",
			"import { utils } from './lib/../utils'"
		].join('\n')

		expect(checkFile(CARD, source)).toEqual([])
	})

	it('only checks .ts and .tsx files', () => {
		expect(checkFile('src/renderer/src/style.css', "@import '../theme.css';\n")).toEqual([])
		expect(checkFile('scripts/build.mjs', "import { x } from '../x'\n")).toEqual([])
	})
})

describe('checkFile', () => {
	it('lists problems in the order they appear, whichever rule found them', () => {
		const source = [
			"import { x } from '../x'",
			'interface Probe {}',
			"export * from '../y'"
		].join('\n')

		expect(checkFile(CARD, source).map((p) => [p.line, p.rule])).toEqual([
			[1, 'no-parent-imports'],
			[2, 'no-types-in-components'],
			[3, 'no-parent-imports']
		])
	})
})

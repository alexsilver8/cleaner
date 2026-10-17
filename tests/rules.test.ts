import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkFile, collectFiles } from '../src/cleaner.mjs'
import {
	componentName,
	countLines,
	isCodeFile,
	isComponentFile,
	MAX_COMPONENT_LINES
} from '../src/rules.mjs'

const CARD = 'src/renderer/src/shelf/shelf-app/components/card/card.tsx'

/** The problems one rule finds in a file. */
const check = (rule: string, path: string, source: string) =>
	checkFile(path, source).filter((p) => p.rule === rule)

/** The messages of the problems one rule finds in a file. */
const messages = (rule: string, path: string, source: string) =>
	check(rule, path, source).map((p) => p.message)

/** Source code from its lines, ending in a newline like a saved file. */
const lines = (...source: string[]) => source.join('\n') + '\n'

/** A component file that follows every convention. */
const GOOD_CARD = lines(
	"import { memo } from 'react'",
	"import type { CardProps } from './card.types'",
	'',
	'const Card = (props: CardProps) => {',
	'	const { title } = props',
	'',
	'	return <div>{title}</div>',
	'}',
	'',
	'export default memo(Card)'
)

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

describe('isCodeFile', () => {
	it.each(['a/card.tsx', 'a/card.types.ts'])('counts %s', (path) => {
		expect(isCodeFile(path)).toBe(true)
	})

	it.each(['a/env.d.ts', 'a/script.mjs', 'a/styles.css'])('skips %s', (path) => {
		expect(isCodeFile(path)).toBe(false)
	})
})

describe('componentName', () => {
	it.each([
		['a/card/card.tsx', 'Card'],
		['a/top-bar/top-bar.tsx', 'TopBar'],
		['a/Card/Card.tsx', 'Card']
	])('names %s %s', (path, name) => {
		expect(componentName(path)).toBe(name)
	})
})

describe('every rule', () => {
	it('passes the clean fixture', () => {
		const files = collectFiles(['tests/fixtures/clean'])

		expect(files.flatMap((path) => checkFile(path, readFileSync(path, 'utf8')))).toEqual([])
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

		expect(check('no-types-in-components', CARD, source)).toEqual([
			expect.objectContaining({ line: 3, column: 1, rule: 'no-types-in-components' }),
			expect.objectContaining({ line: 8, column: 2, rule: 'no-types-in-components' })
		])
		expect(messages('no-types-in-components', CARD, source)).toEqual([
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

		expect(check('no-types-in-components', CARD, source)).toEqual([])
	})

	it('leaves types files alone', () => {
		const source = 'export interface CardProps {\n	selected: boolean\n}\n'

		expect(
			check('no-types-in-components', CARD.replace('card.tsx', 'card.types.ts'), source)
		).toEqual([])
	})
})

describe('no-helpers-in-components', () => {
	it('flags constants, functions and exports besides the component', () => {
		const source = lines(
			"import { memo } from 'react'",
			"import type { CardProps } from './card.types'",
			'',
			'const LIMIT = 3',
			'',
			'function format(title: string) {',
			'	return title.slice(0, LIMIT)',
			'}',
			'',
			'export { format }',
			'',
			'const Card = (props: CardProps) => {',
			'	const { title } = props',
			'',
			'	return <div>{format(title)}</div>',
			'}',
			'',
			'export default memo(Card)'
		)

		expect(messages('no-helpers-in-components', CARD, source)).toEqual([
			'const LIMIT',
			'function format',
			'export { format }'
		])
	})

	it('flags a second component and a named export of the component', () => {
		const source = GOOD_CARD.replace('const Card', 'export const Card').replace(
			'export default',
			'const CardTitle = () => null\n\nexport default'
		)

		expect(messages('no-helpers-in-components', CARD, source)).toEqual([
			'export const Card',
			'const CardTitle'
		])
	})

	it("allows directives, types and a component that isn't named after its file", () => {
		const source = lines(
			"'use client'",
			'interface Hover {}',
			GOOD_CARD.replaceAll('Card', 'CardView')
		)

		expect(check('no-helpers-in-components', CARD, source)).toEqual([])
	})
})

describe('memo-default-export', () => {
	it('passes export default memo(Name)', () => {
		expect(check('memo-default-export', CARD, GOOD_CARD)).toEqual([])
		expect(
			check('memo-default-export', CARD, GOOD_CARD.replace('memo(Card)', 'React.memo(Card)'))
		).toEqual([])
	})

	it.each([
		['export default Card', 'export default Card'],
		['export default memo(CardView)', 'export default memo(CardView)'],
		['export { Card as default }', 'export { Card as default }']
	])('flags %s', (statement, message) => {
		const source = GOOD_CARD.replace('export default memo(Card)', statement)

		expect(check('memo-default-export', CARD, source)).toEqual([
			expect.objectContaining({ line: 10, column: 1, message })
		])
	})

	it('flags a file without a default export, at its first line', () => {
		const source = GOOD_CARD.replace('export default memo(Card)', '')

		expect(check('memo-default-export', CARD, source)).toEqual([
			expect.objectContaining({ line: 1, column: 1, message: 'no default export' })
		])
	})

	it("names the component after the file's name", () => {
		const source = GOOD_CARD.replaceAll('Card', 'TopBar')

		expect(check('memo-default-export', 'src/top-bar/top-bar.tsx', source)).toEqual([])
	})
})

describe('destructure-props', () => {
	it('passes props destructured on the first line, and components without props', () => {
		const noProps = lines(
			"import { memo } from 'react'",
			'',
			'const Card = () => <div />',
			'',
			'export default memo(Card)'
		)

		expect(check('destructure-props', CARD, GOOD_CARD)).toEqual([])
		expect(check('destructure-props', CARD, noProps)).toEqual([])
	})

	it('flags props destructured in the parameters', () => {
		const source = GOOD_CARD.replace('(props: CardProps)', '({ title }: CardProps)').replace(
			'	const { title } = props\n\n',
			''
		)

		expect(messages('destructure-props', CARD, source)).toEqual(['parameter { title }'])
	})

	it("flags a first line that isn't the destructure", () => {
		const source = GOOD_CARD.replace('	const { title } = props', '	const title = props.title')

		expect(messages('destructure-props', CARD, source)).toEqual([
			"first line isn't const { … } = props"
		])
	})

	it('flags a missing blank line after the destructure', () => {
		const source = GOOD_CARD.replace('props\n\n', 'props\n')

		expect(messages('destructure-props', CARD, source)).toEqual(['no blank line after it'])
	})

	it('flags props read any other way', () => {
		const source = GOOD_CARD.replace(
			'	return <div>{title}</div>',
			'	const size = props.size\n\n	return <div {...props}>{title}</div>'
		)

		expect(messages('destructure-props', CARD, source)).toEqual(['props.size', 'props'])
	})

	it('checks a misnamed component too', () => {
		const source = GOOD_CARD.replaceAll('Card', 'CardView').replace('props\n\n', 'props\n')

		expect(messages('destructure-props', CARD, source)).toEqual(['no blank line after it'])
	})
})

describe('component-index', () => {
	const tmp = mkdtempSync(join(tmpdir(), 'cleaner-'))
	afterAll(() => rmSync(tmp, { recursive: true, force: true }))

	/** Writes a card folder with this index.ts (or none), and returns the card's path. */
	const cardFolder = (folder: string, index?: string) => {
		mkdirSync(join(tmp, folder, 'card'), { recursive: true })
		if (index !== undefined) writeFileSync(join(tmp, folder, 'card', 'index.ts'), index)

		return join(tmp, folder, 'card', 'card.tsx')
	}

	it('passes an index.ts that re-exports the component by name', () => {
		const path = cardFolder('good', "export { default as Card } from './card'\n")

		expect(check('component-index', path, GOOD_CARD)).toEqual([])
	})

	it('flags a folder without an index.ts', () => {
		expect(messages('component-index', cardFolder('missing'), GOOD_CARD)).toEqual([
			'no index.ts'
		])
	})

	it.each([
		["export { default } from './card'"],
		["export { default as CardView } from './card'"],
		["export * from './card'"]
	])('flags an index.ts with %s', (index) => {
		const path = cardFolder(`bad-${index.length}`, index)

		expect(messages('component-index', path, GOOD_CARD)).toEqual([
			"index.ts doesn't export Card"
		])
	})
})

describe('max-component-lines', () => {
	/** A component file with this many lines, ending in a newline like a saved file. */
	const component = (lines: number) =>
		[
			"import { memo } from 'react'",
			...Array.from({ length: lines - 3 }, (_, i) => `const value${i} = ${i}`),
			'const Card = () => null',
			'export default memo(Card)'
		].join('\n') + '\n'

	it('flags a component file over the limit, at its first line', () => {
		expect(check('max-component-lines', CARD, component(MAX_COMPONENT_LINES + 1))).toEqual([
			{
				path: CARD,
				line: 1,
				column: 1,
				rule: 'max-component-lines',
				message: `${MAX_COMPONENT_LINES + 1} lines`
			}
		])
	})

	it('reports line 1 even when the file starts with a comment', () => {
		const source = '// Card\n' + component(MAX_COMPONENT_LINES)

		expect(check('max-component-lines', CARD, source)).toEqual([
			expect.objectContaining({ line: 1, column: 1, rule: 'max-component-lines' })
		])
	})

	it('allows a component file at the limit', () => {
		expect(check('max-component-lines', CARD, component(MAX_COMPONENT_LINES))).toEqual([])
	})

	it('leaves other files alone', () => {
		const source = component(MAX_COMPONENT_LINES * 2)

		expect(
			check('max-component-lines', CARD.replace('card.tsx', 'card.utils.ts'), source)
		).toEqual([])
		expect(
			check('max-component-lines', CARD.replace('card.tsx', 'card-header.tsx'), source)
		).toEqual([])
	})

	it('lists problems from every rule in line order', () => {
		const source = component(MAX_COMPONENT_LINES).replace(
			'const Card',
			'interface Hover {\n	x: number\n}\nconst Card'
		)
		const found = checkFile(CARD, source)

		expect(found.map((p) => p.line)).toEqual(found.map((p) => p.line).sort((a, b) => a - b))
		expect(
			found
				.filter((p) => ['max-component-lines', 'no-types-in-components'].includes(p.rule))
				.map((p) => [p.line, p.rule])
		).toEqual([
			[1, 'max-component-lines'],
			[MAX_COMPONENT_LINES - 1, 'no-types-in-components']
		])
	})
})

describe('countLines', () => {
	it.each([
		['', 1],
		['a', 1],
		['a\n', 1],
		['a\nb', 2],
		['a\nb\n', 2],
		['a\r\nb\r\n', 2],
		['a\n\n', 2]
	])('counts %j as %i', (text, count) => {
		expect(countLines(text)).toBe(count)
	})
})

describe('kebab-case-files', () => {
	it.each([
		'src/web/components/top-bar/top-bar.tsx',
		'src/web/components/top-bar/top-bar.types.ts',
		'src/web/icons/icon-2x.ts',
		'src/app/(app)/crawls/[id]/page.tsx',
		'src/app/[...slug]/[[...rest]]/page.tsx',
		'src/app/@modal/_parts/not-found.tsx'
	])('passes %s', (path) => {
		expect(check('kebab-case-files', path, '')).toEqual([])
	})

	it.each([
		['src/demo/mockApi.ts', ['mockApi.ts']],
		['src/demo/sample_data.ts', ['sample_data.ts']],
		['src/Components/card/card.tsx', ['Components/']],
		['src/TopBar/TopBar.tsx', ['TopBar/', 'TopBar.tsx']],
		['src/app/(App)/[userId]/page.tsx', ['(App)/', '[userId]/']]
	])('flags %s', (path, expected) => {
		expect(messages('kebab-case-files', path, '')).toEqual(expected)
	})

	it("doesn't check other kinds of files", () => {
		expect(checkFile('src/Assets/Logo.svg', '')).toEqual([])
	})
})

describe('no-parent-imports', () => {
	it('flags ../ in imports, re-exports and dynamic imports', () => {
		const source = lines(
			"import { a } from '../a'",
			"import { b } from './b'",
			"import { c } from '@web/c'",
			"export { d } from '../../d'",
			"const e = await import('../e')"
		)

		expect(check('no-parent-imports', 'src/web/x.ts', source)).toEqual([
			expect.objectContaining({ line: 1, column: 19, message: '../a' }),
			expect.objectContaining({ line: 4, column: 19, message: '../../d' }),
			expect.objectContaining({ line: 5, column: 24, message: '../e' })
		])
	})
})

describe('import-component-folders', () => {
	it("flags files inside another component's folder", () => {
		const source = lines(
			"import { Card } from './components/card/card'",
			"import type { CardProps } from '@web/components/card/card.types'",
			"import { Icon } from '@web/components/icon/index'"
		)

		expect(messages('import-component-folders', 'src/web/menu/menu.tsx', source)).toEqual([
			'./components/card/card',
			'@web/components/card/card.types',
			'@web/components/icon/index'
		])
	})

	it("allows folders, the component's own files, its parent's files and packages", () => {
		const source = lines(
			"import { Card } from './components/card'",
			"import type { AssetTileProps } from './asset-tile.types'",
			"import { sizeLabel } from '@web/components/share-previews/share-previews.utils'",
			"import { createRoot } from 'react-dom/client'"
		)
		const path = 'src/web/components/share-previews/components/asset-tile/asset-tile.tsx'

		expect(check('import-component-folders', path, source)).toEqual([])
	})
})

describe('blank-line-before-return', () => {
	const PATH = 'src/web/x.ts'

	it('flags a return right under another statement', () => {
		const source = lines('function a() {', '	const x = 1', '	return x', '}')

		expect(check('blank-line-before-return', PATH, source)).toEqual([
			expect.objectContaining({ line: 3, column: 2, message: 'return' })
		])
	})

	it('flags returns in callbacks and case blocks too', () => {
		const source = lines(
			'const b = [1].map((i) => {',
			'	const j = i',
			'	return j',
			'})',
			'switch (b.length) {',
			'	case 1:',
			'		b.pop()',
			'		return',
			'}'
		)

		expect(check('blank-line-before-return', PATH, source).map((p) => p.line)).toEqual([3, 8])
	})

	it('passes a first return and a blank line above, or above its comment', () => {
		const source = lines(
			'function c(x: number) {',
			'	if (x) return 1',
			'	if (x > 1) {',
			'		return 2',
			'	}',
			'	switch (x) {',
			'		case 3:',
			'			return 3',
			'	}',
			'	const y = x',
			'',
			'	// The comment stays with the return.',
			'	return y',
			'}'
		)

		expect(check('blank-line-before-return', PATH, source)).toEqual([])
	})

	it('flags a comment above a return without a blank line above it', () => {
		const source = lines('function d() {', '	const y = 1', '	// Note', '	return y', '}')

		expect(check('blank-line-before-return', PATH, source)).toEqual([
			expect.objectContaining({ line: 4 })
		])
	})
})

describe('no-void', () => {
	it('flags the void operator', () => {
		const source = lines('void load()', 'const f = () => void save()')

		expect(messages('no-void', 'src/web/x.ts', source)).toEqual(['void load()', 'void save()'])
	})
})

describe('no-form-event', () => {
	it('flags FormEvent, but not the import a fix leaves unused', () => {
		const source = lines(
			"import type { FormEvent } from 'react'",
			'',
			'const a = (e: FormEvent<HTMLFormElement>) => e',
			'const b = (e: React.FormEvent) => e'
		)

		expect(messages('no-form-event', 'src/web/x.ts', source)).toEqual([
			'FormEvent<HTMLFormElement>',
			'React.FormEvent'
		])
	})
})

describe('no-inline-handler-bodies', () => {
	const PATH = 'src/web/view.tsx'

	it('flags functions with a { … } body written in a prop', () => {
		const source = lines(
			'const a = <button onClick={() => { save(); close() }} />',
			'const b = <List render={function () { return null }} />'
		)

		expect(messages('no-inline-handler-bodies', PATH, source)).toEqual([
			'onClick={() => { … }}',
			'render={function …}'
		])
	})

	it('allows one-expression functions and named handlers', () => {
		const source = lines(
			'const a = <button onClick={() => setOpen(false)} />',
			'const b = <button onClick={handleSaveClick} />'
		)

		expect(check('no-inline-handler-bodies', PATH, source)).toEqual([])
	})
})

describe('map-items-as-components', () => {
	const PATH = 'src/web/view.tsx'

	it('flags elements in a .map() with inline handlers, once per element', () => {
		const source = lines(
			'const a = items.map((item) => (',
			'	<li key={item.id} onClick={() => select(item.id)}>',
			'		<button onClick={() => remove(item.id)} onFocus={() => focus(item.id)} />',
			'	</li>',
			'))'
		)

		expect(messages('map-items-as-components', PATH, source)).toEqual([
			'<li onClick>',
			'<button onClick onFocus>'
		])
	})

	it('allows sub-components, named handlers and handlers outside a .map()', () => {
		const source = lines(
			'const a = items.map((item) => <Row key={item.id} onSelect={() => select(item.id)} />)',
			'const b = items.map((item) => <li key={item.id} onClick={handleClick} />)',
			'const c = <button onClick={() => setOpen(true)} />'
		)

		expect(check('map-items-as-components', PATH, source)).toEqual([])
	})
})

/**
 * The conventions the cleaner checks. Each rule has an id, a one-line description and fix (shown
 * once per run), the files it applies to, and a check that returns `{ node, message }` for each
 * problem in a parsed file. For a problem with the whole file, return the source file as the node
 * and it's reported at line 1. Keep messages short: they name what's wrong, the description
 * explains why.
 *
 * To add a convention, add a rule here, a test in tests/rules.test.ts and an entry in the README's
 * "What it checks".
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import ts from 'typescript'

/** A TypeScript file: `.ts` or `.tsx`, but not a `.d.ts` declaration file. */
export function isCodeFile(path) {
	return /\.tsx?$/.test(path) && !path.endsWith('.d.ts')
}

/** A file that can contain JSX. */
const isTsxFile = (path) => path.endsWith('.tsx')

/** A component file is named after its folder, like `card/card.tsx`. */
export function isComponentFile(path) {
	return path.endsWith('.tsx') && basename(path, '.tsx') === basename(dirname(path))
}

/** The component a component file is for, from its name: `top-bar.tsx` is `TopBar`. */
export function componentName(path) {
	return basename(path, '.tsx')
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('')
}

/** The most lines a component file can have before it should be split into smaller components. */
export const MAX_COMPONENT_LINES = 250

/** How many lines a file has, numbered the way an editor does: a final newline doesn't add one. */
export function countLines(text) {
	return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

/** Lowercase words and numbers joined by hyphens, like `top-bar` or `icon-2x`. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * A kebab-case folder name. Next.js route folders count when the name inside is kebab-case:
 * `(group)`, `[param]`, `[...slug]`, `[[...slug]]`, `@slot` and `_private`.
 */
function isKebabCaseFolder(name) {
	const inner = name.match(/^\((.+)\)$|^\[\[?(?:\.\.\.)?([^\]]+)\]?\]$|^[@_](.+)$/)

	return KEBAB_CASE.test(inner ? inner.slice(1).find(Boolean) : name)
}

/** Calls `visit` on every node in the tree under `node`, including `node` itself. */
function walk(node, visit) {
	visit(node)
	ts.forEachChild(node, (child) => walk(child, visit))
}

/** A node's source on one line, cut short when it's long: `export default memo(Card)`. */
function shorten(node, max = 40) {
	const text = node.getText().replace(/\s+/g, ' ')

	return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Every module path the file imports or re-exports from, as the string literal naming it. */
function moduleSpecifiers(sourceFile) {
	const found = []
	walk(sourceFile, (node) => {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			found.push(node.moduleSpecifier)
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments[0] &&
			ts.isStringLiteral(node.arguments[0])
		) {
			found.push(node.arguments[0])
		}
	})

	return found
}

/**
 * The component in a component file: the function named after the file, or else the one its
 * default export names (`export default memo(CardView)`), so a misnamed component is reported
 * once, by memo-default-export. It's written as `const Card = (props) => …` or
 * `function Card(props) { … }`. `fn` is undefined when it's declared some other way, and the
 * result is undefined when there's no such declaration.
 */
function findComponent(sourceFile, path) {
	return (
		findDeclaration(sourceFile, componentName(path)) ??
		findDeclaration(sourceFile, defaultExportedName(sourceFile))
	)
}

/** The name in `export default memo(Name)` or `export default Name`, if the file has one. */
function defaultExportedName(sourceFile) {
	const statement = sourceFile.statements.find(
		(s) => ts.isExportAssignment(s) && !s.isExportEquals
	)
	let expression = statement?.expression
	if (expression && ts.isCallExpression(expression)) expression = expression.arguments[0]

	return expression && ts.isIdentifier(expression) ? expression.text : undefined
}

/** The top-level function or variable declared with this name. */
function findDeclaration(sourceFile, name) {
	if (!name) return undefined
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
			return { statement, fn: statement }
		}
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
			const init = declaration.initializer
			const isFunction = init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))

			return { statement, fn: isFunction ? init : undefined }
		}
	}
}

/** Whether a statement has the given modifier, like `export` or `default`. */
const hasModifier = (node, kind) =>
	ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((m) => m.kind === kind))

/** The file's default export: `export default …`, `export default function …` or `export { x as default }`. */
function findDefaultExport(sourceFile) {
	return sourceFile.statements.find(
		(statement) =>
			(ts.isExportAssignment(statement) && !statement.isExportEquals) ||
			hasModifier(statement, ts.SyntaxKind.DefaultKeyword) ||
			(ts.isExportDeclaration(statement) &&
				statement.exportClause &&
				ts.isNamedExports(statement.exportClause) &&
				statement.exportClause.elements.some((e) => e.name.text === 'default'))
	)
}

/** Whether a statement is `const { … } = props`. */
function isPropsDestructure(statement) {
	if (!statement || !ts.isVariableStatement(statement)) return false
	const [declaration, ...others] = statement.declarationList.declarations

	return (
		!others.length &&
		ts.isObjectBindingPattern(declaration.name) &&
		declaration.initializer !== undefined &&
		ts.isIdentifier(declaration.initializer) &&
		declaration.initializer.text === 'props'
	)
}

/** Whether `node` is inside a function passed to `.map()` or `.flatMap()`. */
function isInsideMap(node) {
	for (let parent = node.parent; parent && !ts.isSourceFile(parent); parent = parent.parent) {
		const call = parent.parent
		if (
			(ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
			call &&
			ts.isCallExpression(call) &&
			call.arguments.includes(parent) &&
			ts.isPropertyAccessExpression(call.expression) &&
			['map', 'flatMap'].includes(call.expression.name.text)
		) {
			return true
		}
	}

	return false
}

/** Whether a JSX prop's value is a function written in place: `() => …` or `function () { … }`. */
function isInlineFunction(attribute) {
	const expression = attribute.initializer?.expression

	return Boolean(
		expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
	)
}

export const RULES = [
	{
		id: 'no-types-in-components',
		description: "Component files can't declare interfaces or types.",
		fix: 'Move them to <name>.types.ts, next to the component.',
		appliesTo: isComponentFile,
		check(sourceFile) {
			const problems = []
			const visit = (node) => {
				if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
					const kind = ts.isInterfaceDeclaration(node) ? 'interface' : 'type'
					problems.push({ node, message: `${kind} ${node.name.text}` })
				}
				ts.forEachChild(node, visit)
			}
			visit(sourceFile)

			return problems
		}
	},
	{
		id: 'no-helpers-in-components',
		description: 'Component files hold their component and nothing else, and export only it.',
		fix: 'Move constants to <name>.constants.ts, functions to <name>.utils.ts and other components to their own folders.',
		appliesTo: isComponentFile,
		check(sourceFile, path) {
			const component = findComponent(sourceFile, path)?.statement
			const problems = []
			for (const statement of sourceFile.statements) {
				const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
				const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
				if (
					ts.isImportDeclaration(statement) ||
					ts.isImportEqualsDeclaration(statement) ||
					(ts.isExpressionStatement(statement) &&
						ts.isStringLiteral(statement.expression)) ||
					// Left to no-types-in-components and memo-default-export.
					ts.isInterfaceDeclaration(statement) ||
					ts.isTypeAliasDeclaration(statement) ||
					ts.isExportAssignment(statement) ||
					(statement === component && (!exported || isDefault))
				) {
					continue
				}
				const prefix = exported ? 'export ' : ''
				let message
				if (ts.isVariableStatement(statement)) {
					const flags = statement.declarationList.flags
					const kind =
						flags & ts.NodeFlags.Const
							? 'const'
							: flags & ts.NodeFlags.Let
								? 'let'
								: 'var'
					const names = statement.declarationList.declarations.map((d) =>
						d.name.getText()
					)
					message = `${prefix}${kind} ${names.join(', ')}`
				} else if (ts.isFunctionDeclaration(statement)) {
					message = `${prefix}function ${statement.name?.text ?? ''}`.trim()
				} else if (ts.isClassDeclaration(statement)) {
					message = `${prefix}class ${statement.name?.text ?? ''}`.trim()
				} else if (ts.isEnumDeclaration(statement)) {
					message = `${prefix}enum ${statement.name.text}`
				} else {
					message = shorten(statement)
				}
				problems.push({ node: statement, message })
			}

			return problems
		}
	},
	{
		id: 'memo-default-export',
		description: 'A component file default-exports its component, wrapped in memo.',
		fix: 'End it with export default memo(<Name>), using the component named after the file.',
		appliesTo: isComponentFile,
		check(sourceFile, path) {
			const name = componentName(path)
			const statement = findDefaultExport(sourceFile)
			if (!statement) return [{ node: sourceFile, message: 'no default export' }]
			const expression = ts.isExportAssignment(statement) ? statement.expression : undefined
			const isMemo =
				expression &&
				ts.isCallExpression(expression) &&
				['memo', 'React.memo'].includes(expression.expression.getText()) &&
				expression.arguments.length === 1 &&
				ts.isIdentifier(expression.arguments[0]) &&
				expression.arguments[0].text === name
			if (isMemo) return []

			return [{ node: statement, message: shorten(statement) }]
		}
	},
	{
		id: 'destructure-props',
		description: 'A component takes props and reads them through one const { … } = props line.',
		fix: 'Write (props: <Name>Props), destructure it on the first line and leave a blank line after it.',
		appliesTo: isComponentFile,
		check(sourceFile, path) {
			const fn = findComponent(sourceFile, path)?.fn
			if (!fn || !fn.parameters.length) return []
			const [param] = fn.parameters
			if (
				fn.parameters.length > 1 ||
				!ts.isIdentifier(param.name) ||
				param.name.text !== 'props'
			) {
				return [{ node: param, message: `parameter ${shorten(param.name)}` }]
			}
			if (!ts.isBlock(fn.body)) return [{ node: fn.body, message: 'no const { … } = props' }]
			const [first, ...rest] = fn.body.statements
			if (!isPropsDestructure(first)) {
				return [{ node: first ?? fn.body, message: "first line isn't const { … } = props" }]
			}
			const problems = []
			const lines = sourceFile.text.split('\n')
			const lineAfter = sourceFile.getLineAndCharacterOfPosition(first.getEnd()).line + 1
			if (rest.length && lines[lineAfter].trim() !== '') {
				problems.push({ node: first, message: 'no blank line after it' })
			}
			for (const statement of rest) {
				walk(statement, (node) => {
					if (!ts.isIdentifier(node) || node.text !== 'props') return
					const parent = node.parent
					// `x.props`, `{ props: … }` and declarations named props aren't reads of props.
					if (
						(ts.isPropertyAccessExpression(parent) && parent.name === node) ||
						(ts.isPropertyAssignment(parent) && parent.name === node) ||
						((ts.isParameter(parent) ||
							ts.isVariableDeclaration(parent) ||
							ts.isBindingElement(parent)) &&
							parent.name === node)
					) {
						return
					}
					const read =
						(ts.isPropertyAccessExpression(parent) ||
							ts.isElementAccessExpression(parent)) &&
						parent.expression === node
							? parent
							: node
					problems.push({ node: read, message: shorten(read) })
				})
			}

			return problems
		}
	},
	{
		id: 'component-index',
		description: "A component's folder has an index.ts that re-exports it by name.",
		fix: "Add export { default as <Name> } from './<name>' to the folder's index.ts.",
		appliesTo: isComponentFile,
		check(sourceFile, path) {
			const name = componentName(path)
			const file = basename(path, '.tsx')
			const index = ['index.ts', 'index.tsx']
				.map((n) => join(dirname(path), n))
				.find((p) => existsSync(p))
			if (!index) return [{ node: sourceFile, message: 'no index.ts' }]
			const indexFile = ts.createSourceFile(
				index,
				readFileSync(index, 'utf8'),
				ts.ScriptTarget.Latest,
				true,
				isTsxFile(index) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
			)
			const reexports = indexFile.statements.some(
				(statement) =>
					ts.isExportDeclaration(statement) &&
					statement.moduleSpecifier &&
					ts.isStringLiteral(statement.moduleSpecifier) &&
					statement.moduleSpecifier.text.replace(/\.(tsx|js)$/, '') === `./${file}` &&
					statement.exportClause &&
					ts.isNamedExports(statement.exportClause) &&
					statement.exportClause.elements.some(
						(e) => e.propertyName?.text === 'default' && e.name.text === name
					)
			)
			if (reexports) return []

			return [{ node: sourceFile, message: `${basename(index)} doesn't export ${name}` }]
		}
	},
	{
		id: 'max-component-lines',
		description: `Component files can't be longer than ${MAX_COMPONENT_LINES} lines.`,
		fix: 'Split parts of it into their own components, in a components folder next to it.',
		appliesTo: isComponentFile,
		check(sourceFile) {
			const lines = countLines(sourceFile.text)
			if (lines <= MAX_COMPONENT_LINES) return []

			return [{ node: sourceFile, message: `${lines} lines` }]
		}
	},
	{
		id: 'kebab-case-files',
		description: 'Folder and file names are kebab-case.',
		fix: 'Rename it to lowercase words joined by hyphens, like top-bar/top-bar.tsx.',
		appliesTo: isCodeFile,
		check(sourceFile, path) {
			const segments = path.split('/').filter((s) => s && s !== '.' && s !== '..')
			const file = segments.pop()
			const problems = segments
				.filter((folder) => !isKebabCaseFolder(folder))
				.map((folder) => ({ node: sourceFile, message: `${folder}/` }))
			const parts = file.replace(/\.tsx?$/, '').split('.')
			if (!parts.every((part) => KEBAB_CASE.test(part))) {
				problems.push({ node: sourceFile, message: file })
			}

			return problems
		}
	},
	{
		id: 'no-parent-imports',
		description: 'Imports from outside the current folder use a path alias, never ../.',
		fix: "Import through the project's alias, like @web/…, and use ./ only for the same folder or below.",
		appliesTo: isCodeFile,
		check(sourceFile) {
			return moduleSpecifiers(sourceFile)
				.filter((node) => node.text === '..' || node.text.startsWith('../'))
				.map((node) => ({ node, message: node.text }))
		}
	},
	{
		id: 'import-component-folders',
		description: "Import a component's folder, not the files inside it.",
		fix: "Import from the folder, like './components/card', and export what's needed from its index.ts.",
		appliesTo: isCodeFile,
		check(sourceFile, path) {
			const ancestors = dirname(path).split('/')

			return moduleSpecifiers(sourceFile)
				.filter((node) => {
					const segments = node.text.split('/')
					if (segments.length < 2) return false
					// A file next to this one, like './card.types'.
					if (segments.length === 2 && segments[0] === '.') return false
					const folder = segments.at(-2)
					const file = segments.at(-1).replace(/\.(tsx?|jsx?)$/, '')
					const isInsideComponent = file === 'index' || file.split('.')[0] === folder
					// A component can use its parent's own files, like share-previews.utils.ts.
					// Importing the parent's index.ts instead would import the component itself.

					return isInsideComponent && !ancestors.includes(folder)
				})
				.map((node) => ({ node, message: node.text }))
		}
	},
	{
		id: 'blank-line-before-return',
		description: "A return that isn't first in its block has a blank line above it.",
		fix: 'Add a blank line above the return, or above the comment directly over it.',
		appliesTo: isCodeFile,
		check(sourceFile) {
			const lines = sourceFile.text.split('\n')
			const lineOf = (pos) => sourceFile.getLineAndCharacterOfPosition(pos).line
			const problems = []
			walk(sourceFile, (node) => {
				if (!ts.isReturnStatement(node)) return
				const statements = node.parent.statements
				if (!statements || statements.indexOf(node) < 1) return
				// A comment directly above the return stays with it, so look above the comment.
				let top = lineOf(node.getStart())
				const comments =
					ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? []
				for (const comment of comments.toReversed()) {
					if (lineOf(comment.end) >= top - 1) top = lineOf(comment.pos)
				}
				if (lines[top - 1].trim() !== '') problems.push({ node, message: 'return' })
			})

			return problems
		}
	},
	{
		id: 'no-void',
		description: "Don't use the void operator.",
		fix: 'Call the function as a plain statement, and give an arrow function a block body: () => { load() }.',
		appliesTo: isCodeFile,
		check(sourceFile) {
			const problems = []
			walk(sourceFile, (node) => {
				if (ts.isVoidExpression(node)) problems.push({ node, message: shorten(node) })
			})

			return problems
		}
	},
	{
		id: 'no-form-event',
		description: "Don't use FormEvent, which React's types deprecate.",
		fix: "Use the element's own event type, like SubmitEvent<HTMLFormElement> or ChangeEvent<HTMLInputElement>.",
		appliesTo: isCodeFile,
		check(sourceFile) {
			const problems = []
			walk(sourceFile, (node) => {
				if (!ts.isTypeReferenceNode(node)) return
				const name = node.typeName
				const last = ts.isQualifiedName(name) ? name.right : name
				if (last.text === 'FormEvent') problems.push({ node, message: shorten(node) })
			})

			return problems
		}
	},
	{
		id: 'no-inline-handler-bodies',
		description: 'A function written in a prop is one expression, without a { … } body.',
		fix: 'Move it to a named handle… function above the JSX, like onClick={handleSaveClick}.',
		appliesTo: isTsxFile,
		check(sourceFile) {
			const problems = []
			walk(sourceFile, (node) => {
				if (!ts.isJsxAttribute(node) || !isInlineFunction(node)) return
				const fn = node.initializer.expression
				const name = node.name.getText()
				if (ts.isFunctionExpression(fn)) {
					problems.push({ node, message: `${name}={function …}` })
				} else if (ts.isBlock(fn.body)) {
					problems.push({ node, message: `${name}={() => { … }}` })
				}
			})

			return problems
		}
	},
	{
		id: 'map-items-as-components',
		description: "Elements rendered in a .map() don't have inline handlers of their own.",
		fix: 'Make the item a sub-component in a components folder, with its own handle… functions.',
		appliesTo: isTsxFile,
		check(sourceFile) {
			const problems = []
			walk(sourceFile, (node) => {
				if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return
				// Sub-components, like <BoardTab onSelect={…} />, are what the rule asks for.
				const tag = node.tagName.getText()
				if (!/^[a-z]/.test(tag)) return
				const handlers = node.attributes.properties
					.filter((a) => ts.isJsxAttribute(a) && /^on[A-Z]/.test(a.name.getText()))
					.filter(isInlineFunction)
					.map((a) => a.name.getText())
				if (handlers.length && isInsideMap(node)) {
					problems.push({ node, message: `<${tag} ${handlers.join(' ')}>` })
				}
			})

			return problems
		}
	}
]

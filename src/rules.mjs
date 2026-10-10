/**
 * The conventions the cleaner checks. Each rule has an id, a one-line description and fix (shown
 * once per run), the files it applies to, and a check that returns `{ node, message }` for each
 * problem in a parsed file. Keep messages short: they name what's wrong, the description explains
 * why.
 *
 * To add a convention, add a rule here and a test in tests/rules.test.ts.
 */
import { basename, dirname } from 'node:path'
import ts from 'typescript'

/** A component file is named after its folder, like `card/card.tsx`. */
export function isComponentFile(path) {
	return path.endsWith('.tsx') && basename(path, '.tsx') === basename(dirname(path))
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
	}
]

/**
 * Checks files against the rules in rules.mjs and renders the results for a terminal.
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import pc from 'picocolors'
import ts from 'typescript'
import { RULES } from './rules.mjs'

/** The folder checked when no paths are given. */
export const DEFAULT_PATH = 'src'

/** A path relative to the working directory, with forward slashes. */
const normalize = (path) => relative(process.cwd(), resolve(path)).split(sep).join('/')

/**
 * Checks one file's source against every rule that applies to it.
 *
 * @param {string} path the file's path, with forward slashes
 * @param {string} text the file's contents
 * @returns {{ path: string, line: number, column: number, rule: string, message: string }[]}
 */
export function checkFile(path, text) {
	const rules = RULES.filter((rule) => rule.appliesTo(path))
	if (!rules.length) return []
	const sourceFile = ts.createSourceFile(
		path,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX
	)

	return rules.flatMap((rule) =>
		rule.check(sourceFile, path).map(({ node, message }) => {
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(
				node.getStart(sourceFile)
			)

			return { path, line: line + 1, column: character + 1, rule: rule.id, message }
		})
	)
}

/**
 * Every file under `dir`, as paths relative to the working directory with forward slashes.
 * Skips `node_modules` and folders whose names start with a dot, like `.git`.
 */
export function listFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []

			return listFiles(path)
		}

		return entry.isFile() ? [normalize(path)] : []
	})
}

/**
 * Splits the action's `paths` input into paths. They can be separated by spaces or new lines.
 *
 * @param {string} input
 */
export function parsePaths(input) {
	return input.split(/\s+/).filter(Boolean)
}

/**
 * Turns the paths to check into a list of files: folders are searched, files are kept as they
 * are. Throws when a path doesn't exist, so a typo can't make the check pass by checking nothing.
 *
 * @param {string[]} paths files and folders, relative to the working directory
 */
export function collectFiles(paths) {
	const files = paths.flatMap((path) => {
		let isDirectory
		try {
			isDirectory = statSync(path).isDirectory()
		} catch {
			throw new Error(`${path} doesn't exist.`)
		}

		return isDirectory ? listFiles(path) : [normalize(path)]
	})

	return [...new Set(files)]
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The two halves of the summary line: "3 problems in 2 files" and "40 files checked". */
export function counts(problems, checked) {
	const files = new Set(problems.map((p) => p.path)).size

	return {
		found: `${plural(problems.length, 'problem')} in ${plural(files, 'file')}`,
		checked: `${plural(checked, 'file')} checked`,
		clean: `No problems in ${plural(checked, 'file')}.`
	}
}

/**
 * Renders the problems as a report: each file's problems in aligned rows, then what each rule
 * that fired means and how to fix it, then a summary line.
 *
 * @param {ReturnType<typeof checkFile>} problems
 * @param {number} checked how many files were checked
 * @param {import('picocolors').Colors} colors pass `createColors(false)` for plain text
 */
export function formatReport(problems, checked, colors = pc) {
	const c = colors
	const summary = counts(problems, checked)
	if (!problems.length) return `${c.green('✔')} ${summary.clean}`
	const lines = ['']
	const byFile = Map.groupBy(problems, (p) => p.path)
	for (const [path, list] of byFile) {
		const where = list.map((p) => `${p.line}:${p.column}`)
		const whereWidth = Math.max(...where.map((w) => w.length))
		const messageWidth = Math.max(...list.map((p) => p.message.length))
		lines.push(c.underline(path))
		list.forEach((p, i) => {
			lines.push(
				`  ${c.dim(where[i].padEnd(whereWidth))}  ${c.red('✖')}  ${p.message.padEnd(messageWidth)}  ${c.dim(p.rule)}`
			)
		})
		lines.push('')
	}
	for (const id of new Set(problems.map((p) => p.rule))) {
		const rule = RULES.find((r) => r.id === id)
		lines.push(c.bold(id), `  ${rule.description}`, `  ${c.dim(rule.fix)}`, '')
	}
	lines.push(c.red(c.bold(`✖ ${summary.found}`)) + c.dim(` (${summary.checked})`))

	return lines.join('\n')
}

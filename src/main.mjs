/**
 * Runs the cleaner, as a command or as a GitHub Action.
 *
 * As a command:
 *   cleaner                  check every file in src
 *   cleaner <path>...        check these files and folders
 *
 * As an action, the paths come from the `paths` input (INPUT_PATHS). In GitHub Actions it also
 * annotates each problem, writes a job summary and sets the `problems` output.
 */
import { readFileSync } from 'node:fs'
import pc from 'picocolors'
import { checkFile, collectFiles, DEFAULT_PATH, formatReport, parsePaths } from './cleaner.mjs'
import { annotations, errorCommand, writeOutputs } from './github.mjs'

/**
 * @param {string[]} args the command's arguments
 * @param {NodeJS.ProcessEnv} env
 * @param {(line: string) => void} log
 * @returns {number} the exit code: 0 when there's nothing to fix
 */
export function main(args = process.argv.slice(2), env = process.env, log = console.log) {
	const given = args.length ? args : parsePaths(env.INPUT_PATHS ?? '')
	const paths = given.length ? given : [DEFAULT_PATH]
	const inActions = Boolean(env.GITHUB_ACTIONS)

	let files
	try {
		files = collectFiles(paths)
	} catch (error) {
		log(`${pc.red('✖')} ${error.message}`)
		if (inActions) log(errorCommand(error.message))

		return 1
	}
	const problems = files.flatMap((path) => checkFile(path, readFileSync(path, 'utf8')))

	log(formatReport(problems, files.length))
	if (inActions) {
		for (const line of annotations(problems)) log(line)
		writeOutputs(problems, files.length, env)
	}

	return problems.length ? 1 : 0
}

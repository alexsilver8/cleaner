import { memo } from 'react'

const Menu = () => {
	type Entry = { label: string }
	const entries: Entry[] = []

	return <ul>{entries.length}</ul>
}

export default memo(Menu)

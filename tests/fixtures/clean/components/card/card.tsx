import { memo } from 'react'
import type { CardProps } from './card.types'

const Card = (props: CardProps) => {
	const { title } = props

	return <div>{title}</div>
}

export default memo(Card)

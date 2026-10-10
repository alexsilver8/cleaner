import { memo } from 'react'

interface CardProps {
	title: string
}

type Size = 'small' | 'large'

const Card = (props: CardProps) => {
	const { title } = props

	return <div>{title}</div>
}

export default memo(Card)

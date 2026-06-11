// Tiny dependency-free SVG area chart used by the Dashboard metric cards.
// Renders the series as a filled area + line, scaled to the given max (or
// the series max when omitted).

interface Props {
  points: number[]
  max?: number
  height?: number
  stroke: string   // css color for the line
  fill: string     // css color for the area (use a low-alpha rgba)
  className?: string
}

export default function Sparkline({ points, max, height = 48, stroke, fill, className }: Props) {
  const W = 100 // viewBox width — stretches to container
  const H = height

  if (points.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ width: '100%', height }}>
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke="#333" strokeWidth="1" />
      </svg>
    )
  }

  const effMax = Math.max(max ?? Math.max(...points), 0.0001)
  const stepX = W / (points.length - 1)
  const y = (v: number) => H - Math.min(v / effMax, 1) * (H - 2) - 1

  const linePath = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} style={{ width: '100%', height }}>
      <path d={areaPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

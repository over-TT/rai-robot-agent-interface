import type { SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'arm'
  | 'camera'
  | 'check'
  | 'chevron'
  | 'close'
  | 'cube'
  | 'download'
  | 'eye'
  | 'focus'
  | 'info'
  | 'joint'
  | 'layers'
  | 'more'
  | 'minus'
  | 'plus'
  | 'redo'
  | 'save'
  | 'spark'
  | 'trash'
  | 'undo'
  | 'upload'
  | 'warning'

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number }

export function Icon({ name, size = 16, ...props }: Props) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  const paths: Record<IconName, React.ReactNode> = {
    activity: <><path d="M4 17h3V9H4zM10.5 17h3V5h-3zM17 17h3v-6h-3z" /><path d="M3 20h18" /></>,
    arm: <><circle cx="6" cy="18" r="2" /><circle cx="11" cy="11" r="2" /><circle cx="18" cy="6" r="2" /><path d="m7.2 16.4 2.6-3.8M12.6 9.8l3.8-2.6M4 21h5" /></>,
    camera: <><path d="M14.5 6 13 4H8L6.5 6H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z" /><circle cx="11" cy="12.5" r="3.5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    cube: <><path d="m12 2 8.5 4.8v10.4L12 22l-8.5-4.8V6.8z" /><path d="m3.5 6.8 8.5 5 8.5-5M12 11.8V22" /></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 20h16" /></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    focus: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><circle cx="12" cy="12" r="3" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    joint: <><circle cx="12" cy="12" r="4" /><path d="M3 12h5M16 12h5M12 3v5M12 16v5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    minus: <path d="M5 12h14" />,
    plus: <path d="M12 5v14M5 12h14" />,
    redo: <><path d="m15 6 4 4-4 4" /><path d="M5 18v-3a5 5 0 0 1 5-5h9" /></>,
    save: <><path d="M4 3h13l3 3v15H4z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></>,
    spark: <><path d="m12 2 1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    undo: <><path d="m9 6-4 4 4 4" /><path d="M19 18v-3a5 5 0 0 0-5-5H5" /></>,
    upload: <><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M4 20h16" /></>,
    warning: <><path d="M12 3 2.5 20h19z" /><path d="M12 9v4M12 17h.01" /></>,
  }

  return <svg {...common} {...props}>{paths[name]}</svg>
}

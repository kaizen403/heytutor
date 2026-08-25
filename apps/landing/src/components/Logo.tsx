interface LogoProps {
  className?: string
}

export default function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Accelute logo"
    >
      <path d="M 144 256 L 28 256 L 144 140 Z M 256 200 L 200 256 L 200 56 L 0 56 L 56 0 L 256 0 Z M 0 204 L 0 112 L 92 112 Z" />
    </svg>
  )
}

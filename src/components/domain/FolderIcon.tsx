/**
 * Windows-style folder icon — the classic two-tone amber folder, drawn as an
 * inline SVG so it scales crisply at any tile size and needs no asset.
 */

export function WinFolderIcon({ size = 64 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.82}
      viewBox="0 0 80 66"
      fill="none"
      aria-hidden
      className="win-folder-icon"
    >
      <defs>
        <linearGradient id="wf-back" x1="4" y1="8" x2="76" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f7ce6b" />
          <stop offset="1" stopColor="#eeab3d" />
        </linearGradient>
        <linearGradient id="wf-front" x1="4" y1="18" x2="76" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd977" />
          <stop offset="1" stopColor="#f2b23e" />
        </linearGradient>
      </defs>
      {/* back flap */}
      <path
        d="M4 12a6 6 0 0 1 6-6h18.5a6 6 0 0 1 4.35 1.87l4.3 4.6A6 6 0 0 0 41.5 14H70a6 6 0 0 1 6 6v4H4V12Z"
        fill="url(#wf-back)"
      />
      {/* front panel */}
      <path
        d="M4 22h72v34a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V22Z"
        fill="url(#wf-front)"
      />
      {/* subtle top edge highlight */}
      <path d="M4 22h72v3H4z" fill="#ffffff" opacity="0.35" />
    </svg>
  );
}

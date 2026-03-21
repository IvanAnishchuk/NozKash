/** Navbar logo SVG from eGhostCash design (static). */
export function EgcNavbarLogo() {
  return (
    <div className="navbar-logo">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 236 80"
        width={130}
        height={44}
        aria-hidden
      >
        <defs>
          <clipPath id="egcNavClip">
            <rect width="236" height="80" rx="14" />
          </clipPath>
        </defs>
        <rect width="236" height="80" rx="14" fill="#0A0A0F" />
        <g clipPath="url(#egcNavClip)">
          <g className="ghost-anim">
            <g>
              <path
                className="body-anim"
                d="M19 2C9.61 2 2 9.61 2 19V42L7.5 36.5L13 42L19 36.5L25 42L30.5 36.5L36 42V19C36 9.61 28.39 2 19 2Z"
                fill="#E84142"
                fillOpacity="0.15"
                stroke="#E84142"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <g className="eyes-anim">
                <circle cx="13" cy="19" r="2.5" fill="#E84142" fillOpacity="0.88" />
                <circle cx="25" cy="19" r="2.5" fill="#E84142" fillOpacity="0.88" />
              </g>
              <path
                d="M14 25Q19 29 24 25"
                stroke="#E84142"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
                strokeOpacity="0.7"
              />
            </g>
          </g>
          <rect
            className="scan-anim"
            x="62"
            y="57"
            width="0"
            height="1.5"
            rx="0.8"
            fill="#E84142"
          />
          <text
            className="word-anim"
            y="50"
            fontFamily="'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif"
            fontWeight="600"
            fontSize="26"
            letterSpacing="-0.8"
          >
            <tspan x="62" fill="#FFFFFF">
              e
            </tspan>
            <tspan className="red-anim" fill="#E84142">
              Ghost
            </tspan>
            <tspan fill="#FFFFFF">Cash</tspan>
          </text>
        </g>
      </svg>
    </div>
  )
}

/** Decorative ghost (bottom bar); animation in `enozkash.css` (`bn-nozk-*` classes). */
export function BottomNozkDecor() {
  return (
    <div className="bottom-nav" aria-hidden="true">
      <div className="bottom-nav-nozk">
        <svg
          className="bottom-nav-nozk-svg"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 80 96"
          width="80"
          height="96"
        >
          <ellipse
            className="bn-nozk-shadow"
            cx="40"
            cy="90"
            rx="18"
            ry="4"
            fill="#E84142"
            opacity={0.38}
          />
          <g className="bn-nozk-wrap">
            <path
              className="bn-nozk-body"
              d="M40 4C20.67 4 5 19.67 5 39V86L15.5 75.5L26 86L40 75.5L54 86L64.5 75.5L75 86V39C75 19.67 59.33 4 40 4Z"
              fill="#E84142"
              fillOpacity={0.13}
              stroke="#E84142"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
            <g className="bn-nozk-eyes">
              <circle cx="28" cy="40" r="5" fill="#E84142" fillOpacity={0.85} />
              <circle cx="52" cy="40" r="5" fill="#E84142" fillOpacity={0.85} />
            </g>
            <path
              d="M30 52Q40 60 50 52"
              stroke="#E84142"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
              strokeOpacity={0.65}
            />
          </g>
        </svg>
      </div>
    </div>
  )
}

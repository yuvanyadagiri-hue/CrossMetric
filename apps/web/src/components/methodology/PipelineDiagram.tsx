/** The CrossMetric data pipeline, drawn as an accessible SVG. */
const STAGES = [
  { title: "Public sources", lines: ["NCES schools", "GDOT crashes", "GDOT roads + AADT", "Census street names"] },
  { title: "Validate & clean", lines: ["Live schema checks", "Quarantine bad records", "Each with a reason"] },
  { title: "Common CRS", lines: ["Georgia Statewide", "Lambert (meters)", "< 0.06% distortion"] },
  { title: "Road candidates", lines: ["Intersections:", "3+ directions", "Segments ≤ 250 m"] },
  { title: "Associate", lines: ["Crash → road ≤ 30 m", "Intersection ≤ 76.2 m", "AADT on same route"] },
  { title: "Score & rank", lines: ["Percentiles", "Weighted priority", "4 scenarios"] },
  { title: "Explain & plan", lines: ["Evidence report", "Stability", "Resource Planner"] },
];

export function PipelineDiagram() {
  const w = 150;
  const gap = 22;
  const total = STAGES.length * w + (STAGES.length - 1) * gap;
  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${total} 132`} className="min-w-[760px]" role="img" aria-labelledby="pipeline-title pipeline-desc">
        <title id="pipeline-title">CrossMetric data pipeline</title>
        <desc id="pipeline-desc">{STAGES.map((s) => `${s.title}: ${s.lines.join(", ")}`).join(". ")}</desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#98a2b3" />
          </marker>
        </defs>
        {STAGES.map((s, i) => {
          const x = i * (w + gap);
          const last = i === STAGES.length - 1;
          return (
            <g key={s.title}>
              <rect x={x + 0.5} y={0.5} width={w - 1} height={131} rx={9} fill={i === 0 ? "#eef7f1" : last ? "#15191E" : "#ffffff"} stroke={last ? "#15191E" : "#d0d6df"} />
              <text x={x + 12} y={26} fontSize={12.5} fontWeight={650} fill={last ? "#ffffff" : "#0f1d33"}>
                {s.title}
              </text>
              {s.lines.map((l, j) => (
                <text key={l} x={x + 12} y={52 + j * 19} fontSize={11.5} fill={last ? "#c9d6ea" : "#475467"}>
                  {l}
                </text>
              ))}
              {!last ? <line x1={x + w + 2} y1={66} x2={x + w + gap - 3} y2={66} stroke="#98a2b3" strokeWidth={1.5} markerEnd="url(#arrow)" /> : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

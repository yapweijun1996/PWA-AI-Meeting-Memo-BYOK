export function LoadingPlaceholder({ kind, label }: { kind: "library" | "meeting"; label: string }) {
  return <div className={`loading-placeholder loading-${kind}`} role="status" aria-label={label}>
    <span className="loading-label">{label}</span>
    <div className="loading-shapes" aria-hidden="true">
      {(kind === "library" ? [0, 1, 2] : [0, 1]).map((item) => <div className="loading-card" key={item}>
        <span className="loading-line short" /><span className="loading-line" /><span className="loading-line medium" />
      </div>)}
    </div>
  </div>;
}

/** A row of colour swatches for a colour menu. */
export function Swatches({
  colors,
  onPick,
}: {
  colors: { hex: string; label: string }[]
  onPick: (hex: string) => void
}) {
  return (
    <div className="flex gap-1 px-3 py-1" role="group">
      {colors.map((c) => (
        <button
          key={c.hex + c.label}
          type="button"
          title={`${c.label} (#${c.hex})`}
          aria-label={c.label}
          onClick={() => onPick(c.hex)}
          className="border-outline-variant hover:border-on-surface focus-visible:ring-primary h-[16px] w-[16px] border outline-none focus-visible:ring-2"
          // The swatch shows the deck's own colour: content, not chrome.
          style={{ backgroundColor: `#${c.hex}` }}
        />
      ))}
    </div>
  )
}

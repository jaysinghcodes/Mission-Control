/**
 * Text-only pieces of the experimental custom-tool page.
 * User strings are React children, so `<script>` stays characters.
 */

export function ExperimentalBadge() {
  return (
    <span
      data-testid="experimental-label"
      className="inline-flex h-[22px] items-center rounded-full bg-mc-orangebg px-2.5 text-[11.5px] font-semibold whitespace-nowrap text-mc-orangetext"
    >
      Experimental
    </span>
  )
}

export function PlainText({ text, className = '' }: { text: string; className?: string }) {
  return <span className={`whitespace-pre-wrap break-words ${className}`}>{text}</span>
}

export function FilledPrompt({ text }: { text: string }) {
  return (
    <pre data-testid="filled-prompt" className="whitespace-pre-wrap break-words font-mono text-[13px] text-mc-text">
      <PlainText text={text} />
    </pre>
  )
}

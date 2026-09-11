/**
 * The plain-English fields are written by hand and use `**bold**` to name the app
 * a sentence is about. That is the only markup allowed, so a full markdown parser
 * would be a dependency bought for nothing.
 */
export default function RichText({ text }) {
  const parts = String(text ?? '').split(/\*\*(.+?)\*\*/g)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
      )}
    </>
  )
}

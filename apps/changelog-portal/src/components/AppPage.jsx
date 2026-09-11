import { useMemo, useState } from 'react'
import { humanDate } from '../format.js'

/**
 * One app, every update it has ever had, newest first and grouped by month.
 * A date and a sentence — nothing else, on purpose.
 */
export default function AppPage({ card, onBack }) {
  const [query, setQuery] = useState('')

  const months = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return card.months
    return card.months
      .map((month) => ({
        ...month,
        items: month.items.filter((item) => item.text.toLowerCase().includes(needle)),
      }))
      .filter((month) => month.items.length > 0)
  }, [card.months, query])

  const shown = months.reduce((sum, month) => sum + month.items.length, 0)

  return (
    <article className="detail-page">
      <button type="button" className="back" onClick={onBack}>← All apps</button>

      <div className="detail-head">
        <h1 className="detail-name">{card.name}</h1>
        {card.live && (
          <a className="live-button" href={card.live} target="_blank" rel="noreferrer">
            Open the app ↗
          </a>
        )}
      </div>
      <p className="detail-purpose">{card.purpose}</p>
      <p className="detail-range">
        <strong>{card.total}</strong> update{card.total === 1 ? '' : 's'} in all, from{' '}
        {humanDate(card.first)} to {humanDate(card.last)}.
      </p>

      <div className="find">
        <label htmlFor="find">Find an update</label>
        <input
          id="find"
          type="search"
          value={query}
          placeholder="type a word, e.g. price"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && <span className="find-count">{shown} of {card.total}</span>}
      </div>

      {months.length === 0 && <p className="empty">Nothing matches “{query}”.</p>}

      {months.map((month) => (
        <section className="month" key={month.key}>
          <h2>{month.label}</h2>
          <ol className="updates">
            {month.items.map((item, index) => (
              <li key={`${item.date}-${index}`}>
                <span className="day">{item.day}</span>
                <span className="what">{item.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </article>
  )
}

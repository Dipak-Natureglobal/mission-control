import RichText from './RichText.jsx'
import { humanDate } from '../format.js'

/**
 * The front page: what changed most recently, then every app as a card you can
 * open. Nothing technical appears here — no version codes, no file counts.
 */
export default function Home({ cards, latest, onOpen }) {
  return (
    <>
      {latest && (
        <section className="latest">
          <p className="latest-when">Latest update · {humanDate(latest.date)}</p>
          <h2 className="latest-headline"><RichText text={latest.headline} /></h2>
          <ul className="latest-points">
            {(latest.meaning ?? []).map((line, index) => (
              <li key={index}><RichText text={line} /></li>
            ))}
          </ul>
          <p className="latest-field">
            <strong>Does this need anything from us?</strong>{' '}
            <RichText text={latest.actionNeeded} />
          </p>
          <p className="latest-field">
            <strong>Still open:</strong> <RichText text={latest.stillOpen} />
          </p>
        </section>
      )}

      <h2 className="section-title">The apps</h2>
      <p className="section-note">Open any app to see everything that has ever changed in it.</p>

      <div className="cards">
        {cards.map((card) => {
          const openable = card.total > 0
          return (
            <div className={openable ? 'card' : 'card card-flat'} key={card.dir}>
              {/* The name and description are the button; the live link below has
                  to sit outside it, because a link cannot live inside a button. */}
              <button
                type="button"
                className="card-open"
                onClick={() => openable && onOpen(card.key)}
                disabled={!openable}
              >
                <span className="card-name">{card.name}</span>
                <span className="card-purpose">{card.purpose}</span>
              </button>

              <div className="card-foot">
                <span className="card-count">
                  {openable ? (
                    <>
                      <strong>{card.total}</strong> update{card.total === 1 ? '' : 's'}
                      <span className="card-sep">·</span>
                      last on {humanDate(card.last)}
                    </>
                  ) : (
                    'Nothing recorded yet'
                  )}
                </span>
                {card.live && (
                  <a className="live-link" href={card.live} target="_blank" rel="noreferrer">
                    Open the app ↗
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

import { useEffect, useMemo, useState } from 'react'
import entries from './data/changelog.json'
import appsData from './data/apps.json'
import history from './data/history.json'
import Home from './components/Home.jsx'
import AppPage from './components/AppPage.jsx'
import BlinkerMark from './components/BlinkerMark.jsx'
import { LOCAL_KEY } from './format.js'

/**
 * Each card joins the hand-written description of an app to its recorded
 * history. `This project itself` has history but no description, so it gets one
 * here rather than being dropped.
 */
function buildCards() {
  const byKey = new Map(history.apps.map((app) => [app.key, app]))
  const cards = appsData.apps.map((app) => {
    const record = app.remote ? byKey.get(app.remote) : null
    return {
      key: app.remote ?? app.dir,
      dir: app.dir,
      name: app.name,
      purpose: app.purpose,
      live: app.live ?? null,
      total: record?.total ?? 0,
      first: record?.first ?? null,
      last: record?.last ?? null,
      months: record?.months ?? [],
    }
  })

  const local = byKey.get(LOCAL_KEY)
  if (local) {
    cards.push({
      key: LOCAL_KEY,
      dir: LOCAL_KEY,
      name: local.name,
      purpose: 'The setup that holds all the apps together — how they are installed, run and published.',
      live: null,
      total: local.total,
      first: local.first,
      last: local.last,
      months: local.months,
    })
  }

  return cards
}

export default function App() {
  const cards = useMemo(() => buildCards(), [])
  const [open, setOpen] = useState(null)
  const current = cards.find((card) => card.key === open) ?? null

  // Opening an app should start you at the top of its history, not halfway down
  // the page you just scrolled.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [open])

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <BlinkerMark className="brand-mark" />
          <span className="brand-name">Blinker</span>
        </div>
        <h1>What changed</h1>
        <p className="lede">
          A record of every update to the Blinker apps, in plain words. Pick an app to see its whole
          history, from the very first update to the most recent.
        </p>
      </header>

      <main>
        {current ? (
          <AppPage card={current} onBack={() => setOpen(null)} />
        ) : (
          <Home cards={cards} latest={entries[0] ?? null} onOpen={setOpen} />
        )}
      </main>

      <footer className="foot">
        <p>
          The same record as plain files in this project: <code>CHANGELOG.md</code> for what has
          happened, <code>ROADMAP.md</code> for what is still to come.
        </p>
      </footer>
    </div>
  )
}

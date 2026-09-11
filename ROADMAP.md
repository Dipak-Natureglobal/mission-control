# Roadmap

What is still to be done in this project, and why it matters. Written in plain
English — if an item here needs a developer to explain it, it is written badly.

For what has *already* changed, see [CHANGELOG.md](CHANGELOG.md).

**This file is written by hand.** Unlike `CHANGELOG.md`, nothing generates it, and
nothing overwrites it. Add to it whenever something is decided, blocked, or
finished.

**Two roadmaps exist, and they are not the same thing.**

| | This file | [`packages/blinker-platform/STATUS.md`](packages/blinker-platform/STATUS.md) |
| --- | --- | --- |
| Whose work | Ours — this project | The Blinker teams' — the portals themselves |
| Who writes it | Us | Them, upstream |
| Survives a sync? | Yes | **No** — every `pnpm sync` overwrites it with their latest |

So: if the work is "make the portals run and deploy together", it belongs here.
If it is "build the next feature inside a portal", it belongs to them and shows up
here only once it lands.

---

## Working on now

- **Nothing in flight.** The last piece of work — gathering the portals into one
  project and adding this change record — is finished. See the first entry in
  [CHANGELOG.md](CHANGELOG.md).

## Next up

- **Give the card-payment step a live address.** Right now the payment call
  (`/efs-charge`) is pointed at a service running on a developer's own laptop.
  On a deployed site there is nothing at that address, so the step cannot work.
  *Why it matters:* any demo that reaches the payment screen will fail in front
  of whoever is watching.

- **Confirm the pricing service accepts live requests.** When a developer runs a
  portal locally, the request to StoneEagle (the outside service that prices a
  plan) is quietly stripped of the headers that say which website it came from.
  The deployed version cannot do that. StoneEagle may accept it, or may refuse
  it — nobody has checked.
  *Why it matters:* if it refuses, every deployed portal that quotes a price
  stops quoting prices, and the error will look like a bug in our code.

- **Correct the app descriptions.** The one-line descriptions on the *Apps* tab
  of the Changelog Portal were written from folder names and are educated
  guesses. Whoever knows what each portal actually does should fix them in
  `apps/changelog-portal/src/data/apps.json`.
  *Why it matters:* this is the page a new person reads first. Wrong there is
  worse than missing.

## Blocked, and why

- **The Customer Portal cannot be worked on.** The Blinker team has not written
  it yet — their repository currently holds only shared settings files and no
  website at all. Address 30004 is being held for it, and it will appear here on
  its own the first time `pnpm sync` finds code in it.
  *Blocked on:* the Blinker team, per their own plan, which puts this portal last.

## Someday, maybe

- **Make the plain-English summary impossible to skip.** `pnpm changelog:check`
  already fails while an entry is half-written, but somebody has to remember to
  run it. Running it automatically before a commit, or in CI, would close that
  gap.
  *Why it matters:* the whole value of the change record is that a non-technical
  reader can follow it. One skipped entry and it is back to being a commit list.

- **A single page that shows every portal's health at once.** The *Apps* tab
  already lists what exists and when it last changed; it does not know whether
  the deployed version is actually up.

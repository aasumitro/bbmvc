interface NoticeProps {
  title: string
  line: string
}

// A screen instead of the game: the device can't play it (main.tsx), or the
// game itself didn't load. Links lead back to the site the game is served from.
export function Notice({ title, line }: NoticeProps) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-cover bg-center px-6 text-center text-[#f2ece0] before:absolute before:inset-0 before:bg-black/65 before:content-['']"
      style={{ backgroundImage: `url('${import.meta.env.BASE_URL}bg/loading.jpg')` }}
    >
      <h1 className="relative m-0 font-display text-5xl font-semibold tracking-wider drop-shadow-[0_0_32px_rgba(220,38,38,0.5)]">Scrapyard</h1>
      <div role="alert" className="relative max-w-sm">
        <p className="font-sans text-xs tracking-[0.3em] text-red-400 uppercase">{title}</p>
        <p className="mt-3 font-display text-lg text-neutral-200 italic">{line}</p>
      </div>
      <nav className="relative flex gap-6 font-sans text-xs font-bold tracking-[0.2em] uppercase">
        <a href="/docs" className="text-neutral-300 hover:text-white">
          The guide
        </a>
        <a href="/" className="text-neutral-300 hover:text-white">
          Home
        </a>
      </nav>
    </div>
  )
}

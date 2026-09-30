// Signed out while on the account page (its Log out, another tab).
export function SignedOut() {
  return (
    <p className="mt-8 text-neutral-300">
      You&rsquo;re signed out.{' '}
      <a href="/login?next=/account" className="text-link">
        Log in
      </a>{' '}
      to see your account.
    </p>
  )
}

// A guest has no account to show: make one, or log in to one.
export function GuestNotice() {
  return (
    <div className="mt-8 rounded border border-line bg-panel p-6 sm:p-8">
      <p className="leading-7 text-neutral-300">You&rsquo;re playing as a guest. Guests are deleted 3 days after they&rsquo;re made: create an account to keep your name on every browser, or log in to one you have.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href="/register" className="button-primary px-5 py-2.5 text-xs">
          Create an account
        </a>
        <a href="/login?next=/account" className="button-quiet px-5 py-2.5 text-xs">
          Log in
        </a>
      </div>
    </div>
  )
}

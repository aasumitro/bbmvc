import { Confirm } from './Confirm.tsx'

// Leaving a match still in progress asks first (GameCanvas.tsx): a lobby's
// match goes back to the lobby; Classic's leaves a bot in the seat;
// practice's progress is lost.

interface ExitConfirmProps {
  lobby: boolean // a custom lobby's match
  online: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ExitConfirm({ lobby, online, onConfirm, onCancel }: ExitConfirmProps) {
  return lobby ? (
    <Confirm
      title="Back to the lobby?"
      body="Your machine leaves the match; you stay in the lobby."
      confirm="Back to lobby"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : online ? (
    <Confirm title="Leave the match?" body="A bot takes your machine over." confirm="Leave match" onConfirm={onConfirm} onCancel={onCancel} />
  ) : (
    <Confirm title="Leave the match?" body="Your progress in this match will be lost." confirm="Exit to garage" onConfirm={onConfirm} onCancel={onCancel} />
  )
}

// Keyboard + mouse for the local driver, sampled once per frame. Mouse look
// needs pointer lock, which a click on `surface` (the game canvas) requests.
export interface InputState {
  throttle: number // W/S (arrow keys are for menus)
  steer: number // A/D: 1 left, -1 right
  handbrake: boolean // Space
  recover: boolean // R: back on the road when stuck
  fire: boolean // left mouse button
  lookX: number // pointer-locked mouse movement since the last read, pixels
  lookY: number
}

export function createInput(surface: HTMLElement) {
  const keys = new Set<string>()
  let fire = false
  let lookX = 0
  let lookY = 0
  const locked = () => document.pointerLockElement === surface

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'text') return // typed into a text box (the match chat): never driving
    keys.add(e.code)
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault() // the handbrake mustn't press a focused button; settings sliders keep their keys
  }
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
  const lock = () => {
    if (!locked()) Promise.resolve(surface.requestPointerLock()).catch(() => {}) // refused right after Esc; the next click retries
  }
  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    fire = true
    lock()
  }
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) fire = false
  }
  const onMouseMove = (e: MouseEvent) => {
    if (!locked()) return
    lookX += e.movementX
    lookY += e.movementY
  }
  const release = () => {
    keys.clear()
    fire = false
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('blur', release)
  surface.addEventListener('mousedown', onMouseDown)

  return {
    locked,
    lock,
    read(out: InputState) {
      out.throttle = +keys.has('KeyW') - +keys.has('KeyS')
      out.steer = +keys.has('KeyA') - +keys.has('KeyD')
      out.handbrake = keys.has('Space')
      out.recover = keys.has('KeyR')
      out.fire = fire
      out.lookX = lookX
      out.lookY = lookY
      lookX = lookY = 0
      return out
    },
    unlock() {
      if (locked()) document.exitPointerLock()
      release()
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', release)
      surface.removeEventListener('mousedown', onMouseDown)
      if (locked()) document.exitPointerLock()
    },
  }
}

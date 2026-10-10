import { useEffect, useRef, useState } from 'react'
import { sustainedDps, WEAPONS, type WeaponId, type WeaponKind, type WeaponSpec } from '../content/weapons/weapons.ts'
import { MENU_BACKDROP } from '../runtime/loading.ts'
import type { Loadout } from '../sim/loadout.ts'
import { createTurntable } from '../view/turntable.ts'
import { drivePerformance } from '../sim/drive.ts'
import { VEHICLES, type VehicleId, type VehicleSpec } from '../content/vehicles/vehicles.ts'
import { ActionButton, Menu, Pager } from './Menu.tsx'

interface GarageProps {
  loadout: Loadout
  onLoadout: (loadout: Loadout) => void
  onBack: () => void
  onSelect: () => void // take this vehicle on to arena selection
}

interface NavItem {
  label: string
  hint: string
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Vehicle', hint: 'your ride' },
  { label: 'Loadout', hint: 'arm your turret' },
  { label: 'Back', hint: 'return to menu' },
]

type Spec = [label: string, value: string]

// Worked out from the tuning the simulation runs on, so every figure is what
// the car does in the arena. Turning circle: outer front wheel at full lock.
function vehicleSpecs({ handling, chassis, armour }: VehicleSpec): Spec[] {
  const drive = drivePerformance(handling)
  const [, halfTrack, halfWheelbase] = chassis.wheels[0]
  return [
    ['Top speed', `${Math.round(drive.topSpeed * 3.6)} km/h`],
    ['0–80 km/h', `${drive.zeroTo80.toFixed(1)} s`],
    ['Power', `${Math.round(drive.power / 745.7)} hp`],
    ['Weight', `${handling.mass.toLocaleString('en')} kg`],
    ['Turning circle', `${(2 * ((2 * halfWheelbase) / Math.sin(handling.steerLock) + halfTrack)).toFixed(1)} m`],
    ['Armour', `${armour} HP`],
  ]
}
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]
const VEHICLE_IDS = Object.keys(VEHICLES) as VehicleId[]
const FLEET = VEHICLE_IDS.length > 1 // a vehicle pager once there's a choice

// The id `step` places on from `at` in a registry's ids, round past either end.
const turn = <K extends string>(ids: K[], at: K, step: number) => ids[(ids.indexOf(at) + step + ids.length) % ids.length]

// By how the weapon fires: what a round is called (one, many), and the rows only that kind has.
const ROUND: Record<WeaponKind, [string, string]> = { gun: ['round', 'rounds'], rocket: ['rocket', 'rockets'] }
function kindSpecs(w: WeaponSpec): Spec[] {
  switch (w.kind) {
    case 'gun':
      return []
    case 'rocket':
      return [
        ['Rocket speed', `${w.rocket.speed} m/s`],
        ['Blast radius', `${w.rocket.blast} m`],
      ]
  }
}

const weaponSpecs = (w: WeaponSpec): Spec[] => [
  ['Damage', `${w.damage} per ${ROUND[w.kind][0]}`],
  ['Rate of fire', `${Math.round(w.fireRate * 60)} rpm`],
  ['Magazine', `${w.magazine} ${ROUND[w.kind][1]}`],
  ['Reload', `${w.reloadTime.toFixed(1)} s`],
  ['Range', `${w.range} m`],
  ...kindSpecs(w),
  ['Firepower', `${Math.round(sustainedDps(w))} dmg/s`], // over whole magazines, reloads included
]

const keycap = 'rounded border border-neutral-500/50 px-1.5 py-0.5'

function SpecSheet({ specs }: { specs: Spec[] }) {
  return (
    <dl className="mt-6 flex flex-col text-left">
      {specs.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between border-b border-white/10 py-1.5">
          <dt className="text-xs tracking-[0.15em] text-neutral-400 uppercase">{label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// The car on its turntable (view/turntable.ts), mounted once and rebuilt when the loadout changes it.
function Turntable({ loadout }: { loadout: Loadout }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stage = useRef<ReturnType<typeof createTurntable>>(null)
  useEffect(() => {
    const turntable = createTurntable(containerRef.current!)
    stage.current = turntable
    return () => {
      stage.current = null
      turntable.dispose()
    }
  }, [])
  useEffect(() => stage.current?.show(loadout.vehicle, WEAPONS[loadout.weapon].turret), [loadout])
  return <div ref={containerRef} className="fixed inset-0" />
}

export function Garage({ loadout, onLoadout, onBack, onSelect }: GarageProps) {
  const [selected, setSelected] = useState(0)
  const showLoadout = NAV_ITEMS[selected].label === 'Loadout'
  const vehicle = VEHICLES[loadout.vehicle]
  const weapon = WEAPONS[loadout.weapon]
  const place = WEAPON_IDS.indexOf(loadout.weapon)
  const cycle = (step: number) => onLoadout({ ...loadout, weapon: turn(WEAPON_IDS, loadout.weapon, step) })
  const swap = (step: number) => onLoadout({ ...loadout, vehicle: turn(VEHICLE_IDS, loadout.vehicle, step) })
  // What ←→ pages through: the weapons on the loadout page, the vehicles on the vehicle page.
  const pages = showLoadout ? cycle : FLEET && NAV_ITEMS[selected].label === 'Vehicle' ? swap : undefined

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') setSelected((i) => (i + 1) % NAV_ITEMS.length)
      if (e.key === 'ArrowUp') setSelected((i) => (i - 1 + NAV_ITEMS.length) % NAV_ITEMS.length)
      if (e.key === 'ArrowLeft') pages?.(-1)
      if (e.key === 'ArrowRight') pages?.(1)
      if (e.key === 'Enter') {
        e.preventDefault() // no second press through a focused button
        ;(NAV_ITEMS[selected].label === 'Back' ? onBack : onSelect)()
      }
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const select = <ActionButton primary title="Select" line="Take it to the arena" onClick={onSelect} className="pointer-events-auto mt-6 w-full" />

  return (
    <div
      className="fixed inset-0 bg-cover bg-center text-[#f2ece0] before:absolute before:inset-0 before:bg-black/45 before:content-['']"
      style={{ backgroundImage: `url('${MENU_BACKDROP}')` }}
    >
      <Turntable loadout={loadout} />

      <div className="pointer-events-none absolute top-8 left-[6vw]">
        <h1 className="m-0 font-display text-6xl font-semibold tracking-wider">Garage</h1>
        <p className="mt-1 font-display text-lg text-red-400/90 italic">Your machine</p>
      </div>

      <Menu
        items={NAV_ITEMS}
        selected={selected}
        onSelect={setSelected}
        onActivate={(i) => (NAV_ITEMS[i].label === 'Back' ? onBack() : setSelected(i))}
        className="absolute top-40 left-[6vw]"
      />

      {showLoadout ? (
        <div className="pointer-events-none absolute top-8 right-[4vw] w-80 text-right">
          <h2 className="m-0 font-display text-4xl font-semibold">Loadout</h2>
          <p className="mt-1 text-xs tracking-[0.2em] text-neutral-400 uppercase">
            Roof turret · {place + 1} / {WEAPON_IDS.length}
          </p>
          <div className="mt-5 flex items-center justify-between">
            <span className="font-display text-2xl">{weapon.name}</span>
            <span className="pointer-events-auto">
              <Pager what="weapon" onStep={cycle} />
            </span>
          </div>
          <SpecSheet specs={weaponSpecs(weapon)} />
          <p className="mt-6 text-right font-display text-sm text-neutral-300 italic">{weapon.blurb}</p>
          {select}
        </div>
      ) : (
        <div className="pointer-events-none absolute top-8 right-[4vw] w-80 text-right">
          <h2 className="m-0 font-display text-4xl font-semibold">{vehicle.name}</h2>
          <p className="mt-1 text-xs tracking-[0.2em] text-neutral-400 uppercase">
            {vehicle.kind}
            {FLEET && ` · ${VEHICLE_IDS.indexOf(loadout.vehicle) + 1} / ${VEHICLE_IDS.length}`}
          </p>
          {FLEET && (
            <div className="pointer-events-auto mt-5 flex justify-end">
              <Pager what="vehicle" onStep={swap} />
            </div>
          )}
          <SpecSheet specs={vehicleSpecs(vehicle)} />
          <p className="mt-6 text-right font-display text-sm text-neutral-300 italic">{vehicle.blurb}</p>
          {select}
        </div>
      )}

      <div className="absolute bottom-8 left-[6vw] flex items-center gap-4 font-sans text-xs tracking-widest text-neutral-400 uppercase">
        <span className={keycap}>&uarr;&darr;</span>
        <span>Choose</span>
        {pages && (
          <>
            <span className={keycap}>&larr;&rarr;</span>
            <span>{showLoadout ? 'Weapon' : 'Vehicle'}</span>
          </>
        )}
        <span className={keycap}>Enter</span>
        <span>Select</span>
        <span className={keycap}>Esc</span>
        <span>Back</span>
      </div>
    </div>
  )
}

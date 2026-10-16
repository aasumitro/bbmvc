import { useState } from 'react'

const ENTRIES = [
  {
    version: '0.13.0',
    notes: [
      'A second machine in the garage: the Brute, an armoured hauler. 135 hull points to the Razor’s 100 and 2,200 kg; 85 km/h, 0–80 in 5.5 s and a 14.5 m turning circle, so slow off the line and wide in the turns, but a Rocket Pod needs four direct hits to wreck it. On Vehicle, ←→ change the machine; bots drive both',
      'The garage only picks: ←→ change the machine on Vehicle and the gun on Loadout, each kept as you change it. Back (or Esc) returns to the main menu, and Play takes your machine into the arena; Enter no longer leaves the garage, and the Select button is gone',
      'A third gun on Loadout: the Cannon. One heavy round a second, 40 damage each, four to a clip and a 2.5 s reload, out to 260 m with almost no spread: three rounds wreck a Razor, four a Brute. Bots carry it too, and a custom lobby can make it everyone’s one gun',
      'A third arena: The Docks, a container terminal at dusk. Lanes run between twelve blocks of containers, each with its own cover (stacks, a canyon of empties, reefer racks, a tank farm, customs, a stack fire, a forklift yard, a transit shed), and along the quay three ship-to-shore cranes, open below to drive under, stand over a moored ship. The crews start inside a gate at each end of the middle lane; in Free for All the hot zone moves between ten places. Both modes, in practice, Classic and custom lobbies',
      'A third machine in the garage: the Scout, a light raider. 70 hull points and 1,000 kg; 120 km/h, 0–80 in 3.0 s and a 10.3 m turning circle, the quickest off the line and the tightest in the turns, but three direct rockets or two Cannon rounds wreck it. Bots drive it too',
      'A fourth machine: the Buggy, a dune buggy. 85 hull points and 1,100 kg; 110 km/h, 0–80 in 3.4 s and an 11.6 m turning circle. Big tyres stand out on long-travel arms, the longest suspension in the garage, so it soaks up the rough ground and lands on its wheels; three direct rockets or three Cannon rounds wreck it, as they do a Razor. Bots drive it too',
      'A fourth gun on Loadout: the Shotgun. Eight pellets of 4 a shot, 72 shots a minute, six to a load and a 2.5 s reload, out to 45 m in a wide spread. Up close every pellet lands, 32 a shot: four shots wreck a Razor, three a Scout or a Buggy, five a Brute; further off more of them miss. Bots carry it too, and a custom lobby can make it everyone’s one gun',
      'A fifth gun on Loadout: the Laser, a beam. Held on a target it burns 40 a second, dead straight out to 120 m. Four seconds of fire overheat it and it can’t fire again until it has cooled, two seconds from hot; let go sooner and it cools as you wait. The weapon panel shows its heat. Bots carry it too, and a custom lobby can make it everyone’s one gun',
      'A sixth gun on Loadout: the Homing Missiles. Keep a rival under the crosshair for 0.8 s and the lock takes: the weapon panel’s bar fills, LOCKED shows, and every missile fired then turns after that machine, 70 m/s with a 3 m blast, 30 on a direct hit. Fired without a lock they fly straight. Four to a load and a 4 s reload, out to 200 m: three wreck a Scout or a Buggy, four a Razor, five a Brute. Bots lock on before they fire, and a custom lobby can make them everyone’s one gun',
      'A seventh gun on Loadout: the Mines. The trigger drops a mine a metre behind your tail; a second later its light blinks, armed, and the first rival to come within 5 m sets it off: that car takes the whole 80, which wrecks a Scout from full and leaves a Razor 20, and anything else within 7 m takes less. Three to a load and a 6 s reload; three of yours lie at once, each for 30 s. They never hurt you, and a teammate never sets one off. Bots cut across your path to lay them in your way, and steer round the mines they know of, on their routes and in a fight; a custom lobby can make them everyone’s one gun',
      'A fifth machine in the garage: the Rammer, a battering ram. 120 hull points and 1,800 kg; 95 km/h, 0–80 in 4.3 s and a 13.3 m turning circle. Its V-plough is a weapon, the first on any machine: drive it into a car and that car takes 2.5 hull points for every m/s you were closing on it, 66 flat out into a car standing still, more head-on. A scrape along your flank deals nothing, the same car is hit again only after a moment, and a wreck it causes is your kill. Bots drive it too, and charge you in it',
      'The Rocket Pod’s rockets hit for 34, not 38. Three direct hits still wreck a Razor or a Buggy and four a Brute or a Rammer; a Scout now takes three, not two',
    ],
  },
  {
    version: '0.12.0',
    notes: [
      'Custom lobbies, under the modes on the Arena screen: the list of public lobbies (search by lobby or host, filters for mode, arena and open slots, a lock on those with a password), Join by code, or Create lobby — public, with or without a password, or invite only',
      'The owner sets the match: mode, arena, 2 to 12 machines (1 v 1 to 6 v 6 in Team Deathmatch), 5 to 30 minutes, join in progress; under Advanced, respawn speed, friendly fire (a team kill costs the team a point, and a TK column shows who), pickups (in Team Deathmatch too), one gun for everyone, a kill limit',
      'Invite with the code or the link: it skips the password, and opened signed out it plays as a guest. No bots unless the owner adds them, at Easy, Normal or Hard; the owner also edits the settings, hands the lobby on, kicks (no way back in), or resets the code',
      'The waiting room: Ready up (Enter), change side in Team Deathmatch by clicking an open slot, talk in the lobby chat (T), which goes on into the match. The owner starts with two people or more, full or not; after the results everyone is back in the waiting room, and the tally counts the lobby’s wins',
      'In a lobby’s match, Back to lobby leaves the match but not the lobby, and Join match takes you back in when the lobby allows it; a minute without input does the same as Back to lobby. A dropped connection or a reload gets you back within 20 seconds, into your seat if the match is on',
      'Both arenas’ crew bases have six starts a side (four before): room for 6 v 6, and more places to respawn in Team Deathmatch',
    ],
  },
  {
    version: '0.11.0',
    notes: [
      'Chat in online matches: Enter talks to everyone, T to your team in Team Deathmatch (Tab switches while you type), /w name to whisper, /r to answer, /mute name to mute someone. While you type your car is left alone',
      'Online matches send about a third less data: the snapshots of the machines travel packed, not as text',
      'Every online match is kept on record for fair play — the result, each player’s statistics and signs of aim help — with a replay of it for 3 days. Chat isn’t stored',
      'Guest accounts are kept for 3 days, then deleted: create an account to keep your name',
      'The Arena screen lists Custom, coming soon; with Back chosen, the right side stays clear',
    ],
  },
  {
    version: '0.10.0',
    notes: [
      'Classic is matchmaking now: Find Match, and the game server finds you other players of the mode on the arena you picked and starts a match for you there — eight at once, four or more after 10 seconds, any two after 30 — or offers you a free seat in a match there that is less than half over',
      'Match found: 10 seconds to accept (Enter or Y) or decline (N), on any screen, with a sound. If too few accept, those who did go back to searching with their place kept',
      'Practise while you wait: Practice still starts on the Arena screen during a search, a line at the edge says the search is on, and the match found shows over the practice match; accepting takes you straight into the online match',
      'A new online match waits for everyone to load (Waiting for players) before the countdown, up to 20 seconds; someone slower drops in on their bot’s seat',
      'A search keeps going through a dropped connection or a reload, and moves with you to another tab',
    ],
  },
  {
    version: '0.9.0',
    notes: [
      'Classic puts you with the other players: you join the online room of your mode with the most people in it, on its arena; the arena you pick counts when nobody is playing',
      'Online, you can tell people from bots: the scoreboard marks bots Bot, the minimap rings the other players, the count under the clock says how many are in the room, and the feed says when someone joins or leaves',
      'The Arena screen works from the keyboard: Enter opens a mode, then ↑↓ move between the arena, the bots and Practice or Classic, ←→ change them, and Enter on Practice or Classic starts the match (B no longer changes the bots)',
    ],
  },
  {
    version: '0.8.0',
    notes: [
      'Classic is open on the Arena screen: an online match in the mode and arena you picked, with everyone who picked the same on the game server',
      "Up to eight machines a match: people take over bots' seats and Normal bots fill the rest; in Team Deathmatch you join the side with fewer people",
      "You play under your account's username, or as Guest and four characters; your garage gun comes with you",
      'The server decides every hit, wreck, respawn and score. Your own car runs ahead on your screen, so it answers the keys without waiting for it; the others move smoothly between its updates, and your Minigun rounds are judged against what you saw, up to 200 ms back',
      'The next match starts by itself 15 seconds after the results',
      'Esc opens the Match menu while the match goes on behind it; Leave match hands your machine to a bot',
      "A dropped connection says why, with the way back to the garage; if the game server can't be reached, Retry",
      "F3 shows the room, your ping and the arena's fingerprint",
    ],
  },
  {
    version: '0.7.0',
    notes: [
      'Bot difficulty on the Arena screen: Easy, Normal or Hard (B cycles it). Easy is the old bots; harder bots aim faster, lead moving cars and hit harder',
      'Bots carry either gun: each draws a Minigun or a Rocket Pod, and rocket bots hold off, lead their shots and fire only when lined up',
      'Bots fight on the move: no more parking in narrow streets, they weave at their range, vary their circles and swerve when hit',
      'From Normal up, bots take cover when hurt or reloading and lie in wait for rivals coming their way, opening fire the moment you show',
      'Stuck on a wreck pile or tipped over? Press R to get back on the nearest road; any machine stuck for four seconds is put back by itself',
      'Bots back out of tight spots toward open ground',
    ],
  },
  {
    version: '0.6.0',
    notes: [
      'Training is gone: Team Deathmatch and Free for All are the modes, and both run in either arena',
      "The Scrapyard rebuilt at the City's size for eight machines: the old yard and its Crest at the heart, eight haul roads walled in wrecks out to the gates and the work sheds, a middle track and a perimeter road all the way round",
      'Eight new yards between the roads, each a Free for All hot zone: Crane Yard, The Stacks, Tank Farm, Tyre Fire, Crash Site, Bus Graveyard, Scrap Mountain, The Crusher',
      'Team Deathmatch in the Scrapyard: the crews line up on the north and south gate aprons',
      'New Arena screen: pick the arena on its card, then Practice against bots; Classic online matches are on the way',
    ],
  },
  {
    version: '0.5.0',
    notes: [
      'Team Deathmatch reworked: 4 vs 4, ten minutes, no kill limit — every wreck scores for your team and the team with more at the buzzer wins; a tie goes to overtime, next kill wins',
      'Everyone respawns on the same timer (5 to 20 seconds as the match runs); two seconds of spawn protection that ends the moment you fire',
      'Respawns pick a safe start for your team — bases or the perimeter road, away from enemy sights and fresh wrecks — so a camped base stops being a trap',
      'Bots play as a team: they come to the help of a teammate under fire, finish damaged enemies, pick off stragglers, flank groups and regroup when behind',
      'Assists, streaks, multi-kills, revenge and a combat score in Team Deathmatch; the MVP is the best combat score, on either team',
      'Team score up top, a kill feed in team colours, a team scoreboard, and a results screen with the MVP and both rosters',
    ],
  },
  {
    version: '0.4.0',
    notes: [
      'Free for All reworked: ten minutes, most wrecks wins; a tie at the buzzer goes to overtime, first kill wins',
      'Respawn waits grow as the match runs (5 to 20 seconds), two seconds of spawn protection, safer spawn picks that avoid camped starts',
      'Pickups every two minutes: health, repair, ammo, speed boost, armor and damage boost, in common, rare and epic',
      'Hot zones move around the city with extra pickups; machines far behind the leader find a little more help nearby',
      'Assists, kill streaks, multi-kills, revenge and nemeses, a combat score, a live leaderboard and kill feed',
      'Results screen with your placing, record and the final standings; bots chase pickups, work the hot zone and gang up on the leader',
      'Hold Tab for the scoreboard in every mode: places, kills and deaths, plus assists, streaks, damage and score in Free for All',
      'Settings in tabs (Graphics, Camera, Sound, Controls); the key list moved into Settings',
      'Driving on W A S D only; the arrow keys are for menus',
      'Leaving a match in progress asks first; Restart match is Training only',
      'New results screen for every mode: your placing, record and the final standings, with the HUD cleared away',
    ],
  },
  {
    version: '0.3.0',
    notes: [
      'New arena: The City — a burning downtown about five times the size of the Scrapyard, built for eight machines',
      'Team Deathmatch (4 vs 4) and Free for All (8 machines) playable against bots in The City; bots crew every seat until online play lands',
      'Training runs in either arena; the Scrapyard stays a training ground',
      'Buildings with lit rooms behind the glass, fire escapes, water tanks, neon signs and billboards; cycling traffic signals, street lamps, wet streets, steam, fires and smoke columns',
      'Bots plan routes through the streets, keep to their lane, brake for corners and fight each other',
      'HUD: crew and kill scores, crewmates in blue, markers only over machines in sight',
    ],
  },
  {
    version: '0.2.0',
    notes: [
      'First playable match: you against three bots in the Scrapyard',
      'Physics driving, chase camera, roof minigun',
      'Combat HUD: compass, minimap, speed, health, ammo',
      'Arena modes: Training against bots; Team Deathmatch and Free for All coming soon',
      'Synthesized sound: engines, gunfire, impacts, explosions, skids, fire, wind',
    ],
  },
  {
    version: '0.1.0',
    notes: ['Procedural scrapyard arena', 'Procedural combat vehicle', 'Garage screen', 'Main menu'],
  },
]

export const LATEST_VERSION = ENTRIES[0].version // on the main menu's corner button

// Accordion: the latest release starts open, one open at a time; each
// panel slides open and shut (grid rows 0fr <-> 1fr) and fades.
export function PatchNotesPanel() {
  const [open, setOpen] = useState(ENTRIES[0].version)
  return (
    <div className="flex flex-col border-t border-white/10">
      {ENTRIES.map((entry, i) => {
        const expanded = entry.version === open
        return (
          <div key={entry.version} className="border-b border-white/10">
            <button
              aria-expanded={expanded}
              aria-controls={`notes-${entry.version}`}
              onClick={() => setOpen(expanded ? '' : entry.version)}
              className="flex w-full items-center justify-between py-4 text-left"
            >
              <span className={`flex items-center gap-3 text-xs font-bold tracking-[0.2em] uppercase ${expanded ? 'text-red-400' : 'text-red-400/80'}`}>
                v{entry.version}
                {i === 0 && <span className="rounded border border-red-500/50 px-1.5 py-0.5 text-[0.6rem] tracking-[0.15em] text-red-300">Latest</span>}
              </span>
              <svg
                viewBox="0 0 10 10"
                className={`h-2.5 w-2.5 fill-none stroke-neutral-500 transition-transform duration-300 ${expanded ? 'rotate-90' : ''}`}
                strokeWidth="1.5"
              >
                <path d="M3 1l4 4-4 4" />
              </svg>
            </button>
            <div
              id={`notes-${entry.version}`}
              inert={!expanded}
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className="overflow-hidden">
                <ul className="list-disc pb-5 pl-4 text-sm text-neutral-300">
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

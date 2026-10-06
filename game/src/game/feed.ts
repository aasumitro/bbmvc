import * as THREE from 'three'
import { playSound } from './audio'
import type { Feed, ModeRules, ModeTiming } from './mode'
import { chainTitle } from './scoring'
import type { Feedback } from './view'

// The kill feed, the callouts and the announcer, as the local player hears
// and reads them. The running mode reports its rules' events in here
// (MatchMode.report); the HUD draws the lines and the callout.

const FEED_LENGTH = 5 // lines kept

// A feed line: who wrecked whom, or news (overtime, supply drops, the hot zone).
export interface FeedLine {
  who: string // the killer, or the wreck in a death line; '' for news
  text: string // 'wrecked', 'was wrecked', or the news
  whom: string // the victim; ''
  teams: [number, number] // who's and whom's teams, for team colours; -1: none
  tag: string // REVENGE, TRIPLE KILL, ...
  mine: boolean // the player is in it
  time: number // match clock
}

// `names`: every machine by id; `me`: the local player's; `now`: the match
// clock; callouts and pickups go to the HUD's `feedback`.
export function createFeed(names: readonly { name: string; team: number }[], me: number, now: () => number, feedback: Feedback) {
  const lines: FeedLine[] = [] // newest last
  const heard = new THREE.Vector3()
  let countdown = 0 // the last countdown second ticked
  const name = (id: number) => (id === me ? 'you' : names[id].name)

  function post(line: Partial<FeedLine> & { text: string }) {
    lines.push({ who: '', whom: '', teams: [-1, -1], tag: '', mine: false, ...line, time: now() })
    if (lines.length > FEED_LENGTH) lines.shift()
  }

  function callout(text: string, loud = true) {
    feedback.message = text
    feedback.messageTime = 2.5
    if (loud) playSound('announce')
  }

  const feed: Feed = {
    me,
    name,
    kill({ killer, victim, assists, multi, milestone, revenge, shutdown }, titles, teams) {
      const tags = [revenge ? 'Revenge' : '', chainTitle(multi, titles), milestone, shutdown ? 'Shutdown' : ''].filter(Boolean)
      const mine = killer === me
      post({ who: mine ? 'You' : names[killer].name, text: 'wrecked', whom: name(victim), teams: teams ? [names[killer].team, names[victim].team] : [-1, -1], tag: tags.slice(0, 2).join(' · '), mine: mine || victim === me })
      if (mine && tags.length) callout(tags.join(' · '))
      else if (assists.includes(me)) callout('Assist', false)
    },
    teamKill(killer, victim) {
      const mine = killer === me
      post({ who: mine ? 'You' : names[killer].name, text: 'wrecked', whom: name(victim), teams: [names[killer].team, names[victim].team], tag: 'Team kill', mine: mine || victim === me })
    },
    death(victim, teams) {
      const mine = victim === me
      post({ who: mine ? 'You' : names[victim].name, text: mine ? 'were wrecked' : 'was wrecked', teams: [teams ? names[victim].team : -1, -1], mine })
    },
    phase(phase) {
      if (phase === 'active') callout('Go')
      if (phase === 'finalMinute') {
        post({ text: 'Final minute' })
        playSound('announce')
      }
      if (phase === 'overtime') {
        post({ text: 'Overtime', tag: 'First kill wins' })
        playSound('announce')
      }
    },
    news(text, tag = '') {
      post({ text, tag })
    },
    callout,
    pickup(who, x, z, label, color) {
      if (who !== me) return playSound('pickup', heard.set(x, 1, z), 0.6)
      feedback.pickup = `+ ${label}`
      feedback.pickupColor = color
      feedback.pickupTime = 2
      playSound('pickup')
    },
  }

  return {
    ...feed,
    lines,
    // A tick for each second counted down: on the grid, and at the end of the clock.
    beep(rules: ModeRules, timing: ModeTiming) {
      const final = (rules.phase === 'active' || rules.phase === 'finalMinute') && rules.remaining() <= timing.finalCountdown
      const left = rules.phase === 'preMatch' ? Math.ceil(timing.preMatch - rules.now) : final ? Math.ceil(rules.remaining()) : 0
      if (left > 0 && left !== countdown) playSound('tick')
      countdown = left
    },
    clear() {
      lines.length = 0
      countdown = 0
    },
  }
}

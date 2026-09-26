// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const MEETDOM_PATH = resolve(process.cwd(), 'scripts/meet-dom.js')

/**
 * meet-dom.js is the only file allowed to know what Meet's markup looks like.
 *
 * The point of these tests is not that it works against today's DOM - the e2e
 * suite covers that. It is that each layer carries the extension ON ITS OWN, so
 * the next time Google renames a class, reworks a label or ships a rebuild,
 * something else still answers.
 *
 * Each test therefore removes signals rather than adding them.
 */

/** Builds an in-call DOM, optionally stripping signals to simulate a rebuild. */
function build({ icons = true, shortcuts = true, labels = 'en', jsname = true } = {}) {
  const TEXT = {
    en: { mic: 'Turn off microphone', cam: 'Turn off camera', leave: 'Leave call', cc: 'Turn on captions' },
    de: { mic: 'Mikrofon ausschalten', cam: 'Kamera ausschalten', leave: 'Anruf verlassen', cc: 'Untertitel einschalten' },
    ja: { mic: 'マイクをオフにする', cam: 'カメラをオフにする', leave: '通話を退出', cc: '字幕をオンにする' },
    none: { mic: '', cam: '', leave: '', cc: '' }
  }[labels]

  const button = (id, icon, text, shortcut, js) => {
    const b = document.createElement('button')
    b.id = id
    if (icons && icon) {
      const i = document.createElement('i')
      i.className = 'google-symbols notranslate'
      i.textContent = icon
      b.appendChild(i)
    }
    const label = [text, shortcuts && shortcut ? `(${shortcut})` : ''].filter(Boolean).join(' ')
    if (label) b.setAttribute('aria-label', label)
    if (jsname && js) b.setAttribute('jsname', js)
    return b
  }

  document.body.innerHTML = ''
  document.body.append(
    button('mic', 'mic', TEXT.mic, 'ctrl + d', 'hw0c9'),
    button('cam', 'videocam', TEXT.cam, 'ctrl + e', 'psRWwc'),
    button('cc', 'closed_caption_off', TEXT.cc, null, 'RrG0hf'),
    button('jump', 'arrow_downward', 'Jump to most recent captions', null, null),
    button('leave', 'call_end', TEXT.leave, null, 'CQylAd')
  )
}

let MeetDom
beforeEach(() => {
  new Function(readFileSync(MEETDOM_PATH, 'utf8'))()
  MeetDom = globalThis.MeetDom
})

describe('each layer carries the lookup on its own', () => {
  it('uses the icon ligature when every other signal is gone', () => {
    // A rebuild that renames jsname and rewords every label.
    build({ shortcuts: false, labels: 'none', jsname: false })

    expect(MeetDom.micButton()?.id).toBe('mic')
    expect(MeetDom.cameraButton()?.id).toBe('cam')
    expect(MeetDom.leaveButton()?.id).toBe('leave')
    expect(MeetDom.captionsButton()?.id).toBe('cc')
    expect(MeetDom.health().micButton.strategy).toBe('icon')
  })

  it('falls back to the keyboard shortcut when the icons change', () => {
    build({ icons: false, labels: 'none', jsname: false })

    expect(MeetDom.micButton()?.id).toBe('mic')
    expect(MeetDom.cameraButton()?.id).toBe('cam')
    expect(MeetDom.health().micButton.strategy).toBe('shortcut')
  })

  it('falls back to the accessible name when icons and shortcuts are gone', () => {
    build({ icons: false, shortcuts: false, jsname: false })

    expect(MeetDom.micButton()?.id).toBe('mic')
    expect(MeetDom.leaveButton()?.id).toBe('leave')
    expect(MeetDom.health().micButton.strategy).toBe('label')
  })

  it('falls back to jsname when nothing else is left', () => {
    build({ icons: false, shortcuts: false, labels: 'none' })

    expect(MeetDom.micButton()?.id).toBe('mic')
    expect(MeetDom.captionsButton()?.id).toBe('cc')
    expect(MeetDom.health().micButton.strategy).toBe('jsname')
  })
})

describe('languages other than English', () => {
  it.each(['de', 'ja'])('works in %s with no icons or shortcuts', locale => {
    build({ icons: false, shortcuts: false, labels: locale, jsname: false })

    expect(MeetDom.micButton()?.id, 'microphone').toBe('mic')
    expect(MeetDom.cameraButton()?.id, 'camera').toBe('cam')
    expect(MeetDom.leaveButton()?.id, 'leave').toBe('leave')
  })

  it.each(['de', 'ja'])('works in %s from the icon alone', locale => {
    build({ shortcuts: false, labels: locale, jsname: false })

    expect(MeetDom.micButton()?.id).toBe('mic')
    expect(MeetDom.health().micButton.strategy).toBe('icon')
  })
})

describe('reading state', () => {
  it('reads mute state from the icon, not the label', () => {
    build()
    expect(MeetDom.micOn()).toBe(true)

    document.querySelector('#mic i').textContent = 'mic_off'
    expect(MeetDom.micOn()).toBe(false)
  })

  it('reads state from data-is-muted when there is no icon', () => {
    build({ icons: false, labels: 'none' })
    document.getElementById('mic').setAttribute('data-is-muted', 'true')
    expect(MeetDom.micOn()).toBe(false)

    document.getElementById('mic').setAttribute('data-is-muted', 'false')
    expect(MeetDom.micOn()).toBe(true)
  })

  it('reads state from aria-pressed when there is no icon', () => {
    build({ icons: false, labels: 'none' })
    document.getElementById('cam').setAttribute('aria-pressed', 'false')
    expect(MeetDom.cameraOn()).toBe(false)
  })

  it('says it cannot tell rather than guessing', () => {
    build({ icons: false, shortcuts: false, labels: 'none' })
    expect(MeetDom.micOn()).toBeNull()
  })
})

describe('captions', () => {
  it('never mistakes "Jump to most recent captions" for the toggle', () => {
    build({ icons: false, jsname: false })
    expect(MeetDom.captionsButton()?.id).toBe('cc')
  })

  it('reads whether captions are showing from the icon', () => {
    build()
    expect(MeetDom.captionsOn()).toBe(false)

    document.querySelector('#cc i').textContent = 'closed_caption'
    document.getElementById('cc').setAttribute('aria-label', 'Turn off captions')
    expect(MeetDom.captionsOn()).toBe(true)
  })
})

describe('caption blocks with unknown class names', () => {
  /** A caption block whose classes have all been renamed by a rebuild. */
  function captions(entries) {
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', 'Captions')

    for (const [user, text] of entries) {
      const block = document.createElement('div')
      block.className = 'zzTotallyNewClass'
      const head = document.createElement('div')
      const img = document.createElement('img')
      img.src = `https://lh3.googleusercontent.com/mm/${user}`
      const name = document.createElement('span')
      name.textContent = user
      head.append(img, name)
      const body = document.createElement('div')
      body.textContent = text
      block.append(head, body)
      region.appendChild(block)
    }

    document.body.appendChild(region)
    return region
  }

  it('finds the container without jsname or a matching class', () => {
    build({ jsname: false })
    captions([['Alpha', 'hello everyone']])

    const container = MeetDom.captionsContainer()
    expect(container).not.toBeNull()
    expect(MeetDom.health().captionsContainer.strategy).toBe('role')
  })

  it('reads speaker and text from the block structure', () => {
    build()
    const region = captions([['Alpha', 'the quick brown fox jumps over the lazy dog']])
    const block = MeetDom.captionBlocks(region)[0]

    expect(MeetDom.readCaptionBlock(block)).toMatchObject({
      user: 'Alpha',
      text: 'the quick brown fox jumps over the lazy dog'
    })
    expect(MeetDom.health().captionBlock.strategy).toBe('structure')
  })

  it('still prefers Meet\'s class names while they last', () => {
    build()
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', 'Captions')
    region.innerHTML = `
      <div class="nMcdL">
        <div class="adE6rb"><img src="a"><div class="KcIKyf"><span class="NWpY1d">Bravo</span></div></div>
        <div class="ygicle VbkSUe">pack my box</div>
      </div>`
    document.body.appendChild(region)

    const block = MeetDom.captionBlocks(region)[0]
    expect(MeetDom.readCaptionBlock(block)).toMatchObject({ user: 'Bravo', text: 'pack my box' })
    expect(MeetDom.health().captionBlock.strategy).toBe('class')
  })

  it('walks up from a mutated text node to the block that owns it', () => {
    build()
    const region = captions([['Alpha', 'hello there']])
    const textNode = region.querySelector('div > div:last-child').firstChild

    const block = MeetDom.captionBlockOf(textNode, region)
    expect(block).not.toBeNull()
    expect(MeetDom.readCaptionBlock(block).user).toBe('Alpha')
  })
})

describe('reporting rot instead of failing quietly', () => {
  it('names the targets it could not find', () => {
    document.body.innerHTML = ''       // nothing resembling Meet at all

    MeetDom.micButton()
    MeetDom.cameraButton()
    MeetDom.leaveButton()

    expect(MeetDom.broken().sort()).toEqual(['cameraButton', 'leaveButton', 'micButton'])
  })

  it('reports nothing broken once the controls are there', () => {
    build()
    MeetDom.micButton()
    MeetDom.cameraButton()
    MeetDom.leaveButton()

    expect(MeetDom.broken()).toEqual([])
  })

  it('records which strategy answered, so rot is visible before it bites', () => {
    build({ icons: false, shortcuts: false, jsname: false })
    MeetDom.micButton()

    // Down to the last layer for this target: worth surfacing.
    expect(MeetDom.health().micButton).toMatchObject({ strategy: 'label' })
  })
})

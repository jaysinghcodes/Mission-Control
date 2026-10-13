/**
 * The app shell fills the viewport. No desk backdrop, no outer radius,
 * no outer shadow, and the document itself does not scroll.
 */

const DESK = new Set(['rgb(42, 44, 49)', 'rgb(223, 227, 234)'])

function near(a, b) {
  return Math.abs(a - b) <= 1
}

export async function assertFullBleed(page) {
  const box = await page.locator('.mc-window').evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const root = document.documentElement
    const sidebar = document.querySelector('#app-sidebar')
    const side = sidebar ? sidebar.getBoundingClientRect() : null
    return {
      x: rect.x,
      y: rect.y,
      right: rect.right,
      bottom: rect.bottom,
      radius: style.borderRadius,
      shadow: style.boxShadow,
      borderTop: style.borderTopWidth,
      body: getComputedStyle(document.body).backgroundColor,
      vw: window.innerWidth,
      vh: window.innerHeight,
      scrollW: root.scrollWidth,
      scrollH: root.scrollHeight,
      clientW: root.clientWidth,
      clientH: root.clientHeight,
      sideX: side ? side.x : null,
      sideY: side ? side.y : null,
      sideBottom: side ? side.bottom : null,
    }
  })
  if (!near(box.x, 0) || !near(box.y, 0)) {
    throw new Error(`Shell is not flush with the viewport origin (${box.x}, ${box.y}).`)
  }
  if (!near(box.right, box.vw) || !near(box.bottom, box.vh)) {
    throw new Error(`Shell does not fill the viewport (${box.right}x${box.bottom} vs ${box.vw}x${box.vh}).`)
  }
  if (box.radius !== '0px') throw new Error(`Shell still has a rounded frame (${box.radius}).`)
  if (box.shadow !== 'none') throw new Error(`Shell still has an outer shadow (${box.shadow}).`)
  if (box.borderTop !== '0px') throw new Error(`Shell still has an outer border (${box.borderTop}).`)
  if (DESK.has(box.body)) throw new Error(`The page backdrop is still the desk color (${box.body}).`)
  if (box.scrollW > box.clientW + 1 || box.scrollH > box.clientH + 1) {
    throw new Error(`The page scrolls (${box.scrollW}x${box.scrollH} vs ${box.clientW}x${box.clientH}).`)
  }
  if (box.sideX === null || !near(box.sideX, 0) || !near(box.sideY, 0) || !near(box.sideBottom, box.vh)) {
    throw new Error(`The sidebar does not fill the screen edge (${box.sideX}, ${box.sideY}, ${box.sideBottom}).`)
  }
}

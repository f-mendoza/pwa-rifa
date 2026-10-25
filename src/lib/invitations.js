/** Link que se comparte para sumarse a una rifa (ver la ruta `/invitacion/:token`). */
export function invitationLink(token, origin = globalThis.location?.origin ?? '') {
  return `${origin}/invitacion/${token}`
}

export function invitationMessage(title, role, link) {
  const what = role === 'seller' ? 'para vender números' : 'para que veas cómo va'
  return `Te invito a la rifa «${title}» ${what}. Entrá desde este link (sirve para una sola persona): ${link}`
}

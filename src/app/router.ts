// Hash 路由：视图切换与参数传递
export type RouteName =
  | 'gallery'
  | 'analysis'
  | 'editor'
  | 'materials'
  | 'simulation'
  | 'carving'

export interface Route {
  name: RouteName
  artworkId?: string
}

export const parseHash = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, '')
  const [name, query] = raw.split('?')
  const route: Route = { name: (name || 'gallery') as RouteName }
  if (query) {
    const params = new URLSearchParams(query)
    const id = params.get('artworkId')
    if (id) route.artworkId = id
  }
  return route
}

export const buildHash = (name: RouteName, artworkId?: string): string => {
  const qs = artworkId ? `?artworkId=${encodeURIComponent(artworkId)}` : ''
  return `#/${name}${qs}`
}

export const navigate = (name: RouteName, artworkId?: string): void => {
  window.location.hash = buildHash(name, artworkId)
}

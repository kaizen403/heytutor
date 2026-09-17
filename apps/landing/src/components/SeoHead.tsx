import { useEffect } from 'react'
import {
  canonicalUrl,
  jsonLdGraph,
  pageByPath,
  type SeoPage,
} from '../lib/seo'

function setNamedMeta(name: string, content: string) {
  let el = document.head.querySelector(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setPropertyMeta(property: string, content: string) {
  let el = document.head.querySelector(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(href: string) {
  let el = document.head.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function setJsonLd(page: SeoPage) {
  let el = document.getElementById('seo-jsonld')
  if (!el) {
    el = document.createElement('script')
    el.id = 'seo-jsonld'
    el.setAttribute('type', 'application/ld+json')
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(jsonLdGraph(page))
}

export default function SeoHead({ path }: { path: string }) {
  useEffect(() => {
    const page = pageByPath(path)
    if (!page) return
    const url = canonicalUrl(page.path)
    document.title = page.title
    setNamedMeta('description', page.description)
    setCanonical(url)
    setPropertyMeta('og:url', url)
    setPropertyMeta('og:title', page.title)
    setPropertyMeta('og:description', page.description)
    setNamedMeta('twitter:title', page.title)
    setNamedMeta('twitter:description', page.description)
    setJsonLd(page)
    if (page.kind !== 'home') window.scrollTo(0, 0)
  }, [path])

  return null
}

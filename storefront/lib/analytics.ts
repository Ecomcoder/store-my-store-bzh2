import { hasAnalyticsConsent } from '@/lib/cookie-consent'

const HEARTBEAT_INTERVAL = 15000 // 15 seconds
const FLUSH_INTERVAL = 10000 // 10 seconds
const MAX_BATCH_SIZE = 20
const SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutes

const SESSION_ID_KEY = 'amboras_session_id'
const LAST_ACTIVITY_KEY = 'amboras_last_activity'

interface AnalyticsEvent {
  type: 'session_start' | 'page_view' | 'heartbeat' | 'session_end'
  url?: string
  referrer?: string
  title?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  timestamp: number
}

interface AnalyticsPayload {
  store_id: string
  session_id: string
  events: AnalyticsEvent[]
}

class AnalyticsTracker {
  private sessionId: string | null = null
  private storeId: string
  private endpoint: string
  private eventQueue: AnalyticsEvent[] = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private isInitialized = false

  private handleVisibilityChange: () => void
  private handlePageHide: () => void

  constructor() {
    this.storeId = process.env.NEXT_PUBLIC_STORE_ID || ''
    this.endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT || ''

    this.handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        this.pushEvent({ type: 'session_end', url: window.location.pathname, timestamp: Date.now() })
        this.flushBeacon()
        this.stopHeartbeat()
      } else {
        if (this.isSessionExpired()) {
          this.startNewSession()
        } else {
          this.startHeartbeat()
        }
      }
    }

    this.handlePageHide = () => {
      this.pushEvent({ type: 'session_end', url: window.location.pathname, timestamp: Date.now() })
      this.flushBeacon()
    }
  }

  init(): void {
    console.log('[Analytics] init called', { storeId: this.storeId, endpoint: this.endpoint, isInitialized: this.isInitialized, consent: hasAnalyticsConsent() })
    if (this.isInitialized) { console.log('[Analytics] Already initialized'); return }
    if (!this.storeId || !this.endpoint) { console.log('[Analytics] SKIPPED: missing storeId or endpoint'); return }
    if (!hasAnalyticsConsent()) { console.log('[Analytics] SKIPPED: no consent'); return }

    console.log('[Analytics] INITIALIZED - tracking started')
    this.isInitialized = true
    this.startNewSession()

    document.addEventListener('visibilitychange', this.handleVisibilityChange)
    window.addEventListener('pagehide', this.handlePageHide)
  }

  private startNewSession(): void {
    this.sessionId = this.getOrCreateSession()

    const utm = this.getUTMParams()
    this.pushEvent({
      type: 'session_start',
      url: window.location.pathname,
      referrer: document.referrer || undefined,
      title: document.title || undefined,
      ...utm,
      timestamp: Date.now(),
    })

    // Fire immediate heartbeat so user shows as "live" right away, then flush it
    this.pushEvent({ type: 'heartbeat', url: window.location.pathname, timestamp: Date.now() })
    this.flush()
    this.startHeartbeat()
    this.startFlushTimer()
  }

  trackPageView(url: string, title?: string): void {
    if (!this.isInitialized) return

    this.pushEvent({
      type: 'page_view',
      url,
      title,
      timestamp: Date.now(),
    })

    this.updateLastActivity()
  }

  private pushEvent(event: AnalyticsEvent): void {
    this.eventQueue.push(event)
    if (this.eventQueue.length >= MAX_BATCH_SIZE) {
      this.flush()
    }
  }

  private flush(): void {
    if (this.eventQueue.length === 0 || !this.sessionId) return

    const payload: AnalyticsPayload = {
      store_id: this.storeId,
      session_id: this.sessionId,
      events: [...this.eventQueue],
    }
    this.eventQueue = []

    console.log('[Analytics] Flushing', payload.events.length, 'events to', `${this.endpoint}/events`)
    fetch(`${this.endpoint}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(r => {
      console.log('[Analytics] Flush response:', r.status)
    }).catch((err) => {
      console.error('[Analytics] Flush FAILED:', err.message)
    })
  }

  private flushBeacon(): void {
    if (this.eventQueue.length === 0 || !this.sessionId) return

    const payload: AnalyticsPayload = {
      store_id: this.storeId,
      session_id: this.sessionId,
      events: [...this.eventQueue],
    }
    this.eventQueue = []

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    navigator.sendBeacon(`${this.endpoint}/events`, blob)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.pushEvent({
          type: 'heartbeat',
          url: window.location.pathname,
          timestamp: Date.now(),
        })
        this.updateLastActivity()
      }
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startFlushTimer(): void {
    this.stopFlushTimer()
    this.flushTimer = setInterval(() => {
      this.flush()
    }, FLUSH_INTERVAL)
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private getOrCreateSession(): string {
    const existingId = sessionStorage.getItem(SESSION_ID_KEY)
    const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY)

    if (existingId && lastActivity && !this.isSessionExpired()) {
      return existingId
    }

    const newId = crypto.randomUUID()
    sessionStorage.setItem(SESSION_ID_KEY, newId)
    this.updateLastActivity()
    return newId
  }

  private isSessionExpired(): boolean {
    const lastActivity = sessionStorage.getItem(LAST_ACTIVITY_KEY)
    if (!lastActivity) return true
    return Date.now() - parseInt(lastActivity, 10) > SESSION_TIMEOUT
  }

  private updateLastActivity(): void {
    sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString())
  }

  private getUTMParams(): { utm_source?: string; utm_medium?: string; utm_campaign?: string } {
    const params = new URLSearchParams(window.location.search)
    const result: { utm_source?: string; utm_medium?: string; utm_campaign?: string } = {}

    const source = params.get('utm_source')
    const medium = params.get('utm_medium')
    const campaign = params.get('utm_campaign')

    if (source) result.utm_source = source
    if (medium) result.utm_medium = medium
    if (campaign) result.utm_campaign = campaign

    return result
  }

  destroy(): void {
    this.stopHeartbeat()
    this.stopFlushTimer()
    this.flushBeacon()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    window.removeEventListener('pagehide', this.handlePageHide)
    this.isInitialized = false
  }
}

let tracker: AnalyticsTracker | null = null

export function initAnalytics(): void {
  if (typeof window === 'undefined') return
  if (!tracker) tracker = new AnalyticsTracker()
  tracker.init()
}

export function trackPageView(url: string, title?: string): void {
  tracker?.trackPageView(url, title)
}

export function destroyAnalytics(): void {
  tracker?.destroy()
  tracker = null
}

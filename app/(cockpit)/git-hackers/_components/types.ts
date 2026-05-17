// Shared types for git-hackers cockpit page.
// Kept in a pure-type file with zero runtime imports — no server-only code (F11).

export interface GitHubRepo {
  full_name: string
  description: string | null
  stargazers_count: number
  language: string | null
  html_url: string
  topics: string[]
}

export interface HNPost {
  objectID: string
  author: string
  comment_text: string
  created_at: string
  story_id: string
}

export interface GitHubTrendingResponse {
  repos: GitHubRepo[]
  stale: boolean
  error: string | null
}

export interface HNHiringResponse {
  posts: HNPost[]
  thread_title: string | null
  thread_date: string | null
  error: string | null
}

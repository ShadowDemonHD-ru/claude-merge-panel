// An open pull request as the pane shows it
export type Pr = {
  repo: string // owner/name
  number: number
  title: string
  url: string
  isDraft: boolean
  ci: 'passing' | 'failing' | 'pending' | 'none'
  canMerge: boolean // GitHub reports it merges without conflicts
}

// What is happening now: the PR being merged, the last result line, when the list was synced and for whom
export type Activity = { merging: string | null; note: string; syncedAt: number; owners: string[] }

declare module 'claude-code' {
  interface PluginState {
    'merge-panel': { prs: Pr[]; activity: Activity }
  }
}

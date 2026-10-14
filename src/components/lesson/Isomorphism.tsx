/**
 * OS ≡ LLM isomorphism panel (lesson.md §2.8). Moved out of blocks.tsx unchanged (wave-3.md §2.3) so P3's
 * active version (3b-07: align, name the break, then the principle) lands here without touching the dispatcher.
 */

import { ArrowLeftRight } from 'lucide-react'
import type { IsomorphismBlock } from '@/data/lessons/types'

export function IsomorphismView({ block }: { block: IsomorphismBlock }) {
  return (
    <div className="my-8 rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-4 flex items-center gap-2 font-mono text-label uppercase text-text-3">
        <ArrowLeftRight size={14} className="text-text-3" />
        {block.title ?? 'the same idea, twice'}
      </div>
      <div className="space-y-3">
        {block.pairs.map((p, i) => (
          <div key={i}>
            <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <div className="min-w-0 break-words rounded-md border border-[#22D3EE]/30 bg-[#22D3EE]/5 p-3.5">
                <div className="font-mono text-body-sm font-medium text-[#22D3EE]">{p.os}</div>
                <div className="mt-1 text-body-sm text-text-2">{p.osLine}</div>
              </div>
              <div className="flex items-center justify-center font-mono text-h4 text-text-3">≡</div>
              <div className="min-w-0 break-words rounded-md border border-[#FB7185]/30 bg-[#FB7185]/5 p-3.5">
                <div className="font-mono text-body-sm font-medium text-[#FB7185]">{p.llm}</div>
                <div className="mt-1 text-body-sm text-text-2">{p.llmLine}</div>
              </div>
            </div>
            {p.breaks && (
              <p className="mt-1.5 border-l-2 border-line-bright pl-3 text-[13px] leading-snug text-text-3">
                <span className="mr-1.5 font-mono text-[10px] uppercase">where it breaks:</span>
                {p.breaks}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

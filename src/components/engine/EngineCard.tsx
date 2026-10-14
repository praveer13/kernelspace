/**
 * "Your engine" on /progress (docs/specs/wave-2.md §10.4, §2.3): the schematic of the eight slots, which of them
 * are your own modules, and where to fill the rest. Reads the installed modules from the Fleet's slot store, so
 * what /progress shows is what /fleet runs. It takes no props, so Progress mounts it as it did the stub.
 */
import { Link } from 'react-router'
import { useSlots } from '@/pages/fleet/slots'
import EngineSchematic, { ownCount, schematicBoxes } from './EngineSchematic'

export type EngineCardProps = Record<string, never>

export default function EngineCard() {
  const installed = useSlots((s) => s.installed)
  const own = ownCount(schematicBoxes(installed))
  return (
    <section aria-labelledby="engine-card-title" className="mt-14">
      <h2 id="engine-card-title" className="font-display text-h3 text-text-1">
        your engine
      </h2>
      <p className="mt-2 max-w-2xl text-body-sm text-text-2">
        {own === 0
          ? 'Every box is still the reference. Pass a lab on fresh seeds in the Forge, then install it from the lab page.'
          : 'Modules you installed from the Forge run in the Fleet, and they stay on this device until you remove them.'}{' '}
        <Link to="/fleet" className="text-accent underline underline-offset-2">
          Open the Fleet
        </Link>
        .
      </p>
      <div className="mt-5 rounded-lg border border-line bg-surface-1 p-5">
        <EngineSchematic installed={installed} />
      </div>
    </section>
  )
}

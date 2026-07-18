import { Link, useParams } from 'react-router-dom';
import { HOME_TILE_KEYS, type HomeTileKey } from '../home/tiles';

/**
 * A tile is a door; in Phase 1 most rooms are not built yet. This is an honest placeholder for
 * a module route so a tile never leads to a broken page. The copy states the situation plainly
 * (frontend rules: never apologise, never blame the network) and offers the way back.
 */
function isTileKey(value: string | undefined): value is HomeTileKey {
  return value !== undefined && (HOME_TILE_KEYS as readonly string[]).includes(value);
}

export function ModulePlaceholder() {
  const { module } = useParams();
  const known = isTileKey(module);
  const title = known ? module.charAt(0).toUpperCase() + module.slice(1) : 'Not found';

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-2 font-ui text-h1 text-soil-900">{title}</h1>
      <p className="mb-4 text-body text-soil-700">
        {known ? 'This part of the farm arrives in a later phase.' : 'There is nothing here.'}
      </p>
      <Link to="/" className="text-body text-dam-700">
        Back to home
      </Link>
    </section>
  );
}

import frlg from '../assets/game-emblems/frlg.svg';
import frlgCompact from '../assets/game-emblems/frlg-compact.svg';
import bdsp from '../assets/game-emblems/bdsp.svg';
import bdspCompact from '../assets/game-emblems/bdsp-compact.svg';
import swsh from '../assets/game-emblems/swsh.svg';
import swshCompact from '../assets/game-emblems/swsh-compact.svg';
import type { GameId } from '../workspace';

const emblems: Record<GameId, { regular: string; compact: string }> = {
  frlg: { regular: frlg, compact: frlgCompact },
  bdsp: { regular: bdsp, compact: bdspCompact },
  swsh: { regular: swsh, compact: swshCompact },
};

export function GameEmblem({ game, compact = false }: { game: GameId; compact?: boolean }) {
  return <span className={'game-emblem' + (compact ? ' compact' : '')} data-game={game} aria-hidden="true">
    <img src={emblems[game][compact ? 'compact' : 'regular']} alt="" draggable={false} />
  </span>;
}

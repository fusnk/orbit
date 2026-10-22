import type { Room } from '../app/router';
import { addonsRoom } from './addons/page';
import { createDiscoverRoom } from './discover';
import { downloadsRoom } from './downloads';
import { exploreRoom } from './explore';
import { homeRoom } from './home';
import { libraryRoom } from './library';
import { liveRoom } from './live';
import { searchRoom } from './search';
import { settingsRoom } from './settings';

/** Pages in the title-bar nav, in order. Addons starts hidden there (theme/layout.ts HIDDEN_BY_DEFAULT). */
export const navRooms: readonly Room[] = [homeRoom, createDiscoverRoom('movie'), createDiscoverRoom('series'), createDiscoverRoom('anime'), exploreRoom, liveRoom, searchRoom, libraryRoom, downloadsRoom, addonsRoom];

/** Every page the router can show: the nav pages plus Settings (title-bar icon). */
export const rooms: readonly Room[] = [...navRooms, settingsRoom];

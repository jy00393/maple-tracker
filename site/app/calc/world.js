// The world type a character plays on, as the pages name it. A character saved without one is on a Heroic world.
export const worldName = (char) => (char && char.world === 'interactive' ? 'Interactive' : 'Heroic');

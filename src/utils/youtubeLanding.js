/**
 * Holds a YouTube player to a jump until playback actually reaches it.
 *
 * On a live broadcast YouTube does not reliably start where it is asked to.
 * Measured on Great Planes' Day 2 stream with a match 21890s in: a `seekTo` on a
 * player that had not played yet landed on the live edge, and the embed's own
 * play button started it from 0, the top of the broadcast. A `seekTo` once it is
 * playing landed every time. So the jump is checked the moment playback begins,
 * and made again from there if it missed.
 */

/** YT.PlayerState.PLAYING. */
const PLAYING = 1;

/** Close enough to count as there: a live stream's keyframes are a couple of
 *  seconds apart. */
const TOLERANCE_SECONDS = 5;

/** A match that started moments ago can sit past the live edge, and no seek
 *  reaches past that, so this many tries and then wherever it is. */
const MAX_CORRECTIONS = 2;

export class YouTubeLanding {
    constructor() {
        this.target = null;
        this.corrections = 0;
    }

    /** The second the player should be at once it plays. */
    aim(seconds) {
        this.target = Math.max(0, seconds);
        this.corrections = 0;
    }

    /** The viewer moved the video themselves, so it is no longer ours to hold. */
    release() {
        this.target = null;
    }

    /** Feed every `onStateChange`. */
    onStateChange(player, state) {
        if (state !== PLAYING || this.target === null || !player) return;
        const now = player.getCurrentTime();
        if (Math.abs(now - this.target) <= TOLERANCE_SECONDS || this.corrections >= MAX_CORRECTIONS) {
            this.target = null;
            return;
        }
        this.corrections += 1;
        player.seekTo(this.target, true);
    }
}

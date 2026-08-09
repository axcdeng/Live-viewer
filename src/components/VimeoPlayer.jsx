import React, { useEffect, useRef, useState } from 'react';
import { formatTimestamp, loadVimeoSdk, vimeoEmbedUrl } from '../services/vimeo';

/**
 * A Vimeo event embed dressed up as a YouTube player.
 *
 * The rest of the Viewer talks to players through the react-youtube surface —
 * seekTo / playVideo / pauseVideo / getCurrentTime — so rather than teach
 * jumpToMatch, the seek buttons and manual sync about a second provider, this
 * hands `onReady` a shim with those exact methods. Everything downstream stays
 * provider-agnostic.
 *
 * The one real impedance mismatch: the Vimeo SDK is promise-based while
 * getCurrentTime() is called synchronously, so the current time is mirrored into
 * a ref off the player's own timeupdate/seeked events.
 */

// Where a position sits relative to the live edge, phrased the way Vimeo's own
// scrubber shows it ("-1:59:50"). During a live broadcast that readout is all a
// viewer can see, so an offset from the broadcast start would be meaningless.
const behindLiveOf = (liveEdge, target) => {
    if (!liveEdge) return null;
    const liveNow = liveEdge.seconds + (Date.now() - liveEdge.at) / 1000;
    const behind = liveNow - target;
    return behind > 0 ? behind : null;
};

function VimeoPlayer({ eventId, videoId, hash = null, onReady, onError }) {
    const iframeRef = useRef(null);
    const currentTimeRef = useRef(0);
    const liveEdgeRef = useRef(null);
    const [failed, setFailed] = useState(null);

    const behindLiveLabel = (target) => {
        const behind = behindLiveOf(liveEdgeRef.current, target);
        return behind === null ? `${formatTimestamp(target)} from the start` : `-${formatTimestamp(behind)}`;
    };

    const src = vimeoEmbedUrl(eventId, videoId, { hash });

    useEffect(() => {
        if (!src) return undefined;

        let cancelled = false;
        let player = null;
        currentTimeRef.current = 0;
        setFailed(null);

        // Declared out here so the cleanup below can unsubscribe the exact same
        // reference it subscribed.
        //
        // The first tick lands at the live edge (the embed autoplays there), so
        // pairing it with a wall clock lets us keep projecting where the live
        // edge is even after someone scrubs away from it.
        const track = (data) => {
            if (typeof data?.seconds !== 'number') return;
            currentTimeRef.current = data.seconds;
            if (liveEdgeRef.current === null) {
                liveEdgeRef.current = { seconds: data.seconds, at: Date.now() };
            }
        };

        loadVimeoSdk()
            .then((Vimeo) => {
                if (cancelled || !iframeRef.current) return;

                player = new Vimeo.Player(iframeRef.current);

                player.on('timeupdate', track);
                player.on('seeked', track);

                return player.ready().then(async () => {
                    if (cancelled) return;

                    // Belt and braces. The hashed player URL pins the clip, but
                    // a day saved without a hash falls back to the event embed,
                    // whose `?video=` parameter Vimeo silently ignores — it
                    // serves whichever clip is featured now. Left unchecked that
                    // seeks into the wrong recording at a plausible offset.
                    if (videoId) {
                        const loaded = await player.getVideoId().catch(() => null);
                        if (cancelled) return;
                        if (loaded && String(loaded) !== String(videoId)) {
                            setFailed(
                                'Vimeo is showing a different video than this day\'s recording, so match jumps ' +
                                'would land in the wrong place. This usually means the day\'s clip id needs ' +
                                'updating in the admin.',
                            );
                            return;
                        }
                    }

                    onReady?.({
                        // Signature mirrors YT's seekTo(seconds, allowSeekAhead).
                        seekTo: (seconds) => {
                            const target = Math.max(0, Number(seconds) || 0);
                            // Only commit the mirrored clock once Vimeo accepts
                            // the seek. Moving it up front let a rejected seek
                            // compound — every later -10s would be measured from
                            // a position the player never reached.
                            player.setCurrentTime(target)
                                .then(() => { currentTimeRef.current = target; })
                                .catch((error) => {
                                    // Vimeo reports duration 0 for a live event and
                                    // validates every seek against it, so while a
                                    // broadcast is running *nothing* is seekable —
                                    // not even a few seconds back. It starts working
                                    // once the session ends and the replay publishes.
                                    //
                                    // Vimeo's scrubber counts backwards from the
                                    // live edge, and that is the only readout the
                                    // viewer can see, so quote the position in the
                                    // same terms rather than as an offset from the
                                    // broadcast start.
                                    const message =
                                        error?.name === 'RangeError'
                                            ? `Vimeo blocks jumping while a broadcast is live. Drag the scrubber back to about ${behindLiveLabel(target)}, which is where this match is right now. Vimeo counts backwards from live, so that number keeps sliding as the stream runs. Jumping works normally once the session ends and the replay is posted.`
                                            : 'Could not seek this Vimeo stream.';
                                    onError?.(message);
                                });
                        },
                        playVideo: () => { player.play().catch(() => {}); },
                        pauseVideo: () => { player.pause().catch(() => {}); },
                        getCurrentTime: () => currentTimeRef.current,
                        destroy: () => { player.destroy().catch(() => {}); },
                    });
                });
            })
            .catch(() => {
                if (cancelled) return;
                setFailed('Could not load the Vimeo player.');
                onError?.('Could not load the Vimeo player.');
            });

        return () => {
            cancelled = true;
            player?.off?.('timeupdate', track);
            player?.off?.('seeked', track);
            // destroy() also unwinds the window-level message listener player.js
            // installs, which unload() leaves behind. React owns the iframe, but
            // it is being torn down or re-keyed on this same commit either way.
            player?.destroy?.().catch(() => {});
        };
        // `onReady`/`onError` are intentionally excluded — callers pass inline
        // closures, and re-running this would rebuild the player every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src]);

    if (!src) {
        return (
            <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm">
                No Vimeo event configured.
            </div>
        );
    }

    if (failed) {
        return (
            <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm px-6 text-center">
                {failed}
            </div>
        );
    }

    return (
        <iframe
            ref={iframeRef}
            src={src}
            className="w-full h-full"
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            title="Vimeo livestream"
        />
    );
}

export default VimeoPlayer;

import React, { useEffect, useRef, useState } from 'react';
import { loadVimeoSdk, vimeoEmbedUrl } from '../services/vimeo';

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
function VimeoPlayer({ eventId, videoId, onReady, onError }) {
    const iframeRef = useRef(null);
    const currentTimeRef = useRef(0);
    const [failed, setFailed] = useState(null);

    const src = vimeoEmbedUrl(eventId, videoId);

    useEffect(() => {
        if (!src) return undefined;

        let cancelled = false;
        let player = null;
        currentTimeRef.current = 0;
        setFailed(null);

        // Declared out here so the cleanup below can unsubscribe the exact same
        // reference it subscribed.
        const track = (data) => {
            if (typeof data?.seconds === 'number') currentTimeRef.current = data.seconds;
        };

        loadVimeoSdk()
            .then((Vimeo) => {
                if (cancelled || !iframeRef.current) return;

                player = new Vimeo.Player(iframeRef.current);

                player.on('timeupdate', track);
                player.on('seeked', track);

                return player.ready().then(async () => {
                    if (cancelled) return;

                    // `?video=` is the only way to pin an event embed to a past
                    // session — clips inside an event 401 when embedded directly.
                    // If Vimeo ever ignores it and serves the currently-featured
                    // clip instead, every seek would land in the wrong video at a
                    // plausible-looking offset, so check rather than assume.
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
                                    // RangeError means the target is outside what
                                    // the player will accept — before the start of
                                    // a live stream's DVR window, or past the end.
                                    const message =
                                        error?.name === 'RangeError'
                                            ? 'That moment is outside the part of this stream Vimeo will let you seek to. If the broadcast is still live, the archive will cover it once the session ends.'
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

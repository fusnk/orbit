# Subtitle transcript

The player transcript uses the primary subtitle track reported by mpv. Cue times are raw seconds; the panel adds mpv's current subtitle delay before highlighting or seeking. A new track or media open changes the cache identity. Local download file changes also change its identity.

## Source coverage

- Addon subtitle URLs: fetched through the existing addon network client (HTTPS or approved localhost, redirect checks, 20-second timeout, 5 MiB cap).
- OpenSubtitles, selected local files, and dropped subtitle files: supported when Orbit hands mpv their text bytes as `hex://`.
- Downloaded subtitles: supported only for files explicitly recorded beside the current downloaded video.
- Automatically synchronized external tracks: parsed from the new in-memory track, so the transcript reflects their retimed timestamps.
- Jellyfin/Plex external tracks handed directly to mpv with server credentials: unavailable when retrieving their text would require reusing those credentials in a separate request. No credentials are forwarded to addon hosts.
- Embedded text or image tracks: unavailable. Orbit's existing Matroska sync path extracts timings, not dialogue; the transcript does not scan/download video or add ffmpeg.

## Formats and bounds

SRT and WebVTT cue blocks and ASS/SSA Events dialogue are supported. Formatting tags, ASS override commands and drawing instructions are removed. Overlapping cues are retained in stable chronological order. UTF-8 and BOM-marked UTF-16 use Orbit's existing decoder; legacy single-byte text falls back to Windows-1252 (Latin-1 letters with Windows punctuation). Other legacy multibyte encodings cannot be confidently detected and may display incorrectly.

Files are capped at 5 MiB, transcripts at 20,000 cues, and individual lines at approximately 4,000 UTF-8 bytes. Invalid, reversed, non-finite or empty cues are omitted. Parsing runs on a blocking worker, never the mpv event thread. The command takes no paths or URLs: only the currently selected external mpv track can be read, and local reads reuse the download authorization list. Subtitle content is returned as plain text for DOM text nodes.

The whole-transcript preference is stored per profile. Future cues are hidden by default; whole-transcript mode is an explicit spoiler opt-in. Text is never logged.
